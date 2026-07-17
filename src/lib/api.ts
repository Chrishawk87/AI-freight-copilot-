import type { ScoredLoad } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const TOKEN_KEY = "aifc_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = Array.isArray(body.message) ? body.message.join(", ") : body.message || msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- Types mirrored from the backend ----
export interface AuthCarrier {
  id: string;
  companyName: string;
  dotNumber?: string;
  mcNumber?: string;
  mpg?: number;
  fixedCostPerMile?: number;
}
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  carrierId: string | null;
  carrier?: AuthCarrier | null;
}
export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface CarrierDetail {
  id: string;
  companyName: string;
  contactEmail: string;
  // Per-carrier outbound email (their own provider). Password is never returned.
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  emailConnected: boolean; // carrier connected their OWN inbox (OAuth or SMTP)
  // One-click OAuth ("Connect Gmail/Outlook") — sends from the carrier's own
  // mailbox. Tokens are never returned; only the connected provider + address.
  oauthConnected?: boolean;
  oauthProvider?: string; // "google" | "microsoft" | ""
  oauthEmail?: string; // the connected mailbox address
  smtpConnected?: boolean; // legacy per-carrier SMTP (app password)
  platformEmailAvailable?: boolean; // shared platform sender configured server-side
  canSendEmail?: boolean; // emailConnected || platformEmailAvailable
  dotNumber: string;
  mcNumber: string;
  insuranceProvider: string;
  insuranceExpiry: string;
  w9OnFile: boolean;
  serviceAreas: string[];
  mpg: number;
  fixedCostPerMile: number;
  drivers: { id: string; name: string; cdlClass: string; status: string }[];
  equipment: { id: string; type: string; unit: string; year: number }[];
}

export interface CarrierLookup {
  companyName: string;
  dbaName: string;
  dotNumber: string;
  mcNumber: string;
  phyCity: string;
  phyState: string;
  powerUnits: number;
  drivers: number;
  allowedToOperate: string;
}

export interface DashboardResponse {
  weekly: {
    revenue: number;
    miles: number;
    deadheadMiles: number;
    netProfit: number;
    loadsCompleted: number;
  };
  topLoads: ScoredLoad[];
}

export interface FuelResponse {
  nationalAvg: number;
  regionPrice: number | null;
  region: string;
  regionLabel: string;
  priceAsOf: string;
  priceLive: boolean;
  priceEnriched: boolean;
  source: "live" | "fallback";
  stations: {
    id: string;
    name: string;
    city: string;
    state: string;
    price: number;
    distanceMi: number;
    onRoute: boolean;
    network: string;
    latitude: number | null;
    longitude: number | null;
    exit: string | null;
    address: string | null;
    priceEnriched?: boolean;
    hours?: string | null;
    hgv?: boolean;
    diesel?: boolean;
  }[];
}

export type PlaceCategory =
  | "fuel"
  | "rest_area"
  | "services"
  | "weigh_station"
  | "truck_parking";

export interface PlacePoi {
  osmId: string;
  name: string;
  category: PlaceCategory;
  label: string;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  hgv: boolean;
  distanceMi: number;
}
export interface PlacesResponse {
  places: PlacePoi[];
}

// ---- Truck Map module (unified POI store served from /truckmap/poi) ----
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

// ---- Truck routing (ORS driving-hgv w/ OSRM fallback) ----
export interface NavStep {
  text: string;
  road: string;
  distanceMi: number;
  lat: number;
  lon: number;
  type: string;
  modifier?: string;
}
export interface RouteResult {
  coords: [number, number][]; // [lon, lat] polyline
  miles: number;
  hours: number;
  steps: NavStep[];
  engine: "ors-hgv" | "osrm";
  truckLegal: boolean;
}
export interface VehicleProfile {
  heightIn?: number;
  widthIn?: number;
  lengthIn?: number;
  weightLbs?: number;
  axles?: number;
  hazmatClass?: string | null;
}
export interface RouteRequest {
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  vehicle?: VehicleProfile;
}

