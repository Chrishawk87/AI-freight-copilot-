import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoadBoardProvider, ProviderLoad } from './load-board.provider';

/**
 * Truckstop carrier load-search integration (LIVE, credential-gated).
 *
 * This is a real implementation of Truckstop's documented carrier LoadSearch
 * service — not a stub. It stays dormant until credentials are present, and the
 * moment they are set it pulls live freight into the same pipeline every other
 * screen already consumes (ProviderLoad → syncLoads → scoring → Daily Plan).
 *
 * ── Why SOAP ──────────────────────────────────────────────────────────────
 * Truckstop exposes two API families. The newer REST endpoints
 * (/loadmanagement/v2/...) let a BROKER search *their own posted* loads. The
 * open-board *carrier* search a driver actually needs ("find me loads to haul")
 * is the documented SOAP service: POST /v13/Searching/LoadSearch.svc, text/xml,
 * authenticated with the account Username, Password, and Integration ID.
 * Ref: developer.truckstop.com → "Search for loads".
 *
 * ── Getting credentials ───────────────────────────────────────────────────
 * Truckstop gates API credentials behind a signed Systems Integration Agreement
 * (SIA). There is no self-serve/sandbox key. Once the SIA is executed Truckstop
 * issues the username/password/integration-ID used below. Contact their
 * Integrations Team to start.
 *
 * ── Env vars ──────────────────────────────────────────────────────────────
 *   TRUCKSTOP_USERNAME         account username issued by Truckstop
 *   TRUCKSTOP_PASSWORD         account password
 *   TRUCKSTOP_INTEGRATION_ID   integration ID tied to the enabled web service
 *   TRUCKSTOP_SEARCH_STATES    (optional) comma list of origin states to scan,
 *                              e.g. "TX,GA,FL,CA". Defaults to a broad set.
 *   TRUCKSTOP_SOAP_URL         (optional) override the service endpoint.
 *
 * ── Confirm-on-first-connect ──────────────────────────────────────────────
 * The SOAP LoadSearchItem schema is only partially published outside the
 * partner portal. Field extraction below tries several documented aliases per
 * value and is namespace-agnostic, so it is resilient — but once real
 * credentials land, verify the element names against the account WSDL and trim
 * the alias lists. Every such spot is marked `CONFIRM:`.
 */
@Injectable()
export class TruckstopProvider implements LoadBoardProvider {
  readonly name = 'Truckstop';
  private readonly logger = new Logger('TruckstopProvider');

