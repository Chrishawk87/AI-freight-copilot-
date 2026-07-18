import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoadBoardProvider, ProviderLoad } from './load-board.provider';

/**
 * 123Loadboard carrier load-search integration (LIVE, credential-gated).
 *
 * A real implementation of 123Loadboard's partner REST API — not a stub. It
 * stays dormant until credentials are present, and the moment they are set it
 * pulls live freight into the same pipeline every other screen already consumes
 * (ProviderLoad → syncLoads → scoring → Daily Plan).
 *
 * ── Why REST/OAuth ─────────────────────────────────────────────────────────
 * 123Loadboard exposes a JSON REST partner API (search loads, check rates, post
 * trucks) secured with OAuth2 client-credentials: exchange a client id/secret
 * for a bearer token, then call the load search endpoint. Ref: the partner
 * developer portal shared after onboarding.
 *
 * ── Getting credentials ────────────────────────────────────────────────────
 * There is no self-serve/sandbox key. Access is granted through the partner
 * program (partner-integrations@123loadboard.com), which assigns a technical
 * lead and issues the client id/secret used below.
 *
 * ── Rate limits ────────────────────────────────────────────────────────────
 * The partner usage agreement caps searches (≈100/user/hr, 300/day, 2000/month)
 * and returns up to 400 results per search. We scan a bounded set of origin
 * states, one search each, and page conservatively so a single sync stays well
 * inside those limits. The token is cached and reused until it expires.
 *
 * ── Confirm-on-first-connect ───────────────────────────────────────────────
 * The exact JSON field names aren't fully published outside the partner portal,
 * so field extraction is alias-tolerant — it tries several documented names per
 * value. Once real credentials land, verify the names against a real response
 * and trim the alias lists. Every such spot is marked `CONFIRM:`.
 */
@Injectable()
export class Loadboard123Provider implements LoadBoardProvider {
  readonly name = '123Loadboard';
  private readonly logger = new Logger('Loadboard123Provider');

  private static readonly DEFAULT_BASE_URL = 'https://api.123loadboard.com';
  private static readonly DEFAULT_TOKEN_URL =
    'https://api.123loadboard.com/oauth2/token';
  // A broad default origin scan so a fresh connection returns a national feed.
  private static readonly DEFAULT_STATES = [
    'TX', 'GA', 'FL', 'CA', 'IL', 'OH', 'PA', 'TN', 'NC', 'AZ',
  ];
  private static readonly PAGE_SIZE = 100;
  private static readonly MAX_PAGES = 2; // cap per state so a sync stays bounded

