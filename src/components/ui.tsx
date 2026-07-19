import clsx from "clsx";
import type { ReactNode } from "react";
import { Loader2, AlertTriangle } from "lucide-react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/40">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center text-sm text-white/60">
      <AlertTriangle className="h-6 w-6 text-warning" />
      <div>{message}</div>
      <div className="text-xs text-white/40">
        Make sure the API is running on port 4000 (npm run start:dev in /server).
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-white/50">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function scoreColor(v: number) {
  if (v >= 75) return "#16C784";
  if (v >= 50) return "#F59E0B";
  return "#EF4444";
}

export function ScoreRing({
  value,
  size = 64,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  const color = scoreColor(value);
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          fill="none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-sm font-bold" style={{ color }}>
          {value}
        </span>
        {label && (
          <span className="mt-0.5 text-[8px] uppercase tracking-wide text-white/40">{label}</span>
        )}
      </div>
    </div>
  );
}

export function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = scoreColor(value);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-white/50">{label}</span>
        <span className="font-semibold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-extrabold" style={accent ? { color: accent } : {}}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-white/50">{sub}</div>}
    </div>
  );
}

export function RecBadge({ rec }: { rec: "Accept" | "Consider" | "Avoid" }) {
  const map = {
    Accept: "bg-success/15 text-success ring-1 ring-success/30",
    Consider: "bg-warning/15 text-warning ring-1 ring-warning/30",
    Avoid: "bg-danger/15 text-danger ring-1 ring-danger/30",
  };
  return <span className={clsx("chip", map[rec])}>{rec}</span>;
}

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
