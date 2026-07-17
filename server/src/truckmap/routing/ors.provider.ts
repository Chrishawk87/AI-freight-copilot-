import { Injectable, Logger } from '@nestjs/common';
import {
  IN_TO_M,
  LBS_TO_TONNES,
  LatLon,
  NavStep,
  RouteResult,
  RoutingProvider,
  VehicleProfile,
} from './routing.types';

// Truck-legal routing via OpenRouteService `driving-hgv`. Honors the vehicle
// profile (height/width/length/weight/axleload/hazmat) so returned routes are
// legal for the rig. Requires ORS_API_KEY (free tier). When the key is absent
// the provider reports disabled and RoutingService falls back to OSRM.
@Injectable()
export class OrsProvider implements RoutingProvider {
  readonly name = 'ors-hgv';
  private readonly logger = new Logger(OrsProvider.name);

  isEnabled(): boolean {
    return !!process.env.ORS_API_KEY;
  }
  supportsTruck(): boolean {
    return true;
  }

  async route(
    origin: LatLon,
    dest: LatLon,
    vehicle?: VehicleProfile,
  ): Promise<RouteResult> {
    const key = process.env.ORS_API_KEY;
    if (!key) throw new Error('ORS_API_KEY not set');

    const restrictions: Record<string, number | boolean> = {};
    if (vehicle?.heightIn) restrictions.height = round2(vehicle.heightIn * IN_TO_M);
    if (vehicle?.widthIn) restrictions.width = round2(vehicle.widthIn * IN_TO_M);
    if (vehicle?.lengthIn) restrictions.length = round2(vehicle.lengthIn * IN_TO_M);
    if (vehicle?.weightLbs)
      restrictions.weight = round2(vehicle.weightLbs * LBS_TO_TONNES);
    if (vehicle?.axles && vehicle?.weightLbs)
      restrictions.axleload = round2(
        (vehicle.weightLbs * LBS_TO_TONNES) / vehicle.axles,
      );
    if (vehicle?.hazmatClass) restrictions.hazmat = true;

    const body = {
      coordinates: [
        [origin.lon, origin.lat],
        [dest.lon, dest.lat],
      ],
      instructions: true,
      options: {
        vehicle_type: 'hgv',
        profile_params: { restrictions },
      },
    };

    const res = await fetch(
      'https://api.openrouteservice.org/v2/directions/driving-hgv/geojson',
      {
        method: 'POST',
        headers: {
          Authorization: key,
          'Content-Type': 'application/json',
          Accept: 'application/geo+json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ORS HTTP ${res.status} ${text.slice(0, 160)}`);
    }
    const data: any = await res.json();
    const feature = data?.features?.[0];
    if (!feature) throw new Error('ORS: no route');

    const coords = (feature.geometry?.coordinates ?? []) as [number, number][];
    const summary = feature.properties?.summary ?? {};
    // ORS returns distance in meters and duration in seconds (default units).
    const miles = (Number(summary.distance) || 0) / 1609.34;
    const hours = (Number(summary.duration) || 0) / 3600;

    const steps: NavStep[] = [];
    for (const seg of feature.properties?.segments ?? []) {
      for (const st of seg.steps ?? []) {
        const wp: number[] = st.way_points ?? [];
        const idx = Array.isArray(wp) && wp.length ? wp[0] : 0;
        const c = coords[idx] ?? coords[0] ?? [origin.lon, origin.lat];
        steps.push({
          text: st.instruction || 'Continue',
          road: st.name && st.name !== '-' ? st.name : '',
          distanceMi: (Number(st.distance) || 0) / 1609.34,
          lat: c[1],
          lon: c[0],
          type: String(st.type ?? ''),
        });
      }
    }

    return {
      coords: coords.map(([lon, lat]) => [lon, lat] as [number, number]),
      miles,
      hours,
      steps,
      engine: 'ors-hgv',
      truckLegal: true,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
