"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, FileText, Truck, Users, MapPin, ShieldCheck, LogOut, Loader2, Check } from "lucide-react";
import { PageHeader, Loading, ErrorState } from "@/components/ui";
import { api, type CarrierDetail } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { logout } = useAuth();
  const { data, loading, error } = useApi(() => api.carrier(), []);
  const [form, setForm] = useState<CarrierDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!form) return <Loading />;

  function set<K extends keyof CarrierDetail>(k: K, v: CarrierDetail[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api.updateCarrier({
        companyName: form.companyName,
        dotNumber: form.dotNumber,
        mcNumber: form.mcNumber,
        insuranceProvider: form.insuranceProvider,
        insuranceExpiry: form.insuranceExpiry,
        w9OnFile: form.w9OnFile,
        serviceAreas: form.serviceAreas,
        mpg: form.mpg,
        fixedCostPerMile: form.fixedCostPerMile,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const docs = [
    { label: "MC Authority", ok: !!form.mcNumber },
    { label: "DOT Number", ok: !!form.dotNumber },
    { label: "Certificate of Insurance", ok: !!form.insuranceProvider },
    { label: "W-9", ok: form.w9OnFile },
  ];
  const completeness = Math.round((docs.filter((d) => d.ok).length / docs.length) * 100);

  return (
    <div>
      <PageHeader
        title="Company Profile"
        subtitle="Your carrier packet — auto-filled into every bid and broker setup."
        action={
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <BadgeCheck className="h-4 w-4" />}
              {saved ? "Saved" : "Save changes"}
            </button>
            <button onClick={logout} className="btn-ghost">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        }
      />

      <div className="mb-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-[260px] flex-1">
            <input
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              className="input text-lg font-bold"
            />
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <LabeledInput label="DOT #" value={form.dotNumber} onChange={(v) => set("dotNumber", v)} />
              <LabeledInput label="MC #" value={form.mcNumber} onChange={(v) => set("mcNumber", v)} />
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold text-success">{completeness}%</div>
            <div className="text-xs text-white/40">packet complete</div>
          </div>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full bg-success" style={{ width: `${completeness}%` }} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section icon={FileText} title="Compliance & Documents">
          <LabeledInput label="Insurance provider" value={form.insuranceProvider} onChange={(v) => set("insuranceProvider", v)} />
          <LabeledInput label="Insurance expiry" value={form.insuranceExpiry} onChange={(v) => set("insuranceExpiry", v)} />
          <label className="flex items-center justify-between py-2 text-sm">
            <span className="text-white/70">W-9 on file</span>
            <button
              onClick={() => set("w9OnFile", !form.w9OnFile)}
              className={`chip ${form.w9OnFile ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
            >
              {form.w9OnFile ? "On file" : "Needed"}
            </button>
          </label>
        </Section>

        <Section icon={Truck} title="Equipment">
          {form.equipment.length === 0 && <div className="py-2 text-sm text-white/40">No equipment on file yet.</div>}
          {form.equipment.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-white/70">
                {e.year} {e.type}
              </span>
              <span className="text-white/40">{e.unit}</span>
            </div>
          ))}
        </Section>

        <Section icon={Users} title="Drivers">
          {form.drivers.length === 0 && <div className="py-2 text-sm text-white/40">No drivers on file yet.</div>}
          {form.drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-white/70">
                {d.name} · {d.cdlClass}
              </span>
              <span className="chip bg-success/15 text-success">{d.status}</span>
            </div>
          ))}
        </Section>

        <Section icon={MapPin} title="Operating Economics">
          <div className="grid grid-cols-2 gap-3 pt-1 text-sm">
            <div>
              <label className="mb-1 block text-xs text-white/40">Fleet MPG</label>
              <input
                type="number"
                step="0.1"
                value={form.mpg}
                onChange={(e) => set("mpg", Number(e.target.value))}
                className="input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-white/40">Fixed cost / mile ($)</label>
              <input
                type="number"
                step="0.01"
                value={form.fixedCostPerMile}
                onChange={(e) => set("fixedCostPerMile", Number(e.target.value))}
                className="input"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-xs text-white/40">Service areas (comma-separated)</label>
            <input
              value={form.serviceAreas.join(", ")}
              onChange={(e) => set("serviceAreas", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              className="input"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {form.serviceAreas.map((s) => (
                <span key={s} className="chip bg-white/5 text-white/70">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block py-1">
      <span className="mb-1 block text-xs text-white/40">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input" />
    </label>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 text-electric" /> {title}
      </div>
      <div>{children}</div>
    </div>
  );
}
