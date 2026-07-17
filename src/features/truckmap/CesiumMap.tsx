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
  // Driver heading in degrees clockwise from north (orients the 3D truck).
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

const DRIVER_ID = "__driver__";
const DEST_ID = "__dest__";
const ORIGIN_ID = "__origin__";

export function CesiumMap({
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
}: CesiumMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cesiumRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const truckRef = useRef<any>(null);
  const truckPosRef = useRef<any>(null); // CallbackProperty-backed position
  const truckHprRef = useRef<any>(null); // CallbackProperty-backed orientation
  const truckStateRef = useRef<{
    lon: number;
    lat: number;
    heading: number;
  } | null>(null);
  const destEntityRef = useRef<any>(null);
  const originEntityRef = useRef<any>(null);
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

  // ---- 3D truck (cab + trailer) + chase camera ----
  useEffect(() => {
    if (status !== "ready") return;
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !driver) return;

    const hdgDeg = heading ?? truckStateRef.current?.heading ?? 0;

    // First build: create a single entity whose model is a small group of
    // boxes (cab + trailer + wheels), positioned/oriented by CallbackPropertys
    // so we can mutate the underlying state every frame without re-adding
    // entities (no flicker, smooth motion).
    if (!truckRef.current) {
      truckStateRef.current = { lon: driver.lon, lat: driver.lat, heading: hdgDeg };

      truckPosRef.current = new Cesium.CallbackProperty(() => {
        const s = truckStateRef.current!;
        return Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0);
      }, false);

      truckHprRef.current = new Cesium.CallbackProperty(() => {
        const s = truckStateRef.current!;
        // Cesium heading is clockwise from north for the model's -Y axis; our
        // boxes point +X "forward", so offset by -90° to align.
        const hpr = new Cesium.HeadingPitchRoll(
          Cesium.Math.toRadians(s.heading - 90),
          0,
          0,
        );
        const origin = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 0);
        return Cesium.Transforms.headingPitchRollQuaternion(origin, hpr);
      }, false);

      const truck = viewer.entities.add({
        id: DRIVER_ID,
        position: truckPosRef.current,
        orientation: truckHprRef.current,
      });

      // Trailer (long box behind the cab).
      truck.addProperty?.("kind");
      viewer.entities.add({
        position: truckPosRef.current,
        orientation: truckHprRef.current,
        box: {
          dimensions: new Cesium.Cartesian3(11, 2.6, 3.4),
          material: Cesium.Color.fromCssColorString("#E5E9F0"),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#0B1220"),
        },
      });
      // Cab (shorter, taller box at the front / +X).
      viewer.entities.add({
        position: new Cesium.CallbackProperty(() => {
          const s = truckStateRef.current!;
          // Offset forward along heading so the cab sits ahead of the trailer.
          const fwd = Cesium.Math.toRadians(s.heading);
          const dLat = (Math.cos(fwd) * 8) / 111_320;
          const dLon =
            (Math.sin(fwd) * 8) /
            (111_320 * Math.cos(Cesium.Math.toRadians(s.lat)));
          return Cesium.Cartesian3.fromDegrees(s.lon + dLon, s.lat + dLat, 0);
        }, false),
        orientation: truckHprRef.current,
        box: {
          dimensions: new Cesium.Cartesian3(4, 2.6, 3.6),
          material: Cesium.Color.fromCssColorString("#246BFD"),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString("#0B1220"),
        },
      });
      truckRef.current = truck;
    } else {
      // Smoothly ease the truck state toward the new fix so motion doesn't jump.
      const s = truckStateRef.current!;
      s.lon = driver.lon;
      s.lat = driver.lat;
      // Interpolate heading along the shortest arc.
      let dh = ((hdgDeg - s.heading + 540) % 360) - 180;
      s.heading = (s.heading + dh + 360) % 360;
    }

    if (follow) {
      const last = lastCenterRef.current;
      const moved =
        !last ||
        Math.abs(last.lat - driver.lat) > 0.0005 ||
        Math.abs(last.lon - driver.lon) > 0.0005;
      if (moved) {
        lastCenterRef.current = { ...driver };
        // Chase camera: sit behind the truck (opposite its heading) and above,
        // looking forward down the road — Google-Maps-style navigation view.
        const back = Cesium.Math.toRadians(hdgDeg + 180);
        const dist = 0.006; // ~650m behind
        const dLat = Math.cos(back) * dist;
        const dLon =
          (Math.sin(back) * dist) / Math.cos(Cesium.Math.toRadians(driver.lat));
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            driver.lon + dLon,
            driver.lat + dLat,
            700,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(hdgDeg),
            pitch: Cesium.Math.toRadians(-30),
            roll: 0,
          },
        });
      }
    }
  }, [driver, heading, follow, status]);

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

    // Origin / start pin (green).
    if (origin) {
      const pos = Cesium.Cartesian3.fromDegrees(origin.lon, origin.lat);
      if (!originEntityRef.current) {
        originEntityRef.current = viewer.entities.add({
          id: ORIGIN_ID,
          position: pos,
          point: {
            pixelSize: 14,
            color: Cesium.Color.fromCssColorString("#22C55E"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        originEntityRef.current.position = pos;
        originEntityRef.current.show = true;
      }
    } else if (originEntityRef.current) {
      originEntityRef.current.show = false;
    }
  }, [route, destination, origin, status]);

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
