"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import CoPilotWidget from "./CoPilotWidget";
import { useAuth } from "@/lib/auth";
import { CoPilotProvider } from "@/lib/copilot-context";

const PUBLIC_ROUTES = ["/login", "/register"];

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="grid h-12 w-12 animate-pulse place-items-center rounded-2xl bg-electric shadow-glow">
          <Truck className="h-6 w-6 text-white" />
        </div>
        <div className="text-sm text-white/40">Loading your Co-Pilot…</div>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_ROUTES.includes(pathname);

  useEffect(() => {
    if (!loading && !user && !isPublic) router.replace("/login");
    if (!loading && user && isPublic) router.replace("/");
  }, [loading, user, isPublic, router]);

  // Auth pages render standalone (no app chrome).
  if (isPublic) return <>{children}</>;

  if (loading || !user) return <Splash />;

  return (
    <CoPilotProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 pb-24 lg:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
        <BottomNav />
        <CoPilotWidget />
      </div>
    </CoPilotProvider>
  );
}
