import { Injectable, Logger } from '@nestjs/common';

// Official EIA on-highway diesel regions (PADD sub-regions as EIA reports them).
export type DieselRegion =
  | 'national'
  | 'newEngland'
  | 'centralAtlantic'
  | 'lowerAtlantic'
  | 'midwest'
  | 'gulfCoast'
  | 'rockies'
  | 'westCoast'
  | 'california';

const REGION_LABEL: Record<DieselRegion, string> = {
  national: 'U.S. National',
  newEngland: 'New England',
  centralAtlantic: 'Central Atlantic',
  lowerAtlantic: 'Lower Atlantic',
  midwest: 'Midwest',
  gulfCoast: 'Gulf Coast',
  rockies: 'Rocky Mountain',
  westCoast: 'West Coast',
  california: 'California',
};

// EIA "duoarea" codes for weekly on-highway diesel (product EPD2D).
const REGION_DUOAREA: Record<DieselRegion, string> = {
  national: 'NUS',
  newEngland: 'R1X',
  centralAtlantic: 'R1Y',
  lowerAtlantic: 'R1Z',
  midwest: 'R20',
  gulfCoast: 'R30',
  rockies: 'R40',
  westCoast: 'R50',
  california: 'R5XCA',
};
const DUOAREA_REGION: Record<string, DieselRegion> = Object.fromEntries(
  Object.entries(REGION_DUOAREA).map(([r, code]) => [code, r as DieselRegion]),
) as Record<string, DieselRegion>;

// State → EIA region. California is broken out from the West Coast by EIA.
const STATE_REGION: Record<string, DieselRegion> = {};
const assign = (states: string[], region: DieselRegion) =>
  states.forEach((s) => (STATE_REGION[s] = region));
assign(['CT', 'ME', 'MA', 'NH', 'RI', 'VT'], 'newEngland');
assign(['DE', 'DC', 'MD', 'NJ', 'NY', 'PA'], 'centralAtlantic');
assign(['FL', 'GA', 'NC', 'SC', 'VA', 'WV'], 'lowerAtlantic');
assign(
  ['IL', 'IN', 'IA', 'KS', 'KY', 'MI', 'MN', 'MO', 'NE', 'ND', 'OH', 'OK', 'SD', 'TN', 'WI'],
  'midwest',
);
assign(['AL', 'AR', 'LA', 'MS', 'NM', 'TX'], 'gulfCoast');
assign(['CO', 'ID', 'MT', 'UT', 'WY'], 'rockies');
assign(['CA'], 'california');
assign(['AK', 'AZ', 'HI', 'NV', 'OR', 'WA'], 'westCoast');

export function regionForState(state?: string | null): DieselRegion {
  if (!state) return 'national';
  return STATE_REGION[state.toUpperCase().trim()] ?? 'national';
}

// Baked-in official EIA weekly numbers so pricing is functional with zero
// configuration. Refreshed automatically from the EIA API when EIA_API_KEY is
// set (see refresh()). Source: EIA Gasoline & Diesel Fuel Update, wk of 7/14/26.
const EIA_FALLBACK: Record<DieselRegion, number> = {
  national: 4.796,
  newEngland: 5.189,
  centralAtlantic: 5.204,
  lowerAtlantic: 4.748,
  midwest: 4.659,
  gulfCoast: 4.546,
  rockies: 4.6,
  westCoast: 5.55,
  california: 6.126,
};

@Injectable()
export class FuelPricesService {
  private readonly logger = new Logger(FuelPricesService.name);
  private prices: Record<DieselRegion, number> = { ...EIA_FALLBACK };
  private asOf = 'wk of 7/14/26'; // human label for the current data vintage
  private lastFetch = 0;
  private live = false;

  regionLabel(region: DieselRegion): string {
    return REGION_LABEL[region];
  }

  /** Current diesel price for a region (auto-refreshes at most weekly). */
  async priceFor(region: DieselRegion): Promise<number> {
    await this.refreshIfStale();
    return this.prices[region] ?? this.prices.national;
  }

  async national(): Promise<number> {
    await this.refreshIfStale();
    return this.prices.national;
  }

  async snapshot() {
    await this.refreshIfStale();
    return { prices: { ...this.prices }, asOf: this.asOf, live: this.live };
  }

  private async refreshIfStale() {
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - this.lastFetch < WEEK) return;
    this.lastFetch = Date.now();
    const key = process.env.EIA_API_KEY;
    if (!key) return; // stay on baked-in official numbers
    try {
      await this.fetchEia(key);
      this.live = true;
    } catch (e: any) {
      this.logger.warn(`EIA price refresh failed, using cached: ${e?.message}`);
    }
  }

  // EIA API v2 — one request for all regions, keep the latest period per region.
  private async fetchEia(apiKey: string) {
    const params = new URLSearchParams();
    params.set('api_key', apiKey);
    params.set('frequency', 'weekly');
    params.append('data[0]', 'value');
    params.append('facets[product][]', 'EPD2D');
    Object.values(REGION_DUOAREA).forEach((code) =>
      params.append('facets[duoarea][]', code),
    );
    params.set('sort[0][column]', 'period');
    params.set('sort[0][direction]', 'desc');
    params.set('length', '60');
    const url = `https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
    const json: any = await res.json();
    const rows: any[] = json?.response?.data ?? [];
    if (!rows.length) throw new Error('EIA empty');

    const next: Partial<Record<DieselRegion, number>> = {};
    let latestPeriod = '';
    for (const row of rows) {
      const region = DUOAREA_REGION[row.duoarea];
      const value = Number(row.value);
      if (!region || !Number.isFinite(value)) continue;
      if (next[region] == null) next[region] = value; // rows are period-desc
      if (row.period > latestPeriod) latestPeriod = row.period;
    }
    if (next.national == null) throw new Error('EIA missing national');
    this.prices = { ...this.prices, ...next };
    if (latestPeriod) this.asOf = `wk of ${latestPeriod}`;
  }
}
