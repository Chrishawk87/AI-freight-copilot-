"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Navigation,
  Navigation2,
  MapPin,
  Flag,
  Fuel,
  Scale,
  TriangleAlert,
  Cloud,
  ParkingSquare,
  Lock,
  Square,
  LocateFixed,
  Check,
  Search,
  Maximize2,
  Minimize2,
  Clock,
  Truck,
  X,
} from "lucide-react";
import { PageHeader, money, scoreColor, Loading, ErrorState } from "@/components/ui";
import { DIESEL_PRICE } from "@/lib/scoring";
import { api, type PlacePoi, type PlaceCategory } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import {
  LiveMap,
  geocode,
  brandColor,
  POI_COLORS,
  type NavStep,
  type Stats,
  type StationPin,
} from "@/components/LiveMap";
import { US_CENTER, haversineMiles, type LatLon } from "@/lib/geolocation";
import { readEnabled, readKeys, resolveMapEngine, type EnabledMap, type KeyMap } from "@/lib/plugins";
import clsx from "clsx";

// `requiresTrimble` toggles only affect routing on the Trimble (truck-legal)
// engine — the free OSM engine can't honor them. `soon` toggles aren't wired to
// any engine yet, so we show them disabled rather than let a driver trust a
// setting that does nothing. Keep this in sync with what TrimbleMap consumes.
const TOGGLES = [
  { key: "hazmat", label: "Hazmat routing", icon: TriangleAlert, requiresTrimble: true },
  { key: "bridge", label: "Low bridge avoidance", icon: TriangleAlert, soon: true },
  { key: "weight", label: "Weight restrictions", icon: Scale, soon: true },
  { key: "weather", label: "Weather-aware", icon: Cloud, soon: true },
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

function pointSig(p: LatLon | string | null): string {
  if (p == null) return "none";
  if (typeof p === "string") return p;
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
}

type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

// Live phone GPS + compass heading so the nav camera can point down the road.
function useDriverLocation() {
  const [pos, setPos] = useState<LatLon | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const applyFix = (p: GeolocationPosition) => {
    setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
    const h = p.coords.heading;
    if (typeof h === "number" && !Number.isNaN(h)) setHeading(h);
    setStatus("ok");
  };

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      applyFix,
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    const id = navigator.geolocation.watchPosition(
      applyFix,
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { pos, heading, status, request };
}

// ---------- Trimble engine (client's own key). Falls back to the free map ----------
type EngineMapProps = {
  driver: LatLon | null;
  origin: LatLon | string | null;
  dest: string | null;
  destPoint: LatLon | null;
  showRoute: boolean;
  follow: boolean;
  heading: number | null;
  stations: StationPin[];
  pois: PlacePoi[];
  selectedId: string | null;
  onSelectStation: (id: string) => void;
  onSelectPoi: (osmId: string) => void;
  onStats: (s: Stats) => void;
  onSteps: (s: NavStep[]) => void;
};

function TrimbleMap({
  apiKey,
  hazmat,
  ...m
}: EngineMapProps & { apiKey: string; hazmat: boolean }) {
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

        if (!m.showRoute || (!m.dest && !m.destPoint)) {
          const c = m.driver ?? US_CENTER;
          map = new TM.Map({
            container: ref.current,
            style: TM.Common?.Style?.TRANSPORTATION,
            center: new TM.LngLat(c.lon, c.lat),
            zoom: m.driver ? 11 : 4,
          });
          map.on("error", () => !cancelled && setFailed(true));
          return;
        }

        const startPoint = m.origin ?? m.driver ?? US_CENTER;
        const o = typeof startPoint === "string" ? await geocode(startPoint) : startPoint;
        const d = m.destPoint ?? (await geocode(m.dest as string));
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
              if (miles) m.onStats?.({ miles, hours: hours ?? 0 });
            });
            route.addTo(map);
          } catch {
            if (!cancelled) setFailed(true);
          }
        });
        map.on("error", () => !cancelled && setFailed(true));
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
  }, [pointSig(m.driver), pointSig(m.origin), m.dest, pointSig(m.destPoint), m.showRoute, apiKey, hazmat]);

  // Trimble draws truck-legal routes; fuel/POI pins + cards live on the free map,
  // so any SDK/key failure drops back to the full-featured LiveMap.
  if (failed) return <LiveMap {...m} />;
  return <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />;
}

