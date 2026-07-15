// ---------------------------------------------------------------------------
// job-package.ts — combine every document collected under one job (load) into
// a single PDF "package" the driver can download or email as one file.
//
// Layout: a cover page (job summary + a checklist of what's inside), then one
// page per document — a labeled header with the extracted fields, and the
// original image (or, if the driver uploaded a PDF, its pages copied in).
// ---------------------------------------------------------------------------
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

const NAVY = rgb(0.04, 0.09, 0.16);
const INK = rgb(0.1, 0.12, 0.16);
const MUTE = rgb(0.45, 0.48, 0.54);
const ELECTRIC = rgb(0.13, 0.45, 0.96);
const LINE = rgb(0.85, 0.87, 0.9);

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 48;

const TYPE_LABEL: Record<string, string> = {
  BOL: 'Bill of Lading',
  POD: 'Proof of Delivery',
  LUMPER: 'Lumper Receipt',
  FUEL: 'Fuel Receipt',
  OTHER: 'Other Document',
};

// Priority so a package reads in the natural order of a haul.
const TYPE_ORDER: Record<string, number> = {
  BOL: 0,
  POD: 1,
  LUMPER: 2,
  FUEL: 3,
  OTHER: 4,
};

export interface PackageDoc {
  id: string;
  type: string;
  status: string;
  bolNumber?: string | null;
  proNumber?: string | null;
  poNumber?: string | null;
  shipper?: string | null;
  consignee?: string | null;
  pieceCount?: number | null;
  weightLbs?: number | null;
  shipDate?: string | null;
  deliveryDate?: string | null;
  signaturePresent?: boolean | null;
  signedBy?: string | null;
  imageData?: string | null; // data URL
  createdAt?: Date | string;
}

export interface PackageLoad {
  id: string;
  externalId?: string | null;
  originCity?: string | null;
  originState?: string | null;
  destCity?: string | null;
  destState?: string | null;
  broker?: string | null;
  rate?: number | null;
  weightLbs?: number | null;
  pickupDate?: Date | string | null;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return { mime: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
  } catch {
    return null;
  }
}

function jobTitle(load: PackageLoad | null): string {
  if (!load) return 'Unassigned documents';
  const ref = load.externalId || load.id.slice(0, 6);
  const from = [load.originCity, load.originState].filter(Boolean).join(', ');
  const to = [load.destCity, load.destState].filter(Boolean).join(', ');
  return `${ref}  ·  ${from || '—'} → ${to || '—'}`;
}

export async function buildJobPackagePdf(input: {
  load: PackageLoad | null;
  docs: PackageDoc[];
  carrierName?: string | null;
}): Promise<Uint8Array> {
  const { load, docs } = input;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ordered = [...docs].sort((a, b) => {
    const t = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
    if (t !== 0) return t;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });

  // ---- Cover page ----------------------------------------------------------
  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  cover.drawText('DOCUMENT PACKAGE', {
    x: MARGIN,
    y,
    size: 10,
    font: bold,
    color: ELECTRIC,
  });
  y -= 28;
  cover.drawText(jobTitle(load), { x: MARGIN, y, size: 17, font: bold, color: NAVY });
  y -= 22;

  const sub: string[] = [];
  if (load?.broker) sub.push(`Broker: ${load.broker}`);
  if (input.carrierName) sub.push(input.carrierName);
  sub.push(new Date().toLocaleDateString());
  cover.drawText(sub.join('   ·   '), { x: MARGIN, y, size: 10, font, color: MUTE });
  y -= 26;

  cover.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: LINE,
  });
  y -= 26;

  cover.drawText(`Contents — ${ordered.length} document${ordered.length === 1 ? '' : 's'}`, {
    x: MARGIN,
    y,
    size: 11,
    font: bold,
    color: INK,
  });
  y -= 20;

  ordered.forEach((d, i) => {
    const label = TYPE_LABEL[d.type] || d.type;
    const ref = d.bolNumber || d.proNumber || d.poNumber || '';
    const flag = d.status === 'complete' ? 'Complete' : 'Needs review';
    const flagColor = d.status === 'complete' ? rgb(0.13, 0.6, 0.35) : rgb(0.85, 0.5, 0.05);
    cover.drawText(`${i + 1}.  ${label}${ref ? `  —  ${ref}` : ''}`, {
      x: MARGIN,
      y,
      size: 10.5,
      font,
      color: INK,
    });
    cover.drawText(flag, { x: PAGE_W - MARGIN - 90, y, size: 9, font: bold, color: flagColor });
    y -= 18;
  });

  // ---- One page per document ----------------------------------------------
  for (const d of ordered) {
    await drawDocPages(pdf, d, font, bold);
  }

  return pdf.save();
}

function fieldRows(d: PackageDoc): [string, string][] {
  const rows: [string, string][] = [];
  const add = (label: string, val: unknown) => {
    if (val === null || val === undefined || val === '') return;
    rows.push([label, String(val)]);
  };
  add('BOL #', d.bolNumber);
  add('PRO #', d.proNumber);
  add('PO #', d.poNumber);
  add('Shipper', d.shipper);
  add('Consignee', d.consignee);
  add('Pieces', d.pieceCount);
  add('Weight (lbs)', d.weightLbs);
  add('Ship date', d.shipDate);
  add('Delivery date', d.deliveryDate);
  add('Signed', d.signaturePresent ? `Yes${d.signedBy ? ` — ${d.signedBy}` : ''}` : 'No');
  return rows;
}

async function drawDocPages(
  pdf: PDFDocument,
  d: PackageDoc,
  font: PDFFont,
  bold: PDFFont,
) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  page.drawText((TYPE_LABEL[d.type] || d.type).toUpperCase(), {
    x: MARGIN,
    y,
    size: 13,
    font: bold,
    color: NAVY,
  });
  y -= 20;

  const rows = fieldRows(d);
  for (const [label, val] of rows) {
    page.drawText(label, { x: MARGIN, y, size: 9, font: bold, color: MUTE });
    page.drawText(val, { x: MARGIN + 110, y, size: 9.5, font, color: INK });
    y -= 15;
  }
  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.75,
    color: LINE,
  });
  y -= 16;

  if (!d.imageData) {
    page.drawText('(No image attached)', { x: MARGIN, y, size: 9, font, color: MUTE });
    return;
  }

  const parsed = dataUrlToBytes(d.imageData);
  if (!parsed) {
    page.drawText('(Attachment could not be read)', { x: MARGIN, y, size: 9, font, color: MUTE });
    return;
  }

  // A PDF the driver uploaded: copy its pages in whole.
  if (parsed.mime === 'application/pdf') {
    try {
      const src = await PDFDocument.load(parsed.bytes);
      const copied = await pdf.copyPages(src, src.getPageIndices());
      copied.forEach((p) => pdf.addPage(p));
      page.drawText('(Original PDF pages follow)', { x: MARGIN, y, size: 9, font, color: MUTE });
      return;
    } catch {
      page.drawText('(Could not embed the uploaded PDF)', { x: MARGIN, y, size: 9, font, color: MUTE });
      return;
    }
  }

  // Otherwise embed the image, scaled to fit the remaining space.
  try {
    const img = parsed.mime.includes('png')
      ? await pdf.embedPng(parsed.bytes)
      : await pdf.embedJpg(parsed.bytes);
    const availW = PAGE_W - MARGIN * 2;
    const availH = y - MARGIN;
    const scale = Math.min(availW / img.width, availH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
  } catch {
    page.drawText('(Image format not supported for embedding)', {
      x: MARGIN,
      y,
      size: 9,
      font,
      color: MUTE,
    });
  }
}
