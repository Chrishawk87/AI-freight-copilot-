import { Connector, ConnectorContext, SyncResult, TestResult } from './connector';

// ── Generic connector ───────────────────────────────────────────────────────
// The uniform slot every provider gets by default. It validates that a required
// credential is present (when the catalog says one is needed), stores the
// connection, and reports honestly that live data sync isn't wired yet. When we
// build a real integration for a provider we register it below and this stops
// being used for that id — with zero change anywhere else.
class GenericConnector implements Connector {
  readonly live = false;
  constructor(
    readonly id: string,
    readonly label: string,
    readonly needsCredential: boolean,
  ) {}

  async test(ctx: ConnectorContext): Promise<TestResult> {
    if (this.needsCredential) {
      const hasKey = Object.values(ctx.creds || {}).some(
        (v) => typeof v === 'string' && v.trim().length > 0,
      );
      if (!hasKey) {
        return { ok: false, message: 'A key or credential is required to connect.' };
      }
    }
    return { ok: true, message: 'Connected. Live data sync turns on as this integration is wired.' };
  }

  async sync(): Promise<SyncResult> {
    // No live pull yet — the slot is held, ready to light up.
    return { ok: true, itemsSynced: 0, message: 'Connection saved; live sync pending integration.' };
  }
}

// ── Map-provider connector ──────────────────────────────────────────────────
// A genuinely working per-carrier connection today: the carrier supplies their
// own map/routing API key. We validate it's present and well-formed; the
// Navigation screen then switches to that engine for this carrier only. No
// shared/global key, so it scales per tenant.
class MapKeyConnector implements Connector {
  readonly live = true;
  readonly needsCredential = true;
  constructor(
    readonly id: string,
    readonly label: string,
    private readonly minLen = 12,
  ) {}

  private key(ctx: ConnectorContext): string {
    const c = ctx.creds || {};
    return String(c.apiKey ?? c.key ?? c.token ?? '').trim();
  }

  async test(ctx: ConnectorContext): Promise<TestResult> {
    const k = this.key(ctx);
    if (!k) return { ok: false, message: `Paste your ${this.label} API key to connect.` };
    if (k.length < this.minLen) {
      return { ok: false, message: 'That key looks too short — double-check you copied all of it.' };
    }
    return { ok: true, message: `${this.label} key saved. Navigation will use your account.` };
  }

  async sync(): Promise<SyncResult> {
    // Map keys don't ingest rows; they switch the routing engine on read.
    return { ok: true, itemsSynced: 0, message: `${this.label} active for navigation.` };
  }
}

// ── Registry ────────────────────────────────────────────────────────────────
// Real connectors registered here override the generic slot for their id.
const REAL_CONNECTORS: Connector[] = [
  new MapKeyConnector('googlemaps', 'Google Maps'),
  new MapKeyConnector('trimble', 'Trimble Maps'),
  new MapKeyConnector('herewego', 'HERE'),
];

const REAL_BY_ID = new Map<string, Connector>(REAL_CONNECTORS.map((c) => [c.id, c]));

// Providers we know require a credential to connect (used when falling back to
// the generic connector). Anything not listed connects without a key.
const KEYED_PROVIDERS = new Set<string>([
  'googlemaps',
  'trimble',
  'herewego',
  'anthropic',
  'elevenlabs',
  'ocr',
  'quickbooks',
  'xero',
  'samsara',
  'motive',
  'geotab',
]);

export function getConnector(providerId: string, label?: string): Connector {
  const real = REAL_BY_ID.get(providerId);
  if (real) return real;
  return new GenericConnector(
    providerId,
    label || providerId,
    KEYED_PROVIDERS.has(providerId),
  );
}

export function isLiveConnector(providerId: string): boolean {
  return REAL_BY_ID.has(providerId);
}
