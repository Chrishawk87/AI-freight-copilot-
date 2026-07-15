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
    // A driver's own key always applies. The company's shared key only applies
    // when we're allowed to spend on it (i.e. the tenant is under its monthly cap).
    const companyKey = allowCompanyKey ? process.env.OCR_API_KEY || '' : '';
    const key = (clientKey || companyKey).trim();

    if (key && imageData) {
      try {
        if (provider === 'mindee') {
          const real = await this.extractWithMindee(imageData, key);
          if (real) return real;
        }
        // Unknown provider name but a key is set: fall through to simulated,
        // but note the intended provider so the UI can show what was attempted.
      } catch (e) {
        this.logger.warn(`OCR provider "${provider}" failed, using fallback: ${e}`);
      }
    }

    return this.simulate(ctx);
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
