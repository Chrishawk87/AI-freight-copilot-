// The contract every load-board integration implements.
// When you get DAT / Truckstop / Uber Freight credentials, write a class
// that implements this interface and register it in integrations.module.ts.
// No other code needs to change.

export interface ProviderLoad {
  externalId: string;
  equipment: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  miles: number;
  deadheadMiles: number;
  rate: number;
  weightLbs: number;
  broker: string;
  brokerRating: number;
  pickupDate: string;
  source: string;
  demandIndex: number;
  reloadIndex: number;
  isReloadPool?: boolean;
}

export interface LoadBoardProvider {
  /** Human name of the source, e.g. "DAT". */
  readonly name: string;
  /** Whether this provider is configured (has credentials). */
  isEnabled(): boolean;
  /** Fetch currently available loads. */
  fetchLoads(): Promise<ProviderLoad[]>;
}

export const LOAD_BOARD_PROVIDERS = Symbol('LOAD_BOARD_PROVIDERS');