  // Cached bearer token so we don't re-auth on every state scan / sync.
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    // Support both a single API key and OAuth2 client-credentials, whichever the
    // partner account is issued. Either alone flips the provider live.
    return (
      !!this.config.get<string>('LOADBOARD123_API_KEY') ||
      (!!this.config.get<string>('LOADBOARD123_CLIENT_ID') &&
        !!this.config.get<string>('LOADBOARD123_CLIENT_SECRET'))
    );
  }

  async fetchLoads(): Promise<ProviderLoad[]> {
    if (!this.isEnabled()) return [];

    let auth: string;
    try {
      auth = await this.authHeader();
    } catch (e: any) {
      this.logger.error(`123Loadboard auth failed: ${e?.message ?? e}`);
      return [];
    }

    const base =
      this.config.get<string>('LOADBOARD123_BASE_URL') ??
      Loadboard123Provider.DEFAULT_BASE_URL;
    const states = this.searchStates();

    // De-dupe across state scans (a load posted TX→GA shows up once).
    const byId = new Map<string, ProviderLoad>();

    for (const state of states) {
      for (let page = 1; page <= Loadboard123Provider.MAX_PAGES; page++) {
        let items: any[];
        try {
          items = await this.callSearch(base, auth, state, page);
        } catch (e: any) {
          this.logger.error(
            `Search ${state} p${page} failed: ${e?.message ?? e}`,
          );
          break; // move to the next state rather than hammering a failing call
        }
        if (!items.length) break; // no more pages for this state
        for (const raw of items) {
          const load = this.mapItem(raw);
          if (load) byId.set(load.externalId, load);
        }
        if (items.length < Loadboard123Provider.PAGE_SIZE) break; // last page
      }
    }

    const loads = [...byId.values()];
    this.logger.log(`Pulled ${loads.length} live loads from 123Loadboard`);
    return loads;
  }

  private searchStates(): string[] {
    const raw = this.config.get<string>('LOADBOARD123_SEARCH_STATES');
    if (!raw) return Loadboard123Provider.DEFAULT_STATES;
    return raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  /**
   * Return an `Authorization` header value. Prefers a static API key when one is
   * configured; otherwise runs an OAuth2 client-credentials exchange and caches
   * the bearer token until it expires.
   */
  private async authHeader(): Promise<string> {
    const apiKey = this.config.get<string>('LOADBOARD123_API_KEY');
    if (apiKey) return `Bearer ${apiKey}`;

    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt) {
      return `Bearer ${this.token}`;
    }

    const tokenUrl =
      this.config.get<string>('LOADBOARD123_TOKEN_URL') ??
      Loadboard123Provider.DEFAULT_TOKEN_URL;
    const clientId = this.config.get<string>('LOADBOARD123_CLIENT_ID')!;
    const clientSecret = this.config.get<string>('LOADBOARD123_CLIENT_SECRET')!;

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        // CONFIRM: the scope string for load search against the partner portal.
        scope: 'loads.read',
      }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`token HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const token = json.access_token ?? json.accessToken;
    if (!token) throw new Error('token response missing access_token');
    // Refresh a minute early to avoid using a token mid-expiry.
    const ttl = this.num(json.expires_in ?? json.expiresIn) || 3600;
    this.token = token;
    this.tokenExpiresAt = now + (ttl - 60) * 1000;
    return `Bearer ${token}`;
  }

  /** Call the load-search endpoint, return the raw array of load objects. */
  private async callSearch(
    base: string,
    auth: string,
    originState: string,
    page: number,
  ): Promise<any[]> {
    // CONFIRM: endpoint path + query param names against the partner portal.
    const params = new URLSearchParams({
      originState,
      originCountry: 'USA',
      pageNumber: String(page),
      pageSize: String(Loadboard123Provider.PAGE_SIZE),
      sortBy: 'age',
    });
    const url = `${base}/loads/search?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    if (res.status === 401 || res.status === 403) {
      // Token may have gone stale between scans — drop it so the next call
      // re-auths, and surface the failure for this page.
      this.token = null;
      this.tokenExpiresAt = 0;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const json: any = await res.json();
    // Alias-tolerant: the array may live under any of these keys.
    const arr =
      json.loads ??
      json.results ??
      json.data ??
      json.items ??
      (Array.isArray(json) ? json : []);
    return Array.isArray(arr) ? arr : [];
  }

  /** Map one 123Loadboard load object into our normalized ProviderLoad. */
  private mapItem(l: any): ProviderLoad | null {
    // CONFIRM: field aliases against a real response; extras are harmless.
    const externalId = this.first(l, ['id', 'loadId', 'loadID', 'referenceId']);
    if (!externalId) return null;

    const rate = this.num(
      this.first(l, ['rate', 'payment', 'price', 'postedRate', 'totalRate']),
    );
    const miles = this.num(
      this.first(l, ['miles', 'mileage', 'loadedMiles', 'distance']),
    );
    // A load with no rate or no miles can't be scored meaningfully — skip it so
    // the Profitability Engine never divides by zero downstream.
    if (rate <= 0 || miles <= 0) return null;

    const origin = this.obj(l, ['origin', 'pickup', 'from']);
    const dest = this.obj(l, ['destination', 'delivery', 'dropoff', 'to']);

    const equipment =
      this.first(l, ['equipmentType', 'equipment', 'trailerType']) || 'Unknown';
    const originCity = this.first(
      { ...l, ...origin },
      ['originCity', 'city', 'pickupCity'],
    );
    const originState = this.first(
      { ...l, ...origin },
      ['originState', 'state', 'pickupState'],
    );
    const destCity = this.first(
      { ...l, ...dest },
      ['destinationCity', 'destCity', 'city', 'deliveryCity'],
    );
    const destState = this.first(
      { ...l, ...dest },
      ['destinationState', 'destState', 'state', 'deliveryState'],
    );
    const weightLbs = this.num(this.first(l, ['weight', 'weightLbs', 'weightPounds']));
    const broker =
      this.first(l, ['company', 'companyName', 'broker', 'brokerName', 'poster']) ||
      '123Loadboard broker';
    const brokerRating = this.creditToRating(
      this.first(l, ['creditRating', 'creditScore', 'daysToPay', 'rating']),
    );
    const pickupDate = this.first(l, [
      'pickupDate',
      'pickUpDate',
      'earliestPickup',
      'availableDate',
    ]);
    const ageMinutes = this.num(this.first(l, ['ageMinutes', 'age']));

    const { demandIndex, reloadIndex } = this.deriveIndices(
      rate,
      miles,
      ageMinutes,
    );

    return {
      externalId: `123-${externalId}`,
      equipment,
      originCity,
      originState,
      destCity,
      destState,
      miles,
      // The board doesn't know where OUR truck sits, so deadhead to pickup is 0
      // here; the app computes real deadhead from the driver's GPS at plan time.
      deadheadMiles: 0,
      rate,
      weightLbs,
      broker,
      brokerRating,
      pickupDate,
      source: '123Loadboard',
      demandIndex,
      reloadIndex,
      isReloadPool: false,
    };
  }

  /**
   * Derive the two market signals the scoring model consumes from REAL data
   * rather than planting them:
   *  - demandIndex: rate-per-mile relative to a healthy baseline, nudged up when
   *    the posting is fresh (low age) since fresh + well-paid lanes are moving.
   *  - reloadIndex: a single open-board search can't observe outbound density at
   *    the destination, so we start neutral (50) and let the learning loop
   *    calibrate it per carrier from real booking outcomes.
   */
  private deriveIndices(
    rate: number,
    miles: number,
    ageMinutes: number,
  ): { demandIndex: number; reloadIndex: number } {
    const rpm = rate / miles;
    const rpmScore = clamp(((rpm - 1.0) / (3.0 - 1.0)) * 100); // $1–$3/mi → 0–100
    // Fresh (<60 min) = full weight; decays over ~12h.
    const freshness = clamp(100 - (ageMinutes / 720) * 100);
    const demandIndex = Math.round(clamp(0.7 * rpmScore + 0.3 * freshness));
    return { demandIndex, reloadIndex: 50 };
  }

  // ── small dependency-free helpers ─────────────────────────────────────────

  /** First non-empty value among candidate keys (case-insensitive). */
  private first(obj: any, keys: string[]): string {
    if (!obj || typeof obj !== 'object') return '';
    const lower: Record<string, any> = {};
    for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
    for (const key of keys) {
      const v = lower[key.toLowerCase()];
      if (v !== undefined && v !== null && v !== '') return String(v).trim();
    }
    return '';
  }

  /** First candidate key whose value is a nested object, else {}. */
  private obj(obj: any, keys: string[]): any {
    if (!obj || typeof obj !== 'object') return {};
    const lower: Record<string, any> = {};
    for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
    for (const key of keys) {
      const v = lower[key.toLowerCase()];
      if (v && typeof v === 'object') return v;
    }
    return {};
  }

  private num(v: any): number {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  /** Map a credit signal onto a 0..5 star-style rating. */
  private creditToRating(v: any): number {
    const n = this.num(v);
    if (!n) return 4.0; // neutral default when the field is absent
    if (n > 5 && n <= 100) return Math.round((n / 100) * 5 * 10) / 10;
    if (n > 100) return 5; // very high score
    return clampRating(5 - Math.max(0, (n - 20) / 10)); // days-to-pay fallback
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
function clampRating(n: number): number {
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}
