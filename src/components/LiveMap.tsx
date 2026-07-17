"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { US_CENTER, type LatLon } from "@/lib/geolocation";
import type { PlacePoi } from "@/lib/api";

// ---------------------------------------------------------------------------
// One shared map for the whole app. Free MapLibre GL + OpenFreeMap vector
// tiles (no API key). Renders the driver, an optional route with turn-by-turn,
// branded fuel price pins, and labeled rest/parking/weigh markers. The map is
// built once and updated imperatively so it never tears down mid-drive.
// ---------------------------------------------------------------------------

export type Stats = { miles: number; hours: number } | null;

// A single turn-by-turn instruction along the route.
export type NavStep = {
  text: string;
  road: string;
  distanceMi: number;
  lat: number;
  lon: number;
  type: string;
  modifier?: string;
};

// A fuel station shown as a branded price pin.
export type StationPin = {
  id: string;
  name: string;
  network: string;
  lat: number;
  lon: number;
  price: number | null;
  hours?: string | null;
  hgv?: boolean;
  diesel?: boolean;
  distanceMi?: number | null;
};

// ---------- shared script/style loaders ----------
function loadCss(href: string) {
  if (typeof document === "undefined") return;
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

// ---------- geocoding + routing (free) ----------
export async function geocode(q: string): Promise<LatLon> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
    { headers: { Accept: "application/json" } },
  );
  const data = await res.json();
  if (!data?.length) throw new Error("No geocode for " + q);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function resolvePoint(p: LatLon | string): Promise<LatLon> {
  return typeof p === "string" ? geocode(p) : p;
}

function pointSig(p: LatLon | string | null | undefined): string {
  if (p == null) return "none";
  if (typeof p === "string") return p;
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
}

// Turn OSRM's maneuver object into plain driver-speak.
export function describeManeuver(step: any): string {
  const m = step?.maneuver ?? {};
  const type: string = m.type ?? "";
  const mod: string = m.modifier ?? "";
  const road: string = step?.name?.trim() || "the road";
  const onRoad = step?.name?.trim() ? ` onto ${road}` : "";
  const contRoad = step?.name?.trim() ? ` on ${road}` : "";
  const dir = mod || "";
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

async function osrmRoute(o: LatLon, d: LatLon) {
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
    coords: (r.geometry.coordinates as [number, number][]).map(([lon, lat]) => [lon, lat]) as [number, number][],
    miles: r.distance / 1609.34,
    hours: r.duration / 3600,
    steps,
  };
}

// ---------- pin styling ----------
const BRAND_COLORS: Record<string, string> = {
  "Love's": "#E4002B",
  Pilot: "#C8102E",
  TA: "#003DA5",
  QT: "#E51937",
  "Buc-ee's": "#B8860B",
  "Kwik Trip": "#E4002B",
  "Road Ranger": "#F59E0B",
  "Sapp Bros": "#0F766E",
};
export function brandColor(network: string): string {
  return BRAND_COLORS[network] ?? "#246BFD";
}

// Non-fuel POI category → color + single-letter glyph on the map marker.
export const POI_COLORS: Record<string, string> = {
  fuel: "#16C784",
  rest_area: "#38BDF8",
  services: "#A78BFA",
  weigh_station: "#F59E0B",
  truck_parking: "#F472B6",
};
const POI_GLYPH: Record<string, string> = {
  rest_area: "R",
  truck_parking: "P",
  weigh_station: "W",
  services: "S",
  fuel: "F",
};

function emptyFC() {
  return { type: "FeatureCollection" as const, features: [] as any[] };
}

function stationSig(stations?: StationPin[]): string {
  if (!stations?.length) return "0";
  return `${stations.length}:${stations[0].id}:${stations[stations.length - 1].id}`;
}
function poiSig(pois?: PlacePoi[]): string {
  if (!pois?.length) return "0";
  return `${pois.length}:${pois[0].osmId}:${pois[pois.length - 1].osmId}`;
}

type LiveMapProps = {
  driver: LatLon | null;
  heading?: number | null;
  origin?: LatLon | string | null;
  dest?: string | null; // destination place name (geocoded)
  destPoint?: LatLon | null; // exact destination coords (wins over dest)
  showRoute?: boolean;
  follow?: boolean;
  stations?: StationPin[];
  pois?: PlacePoi[];
  selectedId?: string | null; // station.id or poi.osmId
  onSelectStation?: (id: string) => void;
  onSelectPoi?: (osmId: string) => void;
  onStats?: (s: Stats) => void;
  onSteps?: (s: NavStep[]) => void;
};

