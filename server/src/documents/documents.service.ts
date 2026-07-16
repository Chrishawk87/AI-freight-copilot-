import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { OcrService } from './ocr.service';
import { UsageService } from '../usage/usage.service';
import { MailService } from '../mail/mail.service';
import { decryptSecret } from '../common/secret';
import { buildJobPackagePdf } from './job-package';

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
    private readonly mail: MailService,
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

  /**
   * Group every document under the "job" it belongs to (its booked load).
   * Documents not tied to a load fall into a single "Unassigned" job so
   * nothing gets lost. This powers the per-job package view.
   */
  async jobs(user: AuthUser) {
    const docs = await this.prisma.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: this.listSelect,
    });

    const loadIds = [
      ...new Set(docs.map((d) => d.loadId).filter((x): x is string => !!x)),
    ];
    const loads = loadIds.length
      ? await this.prisma.load.findMany({ where: { id: { in: loadIds } } })
      : [];
    const loadMap = new Map(loads.map((l) => [l.id, l]));

    const groups = new Map<string, any>();
    for (const d of docs) {
      const key = d.loadId || 'unassigned';
      if (!groups.has(key)) {
        const load = d.loadId ? loadMap.get(d.loadId) : null;
        groups.set(key, {
          jobId: key,
          loadId: d.loadId,
          bookingId: d.bookingId,
          title: load
            ? `${load.externalId ?? load.id.slice(0, 6)} · ${load.originCity}, ${load.originState} → ${load.destCity}, ${load.destState}`
            : 'Unassigned documents',
          broker: load?.broker ?? null,
          rate: load?.rate ?? null,
          docs: [] as any[],
        });
      }
      groups.get(key).docs.push(this.serialize(d));
    }

    const list = [...groups.values()].map((g) => ({
      jobId: g.jobId,
      loadId: g.loadId,
      bookingId: g.bookingId,
      title: g.title,
      broker: g.broker,
      rate: g.rate,
      docCount: g.docs.length,
      completeCount: g.docs.filter((x: any) => x.status === 'complete').length,
      needsReview: g.docs.some((x: any) => x.status === 'needs_review'),
      types: [...new Set(g.docs.map((x: any) => x.type))],
      latestAt: g.docs[0]?.createdAt ?? null,
      docs: g.docs,
    }));

    // Real jobs first (newest activity), unassigned bucket last.
    list.sort((a, b) => {
      if (a.jobId === 'unassigned') return 1;
      if (b.jobId === 'unassigned') return -1;
      return String(b.latestAt).localeCompare(String(a.latestAt));
    });
    return list;
  }

  /**
   * Gather one job's documents + load + carrier and render the combined PDF.
   * Shared by the download and the email flows.
   */
  private async buildPackage(user: AuthUser, jobId: string, docIds?: string[]) {
    const where: any =
      jobId === 'unassigned'
        ? { userId: user.id, loadId: null }
        : { userId: user.id, loadId: jobId };
    // Optional per-document selection: only include the chosen docs.
    if (docIds && docIds.length) where.id = { in: docIds };

    const docs = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    if (!docs.length) throw new NotFoundException('No documents for this job');

    let load: any = null;
    if (jobId !== 'unassigned') {
      load = await this.prisma.load.findUnique({ where: { id: jobId } });
    }

    let carrier: { companyName: string; contactEmail: string } | null = null;
    if (user.carrierId) {
      carrier = (await this.prisma.carrier.findUnique({
        where: { id: user.carrierId },
        select: { companyName: true, contactEmail: true },
      })) as { companyName: string; contactEmail: string } | null;
    }

    const bytes = await buildJobPackagePdf({
      load,
      docs,
      carrierName: carrier?.companyName ?? null,
    });
    const ref = load ? (load.externalId ?? load.id.slice(0, 6)) : 'documents';
    return {
      bytes,
      filename: `job-${String(ref).replace(/[^a-z0-9-_]+/gi, '-')}.pdf`,
      docCount: docs.length,
      docs,
      load,
      carrier,
    };
  }

  /** Human-readable list of the documents in a package, for email bodies. */
  private docSummary(docs: { type: string; bolNumber: string }[]): string {
    const label: Record<string, string> = {
      BOL: 'BOL',
      POD: 'POD',
      LUMPER: 'Lumper receipt',
      FUEL: 'Fuel receipt',
      OTHER: 'Document',
    };
    return docs
      .map((d) => {
        const name = label[d.type] || d.type;
        return d.bolNumber ? `${name} #${d.bolNumber}` : name;
      })
      .join(', ');
  }

  /**
   * Combine every document under one job into a single downloadable PDF.
   * Returned as a data URL so the frontend can save or attach it as one file.
   */
  async jobPackage(user: AuthUser, jobId: string, docIds?: string[]) {
    const { bytes, filename, docCount } = await this.buildPackage(
      user,
      jobId,
      docIds,
    );
    const base64 = Buffer.from(bytes).toString('base64');
    return {
      filename,
      dataUrl: `data:application/pdf;base64,${base64}`,
      docCount,
    };
  }

  /**
   * Email a job's combined package as one PDF using the CARRIER's OWN email
   * account (the SMTP provider they connected in their Profile). Reply-to and
   * From are the carrier's address, so replies land back in their inbox.
   */
  async emailJobPackage(
    user: AuthUser,
    jobId: string,
    body: { to: string; subject?: string; message?: string; docIds?: string[] },
  ) {
    const to = (body.to || '').trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      throw new BadRequestException('Please enter a valid recipient email.');
    }
    if (!user.carrierId) {
      throw new BadRequestException('No carrier profile on this account.');
    }

    const carrier = (await this.prisma.carrier.findUnique({
      where: { id: user.carrierId },
      select: {
        companyName: true,
        contactEmail: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
      },
    })) as {
      companyName: string;
      contactEmail: string;
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      smtpUser: string;
      smtpPass: string;
    } | null;

    const cfg = {
      host: carrier?.smtpHost || '',
      port: carrier?.smtpPort || 587,
      secure: !!carrier?.smtpSecure,
      user: carrier?.smtpUser || carrier?.contactEmail || '',
      pass: decryptSecret(carrier?.smtpPass || ''),
      from: carrier?.contactEmail || carrier?.smtpUser || '',
    };
    if (!this.mail.configured(cfg)) {
      throw new BadRequestException(
        'Connect your email first — open Profile and add your email address and app password under "Send email".',
      );
    }

    const { bytes, filename, load, docs } = await this.buildPackage(
      user,
      jobId,
      body.docIds,
    );
    const jobRef = load
      ? `${load.externalId ?? load.id.slice(0, 6)} · ${load.originCity} → ${load.destCity}`
      : 'documents';
    const subject = body.subject?.trim() || `Documents — ${jobRef}`;
    const summary = this.docSummary(docs);
    const single = docs.length === 1;
    const text =
      (body.message?.trim() ? `${body.message.trim()}\n\n` : '') +
      (single
        ? `Attached is the ${summary} for ${jobRef}.`
        : `Attached is the document package for ${jobRef} (${docs.length} documents).`) +
      (summary ? `\n\nIncluded: ${summary}.` : '') +
      (carrier?.companyName ? `\n\n${carrier.companyName}` : '') +
      `\n\nSent via AI Freight Co-Pilot.`;

    const result = await this.mail.send(cfg, {
      to,
      replyTo: cfg.from || undefined,
      subject,
      text,
      attachments: [
        { filename, content: Buffer.from(bytes), contentType: 'application/pdf' },
      ],
    });
    if (!result.sent) {
      throw new BadRequestException(result.reason || 'The email could not be sent.');
    }
    return { sent: true, to, filename };
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
