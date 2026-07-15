"use client";

import { useMemo, useState } from "react";
import { PageHeader, Loading, ErrorState } from "@/components/ui";
import LoadCard from "@/components/LoadCard";
import { EQUIPMENT_LIST } from "@/lib/data";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Equipment } from "@/lib/types";
import clsx from "clsx";

type Sort = "overall" | "profit" | "rpm" | "deadhead";

export default function LoadsPage() {
  const [eq, setEq] = useState<Equipment | "All">("All");
  const [sort, setSort] = useState<Sort>("overall");
  const { data, loading, error, reload } = useApi(() => api.loads(), []);

  const loads = data ?? [];

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    loads.forEach((l) => (m[l.equipment] = (m[l.equipment] ?? 0) + 1));
    return m;
  }, [loads]);

  const filtered = useMemo(() => {
    let list = loads.filter((l) => eq === "All" || l.equipment === eq);
    list = [...list].sort((a, b) => {
      if (sort === "overall") return b.overall - a.overall;
      if (sort === "profit") return b.netProfit - a.netProfit;
      if (sort === "rpm") return b.allInRpm - a.allInRpm;
      return b.scores.deadhead - a.scores.deadhead;
    });
    return list;
  }, [loads, eq, sort]);

  return (
    <div>
      <PageHeader
        title="Unified Opportunity Center"
        subtitle="Every connected load board, one ranked feed."
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Chip active={eq === "All"} onClick={() => setEq("All")} label={`All (${loads.length})`} />
            {EQUIPMENT_LIST.filter((e) => counts[e]).map((e) => (
              <Chip key={e} active={eq === e} onClick={() => setEq(e)} label={`${e} (${counts[e]})`} />
            ))}
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/40">Sort by</span>
            {(
              [
                ["overall", "Best Overall"],
                ["profit", "Net Profit"],
                ["rpm", "Rate / Mile"],
                ["deadhead", "Least Deadhead"],
              ] as [Sort, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  sort === k ? "bg-electric text-white" : "text-white/60 hover:bg-white/5"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((l) => (
              <LoadCard key={l.id} load={l} onBooked={reload} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-full px-3 py-1.5 text-xs font-medium transition",
        active ? "bg-electric text-white shadow-glow" : "border border-white/10 text-white/60 hover:bg-white/5"
      )}
    >
      {label}
    </button>
  );
}
