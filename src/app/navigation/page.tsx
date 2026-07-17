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
import { api, type PlacePoi, type PlaceCategory } from "@/lib/api";
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

// Live phone GPS. Watches position so the "you are here" dot tracks the driver,
// and captures compass heading so the nav camera can point down the road.
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
      applyFix,
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { pos, heading, status, request };
}

type Stats = { miles: number; hours: number } | null;

// A single turn-by-turn instruction along the route.
export type NavStep = {
  text: string; // human maneuver, e.g. "Turn right onto Main St"
  road: string;
  distanceMi: number; // length of this step
  lat: number;
  lon: number; // where the maneuver happens
  type: string;
  modifier?: string;
};

// Turn OSRM's maneuver object into plain driver-speak.
function describeManeuver(step: any): string {
  const m = step?.maneuver ?? {};
  const type: string = m.type ?? "";
  const mod: string = m.modifier ?? "";
  const road: string = step?.name?.trim() || "the road";
  const onRoad = step?.name?.trim() ? ` onto ${road}` : "";
  const contRoad = step?.name?.trim() ? ` on ${road}` : "";
  const dir = mod ? mod.replace("slight ", "slight ").replace("sharp ", "sharp ") : "";
  switch (type) {
    case "depart":
      return `Head out${contRoad}`;
    case "turn":
      return `Turn ${dir || "ahead"}${onRoad}`;
    case "new name":
    case "continue":
      return `Continue${contRoad}`;
    case "merge":
      return `Merge${onRoad}`;
    case "on ramp":
      return `Take the ramp${onRoad}`;
    case "off ramp":
      return `Take the exit${onRoad}`;
    case "fork":
      return `Keep ${dir || "straight"}${onRoad}`;
    case "end of road":
      return `Turn ${dir || "ahead"}${onRoad}`;
    case "roundabout":
    case "rotary":
      return `At the roundabout, exit${onRoad}`;
    case "arrive":
      return "Arrive at your destination";
    default:
      return dir ? `Bear ${dir}${onRoad}` : `Continue${contRoad}`;
  }
}

