"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, FileText, Truck, Users, MapPin, ShieldCheck, LogOut, Loader2, Check, Gauge, ScanLine, Bot, Mail, Lock, CheckCircle2, Search, Trash2, Plus } from "lucide-react";
import { PageHeader, Loading, ErrorState } from "@/components/ui";
import { api, type CarrierDetail, type UsageMeter } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useAuth } from "@/lib/auth";

// Pick your provider once; we know the server settings. Business domains
// (your own @company.com) usually run on Google Workspace or Microsoft 365 —
// pick that, not "Other", unless your IT gave you a specific mail server.
const PROVIDERS = [
  { id: "gmail", label: "Gmail (@gmail.com)", host: "smtp.gmail.com", port: 465, secure: true },
  { id: "gworkspace", label: "Google Workspace (business Gmail on your own domain)", host: "smtp.gmail.com", port: 465, secure: true },
  { id: "outlook", label: "Outlook.com / Hotmail / Live", host: "smtp-mail.outlook.com", port: 587, secure: false },
  { id: "m365", label: "Microsoft 365 (business email on your own domain)", host: "smtp.office365.com", port: 587, secure: false },
  { id: "yahoo", label: "Yahoo", host: "smtp.mail.yahoo.com", port: 465, secure: true },
  { id: "aol", label: "AOL", host: "smtp.aol.com", port: 465, secure: true },
  { id: "icloud", label: "iCloud", host: "smtp.mail.me.com", port: 587, secure: false },
  { id: "other", label: "Other / custom mail server", host: "", port: 587, secure: false },
] as const;

// Consumer domains map straight to a provider so we can preselect it.
const DOMAIN_PROVIDER: Record<string, string> = {
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "outlook.com": "outlook",
  "hotmail.com": "outlook",
  "live.com": "outlook",
  "msn.com": "outlook",
  "yahoo.com": "yahoo",
  "aol.com": "aol",
  "icloud.com": "icloud",
  "me.com": "icloud",
};
function providerForEmail(email: string): string {
  const domain = (email.split("@")[1] || "").trim().toLowerCase();
  return DOMAIN_PROVIDER[domain] || "";
}
function providerForHost(host: string): string {
  if (!host) return "";
  const match = PROVIDERS.find((p) => p.host && p.host === host);
  return match ? match.id : "other";
}

// Common commercial-trucking insurers. If a carrier isn't listed, the user can
// pick "Other" and type it in.
const INSURERS = [
  "Progressive Commercial",
  "Great West Casualty",
  "Sentry Insurance",
  "Nationwide / National Interstate",
  "Northland (Travelers)",
  "Canal Insurance",
  "National Indemnity (Berkshire Hathaway)",
  "The Hartford",
  "Zurich North America",
  "Liberty Mutual",
  "Cincinnati Insurance",
  "Old Republic",
  "Acuity",
  "Carolina Casualty",
  "Lancer Insurance",
  "Prime Insurance",
  "Cover Whale",
  "RLI",
  "W.R. Berkley",
  "Markel",
  "Auto-Owners",
  "State Farm Commercial",
  "GEICO Commercial",
  "biBERK",
  "Knight Insurance",
];

// Common trailer/equipment types a carrier picks from when adding a unit.
const EQUIPMENT_TYPES = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Lowboy / RGN",
  "Power Only",
  "Box Truck",
  "Hotshot",
  "Tanker",
  "Conestoga",
  "Double Drop",
  "Car Hauler",
  "Dump",
  "Other",
];

const CDL_CLASSES = ["Class A", "Class B", "Class C"];
const DRIVER_STATUSES = ["Active", "Available", "On Load", "Off Duty", "Inactive"];

