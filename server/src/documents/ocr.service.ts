import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { rasterizePdf } from './pdf-raster';

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
// broker's layout differs, so we parse with a vision LLM rather than a rigid
// template, which is the only approach that scales across carriers.
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
 * Reading order, by design:
 *   1) A Llama-class vision model on an OpenAI-compatible endpoint (Together,
 *      Groq, Fireworks, OpenRouter — anything that hosts an open vision model
 *      and scales to thousands of tenants). Configured entirely by env:
 *        OCR_VISION_API_KEY   — enables the reader (required)
 *        OCR_VISION_BASE_URL  — default https://api.together.xyz/v1
 *        OCR_VISION_MODEL     — default a Llama 4 vision model
 *      A per-driver key passed from the app (BYOK) overrides the shared key.
 *   2) Claude vision as a fallback — it reads image OR PDF natively.
 *
 * There is intentionally NO fabricated fallback. If both engines fail (or no
 * key is configured / the tenant is over its cap), we throw a clear error so a
 * bad read surfaces honestly instead of masquerading as parsed data.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  // ---- Public: Bill of Lading / Proof of Delivery ----------------------------
  async extract(
    imageData: string | undefined,
    clientKey: string | undefined,
    ctx: OcrContext = {},
    opts: { allowCompanyKey?: boolean } = {},
  ): Promise<ExtractedFields> {
    if (!imageData) {
      throw new BadRequestException('No document image was provided.');
    }
    const allowCompanyKey = opts.allowCompanyKey ?? true;
    const docType = (ctx.type || 'BOL').toUpperCase();
    const instruction = bolInstruction(docType);

    const errors: string[] = [];

    // 1) Llama-class vision (primary).
    const v = this.visionConfig(clientKey, allowCompanyKey);
    if (v) {
      try {
        const images = await this.toImages(imageData);
        if (images.length) {
          const parsed = await this.callVision(images, v, instruction);
          return this.finishBol(parsed, 'llama');
        }
        errors.push('vision: could not render document to an image');
      } catch (e) {
        errors.push(`vision: ${e}`);
        this.logger.warn(`Document vision parse failed: ${e}`);
      }
    }

    // 2) Claude vision (fallback) — reads image OR PDF natively.
    const anthropicKey = allowCompanyKey
      ? (process.env.ANTHROPIC_API_KEY || '').trim()
      : '';
    if (anthropicKey) {
      try {
        const real = await this.extractWithClaude(imageData, anthropicKey, ctx);
        if (real) return real;
        errors.push('claude: empty result');
      } catch (e) {
        errors.push(`claude: ${e}`);
        this.logger.warn(`Document Claude parse failed: ${e}`);
      }
    }

    // No fabricated fallback — surface the failure.
    throw new BadRequestException(
      this.failureMessage(!!v, !!anthropicKey, errors),
    );
  }

  // ---- Public: Rate Confirmation ---------------------------------------------
  async extractRateCon(
    imageData: string | undefined,
    _ctx: OcrContext = {},
    opts: { allowCompanyKey?: boolean; clientKey?: string } = {},
  ): Promise<RateConFields> {
    if (!imageData) {
      throw new BadRequestException('No document image was provided.');
    }
    const allowCompanyKey = opts.allowCompanyKey ?? true;
    const errors: string[] = [];

    // 1) Llama-class vision (primary).
    const v = this.visionConfig(opts.clientKey, allowCompanyKey);
    if (v) {
      try {
        const images = await this.toImages(imageData);
        if (images.length) {
          const parsed = await this.callVision(images, v, RATECON_INSTRUCTION);
          return this.finishRateCon(parsed, 'llama');
        }
        errors.push('vision: could not render document to an image');
      } catch (e) {
        errors.push(`vision: ${e}`);
        this.logger.warn(`Rate Con vision parse failed: ${e}`);
      }
    }

    // 2) Claude vision (fallback).
    const anthropicKey = allowCompanyKey
      ? (process.env.ANTHROPIC_API_KEY || '').trim()
      : '';
    if (anthropicKey) {
      try {
        const real = await this.extractRateConWithClaude(imageData, anthropicKey);
        if (real) return real;
        errors.push('claude: empty result');
      } catch (e) {
        errors.push(`claude: ${e}`);
        this.logger.warn(`Rate Con Claude parse failed: ${e}`);
      }
    }

    throw new BadRequestException(
      this.failureMessage(!!v, !!anthropicKey, errors),
    );
  }

  // ---- Vision (OpenAI-compatible, open model) --------------------------------
  private visionConfig(
    clientKey: string | undefined,
    allowCompanyKey: boolean,
  ): { key: string; baseUrl: string; model: string } | null {
    const key =
      (clientKey || '').trim() ||
      (allowCompanyKey ? (process.env.OCR_VISION_API_KEY || '').trim() : '');
    if (!key) return null;
    const baseUrl = (
      process.env.OCR_VISION_BASE_URL || 'https://api.together.xyz/v1'
    ).replace(/\/$/, '');
    const model =
      process.env.OCR_VISION_MODEL?.trim() ||
      'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8';
    return { key, baseUrl, model };
  }

  // Normalize any scan into one or more image data URLs the vision model accepts.
  // PDFs are rasterized page-by-page; images pass straight through. Returns [] if
  // a PDF can't be rendered, so the caller falls back to the PDF-native reader.
  private async toImages(imageData: string): Promise<string[]> {
    const { buffer, mime } = decodeDataUrl(imageData);
    if (/pdf/i.test(mime)) {
      return rasterizePdf(buffer, 3);
    }
    if (imageData.startsWith('data:')) return [imageData];
    return [`data:${mime || 'image/jpeg'};base64,${buffer.toString('base64')}`];
  }

  private async callVision(
    images: string[],
    cfg: { key: string; baseUrl: string; model: string },
    instruction: string,
  ): Promise<any> {
    const content: any[] = [{ type: 'text', text: instruction }];
    for (const url of images) {
      content.push({ type: 'image_url', image_url: { url } });
    }
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1500,
        temperature: 0,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Vision HTTP ${res.status} ${detail.slice(0, 400)}`);
    }
    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message?.content;
    const text =
      typeof msg === 'string'
        ? msg
        : Array.isArray(msg)
          ? msg.map((p: any) => p?.text ?? '').join('')
          : '';
    const parsed = parseJsonLoose(text);
    if (!parsed) throw new Error('Vision parse: no JSON in response');
    return parsed;
  }

  // ---- Claude vision (fallback) ----------------------------------------------
  /**
   * POST to Anthropic's Messages API. PDF document blocks require the
   * `anthropic-beta: pdfs-2024-09-25` header on top of the stable API version —
   * without it the request 400s. We also surface the real error BODY so a failed
   * read is diagnosable.
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

    const data: any = await this.postAnthropic(key, isPdf, {
      model,
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: bolInstruction(docType) }],
        },
      ],
    });
    const text: string =
      Array.isArray(data?.content) && data.content[0]?.type === 'text'
        ? String(data.content[0].text || '')
        : '';
    const parsed = parseJsonLoose(text);
    if (!parsed) throw new Error('Document parse: no JSON in response');
    return this.finishBol(parsed, 'anthropic');
  }

  private async extractRateConWithClaude(
    imageData: string,
    key: string,
  ): Promise<RateConFields | null> {
    const { buffer, mime } = decodeDataUrl(imageData);
    const b64 = buffer.toString('base64');
    const model =
      process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001';

    const isPdf = /pdf/i.test(mime);
    const source = isPdf
      ? { type: 'base64', media_type: 'application/pdf', data: b64 }
      : { type: 'base64', media_type: mime || 'image/jpeg', data: b64 };
    const fileBlock = isPdf
      ? { type: 'document', source }
      : { type: 'image', source };

    const data: any = await this.postAnthropic(key, isPdf, {
      model,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: RATECON_INSTRUCTION }],
        },
      ],
    });
    const text: string =
      Array.isArray(data?.content) && data.content[0]?.type === 'text'
        ? String(data.content[0].text || '')
        : '';
    const parsed = parseJsonLoose(text);
    if (!parsed) throw new Error('Rate Con parse: no JSON in response');
    return this.finishRateCon(parsed, 'anthropic');
  }

  // ---- Shared mapping (engine-agnostic) --------------------------------------
  private finishBol(parsed: any, provider: string): ExtractedFields {
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

    // Count only substantive text/number fields — the signature boolean defaults
    // to false and must not, by itself, look like a successful read.
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
      provider,
      raw: parsed,
    };
  }

  private finishRateCon(parsed: any, provider: string): RateConFields {
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
      provider,
      raw: parsed,
    };

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

  private failureMessage(
    triedVision: boolean,
    triedClaude: boolean,
    errors: string[],
  ): string {
    if (!triedVision && !triedClaude) {
      return 'Document reading is not configured. Add an OCR vision key (OCR_VISION_API_KEY) or an Anthropic key, or enter your own OCR key in Plugins.';
    }
    this.logger.warn(`OCR failed on all engines: ${errors.join(' | ')}`);
    return "Couldn't read this document. Try a clearer, straight-on photo or a text-based PDF, then scan again.";
  }
}

// ---- instructions (shared by every engine) ---------------------------------
function bolInstruction(docType: string): string {
  const kind =
    docType === 'POD' ? 'Proof of Delivery (POD)' : 'Bill of Lading (BOL)';
  return (
    `You are extracting fields from a freight ${kind}. ` +
    'Return ONLY a JSON object (no markdown, no prose) with EXACTLY these keys:\n' +
    '{"bolNumber":string,"proNumber":string,"shipper":string,"consignee":string,' +
    '"poNumber":string,"pieceCount":number|null,"weightLbs":number|null,' +
    '"shipDate":string,"deliveryDate":string,"signaturePresent":boolean,' +
    '"signedBy":string}\n' +
    'Rules: dates as YYYY-MM-DD when shown. weightLbs and pieceCount as plain ' +
    'numbers (no commas/units). Use "" for missing text and null for missing ' +
    'numbers. signaturePresent is true only if a delivery/receiving signature is ' +
    'actually visible on the document; signedBy is the printed name if legible, ' +
    'else "". Do not guess values that are not present.'
  );
}

const RATECON_INSTRUCTION =
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

// Models usually return clean JSON, but be defensive: strip code fences and pull
// the first {...} block so a stray sentence never breaks the parse.
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
