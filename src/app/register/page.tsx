"use client";

import { useState } from "react";
import Link from "next/link";
import { Truck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

const ROLES = [
  { value: "owner_operator", label: "Owner-Operator" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "fleet_manager", label: "Fleet Manager" },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    email: "",
    password: "",
    role: "owner_operator",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await register(form);
    } catch (e: any) {
      setErr(e.message || "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-electric shadow-glow">
            <Truck className="h-7 w-7 text-white" />
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold tracking-tight">Create your account</div>
            <div className="text-sm text-white/50">Start scoring loads in minutes</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <Field label="Your name">
            <input value={form.name} onChange={(e) => set("name", e.target.value)} className="input" required minLength={2} />
          </Field>
          <Field label="Company name">
            <input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} className="input" required minLength={2} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="input" required />
          </Field>
          <Field label="Password">
            <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} className="input" required minLength={6} />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => set("role", e.target.value)} className="input">
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>

          {err && <div className="rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">{err}</div>}

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-white/50">
          Already have an account?{" "}
          <Link href="/login" className="text-electric hover:underline">
            Sign in
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
