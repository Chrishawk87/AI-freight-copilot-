import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { FuelIntelService } from './fuel-intel.service';

// Fuel Intelligence for the Truck Map: crowd-weighted diesel prices, cheapest
// stations nearby and along a lane, and a route fuel-fill plan. Fuel cards are
// intentionally out of scope for this phase.
function num(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: any): boolean {
  return v === true || v === 'true' || v === '1';
}
function coords(raw: any): [number, number][] {
  return Array.isArray(raw)
    ? raw.filter(
        (p): p is [number, number] =>
          Array.isArray(p) &&
          p.length >= 2 &&
          Number.isFinite(Number(p[0])) &&
          Number.isFinite(Number(p[1])),
      )
    : [];
}

@UseGuards(JwtAuthGuard)
@Controller('truckmap/fuel')
export class FuelController {
  constructor(private readonly fuel: FuelIntelService) {}

  // Cheapest truck-legal diesel near a point.
  @Get()
  async nearby(
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
    @Query('radiusMi') radiusMi?: string,
    @Query('hgvOnly') hgvOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const la = num(lat);
    const lo = num(lon);
    if (la == null || lo == null) {
      return { error: 'lat and lon are required', stations: [], count: 0 };
    }
    const stations = await this.fuel.cheapestNearby({
      lat: la,
      lon: lo,
      radiusMi: num(radiusMi),
      hgvOnly: bool(hgvOnly),
      limit: num(limit),
    });
    return { stations, count: stations.length };
  }

  // Cheapest diesel in a corridor around a route polyline ([lon, lat] pairs).
  @Post('along-route')
  async alongRoute(
    @Body()
    body: {
      coords?: [number, number][];
      bufferMi?: number;
      hgvOnly?: boolean;
      limit?: number;
    },
  ) {
    const c = coords(body?.coords);
    if (c.length < 2) return { stations: [], count: 0 };
    const stations = await this.fuel.cheapestAlongRoute({
      coords: c,
      bufferMi: num(body?.bufferMi),
      hgvOnly: body?.hgvOnly,
      limit: num(body?.limit),
    });
    return { stations, count: stations.length };
  }

  // Route fuel-fill plan: where to buy and how much to minimize spend.
  @Post('plan')
  async plan(
    @Body()
    body: {
      coords?: [number, number][];
      tankGallons?: number;
      currentGallons?: number;
      mpg?: number;
      reserveGallons?: number;
      hgvOnly?: boolean;
    },
  ) {
    const c = coords(body?.coords);
    if (c.length < 2) {
      return {
        feasible: false,
        stops: [],
        totalGallons: 0,
        totalCost: 0,
        totalSavings: 0,
        nationalAvg: 0,
        note: 'A route is required to build a fuel plan.',
      };
    }
    return this.fuel.planRoute({
      coords: c,
      tankGallons: num(body?.tankGallons),
      currentGallons: num(body?.currentGallons),
      mpg: num(body?.mpg),
      reserveGallons: num(body?.reserveGallons),
      hgvOnly: body?.hgvOnly,
    });
  }

  // Crowd-sourced diesel price submission for a station.
  @Post('report')
  async report(
    @CurrentUser() user: AuthUser,
    @Body() body: { poiId?: string; price?: number; fuelType?: string },
  ) {
    if (!user?.carrierId) throw new NotFoundException('No carrier profile');
    if (!body?.poiId) return { error: 'poiId is required' };
    const price = Number(body?.price);
    if (!Number.isFinite(price) || price <= 0 || price > 20) {
      return { error: 'price must be a realistic $/gal figure' };
    }
    const station = await this.fuel.report({
      poiId: body.poiId,
      carrierId: user.carrierId,
      price,
      fuelType: body?.fuelType,
    });
    return { station };
  }
}
