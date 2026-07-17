import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { PoiCategory } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { POI_CATEGORIES } from '../poi/poi.service';
import { RoutingService } from './routing.service';
import { LatLon, VehicleProfile } from './routing.types';

function toLatLon(v: any): LatLon | null {
  const lat = Number(v?.lat);
  const lon = Number(v?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function toVehicle(v: any): VehicleProfile | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const num = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
  const profile: VehicleProfile = {
    heightIn: num(v.heightIn),
    widthIn: num(v.widthIn),
    lengthIn: num(v.lengthIn),
    weightLbs: num(v.weightLbs),
    axles: num(v.axles),
    hazmatClass: v.hazmatClass ?? null,
  };
  // Only a profile with at least one real dimension is worth sending to the
  // truck engine; otherwise let RoutingService fall through to car routing.
  const hasDims =
    profile.heightIn ||
    profile.widthIn ||
    profile.lengthIn ||
    profile.weightLbs;
  return hasDims ? profile : undefined;
}

function parseCategories(raw: any): PoiCategory[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = new Set<string>(POI_CATEGORIES);
  const picked = raw
    .map((s) => String(s).trim())
    .filter((s) => valid.has(s)) as PoiCategory[];
  return picked.length ? picked : undefined;
}

@UseGuards(JwtAuthGuard)
@Controller('truckmap')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  // Truck-legal route (ORS `driving-hgv` when a vehicle profile is supplied and
  // the engine is configured; otherwise the free OSRM car fallback).
  @Post('route')
  async route(
    @Body()
    body: {
      from?: any;
      to?: any;
      vehicle?: any;
    },
  ) {
    const origin = toLatLon(body?.from);
    const dest = toLatLon(body?.to);
    if (!origin || !dest) {
      return { error: 'from and to must each be { lat, lon }' };
    }
    const vehicle = toVehicle(body?.vehicle);
    const result = await this.routing.route(origin, dest, vehicle);
    return result;
  }

  // POIs within a corridor around a route polyline.
  @Post('route/pois')
  async routePois(
    @Body()
    body: {
      coords?: [number, number][];
      categories?: string[];
      bufferMi?: number;
      hgvOnly?: boolean;
      limit?: number;
    },
  ) {
    const coords = Array.isArray(body?.coords) ? body.coords : [];
    if (!coords.length) return { pois: [], count: 0 };
    const pois = await this.routing.alongRoutePois(coords, {
      categories: parseCategories(body?.categories),
      bufferMi: Number.isFinite(Number(body?.bufferMi))
        ? Number(body.bufferMi)
        : undefined,
      hgvOnly: !!body?.hgvOnly,
      limit: Number.isFinite(Number(body?.limit))
        ? Number(body.limit)
        : undefined,
    });
    return { pois, count: pois.length };
  }
}
