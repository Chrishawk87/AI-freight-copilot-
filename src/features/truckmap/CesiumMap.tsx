"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { LatLon } from "@/lib/geolocation";
import { loadCesium, createTruckViewer } from "@/lib/truckmap/cesium";
import {
  TRUCK_CATEGORY_META,
  type TruckMapPoi,
  type TruckPoiCategory,
} from "@/lib/truckmap/types";

// ---------------------------------------------------------------------------
// CesiumJS 3D truck map. The viewer is built once and every subsequent update
// (driver position, chase camera, POI markers, selection) is applied
// imperatively through refs — so the globe never tears down mid-drive, matching
// the "build once, mutate" pattern the MapLibre LiveMap uses.
// ---------------------------------------------------------------------------

type CesiumMapProps = {
  driver: LatLon | null;
  pois: TruckMapPoi[];
  visible: Record<TruckPoiCategory, boolean>;
  selectedId?: string | null;
  onSelectPoi?: (id: string | null) => void;
  follow?: boolean;
  // Active route polyline as [lon, lat] pairs (empty/undefined = no route).
  route?: [number, number][] | null;
  // Destination pin (end of the active route).
  destination?: LatLon | null;
};

const DRIVER_ID = "__driver__";
const DEST_ID = "__dest__";

export function CesiumMap({
  driver,
  pois,
  visible,
  selectedId,
  onSelectPoi,
  follow = true,
  route,
  destination,
}: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cesiumRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const driverEntityRef = useRef<any>(null);
  const destEntityRef = useRef<any>(null);
  const routeEntityRef = useRef<any>(null);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const lastRouteSigRef = useRef<string>("");
  const poiEntitiesRef = useRef<Map<string, any>>(new Map());
  const lastPoiSigRef = useRef<string>("");
  const lastCenterRef = useRef<LatLon | null>(null);
  const onSelectRef = useRef(onSelectPoi);
  onSelectRef.current = onSelectPoi;

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  // ---- build the viewer once ----
  useEffect(() => {
    let cancelled = false;
    let handler: any = null;

    (async () => {
      try {
        const Cesium = await loadCesium();
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;
        const viewer = await createTruckViewer(containerRef.current, Cesium);
        if (cancelled) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;

        // Neutral opening view over the lower-48 until we have a fix.
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(-98.5795, 34, 5_000_000),
        });

        // Tap a marker → select it; tap empty space → clear selection.
        handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((movement: any) => {
          const picked = viewer.scene.pick(movement.position);
          const id = picked?.id?.poiId as string | undefined;
          onSelectRef.current?.(id ?? null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        handler?.destroy();
        viewerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      viewerRef.current = null;
      poiEntitiesRef.current.clear();
    };
  }, []);

  // ---- driver marker + chase camera ----
  useEffect(() => {
    if (status !== "ready") return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !driver) return;

    const pos = Cesium.Cartesian3.fromDegrees(driver.lon, driver.lat);
    if (!driverEntityRef.current) {
      driverEntityRef.current = viewer.entities.add({
        id: DRIVER_ID,
        position: pos,
        point: {
          pixelSize: 16,
          color: Cesium.Color.fromCssColorString("#246BFD"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    } else {
      driverEntityRef.current.position = pos;
    }

    if (follow) {
      const last = lastCenterRef.current;
      const moved =
        !last ||
        Math.abs(last.lat - driver.lat) > 0.0008 ||
        Math.abs(last.lon - driver.lon) > 0.0008;
      if (moved) {
        lastCenterRef.current = { ...driver };
        // Tilted chase view: camera sits south of and above the driver so the
        // truck reads as "ahead" on the road.
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            driver.lon,
            driver.lat - 0.03,
            4000,
          ),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
          },
        });
      }
    }
  }, [driver, follow, status]);

  // ---- route polyline + destination pin ----
  useEffect(() => {
    if (status !== "ready") return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;

    const coords = route ?? [];
    const sig = `${coords.length}:${coords[0]?.join(",") ?? ""}>${
      coords[coords.length - 1]?.join(",") ?? ""
    }`;
    if (sig === lastRouteSigRef.current) return;
    lastRouteSigRef.current = sig;
    routeCoordsRef.current = coords;

    // Route line — a single entity we keep and mutate so it never flickers.
    if (coords.length >= 2) {
      const positions = Cesium.Cartesian3.fromDegreesArray(
        coords.flatMap(([lon, lat]) => [lon, lat]),
      );
      if (!routeEntityRef.current) {
        routeEntityRef.current = viewer.entities.add({
          polyline: {
            positions,
            width: 7,
            clampToGround: true,
            material: new Cesium.PolylineOutlineMaterialProperty({
              color: Cesium.Color.fromCssColorString("#246BFD"),
              outlineColor: Cesium.Color.fromCssColorString("#0B1220"),
              outlineWidth: 2,
            }),
          },
        });
      } else {
        routeEntityRef.current.polyline.positions = positions;
        routeEntityRef.current.show = true;
      }
    } else if (routeEntityRef.current) {
      routeEntityRef.current.show = false;
    }

    // Destination pin.
    if (destination) {
      const pos = Cesium.Cartesian3.fromDegrees(destination.lon, destination.lat);
      if (!destEntityRef.current) {
        destEntityRef.current = viewer.entities.add({
          id: DEST_ID,
          position: pos,
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString("#EF4444"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        destEntityRef.current.position = pos;
        destEntityRef.current.show = true;
      }
    } else if (destEntityRef.current) {
      destEntityRef.current.show = false;
    }
  }, [route, destination, status]);

  // ---- POI markers (rebuilt only when the set or visibility changes) ----
  useEffect(() => {
    if (status !== "ready") return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer) return;

    const shown = pois.filter((p) => visible[p.category]);
    const sig =
      shown
        .map((p) => p.id)
        .sort()
        .join("|") +
      "::" +
      (Object.keys(visible) as TruckPoiCategory[])
        .filter((k) => visible[k])
        .sort()
        .join(",");
    if (sig === lastPoiSigRef.current) return;
    lastPoiSigRef.current = sig;

    // Clear the previous marker set, then add the current one.
    for (const ent of poiEntitiesRef.current.values()) {
      try {
        viewer.entities.remove(ent);
      } catch {
        /* ignore */
      }
    }
    poiEntitiesRef.current.clear();

    for (const p of shown) {
      const meta = TRUCK_CATEGORY_META[p.category];
      const label =
        p.category === "fuel" && p.price != null
          ? `$${p.price.toFixed(2)}`
          : meta.glyph;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(meta.color),
          outlineColor: Cesium.Color.fromCssColorString("#0B1220"),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: label,
          font: "600 12px sans-serif",
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString(meta.color).withAlpha(
            0.9,
          ),
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: 0.85,
        },
      });
      ent.poiId = p.id;
      poiEntitiesRef.current.set(p.id, ent);
    }
  }, [pois, visible, status]);

  // ---- selection highlight ----
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!Cesium) return;
    for (const [id, ent] of poiEntitiesRef.current.entries()) {
      const selected = id === selectedId;
      if (ent.point) ent.point.pixelSize = selected ? 20 : 12;
      if (ent.label) ent.label.scale = selected ? 1.05 : 0.85;
    }
  }, [selectedId, pois]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[#0B1220]">
      <div ref={containerRef} className="h-full w-full" />
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0B1220]/80 text-slate-300">
          {status === "loading" ? (
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading 3D map…
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
