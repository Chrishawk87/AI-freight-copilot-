// Rough origin→destination mileage estimate for a broker tender.
//
// A tender/offer rarely states the mileage, but the scoring + Profitability
// Engine need a non-zero, roughly-right distance to rank it honestly. We
// estimate a straight-line distance between the two state centroids and apply a
// road-circuity factor. It is deliberately labeled an ESTIMATE — the moment the
// driver routes the load, real turn-by-turn mileage replaces it.
//
// This keeps the SIA-independent feed honest: real freight terms from a real
// broker, with a transparent distance estimate rather than a fabricated number.

// Approximate geographic centroids (lat, lon) of the lower-48 + AK/HI states.
const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [64.2, -149.5], AZ: [34.3, -111.7], AR: [34.9, -92.4],
  CA: [37.2, -119.3], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  FL: [28.6, -82.4], GA: [32.6, -83.4], HI: [20.3, -156.4], ID: [44.4, -114.6],
  IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.0, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.0, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8],
  MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6],
  NH: [43.7, -71.6], NJ: [40.1, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5],
  NC: [35.5, -79.4], ND: [47.4, -100.5], OH: [40.3, -82.8], OK: [35.6, -97.5],
  OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.6], SC: [33.9, -80.9],
  SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6],
  WI: [44.6, -89.9], WY: [43.0, -107.6], DC: [38.9, -77.0],
};

function haversineMiles(
  [lat1, lon1]: [number, number],
  [lat2, lon2]: [number, number],
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Estimate loaded miles between two US states. Returns 0 when either state is
 * unknown (caller can leave miles unset until the load is routed). Same-state
 * hauls get a sensible in-state floor rather than 0. A 1.2 circuity factor turns
 * straight-line distance into a realistic road estimate.
 */
export function estimateStateMiles(
  originState: string,
  destState: string,
): number {
  const o = STATE_CENTROIDS[(originState || '').trim().toUpperCase()];
  const d = STATE_CENTROIDS[(destState || '').trim().toUpperCase()];
  if (!o || !d) return 0;
  const straight = haversineMiles(o, d);
  if (straight < 40) return 120; // intra-state haul floor
  return Math.round(straight * 1.2);
}
