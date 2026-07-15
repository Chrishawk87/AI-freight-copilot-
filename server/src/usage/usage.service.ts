import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type UsageKind = 'ocr_scan' | 'copilot_llm';

export interface UsageEventInput {
  kind: UsageKind;
  provider?: string;
  billable?: boolean;
  units?: number;
  userId: string;
  carrierId?: string | null;
}

interface MeterLine {
  used: number;
  cap: number | null; // null = unlimited
  remaining: number | null;
  overCap: boolean;
}

/**
 * Per-tenant AI usage metering.
 *
 * Everything the company pays for on a shared provider account (OCR scans on the
 * company Mindee key, Co-Pilot replies on the company Anthropic key) is recorded
 * here as a billable event. Calls a driver covers with their OWN key, or that
 * fell back to the free simulated engine, are recorded billable=false so they
 * never count against cost or caps. Monthly caps (env-driven) let the company
 * protect the shared account from one heavy user running up the bill.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  private caps(): Record<UsageKind, number> {
    // 0 (or unset) means unlimited.
    return {
      ocr_scan: Number(process.env.USAGE_OCR_MONTHLY_CAP || 0),
      copilot_llm: Number(process.env.USAGE_LLM_MONTHLY_CAP || 0),
    };
  }

  private monthStart(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  /** Fire-and-forget: metering must never break the underlying feature. */
  async record(e: UsageEventInput): Promise<void> {
    try {
      await this.prisma.usageEvent.create({
        data: {
          kind: e.kind,
          provider: e.provider || '',
          billable: e.billable ?? true,
          units: e.units ?? 1,
          userId: e.userId,
          carrierId: e.carrierId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`usage record failed (ignored): ${err}`);
    }
  }

  /** Billable units this calendar month, scoped to the carrier (or user if solo). */
  async billableThisMonth(
    kind: UsageKind,
    userId: string,
    carrierId?: string | null,
  ): Promise<number> {
    try {
      const where: any = {
        kind,
        billable: true,
        createdAt: { gte: this.monthStart() },
      };
      if (carrierId) where.carrierId = carrierId;
      else where.userId = userId;
      const agg = await this.prisma.usageEvent.aggregate({
        _sum: { units: true },
        where,
      });
      return agg._sum.units || 0;
    } catch {
      return 0;
    }
  }

  /** True if there's headroom left under the monthly cap for a company-paid call. */
  async withinCap(
    kind: UsageKind,
    userId: string,
    carrierId?: string | null,
  ): Promise<boolean> {
    const cap = this.caps()[kind] || 0;
    if (!cap) return true; // unlimited
    const used = await this.billableThisMonth(kind, userId, carrierId);
    return used < cap;
  }

  /** Dashboard summary for the current tenant. */
  async summary(userId: string, carrierId?: string | null) {
    const caps = this.caps();
    const [ocr, llm] = await Promise.all([
      this.billableThisMonth('ocr_scan', userId, carrierId),
      this.billableThisMonth('copilot_llm', userId, carrierId),
    ]);
    const line = (used: number, cap: number): MeterLine => ({
      used,
      cap: cap || null,
      remaining: cap ? Math.max(0, cap - used) : null,
      overCap: cap ? used >= cap : false,
    });
    return {
      periodStart: this.monthStart().toISOString(),
      scope: carrierId ? 'carrier' : 'user',
      ocr: line(ocr, caps.ocr_scan),
      copilot: line(llm, caps.copilot_llm),
    };
  }
}
