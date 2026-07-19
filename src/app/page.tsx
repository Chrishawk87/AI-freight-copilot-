"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  TrendingUp,
  Fuel,
  Repeat,
  Bot,
  ArrowRight,
  Mic,
  MapPin,
  Trash2,
  Loader2,
  Gift,
  Copy,
  Check,
  Target,
  Navigation,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { PageHeader, Stat, money, Loading, ErrorState } from "@/components/ui";
import LoadCard from "@/components/LoadCard";
import {
  api,
  type Booking,
  type CarrierDetail,
  type DailyPlan,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const dash = useApi(() => api.dashboard(), []);
  const carrier = useApi(() => api.carrier(), []);
  const booked = useApi(() => api.bookings(), []);
  const fuel = useApi(() => api.fuel(), []);

  // Daily Profit Plan — the day's single recommended play. We fetch immediately,
  // then refine with GPS (sharper fuel-stop pick) once the driver shares location.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const plan = useApi(
    () => api.dailyPlan(coords?.lat, coords?.lon),
    [coords?.lat, coords?.lon],
  );
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    );
  }, []);

  if (dash.loading || carrier.loading) return <Loading />;
  if (dash.error) return <ErrorState message={dash.error} />;

  const w = dash.data!.weekly;
  const top = dash.data!.topLoads;
  const c = carrier.data;
  const rpm = w.miles ? (w.revenue / w.miles).toFixed(2) : "0.00";
  const margin = w.revenue ? ((w.netProfit / w.revenue) * 100).toFixed(0) : "0";
  const companyName = c?.companyName ?? user?.carrier?.companyName ?? "Your Carrier";

  // --- Fuel savings (real formula from live diesel + the carrier's own MPG) ---
  const mpg = c?.mpg && c.mpg > 0 ? c.mpg : 6.5;
  const nationalAvg = fuel.data?.nationalAvg ?? 0;
  const bestPrice = fuel.data?.stations?.length
    ? Math.min(...fuel.data.stations.map((s) => s.price))
    : nationalAvg;
  const perGal = Math.max(0, nationalAvg - bestPrice);
  const weekGallons = w.miles / mpg;
  const fuelSavings = perGal * weekGallons;

  return (
    <div>
      <PageHeader
        title="Fleet Command Center"
        subtitle={
          c
            ? `${companyName} · ${c.equipment.length} units · ${c.drivers.length} drivers`
            : companyName
        }
        action={
          <button className="btn-primary" onClick={() => router.push("/dispatcher")}>
            <Mic className="h-4 w-4" /> Hey Co-Pilot
          </button>
        }
      />

      {/* Today's Plan — the day's single recommended play */}
      <div className="mb-4">
        <DailyPlanHero
          plan={plan.data}
          loading={plan.loading}
          onBook={() => {
            plan.reload();
            dash.reload();
            booked.reload();
          }}
        />
      </div>

      {/* Total savings hero + last-7-days spend */}
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <SavingsHero
          savings={fuelSavings}
          perGal={perGal}
          gallons={weekGallons}
          onFind={() => router.push("/navigation")}
        />
        <SpendChart bookings={booked.data ?? []} mpg={mpg} price={nationalAvg} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="This Week Revenue" value={money(w.revenue)} sub={`${w.loadsCompleted} loads booked`} />
        <Stat label="Net Profit" value={money(w.netProfit)} sub={`${margin}% margin`} accent="#16C784" />
        <Stat label="Revenue / Mile" value={`$${rpm}`} sub={`${w.miles.toLocaleString()} mi run`} />
        <Stat
          label="Deadhead"
          value={`${w.deadheadMiles} mi`}
          sub={w.miles ? `${((w.deadheadMiles / w.miles) * 100).toFixed(0)}% of miles` : "0% of miles"}
          accent="#F59E0B"
        />
      </div>

      <div className="mb-6">
        <ReferralCard carrier={c} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickLink href="/dispatcher" icon={Bot} label="Ask the Dispatcher" tint="#246BFD" />
        <QuickLink href="/reloads" icon={Repeat} label="Find Reloads" tint="#16C784" />
        <QuickLink href="/navigation" icon={Fuel} label="Cheapest Diesel" tint="#F59E0B" />
        <QuickLink href="/loads" icon={TrendingUp} label="Best Loads Now" tint="#246BFD" />
      </div>

      {booked.data && booked.data.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">Your booked loads</h2>
            <span className="text-sm text-white/40">{booked.data.length} active</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {booked.data.map((b) => (
              <BookedRow key={b.id} booking={b} onRemoved={() => { booked.reload(); dash.reload(); }} />
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">Top opportunities right now</h2>
        <Link href="/loads" className="flex items-center gap-1 text-sm text-electric hover:underline">
          View all <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {top.map((l) => (
          <LoadCard key={l.id} load={l} onBooked={() => dash.reload()} />
        ))}
      </div>
    </div>
  );
}

function DailyPlanHero({
  plan,
  loading,
  onBook,
}: {
  plan: DailyPlan | null;
  loading: boolean;
  onBook: () => void;
}) {
  const router = useRouter();
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [error, setError] = useState("");

  if (loading && !plan) {
    return (
      <div className="card flex items-center gap-3 p-6">
        <Loader2 className="h-5 w-5 animate-spin text-electric" />
        <span className="text-sm text-white/60">Building today&apos;s profit plan…</span>
      </div>
    );
  }
  if (!plan) return null;

  // No bookable freight — show the empty-state guidance the backend returns.
  if (!plan.hasPlan || !plan.recommendedLoad) {
    return (
      <div className="card p-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-electric">
          <Sparkles className="h-4 w-4" /> Today&apos;s Profit Plan
        </div>
        <div className="mt-2 text-lg font-bold">{plan.headline}</div>
        <ul className="mt-3 space-y-1.5">
          {plan.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm text-white/60">
              <span className="text-white/30">•</span>
              {s}
            </li>
          ))}
        </ul>
        <button
          onClick={() => router.push("/integrations")}
          className="btn-primary mt-4"
        >
          Connect a load board
        </button>
      </div>
    );
  }

  const load = plan.recommendedLoad;

  async function book() {
    setBooking(true);
    setError("");
    try {
      await api.book(load.id);
      setBooked(true);
      onBook();
    } catch (e: any) {
      setError(e.message || "Could not book");
    } finally {
      setBooking(false);
    }
  }

  return (
    <div className="card relative overflow-hidden p-5 lg:p-6">
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #246BFD, transparent 70%)" }}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-electric">
          <Sparkles className="h-4 w-4" /> Today&apos;s Profit Plan
        </div>
        <div className="flex items-center gap-1.5 text-xs text-white/40">
          <Target className="h-3.5 w-3.5" />
          Goal {money(plan.revenueGoal)}
        </div>
      </div>

      <div className="mt-2 text-lg font-bold leading-snug lg:text-xl">
        {plan.headline}
      </div>

      {/* Key numbers */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PlanStat label="Load pays" value={money(load.rate)} sub={`$${load.allInRpm.toFixed(2)}/mi all-in`} />
        <PlanStat label="Est. fuel" value={money(plan.expectedFuelCost)} sub={`diesel $${plan.dieselPrice.toFixed(2)}`} accent="#F59E0B" />
        <PlanStat label="Net profit" value={money(plan.expectedNetProfit)} sub={`${load.miles.toLocaleString()} loaded mi`} accent="#16C784" />
        <PlanStat label="End-of-day" value={money(plan.expectedEndOfDayRevenue)} sub={`${plan.reloadProbability}% reload odds`} />
      </div>

      {/* Fuel stop + reload */}
      {(plan.fuelStop || plan.bestReload) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {plan.fuelStop && (
            <div className="flex items-start gap-3 rounded-xl bg-warning/10 p-3">
              <Fuel className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="text-sm">
                <div className="font-semibold">
                  Fuel: {plan.fuelStop.brand || plan.fuelStop.name}
                  {plan.fuelStop.city ? ` · ${plan.fuelStop.city}, ${plan.fuelStop.state}` : ""}
                </div>
                <div className="text-xs text-white/50">
                  ${plan.fuelStop.priceEff.toFixed(2)}/gal · ${plan.fuelStop.savingsPerGal.toFixed(2)} under avg · {plan.fuelStop.distanceMi.toFixed(0)} mi away
                </div>
              </div>
            </div>
          )}
          {plan.bestReload && (
            <div className="flex items-start gap-3 rounded-xl bg-success/10 p-3">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <div className="text-sm">
                <div className="font-semibold">
                  Reload: {plan.bestReload.originCity}, {plan.bestReload.originState} → {plan.bestReload.destCity}, {plan.bestReload.destState}
                </div>
                <div className="text-xs text-white/50">
                  {money(plan.bestReload.rate)} · ~{plan.reloadProbability}% chance near {load.destCity}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-3 text-xs text-danger">{error}</div>}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {booked ? (
          <span className="flex items-center gap-1.5 rounded-xl bg-success/15 px-4 py-2 text-sm font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" /> Booked
          </span>
        ) : (
          <button onClick={book} disabled={booking} className="btn-primary disabled:opacity-60">
            {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Book this load
          </button>
        )}
        <button
          onClick={() => router.push("/navigation")}
          className="flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-electric/40"
        >
          <Navigation className="h-4 w-4" /> Navigate
        </button>
        <button
          onClick={() => router.push("/dispatcher")}
          className="flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-electric/40"
        >
          <Mic className="h-4 w-4" /> Ask Co-Pilot
        </button>
      </div>
    </div>
  );
}

function PlanStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-0.5 text-lg font-bold" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="text-[11px] text-white/40">{sub}</div>
    </div>
  );
}

function BookedRow({
  booking,
  onRemoved,
}: {
  booking: Booking;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const l = booking.load;

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.removeBooking(booking.id);
      onRemoved();
    } catch (e: any) {
      setError(e.message || "Could not remove");
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="chip bg-white/5">{l.equipment}</span>
            <span>{l.source}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold">
            <MapPin className="h-4 w-4 shrink-0 text-electric" />
            <span className="truncate">
              {l.originCity}, {l.originState} <ArrowRight className="inline h-3.5 w-3.5 text-white/30" /> {l.destCity}, {l.destState}
            </span>
          </div>
          <div className="mt-1 text-xs text-white/50">
            {money(l.rate)} · {l.broker}
          </div>
        </div>
        {confirm ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Remove"}
            </button>
            <button
              onClick={() => setConfirm(false)}
              disabled={busy}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            title="Remove this load"
            className="shrink-0 rounded-lg border border-white/10 p-2 text-white/40 transition hover:border-danger/40 hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && <div className="mt-2 text-xs text-danger">{error}</div>}
    </div>
  );
}

function SavingsHero({
  savings,
  perGal,
  gallons,
  onFind,
}: {
  savings: number;
  perGal: number;
  gallons: number;
  onFind: () => void;
}) {
  return (
    <div className="card relative overflow-hidden p-5">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #16C784, transparent 70%)" }}
      />
      <div className="text-xs font-medium uppercase tracking-wide text-white/40">
        Total fuel savings · this week
      </div>
      <div className="mt-1 text-4xl font-extrabold text-success lg:text-5xl">
        {money(savings)}
      </div>
      <div className="mt-1 text-xs text-white/50">
        ${perGal.toFixed(2)}/gal below national avg · est. {Math.round(gallons)} gal
      </div>
      <button
        onClick={onFind}
        className="mt-4 flex items-center gap-1.5 rounded-xl bg-success/15 px-3 py-2 text-sm font-semibold text-success transition hover:bg-success/25"
      >
        <Fuel className="h-4 w-4" /> Find cheaper diesel
      </button>
    </div>
  );
}

function SpendChart({
  bookings,
  mpg,
  price,
}: {
  bookings: Booking[];
  mpg: number;
  price: number;
}) {
  // Build the last 7 calendar days and bucket estimated fuel spend by pickup day.
  const days: { label: string; spend: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    let spend = 0;
    for (const b of bookings) {
      if ((b.load.pickupDate || "").slice(0, 10) === key) {
        const miles = b.load.miles + b.load.deadheadMiles;
        spend += (miles / mpg) * price;
      }
    }
    days.push({ label: d.toLocaleDateString("en-US", { weekday: "short" }), spend });
  }
  const max = Math.max(1, ...days.map((d) => d.spend));
  const total = days.reduce((s, d) => s + d.spend, 0);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-white/40">
          Last 7 days · est. fuel spend
        </div>
        <div className="text-sm font-bold">{money(total)}</div>
      </div>
      <div className="mt-4 flex h-28 items-end justify-between gap-2">
        {days.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex h-24 w-full items-end">
              <div
                className="w-full rounded-t-md bg-electric/70 transition-all"
                style={{ height: `${(d.spend / max) * 100}%`, minHeight: d.spend > 0 ? 4 : 0 }}
                title={money(d.spend)}
              />
            </div>
            <span className="text-[10px] text-white/40">{d.label}</span>
          </div>
        ))}
      </div>
      {total === 0 && (
        <div className="mt-2 text-center text-[11px] text-white/30">
          No booked loads in the last 7 days yet.
        </div>
      )}
    </div>
  );
}

