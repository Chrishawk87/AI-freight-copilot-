"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  Flag,
  Fuel,
  LocateFixed,
  Navigation,
  RotateCcw,
  Search,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { api, type NavStep, type RouteResult } from "@/lib/api";
import { useGeolocation } from "@/lib/geolocation";
import type { LatLon } from "@/lib/geolocation";
import { geocode } from "@/components/LiveMap";
import { CesiumMap } from "@/features/truckmap/CesiumMap";
import { FuelPanel } from "@/features/truckmap/FuelPanel";
import { LayerControl } from "@/features/truckmap/LayerControl";
import { PoiDetailCard } from "@/features/truckmap/PoiDetailCard";
import { VehicleProfileMenu } from "@/features/truckmap/VehicleProfileMenu";
import { useVehicleProfiles } from "@/features/truckmap/useVehicleProfiles";
import {
  TRUCK_CATEGORY_ORDER,
  type TruckMapPoi,
  type TruckPoiCategory,
} from "@/lib/truckmap/types";

const ALL_ON: Record<TruckPoiCategory, boolean> = {
  fuel: true,
  parking: true,
  rest_area: true,
  weigh_station: true,
  repair: true,
  services: true,
};

function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function fmtEta(hours: number): string {
  const mins = Math.round(hours * 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

// Distance to the next maneuver, spoken the way a driver expects it.
function fmtManeuverDist(mi: number | null): string {
  if (mi == null) return "";
  if (mi < 0.02) return "Now";
  if (mi < 0.95) {
    const ft = Math.round((mi * 5280) / 50) * 50;
    return `${ft} ft`;
  }
  return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

// Pick a maneuver arrow from the OSRM/ORS step modifier + type.
function maneuverIcon(step: NavStep | null): LucideIcon {
  if (!step) return Navigation;
  if (step.type === "arrive") return Flag;
  const m = (step.modifier ?? "").toLowerCase();
  if (m.includes("uturn")) return RotateCcw;
  if (m.includes("sharp left") || m === "left") return CornerUpLeft;
  if (m.includes("slight left")) return ArrowUpLeft;
  if (m.includes("sharp right") || m === "right") return CornerUpRight;
  if (m.includes("slight right")) return ArrowUpRight;
  return ArrowUp;
}

// Arrival clock time from hours-remaining (e.g. "3:45 PM").
function fmtArrival(hours: number): string {
  const eta = new Date(Date.now() + hours * 3600_000);
  return eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function MapPage() {
  const { pos, heading, status: geoStatus, request } = useGeolocation();
  const vp = useVehicleProfiles();

  const [pois, setPois] = useState<TruckMapPoi[]>([]);
  const [visible, setVisible] = useState<Record<TruckPoiCategory, boolean>>(ALL_ON);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [tab, setTab] = useState<"map" | "fuel">("map");

  // Routing state
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [destLabel, setDestLabel] = useState<string>("");
  // Origin: null means "start from live GPS"; a LatLon means a fixed start the
  // driver typed in (we then draw a green start pin).
  const [origin, setOrigin] = useState<LatLon | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  // startQuery blank = "My location" (live GPS). destQuery = destination text.
  const [startQuery, setStartQuery] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const posRef = useRef<LatLon | null>(null);
  posRef.current = pos;

  // Refetch POIs when the fix moves enough to matter (~7 mi grid).
  const gridLat = pos ? Math.round(pos.lat * 10) / 10 : null;
  const gridLon = pos ? Math.round(pos.lon * 10) / 10 : null;
  useEffect(() => {
    if (gridLat == null || gridLon == null) return;
    let cancelled = false;
    api
      .truckMapPois(gridLat, gridLon, { radiusMi: 30 })
      .then((res) => {
        if (!cancelled) setPois(res.pois);
      })
      .catch(() => {
        if (!cancelled) setPois([]);
      });
    return () => {
      cancelled = true;
    };
  }, [gridLat, gridLon]);

  const toggle = useCallback((cat: TruckPoiCategory) => {
    setVisible((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const counts = useMemo(() => {
    const c: Partial<Record<TruckPoiCategory, number>> = {};
    for (const cat of TRUCK_CATEGORY_ORDER) c[cat] = 0;
    for (const p of pois) c[p.category] = (c[p.category] ?? 0) + 1;
    return c;
  }, [pois]);

  const selected = useMemo(
    () => pois.find((p) => p.id === selectedId) ?? null,
    [pois, selectedId],
  );

  // ---- routing ----
  // `from` override: when omitted we start from live GPS (posRef).
  const runRoute = useCallback(
    async (dest: LatLon, label: string, from?: LatLon | null) => {
      const start = from ?? posRef.current;
      if (!start) {
        setRouteError("Waiting for GPS — tap the GPS button first.");
        return;
      }
      setRouting(true);
      setRouteError(null);
      setDestination(dest);
      setDestLabel(label);
      setOrigin(from ?? null);
      try {
        const res = await api.route({
          from: { lat: start.lat, lon: start.lon },
          to: { lat: dest.lat, lon: dest.lon },
          vehicle: vp.activeProfile,
        });
        setRoute(res);
        setFollow(true);
      } catch (e: any) {
        setRoute(null);
        setRouteError(e?.message || "Could not build a route.");
      } finally {
        setRouting(false);
      }
    },
    [vp.activeProfile],
  );

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setRouteError(null);
    try {
      const dest = await geocode(q);
      // Resolve the start: blank / "my location" → live GPS; otherwise geocode.
      const sq = startQuery.trim();
      let from: LatLon | null = null;
      if (sq && sq.toLowerCase() !== "my location") {
        try {
          from = await geocode(sq);
        } catch {
          setRouteError(`Couldn't find start "${sq}".`);
          return;
        }
      }
      await runRoute(dest, q, from);
    } catch {
      setRouteError(`Couldn't find "${q}".`);
    } finally {
      setSearching(false);
    }
  }, [query, startQuery, runRoute]);

  const navigateToPoi = useCallback(
    (poi: TruckMapPoi) => {
      const label =
        poi.name ||
        poi.address ||
        [poi.city, poi.state].filter(Boolean).join(", ") ||
        "Destination";
      setSelectedId(null);
      setQuery(label);
      // POI navigation always starts from live GPS.
      setStartQuery("");
      void runRoute({ lat: poi.lat, lon: poi.lon }, label, null);
    },
    [runRoute],
  );

  const clearRoute = useCallback(() => {
    setRoute(null);
    setDestination(null);
    setDestLabel("");
    setOrigin(null);
    setRouteError(null);
    setQuery("");
    setStartQuery("");
  }, []);

  // Recompute the route if the active truck changes mid-trip (so legality
  // follows the rig the driver just picked).
  const activeTruckId = vp.active?.id;
  useEffect(() => {
    if (destination && activeTruckId) void runRoute(destination, destLabel, origin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTruckId]);

  // ---- sequenced turn-by-turn ----
  // Track the driver's progress through the maneuver list. The index only ever
  // moves forward, advancing once we're within ~0.05 mi of the current
  // maneuver point — so the banner always shows the NEXT upcoming turn.
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    setStepIdx(0);
  }, [route]);

  useEffect(() => {
    if (!route?.steps?.length || !pos) return;
    const steps = route.steps;
    let i = stepIdx;
    while (i < steps.length - 1) {
      const d = haversineMi(pos, { lat: steps[i].lat, lon: steps[i].lon });
      if (d < 0.05) i += 1;
      else break;
    }
    if (i !== stepIdx) setStepIdx(i);
  }, [pos, route, stepIdx]);

  const stepCount = route?.steps?.length ?? 0;
  const currentStep: NavStep | null =
    route?.steps?.[Math.min(stepIdx, Math.max(0, stepCount - 1))] ?? null;
  const previewStep: NavStep | null = route?.steps?.[stepIdx + 1] ?? null;

  // Distance from the driver to the upcoming maneuver.
  const distToManeuverMi = useMemo(() => {
    if (!currentStep || !pos) return null;
    return haversineMi(pos, { lat: currentStep.lat, lon: currentStep.lon });
  }, [currentStep, pos]);

  // Live remaining distance + ETA (shrinks as the driver progresses).
  const remaining = useMemo(() => {
    if (!route?.steps?.length) return null;
    const steps = route.steps;
    let miles = distToManeuverMi ?? 0;
    for (let i = stepIdx; i < steps.length; i++) miles += steps[i].distanceMi;
    miles = Math.min(miles, route.miles);
    const frac = route.miles > 0 ? miles / route.miles : 0;
    return { miles, hours: route.hours * frac };
  }, [route, stepIdx, distToManeuverMi]);

  const nextStep = currentStep;

  const routeCoords = route?.coords ?? null;

  const geoLabel =
    geoStatus === "ok"
      ? "Live GPS"
      : geoStatus === "locating"
        ? "Locating…"
        : geoStatus === "denied"
          ? "Location off"
          : geoStatus === "unavailable"
            ? "No GPS"
            : "—";

  return (
    <div className="relative flex h-[calc(100dvh-1rem)] flex-col gap-3 lg:h-[calc(100dvh-3rem)]">
      {/* Top bar: title + truck + GPS + follow toggle */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Truck Map</h1>
          <p className="text-xs text-white/50">
            Truck-legal routing, fuel, parking &amp; more near you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VehicleProfileMenu vp={vp} />
          <button
            onClick={() => setFollow((v) => !v)}
            className={`chip flex items-center gap-1.5 ${
              follow ? "bg-electric/15 text-electric" : "bg-white/5 text-white/60"
            }`}
          >
            <LocateFixed className="h-3.5 w-3.5" /> {follow ? "Following" : "Free"}
          </button>
          <button
            onClick={request}
            className="chip flex items-center gap-1.5 bg-electric/15 text-electric"
          >
            <Crosshair className="h-3.5 w-3.5" /> {geoLabel}
          </button>
        </div>
      </div>

      {/* Map / Fuel tab switcher */}
      <div className="flex self-start rounded-xl bg-white/5 p-0.5">
        <button
          onClick={() => setTab("map")}
          className={`chip flex items-center gap-1.5 ${
            tab === "map" ? "bg-electric text-[#0B1220]" : "text-white/60"
          }`}
        >
          <Navigation className="h-3.5 w-3.5" /> Map
        </button>
        <button
          onClick={() => setTab("fuel")}
          className={`chip flex items-center gap-1.5 ${
            tab === "fuel" ? "bg-electric text-[#0B1220]" : "text-white/60"
          }`}
        >
          <Fuel className="h-3.5 w-3.5" /> Fuel
        </button>
      </div>

      {/* Start + Destination trip inputs */}
      {tab === "map" && (
      <>
      <div className="flex flex-col gap-2">
        {/* Start */}
        <div className="relative">
          <LocateFixed className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400/70" />
          <input
            value={startQuery}
            onChange={(e) => setStartQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="My location"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-9 text-sm text-white outline-none placeholder:text-white/40 focus:border-electric"
          />
          {startQuery && (
            <button
              onClick={() => setStartQuery("")}
              aria-label="Use my location"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-white/40 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Destination + Go */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Destination…"
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-9 text-sm text-white outline-none focus:border-electric"
            />
            {query && (
              <button
                onClick={clearRoute}
                aria-label="Clear"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-white/40 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={search}
            disabled={searching || routing || !query.trim()}
            className="chip flex items-center gap-1.5 bg-electric text-[#0B1220] disabled:opacity-50"
          >
            <Navigation className="h-3.5 w-3.5" />
            {searching || routing ? "Routing…" : "Go"}
          </button>
        </div>
      </div>

      {/* Layer control */}
      <div className="overflow-x-auto pb-1">
        <LayerControl visible={visible} counts={counts} onToggle={toggle} />
      </div>
      </>
      )}

      {/* Map fills the rest */}
      <div className="relative min-h-0 flex-1">
        <CesiumMap
          driver={pos}
          heading={heading}
          pois={pois}
          visible={visible}
          selectedId={selectedId}
          onSelectPoi={setSelectedId}
          follow={follow}
          route={routeCoords}
          destination={destination}
          origin={origin}
        />

        {/* Turn banner (top): distance to maneuver + instruction + preview */}
        {route && nextStep && (() => {
          const Icon = maneuverIcon(nextStep);
          const dist = fmtManeuverDist(distToManeuverMi);
          return (
            <div className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex flex-none flex-col items-center">
                  <Icon className="h-7 w-7 text-electric" />
                  {dist && (
                    <span className="mt-0.5 text-[11px] font-semibold text-white/70">
                      {dist}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {nextStep.text}
                  </p>
                  {nextStep.road && (
                    <p className="truncate text-xs text-slate-400">
                      {nextStep.road}
                    </p>
                  )}
                </div>
                <button
                  onClick={clearRoute}
                  aria-label="End route"
                  className="rounded-full p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {previewStep && (() => {
                const P = maneuverIcon(previewStep);
                return (
                  <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-2 text-xs text-slate-400">
                    <span className="text-slate-500">Then</span>
                    <P className="h-3.5 w-3.5 text-slate-300" />
                    <span className="truncate">{previewStep.text}</span>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* ETA / miles chip (bottom) — live remaining time & arrival clock */}
        {route && !selected && (
          <div className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {destLabel || "Destination"}
              </p>
              <p className="text-xs text-slate-400">
                {fmtEta((remaining ?? route).hours)} ·{" "}
                {(remaining?.miles ?? route.miles).toFixed(0)} mi · arrive{" "}
                {fmtArrival((remaining ?? route).hours)}
              </p>
            </div>
            <span
              className={`chip flex flex-none items-center gap-1.5 ${
                route.truckLegal
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300"
              }`}
            >
              <Truck className="h-3.5 w-3.5" />
              {route.truckLegal ? "Truck-legal" : "Car route"}
            </span>
          </div>
        )}

        {/* Route error toast */}
        {routeError && (
          <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md rounded-xl bg-rose-500/90 px-4 py-2.5 text-sm text-white shadow-xl">
            {routeError}
          </div>
        )}

        {/* Selected POI detail slides up over the map */}
        {selected && (
          <div className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-md">
            <PoiDetailCard
              poi={selected}
              onClose={() => setSelectedId(null)}
              onNavigate={navigateToPoi}
            />
          </div>
        )}

        {/* Fuel Intelligence panel overlays the (still-mounted) map */}
        {tab === "fuel" && (
          <div className="absolute inset-0 z-30 rounded-2xl border border-slate-800 bg-[#0B1220]/95 p-3 backdrop-blur">
            <FuelPanel
              driver={pos}
              routeCoords={routeCoords}
              onNavigate={(poi) => {
                setTab("map");
                navigateToPoi(poi);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
