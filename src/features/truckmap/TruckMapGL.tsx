"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LatLon } from "@/lib/geolocation";
import { US_CENTER } from "@/lib/geolocation";
import {
  TRUCK_CATEGORY_META,
  type TruckMapPoi,
  type TruckPoiCategory,
} from "@/lib/truckmap/types";

// ---------------------------------------------------------------------------
// TruckMapGL — MapLibre GL replacement for the old CesiumMap. Same prop
// interface, so it drops straight into /map with no other changes. Uses free
// OpenFreeMap vector tiles (no API key). Turn-by-turn is NOT computed here: the
// route polyline + maneuver data come pre-built from the backend (api.route),
// and this component simply renders the passed-in coords. That keeps the
// navigation banner/ETA on the page fully engine-independent.
//
// A 3D "chase camera" (pitch + bearing that follows the driver's heading) gives
// the same Google-Maps-style navigation view Cesium provided, but far lighter:
// no globe, no WASM, no 3D truck model to load.
// ---------------------------------------------------------------------------

type TruckMapGLProps = {
  driver: LatLon | null;
  // Driver heading in degrees clockwise from north (orients the chase camera).
  heading?: number | null;
  pois: TruckMapPoi[];
  visible: Record<TruckPoiCategory, boolean>;
  selectedId?: string | null;
  onSelectPoi?: (id: string | null) => void;
  follow?: boolean;
  // Active route polyline as [lon, lat] pairs (empty/undefined = no route).
  route?: [number, number][] | null;
  // Destination pin (end of the active route).
  destination?: LatLon | null;
  // Origin/start pin (beginning of the active route).
  origin?: LatLon | null;
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
    const existing = document.querySelector(
      `script[src="${src}"]`,
    ) as HTMLScriptElement | null;
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

function emptyFC() {
  return { type: "FeatureCollection" as const, features: [] as any[] };
}

// Signature strings so marker/route effects only rebuild when the data changes.
function routeSig(route?: [number, number][] | null): string {
  const c = route ?? [];
  return `${c.length}:${c[0]?.join(",") ?? ""}>${c[c.length - 1]?.join(",") ?? ""}`;
}
function poiSig(pois: TruckMapPoi[], visible: Record<TruckPoiCategory, boolean>): string {
  const shown = pois.filter((p) => visible[p.category]);
  return (
    shown.map((p) => p.id).sort().join("|") +
    "::" +
    (Object.keys(visible) as TruckPoiCategory[])
      .filter((k) => visible[k])
      .sort()
      .join(",")
  );
}

export function TruckMapGL({
  driver,
  heading,
  pois,
  visible,
  selectedId,
  onSelectPoi,
  follow = true,
  route,
  destination,
  origin,
}: TruckMapGLProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const driverMarkerRef = useRef<any>(null);
  const originMarkerRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const poiMarkersRef = useRef<Record<string, any>>({});
  const centeredRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [ready, setReady] = useState(false);

  // Keep the latest select callback reachable from marker click handlers
  // without forcing marker rebuilds.
  const onSelectRef = useRef(onSelectPoi);
  onSelectRef.current = onSelectPoi;

  // ---- Build the map once ----
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        loadCss(
          "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css",
        );
        await loadScript(
          "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js",
        );
        const maplibregl = (window as any).maplibregl;
        if (cancelled || !ref.current || !maplibregl)
          throw new Error("maplibre unavailable");

        const c = driver ?? US_CENTER;
        const map = new maplibregl.Map({
          container: ref.current,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [c.lon, c.lat],
          zoom: driver ? 12 : 3.6,
          attributionControl: true,
        });
        mapRef.current = map;

        // Tap empty map → clear the POI selection (marker clicks stop
        // propagation, so this only fires on the bare map).
        map.on("click", () => onSelectRef.current?.(null));

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
      // Google-Maps navigation view: tilt the camera and swing the bearing to
      // the driver's heading so the road ahead is "up".
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

  // ---- Route line + origin/destination markers ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!ready || !map || !maplibregl) return;

    const coords = route ?? [];
    map.getSource("route")?.setData(
      coords.length >= 2
        ? {
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: {},
          }
        : emptyFC(),
    );

    // Destination pin (red).
    if (destination) {
      if (!destMarkerRef.current) {
        destMarkerRef.current = new maplibregl.Marker({ color: "#EF4444" })
          .setLngLat([destination.lon, destination.lat])
          .addTo(map);
      } else {
        destMarkerRef.current.setLngLat([destination.lon, destination.lat]);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }

    // Origin / start pin (green).
    if (origin) {
      if (!originMarkerRef.current) {
        originMarkerRef.current = new maplibregl.Marker({ color: "#22C55E" })
          .setLngLat([origin.lon, origin.lat])
          .addTo(map);
      } else {
        originMarkerRef.current.setLngLat([origin.lon, origin.lat]);
      }
    } else if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }

    // When not actively following the driver, frame the whole route so the
    // trip is visible end-to-end (matches how Google previews a new route).
    if (!follow && coords.length >= 2) {
      const b = coords.reduce(
        (bb: any, cc: any) => bb.extend(cc),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      map.fitBounds(b, { padding: 60, duration: 700 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routeSig(route), destination?.lat, destination?.lon, origin?.lat, origin?.lon]);

  // ---- POI markers (rebuilt only when the visible set changes) ----
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = (window as any).maplibregl;
    if (!ready || !map || !maplibregl) return;

    Object.values(poiMarkersRef.current).forEach((m: any) => m.remove());
    poiMarkersRef.current = {};

    for (const p of pois.filter((x) => visible[x.category])) {
      const meta = TRUCK_CATEGORY_META[p.category];
      const el = document.createElement("div");
      el.className = "aifc-truck-poi" + (selectedId === p.id ? " sel" : "");
      el.style.setProperty("--c", meta.color);
      el.textContent =
        p.category === "fuel" && p.price != null
          ? `$${p.price.toFixed(2)}`
          : meta.glyph;
      el.title = `${meta.label}: ${p.name}`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectRef.current?.(p.id);
      });
      poiMarkersRef.current[p.id] = new maplibregl.Marker({
        element: el,
        anchor: "bottom",
      })
        .setLngLat([p.lon, p.lat])
        .addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, poiSig(pois, visible)]);

  // ---- Selection highlight + pan to the selected pin ----
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const [id, marker] of Object.entries(poiMarkersRef.current)) {
      const el = (marker as any).getElement?.() as HTMLElement | undefined;
      if (el) el.classList.toggle("sel", id === selectedId);
    }
    if (selectedId) {
      const p = pois.find((x) => x.id === selectedId);
      if (p)
        map.easeTo({
          center: [p.lon, p.lat],
          zoom: Math.max(map.getZoom(), 13),
          duration: 500,
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[#0B1220]">
      <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />
      <style>{`
        .aifc-driver-dot{width:16px;height:16px;border-radius:9999px;background:#246BFD;border:3px solid #fff;box-shadow:0 0 0 6px rgba(36,107,253,.25)}
        .aifc-truck-poi{display:grid;place-items:center;min-width:22px;height:22px;padding:0 6px;cursor:pointer;background:var(--c);color:#0B1220;font:800 12px/1 system-ui;border-radius:9999px;box-shadow:0 2px 5px rgba(0,0,0,.4);border:2px solid #fff;white-space:nowrap;transform:translateY(-2px)}
        .aifc-truck-poi.sel{outline:3px solid #fff;transform:translateY(-2px) scale(1.15);z-index:5}
      `}</style>
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0B1220]/80 text-slate-300">
          {status === "loading" ? (
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
            </span>
          ) : (
            <span className="px-6 text-center text-sm text-slate-400">
              Map failed to load. Check your connection and try again.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
