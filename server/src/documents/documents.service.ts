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
import { EmailOauthService } from '../carrier/email-oauth.service';
import { decryptSecret } from '../common/secret';
import { buildJobPackagePdf } from './job-package';
import { estimateStateMiles } from './tender-distance';

// What each document type needs before it's "complete" enough to invoice / file.
const REQUIRED: Record<string, string[]> = {
  BOL: ['bolNumber', 'shipper', 'consignee', 'weightLbs'],
  POD: ['bolNumber', 'consignee', 'signaturePresent', 'deliveryDate'],
  LUMPER: ['poNumber'],
  FUEL: [],
  OTHER: [],
  // A Rate Con isn't "signed off" like a dock doc — it's confirmed into a load.
  // Completeness is driven by the confirm step, not the missing-field check.
  RATECON: [],
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
    private readonly oauth: EmailOauthService,
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
    // Rate Con fields
    rateConNumber: true,
    lineHaulRate: true,
    fuelSurcharge: true,
    accessorials: true,
    totalRate: true,
    originCity: true,
    originState: true,
    pickupAddress: true,
    pickupAppt: true,
    destCity: true,
    destState: true,
    deliveryAddress: true,
    deliveryAppt: true,
    commodity: true,
    equipmentType: true,
    brokerName: true,
    brokerContactName: true,
    brokerPhone: true,
    brokerEmail: true,
    referenceNumber: true,
    specialInstructions: true,
    loadStaged: true,
    loadConfirmed: true,
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

    // Rate Con is a different animal: it STARTS a haul rather than proving one.
    // Parse it, stage it, and let the driver confirm into a real load.
    if (type === 'RATECON') {
      return this.scanRateCon(user, body);
    }

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

  /**
   * Parse a Rate Confirmation and STAGE it — no load is created yet. The driver
   * reviews the extracted terms and taps Confirm (see confirmRateConLoad),
   * which is what actually commits them to the haul. We never auto-commit off an
   * OCR read because a Rate Con is a binding contract.
   */
  private async scanRateCon(
    user: AuthUser,
    body: { type?: string; imageData?: string; ocrKey?: string },
  ) {
    const byok = !!body.ocrKey?.trim();
    const allowCompanyKey =
      byok || (await this.usage.withinCap('ocr_scan', user.id, user.carrierId));

    const rc = await this.ocr.extractRateCon(
      body.imageData,
      {},
      { allowCompanyKey, clientKey: body.ocrKey },
    );

    const billable = !byok && rc.provider !== 'simulated';
    await this.usage.record({
      kind: 'ocr_scan',
      provider: byok ? 'byok' : rc.provider,
      billable,
      userId: user.id,
      carrierId: user.carrierId,
    });

    const doc = await this.prisma.document.create({
      data: {
        type: 'RATECON',
        status: 'needs_review', // "review then confirm"
        imageData: body.imageData ?? null,
        // Reuse the shared columns where they map cleanly.
        poNumber: rc.poNumber,
        weightLbs: rc.weightLbs,
        pieceCount: rc.pieceCount,
        // Rate Con specifics.
        rateConNumber: rc.rateConNumber,
        lineHaulRate: rc.lineHaulRate,
        fuelSurcharge: rc.fuelSurcharge,
        accessorials: JSON.stringify(rc.accessorials ?? []),
        totalRate: rc.totalRate,
        originCity: rc.originCity,
        originState: rc.originState,
        pickupAddress: rc.pickupAddress,
        pickupAppt: rc.pickupAppt,
        destCity: rc.destCity,
        destState: rc.destState,
        deliveryAddress: rc.deliveryAddress,
        deliveryAppt: rc.deliveryAppt,
        commodity: rc.commodity,
        equipmentType: rc.equipmentType,
        brokerName: rc.brokerName,
        brokerContactName: rc.brokerContactName,
        brokerPhone: rc.brokerPhone,
        brokerEmail: rc.brokerEmail,
        referenceNumber: rc.referenceNumber,
        specialInstructions: rc.specialInstructions,
        loadStaged: true,
        loadConfirmed: false,
        missingFields: JSON.stringify([]),
        extractedRaw: JSON.stringify(rc.raw ?? {}),
        ocrProvider: rc.provider,
        confidence: rc.confidence,
        userId: user.id,
        carrierId: user.carrierId ?? null,
      },
      select: this.listSelect,
    });

    return this.serialize(doc);
  }

  /**
   * The driver confirms a staged Rate Con. THIS is where the haul becomes real:
   * we synthesize a Load from the parsed terms and book it to the carrier, then
   * link the document. Navigation, earnings and the later BOL/POD package all
   * hang off this load.
   */
  async confirmRateConLoad(user: AuthUser, id: string) {
    if (!user.carrierId) {
      throw new BadRequestException('No carrier profile on this account.');
    }
    const doc = await this.prisma.document.findFirst({
      where: { id, userId: user.id },
    });
    if (!doc) throw new NotFoundException('Rate Con not found');
    if (doc.type !== 'RATECON') {
      throw new BadRequestException('This document is not a Rate Con.');
    }
    if (doc.loadConfirmed && doc.loadId) {
      // Already confirmed — return the current state instead of double-booking.
      return this.getOne(user, id);
    }

    const rate =
      doc.totalRate ?? (doc.lineHaulRate ?? 0) + (doc.fuelSurcharge ?? 0);

    // A synthetic, collision-safe external id for a carrier-originated load.
    const base = (doc.rateConNumber || doc.referenceNumber || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 16);
    let externalId = `RC-${base || doc.id.slice(0, 8)}`;
    if (await this.prisma.load.findUnique({ where: { externalId } })) {
      externalId = `${externalId}-${doc.id.slice(0, 4)}`;
    }

    const load = await this.prisma.load.create({
      data: {
        externalId,
        equipment: doc.equipmentType || 'Van',
        originCity: doc.originCity || '',
        originState: doc.originState || '',
        destCity: doc.destCity || '',
        destState: doc.destState || '',
        miles: 0, // unknown from the Rate Con; filled once routed
        deadheadMiles: 0,
        rate: rate || 0,
        weightLbs: doc.weightLbs ?? 0,
        broker: doc.brokerName || 'Broker',
        brokerRating: 0,
        pickupDate: (doc.pickupAppt || '').slice(0, 10),
        source: 'RateCon',
        demandIndex: 0,
        reloadIndex: 0,
      },
    });

    const booking = await this.prisma.booking.create({
      data: {
        loadId: load.id,
        userId: user.id,
        carrierId: user.carrierId,
        status: 'booked',
      },
    });

    const updated = await this.prisma.document.update({
      // Owner-scoped write: id is unique, userId re-asserts ownership on the
      // write itself (Prisma throws if the pair matches no row).
      where: { id, userId: user.id },
      data: {
        loadId: load.id,
        bookingId: booking.id,
        loadConfirmed: true,
        status: 'complete',
      },
      select: this.listSelect,
    });

    return {
      doc: this.serialize(updated),
      load: {
        id: load.id,
        externalId: load.externalId,
        originCity: load.originCity,
        originState: load.originState,
        destCity: load.destCity,
        destState: load.destState,
        rate: load.rate,
        broker: load.broker,
      },
    };
  }

  /**
   * SIA-INDEPENDENT REAL FREIGHT PATH.
   *
   * Brokers tender loads to carriers directly all day — by email, text, or a PDF
   * offer sheet — long before any Rate Con is signed. Those tenders are REAL
   * freight the carrier can actually haul, and none of it requires a signed
   * load-board Systems Integration Agreement. This turns one such tender into a
   * live, scored opportunity in the same feed the boards feed into.
   *
   * The distinction from a Rate Con is intent, not format:
   *   • A Rate Con is a *commitment* → confirmRateConLoad books it (source
   *     'RateCon'), and it's excluded from the open feed.
   *   • A tender is an *offer to evaluate* → this creates an OPEN load
   *     (source 'Tender', active, unbooked) that flows straight into the
   *     Opportunity Center, gets scored by the Profitability Engine, and can be
   *     booked through the normal flow.
   *
   * We reuse the Rate Con OCR extractor (same lane/rate/broker fields), estimate
   * loaded miles from the origin/destination states so scoring is meaningful,
   * and let real routing refine mileage once the driver navigates it.
   */
  async scanTender(
    user: AuthUser,
    body: { imageData?: string; ocrKey?: string },
  ) {
    const byok = !!body.ocrKey?.trim();
    const allowCompanyKey =
      byok || (await this.usage.withinCap('ocr_scan', user.id, user.carrierId));

    const rc = await this.ocr.extractRateCon(
      body.imageData,
      {},
      { allowCompanyKey, clientKey: body.ocrKey },
    );

    const billable = !byok && rc.provider !== 'simulated';
    await this.usage.record({
      kind: 'ocr_scan',
      provider: byok ? 'byok' : rc.provider,
      billable,
      userId: user.id,
      carrierId: user.carrierId,
    });

    const rate =
      rc.totalRate ?? (rc.lineHaulRate ?? 0) + (rc.fuelSurcharge ?? 0);
    if (!rate || rate <= 0) {
      throw new BadRequestException(
        "Couldn't read a rate off this tender. Add the total rate and try again.",
      );
    }

    // Estimate loaded miles so the Profitability Engine can score it honestly.
    // Real turn-by-turn mileage replaces this the moment the driver routes it.
    const miles = estimateStateMiles(rc.originState, rc.destState);

    // Collision-safe external id for a broker-tendered open load.
    const base = (rc.rateConNumber || rc.referenceNumber || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 16);
    let externalId = `TDR-${base || Math.random().toString(36).slice(2, 10)}`;
    if (await this.prisma.load.findUnique({ where: { externalId } })) {
      externalId = `${externalId}-${Math.random().toString(36).slice(2, 6)}`;
    }

    // Derive the same market signal the board loads carry: rate-per-mile vs a
    // healthy baseline. reloadIndex starts neutral and the learning loop
    // calibrates it per carrier — identical to how the live boards behave.
    const demandIndex =
      miles > 0
        ? Math.max(0, Math.min(100, Math.round(((rate / miles - 1.0) / 2.0) * 100)))
        : 0;

    const load = await this.prisma.load.create({
      data: {
        externalId,
        equipment: rc.equipmentType || 'Van',
        originCity: rc.originCity || '',
        originState: rc.originState || '',
        destCity: rc.destCity || '',
        destState: rc.destState || '',
        miles,
        deadheadMiles: 0,
        rate,
        weightLbs: rc.weightLbs ?? 0,
        broker: rc.brokerName || 'Broker (tender)',
        brokerRating: 0,
        pickupDate: (rc.pickupAppt || '').slice(0, 10),
        source: 'Tender',
        demandIndex,
        reloadIndex: 50,
        active: true,
      },
    });

    return {
      load: {
        id: load.id,
        externalId: load.externalId,
        equipment: load.equipment,
        originCity: load.originCity,
        originState: load.originState,
        destCity: load.destCity,
        destState: load.destState,
        miles: load.miles,
        milesEstimated: miles > 0,
        rate: load.rate,
        broker: load.broker,
        source: load.source,
      },
      ocrProvider: rc.provider,
      confidence: rc.confidence,
    };
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
        dotNumber: true,
        mcNumber: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpPass: true,
        emailOauthProvider: true,
        emailOauthEmail: true,
        emailOauthRefresh: true,
      },
    })) as {
      companyName: string;
      contactEmail: string;
      dotNumber: string;
      mcNumber: string;
      smtpHost: string;
      smtpPort: number;
      smtpSecure: boolean;
      smtpUser: string;
      smtpPass: string;
      emailOauthProvider: string;
      emailOauthEmail: string;
      emailOauthRefresh: string;
    } | null;

    // The carrier's own reply address — where a broker's reply should land.
    const oauthProvider = carrier?.emailOauthProvider || '';
    const carrierReply =
      carrier?.contactEmail || carrier?.emailOauthEmail || carrier?.smtpUser || '';

    const { bytes, filename, load, docs } = await this.buildPackage(
      user,
      jobId,
      body.docIds,
    );
    const jobRef = load
      ? `${load.externalId ?? load.id.slice(0, 6)} · ${load.originCity} → ${load.destCity}`
      : 'documents';

    // Carrier identity. Thousands of carriers share ONE sending domain
    // (originmanagementsolutions.com), so the recipient must be able to tell
    // instantly which carrier a package is from. We surface it two ways:
    //   • the subject line — company name + the driver/operator who sent it
    //   • a signature block in the body — company, driver, USDOT/MC, reply-to
    const companyName = (carrier?.companyName || '').trim();
    const driverName = (user.name || '').trim();
    const dot = (carrier?.dotNumber || '').trim();
    const mc = (carrier?.mcNumber || '').trim();

    // Default subject clearly names the carrier (and driver). A user-supplied
    // subject is still honored as-is.
    const subjectWho = [companyName, driverName && `(${driverName})`]
      .filter(Boolean)
      .join(' ');
    const subject =
      body.subject?.trim() ||
      (subjectWho ? `${subjectWho} — ${jobRef}` : `Documents — ${jobRef}`);

    const summary = this.docSummary(docs);
    const single = docs.length === 1;

    // Always-appended signature so identity survives even a custom subject.
    const idLine = [
      dot && `USDOT ${dot}`,
      mc && (/^mc/i.test(mc) ? mc : `MC ${mc}`),
    ]
      .filter(Boolean)
      .join('  ·  ');
    const sigLines = [
      companyName,
      driverName && `Driver: ${driverName}`,
      idLine,
      carrierReply && `Reply to: ${carrierReply}`,
    ].filter(Boolean);
    const signature = sigLines.length ? `\n\n—\n${sigLines.join('\n')}` : '';

    const text =
      (body.message?.trim() ? `${body.message.trim()}\n\n` : '') +
      (single
        ? `Attached is the ${summary} for ${jobRef}.`
        : `Attached is the document package for ${jobRef} (${docs.length} documents).`) +
      (summary ? `\n\nIncluded: ${summary}.` : '') +
      signature +
      `\n\nSent via AI Freight Co-Pilot.`;

    const attachments = [
      { filename, content: Buffer.from(bytes), contentType: 'application/pdf' },
    ];

    // Sending preference, most-preferred first:
    //   1. OAuth ("Connect Gmail/Outlook") — sends FROM the carrier's own
    //      mailbox via the provider API. The scalable one-click path.
    //   2. Per-carrier SMTP (app password) — advanced fallback.
    //   3. Shared platform relay — works out of the box; carrier's address is
    //      set as reply-to so broker replies land with them, not us.
    if (oauthProvider === 'google' || oauthProvider === 'microsoft') {
      const fromEmail = carrier?.emailOauthEmail || carrierReply;
      let accessToken: string;
      try {
        accessToken = await this.oauth.accessTokenFromRefresh(
          oauthProvider,
          decryptSecret(carrier?.emailOauthRefresh || ''),
        );
      } catch {
        throw new BadRequestException(
          'Your connected inbox lost authorization. Reconnect it in Profile \u2192 Send email.',
        );
      }
      const result = await this.mail.sendOauth(oauthProvider, accessToken, fromEmail, {
        to,
        replyTo: carrierReply && carrierReply !== fromEmail ? carrierReply : undefined,
        subject,
        text,
        attachments,
      });
      if (!result.sent) {
        throw new BadRequestException(result.reason || 'The email could not be sent.');
      }
      return { sent: true, to, filename };
    }

    const label = (carrier?.companyName
      ? `${carrier.companyName} via AI Freight Co-Pilot`
      : 'AI Freight Co-Pilot'
    ).replace(/"/g, '');

    // No OAuth. Prefer the Resend HTTPS relay next — it works on hosts that
    // BLOCK outbound SMTP (e.g. Railway), whereas any SMTP attempt (the
    // carrier's own app password OR our SMTP relay) would just time out there.
    // So a working HTTPS relay always wins over a doomed SMTP connection; the
    // carrier's address rides along as reply-to.
    if (this.mail.resendAvailable()) {
      const from = `${label} <${this.mail.platformFromAddress()}>`;
      const result = await this.mail.sendResend(from, {
        to,
        replyTo: carrierReply || undefined,
        subject,
        text,
        attachments,
      });
      if (!result.sent) {
        throw new BadRequestException(result.reason || 'The email could not be sent.');
      }
      return { sent: true, to, filename };
    }

    // No HTTPS relay configured — try the carrier's own SMTP (app password).
    const byok = {
      host: carrier?.smtpHost || '',
      port: carrier?.smtpPort || 587,
      secure: !!carrier?.smtpSecure,
      user: carrier?.smtpUser || carrier?.contactEmail || '',
      pass: decryptSecret(carrier?.smtpPass || ''),
      from: carrierReply,
    };
    if (this.mail.configured(byok)) {
      const result = await this.mail.send(byok, {
        to,
        replyTo: carrierReply || undefined,
        subject,
        text,
        attachments,
      });
      if (!result.sent) {
        throw new BadRequestException(result.reason || 'The email could not be sent.');
      }
      return { sent: true, to, filename };
    }

    const platform = this.mail.platformConfig();
    if (!platform) {
      throw new BadRequestException(
        "Email sending isn't set up yet. Either connect your own inbox in Profile \u2192 Send email, or (admin) configure the platform mail account.",
      );
    }
    // Send from the platform address but present the carrier's name; set
    // reply-to so responses go to the carrier, not us.
    const result = await this.mail.send(
      { ...platform, from: `"${label}" <${platform.from}>` },
      {
        to,
        replyTo: carrierReply || undefined,
        subject,
        text,
        attachments,
      },
    );
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
      // Rate Con fields the driver can correct before confirming into a load.
      'rateConNumber',
      'lineHaulRate',
      'fuelSurcharge',
      'totalRate',
      'originCity',
      'originState',
      'pickupAddress',
      'pickupAppt',
      'destCity',
      'destState',
      'deliveryAddress',
      'deliveryAppt',
      'commodity',
      'equipmentType',
      'brokerName',
      'brokerContactName',
      'brokerPhone',
      'brokerEmail',
      'referenceNumber',
      'specialInstructions',
    ]) {
      if (k in patch) data[k] = patch[k];
    }
    if ('accessorials' in patch) {
      data.accessorials = JSON.stringify(patch.accessorials ?? []);
    }
    data.missingFields = JSON.stringify(missing);
    data.status = missing.length ? 'needs_review' : 'complete';

    const doc = await this.prisma.document.update({
      where: { id, userId: user.id }, // owner-scoped write
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
      where: { id, userId: user.id }, // owner-scoped write
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
    let accessorials: { name: string; amount: number }[] = [];
    if ('accessorials' in doc) {
      try {
        accessorials = JSON.parse(doc.accessorials || '[]');
      } catch {
        accessorials = [];
      }
    }
    return {
      ...doc,
      ...('accessorials' in doc ? { accessorials } : {}),
      missingFields: missing,
      missingLabels: missing.map((m) => FIELD_LABEL[m] || m),
    };
  }
}
