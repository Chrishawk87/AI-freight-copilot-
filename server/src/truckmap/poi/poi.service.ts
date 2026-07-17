import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PoiCategory } from '@prisma/client';
import { OverpassIngestService } from '../ingestion/overpass.ingest';

export const POI_CATEGORIES: PoiCategory[] = [
  'fuel',
  'parking',
  'rest_area',
  'weigh_station',
  'repair',
  'services',
];

export type NearbyParams = {
  lat: number;
  lon: number;
  radiusMi?: number;
  categories?: PoiCategory[];
  limit?: number;
};

export type PoiOut = {
  id: string;
  source: string;
  category: PoiCategory;
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  address: string | null;
  hours: string | null;
  hgv: boolean;
  diesel: boolean;
  parkingSpaces: number | null;
  price: number | null;
  distanceMi: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function haversineMi(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Serves map POIs from our own `Poi` store using a lat/lon bounding box plus a
 * haversine sort — no PostGIS required for Phase 1 (see schema SCALE NOTE for
 * the production upgrade path). A short in-memory TTL cache coalesces the burst
 * of identical requests a moving map fires, and thin/stale areas are topped up
 * from OpenStreetMap via the ingestion service.
 */
@Injectable()
export class PoiService {
  private readonly logger = new Logger(PoiService.name);
  private readonly cache = new Map<string, { at: number; data: PoiOut[] }>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: OverpassIngestService,
  ) {}

  async nearby(params: NearbyParams): Promise<PoiOut[]> {
    const { lat, lon } = params;
    const radiusMi = clamp(params.radiusMi ?? 25, 1, 150);
    const limit = clamp(params.limit ?? 200, 1, 500);
    const cats = params.categories?.length ? params.categories : null;

    const key = this.cacheKey(lat, lon, radiusMi, cats);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data.slice(0, limit);

    let rows = await this.query(lat, lon, radiusMi, cats, limit);

    if (rows.length < 8 && !this.ingest.wasRecentlyIngested(lat, lon)) {
      // First real visit to an area — fill it so the driver sees a live map,
      // then re-read from the DB.
      await this.ingest.ingestArea(lat, lon, radiusMi * 1609.34);
      rows = await this.query(lat, lon, radiusMi, cats, limit);
    } else if (!this.ingest.wasRecentlyIngested(lat, lon)) {
      // Have coverage but the cell is stale — refresh in the background.
      void this.ingest.ingestArea(lat, lon, radiusMi * 1609.34);
    }

    this.cache.set(key, { at: Date.now(), data: rows });
    return rows.slice(0, limit);
  }

  private cacheKey(
    lat: number,
    lon: number,
    radiusMi: number,
    cats: PoiCategory[] | null,
  ): string {
    const rl = Math.round(lat * 50) / 50; // ~1.4mi grid
    const ro = Math.round(lon * 50) / 50;
    return `${rl},${ro}:${radiusMi}:${cats ? cats.slice().sort().join(',') : 'all'}`;
  }

  private async query(
    lat: number,
    lon: number,
    radiusMi: number,
    cats: PoiCategory[] | null,
    limit: number,
  ): Promise<PoiOut[]> {
    const latD = radiusMi / 69;
    const lonD =
      radiusMi / (69 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

    const where: any = {
      active: true,
      lat: { gte: lat - latD, lte: lat + latD },
      lon: { gte: lon - lonD, lte: lon + lonD },
    };
    if (cats) where.category = { in: cats };

    const found = await this.prisma.poi.findMany({
      where,
      include: { prices: { orderBy: { reportedAt: 'desc' }, take: 1 } },
      take: 1000,
    });

    return found
      .map((p) => ({
        id: p.id,
        source: p.source,
        category: p.category,
        name: p.name,
        brand: p.brand,
        lat: p.lat,
        lon: p.lon,
        city: p.city,
        state: p.state,
        address: p.address,
        hours: p.hoursRaw,
        hgv: p.hgv,
        diesel: p.diesel,
        parkingSpaces: p.parkingSpaces,
        price: p.prices[0]?.price ?? null,
        distanceMi: Math.round(haversineMi(lat, lon, p.lat, p.lon) * 10) / 10,
      }))
      .filter((p) => p.distanceMi <= radiusMi)
      .sort((a, b) => a.distanceMi - b.distanceMi)
      .slice(0, limit);
  }
}
