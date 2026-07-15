"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { PageHeader, ScoreBar, ScoreRing, RecBadge, money, scoreColor, Loading, ErrorState } from "@/components/ui";
import { DIESEL_PRICE } from "@/lib/scoring";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import clsx from "clsx";

export default function ProfitPage() {
  const { data, loading, error } = useApi(() => api.loads(), []);
  const [id, setId] = useState<string | null>(null);

  const sorted = [...(data ?? [])].sort((a, b) => b.overall - a.overall);

  useEffect(() => {
    if (!id && sorted.length) setId(sorted[0].id);
  }, [id, sorted]);

  const recExplain: Record<string, string> = {
    Accept: "Strong margin and clean lane. This load clears your cost floor with room to spare.",
    Consider: "Workable, but margins are thin or deadhead/market factors drag it down. Negotiate the rate up first.",
    Avoid: "This load does not clear your true operating cost. Walk away or counter aggressively.",
  };

  return (
    <div>
      <PageHeader
        title="Profitability Engine"
        subtitle="True-cost scoring on every load — before you book it."
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        (() => {
          const load = sorted.find((l) => l.id === id) ?? sorted[0];
          if (!load) return <div className="text-sm text-white/40">No loads available.</div>;
          return (
            <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <div className="space-y-2">
                {sorted.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setId(l.id)}
                    className={clsx(
                      "w-full rounded-xl border p-3 text-left transition",
                      l.id === load.id
                        ? "border-electric/50 bg-electric/10"
                        : "border-white/5 bg-navy-800/60 hover:bg-white/5"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/40">{l.equipment}</span>
                      <span className="text-sm font-bold" style={{ color: scoreColor(l.overall) }}>
                        {l.overall}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                      {l.originState} <ArrowRight className="h-3 w-3 text-white/30" /> {l.destState}
                      <span className="ml-auto text-white/50">{money(l.rate)}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs text-white/40">
                      {load.externalId ?? load.id} · {load.source}
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {load.originCity}, {load.originState} → {load.destCity}, {load.destState}
                    </div>
                    <div className="mt-1 text-sm text-white/50">
                      {load.equipment} · {load.miles.toLocaleString()} mi + {load.deadheadMiles} deadhead
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <ScoreRing value={load.overall} size={80} />
                    <RecBadge rec={load.recommendation} />
                  </div>
                </div>

                <p className="mt-4 rounded-xl bg-white/5 p-3 text-sm text-white/70">
                  {recExplain[load.recommendation]}
                </p>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <ScoreBar label="Profit Score" value={load.scores.profit} />
                  <ScoreBar label="Deadhead Score" value={load.scores.deadhead} />
                  <ScoreBar label="Reload Score" value={load.scores.reload} />
                  <ScoreBar label="Market Demand Score" value={load.scores.market} />
                  <ScoreBar label="Fuel Impact Score" value={load.scores.fuel} />
                </div>

                <div className="mt-6 rounded-xl border border-white/5 p-4">
                  <div className="mb-3 text-sm font-semibold text-white/70">True-cost breakdown</div>
                  <Row label="Line-haul revenue" value={money(load.rate)} />
                  <Row
                    label={`Fuel (${(load.miles + load.deadheadMiles).toLocaleString()} mi @ $${DIESEL_PRICE}/gal)`}
                    value={`- ${money(load.fuelCost)}`}
                    muted
                  />
                  <Row label="Fixed + operating cost" value={`- ${money(load.fixedCost)}`} muted />
                  <div className="my-2 border-t border-white/10" />
                  <Row
                    label="Net profit"
                    value={money(load.netProfit)}
                    accent={load.netProfit >= 0 ? "#16C784" : "#EF4444"}
                    bold
                  />
                  <Row label="Profit per loaded mile" value={`$${(load.netProfit / load.miles).toFixed(2)}`} muted />
                </div>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

function Row({
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
      <span className={clsx(bold ? "text-base font-bold" : "font-medium")} style={accent ? { color: accent } : {}}>
        {value}
      </span>
    </div>
  );
}