// ---- Vehicle (truck) profiles, per carrier ----
export interface Truck {
  id: string;
  carrierId: string;
  label: string;
  heightIn: number;
  widthIn: number;
  lengthIn: number;
  weightLbs: number;
  axles: number;
  hazmatClass: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface TruckInput {
  label?: string;
  heightIn?: number;
  widthIn?: number;
  lengthIn?: number;
  weightLbs?: number;
  axles?: number;
  hazmatClass?: string | null;
  isDefault?: boolean;
}
export interface TrucksResponse {
  trucks: Truck[];
  count: number;
}

// ---- Fuel Intelligence (crowd-weighted diesel prices + route fuel plan) ----
export type FuelPriceSource = "user" | "commercial" | "scrape" | "eia_region";

// A TruckMapPoi enriched with a confidence-blended effective diesel price.
export interface PricedStation extends TruckMapPoi {
  priceEff: number; // confidence-blended effective $/gal
  priceSource: FuelPriceSource; // dominant contributing source
  priceConfidence: number; // 0..1 aggregate confidence
  priceIsLive: boolean; // a real signal exists (not just EIA baseline)
  savingsPerGal: number; // national avg - priceEff (>=0)
  routeMi?: number; // distance along the route (along-route ranking)
  detourMi?: number; // rough off-route detour
}
export interface FuelStationsResponse {
  stations: PricedStation[];
  count: number;
}

export interface FuelPlanStop {
  poiId: string;
  name: string;
  brand: string | null;
  lat: number;
  lon: number;
  routeMi: number;
  priceEff: number;
  gallons: number;
  cost: number;
  savings: number;
  reason: string;
}
export interface FuelPlan {
  feasible: boolean;
  stops: FuelPlanStop[];
  totalGallons: number;
  totalCost: number;
  totalSavings: number;
  nationalAvg: number;
  note: string;
}

export interface DispatcherResponse {
  text: string;
  loads: ScoredLoad[];
}

export interface UsageMeter {
  used: number;
  cap: number | null; // null = unlimited
  remaining: number | null;
  overCap: boolean;
}
export interface UsageSummary {
  periodStart: string;
  scope: "carrier" | "user";
  ocr: UsageMeter;
  copilot: UsageMeter;
}

export interface Booking {
  id: string;
  status: string;
  bookedAt: string;
  load: ScoredLoad;
}

export interface CopilotHealth {
  live: boolean;
  reason: string;
  detail: string;
  model: string;
}

export interface MemoryEntry {
  id: string;
  carrierId: string;
  category: string;
  key: string;
  value: string;
  source: string; // "driver" | "copilot"
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntry {
  id: string;
  scope: string; // "global" | carrierId
  category: string;
  subcategory: string;
  topic: string;
  content: string;
  keywords: string;
  source: string; // "seed" | "driver" | "copilot"
  createdAt: string;
  updatedAt: string;
}

export type DocType = "BOL" | "POD" | "LUMPER" | "FUEL" | "OTHER" | "RATECON";

export interface Accessorial {
  name: string;
  amount: number;
}
export type DocStatus = "captured" | "needs_review" | "complete";

export interface FreightDocument {
  id: string;
  type: DocType;
  status: DocStatus;
  bolNumber: string;
  proNumber: string;
  shipper: string;
  consignee: string;
  poNumber: string;
  pieceCount: number | null;
  weightLbs: number | null;
  shipDate: string;
  deliveryDate: string;
  signaturePresent: boolean;
  signedBy: string;
  missingFields: string[];
  missingLabels: string[];
  ocrProvider: string;
  confidence: number;
  invoiceAmount: number | null;
  invoiceStatus: "none" | "staged" | "sent";
  loadId: string | null;
  bookingId: string | null;
  createdAt: string;
  imageData?: string | null; // only returned by document(id)
  // Rate Con fields (present on RATECON documents)
  rateConNumber?: string;
  lineHaulRate?: number | null;
  fuelSurcharge?: number | null;
  accessorials?: Accessorial[];
  totalRate?: number | null;
  originCity?: string;
  originState?: string;
  pickupAddress?: string;
  pickupAppt?: string;
  destCity?: string;
  destState?: string;
  deliveryAddress?: string;
  deliveryAppt?: string;
  commodity?: string;
  equipmentType?: string;
  brokerName?: string;
  brokerContactName?: string;
  brokerPhone?: string;
  brokerEmail?: string;
  referenceNumber?: string;
  specialInstructions?: string;
  loadStaged?: boolean;
  loadConfirmed?: boolean;
}

export interface ConfirmedRateCon {
  doc: FreightDocument;
  load: {
    id: string;
    externalId: string;
    originCity: string;
    originState: string;
    destCity: string;
    destState: string;
    rate: number;
    broker: string;
  };
}

export interface DocumentJob {
  jobId: string; // loadId, or "unassigned"
  loadId: string | null;
  bookingId: string | null;
  title: string;
  broker: string | null;
  rate: number | null;
  docCount: number;
  completeCount: number;
  needsReview: boolean;
  types: DocType[];
  latestAt: string | null;
  docs: FreightDocument[];
}

export interface JobPackage {
  filename: string;
  dataUrl: string; // data:application/pdf;base64,...
  docCount: number;
}

export interface DocScanBody {
  type?: DocType;
  imageData?: string; // base64 data URL
  loadId?: string;
  bookingId?: string;
  ocrKey?: string;
}

// ---- Auth ----
export const api = {
  register: (body: {
    name: string;
    email: string;
    password: string;
    companyName: string;
    role?: string;
  }) => apiFetch<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    apiFetch<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(body) }),

