"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { MoreHorizontal, X } from "lucide-react";
import { NAV } from "@/lib/nav";

// Primary phone tabs shown in the bar. Everything else lives under "More".
const PRIMARY = ["/", "/loads", "/map", "/dispatcher", "/fuel"];
const OVERFLOW = ["/profit", "/reloads", "/navigation", "/documents", "/memory", "/integrations", "/profile"];

export default function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet whenever the route changes.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const primary = PRIMARY.map((h) => NAV.find((n) => n.href === h)!).filter(Boolean);
  const overflow = OVERFLOW.map((h) => NAV.find((n) => n.href === h)!).filter(Boolean);
  const overflowActive = OVERFLOW.includes(pathname);

  return (
    <>
      {/* Slide-up "More" sheet */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-navy-900 p-4 pb-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-bold">More</div>
              <button
                aria-label="Close"
                onClick={() => setMoreOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {overflow.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={clsx(
                      "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition",
                      active
                        ? "bg-electric/15 text-white ring-1 ring-electric/40"
                        : "bg-white/5 text-white/70 hover:bg-white/10"
                    )}
                  >
                    <Icon
                      className={clsx("h-5 w-5", active ? "text-electric" : "text-white/60")}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-navy-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between px-2 py-2">
          {primary.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-medium",
                  active ? "text-electric" : "text-white/50"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.short}
              </Link>
            );
          })}

          <button
            type="button"
            aria-label="More"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className={clsx(
              "flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-medium",
              moreOpen || overflowActive ? "text-electric" : "text-white/50"
            )}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
