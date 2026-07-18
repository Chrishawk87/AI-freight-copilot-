import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scoreLoad, ScoredLoad } from '../scoring/scoring';
import { FuelIntelService } from '../truckmap/fuel/fuel-intel.service';
import { FuelPricesService } from '../fuel/fuel-prices';
import { AuthUser } from '../auth/current-user.decorator';
import { LearningService } from '../learning/learning.service';
import { applyLearning } from '../learning/learning';

// The Daily Profit Plan — the product's headline decision. Instead of making the
// driver browse a load board, the AI assembles ONE recommended play for the day
// from the pieces the platform already computes: the best-scored load from the
// current location, the true cost/profit model, the cheapest truck-legal diesel
// nearby, and the reload outlook at the destination. Output is a structured plan
// the Command Center renders and the Co-Pilot can read aloud.

export type PlanFuelStop = {
  poiId: string;
  name: string;
  brand: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lon: number;
  priceEff: number;
  savingsPerGal: number;
  distanceMi: number;
};

export type DailyPlan = {
  generatedAt: string;
  hasPlan: boolean; // false when there are no bookable loads to plan around
  dieselPrice: number; // live national diesel used in the math
  revenueGoal: number;
  recommendedLoad: ScoredLoad | null;
  expectedFuelCost: number;
  expectedNetProfit: number;
  fuelStop: PlanFuelStop | null;
  reloadProbability: number; // 0..100
  bestReload: ScoredLoad | null;
  expectedEndOfDayRevenue: number;
  headline: string;
  steps: string[];
};

@Injectable()
export class DailyPlanService {
  private readonly logger = new Logger('DailyPlan');

  constructor(
    private readonly prisma: PrismaService,
    private readonly fuelIntel: FuelIntelService,
    private readonly eia: FuelPricesService,
    private readonly learning: LearningService,
  ) {}

  private costOpts(user: AuthUser, diesel: number) {
    const c = user.carrier;
    return {
      mpg: c?.mpg ?? 6.5,
      fixedCostPerMile: c?.fixedCostPerMile ?? 0.72,
      diesel,
    };
  }

  // A realistic daily revenue target: the carrier's recent daily average (from
  // the last 7 days of bookings) with a sensible floor so a brand-new carrier
  // still gets a goal to aim at.
  private async revenueGoal(user: AuthUser): Promise<number> {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const recent = await this.prisma.booking.findMany({
      where: { userId: user.id, bookedAt: { gte: since } },
      include: { load: true },
    });
    if (recent.length) {
      const revenue = recent.reduce((s, b) => s + (b.load?.rate ?? 0), 0);
      const perDay = revenue / 7;
      return Math.max(1200, Math.round(perDay / 50) * 50);
    }
    return 1200;
  }

