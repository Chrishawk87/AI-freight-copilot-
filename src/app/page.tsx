"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { TrendingUp, Fuel, Repeat, Bot, ArrowRight, Mic } from "lucide-react";
import { PageHeader, Stat, money, Loading, ErrorState } from "@/components/ui";
import LoadCard from "@/components/LoadCard";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const dash = useApi(() => api.dashboard(), []);
  const carrier = useApi(() => api.carrier(), []);

  if (dash.loading || carrier.loading) return <Loading />;
  if (dash.error) return <ErrorState message={dash.error} />;

  const w = dash.data!.weekly;
  const top = dash.data!.topLoads;
  const c = carrier.data;
  const rpm = w.miles ? (w.revenue / w.miles).toFixed(2) : "0.00";
  const margin = w.revenue ? ((w.netProfit / w.revenue) * 100).toFixed(0) : "0";
  const companyName = c?.companyName ?? user?.carrier?.companyName ?? "Your Carrier";

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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickLink href="/dispatcher" icon={Bot} label="Ask the Dispatcher" tint="#246BFD" />
        <QuickLink href="/reloads" icon={Repeat} label="Find Reloads" tint="#16C784" />
        <QuickLink href="/fuel" icon={Fuel} label="Cheapest Diesel" tint="#F59E0B" />
        <QuickLink href="/loads" icon={TrendingUp} label="Best Loads Now" tint="#246BFD" />
      </div>

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
