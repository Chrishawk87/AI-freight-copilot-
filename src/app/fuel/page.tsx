"use client";

import { useState } from "react";
import { Fuel, MapPin, TrendingDown } from "lucide-react";
import { PageHeader, Stat, money, Loading, ErrorState } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import clsx from "clsx";

export default function FuelPage() {
  const [gallons, setGallons] = useState(150);
  const { data, loading, error } = useApi(() => api.fuel(), []);

  return (
    <div>
      <PageHeader title="Fuel Intelligence" subtitle="Live diesel across your connected fuel networks." />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        (() => {
          const stations = data!.stations;
          const nationalAvg = data!.nationalAvg;
          const sorted = [...stations].sort((a, b) => a.price - b.price);
          const onRouteSorted = sorted.filter((f) => f.onRoute);
          const cheapestOnRoute = onRouteSorted[0] ?? sorted[0];
          const cheapestNearby = [...stations].sort((a, b) => a.distanceMi - b.distanceMi)[0];
          const savingsVsAvg = cheapestOnRoute
            ? Math.max(0, (nationalAvg - cheapestOnRoute.price) * gallons)
            : 0;

          if (!cheapestOnRoute) return <div className="text-sm text-white/40">No fuel data available.</div>;

          return (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label="Cheapest On-Route"
                  value={`$${cheapestOnRoute.price.toFixed(2)}`}
                  sub={`${cheapestOnRoute.name} · ${cheapestOnRoute.city}`}
                  accent="#16C784"
                />
                <Stat
                  label="Cheapest Nearby"
                  value={`$${cheapestNearby.price.toFixed(2)}`}
                  sub={`${cheapestNearby.distanceMi} mi · ${cheapestNearby.name}`}
                />
                <Stat
                  label="Vs. National Avg"
                  value={`-$${(nationalAvg - cheapestOnRoute.price).toFixed(2)}`}
                  sub="per gallon"
                  accent="#16C784"
                />
                <Stat label="Est. Fill Savings" value={money(savingsVsAvg)} sub={`on ${gallons} gal`} accent="#16C784" />
              </div>

              <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                <div className="card p-2">
                  {sorted.map((f, i) => (
                    <div
                      key={f.id}
                      className={clsx(
                        "flex items-center justify-between rounded-xl p-4",
                        i === 0 && "bg-success/10 ring-1 ring-success/30"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5">
                          <Fuel className="h-5 w-5 text-electric" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            {f.name}
                            {f.onRoute && <span className="chip bg-electric/15 text-electric">On route</span>}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-white/50">
                            <MapPin className="h-3 w-3" />
                            {f.city}, {f.state} · {f.distanceMi} mi · {f.network}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold" style={i === 0 ? { color: "#16C784" } : {}}>
                          ${f.price.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-white/40">/ gal</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="card h-fit p-5">
                  <div className="mb-3 flex items-center gap-2 font-semibold">
                    <TrendingDown className="h-4 w-4 text-success" /> Savings Calculator
                  </div>
                  <label className="text-xs text-white/50">Gallons to fill</label>
                  <input
                    type="range"
                    min={50}
                    max={250}
                    step={10}
                    value={gallons}
                    onChange={(e) => setGallons(Number(e.target.value))}
                    className="mt-2 w-full accent-electric"
                  />
                  <div className="mb-4 text-center text-2xl font-extrabold">{gallons} gal</div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/50">At national avg</span>
                      <span>{money(nationalAvg * gallons)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/50">At best on-route</span>
                      <span>{money(cheapestOnRoute.price * gallons)}</span>
                    </div>
                    <div className="border-t border-white/10 pt-2" />
                    <div className="flex justify-between font-bold">
                      <span>You save</span>
                      <span className="text-success">{money(savingsVsAvg)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
