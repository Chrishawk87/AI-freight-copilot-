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
  stations: {
    id: string;
    name: string;
    city: string;
    state: string;
    price: number;
    distanceMi: number;
    onRoute: boolean;
    network: string;
  }[];
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

export type DocType = "BOL" | "POD" | "LUMPER" | "FUEL" | "OTHER";
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

  // ---- Documents (BOL / POD scanning) ----
  documents: () => apiFetch<FreightDocument[]>("/documents"),
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

  // ---- Fuel ----
  fuel: () => apiFetch<FuelResponse>("/fuel"),

  // ---- Usage metering ----
  usage: () => apiFetch<UsageSummary>("/usage"),

  // ---- Carrier ----
  carrier: () => apiFetch<CarrierDetail>("/carrier"),
  updateCarrier: (body: Partial<CarrierDetail>) =>
    apiFetch<CarrierDetail>("/carrier", { method: "PUT", body: JSON.stringify(body) }),

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
};
