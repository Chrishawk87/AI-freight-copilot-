import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PoiCategory } from '@prisma/client';
import {
  findFuelStationsNear,
  findPlacesNear,
  type PlaceCategory,
} from '../../fuel/overpass';

// OpenStreetMap place categories → our unified PoiCategory.
const PLACE_TO_POI: Record<PlaceCategory, PoiCategory> = {
  fuel: 'fuel',
  rest_area: 'rest_area',
  services: 'services',
  weigh_station: 'weigh_station',
  truck_parking: 'parking',
};

type UpsertRow = {
  source: string;
  sourceId: string;
  category: PoiCategory;
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  address: string | null;
  city: string | null;
  state: string | null;
  hoursRaw: string | null;
  hgv: boolean;
  diesel: boolean;
};

/**
 * Pulls driver POIs from the free OpenStreetMap Overpass API and upserts them
 * into our own `Poi` store so the map API never hits Overpass on the hot path.
 *
 * Ingestion is area-driven: when a driver opens the map somewhere we have thin
 * coverage, `PoiService` asks us to ingest that area once. We de-dupe by a
 * coarse geo-cell so a burst of nearby requests triggers a single Overpass
 * sweep, and we remember recently-swept cells to avoid hammering the API.
 */
@Injectable()
export class OverpassIngestService {
  private readonly logger = new Logger(OverpassIngestService.name);
  private readonly inFlight = new Map<string, Promise<number>>();
  private readonly recent = new Map<string, number>(); // cellKey -> timestamp

  constructor(private readonly prisma: PrismaService) {}

  // ~0.5° cell (~35mi) so neighbouring requests share one ingest.
  private cellKey(lat: number, lon: number): string {
    return `${Math.round(lat * 2) / 2},${Math.round(lon * 2) / 2}`;
  }

  wasRecentlyIngested(
    lat: number,
    lon: number,
    maxAgeMs = 6 * 60 * 60 * 1000,
  ): boolean {
    const ts = this.recent.get(this.cellKey(lat, lon));
    return ts != null && Date.now() - ts < maxAgeMs;
  }

  /** Ingest one area; coalesces concurrent calls for the same cell. */
  async ingestArea(
    lat: number,
    lon: number,
    radiusMeters = 40000,
  ): Promise<number> {
    const key = this.cellKey(lat, lon);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const run = this.doIngest(lat, lon, radiusMeters)
      .then((n) => {
        this.recent.set(key, Date.now());
        return n;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  private async doIngest(
    lat: number,
    lon: number,
    radiusMeters: number,
  ): Promise<number> {
    const rows: UpsertRow[] = [];
    try {
      const [fuel, places] = await Promise.all([
        findFuelStationsNear(lat, lon, radiusMeters),
        findPlacesNear(lat, lon, radiusMeters),
      ]);
      for (const s of fuel) {
        rows.push({
          source: 'osm',
          sourceId: s.osmId,
          category: 'fuel',
          name: s.name,
          brand: s.network || null,
          lat: s.lat,
          lon: s.lon,
          address: s.address,
          city: s.city,
          state: s.state,
          hoursRaw: s.hours,
          hgv: s.hgv,
          diesel: s.diesel,
        });
      }
      for (const p of places) {
        if (p.category === 'fuel') continue; // richer fuel data handled above
        rows.push({
          source: 'osm',
          sourceId: p.osmId,
          category: PLACE_TO_POI[p.category],
          name: p.name,
          brand: null,
          lat: p.lat,
          lon: p.lon,
          address: null,
          city: p.city,
          state: p.state,
          hoursRaw: null,
          hgv: p.hgv,
          diesel: false,
        });
      }
    } catch (e: any) {
      this.logger.warn(`ingestArea Overpass failed: ${e?.message}`);
      return 0;
    }

    let n = 0;
    for (const r of rows) {
      try {
        await this.prisma.poi.upsert({
          where: { source_sourceId: { source: r.source, sourceId: r.sourceId } },
          create: { ...r, active: true, lastSeenAt: new Date() },
          update: { ...r, active: true, lastSeenAt: new Date() },
        });
        n++;
      } catch (e: any) {
        this.logger.warn(`poi upsert failed (${r.sourceId}): ${e?.message}`);
      }
    }
    this.logger.log(
      `ingestArea ${lat.toFixed(2)},${lon.toFixed(2)} → ${n} POIs`,
    );
    return n;
  }
}
