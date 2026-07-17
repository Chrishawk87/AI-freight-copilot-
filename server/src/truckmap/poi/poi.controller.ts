import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { PoiCategory } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PoiService, POI_CATEGORIES } from './poi.service';

function parseCategories(raw?: string): PoiCategory[] | undefined {
  if (!raw) return undefined;
  const valid = new Set<string>(POI_CATEGORIES);
  const picked = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => valid.has(s)) as PoiCategory[];
  return picked.length ? picked : undefined;
}

@UseGuards(JwtAuthGuard)
@Controller('truckmap')
export class PoiController {
  constructor(private readonly poi: PoiService) {}

  // Map POIs (fuel, parking, rest areas, weigh stations, repair, services)
  // near the driver, served from our own store and topped up from OSM.
  @Get('poi')
  async list(
    @Query('lat') latQ?: string,
    @Query('lon') lonQ?: string,
    @Query('radiusMi') radiusQ?: string,
    @Query('categories') catsQ?: string,
    @Query('limit') limitQ?: string,
  ) {
    const lat = latQ != null ? Number(latQ) : NaN;
    const lon = lonQ != null ? Number(lonQ) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { pois: [] };
    }
    const radiusMi = Number.isFinite(Number(radiusQ)) ? Number(radiusQ) : 25;
    const limit = Number.isFinite(Number(limitQ)) ? Number(limitQ) : undefined;
    const categories = parseCategories(catsQ);

    const pois = await this.poi.nearby({ lat, lon, radiusMi, categories, limit });
    return { pois, count: pois.length };
  }
}
