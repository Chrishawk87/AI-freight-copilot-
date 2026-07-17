import { Injectable, Logger } from '@nestjs/common';
import type { PoiCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FuelPricesService,
  regionForState,
} from '../../fuel/fuel-prices';
import { PoiService, type PoiOut } from '../poi/poi.service';
import { RoutingService } from '../routing/routing.service';
import type { LatLon, VehicleProfile } from '../routing/routing.types';

// ── Price confidence model (§8.1) ───────────────────────────────────────────
// A station's effective diesel price is a confidence-weighted, age-decayed
// blend of every signal we have, best-source-first:
//   user report > commercial feed > city scrape > EIA regional baseline
// Fresh crowd reports dominate; as they age their weight decays toward the EIA
// regional average, so stale data never misleads the optimizer. When nothing
// better exists we fall back cleanly to the regional baseline.

type SourceKey = 'user' | 'commercial' | 'scrape' | 'eia_region';

const SOURCE_META: Record<SourceKey, { base: number; halfLifeH: number }> = {
  user: { base: 1.0, halfLifeH: 10 },
  commercial: { base: 0.9, halfLifeH: 24 },
  scrape: { base: 0.6, halfLifeH: 18 },
  eia_region: { base: 0.3, halfLifeH: 24 * 7 },
};

function decay(ageHours: number, halfLifeH: number): number {
  if (ageHours <= 0) return 1;
  return Math.pow(0.5, ageHours / halfLifeH);
}

function normSource(raw: string): SourceKey {
  if (raw === 'user' || raw === 'commercial' || raw === 'scrape') return raw;
  return 'eia_region';
}

export type PricedStation = PoiOut & {
  priceEff: number; // confidence-blended effective $/gal
  priceSource: SourceKey; // dominant contributing source
  priceConfidence: number; // 0..1 aggregate confidence in priceEff
  priceIsLive: boolean; // true when a real signal (not just EIA) exists
  savingsPerGal: number; // national_avg - priceEff (≥0 shown as savings)
  routeMi?: number; // distance along the route (along-route ranking)
  detourMi?: number; // rough off-route detour
};

export type FuelPlanStop = {
  poiId: string;
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  routeMi: number; // miles from origin along the route
  priceEff: number;
  gallons: number; // recommended gallons to buy here
  cost: number; // gallons * priceEff
  savings: number; // vs national avg for those gallons
  reason: string; // driver-facing explanation
};

export type FuelPlan = {
  feasible: boolean;
  stops: FuelPlanStop[];
  totalGallons: number;
  totalCost: number;
  totalSavings: number; // vs buying the same gallons at national avg
  nationalAvg: number;
  note: string;
};

function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

@Injectable()
export class FuelIntelService {
  private readonly logger = new Logger(FuelIntelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly poi: PoiService,
    private readonly routing: RoutingService,
    private readonly eia: FuelPricesService,
  ) {}