export function LiveMap({
  driver,
  heading,
  origin,
  dest,
  destPoint,
  showRoute,
  follow,
  stations,
  pois,
  selectedId,
  onSelectStation,
  onSelectPoi,
  onStats,
  onSteps,
}: LiveMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const originMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const stationMarkersRef = useRef<Record<string, any>>({});
  const poiMarkersRef = useRef<Record<string, any>>({});
  const centeredRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [ready, setReady] = useState(false);

  // Keep the latest callbacks/props reachable from marker click handlers
  // without forcing marker rebuilds.
  const onSelectStationRef = useRef(onSelectStation);
  onSelectStationRef.current = onSelectStation;
  const onSelectPoiRef = useRef(onSelectPoi);
  onSelectPoiRef.current = onSelectPoi;

  // ---- Build the map once ----
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
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [c.lon, c.lat],
          zoom: driver ? 12 : 3.6,
          attributionControl: true,
        });
        mapRef.current = map;

        map.on("load", () => {
          if (cancelled) return;
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
      map.easeTo({
        center: [driver.lon, driver.lat],
        zoom: 15.5,
        pitch: 55,
        bearing: typeof heading === "number" ? heading : map.getBearing(),
        duration: 900,
      });
    } else if (!centeredRef.current) {
      map.easeTo({ center: [driver.lon, driver.lat], zoom: 11, duration: 800 });
      centeredRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, driver?.lat, driver?.lon, heading, follow]);

  // ---- Fuel price pins ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!ready || !map || !maplibregl) return;
    Object.values(stationMarkersRef.current).forEach((m: any) => m.remove());
    stationMarkersRef.current = {};
    (stations ?? []).forEach((s) => {
      const el = document.createElement("div");
      el.className = "aifc-fuel-pin" + (selectedId === s.id ? " sel" : "");
      el.style.setProperty("--c", brandColor(s.network));
      el.textContent = s.price != null ? `$${s.price.toFixed(2)}` : s.network || "Fuel";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectStationRef.current?.(s.id);
      });
      stationMarkersRef.current[s.id] = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([s.lon, s.lat])
        .addTo(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stationSig(stations), selectedId]);

  // ---- Rest / parking / weigh / service markers ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!ready || !map || !maplibregl) return;
    Object.values(poiMarkersRef.current).forEach((m: any) => m.remove());
    poiMarkersRef.current = {};
    (pois ?? []).forEach((p) => {
      const el = document.createElement("div");
      el.className = "aifc-poi-pin" + (selectedId === p.osmId ? " sel" : "");
      el.style.setProperty("--c", POI_COLORS[p.category] ?? "#94A3B8");
      el.textContent = POI_GLYPH[p.category] ?? "•";
      el.title = `${p.label}: ${p.name}`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectPoiRef.current?.(p.osmId);
      });
      poiMarkersRef.current[p.osmId] = new maplibregl.Marker({ element: el })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, poiSig(pois), selectedId]);

  // ---- Pan to the selected pin ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedId) return;
    const s = (stations ?? []).find((x) => x.id === selectedId);
    const p = (pois ?? []).find((x) => x.osmId === selectedId);
    const target = s ? { lat: s.lat, lon: s.lon } : p ? { lat: p.lat, lon: p.lon } : null;
    if (target) {
      map.easeTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), 12), duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId]);

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

    if (!showRoute || (!dest && !destPoint)) {
      map.getSource("route")?.setData(emptyFC());
      clearMarkers();
      onSteps?.([]);
      if (!follow) map.easeTo({ pitch: 0, bearing: 0, duration: 500 });
      return;
    }

    (async () => {
      try {
        const startPoint = origin ?? driver ?? US_CENTER;
        const [o, d] = await Promise.all([
          resolvePoint(startPoint),
          destPoint ? Promise.resolve(destPoint) : geocode(dest as string),
        ]);
        if (cancelled) return;
        clearMarkers();
        originMarkerRef.current = new maplibregl.Marker({ color: "#16C784" })
          .setLngLat([o.lon, o.lat])
          .addTo(map);
        destMarkerRef.current = new maplibregl.Marker({ color: "#EF4444" })
          .setLngLat([d.lon, d.lat])
          .addTo(map);

        try {
          const { coords, miles, hours, steps } = await osrmRoute(o, d);
          if (cancelled) return;
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
        /* leave the map on geocode failure */
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showRoute, pointSig(origin), dest, pointSig(destPoint)]);

  return (
    <>
      <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />
      <style>{`
        .aifc-driver-dot{width:16px;height:16px;border-radius:9999px;background:#246BFD;border:3px solid #fff;box-shadow:0 0 0 6px rgba(36,107,253,.25)}
        .aifc-fuel-pin{transform:translateY(-4px);cursor:pointer;background:var(--c);color:#fff;font:700 12px/1 system-ui;padding:5px 8px;border-radius:9px;box-shadow:0 2px 6px rgba(0,0,0,.4);white-space:nowrap;border:2px solid rgba(255,255,255,.85)}
        .aifc-fuel-pin.sel{outline:3px solid #fff;transform:translateY(-4px) scale(1.12);z-index:5}
        .aifc-poi-pin{display:grid;place-items:center;width:22px;height:22px;cursor:pointer;background:var(--c);color:#0f1526;font:800 12px/1 system-ui;border-radius:9999px;box-shadow:0 2px 5px rgba(0,0,0,.4);border:2px solid #fff}
        .aifc-poi-pin.sel{outline:3px solid #fff;transform:scale(1.15);z-index:5}
      `}</style>
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
