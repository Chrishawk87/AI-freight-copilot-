"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, LocateFixed } from "lucide-react";
import { api } from "@/lib/api";
import { useGeolocation } from "@/lib/geolocation";
import { CesiumMap } from "@/features/truckmap/CesiumMap";
import { LayerControl } from "@/features/truckmap/LayerControl";
import { PoiDetailCard } from "@/features/truckmap/PoiDetailCard";
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

export default function MapPage() {
  const router = useRouter();
  const { pos, status: geoStatus, request } = useGeolocation();

  const [pois, setPois] = useState<TruckMapPoi[]>([]);
  const [visible, setVisible] = useState<Record<TruckPoiCategory, boolean>>(ALL_ON);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  // Refetch when the fix moves enough to matter (~7 mi grid) so the map stays
  // live as the driver travels without hammering the API.
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

  const navigateTo = useCallback(
    (poi: TruckMapPoi) => {
      const dest =
        poi.address ||
        [poi.city, poi.state].filter(Boolean).join(", ") ||
        `${poi.lat},${poi.lon}`;
      router.push(`/navigation?to=${encodeURIComponent(dest)}&start=1`);
    },
    [router],
  );

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
      {/* Top bar: title + GPS + follow toggle */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Truck Map</h1>
          <p className="text-xs text-white/50">
            Fuel, parking, rest areas, scales &amp; more near you.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        />

        {/* Selected POI detail slides up over the map */}
        {selected && (
          <div className="absolute inset-x-3 bottom-3 z-10 mx-auto max-w-md">
            <PoiDetailCard
              poi={selected}
              onClose={() => setSelectedId(null)}
              onNavigate={navigateTo}
            />
          </div>
        )}
      </div>
    </div>
  );
}
