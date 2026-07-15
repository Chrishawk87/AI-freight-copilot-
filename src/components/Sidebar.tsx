"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Truck, Mic } from "lucide-react";
import { NAV } from "@/lib/nav";

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex sticky top-0 h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-navy-900/60 px-4 py-6">
      <Link href="/" className="mb-8 flex items-center gap-3 px-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-electric shadow-glow">
          <Truck className="h-5 w-5 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-extrabold tracking-tight">AI Freight</div>
          <div className="text-[11px] font-medium text-electric">Co-Pilot</div>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-electric/15 text-white ring-1 ring-electric/40"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className={clsx("h-[18px] w-[18px]", active ? "text-electric" : "")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Link
        href="/dispatcher"
        className="mt-4 flex items-center gap-3 rounded-xl border border-electric/30 bg-electric/10 px-3 py-3 text-sm font-semibold text-white transition hover:bg-electric/20"
      >
        <Mic className="h-[18px] w-[18px] text-electric" />
        Hey Co-Pilot
      </Link>
    </aside>
  );
}