  private static readonly DEFAULT_SOAP_URL =
    'https://vs2.truckstop.com/v13/Searching/LoadSearch.svc';
  // A broad default origin scan so a fresh connection returns a national feed.
  private static readonly DEFAULT_STATES = [
    'TX', 'GA', 'FL', 'CA', 'IL', 'OH', 'PA', 'TN', 'NC', 'AZ',
  ];
  private static readonly PAGE_SIZE = 100;
  private static readonly MAX_PAGES = 3; // cap per state so a sync stays bounded

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return (
      !!this.config.get<string>('TRUCKSTOP_USERNAME') &&
      !!this.config.get<string>('TRUCKSTOP_PASSWORD') &&
      !!this.config.get<string>('TRUCKSTOP_INTEGRATION_ID')
    );
  }

  async fetchLoads(): Promise<ProviderLoad[]> {
    if (!this.isEnabled()) return [];

    const url =
      this.config.get<string>('TRUCKSTOP_SOAP_URL') ??
      TruckstopProvider.DEFAULT_SOAP_URL;
    const states = this.searchStates();

    // De-dupe across state scans (a load posted TX→GA shows up once).
    const byId = new Map<string, ProviderLoad>();

    for (const state of states) {
      for (let page = 1; page <= TruckstopProvider.MAX_PAGES; page++) {
        let items: string[];
        try {
          const xml = await this.callLoadSearch(url, state, page);
          items = this.splitItems(xml);
        } catch (e: any) {
          this.logger.error(
            `LoadSearch ${state} p${page} failed: ${e?.message ?? e}`,
          );
          break; // move to the next state rather than hammering a failing call
        }
        if (!items.length) break; // no more pages for this state
        for (const raw of items) {
          const load = this.mapItem(raw);
          if (load) byId.set(load.externalId, load);
        }
        if (items.length < TruckstopProvider.PAGE_SIZE) break; // last page
      }
    }

    const loads = [...byId.values()];
    this.logger.log(`Pulled ${loads.length} live loads from Truckstop`);
    return loads;
  }

  private searchStates(): string[] {
    const raw = this.config.get<string>('TRUCKSTOP_SEARCH_STATES');
    if (!raw) return TruckstopProvider.DEFAULT_STATES;
    return raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  /** Build + POST the SOAP LoadSearch request, return the raw XML body. */
  private async callLoadSearch(
    url: string,
    originState: string,
    page: number,
  ): Promise<string> {
    const body = this.buildEnvelope(originState, page);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        // CONFIRM: SOAPAction header value is service-specific; the account WSDL
        // lists the exact action URI for GetLoadSearchResults.
        SOAPAction:
          'http://webservices.truckstop.com/v12/ILoadSearch/GetLoadSearchResults',
        Accept: 'text/xml',
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    return res.text();
  }

  /**
   * SOAP envelope for a carrier load search. Credentials travel inside the
   * request per Truckstop's documented shape (Integration ID + account login).
   * CONFIRM: exact namespace URIs and the credential element names against the
   * account WSDL — they are stable across the v12 contract, but only the
   * *request* names must be exact (the response parser is alias-tolerant).
   */
  private buildEnvelope(originState: string, page: number): string {
    const username = this.esc(this.config.get<string>('TRUCKSTOP_USERNAME')!);
    const password = this.esc(this.config.get<string>('TRUCKSTOP_PASSWORD')!);
    const integrationId = this.esc(
      this.config.get<string>('TRUCKSTOP_INTEGRATION_ID')!,
    );
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:v12="http://webservices.truckstop.com/v12"
    xmlns:web="http://schemas.datacontract.org/2004/07/Truckstop.Searching.WebAPI.Models"
    xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
  <soapenv:Header/>
  <soapenv:Body>
    <v12:GetLoadSearchResults>
      <v12:searchRequest>
        <web:IntegrationId>${integrationId}</web:IntegrationId>
        <web:UserName>${username}</web:UserName>
        <web:Password>${password}</web:Password>
        <web:Criteria>
          <web:LoadType>Full</web:LoadType>
          <web:OriginState>${this.esc(originState)}</web:OriginState>
          <web:OriginCountry>USA</web:OriginCountry>
          <web:PageNumber>${page}</web:PageNumber>
          <web:PageSize>${TruckstopProvider.PAGE_SIZE}</web:PageSize>
          <web:SortField>Age</web:SortField>
          <web:SortDescending>false</web:SortDescending>
        </web:Criteria>
      </v12:searchRequest>
    </v12:GetLoadSearchResults>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  /** Slice the response into individual LoadSearchItem XML fragments. */
  private splitItems(xml: string): string[] {
    // Namespace-agnostic: matches <a:LoadSearchItem>, <LoadSearchItem>, etc.
    const re =
      /<(?:\w+:)?LoadSearchItem\b[^>]*>([\s\S]*?)<\/(?:\w+:)?LoadSearchItem>/g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) out.push(m[1]);
    return out;
  }

  /** Map one LoadSearchItem fragment into our normalized ProviderLoad. */
  private mapItem(item: string): ProviderLoad | null {
    // CONFIRM: element aliases against the account WSDL; extras are harmless.
    const externalId = this.pick(item, ['LoadId', 'Id', 'LoadID']);
    if (!externalId) return null;

    const rate = this.num(this.pick(item, ['Payment', 'Rate', 'PostedRate']));
    const miles = this.num(
      this.pick(item, ['Mileage', 'Miles', 'LoadedMiles', 'Distance']),
    );
    // A load with no rate or no miles can't be scored meaningfully — skip it so
    // the Profitability Engine never divides by zero downstream.
    if (rate <= 0 || miles <= 0) return null;

    const equipment =
      this.pick(item, ['EquipmentType', 'Equipment', 'TrailerType']) ||
      'Unknown';
    const originCity = this.pick(item, ['OriginCity', 'PickupCity']);
    const originState = this.pick(item, ['OriginState', 'PickupState']);
    const destCity = this.pick(item, [
      'DestinationCity',
      'DestCity',
      'DeliveryCity',
    ]);
    const destState = this.pick(item, [
      'DestinationState',
      'DestState',
      'DeliveryState',
    ]);
    const weightLbs = this.num(this.pick(item, ['Weight', 'WeightLbs']));
    const broker =
      this.pick(item, [
        'Company',
        'CompanyName',
        'Broker',
        'PostersReference',
      ]) || 'Truckstop broker';
    // Truckstop exposes broker credit as a score / "days to pay"; map it onto a
    // 0..5 rating so it lines up with the rest of the app's UI.
    const brokerRating = this.creditToRating(
      this.pick(item, ['CreditRating', 'CreditScore', 'DaysToPay']),
    );
    const pickupDate = this.pick(item, [
      'PickupDate',
      'PickUpDate',
      'EarliestPickup',
    ]);
    const ageMinutes = this.num(this.pick(item, ['Age', 'AgeMinutes']));

    const { demandIndex, reloadIndex } = this.deriveIndices(
      rate,
      miles,
      ageMinutes,
    );

    return {
      externalId: `TS-${externalId}`,
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
      source: 'Truckstop',
      demandIndex,
      reloadIndex,
      isReloadPool: false,
    };
  }

  /**
   * Derive the two market signals the scoring model consumes from REAL data
   * rather than planting them:
   *  - demandIndex: rate-per-mile relative to a healthy baseline, nudged up when
   *    the posting is fresh (low age) since fresh + well-paid lanes are the ones
   *    actually moving.
   *  - reloadIndex: a single open-board search can't observe outbound density at
   *    the destination, so we start neutral (50) and let the learning loop
   *    calibrate it per carrier from real booking outcomes. Honest default, not
   *    a fabricated number.
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

  /** First non-empty inner text among candidate element names (any namespace). */
  private pick(item: string, names: string[]): string {
    for (const name of names) {
      const re = new RegExp(
        `<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
        'i',
      );
      const m = re.exec(item);
      if (m) {
        const val = m[1].trim();
        if (val && !/nil="true"/i.test(val)) return this.unesc(val);
      }
    }
    return '';
  }

  private num(v: string): number {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  /** Map a Truckstop credit signal onto a 0..5 star-style rating. */
  private creditToRating(v: string): number {
    const n = this.num(v);
    if (!n) return 4.0; // neutral default when the field is absent
    // Credit score (0..100) → 0..5. If it looks like days-to-pay instead
    // (typically 15–45), invert: faster pay = better.
    if (n > 5 && n <= 100) return Math.round((n / 100) * 5 * 10) / 10;
    if (n > 100) return 5; // very high score
    return clampRating(5 - Math.max(0, (n - 20) / 10)); // days-to-pay fallback
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private unesc(s: string): string {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
function clampRating(n: number): number {
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}
