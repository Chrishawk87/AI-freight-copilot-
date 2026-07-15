"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Navigation,
  MapPin,
  Flag,
  Fuel,
  Scale,
  TriangleAlert,
  Cloud,
  ParkingSquare,
  Lock,
  Square,
  Loader2,
  LocateFixed,
  Check,
  Search,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { PageHeader, money, scoreColor, Loading, ErrorState } from "@/components/ui";
import { DIESEL_PRICE } from "@/lib/scoring";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { readEnabled, readKeys, resolveMapEngine, type EnabledMap, type KeyMap } from "@/lib/plugins";
import clsx from "clsx";

const TOGGLES = [
  { key: "bridge", label: "Low bridge avoidance", icon: TriangleAlert },
  { key: "weight", label: "Weight restrictions", icon: Scale },
  { key: "hazmat", label: "Hazmat routing", icon: TriangleAlert },
  { key: "weather", label: "Weather-aware", icon: Cloud },
  { key: "parking", label: "Truck parking", icon: ParkingSquare },
  { key: "fuel", label: "Fuel stops on route", icon: Fuel },
];

// All selectable engines. "osm" is the free default; keyed engines light up
// automatically when the client connects them (with a key) in the Plugin Engine.
const ENGINE_LABELS: Record<string, string> = {
  osm: "Live Map (free)",
  trimble: "Trimble Maps",
  googlemaps: "Google Maps",
  herewego: "HERE Maps",
};
const KEYED_ORDER = ["trimble", "googlemaps", "herewego"];

// ---------- shared helpers ----------
function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("load error")));
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.body.appendChild(s);
  });
}

type LatLon = { lat: number; lon: number };

// Geographic middle of the lower-48 — the neutral view before we have a GPS fix.
const US_CENTER: LatLon = { lat: 39.8283, lon: -98.5795 };

async function geocode(q: string): Promise<LatLon> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
    { headers: { Accept: "application/json" } }
  );
  const data = await res.json();
  if (!data?.length) throw new Error("No geocode for " + q);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

// A point can already be coordinates (the phone's GPS fix) or a place name to look up.
async function resolvePoint(p: LatLon | string): Promise<LatLon> {
  return typeof p === "string" ? geocode(p) : p;
}

function pointSig(p: LatLon | string | null): string {
  if (p == null) return "none";
  if (typeof p === "string") return p;
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
}

type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

// Live phone GPS. Watches position so the "you are here" dot tracks the driver.
function useDriverLocation() {
  const [pos, setPos] = useState<LatLon | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
        setStatus("ok");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  }, []);

  // Ask once on mount, then keep tracking in the background.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
        setStatus("ok");
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { pos, status, request };
}

type Stats = { miles: number; hours: number } | null;

// ---------- Free engine: Leaflet + OpenStreetMap + OSRM ----------
async function osrmRoute(o: { lat: number; lon: number }, d: { lat: number; lon: number }) {
  const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) throw new Error("No route");
  return {
    line: (r.geometry.coordinates as [number, number][]).map(([lon, lat]) => [lat, lon]) as [number, number][],
    miles: r.distance / 1609.34,
    hours: r.duration / 3600,
  };
}

type MapProps = {
  driver: LatLon | null; // live phone position (for the "you are here" dot)
  origin: LatLon | string | null; // where a route starts (GPS fix, or a fallback city)
  dest: string | null; // destination place name
  showRoute: boolean; // false = plain map; true = draw origin→dest
  onStats?: (s: Stats) => void;
};

