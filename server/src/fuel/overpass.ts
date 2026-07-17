import { Logger } from '@nestjs/common';

const logger = new Logger('Overpass');

export type OverpassStation = {
  osmId: string;
  name: string;
  brand: string; // normalized to our known networks where possible
  network: string;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  address: string | null;
  diesel: boolean;
  hgv: boolean; // truck-friendly (heavy goods vehicle access)
};

// Map raw OSM name/brand text onto the networks we style with colored pins.
const BRAND_ALIASES: Array<[RegExp, string]> = [
  [/love'?s/i, "Love's"],
  [/pilot|flying ?j/i, 'Pilot'],
  [/\bta\b|travelcenters?|petro/i, 'TA'],
  [/quiktrip|\bqt\b/i, 'QT'],
  [/buc-?ee/i, "Buc-ee's"],
  [/road ?ranger/i, 'Road Ranger'],
  [/sapp bros/i, 'Sapp Bros'],
  [/kwik ?trip|kwik ?star/i, 'Kwik Trip'],
];

function normalizeBrand(name: string, brand: string): string {
  const hay = `${brand} ${name}`;
  for (const [re, label] of BRAND_ALIASES) if (re.test(hay)) return label;
  return brand || name || 'Independent';
}

// Free reverse geocode of the driver's position to a US state (one call).
export async function reverseStateOf(
  lat: number,
  lon: number,
): Promise<{ state: string | null; city: string | null }> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=8&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'AI-Freight-CoPilot/1.0 (fuel locator)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const json: any = await res.json();
    const a = json?.address ?? {};
    const state: string | null = STATE_ABBR[a.state] ?? a['ISO3166-2-lvl4']?.split('-')?.[1] ?? null;
    return { state, city: a.city ?? a.town ?? a.village ?? a.county ?? null };
  } catch (e: any) {
    logger.warn(`reverseStateOf failed: ${e?.message}`);
    return { state: null, city: null };
  }
}

// Real fuel stations near a point, via the free OpenStreetMap Overpass API.
export async function findFuelStationsNear(
  lat: number,
  lon: number,
  radiusMeters = 80000,
): Promise<OverpassStation[]> {
  const q = `[out:json][timeout:25];
(
  node["amenity"="fuel"](around:${radiusMeters},${lat},${lon});
);
out body 120;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'AI-Freight-CoPilot/1.0 (fuel locator)',
    },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json: any = await res.json();
  const elements: any[] = json?.elements ?? [];

  const out: OverpassStation[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const name: string = t.name || t.brand || t.operator || '';
    if (!name) continue; // skip unnamed pumps — not useful to a driver
    const brand: string = t.brand || t.operator || '';
    const diesel = t['fuel:diesel'] !== 'no' && t['fuel:HGV_diesel'] !== 'no';
    const hgv = t.hgv === 'yes' || t['fuel:HGV_diesel'] === 'yes' || t.access === 'hgv';
    const addressParts = [t['addr:housenumber'], t['addr:street']].filter(Boolean);
    out.push({
      osmId: `osm-${el.id}`,
      name,
      brand,
      network: normalizeBrand(name, brand),
      lat: el.lat,
      lon: el.lon,
      city: t['addr:city'] ?? null,
      state: t['addr:state'] ?? null,
      address: addressParts.length ? addressParts.join(' ') : null,
      diesel,
      hgv,
    });
  }
  return out;
}

// Full state name → USPS abbreviation (Nominatim returns full names).
const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
  Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
