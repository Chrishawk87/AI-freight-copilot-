"use client";

import {
  TRUCK_CATEGORY_META,
  TRUCK_CATEGORY_ORDER,
  type TruckPoiCategory,
} from "@/lib/truckmap/types";

// Toggle which POI layers are drawn on the map. Big touch targets, dark theme.

type LayerControlProps = {
  visible: Record<TruckPoiCategory, boolean>;
  counts?: Partial<Record<TruckPoiCategory, number>>;
  onToggle: (category: TruckPoiCategory) => void;
};

export function LayerControl({ visible, counts, onToggle }: LayerControlProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TRUCK_CATEGORY_ORDER.map((cat) => {
        const meta = TRUCK_CATEGORY_META[cat];
        const on = visible[cat];
        const count = counts?.[cat];
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onToggle(cat)}
            aria-pressed={on}
            className={`flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
              on
                ? "border-transparent text-white"
                : "border-slate-700 bg-slate-900/60 text-slate-400"
            }`}
            style={on ? { backgroundColor: meta.color } : undefined}
          >
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
              style={{
                backgroundColor: on ? "rgba(255,255,255,0.25)" : meta.color,
                color: on ? "#fff" : "#0B1220",
              }}
            >
              {meta.glyph}
            </span>
            <span>{meta.label}</span>
            {count != null && (
              <span className={on ? "text-white/80" : "text-slate-500"}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
