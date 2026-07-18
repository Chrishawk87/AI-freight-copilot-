"use client";

import { useState } from "react";
import Link from "next/link";
import { Truck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (e: any) {
      setErr(e.message || "Login failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-electric shadow-glow">
            <Truck className="h-7 w-7 text-white" />
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold tracking-tight">AI Freight Co-Pilot</div>
            <div className="text-sm text-white/50">Sign in to your dispatch desk</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@yourcompany.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
          </Field>

          {err && <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{err}</div>}

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
          </button>

          <div className="text-center text-xs text-white/40">
            Demo account is pre-filled — just hit sign in.
          </div>
        </form>

        <div className="mt-4 text-center text-sm text-white/50">
          New carrier?{" "}
          <Link href="/register" className="text-electric hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-white/40">{label}</span>
      {children}
    </label>
  );
}
