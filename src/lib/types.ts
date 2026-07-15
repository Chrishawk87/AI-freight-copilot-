export type Equipment =
  | "Dry Van"
  | "Reefer"
  | "Flatbed"
  | "Step Deck"
  | "Power Only"
  | "Box Truck"
  | "Hotshot"
  | "Sprinter Van"
  | "Tanker"
  | "Auto Transport"
  | "Specialized"
  | "Local & Final-Mile";

export type Recommendation = "Accept" | "Consider" | "Avoid";

export interface Load {
  id: string;
  externalId?: string;
  equipment: Equipment;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  miles: number;
  deadheadMiles: number;
  rate: number; // total line-haul $
  weightLbs: number;
  broker: string;
  brokerRating: number; // 0-5
  pickupDate: string; // ISO
  source: string; // load board
  demandIndex: number; // 0-100 lane demand
  reloadIndex: number; // 0-100 destination reload availability
}

export interface Scores {
  profit: number;
  deadhead: number;
  reload: number;
  market: number;
  fuel: number;
}

export interface ScoredLoad extends Load {
  rpm: number; // rate per mile (loaded)
  allInRpm: number; // rate per (loaded + deadhead)
  fuelCost: number;
  fixedCost: number;
  totalCost: number;
  netProfit: number;
  scores: Scores;
  overall: number;
  recommendation: Recommendation;
}

export interface CarrierProfile {
  companyName: string;
  dotNumber: string;
  mcNumber: string;
  insuranceProvider: string;
  insuranceExpiry: string;
  w9OnFile: boolean;
  drivers: { name: string; cdlClass: string; status: string }[];
  equipment: { type: Equipment; unit: string; year: number }[];
  serviceAreas: string[];
  mpg: number;
  fixedCostPerMile: number;
}
