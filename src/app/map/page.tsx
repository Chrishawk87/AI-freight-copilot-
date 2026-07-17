"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  LocateFixed,
  Navigation,
  Search,
  Truck,
  X,
} from "lucide-react";
import { api, type NavStep, type RouteResult } from "@/lib/api";
import { useGeolocation } from "@/lib/geolocation";
import type { LatLon } from "@/lib/geolocation";
import { geocode } from "@/components/LiveMap";
import { CesiumMap } from "@/features/truckmap/CesiumMap";
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

export default function MapPage() {
  const { pos, status: geoStatus, request } = useGeolocation();
  const vp = useVehicleProfiles();

  const [pois, setPois] = useState<TruckMapPoi[]>([]);
  const [visible, setVisible] = useState<Record<TruckPoiCategory, boolean>>(ALL_ON);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  // Routing state
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [destLabel, setDestLabel] = useState<string>("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
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
  const runRoute = useCallback(
    async (dest: LatLon, label: string) => {
      const from = posRef.current;
      if (!from) {
        setRouteError("Waiting for GPS — tap the GPS button first.");
        return;
      }
      setRouting(true);
      setRouteError(null);
      setDestination(dest);
      setDestLabel(label);
      try {
        const res = await api.route({
          from: { lat: from.lat, lon: from.lon },
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
      await runRoute(dest, q);
    } catch {
      setRouteError(`Couldn't find "${q}".`);
    } finally {
      setSearching(false);
    }
  }, [query, runRoute]);

  const navigateToPoi = useCallback(
    (poi: TruckMapPoi) => {
      const label =
        poi.name ||
        poi.address ||
        [poi.city, poi.state].filter(Boolean).join(", ") ||
        "Destination";
      setSelectedId(null);
      setQuery(label);
      void runRoute({ lat: poi.lat, lon: poi.lon }, label);
    },
    [runRoute],
  );

  const clearRoute = useCallback(() => {
    setRoute(null);
    setDestination(null);
    setDestLabel("");
    setRouteError(null);
    setQuery("");
  }, []);

  // Recompute the route if the active truck changes mid-trip (so legality
  // follows the rig the driver just picked).
  const activeTruckId = vp.active?.id;
  useEffect(() => {
    if (destination && activeTruckId) void runRoute(destination, destLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTruckId]);

  // ---- next-step banner: the route step nearest to the driver ----
  const nextStep: NavStep | null = useMemo(() => {
    if (!route?.steps?.length || !pos) return route?.steps?.[0] ?? null;
    let best = route.steps[0];
    let bestD = Infinity;
    for (const s of route.steps) {
      const d = haversineMi(pos, { lat: s.lat, lon: s.lon });
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }, [route, pos]);

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

      {/* Destination search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search a destination…"
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

      {/* Layer control */}
      <div className="overflow-x-auto pb-1">
        <LayerControl visible={visible} counts={counts} onToggle={toggle} />
      </div>

      {/* Map fills the rest */}
      <div className="relative min-h-0 flex-1">
        <CesiumMap
          driver={pos}
          pois={pois}
          visible={visible}
          selectedId={selectedId}
          onSelectPoi={setSelectedId}
          follow={follow}
          route={routeCoords}
          destination={destination}
        />

        {/* Turn banner (top) */}
        {route && nextStep && (
          <div className="absolute inset-x-3 top-3 z-10 mx-auto max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur">
            <div className="flex items-center gap-3">
              <Navigation className="h-5 w-5 flex-none text-electric" />
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
          </div>
        )}

        {/* ETA / miles chip (bottom) */}
        {route && !selected && (
          <div className="absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/95 px-4 py-3 shadow-xl backdrop-blur">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {destLabel || "Destination"}
              </p>
              <p className="text-xs text-slate-400">
                {fmtEta(route.hours)} · {route.miles.toFixed(0)} mi
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
      </div>
    </div>
  );
}
