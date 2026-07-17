"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Fuel,
  MapPin,
  Navigation2,
  Star,
  Loader2,
  Crosshair,
  TrendingDown,
} from "lucide-react";
import { PageHeader, Stat, money, Loading, ErrorState } from "@/components/ui";
import { api, FuelResponse } from "@/lib/api";
import {
  useGeolocation,
  haversineMiles,
  US_CENTER,
  type LatLon,
} from "@/lib/geolocation";
import clsx from "clsx";

// ---------- Leaflet loaders (free map, no key) ----------
function loadCss(href: string) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${src}"]`
    ) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("load error")));
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.body.appendChild(s);
  });
}

// ---------- brand styling for price pins ----------
const BRAND_COLORS: Record<string, string> = {
  "Love's": "#E4002B",
  Pilot: "#C8102E",
  TA: "#003DA5",
  QT: "#E51937",
  "Buc-ee's": "#B8860B",
};
function brandColor(network: string): string {
  return BRAND_COLORS[network] ?? "#246BFD";
}

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

// ---------- Map with branded price pins ----------
function FuelMap({
  driver,
  stations,
  selectedId,
  onSelect,
}: {
  driver: LatLon | null;
  stations: ApiStation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<string, any>>({});
  const driverMarkerRef = useRef<any>(null);
  const didFitRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Init the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        loadCss("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
        await loadScript(
          "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
        );
        const L = (window as any).L;
        if (cancelled || !ref.current || mapRef.current) return;
        const map = L.map(ref.current, { zoomControl: true, attributionControl: true });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);
        map.setView([US_CENTER.lat, US_CENTER.lon], 4);
        mapRef.current = map;
        setTimeout(() => map.invalidateSize(), 200);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Live driver dot.
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    if (!L || !map || !driver) return;
    if (driverMarkerRef.current) {
      driverMarkerRef.current.setLatLng([driver.lat, driver.lon]);
    } else {
      driverMarkerRef.current = L.circleMarker([driver.lat, driver.lon], {
        radius: 7,
        color: "#fff",
        weight: 3,
        fillColor: "#246BFD",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip("You");
      if (!didFitRef.current) {
        map.setView([driver.lat, driver.lon], 9);
        didFitRef.current = true;
      }
    }
  }, [driver, status]);

  // Station price pins — built once per station set (identity is stable from the API).
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;
    Object.values(markersRef.current).forEach((m: any) => map.removeLayer(m));
    markersRef.current = {};
    stations.forEach((s) => {
      if (s.latitude == null || s.longitude == null) return;
      const color = brandColor(s.network);
      const html = `<div style="transform:translate(-50%,-100%);background:${color};color:#fff;font:700 12px/1 system-ui;padding:5px 8px;border-radius:9px;box-shadow:0 2px 6px rgba(0,0,0,.4);white-space:nowrap;border:2px solid rgba(255,255,255,.85)">$${s.price.toFixed(
        2
      )}</div>`;
      const icon = L.divIcon({ className: "fuel-pin", html, iconSize: [0, 0] });
      const m = L.marker([s.latitude, s.longitude], { icon }).addTo(map);
      m.on("click", () => onSelectRef.current(s.id));
      markersRef.current[s.id] = m;
    });
  }, [stations, status]);

  // Pan to the selected station.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const s = stations.find((x) => x.id === selectedId);
    if (s && s.latitude != null && s.longitude != null) {
      map.setView([s.latitude, s.longitude], Math.max(map.getZoom(), 10), {
        animate: true,
      });
    }
  }, [selectedId, stations]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
      <div ref={ref} className="h-full w-full" style={{ background: "#0f1526" }} />
      {status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-navy-900/40 text-xs text-white/60">
          {status === "loading" ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
            </span>
          ) : (
            <span>Map unavailable — check your connection.</span>
          )}
        </div>
      )}
    </div>
  );
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
            {/* Map */}
            <div className="card h-[360px] p-2 lg:h-[620px]">
              <FuelMap
                driver={pos}
                stations={rawStations}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
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