function ReferralCard({ carrier }: { carrier: CarrierDetail | null }) {
  const [copied, setCopied] = useState(false);
  const base =
    (carrier?.companyName || "DRIVER").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() ||
    "DRIVER";
  const suffix = carrier?.dotNumber ? carrier.dotNumber.slice(-4) : "FUEL";
  const code = `${base}-${suffix}`;

  async function share() {
    const msg = `Join me on AI Freight Co-Pilot — use my code ${code}.`;
    try {
      if (typeof navigator !== "undefined" && (navigator as any).share) {
        await (navigator as any).share({ title: "AI Freight Co-Pilot", text: msg });
        return;
      }
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* user dismissed the share sheet */
    }
  }

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-electric/15">
          <Gift className="h-5 w-5 text-electric" />
        </div>
        <div>
          <div className="text-sm font-semibold">Refer a driver, both save</div>
          <div className="text-xs text-white/50">Share your code — earns fuel credit when they join.</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-lg border border-dashed border-white/20 px-3 py-1.5 font-mono text-sm font-bold tracking-wider">
          {code}
        </span>
        <button
          onClick={share}
          className="flex items-center gap-1.5 rounded-xl bg-electric px-3 py-2 text-sm font-semibold text-white"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Share"}
        </button>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
  tint,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tint: string;
}) {
  return (
    <Link href={href} className="card flex items-center gap-3 p-4 transition hover:ring-1 hover:ring-electric/30">
      <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `${tint}22` }}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-sm font-semibold">{label}</span>
    </Link>
  );
}