  me: () => apiFetch<AuthUser>("/auth/me"),

  // ---- Loads ----
  loads: (equipment?: string) =>
    apiFetch<ScoredLoad[]>(
      `/loads${equipment && equipment !== "All" ? `?equipment=${encodeURIComponent(equipment)}` : ""}`,
    ),
  reloads: (radius = 200) => apiFetch<ScoredLoad[]>(`/loads/reloads?radius=${radius}`),
  dashboard: () => apiFetch<DashboardResponse>("/loads/dashboard"),
  load: (id: string) => apiFetch<ScoredLoad>(`/loads/${id}`),
  bid: (id: string, amount: number, message?: string) =>
    apiFetch(`/loads/${id}/bid`, { method: "POST", body: JSON.stringify({ amount, message }) }),
  book: (id: string) => apiFetch(`/loads/${id}/book`, { method: "POST" }),

  // ---- Bookings / bids ----
  bookings: () => apiFetch<Booking[]>("/bookings"),
  removeBooking: (id: string) => apiFetch(`/bookings/${id}`, { method: "DELETE" }),

  // ---- Co-Pilot brain ----
  copilotHealth: () => apiFetch<CopilotHealth>("/copilot/health"),

  // ---- Co-Pilot memory (surface) + knowledge base (subsurface) ----
  memory: () => apiFetch<MemoryEntry[]>("/memory"),
  addMemory: (body: { category?: string; key: string; value: string; pinned?: boolean }) =>
    apiFetch<MemoryEntry>("/memory", { method: "POST", body: JSON.stringify(body) }),
  updateMemory: (id: string, body: Partial<{ category: string; key: string; value: string; pinned: boolean }>) =>
    apiFetch<MemoryEntry>(`/memory/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMemory: (id: string) => apiFetch(`/memory/${id}`, { method: "DELETE" }),
  knowledge: (opts?: { category?: string; q?: string }) => {
    const p = new URLSearchParams();
    if (opts?.category && opts.category !== "all") p.set("category", opts.category);
    if (opts?.q) p.set("q", opts.q);
    const qs = p.toString();
    return apiFetch<KnowledgeEntry[]>(`/memory/knowledge${qs ? `?${qs}` : ""}`);
  },
  addKnowledge: (body: { category: string; subcategory?: string; topic: string; content: string; keywords?: string }) =>
    apiFetch<KnowledgeEntry>("/memory/knowledge", { method: "POST", body: JSON.stringify(body) }),
  deleteKnowledge: (id: string) => apiFetch(`/memory/knowledge/${id}`, { method: "DELETE" }),

  // ---- Documents (BOL / POD scanning) ----
  documents: () => apiFetch<FreightDocument[]>("/documents"),
  documentJobs: () => apiFetch<DocumentJob[]>("/documents/jobs"),
  jobPackage: (jobId: string, docIds?: string[]) =>
    apiFetch<JobPackage>(
      `/documents/jobs/${encodeURIComponent(jobId)}/package${
        docIds && docIds.length
          ? `?docIds=${encodeURIComponent(docIds.join(","))}`
          : ""
      }`,
    ),
  emailJobPackage: (
    jobId: string,
    body: { to: string; subject?: string; message?: string; docIds?: string[] },
  ) =>
    apiFetch<{ sent: boolean; to: string; filename: string }>(
      `/documents/jobs/${encodeURIComponent(jobId)}/email`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  document: (id: string) => apiFetch<FreightDocument>(`/documents/${id}`),
  scanDocument: (body: DocScanBody) =>
    apiFetch<FreightDocument>("/documents/scan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateDocument: (id: string, patch: Partial<FreightDocument>) =>
    apiFetch<FreightDocument>(`/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  stageInvoice: (id: string) =>
    apiFetch<FreightDocument>(`/documents/${id}/invoice`, { method: "POST" }),
  confirmRateConLoad: (id: string) =>
    apiFetch<ConfirmedRateCon>(`/documents/${id}/confirm-load`, {
      method: "POST",
    }),

  // ---- Fuel ----
  // Pass live GPS to get real stations near you + official regional diesel price.
  // Omit coords to get the seeded national fallback set.
  fuel: (lat?: number, lon?: number) =>
    apiFetch<FuelResponse>(
      lat != null && lon != null ? `/fuel?lat=${lat}&lon=${lon}` : "/fuel"
    ),

  // ---- Driver POIs (rest areas, truck parking, weigh stations, fuel) ----
  // Live from OpenStreetMap near the driver's GPS.
  places: (lat: number, lon: number, radiusMi?: number) =>
    apiFetch<PlacesResponse>(
      `/places?lat=${lat}&lon=${lon}${radiusMi != null ? `&radiusMi=${radiusMi}` : ""}`
    ),

  // ---- Truck Map POIs (unified store: fuel, parking, rest, weigh, repair) ----
  // Served from our own DB near the driver; topped up from OSM on first visit.
  truckMapPois: (
    lat: number,
    lon: number,
    opts?: { radiusMi?: number; categories?: TruckPoiCategory[]; limit?: number },
  ) => {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    if (opts?.radiusMi != null) q.set("radiusMi", String(opts.radiusMi));
    if (opts?.categories?.length) q.set("categories", opts.categories.join(","));
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    return apiFetch<TruckMapPoiResponse>(`/truckmap/poi?${q.toString()}`);
  },

  // ---- Truck routing ----
  // Truck-legal route when a vehicle profile is passed (ORS driving-hgv);
  // otherwise a car route from the keyless OSRM fallback.
  route: (body: RouteRequest) =>
    apiFetch<RouteResult>("/truckmap/route", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // POIs within a corridor around a route polyline ([lon, lat] pairs).
  routePois: (
    coords: [number, number][],
    opts?: {
      categories?: TruckPoiCategory[];
      bufferMi?: number;
      hgvOnly?: boolean;
      limit?: number;
    },
  ) =>
    apiFetch<TruckMapPoiResponse>("/truckmap/route/pois", {
      method: "POST",
      body: JSON.stringify({ coords, ...opts }),
    }),

  // ---- Fuel Intelligence ----
  // Cheapest truck-legal diesel near a point (confidence-blended prices).
  fuelNearby: (
    lat: number,
    lon: number,
    opts?: { radiusMi?: number; hgvOnly?: boolean; limit?: number },
  ) => {
    const q = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    if (opts?.radiusMi != null) q.set("radiusMi", String(opts.radiusMi));
    if (opts?.hgvOnly) q.set("hgvOnly", "true");
    if (opts?.limit != null) q.set("limit", String(opts.limit));
    return apiFetch<FuelStationsResponse>(`/truckmap/fuel?${q.toString()}`);
  },
  // Cheapest diesel in a corridor around a route polyline ([lon, lat] pairs).
  fuelAlongRoute: (
    coords: [number, number][],
    opts?: { bufferMi?: number; hgvOnly?: boolean; limit?: number },
  ) =>
    apiFetch<FuelStationsResponse>("/truckmap/fuel/along-route", {
      method: "POST",
      body: JSON.stringify({ coords, ...opts }),
    }),
  // Route fuel-fill plan: where to buy and how much to minimize spend.
  fuelPlan: (
    coords: [number, number][],
    opts?: {
      tankGallons?: number;
      currentGallons?: number;
      mpg?: number;
      reserveGallons?: number;
      hgvOnly?: boolean;
    },
  ) =>
    apiFetch<FuelPlan>("/truckmap/fuel/plan", {
      method: "POST",
      body: JSON.stringify({ coords, ...opts }),
    }),
  // Submit a crowd-sourced diesel price for a station.
  reportFuelPrice: (poiId: string, price: number, fuelType = "diesel") =>
    apiFetch<{ station: PricedStation | null }>("/truckmap/fuel/report", {
      method: "POST",
      body: JSON.stringify({ poiId, price, fuelType }),
    }),

  // ---- Vehicle (truck) profiles ----
  trucks: () => apiFetch<TrucksResponse>("/truckmap/vehicles"),
  addTruck: (body: TruckInput) =>
    apiFetch<Truck>("/truckmap/vehicles", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTruck: (id: string, body: TruckInput) =>
    apiFetch<Truck>(`/truckmap/vehicles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  removeTruck: (id: string) =>
    apiFetch<{ ok: boolean }>(`/truckmap/vehicles/${id}`, { method: "DELETE" }),

  // ---- Usage metering ----
  usage: () => apiFetch<UsageSummary>("/usage"),

  // ---- Carrier ----
  carrier: () => apiFetch<CarrierDetail>("/carrier"),
  updateCarrier: (body: Partial<CarrierDetail> & { smtpPass?: string }) =>
    apiFetch<CarrierDetail>("/carrier", { method: "PUT", body: JSON.stringify(body) }),
  // One-click email OAuth. `start` returns the provider consent URL to send the
  // browser to; the server callback stores the connection and redirects back.
  startEmailOauth: (provider: "google" | "microsoft") =>
    apiFetch<{ url: string }>(`/carrier/email/oauth/${provider}/start`),
  disconnectEmailOauth: () =>
    apiFetch<{ disconnected: boolean }>("/carrier/email/oauth/disconnect", {
      method: "POST",
    }),
  // Auto-fill company profile from the FMCSA carrier registry.
  lookupCarrier: (params: { dot?: string; mc?: string }) => {
    const q = params.dot
      ? `dot=${encodeURIComponent(params.dot)}`
      : `mc=${encodeURIComponent(params.mc || "")}`;
    return apiFetch<CarrierLookup>(`/carrier/lookup?${q}`);
  },
  // Drivers — each mutation returns the full refreshed carrier.
  addDriver: (body: { name: string; cdlClass?: string; status?: string }) =>
    apiFetch<CarrierDetail>("/carrier/drivers", { method: "POST", body: JSON.stringify(body) }),
  updateDriver: (id: string, body: { name?: string; cdlClass?: string; status?: string }) =>
    apiFetch<CarrierDetail>(`/carrier/drivers/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeDriver: (id: string) =>
    apiFetch<CarrierDetail>(`/carrier/drivers/${id}`, { method: "DELETE" }),
  // Equipment — each mutation returns the full refreshed carrier.
  addEquipment: (body: { type: string; unit?: string; year?: number }) =>
    apiFetch<CarrierDetail>("/carrier/equipment", { method: "POST", body: JSON.stringify(body) }),
  updateEquipment: (id: string, body: { type?: string; unit?: string; year?: number }) =>
    apiFetch<CarrierDetail>(`/carrier/equipment/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeEquipment: (id: string) =>
    apiFetch<CarrierDetail>(`/carrier/equipment/${id}`, { method: "DELETE" }),

  // ---- Dispatcher ----
  ask: (message: string) =>
    apiFetch<DispatcherResponse>("/dispatcher/ask", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  // ---- Co-Pilot conversational brain (Claude, optional) ----
  // Returns { speak: null } when no API key is wired on the server, so callers
  // can cleanly fall back to the built-in rules engine.
  copilotLlm: (message: string, facts: string, personality?: string) =>
    apiFetch<{ speak: string | null }>("/copilot/llm", {
      method: "POST",
      body: JSON.stringify({ message, facts, personality }),
    }),

  // ---- Co-Pilot knowledge base (offline, free) ----
  // Keyword lookup against the shared freight knowledge base + this carrier's
  // own entries. No Claude call, no usage cost — powers real answers to freight
  // questions even when the LLM brain isn't wired.
  copilotKnowledge: (q: string, limit = 3) =>
    apiFetch<{
      hits: { topic: string; content: string; category: string; score: number }[];
    }>(`/copilot/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`),
};
