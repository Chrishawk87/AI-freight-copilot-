"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Fuel,
  MapPin,
  Navigation2,
  Star,
  Crosshair,
  TrendingDown,
} from "lucide-react";
import { PageHeader, Stat, money, Loading, ErrorState } from "@/components/ui";
import { api, FuelResponse } from "@/lib/api";
import { useGeolocation, haversineMiles } from "@/lib/geolocation";
import { LiveMap, brandColor, type StationPin } from "@/components/LiveMap";
import clsx from "clsx";

type ApiStation = FuelResponse["stations"][number];
type Station = ApiStation & { liveDistance: number | null };

const FAV_KEY = "aifc_fuel_favorites";
const RECENT_KEY = "aifc_fuel_recent";

function readIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type Tab = "nearby" | "explore" | "recent";

export default function FuelPage() {
  const router = useRouter();
  const { pos, status: geoStatus, request } = useGeolocation();

  const [data, setData] = useState<FuelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("nearby");
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gallons, setGallons] = useState(150);

  useEffect(() => {
    setFavorites(readIds(FAV_KEY));
    setRecent(readIds(RECENT_KEY));
  }, []);

  // Fetch stations. Re-runs when the GPS fix moves enough to matter (~7 mi grid),
  // so the list stays live as the driver travels without hammering the API.
  const gridLat = pos ? Math.round(pos.lat * 10) / 10 : null;
  const gridLon = pos ? Math.round(pos.lon * 10) / 10 : null;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .fuel(gridLat ?? undefined, gridLon ?? undefined)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Could not load fuel data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gridLat, gridLon]);

  const toggleFav = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const pushRecent = useCallback((id: string) => {
    setRecent((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // Raw stations (stable identity) power the map pins.
  const rawStations = data?.stations ?? [];

  // Map to the shared LiveMap's StationPin shape (drop any without coords).
  const pins: StationPin[] = useMemo(
    () =>
      rawStations
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({
          id: s.id,
          name: s.name,
          network: s.network,
          lat: s.latitude as number,
          lon: s.longitude as number,
          price: s.price,
          hours: s.hours ?? null,
          hgv: s.hgv ?? false,
          diesel: s.diesel ?? true,
        })),
    [rawStations]
  );

  // Distance-annotated stations power the list. Recomputed as GPS moves.
  const stations: Station[] = useMemo(() => {
    return rawStations.map((s) => {
      let liveDistance: number | null = null;
      if (pos && s.latitude != null && s.longitude != null) {
        liveDistance = haversineMiles(pos, { lat: s.latitude, lon: s.longitude });
      }
      return { ...s, liveDistance };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawStations, pos?.lat, pos?.lon]);

  const distOf = (s: Station) => s.liveDistance ?? s.distanceMi;

  const list = useMemo(() => {
    let out = [...stations];
    if (tab === "nearby") out.sort((a, b) => distOf(a) - distOf(b));
    else if (tab === "explore") out.sort((a, b) => a.price - b.price);
    else {
      const order = new Map(recent.map((id, i) => [id, i]));
      out = out
        .filter((s) => order.has(s.id))
        .sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
    }
    if (favOnly) out = out.filter((s) => favorites.includes(s.id));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, tab, favOnly, favorites, recent]);

  const nationalAvg = data?.nationalAvg ?? 0;

  const nearest = useMemo(
    () => [...stations].sort((a, b) => distOf(a) - distOf(b))[0],
    [stations]
  );
  const cheapest = useMemo(
    () => [...stations].sort((a, b) => a.price - b.price)[0],
    [stations]
  );

  const directions = useCallback(
    (s: Station) => {
      pushRecent(s.id);
      const dest = s.address || `${s.city}, ${s.state}`;
      router.push(`/navigation?to=${encodeURIComponent(dest)}&start=1`);
    },
    [router, pushRecent]
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
    <div>
      <PageHeader
        title="Find Fuel"
        subtitle="Live diesel near you, ranked by real distance from your position."
        action={
          <button
            onClick={request}
            className="chip flex items-center gap-1.5 bg-electric/15 text-electric"
          >
            <Crosshair className="h-3.5 w-3.5" /> {geoLabel}
          </button>
        }
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <>
          {/* Live data-source banner — honest about where prices come from */}
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
            <span
              className={clsx(
                "chip",
                data?.source === "live"
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning"
              )}
            >
              {data?.source === "live" ? "Live · OpenStreetMap" : "Nationwide fallback"}
            </span>
            <span>
              {data?.priceEnriched
                ? "Local diesel prices · live from AAA"
                : `Diesel price: ${data?.regionLabel ?? "U.S."} regional avg · EIA ${data?.priceAsOf}${data?.priceLive ? " · auto-updating" : ""}`}
            </span>
            {data?.source !== "live" && geoStatus !== "ok" && (
              <button onClick={request} className="ml-auto text-electric">
                Enable GPS for stations near you →
              </button>
            )}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label={data?.priceEnriched ? "Cheapest" : "Diesel here"}
              value={cheapest ? `$${cheapest.price.toFixed(2)}` : "—"}
              sub={
                data?.priceEnriched
                  ? cheapest
                    ? `${cheapest.name} · ${cheapest.city}`
                    : ""
                  : data?.regionLabel ?? "regional avg"
              }
              accent="#16C784"
            />
            <Stat
              label="Nearest"
              value={nearest ? `${Math.round(distOf(nearest))} mi` : "—"}
              sub={nearest ? `${nearest.name} · $${nearest.price.toFixed(2)}` : ""}
            />
            <Stat
              label="National Avg"
              value={`$${nationalAvg.toFixed(2)}`}
              sub="diesel / gal"
            />
            <Stat
              label="Est. Fill Savings"
              value={
                cheapest
                  ? money(Math.max(0, (nationalAvg - cheapest.price) * gallons))
                  : "—"
              }
              sub={`on ${gallons} gal vs national`}
              accent="#16C784"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            {/* Map — shared MapLibre renderer, same one the live map tab uses */}
            <div className="card h-[360px] p-2 lg:h-[620px]">
              <div className="relative h-full w-full overflow-hidden rounded-2xl">
                <LiveMap
                  driver={pos}
                  stations={pins}
                  selectedId={selectedId}
                  onSelectStation={setSelectedId}
                  showRoute={false}
                />
              </div>
            </div>

            {/* List */}
            <div className="flex flex-col gap-3">
              {/* Tabs */}
              <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 text-xs font-semibold">
                {(["nearby", "explore", "recent"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={clsx(
                      "flex-1 rounded-lg py-2 uppercase tracking-wide transition",
                      tab === t
                        ? "bg-electric text-white"
                        : "text-white/50 hover:text-white/80"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <label className="flex items-center justify-between px-1 text-xs text-white/60">
                <span className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5" /> Show favorites only
                </span>
                <input
                  type="checkbox"
                  checked={favOnly}
                  onChange={(e) => setFavOnly(e.target.checked)}
                  className="h-4 w-4 accent-electric"
                />
              </label>

              {geoStatus !== "ok" && (
                <button
                  onClick={request}
                  className="rounded-xl border border-electric/30 bg-electric/10 px-3 py-2 text-left text-xs text-electric"
                >
                  {geoStatus === "denied"
                    ? "Location is off — distances use your route fallback. Tap to enable live GPS."
                    : "Tap to turn on live GPS for real distances to each station."}
                </button>
              )}

              <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-1">
                {list.length === 0 ? (
                  <div className="py-10 text-center text-sm text-white/40">
                    {tab === "recent"
                      ? "No recent stations yet."
                      : favOnly
                      ? "No favorites yet — tap the star on a station."
                      : "No stations found."}
                  </div>
                ) : (
                  list.map((s) => {
                    const savings = Math.max(0, nationalAvg - s.price);
                    const isFav = favorites.includes(s.id);
                    const isSel = selectedId === s.id;
                    return (
                      <div
                        key={s.id}
                        onClick={() => setSelectedId(s.id)}
                        className={clsx(
                          "cursor-pointer rounded-xl p-3 transition",
                          isSel
                            ? "bg-electric/10 ring-1 ring-electric/40"
                            : "bg-white/[0.03] hover:bg-white/[0.06]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="grid h-9 w-9 place-items-center rounded-lg"
                              style={{ background: `${brandColor(s.network)}22` }}
                            >
                              <Fuel
                                className="h-4 w-4"
                                style={{ color: brandColor(s.network) }}
                              />
                            </div>
                            <div>
                              <div className="text-sm font-semibold">{s.name}</div>
                              <div className="flex items-center gap-1 text-[11px] text-white/50">
                                <MapPin className="h-3 w-3" />
                                {s.city}, {s.state}
                                {s.exit ? ` · ${s.exit}` : ""}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFav(s.id);
                            }}
                            aria-label="Toggle favorite"
                          >
                            <Star
                              className={clsx(
                                "h-4 w-4",
                                isFav ? "text-warning" : "text-white/30"
                              )}
                              fill={isFav ? "#F59E0B" : "none"}
                            />
                          </button>
                        </div>

                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-white/60">
                            <span className="font-semibold text-white/80">
                              {Math.round(distOf(s))} mi
                            </span>
                            {savings > 0 && (
                              <span className="chip bg-success/15 text-success">
                                Save ${savings.toFixed(2)}/gal
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-lg font-bold">
                                ${s.price.toFixed(2)}
                              </span>
                              <span className="text-[10px] text-white/40"> /gal</span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                directions(s);
                              }}
                              className="flex items-center gap-1 rounded-lg bg-electric px-2.5 py-1.5 text-xs font-semibold text-white"
                            >
                              <Navigation2 className="h-3.5 w-3.5" /> Go
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Savings calculator */}
              <div className="card p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <TrendingDown className="h-4 w-4 text-success" /> Fill savings
                </div>
                <input
                  type="range"
                  min={50}
                  max={250}
                  step={10}
                  value={gallons}
                  onChange={(e) => setGallons(Number(e.target.value))}
                  className="w-full accent-electric"
                />
                <div className="mt-1 flex items-center justify-between text-xs text-white/60">
                  <span>{gallons} gal</span>
                  {cheapest && (
                    <span>
                      Save{" "}
                      <span className="font-bold text-success">
                        {money(Math.max(0, (nationalAvg - cheapest.price) * gallons))}
                      </span>{" "}
                      vs. national avg
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
