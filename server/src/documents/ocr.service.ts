import { Injectable, Logger } from '@nestjs/common';

// The structured fields we pull off a freight document, whatever the source.
export interface ExtractedFields {
  bolNumber: string;
  proNumber: string;
  shipper: string;
  consignee: string;
  poNumber: string;
  pieceCount: number | null;
  weightLbs: number | null;
  shipDate: string;
  deliveryDate: string;
  signaturePresent: boolean;
  signedBy: string;
  confidence: number; // 0-100
  provider: string; // which engine produced this
  raw: any; // raw provider payload, for audit
}

// Optional context so the extraction can be enriched / sanity-checked against
// the load the driver is actually running.
export interface OcrContext {
  type?: string;
  load?: {
    externalId?: string;
    originCity?: string;
    originState?: string;
    destCity?: string;
    destState?: string;
    broker?: string;
    weightLbs?: number;
    pickupDate?: string;
  } | null;
}

// Structured fields pulled off a Rate Confirmation. Broker-agnostic — every
// broker's layout differs, so we parse with an LLM (Claude) rather than a
// rigid template, which is the only approach that scales across carriers.
export interface RateConFields {
  rateConNumber: string;
  brokerName: string;
  brokerContactName: string;
  brokerPhone: string;
  brokerEmail: string;
  commodity: string;
  equipmentType: string;
  weightLbs: number | null;
  pieceCount: number | null;
  poNumber: string;
  referenceNumber: string;
  lineHaulRate: number | null;
  fuelSurcharge: number | null;
  accessorials: { name: string; amount: number }[];
  totalRate: number | null;
  originCity: string;
  originState: string;
  pickupAddress: string;
  pickupAppt: string;
  destCity: string;
  destState: string;
  deliveryAddress: string;
  deliveryAppt: string;
  specialInstructions: string;
  confidence: number;
  provider: string;
  raw: any;
}

