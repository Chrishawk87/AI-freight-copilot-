"use client";

import { Navigation, Truck, Clock, Fuel, MapPin, X } from "lucide-react";
import { TRUCK_CATEGORY_META, type TruckMapPoi } from "@/lib/truckmap/types";

// Slide-up detail card for the selected POI. Big primary "Navigate" action.

type PoiDetailCardProps = {
  poi: TruckMapPoi | null;
  onClose: () => void;
  onNavigate?: (poi: TruckMapPoi) => void;
};

export function PoiDetailCard({ poi, onClose, onNavigate }: PoiDetailCardProps) {
  if (!poi) return null;
  const meta = TRUCK_CATEGORY_META[poi.category];
  const place = [poi.city, poi.state].filter(Boolean).join(", ");

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-[#0B1220]"
            style={{ backgroundColor: meta.color }}
          >
            {meta.glyph}
          </span>
          <div>
            <h3 className="text-base font-semibold text-white">{poi.name}</h3>
            <p className="text-xs text-slate-400">
              {meta.label}
              {place ? ` · ${place}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-slate-400 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-slate-500" />
          {poi.distanceMi} mi
        </span>
        {poi.category === "fuel" && poi.price != null && (
          <span className="flex items-center gap-1.5">
            <Fuel className="h-4 w-4 text-slate-500" />${poi.price.toFixed(2)}/gal
          </span>
        )}
        {poi.hgv && (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <Truck className="h-4 w-4" />
            Truck-friendly
          </span>
        )}
        {poi.parkingSpaces != null && (
          <span className="flex items-center gap-1.5">
            <Truck className="h-4 w-4 text-slate-500" />
            {poi.parkingSpaces} spaces
          </span>
        )}
        {poi.hours && (
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-slate-500" />
            {poi.hours}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => onNavigate?.(poi)}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#246BFD] text-base font-semibold text-white transition hover:bg-[#1d59d6]"
      >
        <Navigation className="h-5 w-5" />
        Navigate
      </button>
    </div>
  );
}