// ---------- Free engine: Leaflet + OpenStreetMap + OSRM ----------
async function osrmRoute(o: { lat: number; lon: number }, d: { lat: number; lon: number }) {
  const url = `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  const data = await res.json();
  const r = data?.routes?.[0];
  if (!r) throw new Error("No route");
  const steps: NavStep[] = [];
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const loc = s?.maneuver?.location as [number, number] | undefined;
      if (!loc) continue;
      steps.push({
        text: describeManeuver(s),
        road: s?.name?.trim() || "",
        distanceMi: (s.distance ?? 0) / 1609.34,
        lat: loc[1],
        lon: loc[0],
        type: s?.maneuver?.type ?? "",
        modifier: s?.maneuver?.modifier,
      });
    }
  }
  return {
    line: (r.geometry.coordinates as [number, number][]).map(([lon, lat]) => [lat, lon]) as [number, number][],
    miles: r.distance / 1609.34,
    hours: r.duration / 3600,
    steps,
  };
}

// Straight-line miles between two points (for step progress + POI distance).
function milesBetween(a: LatLon, b: LatLon): number {
  const R = 3958.7613;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Category → pin color for driver POIs on the map.
const POI_COLORS: Record<string, string> = {
  fuel: "#16C784",
  rest_area: "#38BDF8",
  services: "#A78BFA",
  weigh_station: "#F59E0B",
  truck_parking: "#F472B6",
};

type MapProps = {
  driver: LatLon | null; // live phone position (for the "you are here" dot)
  origin: LatLon | string | null; // where a route starts (GPS fix, or a fallback city)
  dest: string | null; // destination place name
  showRoute: boolean; // false = plain map; true = draw origin→dest
  pois?: PlacePoi[]; // rest areas, parking, weigh stations, fuel
  heading?: number | null; // GPS compass heading (deg) for the nav camera
  follow?: boolean; // chase the driver with a tilted nav camera
  onStats?: (s: Stats) => void;
  onSteps?: (s: NavStep[]) => void; // turn-by-turn instructions
};

// Empty GeoJSON FeatureCollection — initial data for map sources.
function emptyFC() {
  return { type: "FeatureCollection" as const, features: [] as any[] };
}

// Stable signature so POI changes only rebuild the map when they actually change.
function poiSig(pois?: PlacePoi[]): string {
  if (!pois?.length) return "0";
  return `${pois.length}:${pois[0].osmId}`;
}

function OsmMap({ driver, origin, dest, showRoute, pois, heading, follow, onStats, onSteps }: MapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const originMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const centeredRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [ready, setReady] = useState(false);

  // ---- Build the map once. All later changes are applied imperatively so the
  // map never tears down mid-drive (that's what made the old one feel clunky). ----
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        loadCss("https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css");
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js");
        const maplibregl = (window as any).maplibregl;
        if (cancelled || !ref.current || !maplibregl) throw new Error("maplibre unavailable");

        const c = driver ?? US_CENTER;
        const map = new maplibregl.Map({
          container: ref.current,
          style: "https://tiles.openfreemap.org/styles/liberty", // free vector tiles, no key
          center: [c.lon, c.lat],
          zoom: driver ? 12 : 3.6,
          attributionControl: true,
        });
        mapRef.current = map;

        map.on("load", () => {
          if (cancelled) return;
          // Route: a dark casing under a bright blue line — the Google look.
          map.addSource("route", { type: "geojson", data: emptyFC() });
          map.addLayer({
            id: "route-casing",
            type: "line",
            source: "route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#0B2A6B", "line-width": 9, "line-opacity": 0.95 },
          });
          map.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#2E7DFF", "line-width": 5.5 },
          });
          // POIs: colored dots the driver can tap.
          map.addSource("pois", { type: "geojson", data: emptyFC() });
          map.addLayer({
            id: "poi-dots",
            type: "circle",
            source: "pois",
            paint: {
              "circle-radius": 6,
              "circle-color": ["get", "color"],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": 0.95,
            },
          });
          map.on("click", "poi-dots", (e: any) => {
            const f = e.features?.[0];
            if (!f) return;
            new maplibregl.Popup({ closeButton: false, offset: 12 })
              .setLngLat(f.geometry.coordinates)
              .setHTML(
                `<div style="font:600 12px system-ui;color:#0f1526">${f.properties.label}</div>` +
                  `<div style="font:12px system-ui;color:#475569">${f.properties.name} · ${f.properties.distanceMi} mi</div>`,
              )
              .addTo(map);
          });
          map.on("mouseenter", "poi-dots", () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", "poi-dots", () => (map.getCanvas().style.cursor = ""));
          setStatus("ready");
          setReady(true);
          setTimeout(() => map.resize(), 150);
        });
        map.on("error", () => {});
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        mapRef.current?.remove();
      } catch {
        /* ignore */
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Driver dot + chase camera ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!ready || !map || !maplibregl || !driver) return;

    if (!driverMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "aifc-driver-dot";
      driverMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([driver.lon, driver.lat])
        .addTo(map);
    } else {
      driverMarkerRef.current.setLngLat([driver.lon, driver.lat]);
    }

    if (follow) {
      // Tilted, forward-pointing nav camera that tracks the driver.
      map.easeTo({
        center: [driver.lon, driver.lat],
        zoom: 15.5,
        pitch: 55,
        bearing: typeof heading === "number" ? heading : map.getBearing(),
        duration: 900,
      });
    } else if (!centeredRef.current) {
      // First fix on the plain map: glide to the driver once.
      map.easeTo({ center: [driver.lon, driver.lat], zoom: 12, duration: 800 });
      centeredRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, driver?.lat, driver?.lon, heading, follow]);

  // ---- POI layer data ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const src = map.getSource("pois");
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: (pois ?? []).map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: {
          color: POI_COLORS[p.category] ?? "#94A3B8",
          label: p.label,
          name: p.name,
          distanceMi: p.distanceMi,
        },
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, poiSig(pois)]);

  // ---- Route line + origin/dest markers ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!ready || !map || !maplibregl) return;
    let cancelled = false;

    const clearMarkers = () => {
      try {
        originMarkerRef.current?.remove();
        destMarkerRef.current?.remove();
      } catch {
        /* ignore */
      }
      originMarkerRef.current = null;
      destMarkerRef.current = null;
    };

    if (!showRoute || !dest) {
      map.getSource("route")?.setData(emptyFC());
      clearMarkers();
      onSteps?.([]);
      if (!follow) map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
      return;
    }

    (async () => {
      try {
        const startPoint = origin ?? driver ?? US_CENTER;
        const [o, d] = await Promise.all([resolvePoint(startPoint), geocode(dest)]);
        if (cancelled) return;
        clearMarkers();
        originMarkerRef.current = new maplibregl.Marker({ color: "#16C784" })
          .setLngLat([o.lon, o.lat])
          .addTo(map);
        destMarkerRef.current = new maplibregl.Marker({ color: "#EF4444" })
          .setLngLat([d.lon, d.lat])
          .addTo(map);

        try {
          const { line, miles, hours, steps } = await osrmRoute(o, d);
          if (cancelled) return;
          const coords = line.map(([lat, lon]) => [lon, lat]);
          map.getSource("route")?.setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: {},
          });
          onStats?.({ miles, hours });
          onSteps?.(steps);
          if (!follow && coords.length) {
            const b = coords.reduce(
              (bb: any, cc: any) => bb.extend(cc),
              new maplibregl.LngLatBounds(coords[0], coords[0]),
            );
            map.fitBounds(b, { padding: 60, duration: 700 });
          }
        } catch {
          if (cancelled) return;
          const b = new maplibregl.LngLatBounds([o.lon, o.lat], [o.lon, o.lat]).extend([d.lon, d.lat]);
          map.fitBounds(b, { padding: 60 });
        }
      } catch {
        /* leave the map as-is on geocode failure */
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showRoute, pointSig(origin), dest]);

  return (
    <>
      <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />
      <style>{`.aifc-driver-dot{width:16px;height:16px;border-radius:9999px;background:#246BFD;border:3px solid #fff;box-shadow:0 0 0 6px rgba(36,107,253,.25)}`}</style>
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
  pois,
  heading,
  follow,
  apiKey,
  hazmat,
  onStats,
  onSteps,
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
    return (
      <OsmMap
        driver={driver}
        origin={origin}
        dest={dest}
        showRoute={showRoute}
        pois={pois}
        heading={heading}
        follow={follow}
        onStats={onStats}
        onSteps={onSteps}
      />
    );
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

// Human drive time, e.g. "6h 20m" or "40m".
function formatDur(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  const [steps, setSteps] = useState<NavStep[]>([]); // turn-by-turn instructions
  const [voiceOn, setVoiceOn] = useState(true); // spoken turn prompts
  const [places, setPlaces] = useState<PlacePoi[]>([]); // nearby driver POIs
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

  // Nearby POIs — fetched once per ~0.1° GPS cell so watchPosition jitter
  // doesn't spam the backend. We pull all categories and filter client-side.
  const gridLat = driverPos ? Math.round(driverPos.lat * 10) / 10 : null;
  const gridLon = driverPos ? Math.round(driverPos.lon * 10) / 10 : null;
  useEffect(() => {
    if (gridLat == null || gridLon == null) {
      setPlaces([]);
      return;
    }
    let cancelled = false;
    api
      .places(gridLat, gridLon, 30)
      .then((r) => !cancelled && setPlaces(r.places))
      .catch(() => !cancelled && setPlaces([]));
    return () => {
      cancelled = true;
    };
  }, [gridLat, gridLon]);

  const visiblePois = useMemo(
    () => places.filter((p) => poiOn[p.category]),
    [places, poiOn]
  );

  // The maneuver the driver is approaching: the nearest step point to the
  // live GPS. Approximate but functional without server-side route matching.
  const nextStep = useMemo(() => {
    if (!driverPos || !steps.length) return null;
    let best = 0;
    let bestDist = Infinity;
    steps.forEach((s, i) => {
      const d = milesBetween(driverPos, { lat: s.lat, lon: s.lon });
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return { idx: best, dist: bestDist, step: steps[best] };
  }, [driverPos, steps]);

  // Speak the upcoming turn once when the driver gets within ~0.3 mi of it.
  useEffect(() => {
    if (!voiceOn || !nextStep) return;
    if (nextStep.dist < 0.3 && spokenRef.current !== nextStep.idx) {
      spokenRef.current = nextStep.idx;
      speakTurn(nextStep.step.text);
    }
  }, [voiceOn, nextStep]);

  // Drop stale turn-by-turn the moment routing stops.
  const routeActive = started && (!!customDest || accepted);
  useEffect(() => {
    if (!routeActive) {
      setSteps([]);
      spokenRef.current = -1;
    }
  }, [routeActive]);

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
  const showRoute = routeActive;

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
                key={`trimble-${showRoute}-${pointSig(routeOrigin)}->${dest}-${poiSig(visiblePois)}`}
                driver={driverPos}
                origin={routeOrigin}
                dest={dest}
                showRoute={showRoute}
                pois={visiblePois}
                heading={driverHeading}
                follow={routeActive}
                apiKey={keys.trimble ?? ""}
                hazmat={!!on.hazmat}
                onStats={setStats}
                onSteps={setSteps}
              />
            ) : (
              // Persistent map — no volatile key, so it never tears down mid-drive.
              <OsmMap
                key="osm-live"
                driver={driverPos}
                origin={routeOrigin}
                dest={dest}
                showRoute={showRoute}
                pois={visiblePois}
                heading={driverHeading}
                follow={routeActive}
                onStats={setStats}
                onSteps={setSteps}
              />
            )}

            {/* Next-maneuver banner — turn-by-turn on the free engine */}
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
                    voiceOn ? "bg-electric/20 text-electric" : "bg-white/10 text-white/50"
                  )}
                >
                  {voiceOn ? "Voice on" : "Muted"}
                </button>
              </div>
            )}

            {/* Destination chip (top-left) while navigating; live-location chip otherwise */}
            {showRoute ? (
              <div className="pointer-events-none absolute left-4 top-4 z-[500] flex max-w-[55%] items-center gap-1.5 rounded-lg bg-navy-900/85 px-2.5 py-1.5 text-xs">
                <Flag className="h-3.5 w-3.5 shrink-0 text-danger" />
                <span className="truncate">
                  {usingLiveGps ? "My location" : originCity} → {dest}
                </span>
              </div>
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

            {/* Google-style bottom arrival bar */}
            {showRoute && (
              <div className="absolute inset-x-3 bottom-3 z-[520] flex items-center justify-between gap-3 rounded-2xl bg-navy-900/92 px-4 py-3 text-white shadow-glow backdrop-blur">
                <div>
                  <div className="text-lg font-bold leading-none">
                    {stats ? formatEta(stats.hours) : "—"}
                  </div>
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
          {/* Turn-by-turn directions (free OSM engine) */}
          {showRoute && steps.length > 0 && (
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-white/70">Turn-by-turn</span>
                <button
                  onClick={() => setVoiceOn((v) => !v)}
                  className={clsx(
                    "chip px-2 py-1 text-[11px]",
                    voiceOn ? "bg-electric/15 text-electric" : "bg-white/5 text-white/50"
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
                        current ? "bg-electric/15 text-white" : "text-white/60"
                      )}
                    >
                      <Navigation
                        className={clsx("mt-0.5 h-3.5 w-3.5 shrink-0", current ? "text-electric" : "text-white/30")}
                      />
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
                Car-legal turn-by-turn on the free map. For truck-legal turns (low
                bridges, weight/hazmat), connect Trimble in the Plugin Engine.
              </p>
            </div>
          )}

          {/* Nearby stops — live from OpenStreetMap */}
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-white/70">Show nearby</span>
              <span className="text-[11px] text-white/35">
                {geoStatus === "ok" ? `${visiblePois.length} shown` : "GPS off"}
              </span>
            </div>
            <div className="space-y-1">
              {POI_TOGGLES.map((t) => {
                const Icon = t.icon;
                const isOn = poiOn[t.key];
                const count = places.filter((p) => p.category === t.key).length;
                return (
                  <button
                    key={t.key}
                    onClick={() => setPoiOn((s) => ({ ...s, [t.key]: !s[t.key] }))}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                  >
                    <span className="flex items-center gap-2 text-white/70">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: POI_COLORS[t.key] }}
                      />
                      <Icon className="h-4 w-4" /> {t.label}
                      {count > 0 && <span className="text-[11px] text-white/35">({count})</span>}
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
            {geoStatus !== "ok" && (
              <button onClick={requestGeo} className="mt-2 text-xs text-electric">
                Enable GPS to see stops near you →
              </button>
            )}
          </div>

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