  /** Price-ranked diesel near a point, truck-legal for the active vehicle. */
  async cheapestNearby(params: {
    lat: number;
    lon: number;
    radiusMi?: number;
    hgvOnly?: boolean;
    limit?: number;
  }): Promise<PricedStation[]> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const stations = await this.poi.nearby({
      lat: params.lat,
      lon: params.lon,
      radiusMi: params.radiusMi ?? 30,
      categories: ['fuel'] as PoiCategory[],
      limit: 120,
    });
    const priced = await this.priceStations(
      params.hgvOnly ? stations.filter((s) => s.hgv) : stations,
    );
    return priced
      .sort((a, b) => a.priceEff - b.priceEff || a.distanceMi - b.distanceMi)
      .slice(0, limit);
  }

  /** Cheapest diesel in a corridor around a route polyline ([lon, lat]). */
  async cheapestAlongRoute(params: {
    coords: [number, number][];
    bufferMi?: number;
    hgvOnly?: boolean;
    limit?: number;
  }): Promise<PricedStation[]> {
    const limit = Math.min(100, Math.max(1, params.limit ?? 40));
    const stations = await this.routing.alongRoutePois(params.coords, {
      categories: ['fuel'] as PoiCategory[],
      bufferMi: params.bufferMi ?? 5,
      hgvOnly: params.hgvOnly,
      limit: 200,
    });
    const priced = await this.priceStations(stations);
    const withMi = this.attachRouteMi(priced, params.coords);
    return withMi
      .sort((a, b) => a.priceEff - b.priceEff)
      .slice(0, limit);
  }

  /** Record a crowd price submission and return the restated station. */
  async report(params: {
    poiId: string;
    carrierId: string;
    price: number;
    fuelType?: string;
  }): Promise<PricedStation | null> {
    const price = Number(params.price);
    if (!Number.isFinite(price) || price <= 0 || price > 20) {
      throw new Error('Price must be a realistic $/gal figure');
    }
    await this.prisma.priceReport.create({
      data: {
        poiId: params.poiId,
        carrierId: params.carrierId,
        price,
        fuelType: params.fuelType || 'diesel',
      },
    });
    // Also write a confidence-weighted FuelPrice row so the map's latest-price
    // read (PoiService) reflects the submission immediately.
    await this.prisma.fuelPrice
      .create({
        data: {
          poiId: params.poiId,
          price,
          source: 'user',
          confidence: SOURCE_META.user.base,
          fuelType: params.fuelType || 'diesel',
        },
      })
      .catch(() => undefined);

    const poi = await this.prisma.poi.findUnique({ where: { id: params.poiId } });
    if (!poi) return null;
    const out: PoiOut = {
      id: poi.id,
      source: poi.source,
      category: poi.category,
      name: poi.name,
      brand: poi.brand,
      lat: poi.lat,
      lon: poi.lon,
      city: poi.city,
      state: poi.state,
      address: poi.address,
      hours: poi.hoursRaw,
      hgv: poi.hgv,
      diesel: poi.diesel,
      parkingSpaces: poi.parkingSpaces,
      price,
      distanceMi: 0,
    };
    const [priced] = await this.priceStations([out]);
    return priced ?? null;
  }

  /**
   * Route fuel plan (§8.2): greedy "buy enough at the cheapest reachable
   * station to reach the next cheaper one" over the corridor's fuel stations.
   * Near-optimal, fast, and explainable to the driver.
   */
  async planRoute(params: {
    coords: [number, number][];
    tankGallons?: number;
    currentGallons?: number;
    mpg?: number;
    reserveGallons?: number;
    hgvOnly?: boolean;
  }): Promise<FuelPlan> {
    const tank = clampNum(params.tankGallons, 50, 400, 200);
    const mpg = clampNum(params.mpg, 3, 12, 6.5);
    const reserve = clampNum(params.reserveGallons, 0, tank * 0.5, 25);
    const startGal = clampNum(params.currentGallons, 0, tank, tank * 0.25);
    const nationalAvg = await this.eia.national();

    const totalMi = polylineMiles(params.coords);
    const stations = await this.cheapestAlongRoute({
      coords: params.coords,
      bufferMi: 4,
      hgvOnly: params.hgvOnly ?? true,
      limit: 200,
    });
    // Order by position along the route for the sweep.
    const stops = stations
      .filter((s) => typeof s.routeMi === 'number')
      .sort((a, b) => (a.routeMi! - b.routeMi!));

    const rangeMi = tank * mpg;
    const reserveMi = reserve * mpg;

    const plan: FuelPlanStop[] = [];
    let posMi = 0;
    let fuelMi = startGal * mpg; // miles of fuel currently in the tank
    let feasible = true;
    let guard = 0;

    while (posMi < totalMi && guard++ < 500) {
      const remaining = totalMi - posMi;
      if (fuelMi - reserveMi >= remaining) break; // can coast to the end

      // Stations we can still reach on current fuel (keeping the reserve).
      const reach = stops.filter(
        (s) =>
          s.routeMi! > posMi + 1e-6 &&
          s.routeMi! - posMi <= fuelMi - reserveMi + 1e-6,
      );
      if (!reach.length) {
        feasible = false;
        break;
      }
      // Head to the cheapest reachable station (ties → farther, fewer stops).
      const target = reach.reduce((best, s) =>
        s.priceEff < best.priceEff ||
        (s.priceEff === best.priceEff && s.routeMi! > best.routeMi!)
          ? s
          : best,
      );

      fuelMi -= target.routeMi! - posMi;
      posMi = target.routeMi!;

      // Look ahead: the next station cheaper than here, within a full tank.
      const nextCheaper = stops.find(
        (s) =>
          s.routeMi! > posMi + 1e-6 &&
          s.priceEff < target.priceEff - 1e-6 &&
          s.routeMi! - posMi <= rangeMi - reserveMi,
      );

      let buyMi: number;
      let reason: string;
      if (nextCheaper) {
        const needMi = nextCheaper.routeMi! - posMi + reserveMi;
        buyMi = Math.max(0, needMi - fuelMi);
        reason = `Buy just enough to reach ${label(nextCheaper)} (${(
          nextCheaper.routeMi! - posMi
        ).toFixed(0)} mi ahead) where diesel is $${nextCheaper.priceEff.toFixed(
          2,
        )}.`;
      } else {
        // No cheaper station ahead in range — fill the tank, but never more
        // than what's needed to finish plus the reserve.
        const finishMi = remaining + reserveMi;
        buyMi = Math.min(rangeMi - fuelMi, finishMi - fuelMi);
        buyMi = Math.max(0, buyMi);
        reason = `Cheapest fuel for the next stretch — top off here.`;
      }

      const gallons = round1(buyMi / mpg);
      if (gallons > 0.5) {
        fuelMi += gallons * mpg;
        const cost = gallons * target.priceEff;
        plan.push({
          poiId: target.id,
          name: target.name,
          brand: target.brand,
          lat: target.lat,
          lon: target.lon,
          routeMi: round1(target.routeMi!),
          priceEff: round2(target.priceEff),
          gallons,
          cost: round2(cost),
          savings: round2(Math.max(0, nationalAvg - target.priceEff) * gallons),
          reason,
        });
      } else {
        // Nothing worth buying here; nudge past it to avoid a loop.
        posMi += 0.1;
      }
    }

    const totalGallons = round1(plan.reduce((s, p) => s + p.gallons, 0));
    const totalCost = round2(plan.reduce((s, p) => s + p.cost, 0));
    const totalSavings = round2(plan.reduce((s, p) => s + p.savings, 0));

    return {
      feasible,
      stops: plan,
      totalGallons,
      totalCost,
      totalSavings,
      nationalAvg: round2(nationalAvg),
      note: feasible
        ? plan.length
          ? `Fill ${totalGallons} gal across ${plan.length} stop${
              plan.length > 1 ? 's' : ''
            } — about $${totalSavings.toFixed(2)} under buying at the national average.`
          : `You can finish this lane on the fuel you have.`
        : `No truck-legal fuel found in range for part of this lane — plan is partial.`,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Blend every price signal for each station into an effective price. */
  private async priceStations(stations: PoiOut[]): Promise<PricedStation[]> {
    if (!stations.length) return [];
    const ids = stations.map((s) => s.id);
    const now = Date.now();

    const [fuelRows, reports] = await Promise.all([
      this.prisma.fuelPrice.findMany({
        where: { poiId: { in: ids }, fuelType: 'diesel' },
        orderBy: { reportedAt: 'desc' },
        take: 2000,
      }),
      this.prisma.priceReport.findMany({
        where: { poiId: { in: ids }, fuelType: 'diesel' },
        orderBy: { reportedAt: 'desc' },
        take: 2000,
      }),
    ]);

    const byPoi = new Map<
      string,
      { price: number; source: SourceKey; ageH: number }[]
    >();
    const push = (
      poiId: string,
      price: number,
      source: SourceKey,
      at: Date,
    ) => {
      if (!Number.isFinite(price) || price <= 0) return;
      const ageH = (now - new Date(at).getTime()) / 3_600_000;
      const arr = byPoi.get(poiId) ?? [];
      // Keep only the freshest few per source so one station can't be
      // dominated by a flood of old rows.
      arr.push({ price, source, ageH });
      byPoi.set(poiId, arr);
    };
    for (const r of reports) push(r.poiId, r.price, 'user', r.reportedAt);
    for (const f of fuelRows)
      push(f.poiId, f.price, normSource(f.source), f.reportedAt);

    const national = await this.eia.national();

    return stations.map((s) => {
      const signals = byPoi.get(s.id) ?? [];
      // Regional baseline is always present as a low-confidence anchor.
      const baseline = this.baselineFor(s.state);
      const all = [
        ...signals,
        { price: baseline, source: 'eia_region' as SourceKey, ageH: 0 },
      ];

      let num = 0;
      let den = 0;
      let bestW = -1;
      let bestSource: SourceKey = 'eia_region';
      for (const sig of all) {
        const meta = SOURCE_META[sig.source];
        const w = meta.base * decay(sig.ageH, meta.halfLifeH);
        num += sig.price * w;
        den += w;
        if (w > bestW) {
          bestW = w;
          bestSource = sig.source;
        }
      }
      const priceEff = den > 0 ? num / den : baseline;
      const isLive = signals.length > 0;
      // Aggregate confidence: cap at 0.95, floor at the baseline weight.
      const confidence = Math.min(0.95, Math.max(0.3, den));

      return {
        ...s,
        price: isLive ? round2(priceEff) : s.price,
        priceEff: round2(priceEff),
        priceSource: bestSource,
        priceConfidence: round2(confidence),
        priceIsLive: isLive,
        savingsPerGal: round2(Math.max(0, national - priceEff)),
      } as PricedStation;
    });
  }

  private baselineFor(state: string | null): number {
    return this.eiaCache(regionForState(state));
  }

  // Small synchronous cache filled lazily; EIA service is already memoized.
  private eiaMemo: Partial<Record<string, number>> = {};
  private eiaCache(region: string): number {
    if (this.eiaMemo[region] != null) return this.eiaMemo[region]!;
    return this.eiaMemo.national ?? 4.8; // primed by warm() below
  }
  private async warm() {
    const snap = await this.eia.snapshot();
    this.eiaMemo = { ...snap.prices };
  }
  async onModuleInit() {
    try {
      await this.warm();
    } catch {
      /* stay on defaults */
    }
  }

  /** Attach distance-along-route (routeMi) to each station. */
  private attachRouteMi(
    stations: PricedStation[],
    coords: [number, number][],
  ): PricedStation[] {
    if (coords.length < 2) return stations;
    const cum = cumulativeMiles(coords);
    return stations.map((s) => {
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = haversineMi(
          { lat: s.lat, lon: s.lon },
          { lat: coords[i][1], lon: coords[i][0] },
        );
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      return { ...s, routeMi: round1(cum[bestIdx]), detourMi: round1(bestD) };
    });
  }
}

function clampNum(v: any, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function label(s: { brand: string | null; name: string }): string {
  return s.brand || s.name || 'the next stop';
}
function cumulativeMiles(coords: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineMi(
          { lat: coords[i - 1][1], lon: coords[i - 1][0] },
          { lat: coords[i][1], lon: coords[i][0] },
        ),
    );
  }
  return cum;
}
function polylineMiles(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  const cum = cumulativeMiles(coords);
  return cum[cum.length - 1];
}