/**
 * Dedicated document-OCR layer.
 *
 * If a provider + API key is configured (per-driver key passed from the app, or
 * a server-wide OCR_API_KEY env var), we call the real OCR provider. With no key
 * we fall back to a deterministic simulated extraction so the whole scan → review
 * → invoice flow works end-to-end in the demo. This mirrors how the load-board
 * connectors stay dormant until a real key is supplied.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extract(
    imageData: string | undefined,
    clientKey: string | undefined,
    ctx: OcrContext = {},
    opts: { allowCompanyKey?: boolean } = {},
  ): Promise<ExtractedFields> {
    const provider = (process.env.OCR_PROVIDER || 'mindee').toLowerCase();
    const allowCompanyKey = opts.allowCompanyKey ?? true;

    // 1) Claude vision on the shared ANTHROPIC key. This is the default reader:
    // it works on ANY BOL/POD layout (image OR PDF) with zero per-tenant setup,
    // the same integration-free approach we use for Rate Cons. Gated by
    // allowCompanyKey so an over-cap tenant falls back instead of billing.
    const anthropicKey = allowCompanyKey
      ? (process.env.ANTHROPIC_API_KEY || '').trim()
      : '';
    if (anthropicKey && imageData) {
      try {
        const real = await this.extractWithClaude(imageData, anthropicKey, ctx);
        if (real) return real;
      } catch (e) {
        this.logger.warn(`Document LLM parse failed, using fallback: ${e}`);
      }
    }

    // 2) Optional paid OCR provider (Mindee), if a company or driver key is set.
    // A driver's own key always applies; the company key only under-cap.
    const companyKey = allowCompanyKey ? process.env.OCR_API_KEY || '' : '';
    const key = (clientKey || companyKey).trim();
    if (key && imageData) {
      try {
        if (provider === 'mindee') {
          const real = await this.extractWithMindee(imageData, key);
          if (real) return real;
        }
      } catch (e) {
        this.logger.warn(`OCR provider "${provider}" failed, using fallback: ${e}`);
      }
    }

    // 3) No key / everything failed: deterministic simulated read so the flow
    // still works end-to-end.
    return this.simulate(ctx);
  }

  /**
   * POST to Anthropic's Messages API. Critically, PDF document blocks require
   * the `anthropic-beta: pdfs-2024-09-25` header on top of the stable API
   * version — without it the request 400s. Rate Cons and many BOLs arrive as
   * PDFs, so omitting this header was silently forcing every PDF scan onto the
   * fabricated fallback. We also surface the real error BODY (not just the
   * status) so a failed read is diagnosable instead of vanishing.
   */
  private async postAnthropic(
    key: string,
    isPdf: boolean,
    body: Record<string, any>,
  ): Promise<any> {
    const headers: Record<string, string> = {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    if (isPdf) headers['anthropic-beta'] = 'pdfs-2024-09-25';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic HTTP ${res.status} ${detail.slice(0, 400)}`);
    }
    return res.json();
  }

  // ---- Real document parse: Claude vision --------------------------------------
  // Reads a Bill of Lading / Proof of Delivery (image OR PDF) into structured
  // fields. Broker/shipper-agnostic — no template needed. Any shape problem
  // throws and the caller falls back to Mindee or the simulation.
  private async extractWithClaude(
    imageData: string,
    key: string,
    ctx: OcrContext,
  ): Promise<ExtractedFields | null> {
    const { buffer, mime } = decodeDataUrl(imageData);
    const b64 = buffer.toString('base64');
    const model =
      process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001';
    const docType = (ctx.type || 'BOL').toUpperCase();

    const isPdf = /pdf/i.test(mime);
    const source = isPdf
      ? { type: 'base64', media_type: 'application/pdf', data: b64 }
      : { type: 'base64', media_type: mime || 'image/jpeg', data: b64 };
    const fileBlock = isPdf
      ? { type: 'document', source }
      : { type: 'image', source };

    const instruction =
      `You are extracting fields from a freight ${docType === 'POD' ? 'Proof of Delivery (POD)' : 'Bill of Lading (BOL)'}. ` +
      'Return ONLY a JSON object (no markdown, no prose) with EXACTLY these keys:\n' +
      '{"bolNumber":string,"proNumber":string,"shipper":string,"consignee":string,' +
      '"poNumber":string,"pieceCount":number|null,"weightLbs":number|null,' +
      '"shipDate":string,"deliveryDate":string,"signaturePresent":boolean,' +
      '"signedBy":string}\n' +
      'Rules: dates as YYYY-MM-DD when shown. weightLbs and pieceCount as plain ' +
      'numbers (no commas/units). Use "" for missing text and null for missing ' +
      'numbers. signaturePresent is true only if a delivery/receiving signature is ' +
      'actually visible on the document; signedBy is the printed name if legible, ' +
      'else "". Do not guess values that are not present.';

    const data: any = await this.postAnthropic(key, isPdf, {
      model,
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: instruction }],
        },
      ],
    });
    const text: string =
      Array.isArray(data?.content) && data.content[0]?.type === 'text'
        ? String(data.content[0].text || '')
        : '';
    const parsed = parseJsonLoose(text);
    if (!parsed) throw new Error('Document parse: no JSON in response');

    const fields = {
      bolNumber: str(parsed.bolNumber),
      proNumber: str(parsed.proNumber),
      shipper: str(parsed.shipper),
      consignee: str(parsed.consignee),
      poNumber: str(parsed.poNumber),
      pieceCount: numOrNull(parsed.pieceCount),
      weightLbs: numOrNull(parsed.weightLbs),
      shipDate: str(parsed.shipDate),
      deliveryDate: str(parsed.deliveryDate),
      signaturePresent: parsed.signaturePresent === true,
      signedBy: str(parsed.signedBy),
    };

    // Count only the substantive text/number fields — the signature boolean
    // defaults to false and must not, by itself, look like a successful read.
    const present = [
      fields.bolNumber,
      fields.proNumber,
      fields.shipper,
      fields.consignee,
      fields.poNumber,
      fields.pieceCount,
      fields.weightLbs,
      fields.shipDate,
      fields.deliveryDate,
      fields.signedBy,
    ].filter((v) => v !== '' && v != null).length;
    if (present === 0) throw new Error('Document parse: empty result');
    return {
      ...fields,
      confidence: Math.min(96, 45 + present * 8),
      provider: 'anthropic',
      raw: parsed,
    };
  }

  /**
   * Parse a Rate Confirmation into structured fields. Uses Claude (vision) so it
   * works on ANY broker's layout — the scalable, integration-free path. Falls
   * back to a load-aware simulation when no key is available or the tenant is
   * over its monthly cap, so the confirm-to-create-load flow still demos end to
   * end. `allowCompanyKey` gates spending the shared Anthropic account.
   */
  async extractRateCon(
    imageData: string | undefined,
    ctx: OcrContext = {},
    opts: { allowCompanyKey?: boolean } = {},
  ): Promise<RateConFields> {
    const allowCompanyKey = opts.allowCompanyKey ?? true;
    const key = allowCompanyKey ? (process.env.ANTHROPIC_API_KEY || '').trim() : '';

    if (key && imageData) {
      try {
        const real = await this.extractRateConWithClaude(imageData, key);
        if (real) return real;
      } catch (e) {
        this.logger.warn(`Rate Con LLM parse failed, using fallback: ${e}`);
      }
    }
    return this.simulateRateCon(ctx);
  }

  // ---- Real Rate Con parse: Claude vision -------------------------------------
  // Sends the scan (image OR PDF) to Claude and asks for strict JSON. Any shape
  // problem throws and the caller falls back to the simulation.
  private async extractRateConWithClaude(
    imageData: string,
    key: string,
  ): Promise<RateConFields | null> {
    const { buffer, mime } = decodeDataUrl(imageData);
    const b64 = buffer.toString('base64');
    const model =
      process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001';

    // PDFs go as a document block; everything else as an image block.
    const isPdf = /pdf/i.test(mime);
    const source = isPdf
      ? { type: 'base64', media_type: 'application/pdf', data: b64 }
      : { type: 'base64', media_type: mime || 'image/jpeg', data: b64 };
    const fileBlock = isPdf
      ? { type: 'document', source }
      : { type: 'image', source };

    const instruction =
      'You are extracting fields from a freight Rate Confirmation ("Rate Con"). ' +
      'Return ONLY a JSON object (no markdown, no prose) with EXACTLY these keys:\n' +
      '{"rateConNumber":string,"brokerName":string,"brokerContactName":string,' +
      '"brokerPhone":string,"brokerEmail":string,"commodity":string,' +
      '"equipmentType":string,"weightLbs":number|null,"pieceCount":number|null,' +
      '"poNumber":string,"referenceNumber":string,"lineHaulRate":number|null,' +
      '"fuelSurcharge":number|null,"accessorials":[{"name":string,"amount":number}],' +
      '"totalRate":number|null,"originCity":string,"originState":string,' +
      '"pickupAddress":string,"pickupAppt":string,"destCity":string,' +
      '"destState":string,"deliveryAddress":string,"deliveryAppt":string,' +
      '"specialInstructions":string}\n' +
      'Rules: money as plain numbers (no $ or commas). Use "" for missing text ' +
      'and null for missing numbers. States as 2-letter codes. accessorials covers ' +
      'lumper, detention, tarp, and similar extras. If a value is not present, do ' +
      'not guess.';

    const data: any = await this.postAnthropic(key, isPdf, {
      model,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: instruction }],
        },
      ],
    });
    const text: string =
      Array.isArray(data?.content) && data.content[0]?.type === 'text'
        ? String(data.content[0].text || '')
        : '';
    const parsed = parseJsonLoose(text);
    if (!parsed) throw new Error('Rate Con parse: no JSON in response');

    const accessorials = Array.isArray(parsed.accessorials)
      ? parsed.accessorials
          .map((a: any) => ({
            name: String(a?.name ?? '').trim(),
            amount: Number(a?.amount) || 0,
          }))
          .filter((a: any) => a.name)
      : [];

    const fields: RateConFields = {
      rateConNumber: str(parsed.rateConNumber),
      brokerName: str(parsed.brokerName),
      brokerContactName: str(parsed.brokerContactName),
      brokerPhone: str(parsed.brokerPhone),
      brokerEmail: str(parsed.brokerEmail),
      commodity: str(parsed.commodity),
      equipmentType: str(parsed.equipmentType),
      weightLbs: numOrNull(parsed.weightLbs),
      pieceCount: numOrNull(parsed.pieceCount),
      poNumber: str(parsed.poNumber),
      referenceNumber: str(parsed.referenceNumber),
      lineHaulRate: numOrNull(parsed.lineHaulRate),
      fuelSurcharge: numOrNull(parsed.fuelSurcharge),
      accessorials,
      totalRate: numOrNull(parsed.totalRate),
      originCity: str(parsed.originCity),
      originState: str(parsed.originState).toUpperCase().slice(0, 2),
      pickupAddress: str(parsed.pickupAddress),
      pickupAppt: str(parsed.pickupAppt),
      destCity: str(parsed.destCity),
      destState: str(parsed.destState).toUpperCase().slice(0, 2),
      deliveryAddress: str(parsed.deliveryAddress),
      deliveryAppt: str(parsed.deliveryAppt),
      specialInstructions: str(parsed.specialInstructions),
      confidence: 0,
      provider: 'anthropic',
      raw: parsed,
    };

    // If nothing meaningful came back, treat as a failed read.
    const present = [
      fields.brokerName,
      fields.originCity,
      fields.destCity,
      fields.lineHaulRate,
      fields.totalRate,
    ].filter((v) => v !== '' && v != null).length;
    if (present === 0) throw new Error('Rate Con parse: empty result');
    fields.confidence = Math.min(96, 55 + present * 8);
    return fields;
  }

  // Load-aware simulated Rate Con so the confirm flow works with no key.
  private simulateRateCon(ctx: OcrContext): RateConFields {
    const load = ctx.load || null;
    const seq = Math.floor(100000 + Math.random() * 899999);
    const lineHaul = load?.weightLbs ? 1800 + Math.floor(Math.random() * 1400) : 2200;
    const fsc = Math.round(lineHaul * 0.18);
    return {
      rateConNumber: load?.externalId ? `RC-${load.externalId}` : `RC-${seq}`,
      brokerName: load?.broker || 'Sample Logistics LLC',
      brokerContactName: 'Dispatch Desk',
      brokerPhone: '(555) 010-4821',
      brokerEmail: 'dispatch@samplelogistics.com',
      commodity: 'General freight',
      equipmentType: "Dry Van 53'",
      weightLbs: load?.weightLbs ?? 34000,
      pieceCount: 22,
      poNumber: `PO-${Math.floor(10000 + Math.random() * 89999)}`,
      referenceNumber: `${Math.floor(1000000 + Math.random() * 8999999)}`,
      lineHaulRate: lineHaul,
      fuelSurcharge: fsc,
      accessorials: [{ name: 'Lumper', amount: 150 }],
      totalRate: lineHaul + fsc + 150,
      originCity: load?.originCity || 'Dallas',
      originState: load?.originState || 'TX',
      pickupAddress: `${load?.originCity || 'Dallas'}, ${load?.originState || 'TX'} — dock hours 0700-1500`,
      pickupAppt: load?.pickupDate ? String(load.pickupDate).slice(0, 10) : today(0),
      destCity: load?.destCity || 'Atlanta',
      destState: load?.destState || 'GA',
      deliveryAddress: `${load?.destCity || 'Atlanta'}, ${load?.destState || 'GA'} — appt required`,
      deliveryAppt: today(2),
      specialInstructions:
        'Driver assist unload. Check calls at pickup and every morning by 0900.',
      confidence: 80,
      provider: 'simulated',
      raw: { note: 'Simulated Rate Con — set ANTHROPIC_API_KEY for live parsing.' },
    };
  }

  // ---- Real provider: Mindee Bill of Lading API -------------------------------
  // Dormant until a key is present. Kept defensive: any shape mismatch throws and
  // the caller falls back to the simulated extraction.
  private async extractWithMindee(
    imageData: string,
    key: string,
  ): Promise<ExtractedFields | null> {
    const { buffer, mime } = decodeDataUrl(imageData);
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mime });
    form.append('document', blob, `scan.${mime.split('/')[1] || 'jpg'}`);

    const res = await fetch(
      'https://api.mindee.net/v1/products/mindee/bill_of_lading/v1/predict',
      { method: 'POST', headers: { Authorization: `Token ${key}` }, body: form },
    );
    if (!res.ok) throw new Error(`Mindee HTTP ${res.status}`);
    const json: any = await res.json();
    const pred = json?.document?.inference?.prediction;
    if (!pred) throw new Error('Mindee: no prediction in response');

    const val = (f: any): string =>
      f == null ? '' : String(f.value ?? f.name ?? f.content ?? '').trim();

    const fields = {
      bolNumber: val(pred.bill_of_lading_number),
      proNumber: val(pred.carrier?.professional_number) || val(pred.tracking_number),
      shipper: val(pred.shipper) || val(pred.shipper?.name),
      consignee: val(pred.consignee) || val(pred.consignee?.name),
      poNumber: val(pred.purchase_order) || val(pred.po_number),
      pieceCount: numOrNull(firstQuantity(pred.carrier_items)),
      weightLbs: numOrNull(firstWeight(pred.carrier_items)),
      shipDate: val(pred.date_of_issue) || val(pred.departure_date),
      deliveryDate: val(pred.arrival_date) || val(pred.delivery_date),
    };

    const present = countPresent(fields);
    return {
      ...fields,
      signaturePresent: present >= 4, // heuristic; Mindee BOL has no signature field
      signedBy: '',
      confidence: Math.min(95, 40 + present * 8),
      provider: 'mindee',
      raw: pred,
    };
  }

  // ---- Simulated extraction ---------------------------------------------------
  // Produces realistic, load-aware fields so the demo mirrors a real dock scan.
  private simulate(ctx: OcrContext): ExtractedFields {
    const load = ctx.load || null;
    const type = (ctx.type || 'BOL').toUpperCase();
    const seq = Math.floor(100000 + Math.random() * 899999);
    const shipperCity = load?.originCity ? `${load.originCity}, ${load.originState}` : 'Dallas, TX';
    const consigneeCity = load?.destCity ? `${load.destCity}, ${load.destState}` : 'Atlanta, GA';

    // A POD is the signed copy at delivery; a raw BOL at pickup may be unsigned.
    const signed = type === 'POD' ? true : Math.random() > 0.35;

    const fields = {
      bolNumber: load?.externalId ? `BOL-${load.externalId.replace(/[^0-9]/g, '') || seq}` : `BOL-${seq}`,
      proNumber: `${Math.floor(1000000 + Math.random() * 8999999)}`,
      shipper: load?.broker ? `${load.broker} (Shipper)` : `${shipperCity} Distribution`,
      consignee: `${consigneeCity} Receiving`,
      poNumber: `PO-${Math.floor(10000 + Math.random() * 89999)}`,
      pieceCount: 20 + Math.floor(Math.random() * 6) * 2,
      weightLbs: load?.weightLbs ?? 30000 + Math.floor(Math.random() * 12000),
      shipDate: load?.pickupDate ? String(load.pickupDate).slice(0, 10) : today(-2),
      deliveryDate: type === 'POD' ? today(0) : '',
      signaturePresent: signed,
      signedBy: signed ? 'Receiving Clerk' : '',
    };

    return {
      ...fields,
      confidence: signed ? 88 : 72,
      provider: 'simulated',
      raw: { note: 'Simulated extraction — connect an OCR provider in Plugins for live reads.' },
    };
  }
}

// ---- helpers ---------------------------------------------------------------
function decodeDataUrl(dataUrl: string): { buffer: Buffer; mime: string } {
  const m = dataUrl.match(/^data:(.+?);base64,(.*)$/s);
  if (m) return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
  // Bare base64 with no data-url prefix.
  return { mime: 'image/jpeg', buffer: Buffer.from(dataUrl, 'base64') };
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function str(v: any): string {
  return v == null ? '' : String(v).trim();
}

// Claude usually returns clean JSON, but be defensive: strip code fences and
// pull the first {...} block so a stray sentence never breaks the parse.
function parseJsonLoose(text: string): any | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function firstQuantity(items: any): any {
  if (!Array.isArray(items) || !items.length) return null;
  return items[0]?.quantity ?? null;
}

function firstWeight(items: any): any {
  if (!Array.isArray(items) || !items.length) return null;
  return items[0]?.weight ?? null;
}

function countPresent(f: Record<string, any>): number {
  return Object.values(f).filter((v) => v !== '' && v != null).length;
}

function today(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
