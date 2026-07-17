import { Injectable, Logger } from '@nestjs/common';
import type { PoiCategory } from '@prisma/client';
import { OrsProvider } from './ors.provider';
import { OsrmProvider } from './osrm.provider';
import { PoiService, type PoiOut } from '../poi/poi.service';
import { LatLon, RouteResult, VehicleProfile } from './routing.types';

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
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly ors: OrsProvider,
    private readonly osrm: OsrmProvider,
    private readonly poi: PoiService,
  ) {}

  /**
   * Truck-legal route when a vehicle profile is supplied and ORS is configured;
   * otherwise (or on ORS failure) a car route from the free OSRM fallback.
   */
  async route(
    origin: LatLon,
    dest: LatLon,
    vehicle?: VehicleProfile,
  ): Promise<RouteResult> {
    if (vehicle && this.ors.isEnabled()) {
      try {
        return await this.ors.route(origin, dest, vehicle);
      } catch (e: any) {
        this.logger.warn(`ORS route failed, falling back to OSRM: ${e?.message}`);
      }
    }
    return this.osrm.route(origin, dest);
  }

  /**
   * POIs within a corridor around a route polyline. Samples the polyline every
   * ~20 mi, pulls nearby POIs at each sample (which also warms ingestion for the
   * lane), then dedupes and keeps those within `bufferMi` of the route.
   */
  async alongRoutePois(
    coords: [number, number][], // [lon, lat]
    opts: {
      categories?: PoiCategory[];
      bufferMi?: number;
      hgvOnly?: boolean;
      limit?: number;
    } = {},
  ): Promise<PoiOut[]> {
    const bufferMi = Math.min(25, Math.max(2, opts.bufferMi ?? 8));
    const limit = Math.min(300, Math.max(10, opts.limit ?? 200));
    const path: LatLon[] = coords.map(([lon, lat]) => ({ lat, lon }));
    if (path.length === 0) return [];

    // Sample points ~20 mi apart along the polyline.
    const samples: LatLon[] = [];
    let acc = 0;
    samples.push(path[0]);
    for (let i = 1; i < path.length; i++) {
      acc += haversineMi(path[i - 1], path[i]);
      if (acc >= 20) {
        samples.push(path[i]);
        acc = 0;
      }
    }
    samples.push(path[path.length - 1]);

    const byId = new Map<string, PoiOut>();
    for (const s of samples) {
      let found: PoiOut[] = [];
      try {
        found = await this.poi.nearby({
          lat: s.lat,
          lon: s.lon,
          radiusMi: bufferMi,
          categories: opts.categories,
          limit: 60,
        });
      } catch {
        continue;
      }
      for (const p of found) {
        if (opts.hgvOnly && !p.hgv) continue;
        // Corridor test: keep only POIs actually near the polyline.
        const near = minDistToPathMi(p, path) <= bufferMi;
        if (!near) continue;
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
      if (byId.size >= limit) break;
    }
    return Array.from(byId.values()).slice(0, limit);
  }
}

// Cheap min distance from a POI to the sampled route path (point-to-vertex).
function minDistToPathMi(p: { lat: number; lon: number }, path: LatLon[]): number {
  let min = Infinity;
  const step = Math.max(1, Math.floor(path.length / 400)); // cap the scan
  for (let i = 0; i < path.length; i += step) {
    const d = haversineMi(p, path[i]);
    if (d < min) min = d;
  }
  return min;
}
