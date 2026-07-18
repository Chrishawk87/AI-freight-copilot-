import { PrismaService } from '../prisma/prisma.service';

// A uniform contract every plugin connection speaks. The Plugin Engine has ~80
// apps across load boards, TMS, ELD, accounting, factoring, fuel and more. We do
// NOT hand-wire 80 bespoke backends. Instead every provider is one Connector:
//   • test()  — validate the carrier's credentials for this provider
//   • sync()  — pull THAT carrier's data into our DB (no-op until wired live)
// Providers we haven't integrated yet fall back to GenericConnector, which
// stores the connection uniformly and lights up the instant a real connector is
// registered for its id — no schema or controller change required.

export interface ConnectorContext {
  carrierId: string;
  // Decrypted credentials for this carrier+provider (e.g. { apiKey, accountId }).
  creds: Record<string, any>;
  // Non-secret connection config (selected options, labels).
  config: Record<string, any> | null;
  prisma: PrismaService;
}

export interface TestResult {
  ok: boolean;
  message?: string;
}

export interface SyncResult {
  ok: boolean;
  itemsSynced?: number;
  message?: string;
}

export interface Connector {
  readonly id: string; // plugin id, matches the frontend catalog
  readonly label: string;
  // true = a real per-carrier integration pulls live data in sync().
  // false = uniform slot: we hold the connection until the integration is wired.
  readonly live: boolean;
  // Does this provider require the carrier to supply a credential/key?
  readonly needsCredential: boolean;
  test(ctx: ConnectorContext): Promise<TestResult>;
  sync(ctx: ConnectorContext): Promise<SyncResult>;
}
