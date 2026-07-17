// Shared types + presentation metadata for the Truck Map & Fuel Intelligence
// module. Mirrors the backend `PoiOut` shape served by GET /truckmap/poi.

export type TruckPoiCategory =
  | "fuel"
  | "parking"
  | "rest_area"
  | "weigh_station"
  | "repair"
  | "services";

export interface TruckMapPoi {
  id: string;
  source: string;
  category: TruckPoiCategory;
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  address: string | null;
  hours: string | null;
  hgv: boolean;
  diesel: boolean;
  parkingSpaces: number | null;
  price: number | null;
  distanceMi: number;
}

export interface TruckMapPoiResponse {
  pois: TruckMapPoi[];
  count: number;
}

// Color + label + single-letter glyph for each category's map marker and the
// layer control. Colors align with the MapLibre POI palette already in use.
export const TRUCK_CATEGORY_META: Record<
  TruckPoiCategory,
  { label: string; color: string; glyph: string }
> = {
  fuel: { label: "Fuel", color: "#16C784", glyph: "F" },
  parking: { label: "Truck parking", color: "#F472B6", glyph: "P" },
  rest_area: { label: "Rest area", color: "#38BDF8", glyph: "R" },
  weigh_station: { label: "Weigh station", color: "#F59E0B", glyph: "W" },
  repair: { label: "Repair", color: "#FB7185", glyph: "M" },
  services: { label: "Services", color: "#A78BFA", glyph: "S" },
};

export const TRUCK_CATEGORY_ORDER: TruckPoiCategory[] = [
  "fuel",
  "parking",
  "rest_area",
  "weigh_station",
  "repair",
  "services",
];
