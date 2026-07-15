import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { OcrService } from './ocr.service';
import { UsageService } from '../usage/usage.service';

// What each document type needs before it's "complete" enough to invoice / file.
const REQUIRED: Record<string, string[]> = {
  BOL: ['bolNumber', 'shipper', 'consignee', 'weightLbs'],
  POD: ['bolNumber', 'consignee', 'signaturePresent', 'deliveryDate'],
  LUMPER: ['poNumber'],
  FUEL: [],
  OTHER: [],
};

const FIELD_LABEL: Record<string, string> = {
  bolNumber: 'BOL #',
  proNumber: 'PRO #',
  shipper: 'Shipper',
  consignee: 'Consignee',
  poNumber: 'PO #',
  pieceCount: 'Piece count',
  weightLbs: 'Weight',
  shipDate: 'Ship date',
  deliveryDate: 'Delivery date',
  signaturePresent: 'Signature',
  signedBy: 'Signed by',
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: OcrService,
    private readonly usage: UsageService,
  ) {}

  // Fields returned in list view — everything except the heavy image + raw blobs.
  private listSelect = {
    id: true,
    type: true,
    status: true,
    bolNumber: true,
    proNumber: true,
    shipper: true,
    consignee: true,
    poNumber: true,
    pieceCount: true,
    weightLbs: true,
    shipDate: true,
    deliveryDate: true,
    signaturePresent: true,
    signedBy: true,
    missingFields: true,
    ocrProvider: true,
    confidence: true,
    invoiceAmount: true,
    invoiceStatus: true,
    loadId: true,
    bookingId: true,
    createdAt: true,
  };

  private missingFor(type: string, f: any): string[] {
    const req = REQUIRED[type] || [];
    return req.filter((key) => {
      const v = f[key];
      if (key === 'signaturePresent') return !v;
      return v === '' || v == null;
    });
  }

  /** Scan + extract + auto-match + save in one shot (the dock flow). */
  async scan(
    user: AuthUser,
    body: {
      type?: string;
      imageData?: string;
      loadId?: string;
      bookingId?: string;
      ocrKey?: string;
    },
  ) {
    const type = (body.type || 'BOL').toUpperCase();

    // Resolve the load context for auto-match + smarter extraction.
    let bookingId = body.bookingId || null;
    let loadId = body.loadId || null;
    let load: any = null;

    if (bookingId) {
      const booking = await this.prisma.booking.findFirst({
        where: { id: bookingId, userId: user.id },
        include: { load: true },
      });
      if (booking) {
        load = booking.load;
        loadId = booking.loadId;
      }
    } else if (loadId) {
      load = await this.prisma.load.findFirst({
        where: { OR: [{ id: loadId }, { externalId: loadId }] },
      });
      if (load) {
        loadId = load.id;
        const booking = await this.prisma.booking.findFirst({
          where: { userId: user.id, loadId: load.id },
        });
        if (booking) bookingId = booking.id;
      }
    }

    // The driver's own key (BYOK) always spends their account. The company's
    // shared key only applies when this tenant is under its monthly cap — over
    // the cap we withhold the company key so it falls back to the free engine,
    // protecting the shared account from a runaway bill.
    const byok = !!body.ocrKey?.trim();
    const allowCompanyKey =
      byok || (await this.usage.withinCap('ocr_scan', user.id, user.carrierId));

    const fields = await this.ocr.extract(
      body.imageData,
      body.ocrKey,
      {
        type,
        load: load
          ? {
              externalId: load.externalId,
              originCity: load.originCity,
              originState: load.originState,
              destCity: load.destCity,
              destState: load.destState,
              broker: load.broker,
              weightLbs: load.weightLbs,
              pickupDate: load.pickupDate,
            }
          : null,
      },
      { allowCompanyKey },
    );

    // Meter it. Only real extraction on the COMPANY key costs the company; BYOK
    // and the simulated fallback are recorded but not billable.
    const billable = !byok && fields.provider !== 'simulated';
    await this.usage.record({
      kind: 'ocr_scan',
      provider: byok ? 'byok' : fields.provider,
      billable,
      userId: user.id,
      carrierId: user.carrierId,
    });

    const missing = this.missingFor(type, fields);

    const doc = await this.prisma.document.create({
      data: {
        type,
        status: missing.length ? 'needs_review' : 'complete',
        imageData: body.imageData ?? null,
        bolNumber: fields.bolNumber,
        proNumber: fields.proNumber,
        shipper: fields.shipper,
        consignee: fields.consignee,
        poNumber: fields.poNumber,
        pieceCount: fields.pieceCount,
        weightLbs: fields.weightLbs,
        shipDate: fields.shipDate,
        deliveryDate: fields.deliveryDate,
        signaturePresent: fields.signaturePresent,
        signedBy: fields.signedBy,
        missingFields: JSON.stringify(missing),
        extractedRaw: JSON.stringify(fields.raw ?? {}),
        ocrProvider: fields.provider,
        confidence: fields.confidence,
        userId: user.id,
        carrierId: user.carrierId ?? null,
        loadId,
        bookingId,
      },
      select: this.listSelect,
    });

    return this.serialize(doc);
  }

  async list(user: AuthUser) {
    const docs = await this.prisma.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: this.listSelect,
    });
    return docs.map((d) => this.serialize(d));
  }

  async getOne(user: AuthUser, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, userId: user.id },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.serialize(doc);
  }

  /** Driver corrects fields after review; we recompute completeness. */
  async update(
    user: AuthUser,
    id: string,
    patch: Record<string, any>,
  ) {
    const existing = await this.prisma.document.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) throw new NotFoundException('Document not found');

    const merged = { ...existing, ...patch };
    const missing = this.missingFor(merged.type, merged);

    const data: any = {};
    for (const k of [
      'type',
      'bolNumber',
      'proNumber',
      'shipper',
      'consignee',
      'poNumber',
      'pieceCount',
      'weightLbs',
      'shipDate',
      'deliveryDate',
      'signaturePresent',
      'signedBy',
    ]) {
      if (k in patch) data[k] = patch[k];
    }
    data.missingFields = JSON.stringify(missing);
    data.status = missing.length ? 'needs_review' : 'complete';

    const doc = await this.prisma.document.update({
      where: { id },
      data,
      select: this.listSelect,
    });
    return this.serialize(doc);
  }

  /** Pre-fill the invoice from the matched load's rate, ready to send. */
  async stageInvoice(user: AuthUser, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, userId: user.id },
    });
    if (!doc) throw new NotFoundException('Document not found');

    let amount = doc.invoiceAmount ?? 0;
    if (!amount && doc.loadId) {
      const load = await this.prisma.load.findUnique({ where: { id: doc.loadId } });
      if (load) amount = load.rate;
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: { invoiceAmount: amount, invoiceStatus: 'staged' },
      select: this.listSelect,
    });
    return this.serialize(updated);
  }

  private serialize(doc: any) {
    let missing: string[] = [];
    try {
      missing = JSON.parse(doc.missingFields || '[]');
    } catch {
      missing = [];
    }
    return {
      ...doc,
      missingFields: missing,
      missingLabels: missing.map((m) => FIELD_LABEL[m] || m),
    };
  }
}