  async build(
    user: AuthUser,
    loc?: { lat?: number; lon?: number },
  ): Promise<DailyPlan> {
    const diesel = await this.eia.national().catch(() => 3.95);
    const opts = this.costOpts(user, diesel);
    const revenueGoal = await this.revenueGoal(user);

    // The carrier's learned preferences — sharpens which load leads the plan.
    const profile = await this.learning.profile(user);

    // Best bookable load right now (open board, excludes the carrier's own
    // Rate Con freight and reload-pool rows). Ranked with the learning loop, so
    // a broker/lane/equipment this carrier actually runs floats to the top.
    const openLoads = await this.prisma.load.findMany({
      where: { isReloadPool: false, active: true, source: { not: 'RateCon' } },
    });
    const scored = openLoads
      .map((l) => applyLearning(scoreLoad(l, opts), profile))
      .sort((a, b) => b.overall - a.overall);
    const recommendedLoad = scored[0] ?? null;

    if (!recommendedLoad) {
      return {
        generatedAt: new Date().toISOString(),
        hasPlan: false,
        dieselPrice: round2(diesel),
        revenueGoal,
        recommendedLoad: null,
        expectedFuelCost: 0,
        expectedNetProfit: 0,
        fuelStop: null,
        reloadProbability: 0,
        bestReload: null,
        expectedEndOfDayRevenue: 0,
        headline: 'No open loads to plan around right now.',
        steps: [
          'No bookable loads are on the board at the moment.',
          'Connect a load board or bring in a Rate Con and your plan will build automatically.',
        ],
      };
    }

    // Cheapest truck-legal diesel near the driver (falls back to the load's
    // origin region if we have no GPS). Empty when no POIs are ingested here yet.
    const fuelStop = await this.pickFuelStop(loc);

    // Reload outlook at the destination: the load's own reload index, plus the
    // best reload-pool option we can surface.
    const reloadProbability = clampPct(recommendedLoad.reloadIndex);
    const reloads = await this.prisma.load.findMany({
      where: { isReloadPool: true },
    });
    const bestReload =
      reloads
        .map((l) => applyLearning(scoreLoad(l, opts), profile))
        .sort((a, b) => b.overall - a.overall)[0] ?? null;

    // Expected end-of-day revenue = today's load + a probability-weighted reload.
    const reloadContribution = bestReload
      ? bestReload.rate * (reloadProbability / 100)
      : 0;
    const expectedEndOfDayRevenue = Math.round(
      recommendedLoad.rate + reloadContribution,
    );

    const steps = this.narrate(recommendedLoad, fuelStop, bestReload, reloadProbability);
    // If the learning loop tipped this pick, tell the driver why in plain terms.
    if (recommendedLoad.learnedReasons?.length) {
      steps.push(
        `Why this one for you: it's ${recommendedLoad.learnedReasons.join(', ')} — based on the loads you've actually booked.`,
      );
    }
    const headline = `Best move today: ${recommendedLoad.equipment} ${recommendedLoad.originCity}, ${recommendedLoad.originState} → ${recommendedLoad.destCity}, ${recommendedLoad.destState} — about $${Math.round(recommendedLoad.netProfit).toLocaleString()} net.`;

    return {
      generatedAt: new Date().toISOString(),
      hasPlan: true,
      dieselPrice: round2(diesel),
      revenueGoal,
      recommendedLoad,
      expectedFuelCost: round2(recommendedLoad.fuelCost),
      expectedNetProfit: round2(recommendedLoad.netProfit),
      fuelStop,
      reloadProbability,
      bestReload,
      expectedEndOfDayRevenue,
      headline,
      steps,
    };
  }

  private async pickFuelStop(loc?: {
    lat?: number;
    lon?: number;
  }): Promise<PlanFuelStop | null> {
    if (typeof loc?.lat !== 'number' || typeof loc?.lon !== 'number') return null;
    try {
      const [best] = await this.fuelIntel.cheapestNearby({
        lat: loc.lat,
        lon: loc.lon,
        radiusMi: 50,
        hgvOnly: true,
        limit: 1,
      });
      if (!best) return null;
      return {
        poiId: best.id,
        name: best.name,
        brand: best.brand,
        city: best.city,
        state: best.state,
        lat: best.lat,
        lon: best.lon,
        priceEff: best.priceEff,
        savingsPerGal: best.savingsPerGal,
        distanceMi: best.distanceMi,
      };
    } catch (e: any) {
      this.logger.warn(`pickFuelStop failed: ${e?.message}`);
      return null;
    }
  }

  private narrate(
    load: ScoredLoad,
    fuel: PlanFuelStop | null,
    reload: ScoredLoad | null,
    reloadPct: number,
  ): string[] {
    const steps: string[] = [];
    steps.push(
      `Take the ${load.equipment} from ${load.originCity}, ${load.originState} to ${load.destCity}, ${load.destState} — $${load.rate.toLocaleString()} at $${load.allInRpm.toFixed(2)}/mi all-in.`,
    );
    steps.push(
      `Run the numbers: ~$${Math.round(load.fuelCost).toLocaleString()} fuel, ~$${Math.round(load.netProfit).toLocaleString()} net profit on ${load.miles.toLocaleString()} loaded miles.`,
    );
    if (fuel) {
      steps.push(
        `Fuel at ${fuel.brand || fuel.name}${fuel.city ? ` (${fuel.city}, ${fuel.state})` : ''} — diesel about $${fuel.priceEff.toFixed(2)}, roughly $${fuel.savingsPerGal.toFixed(2)}/gal under the national average.`,
      );
    }
    if (reload && reloadPct >= 40) {
      steps.push(
        `Line up a reload near ${load.destCity}: ${reload.originCity}, ${reload.originState} → ${reload.destCity}, ${reload.destState} pays $${reload.rate.toLocaleString()} — about ${reloadPct}% chance you book a reload here.`,
      );
    } else {
      steps.push(
        `Reload outlook near ${load.destCity} is about ${reloadPct}% — check back on delivery for fresh options.`,
      );
    }
    return steps;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