function OsmMap({ driver, origin, dest, showRoute, onStats }: MapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let map: any;
    setStatus("loading");

    (async () => {
      try {
        loadCss("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
        const L = (window as any).L;
        if (cancelled || !ref.current) return;

        map = L.map(ref.current, { zoomControl: true, attributionControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);

        // Always show the driver where we know it.
        if (driver) {
          L.circleMarker([driver.lat, driver.lon], {
            radius: 7,
            color: "#246BFD",
            fillColor: "#246BFD",
            fillOpacity: 1,
            weight: 3,
          })
            .addTo(map)
            .bindTooltip("You", { permanent: false });
        }

        if (!showRoute || !dest) {
          // ---- Plain map: just center on the driver (or the country) ----
          if (driver) map.setView([driver.lat, driver.lon], 12);
          else map.setView([US_CENTER.lat, US_CENTER.lon], 4);
          if (cancelled) return;
          setTimeout(() => map && map.invalidateSize(), 200);
          setStatus("ready");
          return;
        }

        // ---- Route mode: origin (GPS) → destination ----
        const startPoint = origin ?? driver ?? US_CENTER;
        const [o, d] = await Promise.all([resolvePoint(startPoint), geocode(dest)]);
        if (cancelled) return;

        L.circleMarker([o.lat, o.lon], { radius: 8, color: "#16C784", fillColor: "#16C784", fillOpacity: 1, weight: 2 }).addTo(map);
        L.circleMarker([d.lat, d.lon], { radius: 8, color: "#EF4444", fillColor: "#EF4444", fillOpacity: 1, weight: 2 }).addTo(map);

        let bounds = L.latLngBounds([[o.lat, o.lon], [d.lat, d.lon]]);
        try {
          const { line, miles, hours } = await osrmRoute(o, d);
          if (!cancelled && line.length) {
            const poly = L.polyline(line, { color: "#246BFD", weight: 4, opacity: 0.9 }).addTo(map);
            bounds = poly.getBounds();
            onStats?.({ miles, hours });
          }
        } catch {
          /* markers still show a real map */
        }

        if (cancelled) return;
        map.fitBounds(bounds.pad(0.15));
        setTimeout(() => map && map.invalidateSize(), 200);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointSig(driver), pointSig(origin), dest, showRoute, onStats]);

  return (
    <>
      <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-navy-900/40 text-xs text-white/60">
          {status === "loading" ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
            </span>
          ) : (
            <span>Map unavailable — check your connection.</span>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Trimble engine (client's own key). Falls back to OSM on any failure ----------
function TrimbleMap({
  driver,
  origin,
  dest,
  showRoute,
  apiKey,
  hazmat,
  onStats,
}: MapProps & { apiKey: string; hazmat: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: any;

    (async () => {
      try {
        loadCss("https://maps-sdk.trimblemaps.com/v4/trimblemaps-4.0.1.css");
        await loadScript("https://maps-sdk.trimblemaps.com/v4/trimblemaps-4.0.1.js");
        const TM = (window as any).TrimbleMaps;
        if (!TM) throw new Error("Trimble SDK unavailable");
        if (cancelled || !ref.current) return;

        TM.APIKey = apiKey;

        // ---- Plain map: center on the driver, no route ----
        if (!showRoute || !dest) {
          const c = driver ?? US_CENTER;
          map = new TM.Map({
            container: ref.current,
            style: TM.Common?.Style?.TRANSPORTATION,
            center: new TM.LngLat(c.lon, c.lat),
            zoom: driver ? 11 : 4,
          });
          map.on("error", () => !cancelled && setFailed(true));
          return;
        }

        // ---- Route mode: origin (GPS) → destination ----
        const startPoint = origin ?? driver ?? US_CENTER;
        const [o, d] = await Promise.all([resolvePoint(startPoint), geocode(dest)]);
        if (cancelled) return;

        map = new TM.Map({
          container: ref.current,
          style: TM.Common?.Style?.TRANSPORTATION,
          center: new TM.LngLat((o.lon + d.lon) / 2, (o.lat + d.lat) / 2),
          zoom: 4,
        });

        map.on("load", () => {
          try {
            const route = new TM.Route({
              routeId: "aifc",
              stops: [new TM.LngLat(o.lon, o.lat), new TM.LngLat(d.lon, d.lat)],
              routeColor: "#246BFD",
              routeWidth: 5,
              vehicleType: TM.Common?.VehicleType?.TRUCK,
              routeType: TM.Common?.RouteType?.PRACTICAL,
              hazMatType: hazmat ? TM.Common?.HazMatType?.GENERAL : undefined,
              showStops: true,
            });
            route.on?.("report", (e: any) => {
              const miles = e?.reports?.[0]?.distance;
              const hours = e?.reports?.[0]?.time ? e.reports[0].time / 3600 : undefined;
              if (miles) onStats?.({ miles, hours: hours ?? 0 });
            });
            route.addTo(map);
          } catch {
            if (!cancelled) setFailed(true);
          }
        });
        map.on("error", () => {
          if (!cancelled) setFailed(true);
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (map) map.remove();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointSig(driver), pointSig(origin), dest, showRoute, apiKey, hazmat, onStats]);

  // If the SDK/key fails, never leave the client on a blank screen.
  if (failed)
    return <OsmMap driver={driver} origin={origin} dest={dest} showRoute={showRoute} onStats={onStats} />;
  return <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />;
}

export default function NavigationPage() {
  const loadsQ = useApi(() => api.loads(), []);
  const carrierQ = useApi(() => api.carrier(), []);
  const [id, setId] = useState<string | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({
    bridge: true,
    weight: true,
    hazmat: false,
    weather: true,
    parking: true,
    fuel: true,
  });
  const [accepted, setAccepted] = useState(false); // load pulled out of the queue
  const [started, setStarted] = useState(false); // route running from GPS → dest
  const [enabledPlugins, setEnabledPlugins] = useState<EnabledMap>({});
  const [keys, setKeys] = useState<KeyMap>({});
  const [engine, setEngine] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(null);
  const [customDest, setCustomDest] = useState<string | null>(null); // typed address, à la Google Maps
  const [addressInput, setAddressInput] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const { pos: driverPos, status: geoStatus, request: requestGeo } = useDriverLocation();
  const searchParams = useSearchParams();

  // Route to a typed address (or a spoken one handed over by the Co-Pilot).
  const routeToAddress = useCallback((addr: string) => {
    const a = addr.trim();
    if (!a) return;
    setCustomDest(a);
    setAddressInput(a);
    setStats(null);
    setStarted(true);
  }, []);

  // The Co-Pilot can drive this screen. It navigates here with query flags
  // (?start=1 begins routing, ?to=<address> routes to a spoken destination,
  // ?fs=1 goes full-screen) and fires "copilot-ui" events for things that only
  // make sense while already on the page (e.g. closing the map).
  useEffect(() => {
    if (!searchParams) return;
    const to = searchParams.get("to");
    if (to) routeToAddress(to);
    if (searchParams.get("start") === "1") {
      setAccepted(true);
      setStarted(true);
    }
    if (searchParams.get("fs") === "1") setFullscreen(true);
  }, [searchParams, routeToAddress]);

  useEffect(() => {
    const onUi = (e: Event) => {
      const cmd = (e as CustomEvent).detail as string;
      if (cmd === "map:close") setFullscreen(false);
      if (cmd === "map:stop") {
        setStarted(false);
        setStats(null);
      }
      if (cmd === "map:fullscreen") setFullscreen(true);
    };
    window.addEventListener("copilot-ui", onUi);
    return () => window.removeEventListener("copilot-ui", onUi);
  }, []);

  // Exit full-screen with the Escape key.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    const en = readEnabled();
    const ky = readKeys();
    setEnabledPlugins(en);
    setKeys(ky);
    setEngine((prev) => prev ?? resolveMapEngine(en, ky));
  }, []);

  // Engines this client can pick: free default + any keyed provider they connected.
  const engines = useMemo(() => {
    const list = [{ id: "osm", label: ENGINE_LABELS.osm, ready: true }];
    for (const idp of KEYED_ORDER) {
      const connected = !!enabledPlugins[idp] && !!keys[idp]?.trim();
      list.push({ id: idp, label: ENGINE_LABELS[idp] ?? idp, ready: connected });
    }
    return list;
  }, [enabledPlugins, keys]);

  const loads = loadsQ.data ?? [];
  useEffect(() => {
    if (!id && loads.length) setId(loads[0].id);
  }, [id, loads]);

  if (loadsQ.loading || carrierQ.loading) return <Loading />;
  if (loadsQ.error) return <ErrorState message={loadsQ.error} />;

  const load = loads.find((l) => l.id === id) ?? loads[0];
  if (!load) return <div className="text-sm text-white/40">No loads available.</div>;

  const originCity = `${load.originCity}, ${load.originState}`;
  // A typed/spoken address wins over the load's drop, so the map works like
  // Google Maps: enter any address and it routes there.
  const dest = customDest ?? `${load.destCity}, ${load.destState}`;

  // Where the route begins: the phone's live GPS fix when we have one, otherwise
  // fall back to the load's pickup city so a route can still be drawn.
  const routeOrigin: LatLon | string = driverPos ?? originCity;
  const usingLiveGps = !!driverPos;

  // Draw a route once the driver pressed Start — either on an accepted load, or
  // straight to a typed/spoken address (which needs no load acceptance).
  const showRoute = started && (!!customDest || accepted);

  const activeId = engines.find((e) => e.id === engine && e.ready)?.id ?? "osm";
  const activeEngine = engines.find((e) => e.id === activeId)!;

  const mpg = carrierQ.data?.mpg ?? 6.8;
  const fcpm = carrierQ.data?.fixedCostPerMile ?? 0.72;
  const deadheadCost = (load.deadheadMiles / mpg) * DIESEL_PRICE + load.deadheadMiles * fcpm;

  return (
    <div>
      <PageHeader title="Profit Navigation" subtitle="Truck-legal routing that shows the money, not just the miles." />

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
          Destination
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            routeToAddress(addressInput);
          }}
          className="flex max-w-md items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Enter an address or city…"
              className="input w-full pl-9"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!addressInput.trim()}>
            <Navigation className="h-4 w-4" /> Go
          </button>
          {customDest && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCustomDest(null);
                setAddressInput("");
                setStarted(false);
                setStats(null);
              }}
            >
              Clear
            </button>
          )}
        </form>
        <p className="mt-1 text-xs text-white/40">
          Type any address to route there from your live location — or pick a load below.
        </p>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">
          Load queue
        </label>
        <select
          value={load.id}
          onChange={(e) => {
            setId(e.target.value);
            setAccepted(false);
            setStarted(false);
            setStats(null);
          }}
          className="input max-w-md"
        >
          {loads.map((l) => (
            <option key={l.id} value={l.id}>
              {(l.externalId ?? l.id)} · {l.originCity}, {l.originState} → {l.destCity}, {l.destState}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div
          className={clsx(
            "card overflow-hidden",
            fullscreen && "fixed inset-0 z-30 m-0 flex flex-col rounded-none border-0",
          )}
        >
          <div className={clsx("relative w-full", fullscreen ? "flex-1" : "h-80")}>
            <button
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
              className="absolute right-4 top-4 z-[600] grid h-10 w-10 place-items-center rounded-lg bg-navy-900/85 text-white/80 backdrop-blur transition hover:bg-navy-900"
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            {activeId === "trimble" ? (
              <TrimbleMap
                key={`trimble-${showRoute}-${pointSig(routeOrigin)}->${dest}`}
                driver={driverPos}
                origin={routeOrigin}
                dest={dest}
                showRoute={showRoute}
                apiKey={keys.trimble ?? ""}
                hazmat={!!on.hazmat}
                onStats={setStats}
              />
            ) : (
              <OsmMap
                key={`osm-${showRoute}-${pointSig(routeOrigin)}->${dest}`}
                driver={driverPos}
                origin={routeOrigin}
                dest={dest}
                showRoute={showRoute}
                onStats={setStats}
              />
            )}

            {/* Origin / destination chips only make sense once a route is drawn */}
            {showRoute ? (
              <>
                <div className="pointer-events-none absolute left-4 top-4 z-[500] flex items-center gap-1.5 rounded-lg bg-navy-900/85 px-2.5 py-1.5 text-xs">
                  <MapPin className="h-3.5 w-3.5 text-success" />
                  {usingLiveGps ? "My location" : originCity}
                </div>
                <div className="pointer-events-none absolute right-16 top-4 z-[500] flex items-center gap-1.5 rounded-lg bg-navy-900/85 px-2.5 py-1.5 text-xs">
                  <Flag className="h-3.5 w-3.5 text-danger" /> {dest}
                </div>
                <div className="absolute bottom-4 left-1/2 z-[500] flex -translate-x-1/2 items-center gap-2 rounded-full bg-electric px-4 py-1.5 text-xs font-semibold text-white shadow-glow">
                  <Navigation className="h-3.5 w-3.5" /> Navigating ·{" "}
                  {stats ? `${Math.round(stats.miles).toLocaleString()} mi` : `${load.miles.toLocaleString()} mi`}
                </div>
              </>
            ) : (
              <div className="pointer-events-none absolute left-4 top-4 z-[500] flex items-center gap-1.5 rounded-lg bg-navy-900/85 px-2.5 py-1.5 text-xs">
                <LocateFixed
                  className={clsx("h-3.5 w-3.5", geoStatus === "ok" ? "text-electric" : "text-white/50")}
                />
                {geoStatus === "ok"
                  ? "Live location"
                  : geoStatus === "locating"
                  ? "Locating…"
                  : geoStatus === "denied"
                  ? "Location off"
                  : "Location unavailable"}
              </div>
            )}
          </div>

          <div className="border-t border-white/5 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-white/40">Map engine</span>
              {engines.map((e) => {
                const selected = e.id === activeId;
                return (
                  <button
                    key={e.id}
                    onClick={() => e.ready && setEngine(e.id)}
                    disabled={!e.ready}
                    title={e.ready ? undefined : "Connect this provider (with your API key) in the Plugin Engine"}
                    className={clsx(
                      "chip px-3 py-1 text-xs",
                      e.ready ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                      selected
                        ? "bg-electric/15 text-electric ring-1 ring-electric/40"
                        : "bg-white/5 text-white/60 hover:bg-white/10"
                    )}
                  >
                    {!e.ready && <Lock className="mr-1 inline h-3 w-3" />}
                    {e.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-white/60">
                {stats
                  ? `${Math.round(stats.miles).toLocaleString()} mi · ~${stats.hours.toFixed(1)} hrs drive`
                  : `${load.miles.toLocaleString()} mi · ~${Math.round(load.miles / 52)} hrs drive`}{" "}
                · {load.equipment}
              </span>

              <div className="flex items-center gap-2">
                {geoStatus !== "ok" && (
                  <button className="btn-ghost" onClick={requestGeo} title="Use my current GPS location">
                    <LocateFixed className="h-4 w-4" /> Use my location
                  </button>
                )}

                {!accepted ? (
                  <button className="btn-primary" onClick={() => setAccepted(true)}>
                    <Check className="h-4 w-4" /> Accept load
                  </button>
                ) : !started ? (
                  <>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setAccepted(false);
                        setStats(null);
                      }}
                    >
                      Release
                    </button>
                    <button className="btn-primary" onClick={() => setStarted(true)}>
                      <Navigation className="h-4 w-4" /> Start route
                    </button>
                  </>
                ) : (
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setStarted(false);
                      setStats(null);
                    }}
                  >
                    <Square className="h-4 w-4" /> Stop route
                  </button>
                )}
              </div>
            </div>

            <p className="mt-2 text-xs text-white/40">
              {!accepted
                ? "This load is in your queue. Accept it to pull it out, then Start route to navigate from your live GPS location to the destination."
                : !started
                ? usingLiveGps
                  ? "Load accepted. Start route to navigate from your current GPS location to the destination."
                  : "Load accepted. Turn on location (Use my location) to start from your GPS — otherwise the route begins at the pickup city."
                : activeEngine.id === "osm"
                ? "Navigating on the free live map (OpenStreetMap + real driving route). Connect Trimble, Google, or HERE in the Plugin Engine and this screen switches automatically."
                : `Navigating with ${activeEngine.label} — powered by your connected API key.`}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold text-white/70">Route settings</div>
            <div className="space-y-1">
              {TOGGLES.map((t) => {
                const Icon = t.icon;
                const isOn = on[t.key];
                return (
                  <button
                    key={t.key}
                    onClick={() => setOn((s) => ({ ...s, [t.key]: !s[t.key] }))}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                  >
                    <span className="flex items-center gap-2 text-white/70">
                      <Icon className="h-4 w-4" /> {t.label}
                    </span>
                    <span className={clsx("relative h-5 w-9 rounded-full transition", isOn ? "bg-electric" : "bg-white/10")}>
                      <span
                        className={clsx(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition",
                          isOn ? "left-4" : "left-0.5"
                        )}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold text-white/70">Trip P&amp;L</div>
            <PL label="Revenue" value={money(load.rate)} />
            <PL label="Fuel cost" value={`- ${money(load.fuelCost)}`} muted />
            <PL label="Deadhead cost" value={`- ${money(deadheadCost)}`} muted />
            <PL label="Fixed / operating" value={`- ${money(Math.max(0, load.fixedCost - deadheadCost))}`} muted />
            <div className="my-2 border-t border-white/10" />
            <PL label="Net profit" value={money(load.netProfit)} accent={load.netProfit >= 0 ? "#16C784" : "#EF4444"} bold />
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
              <span className="text-white/60">Reload probability at destination</span>
              <span className="font-bold" style={{ color: scoreColor(load.scores.reload) }}>
                {load.scores.reload}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PL({
  label,
  value,
  muted,
  bold,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={muted ? "text-white/40" : "text-white/70"}>{label}</span>
      <span className={bold ? "text-base font-bold" : "font-medium"} style={accent ? { color: accent } : {}}>
        {value}
      </span>
    </div>
  );
}
