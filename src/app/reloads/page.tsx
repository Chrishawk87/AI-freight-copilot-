"use client";

import { useState } from "react";
import { Repeat, MapPin } from "lucide-react";
import { PageHeader, Stat, Loading, ErrorState } from "@/components/ui";
import LoadCard from "@/components/LoadCard";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import clsx from "clsx";

const RADII = [25, 50, 100, 150, 200];

export default function ReloadsPage() {
  const [radius, setRadius] = useState(100);
  const { data, loading, error, reload } = useApi(() => api.reloads(200), []);

  const all = data ?? [];
  const ranked = [...all]
    .filter((l) => l.deadheadMiles <= radius)
    .sort((a, b) => b.overall - a.overall);
  const avoided = ranked.reduce((s, l) => s + l.deadheadMiles, 0);

  return (
    <div>
      <PageHeader
        title="Deadhead Prevention"
        subtitle="Delivery complete — find your next paying load before you roll empty."
        action={
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-navy-800/70 px-3 py-2 text-sm">
            <MapPin className="h-4 w-4 text-electric" /> Reload pool
          </div>
        }
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="text-sm text-white/40">Search radius</span>
            {RADII.map((r) => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  radius === r ? "bg-electric text-white shadow-glow" : "text-white/60 hover:bg-white/5"
                )}
              >
                {r} mi
              </button>
            ))}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Reloads Found" value={`${ranked.length}`} sub={`within ${radius} mi`} />
            <Stat
              label="Best Reload Score"
              value={ranked[0] ? `${ranked[0].overall}` : "—"}
              sub={ranked[0] ? `${ranked[0].destCity}, ${ranked[0].destState}` : ""}
              accent="#16C784"
            />
            <Stat
              label="Avg Rate/Mile"
              value={ranked.length ? `$${(ranked.reduce((s, l) => s + l.allInRpm, 0) / ranked.length).toFixed(2)}` : "—"}
            />
            <Stat label="Deadhead to Pickup" value={`${avoided} mi`} sub="total across options" accent="#F59E0B" />
          </div>

          {ranked.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 p-10 text-center text-white/50">
              <Repeat className="h-8 w-8 text-white/30" />
              No reloads within {radius} mi. Widen the radius to see more options.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {ranked.map((l) => (
                <LoadCard key={l.id} load={l} onBooked={reload} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
