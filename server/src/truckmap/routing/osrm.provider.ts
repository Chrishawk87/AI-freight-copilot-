import { Injectable } from '@nestjs/common';
import {
  LatLon,
  NavStep,
  RouteResult,
  RoutingProvider,
} from './routing.types';

// Free car routing via the public OSRM demo server (no key). This is the
// fallback when no vehicle profile is set or the truck engine is unavailable —
// it does NOT honor truck restrictions, so `truckLegal` is always false.
@Injectable()
export class OsrmProvider implements RoutingProvider {
  readonly name = 'osrm';

  isEnabled(): boolean {
    return true; // always available, no key
  }
  supportsTruck(): boolean {
    return false;
  }

  async route(origin: LatLon, dest: LatLon): Promise<RouteResult> {
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data: any = await res.json();
    const r = data?.routes?.[0];
    if (!r) throw new Error('No route');

    const steps: NavStep[] = [];
    for (const leg of r.legs ?? []) {
      for (const s of leg.steps ?? []) {
        const loc = s?.maneuver?.location as [number, number] | undefined;
        if (!loc) continue;
        steps.push({
          text: describeManeuver(s),
          road: s?.name?.trim() || '',
          distanceMi: (s.distance ?? 0) / 1609.34,
          lat: loc[1],
          lon: loc[0],
          type: s?.maneuver?.type ?? '',
          modifier: s?.maneuver?.modifier,
        });
      }
    }

    return {
      coords: (r.geometry.coordinates as [number, number][]).map(
        ([lon, lat]) => [lon, lat] as [number, number],
      ),
      miles: r.distance / 1609.34,
      hours: r.duration / 3600,
      steps,
      engine: 'osrm',
      truckLegal: false,
    };
  }
}

// Plain driver-speak from OSRM's maneuver object (ported from the client map).
export function describeManeuver(step: any): string {
  const m = step?.maneuver ?? {};
  const type: string = m.type ?? '';
  const mod: string = m.modifier ?? '';
  const road: string = step?.name?.trim() || 'the road';
  const onRoad = step?.name?.trim() ? ` onto ${road}` : '';
  const contRoad = step?.name?.trim() ? ` on ${road}` : '';
  const dir = mod || '';
  switch (type) {
    case 'depart':
      return `Head out${contRoad}`;
    case 'turn':
      return `Turn ${dir || 'ahead'}${onRoad}`;
    case 'new name':
    case 'continue':
      return `Continue${contRoad}`;
    case 'merge':
      return `Merge${onRoad}`;
    case 'on ramp':
      return `Take the ramp${onRoad}`;
    case 'off ramp':
      return `Take the exit${onRoad}`;
    case 'fork':
      return `Keep ${dir || 'straight'}${onRoad}`;
    case 'end of road':
      return `Turn ${dir || 'ahead'}${onRoad}`;
    case 'roundabout':
    case 'rotary':
      return `At the roundabout, exit${onRoad}`;
    case 'arrive':
      return 'Arrive at your destination';
    default:
      return dir ? `Bear ${dir}${onRoad}` : `Continue${contRoad}`;
  }
}
