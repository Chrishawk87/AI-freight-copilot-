"use client";

// In-map Fuel Intelligence view. Shows confidence-blended cheapest diesel
// either near the driver or along the active route, lets a driver crowd-report
// a price, navigate to a station, and build a route fuel-fill plan that says
// where to buy and how much to minimize spend.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Fuel,
  Gauge,
  Loader2,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Send,
  TrendingDown,
} from "lucide-react";
import {
  api,
  type FuelPlan,
  type PricedStation,
  type TruckMapPoi,
} from "@/lib/api";
import type { LatLon } from "@/lib/geolocation";

type Mode = "nearby" | "route";

export function FuelPanel({
  driver,
  routeCoords,
  onNavigate,
}: {
  driver: LatLon | null;
  routeCoords: [number, number][] | null;
  onNavigate: (poi: TruckMapPoi) => void;
}) {
  const hasRoute = !!routeCoords && routeCoords.length >= 2;
  const [mode, setMode] = useState<Mode>(hasRoute ? "route" : "nearby");
  const [hgvOnly, setHgvOnly] = useState(true);
  const [stations, setStations] = useState<PricedStation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Snap the mode to what's available (a route appearing/clearing).
  useEffect(() => {
    if (!hasRoute && mode === "route") setMode("nearby");
  }, [hasRoute, mode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "route" && hasRoute) {
        const res = await api.fuelAlongRoute(routeCoords!, { hgvOnly, limit: 40 });
        setStations(res.stations);
      } else if (driver) {
        const res = await api.fuelNearby(driver.lat, driver.lon, {
          radiusMi: 50,
          hgvOnly,
          limit: 30,
        });
        setStations(res.stations);
      } else {
        setStations([]);
        setError("Waiting for GPS — tap the GPS button on the map.");
      }
    } catch (e: any) {
      setStations([]);
      setError(e?.message || "Couldn't load fuel prices.");
    } finally {
      setLoading(false);
    }
  }, [mode, hasRoute, routeCoords, driver, hgvOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const cheapest = stations[0]?.priceEff ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Mode + filter controls */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-xl bg-white/5 p-0.5">
          <button
            onClick={() => setMode("nearby")}
            className={`chip flex items-center gap-1.5 ${
              mode === "nearby" ? "bg-electric text-[#0B1220]" : "text-white/60"
            }`}
          >
            <MapPin className="h-3.5 w-3.5" /> Near me
          </button>
          <button
            onClick={() => hasRoute && setMode("route")}
            disabled={!hasRoute}
            className={`chip flex items-center gap-1.5 ${
              mode === "route" ? "bg-electric text-[#0B1220]" : "text-white/60"
            } disabled:opacity-40`}
            title={hasRoute ? "Cheapest along your route" : "Start a route first"}
          >
            <RouteIcon className="h-3.5 w-3.5" /> Along route
          </button>
        </div>
        <button
          onClick={() => setHgvOnly((v) => !v)}
          className={`chip flex items-center gap-1.5 ${
            hgvOnly ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-white/60"
          }`}
          title="Only stations that welcome big rigs"
        >
          Truck-friendly
        </button>
      </div>

      {/* Fuel plan builder — only meaningful along a route */}
      {mode === "route" && hasRoute && (
        <FuelPlanBuilder routeCoords={routeCoords!} hgvOnly={hgvOnly} />
      )}

      {/* Station list */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding the cheapest diesel…
          </div>
        ) : error ? (
          <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        ) : !stations.length ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/50">
            No fuel stations found here yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {stations.map((s, i) => (
              <StationCard
                key={s.id}
                station={s}
                mode={mode}
                isCheapest={cheapest != null && s.priceEff === cheapest && i === 0}
                onNavigate={onNavigate}
                onReported={(updated) =>
                  setStations((prev) =>
                    prev.map((p) => (p.id === updated.id ? updated : p)),
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function confidenceLabel(c: number): { text: string; cls: string } {
  if (c >= 0.75) return { text: "High confidence", cls: "text-emerald-300" };
  if (c >= 0.5) return { text: "Fair confidence", cls: "text-amber-300" };
  return { text: "Estimated", cls: "text-white/40" };
}

function StationCard({
  station,
  mode,
  isCheapest,
  onNavigate,
  onReported,
}: {
  station: PricedStation;
  mode: Mode;
  isCheapest: boolean;
  onNavigate: (poi: TruckMapPoi) => void;
  onReported: (updated: PricedStation) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const conf = confidenceLabel(station.priceConfidence);

  const submit = async () => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0 || p > 20) return;
    setSaving(true);
    try {
      const res = await api.reportFuelPrice(station.id, p);
      if (res.station) onReported(res.station);
      setReporting(false);
      setPrice("");
    } finally {
      setSaving(false);
    }
  };

  const distText =
    mode === "route" && station.routeMi != null
      ? `${station.routeMi.toFixed(0)} mi in${
          station.detourMi != null && station.detourMi > 0.5
            ? ` · ${station.detourMi.toFixed(1)} mi off`
            : ""
        }`
      : `${station.distanceMi.toFixed(1)} mi away`;

  return (
    <li
      className={`rounded-xl border p-3 ${
        isCheapest
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-slate-800 bg-slate-800/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Fuel className="h-4 w-4 flex-none text-electric" />
            <span className="truncate text-sm font-semibold text-white">
              {station.brand || station.name}
            </span>
            {isCheapest && (
              <span className="chip flex-none bg-emerald-500/20 text-[10px] text-emerald-300">
                Cheapest
              </span>
            )}
          </div>
          <p className="truncate text-xs text-white/50">
            {[station.city, station.state].filter(Boolean).join(", ") ||
              station.address ||
              station.name}
          </p>
          <p className="mt-0.5 text-xs text-white/40">{distText}</p>
        </div>
        <div className="flex-none text-right">
          <p className="text-lg font-extrabold leading-none text-white">
            ${station.priceEff.toFixed(2)}
          </p>
          {station.savingsPerGal > 0.005 && (
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-emerald-300">
              <TrendingDown className="h-3 w-3" />${station.savingsPerGal.toFixed(2)}/gal
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1 text-[11px] ${conf.cls}`}>
          {station.priceIsLive && <BadgeCheck className="h-3.5 w-3.5" />}
          {station.priceIsLive ? conf.text : "Regional estimate"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setReporting((v) => !v)}
            className="chip bg-white/5 text-white/70"
          >
            Report price
          </button>
          <button
            onClick={() => onNavigate(station)}
            className="chip flex items-center gap-1 bg-electric text-[#0B1220]"
          >
            <Navigation className="h-3.5 w-3.5" /> Go
          </button>
        </div>
      </div>

      {reporting && (
        <div className="mt-2 flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40">
              $
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Diesel $/gal you see"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-6 pr-3 text-sm text-white outline-none focus:border-electric"
            />
          </div>
          <button
            onClick={submit}
            disabled={saving || !price}
            className="chip flex items-center gap-1 bg-electric text-[#0B1220] disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" /> {saving ? "…" : "Submit"}
          </button>
        </div>
      )}
    </li>
  );
}

// ── Fuel plan builder (savings calculator + plan strip) ─────────────────────
function FuelPlanBuilder({
  routeCoords,
  hgvOnly,
}: {
  routeCoords: [number, number][];
  hgvOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tank, setTank] = useState(200);
  const [current, setCurrent] = useState(50);
  const [mpg, setMpg] = useState(6.5);
  const [reserve, setReserve] = useState(25);
  const [plan, setPlan] = useState<FuelPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fuelPlan(routeCoords, {
        tankGallons: tank,
        currentGallons: current,
        mpg,
        reserveGallons: reserve,
        hgvOnly,
      });
      setPlan(res);
    } catch (e: any) {
      setError(e?.message || "Couldn't build a fuel plan.");
    } finally {
      setLoading(false);
    }
  };

  const inputs = useMemo(
    () =>
      [
        { label: "Tank (gal)", value: tank, set: setTank, step: 10, min: 50, max: 400 },
        { label: "In tank now (gal)", value: current, set: setCurrent, step: 10, min: 0, max: tank },
        { label: "MPG", value: mpg, set: setMpg, step: 0.1, min: 3, max: 12 },
        { label: "Reserve (gal)", value: reserve, set: setReserve, step: 5, min: 0, max: 100 },
      ] as const,
    [tank, current, mpg, reserve],
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <Gauge className="h-4 w-4 text-electric" /> Route fuel plan
        </span>
        <span className="text-xs text-white/50">{open ? "Hide" : "Set up"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {inputs.map((f) => (
              <label key={f.label} className="block">
                <span className="mb-1 block text-[11px] font-medium text-white/50">
                  {f.label}
                </span>
                <input
                  type="number"
                  value={f.value}
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  onChange={(e) => f.set(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-electric"
                />
              </label>
            ))}
          </div>
          <button
            onClick={build}
            disabled={loading}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-electric text-sm font-semibold text-[#0B1220] disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Optimizing…
              </>
            ) : (
              "Build fuel plan"
            )}
          </button>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          {plan && (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                <span className="text-xs text-white/60">
                  {plan.totalGallons} gal · ${plan.totalCost.toFixed(2)}
                </span>
                {plan.totalSavings > 0 && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-300">
                    <TrendingDown className="h-3.5 w-3.5" /> saves $
                    {plan.totalSavings.toFixed(2)}
                  </span>
                )}
              </div>
              <p className="text-xs text-white/60">{plan.note}</p>
              <ol className="space-y-1.5">
                {plan.stops.map((stop, i) => (
                  <li
                    key={stop.poiId + i}
                    className="rounded-lg border border-slate-700 bg-slate-900/60 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-white">
                        {i + 1}. {stop.brand || stop.name}
                      </span>
                      <span className="flex-none text-xs text-white/50">
                        {stop.routeMi.toFixed(0)} mi in
                      </span>
                    </div>
                    <p className="text-xs text-electric">
                      {stop.gallons} gal @ ${stop.priceEff.toFixed(2)} = $
                      {stop.cost.toFixed(2)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/50">{stop.reason}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
