import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FuelPricesService, regionForState } from './fuel-prices';
import { FuelScrapeService } from './fuel-scrape';
import { findFuelStationsNear, reverseStateOf } from './overpass';

type StationOut = {
  id: string;
  name: string;
  city: string;
  state: string;
  price: number;
  distanceMi: number;
  onRoute: boolean;
  network: string;
  latitude: number | null;
  longitude: number | null;
  exit: string | null;
  address: string | null;
  priceEnriched: boolean;
};

function haversineMi(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

@UseGuards(JwtAuthGuard)
@Controller('fuel')
export class FuelController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: FuelPricesService,
    private readonly scrape: FuelScrapeService,
  ) {}

  @Get()
  async list(@Query('lat') latQ?: string, @Query('lon') lonQ?: string) {
    const lat = latQ != null ? Number(latQ) : NaN;
    const lon = lonQ != null ? Number(lonQ) : NaN;
    const hasGps = Number.isFinite(lat) && Number.isFinite(lon);

    // ---- Live path: real stations near the driver's GPS + official regional price ----
    if (hasGps) {
      try {
        const [{ state, city }, found] = await Promise.all([
          reverseStateOf(lat, lon),
          findFuelStationsNear(lat, lon),
        ]);
        const region = regionForState(state);
        const [price, national, snap] = await Promise.all([
          this.prices.priceFor(region),
          this.prices.national(),
          this.prices.snapshot(),
        ]);

        const stations: StationOut[] = found
          .map((s) => ({
            id: s.osmId,
            name: s.name,
            city: s.city ?? city ?? '',
            state: s.state ?? state ?? '',
            price, // official regional diesel price (EIA) — may be enriched below
            distanceMi: Math.round(haversineMi({ lat, lon }, { lat: s.lat, lon: s.lon })),
            onRoute: s.hgv, // truck-friendly stations flagged
            network: s.network,
            latitude: s.lat,
            longitude: s.lon,
            exit: null,
            address: s.address,
            priceEnriched: false,
          }))
          .sort((a, b) => a.distanceMi - b.distanceMi)
          .slice(0, 40);

        if (stations.length) {
          // Enrich prices with local (per-city) diesel averages via Tavily
          // when TAVILY_API_KEY is set. Falls back silently to the EIA
          // regional price for any city we can't resolve.
          let priceEnriched = false;
          if (this.scrape.enabled()) {
            const cities = Array.from(
              new Set(stations.map((s) => s.city).filter((c) => c && c.trim())),
            ).slice(0, 8); // cap Tavily calls per request
            const resolved = await Promise.all(
              cities.map(async (c) => [c, await this.scrape.cityDieselPrice(c, state)] as const),
            );
            const cityPrice = new Map(
              resolved.filter(([, p]) => p != null) as [string, number][],
            );
            if (cityPrice.size) {
              for (const st of stations) {
                const p = cityPrice.get(st.city);
                if (p != null) {
                  st.price = p;
                  st.priceEnriched = true;
                  priceEnriched = true;
                }
              }
            }
          }

          return {
            nationalAvg: national,
            regionPrice: price,
            region,
            regionLabel: this.prices.regionLabel(region),
            priceAsOf: snap.asOf,
            priceLive: snap.live,
            priceEnriched,
            source: 'live' as const,
            stations,
          };
        }
        // fall through to DB fallback if OSM returned nothing usable
      } catch {
        // fall through to DB fallback on any live-lookup failure
      }
    }

    // ---- Fallback path: seeded national station set (no GPS or live lookup failed) ----
    const rows = await this.prisma.fuelStation.findMany({ orderBy: { price: 'asc' } });
    const national = await this.prices.national();
    const snap = await this.prices.snapshot();
    return {
      nationalAvg: national,
      regionPrice: null,
      region: 'national',
      regionLabel: 'U.S. National',
      priceAsOf: snap.asOf,
      priceLive: snap.live,
      priceEnriched: false,
      source: 'fallback' as const,
      stations: rows.map((r) => ({ ...r, priceEnriched: false })) as StationOut[],
    };
  }
}
