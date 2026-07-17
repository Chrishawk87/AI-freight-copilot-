import { Injectable, Logger } from '@nestjs/common';

/**
 * Per-city diesel price enrichment via Tavily search.
 *
 * The free base (EIA) only gives one price per broad region, so every station
 * in a region shows the same number. This layer uses Tavily to pull a genuinely
 * local diesel average for the driver's city/state (AAA reports per-city and
 * per-state diesel averages), giving prices that actually differ by area.
 *
 * Gated entirely on TAVILY_API_KEY — with no key the caller keeps the EIA
 * regional price and reports priceEnriched=false. Results are cached per
 * city/state for a day so we make at most one Tavily call per area per day.
 */
@Injectable()
export class FuelScrapeService {
  private readonly logger = new Logger(FuelScrapeService.name);
  private readonly cache = new Map<string, { price: number | null; at: number }>();
  private readonly DAY = 24 * 60 * 60 * 1000;

  enabled(): boolean {
    return !!process.env.TAVILY_API_KEY;
  }

  /** Local diesel average for a city/state, or null if unavailable. */
  async cityDieselPrice(
    city?: string | null,
    state?: string | null,
  ): Promise<number | null> {
    const key = process.env.TAVILY_API_KEY;
    if (!key || !state) return null;

    const cacheKey = `${city ?? ''}|${state}`.toLowerCase().trim();
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < this.DAY) return hit.price;

    let price: number | null = null;
    try {
      price = await this.tavilyDiesel(key, city, state);
    } catch (e: any) {
      this.logger.warn(`Tavily diesel lookup failed (${cacheKey}): ${e?.message}`);
    }
    // Cache even nulls briefly to avoid hammering on repeated misses.
    this.cache.set(cacheKey, { price, at: Date.now() });
    return price;
  }

  private async tavilyDiesel(
    apiKey: string,
    city: string | null | undefined,
    state: string,
  ): Promise<number | null> {
    const place = city ? `${city}, ${state}` : state;
    const query = `current average diesel fuel price per gallon in ${place} today`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          include_answer: true,
          max_results: 5,
          include_domains: ['gasprices.aaa.com', 'aaa.com'],
        }),
      });
      if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
      const json: any = await res.json();

      const texts: string[] = [];
      if (typeof json?.answer === 'string') texts.push(json.answer);
      for (const r of json?.results ?? []) {
        if (typeof r?.content === 'string') texts.push(r.content);
      }
      return extractDieselPrice(texts.join('  '));
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Pull a plausible diesel price ($/gal) out of free text. Prefers a number
 * that sits next to the word "diesel"; falls back to the first sane fuel price.
 */
export function extractDieselPrice(text: string): number | null {
  if (!text) return null;
  const sane = (n: number) => n >= 2.5 && n <= 8;

  // Prefer "$X.XXX" that appears near "diesel".
  const near = /diesel[^$]{0,40}\$?\s*(\d(?:\.\d{2,3}))|\$?\s*(\d(?:\.\d{2,3}))[^$]{0,20}diesel/gi;
  let m: RegExpExecArray | null;
  while ((m = near.exec(text))) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isFinite(n) && sane(n)) return round3(n);
  }

  // Fallback: any $X.XX(X) in a sane fuel-price range.
  const any = /\$\s*(\d\.\d{2,3})/g;
  while ((m = any.exec(text))) {
    const n = Number(m[1]);
    if (sane(n)) return round3(n);
  }
  return null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