// Speak a turn instruction with the browser's built-in voice (free, no key).
function speakTurn(text: string) {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

// Clock time the driver arrives if they leave now.
function formatEta(hours: number): string {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function formatDur(hours: number): string {
  const h = Math.floor(hours);
  const mm = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// OSM opening_hours is a free-form tag — surface it honestly.
function formatHours(raw?: string | null): string {
  if (!raw) return "Hours not listed";
  if (/24\s*\/\s*7/.test(raw)) return "Open 24 hours";
  return raw;
}

const POI_TOGGLES: { key: PlaceCategory; label: string; icon: any }[] = [
  { key: "fuel", label: "Fuel", icon: Fuel },
  { key: "rest_area", label: "Rest areas", icon: ParkingSquare },
  { key: "truck_parking", label: "Truck parking", icon: ParkingSquare },
  { key: "weigh_station", label: "Weigh stations", icon: Scale },
  { key: "services", label: "Service areas", icon: MapPin },
];

export default function NavigationPage() {
  const loadsQ = useApi(() => api.loads(), []);
  const carrierQ = useApi(() => api.carrier(), []);
  const [id, setId] = useState<string | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({
    hazmat: false,
    bridge: false,
    weight: false,
    weather: false,
  });
  const [accepted, setAccepted] = useState(false);
  const [started, setStarted] = useState(false);
  const [enabledPlugins, setEnabledPlugins] = useState<EnabledMap>({});
  const [keys, setKeys] = useState<KeyMap>({});
  const [engine, setEngine] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(null);
  const [customDest, setCustomDest] = useState<string | null>(null); // typed address or station label
  const [destCoord, setDestCoord] = useState<LatLon | null>(null); // exact coords (station/POI Go)
  const [addressInput, setAddressInput] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [steps, setSteps] = useState<NavStep[]>([]);
  const [voiceOn, setVoiceOn] = useState(true);
  const [places, setPlaces] = useState<PlacePoi[]>([]);
  const [fuelStations, setFuelStations] = useState<StationPin[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [poiOn, setPoiOn] = useState<Record<PlaceCategory, boolean>>({
    fuel: true,
    rest_area: true,
    truck_parking: true,
    weigh_station: true,
    services: false,
  });
  const spokenRef = useRef<number>(-1);
  const { pos: driverPos, heading: driverHeading, status: geoStatus, request: requestGeo } = useDriverLocation();
  const searchParams = useSearchParams();

  // Nearby data — fetched once per ~0.1° GPS cell so watchPosition jitter
  // doesn't spam the backend. Fuel comes from /fuel (price + hours + access);
  // rest/parking/weigh/services come from /places.
  const gridLat = driverPos ? Math.round(driverPos.lat * 10) / 10 : null;
  const gridLon = driverPos ? Math.round(driverPos.lon * 10) / 10 : null;
  useEffect(() => {
    if (gridLat == null || gridLon == null) {
      setPlaces([]);
      setFuelStations([]);
      return;
    }
    let cancelled = false;
    api
      .places(gridLat, gridLon, 30)
      .then((r) => !cancelled && setPlaces(r.places))
      .catch(() => !cancelled && setPlaces([]));
    api
      .fuel(gridLat, gridLon)
      .then((r) => {
        if (cancelled) return;
        const pins: StationPin[] = (r.stations ?? [])
          .filter((s) => s.latitude != null && s.longitude != null)
          .map((s) => ({
            id: s.id,
            name: s.name,
            network: s.network,
            lat: s.latitude as number,
            lon: s.longitude as number,
            price: r.priceEnriched ? s.price : s.price ?? null,
            hours: s.hours ?? null,
            hgv: s.hgv,
            diesel: s.diesel,
            distanceMi: s.distanceMi,
          }));
        setFuelStations(pins);
      })
      .catch(() => !cancelled && setFuelStations([]));
    return () => {
      cancelled = true;
    };
  }, [gridLat, gridLon]);

  // Live distance from the driver to each station, for the tap-card.
  const stations: StationPin[] = useMemo(
    () =>
      fuelStations.map((s) => ({
        ...s,
        distanceMi: driverPos
          ? Math.round(haversineMiles(driverPos, { lat: s.lat, lon: s.lon }))
          : s.distanceMi,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fuelStations, driverPos?.lat, driverPos?.lon],
  );

  const visibleStations = useMemo(
    () => (poiOn.fuel ? stations : []),
    [poiOn.fuel, stations],
  );
  const visiblePois = useMemo(
    () => places.filter((p) => p.category !== "fuel" && poiOn[p.category]),
    [places, poiOn],
  );

  const selectedStation = useMemo(
    () => stations.find((s) => s.id === selectedStationId) ?? null,
    [stations, selectedStationId],
  );
  const selectedPoi = useMemo(
    () => places.find((p) => p.osmId === selectedPoiId) ?? null,
    [places, selectedPoiId],
  );

  const selectStation = useCallback((sid: string) => {
    setSelectedPoiId(null);
    setSelectedStationId(sid);
  }, []);
  const selectPoi = useCallback((osmId: string) => {
    setSelectedStationId(null);
    setSelectedPoiId(osmId);
  }, []);

  // The maneuver the driver is approaching (nearest step to the live GPS).
  const nextStep = useMemo(() => {
    if (!driverPos || !steps.length) return null;
    let best = 0;
    let bestDist = Infinity;
    steps.forEach((s, i) => {
      const d = haversineMiles(driverPos, { lat: s.lat, lon: s.lon });
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return { idx: best, dist: bestDist, step: steps[best] };
  }, [driverPos, steps]);

  useEffect(() => {
    if (!voiceOn || !nextStep) return;
    if (nextStep.dist < 0.3 && spokenRef.current !== nextStep.idx) {
      spokenRef.current = nextStep.idx;
      speakTurn(nextStep.step.text);
    }
  }, [voiceOn, nextStep]);

  const routeActive = started && (!!customDest || accepted);
  useEffect(() => {
    if (!routeActive) {
      setSteps([]);
      spokenRef.current = -1;
    }
  }, [routeActive]);

  // Route to a typed address (or one handed over by the Co-Pilot).
  const routeToAddress = useCallback((addr: string) => {
    const a = addr.trim();
    if (!a) return;
    setCustomDest(a);
    setDestCoord(null);
    setAddressInput(a);
    setStats(null);
    setStarted(true);
  }, []);

  // Route straight to a fuel station / POI by exact coordinates.
  const goToPoint = useCallback((label: string, point: LatLon) => {
    setCustomDest(label);
    setDestCoord(point);
    setStats(null);
    setStarted(true);
    setSelectedStationId(null);
    setSelectedPoiId(null);
  }, []);

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
  const dest = customDest ?? `${load.destCity}, ${load.destState}`;
  const routeOrigin: LatLon | string = driverPos ?? originCity;
  const usingLiveGps = !!driverPos;
  const showRoute = routeActive;

  const activeId = engines.find((e) => e.id === engine && e.ready)?.id ?? "osm";
  const activeEngine = engines.find((e) => e.id === activeId)!;

  const mpg = carrierQ.data?.mpg ?? 6.8;
  const fcpm = carrierQ.data?.fixedCostPerMile ?? 0.72;
  const deadheadCost = (load.deadheadMiles / mpg) * DIESEL_PRICE + load.deadheadMiles * fcpm;

  const selectedId = selectedStationId ?? selectedPoiId;
  const cardOpen = !!selectedStation || !!selectedPoi;

  const mapProps: EngineMapProps = {
    driver: driverPos,
    origin: routeOrigin,
    dest,
    destPoint: destCoord,
    showRoute,
    follow: routeActive,
    heading: driverHeading,
    stations: visibleStations,
    pois: visiblePois,
    selectedId,
    onSelectStation: selectStation,
    onSelectPoi: selectPoi,
    onStats: setStats,
    onSteps: setSteps,
  };

  return (
    <div>
      <PageHeader title="Profit Navigation" subtitle="One live map: your route, plus fuel and stops in the immediate area." />

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
          {(customDest || destCoord) && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setCustomDest(null);
                setDestCoord(null);
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
          Type any address, tap a fuel pin to route there, or pick a load below.
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
            setDestCoord(null);
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
                key="trimble-live"
                {...mapProps}
                apiKey={keys.trimble ?? ""}
                hazmat={!!on.hazmat}
              />
            ) : (
              <LiveMap key="osm-live" {...mapProps} />
            )}

            {/* Next-maneuver banner */}
            {showRoute && nextStep && (
              <div className="absolute left-1/2 top-4 z-[550] flex max-w-[92%] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-navy-900/90 px-3.5 py-2 text-white shadow-glow backdrop-blur">
                <Navigation className="h-5 w-5 shrink-0 text-electric" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{nextStep.step.text}</div>
                  <div className="text-[11px] text-white/50">
                    {nextStep.dist < 0.1
                      ? "now"
                      : `in ${nextStep.dist.toFixed(nextStep.dist < 1 ? 1 : 0)} mi`}
                  </div>
                </div>
                <button
                  onClick={() => setVoiceOn((v) => !v)}
                  title={voiceOn ? "Mute voice" : "Unmute voice"}
                  className={clsx(
                    "ml-1 shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium",
                    voiceOn ? "bg-electric/20 text-electric" : "bg-white/10 text-white/50",
                  )}
                >
                  {voiceOn ? "Voice on" : "Muted"}
                </button>
              </div>
            )}

            {/* Route / location chip */}
            {showRoute ? (
              <div className="pointer-events-none absolute left-4 top-4 z-[500] flex max-w-[55%] items-center gap-1.5 rounded-lg bg-navy-900/85 px-2.5 py-1.5 text-xs">
                <Flag className="h-3.5 w-3.5 shrink-0 text-danger" />
                <span className="truncate">
                  {usingLiveGps ? "My location" : originCity} → {dest}
                </span>
              </div>
            ) : (
              <div className="pointer-events-none absolute left-4 top-4 z-[500] flex items-center gap-1.5 rounded-lg bg-navy-900/85 px-2.5 py-1.5 text-xs">
                <LocateFixed className={clsx("h-3.5 w-3.5", geoStatus === "ok" ? "text-electric" : "text-white/50")} />
                {geoStatus === "ok"
                  ? "Live location"
                  : geoStatus === "locating"
                  ? "Locating…"
                  : geoStatus === "denied"
                  ? "Location off"
                  : "Location unavailable"}
              </div>
            )}

            {/* Selected fuel station card */}
            {selectedStation && (
              <PlaceCard
                onClose={() => setSelectedStationId(null)}
                accent={brandColor(selectedStation.network)}
                title={selectedStation.name}
                subtitle={selectedStation.network}
                price={selectedStation.price ?? undefined}
                distanceMi={selectedStation.distanceMi ?? undefined}
                hours={formatHours(selectedStation.hours)}
                truckAccessible={selectedStation.hgv}
                diesel={selectedStation.diesel}
                onGo={() =>
                  goToPoint(selectedStation.name, { lat: selectedStation.lat, lon: selectedStation.lon })
                }
              />
            )}

            {/* Selected rest area / parking / weigh station card */}
            {selectedPoi && !selectedStation && (
              <PlaceCard
                onClose={() => setSelectedPoiId(null)}
                accent={POI_COLORS[selectedPoi.category] ?? "#94A3B8"}
                title={selectedPoi.name}
                subtitle={selectedPoi.label}
                distanceMi={selectedPoi.distanceMi}
                truckAccessible={selectedPoi.hgv}
                onGo={() => goToPoint(selectedPoi.name, { lat: selectedPoi.lat, lon: selectedPoi.lon })}
              />
            )}

            {/* Google-style bottom arrival bar (hidden while a place card is open) */}
            {showRoute && !cardOpen && (
              <div className="absolute inset-x-3 bottom-3 z-[520] flex items-center justify-between gap-3 rounded-2xl bg-navy-900/92 px-4 py-3 text-white shadow-glow backdrop-blur">
                <div>
                  <div className="text-lg font-bold leading-none">{stats ? formatEta(stats.hours) : "—"}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-white/40">Arrival</div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold">
                    {stats
                      ? `${formatDur(stats.hours)} · ${Math.round(stats.miles).toLocaleString()} mi`
                      : `${load.miles.toLocaleString()} mi`}
                  </div>
                  <div className="text-[11px] text-white/40">
                    {activeEngine.id === "osm" ? "Live route" : activeEngine.label}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setStarted(false);
                    setStats(null);
                  }}
                  className="shrink-0 rounded-xl bg-danger/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-danger"
                >
                  Exit
                </button>
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
                        : "bg-white/5 text-white/60 hover:bg-white/10",
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
                ? "Fuel, rest areas, and weigh stations near you show on the map right now. Accept a load, type an address, or tap a fuel pin to route there."
                : !started
                ? usingLiveGps
                  ? "Load accepted. Start route to navigate from your current GPS location to the destination."
                  : "Load accepted. Turn on location (Use my location) to start from your GPS — otherwise the route begins at the pickup city."
                : activeEngine.id === "osm"
                ? "Navigating on the free live map. Connect Trimble, Google, or HERE in the Plugin Engine and this screen switches automatically."
                : `Navigating with ${activeEngine.label} — powered by your connected API key.`}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Turn-by-turn */}
          {showRoute && steps.length > 0 && (
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-white/70">Turn-by-turn</span>
                <button
                  onClick={() => setVoiceOn((v) => !v)}
                  className={clsx(
                    "chip px-2 py-1 text-[11px]",
                    voiceOn ? "bg-electric/15 text-electric" : "bg-white/5 text-white/50",
                  )}
                >
                  {voiceOn ? "Voice on" : "Muted"}
                </button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {steps.map((s, i) => {
                  const current = nextStep?.idx === i;
                  return (
                    <div
                      key={i}
                      className={clsx(
                        "flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm",
                        current ? "bg-electric/15 text-white" : "text-white/60",
                      )}
                    >
                      <Navigation className={clsx("mt-0.5 h-3.5 w-3.5 shrink-0", current ? "text-electric" : "text-white/30")} />
                      <div className="min-w-0">
                        <div className="truncate">{s.text}</div>
                        {s.distanceMi >= 0.1 && (
                          <div className="text-[11px] text-white/35">
                            {s.distanceMi.toFixed(s.distanceMi < 1 ? 1 : 0)} mi
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-white/35">
                Car-legal turn-by-turn on the free map. For truck-legal turns (low bridges, weight/hazmat), connect Trimble in the Plugin Engine.
              </p>
            </div>
          )}

          {/* Show nearby */}
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white/70">Show nearby</span>
              <span className="text-[11px] text-white/35">
                {geoStatus === "ok" ? `${visibleStations.length + visiblePois.length} shown` : "GPS off"}
              </span>
            </div>
            <div className="space-y-1">
              {POI_TOGGLES.map((t) => {
                const Icon = t.icon;
                const isOn = poiOn[t.key];
                const count =
                  t.key === "fuel"
                    ? stations.length
                    : places.filter((p) => p.category === t.key).length;
                return (
                  <button
                    key={t.key}
                    onClick={() => setPoiOn((s) => ({ ...s, [t.key]: !s[t.key] }))}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                  >
                    <span className="flex items-center gap-2 text-white/70">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: POI_COLORS[t.key] }} />
                      <Icon className="h-4 w-4" /> {t.label}
                      {count > 0 && <span className="text-[11px] text-white/35">({count})</span>}
                    </span>
                    <span className={clsx("relative h-5 w-9 rounded-full transition", isOn ? "bg-electric" : "bg-white/10")}>
                      <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", isOn ? "left-4" : "left-0.5")} />
                    </span>
                  </button>
                );
              })}
            </div>
            {geoStatus !== "ok" && (
              <button onClick={requestGeo} className="mt-2 text-xs text-electric">
                Enable GPS to see stops near you →
              </button>
            )}
          </div>

          {/* Route settings */}
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold text-white/70">Route settings</div>
            <div className="space-y-1">
              {TOGGLES.map((t) => {
                const Icon = t.icon;
                // A toggle is only live if the engine that honors it is active.
                // Trimble-only toggles are inert on the free OSM engine; `soon`
                // toggles aren't wired to any engine yet.
                const trimbleActive = activeId === "trimble";
                const available = t.soon ? false : t.requiresTrimble ? trimbleActive : true;
                const isOn = available && on[t.key];
                const note = t.soon
                  ? "Coming soon"
                  : t.requiresTrimble && !trimbleActive
                    ? "Trimble only"
                    : null;
                return (
                  <button
                    key={t.key}
                    disabled={!available}
                    onClick={() => setOn((s) => ({ ...s, [t.key]: !s[t.key] }))}
                    className={clsx(
                      "flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm",
                      available ? "hover:bg-white/5" : "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="flex items-center gap-2 text-white/70">
                      <Icon className="h-4 w-4" /> {t.label}
                    </span>
                    {note ? (
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/40">
                        {note}
                      </span>
                    ) : (
                      <span className={clsx("relative h-5 w-9 rounded-full transition", isOn ? "bg-electric" : "bg-white/10")}>
                        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition", isOn ? "left-4" : "left-0.5")} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-2 text-[11px] leading-snug text-white/40">
              Truck-legal routing (hazmat, bridge &amp; weight limits) applies on the
              Trimble engine. Connect Trimble in the Plugin Engine to enable it.
            </p>
          </div>

          {/* Trip P&L */}
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

// A tap-card for a fuel station or a rest/parking/weigh POI, shown over the map.
function PlaceCard({
  title,
  subtitle,
  accent,
  price,
  distanceMi,
  hours,
  truckAccessible,
  diesel,
  onGo,
  onClose,
}: {
  title: string;
  subtitle: string;
  accent: string;
  price?: number;
  distanceMi?: number;
  hours?: string;
  truckAccessible?: boolean;
  diesel?: boolean;
  onGo: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-[540] rounded-2xl bg-navy-900/95 p-4 text-white shadow-glow backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${accent}22` }}>
            <MapPin className="h-4 w-4" style={{ color: accent }} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="text-[11px] text-white/50">{subtitle}</div>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/60">
        {price != null && (
          <span className="rounded-md bg-success/15 px-2 py-1 font-semibold text-success">
            ${price.toFixed(2)}/gal
          </span>
        )}
        {distanceMi != null && (
          <span className="flex items-center gap-1">
            <Navigation2 className="h-3 w-3" /> {Math.round(distanceMi)} mi
          </span>
        )}
        {hours && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {hours}
          </span>
        )}
        {truckAccessible && (
          <span className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1">
            <Truck className="h-3 w-3" /> Truck-accessible
          </span>
        )}
        {diesel && <span className="rounded-md bg-white/10 px-2 py-1">Diesel</span>}
      </div>

      <button
        onClick={onGo}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-electric px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-electric/90"
      >
        <Navigation className="h-4 w-4" /> Go here
      </button>
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