export default function ProfilePage() {
  const { logout } = useAuth();
  const { data, loading, error } = useApi(() => api.carrier(), []);
  const [form, setForm] = useState<CarrierDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [appPassword, setAppPassword] = useState(""); // never returned by API
  const [providerId, setProviderId] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [insuranceManual, setInsuranceManual] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupNote, setLookupNote] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [newEq, setNewEq] = useState({ type: EQUIPMENT_TYPES[0], unit: "", year: "" });
  const [newDrv, setNewDrv] = useState({ name: "", cdlClass: CDL_CLASSES[0] });

  useEffect(() => {
    if (data) {
      setForm(data);
      // Preselect the provider: from a saved server, else guessed from the email.
      setProviderId(
        providerForHost(data.smtpHost) || providerForEmail(data.contactEmail),
      );
      // If the saved insurer isn't one of the known options, drop into manual mode.
      setInsuranceManual(
        !!data.insuranceProvider && !INSURERS.includes(data.insuranceProvider),
      );
    }
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!form) return <Loading />;

  function set<K extends keyof CarrierDetail>(k: K, v: CarrierDetail[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  }

  const isOther = providerId === "other";

  // Resolve the SMTP server from the chosen provider (deterministic), or the
  // manual fields when "Other" is selected — guaranteeing a real server is
  // stored even for custom company domains.
  function buildEmailCfg(f: CarrierDetail) {
    const chosen = PROVIDERS.find((p) => p.id === providerId);
    if (isOther) {
      return {
        smtpHost: f.smtpHost,
        smtpPort: f.smtpPort,
        smtpSecure: f.smtpSecure,
        smtpUser: f.smtpUser || f.contactEmail,
      };
    }
    if (chosen) {
      return {
        smtpHost: chosen.host,
        smtpPort: chosen.port,
        smtpSecure: chosen.secure,
        smtpUser: f.contactEmail,
      };
    }
    return { smtpUser: f.contactEmail };
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveErr("");
    try {
      const updated = await api.updateCarrier({
        companyName: form.companyName,
        contactEmail: form.contactEmail,
        dotNumber: form.dotNumber,
        mcNumber: form.mcNumber,
        insuranceProvider: form.insuranceProvider,
        insuranceExpiry: form.insuranceExpiry,
        w9OnFile: form.w9OnFile,
        serviceAreas: form.serviceAreas,
        mpg: form.mpg,
        fixedCostPerMile: form.fixedCostPerMile,
        ...buildEmailCfg(form),
        ...(appPassword ? { smtpPass: appPassword } : {}),
      });
      setForm(updated);
      setProviderId(
        providerForHost(updated.smtpHost) || providerForEmail(updated.contactEmail),
      );
      setAppPassword("");
      setSaved(true);
    } catch (e: any) {
      setSaveErr(e?.message || "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Dedicated save for JUST the email connection, so changing your send-from
  // address is one obvious click with its own confirmation.
  async function saveEmail() {
    if (!form) return;
    setEmailErr("");
    setEmailSaved(false);
    const email = form.contactEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailErr("Enter a valid email address.");
      return;
    }
    if (!providerId) {
      setEmailErr("Pick your email provider.");
      return;
    }
    setEmailSaving(true);
    try {
      const updated = await api.updateCarrier({
        contactEmail: email,
        ...buildEmailCfg(form),
        ...(appPassword ? { smtpPass: appPassword } : {}),
      });
      setForm(updated);
      setProviderId(
        providerForHost(updated.smtpHost) || providerForEmail(updated.contactEmail),
      );
      setAppPassword("");
      setEmailSaved(true);
    } catch (e: any) {
      setEmailErr(e?.message || "Could not save your email.");
    } finally {
      setEmailSaving(false);
    }
  }

  // Pull registration details from the FMCSA registry and pre-fill the profile.
  // Fields land in the form (editable); the user still clicks "Save changes".
  async function runLookup() {
    if (!form) return;
    setLookupErr("");
    setLookupNote("");
    const dot = form.dotNumber.trim();
    const mc = form.mcNumber.trim();
    if (!dot && !mc) {
      setLookupErr("Enter your DOT # (or MC #) first, then look up.");
      return;
    }
    setLookupBusy(true);
    try {
      const r = await api.lookupCarrier(dot ? { dot } : { mc });
      setForm((f) =>
        f
          ? {
              ...f,
              companyName: r.companyName || f.companyName,
              dotNumber: r.dotNumber || f.dotNumber,
              mcNumber: r.mcNumber || f.mcNumber,
              serviceAreas:
                r.phyState && !f.serviceAreas.includes(r.phyState)
                  ? [...f.serviceAreas, r.phyState]
                  : f.serviceAreas,
            }
          : f,
      );
      setSaved(false);
      const bits: string[] = [];
      if (r.powerUnits) bits.push(`${r.powerUnits} power unit${r.powerUnits === 1 ? "" : "s"}`);
      if (r.drivers) bits.push(`${r.drivers} driver${r.drivers === 1 ? "" : "s"}`);
      setLookupNote(
        `Found ${r.companyName || "carrier"}${bits.length ? ` — FMCSA lists ${bits.join(" and ")}. Add them below.` : "."} Review, then Save changes.`,
      );
    } catch (e: any) {
      setLookupErr(e?.message || "Lookup failed. Check the number and try again.");
    } finally {
      setLookupBusy(false);
    }
  }

  // ---- Equipment / driver roster (mutations persist immediately) ----
  async function addEquipmentRow() {
    if (!newEq.type) return;
    setRosterBusy(true);
    try {
      const updated = await api.addEquipment({
        type: newEq.type,
        unit: newEq.unit.trim(),
        year: newEq.year ? Number(newEq.year) : undefined,
      });
      setForm(updated);
      setNewEq({ type: EQUIPMENT_TYPES[0], unit: "", year: "" });
    } catch {
      /* surfaced via disabled state; keep inputs for retry */
    } finally {
      setRosterBusy(false);
    }
  }
  async function removeEquipmentRow(id: string) {
    setRosterBusy(true);
    try {
      setForm(await api.removeEquipment(id));
    } finally {
      setRosterBusy(false);
    }
  }
  async function addDriverRow() {
    if (!newDrv.name.trim()) return;
    setRosterBusy(true);
    try {
      const updated = await api.addDriver({
        name: newDrv.name.trim(),
        cdlClass: newDrv.cdlClass,
      });
      setForm(updated);
      setNewDrv({ name: "", cdlClass: CDL_CLASSES[0] });
    } finally {
      setRosterBusy(false);
    }
  }
  async function removeDriverRow(id: string) {
    setRosterBusy(true);
    try {
      setForm(await api.removeDriver(id));
    } finally {
      setRosterBusy(false);
    }
  }
  async function cycleDriverStatus(id: string, current: string) {
    const next =
      DRIVER_STATUSES[(DRIVER_STATUSES.indexOf(current) + 1) % DRIVER_STATUSES.length];
    setRosterBusy(true);
    try {
      setForm(await api.updateDriver(id, { status: next }));
    } finally {
      setRosterBusy(false);
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={runLookup}
                disabled={lookupBusy}
                className="btn-ghost flex items-center gap-1.5 text-xs"
              >
                {lookupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                Look up my DOT
              </button>
              <span className="text-xs text-white/40">
                Auto-fills your company from the FMCSA registry.
              </span>
            </div>
            {lookupErr && <p className="mt-2 text-xs text-danger">{lookupErr}</p>}
            {lookupNote && !lookupErr && (
              <p className="mt-2 text-xs text-success">{lookupNote}</p>
            )}
            <div className="mt-2 text-xs text-white/40">
              Send-from email:{" "}
              <span className="text-white/70">{form.contactEmail || "not set"}</span>{" "}
              — set it under “Send email” below.
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

      {/* Connect your own email so document packages send straight from your inbox. */}
      <div className="mb-5 card p-5">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <Mail className="h-4 w-4 text-electric" /> Send email
          {form.emailConnected && !appPassword && (
            <span className="chip ml-1 flex items-center gap-1 bg-success/15 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
            </span>
          )}
        </div>
        <p className="mb-4 text-xs leading-relaxed text-white/40">
          Connect your own email and the app sends document packages straight to
          brokers and factoring from your inbox. Pick your provider, enter your
          address and a one-time app password.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block py-1 sm:col-span-2">
            <span className="mb-1 block text-xs text-white/40">Email provider</span>
            <select
              value={providerId}
              onChange={(e) => {
                setProviderId(e.target.value);
                setSaved(false);
              }}
              className="input"
            >
              <option value="">Select your provider…</option>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <LabeledInput
            label="Your email address"
            value={form.contactEmail}
            onChange={(v) => {
              set("contactEmail", v);
              setEmailSaved(false);
              setEmailErr("");
            }}
          />
          <label className="block py-1">
            <span className="mb-1 flex items-center gap-1 text-xs text-white/40">
              <Lock className="h-3 w-3" /> App password
            </span>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => {
                setAppPassword(e.target.value);
                setSaved(false);
                setEmailSaved(false);
              }}
              placeholder={form.emailConnected ? "•••••••• (leave blank to keep)" : "app password"}
              className="input"
            />
          </label>
        </div>

        {isOther && (
          <div className="mt-3 grid gap-3 rounded-xl bg-white/[0.02] p-3 sm:grid-cols-2">
            <p className="text-[11px] leading-relaxed text-white/40 sm:col-span-2">
              Enter the outgoing (SMTP) server your email host gave you.
            </p>
            <LabeledInput label="SMTP host" value={form.smtpHost} onChange={(v) => set("smtpHost", v)} />
            <div>
              <label className="mb-1 block text-xs text-white/40">Port</label>
              <input
                type="number"
                value={form.smtpPort}
                onChange={(e) => set("smtpPort", Number(e.target.value))}
                className="input"
              />
            </div>
            <LabeledInput label="SMTP username" value={form.smtpUser} onChange={(v) => set("smtpUser", v)} />
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input
                type="checkbox"
                checked={form.smtpSecure}
                onChange={(e) => set("smtpSecure", e.target.checked)}
                className="h-4 w-4 accent-electric"
              />
              Use TLS on port 465
            </label>
          </div>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Gmail, Yahoo, Outlook, Google Workspace and Microsoft 365 need a one-time{" "}
          <span className="text-white/60">app password</span> (from your email
          account&apos;s security settings) — not your normal login password.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={saveEmail} disabled={emailSaving} className="btn-primary">
            {emailSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : emailSaved ? (
              <Check className="h-4 w-4" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            {emailSaved ? "Email saved" : "Save email"}
          </button>
          {emailErr && <span className="text-xs text-danger">{emailErr}</span>}
          {emailSaved && !emailErr && (
            <span className="text-xs text-success">
              Your send-from address is now {form.contactEmail}.
            </span>
          )}
        </div>

        {saveErr && (
          <p className="mt-3 text-xs text-danger">{saveErr}</p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section icon={FileText} title="Compliance & Documents">
          <label className="block py-1">
            <span className="mb-1 block text-xs text-white/40">Insurance provider</span>
            <select
              value={insuranceManual ? "__other__" : form.insuranceProvider}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__other__") {
                  setInsuranceManual(true);
                  set("insuranceProvider", "");
                } else {
                  setInsuranceManual(false);
                  set("insuranceProvider", v);
                }
              }}
              className="input"
            >
              <option value="">Select your insurer…</option>
              {INSURERS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="__other__">Other — enter manually</option>
            </select>
          </label>
          {insuranceManual && (
            <LabeledInput
              label="Insurer name"
              value={form.insuranceProvider}
              onChange={(v) => set("insuranceProvider", v)}
            />
          )}
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
            <div key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="text-white/70">
                {e.year} {e.type}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-white/40">{e.unit}</span>
                <button
                  onClick={() => removeEquipmentRow(e.id)}
                  disabled={rosterBusy}
                  className="text-white/40 hover:text-danger"
                  aria-label="Remove equipment"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
            <select
              value={newEq.type}
              onChange={(e) => setNewEq((s) => ({ ...s, type: e.target.value }))}
              className="input col-span-2"
            >
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              value={newEq.unit}
              onChange={(e) => setNewEq((s) => ({ ...s, unit: e.target.value }))}
              placeholder="Unit # (optional)"
              className="input"
            />
            <input
              value={newEq.year}
              onChange={(e) => setNewEq((s) => ({ ...s, year: e.target.value.replace(/\D/g, "") }))}
              placeholder="Year"
              inputMode="numeric"
              className="input"
            />
            <button
              onClick={addEquipmentRow}
              disabled={rosterBusy}
              className="btn-ghost col-span-2 flex items-center justify-center gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add equipment
            </button>
          </div>
        </Section>

        <Section icon={Users} title="Drivers">
          {form.drivers.length === 0 && <div className="py-2 text-sm text-white/40">No drivers on file yet.</div>}
          {form.drivers.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="text-white/70">
                {d.name} · {d.cdlClass}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => cycleDriverStatus(d.id, d.status)}
                  disabled={rosterBusy}
                  className="chip bg-success/15 text-success"
                  title="Click to change status"
                >
                  {d.status}
                </button>
                <button
                  onClick={() => removeDriverRow(d.id)}
                  disabled={rosterBusy}
                  className="text-white/40 hover:text-danger"
                  aria-label="Remove driver"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3">
            <input
              value={newDrv.name}
              onChange={(e) => setNewDrv((s) => ({ ...s, name: e.target.value }))}
              placeholder="Driver name"
              className="input col-span-2"
            />
            <select
              value={newDrv.cdlClass}
              onChange={(e) => setNewDrv((s) => ({ ...s, cdlClass: e.target.value }))}
              className="input"
            >
              {CDL_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={addDriverRow}
              disabled={rosterBusy || !newDrv.name.trim()}
              className="btn-ghost flex items-center justify-center gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add driver
            </button>
          </div>
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

      <UsageCard />
    </div>
  );
}

// This month's company-paid AI usage for the tenant, so the operator can see how
// much of the shared OCR / Co-Pilot allowance is being consumed.
function UsageCard() {
  const { data, loading } = useApi(() => api.usage(), []);
  if (loading || !data) return null;

  const period = new Date(data.periodStart).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mt-5 card p-5">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Gauge className="h-4 w-4 text-electric" /> AI Usage — {period}
      </div>
      <p className="mb-4 text-xs text-white/40">
        Company-paid scans and Co-Pilot replies on your subscription. Anything you
        run on your own key doesn&apos;t count here.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Meter icon={ScanLine} label="Document scans" meter={data.ocr} />
        <Meter icon={Bot} label="Co-Pilot replies" meter={data.copilot} />
      </div>
    </div>
  );
}

function Meter({
  icon: Icon,
  label,
  meter,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  meter: UsageMeter;
}) {
  const pct = meter.cap ? Math.min(100, Math.round((meter.used / meter.cap) * 100)) : 0;
  const barColor = meter.overCap ? "bg-warning" : pct >= 80 ? "bg-amber-400" : "bg-electric";
  return (
    <div className="rounded-xl bg-white/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Icon className="h-4 w-4 text-white/50" /> {label}
        </div>
        <div className="text-sm font-bold">
          {meter.used.toLocaleString()}
          <span className="text-white/40">
            {meter.cap ? ` / ${meter.cap.toLocaleString()}` : " used"}
          </span>
        </div>
      </div>
      {meter.cap ? (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 text-[11px] text-white/40">
            {meter.overCap
              ? "Cap reached — extra calls fall back to the free engine until next month."
              : `${(meter.remaining ?? 0).toLocaleString()} left this month`}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-white/40">No cap set — unlimited on your plan.</div>
      )}
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
