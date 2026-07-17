import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  findPlacesNear,
  placeCategoryLabel,
  type OverpassPlace,
  type PlaceCategory,
} from '../fuel/overpass';

function haversineMi(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const Rm = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * Rm * Math.asin(Math.min(1, Math.sqrt(s)));
}

type PlaceOut = OverpassPlace & { label: string; distanceMi: number };

@UseGuards(JwtAuthGuard)
@Controller('places')
export class PlacesController {
  // Driver POIs (rest areas, truck parking, weigh stations, fuel, services)
  // near the driver's GPS. Free via OpenStreetMap Overpass.
  @Get()
  async list(
    @Query('lat') latQ?: string,
    @Query('lon') lonQ?: string,
    @Query('radiusMi') radiusQ?: string,
  ) {
    const lat = latQ != null ? Number(latQ) : NaN;
    const lon = lonQ != null ? Number(lonQ) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { places: [] as PlaceOut[] };
    }
    const radiusMi = Number.isFinite(Number(radiusQ)) ? Number(radiusQ) : 25;
    const radiusMeters = Math.min(120, Math.max(5, radiusMi)) * 1609.34;

    try {
      const found = await findPlacesNear(lat, lon, radiusMeters);
      const places: PlaceOut[] = found
        .map((p) => ({
          ...p,
          label: placeCategoryLabel(p.category),
          distanceMi: Math.round(haversineMi({ lat, lon }, { lat: p.lat, lon: p.lon }) * 10) / 10,
        }))
        .sort((a, b) => a.distanceMi - b.distanceMi)
        .slice(0, 120);
      return { places };
    } catch {
      return { places: [] as PlaceOut[] };
    }
  }
}

export type { PlaceCategory };
