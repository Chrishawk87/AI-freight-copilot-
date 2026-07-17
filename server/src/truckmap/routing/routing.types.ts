export type LatLon = { lat: number; lon: number };

// Vehicle profile passed to a truck-aware routing engine. All optional so a
// missing profile cleanly degrades to car routing.
export type VehicleProfile = {
  heightIn?: number;
  widthIn?: number;
  lengthIn?: number;
  weightLbs?: number;
  axles?: number;
  hazmatClass?: string | null;
};

// One turn-by-turn instruction along the route.
export type NavStep = {
  text: string;
  road: string;
  distanceMi: number;
  lat: number;
  lon: number;
  type: string;
  modifier?: string;
};

export type RouteResult = {
  coords: [number, number][]; // [lon, lat] polyline
  miles: number;
  hours: number;
  steps: NavStep[];
  engine: "ors-hgv" | "osrm";
  truckLegal: boolean; // true only when a truck engine honored the profile
};

// A routing engine adapter. ORS / Valhalla / (paid) Trimble / HERE all satisfy
// this so a carrier can be flipped to a certified engine without a rewrite.
export interface RoutingProvider {
  readonly name: string;
  isEnabled(): boolean;
  supportsTruck(): boolean;
  route(
    origin: LatLon,
    dest: LatLon,
    vehicle?: VehicleProfile,
  ): Promise<RouteResult>;
}

// Unit helpers — routing engines want metric.
export const IN_TO_M = 0.0254;
export const LBS_TO_TONNES = 0.000453592;
