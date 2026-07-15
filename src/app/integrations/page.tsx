"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Check,
  Plug,
  Truck,
  Radio,
  Calculator,
  PackageCheck,
  Fuel,
  Wrench,
  Navigation,
  AudioLines,
  Brain,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui";
import clsx from "clsx";
import {
  PLUGINS_KEY as STORAGE_KEY_SHARED,
  PLUGIN_KEYS_KEY,
  readKeys,
  type KeyMap,
} from "@/lib/plugins";

type Plugin = {
  id: string;
  name: string;
  category: string;
  blurb: string;
  status?: "beta" | "soon";
  // If set, connecting this plugin reveals a field for the client's own API key.
  needsKey?: boolean;
  keyHint?: string;
  // An optional second, non-secret field (e.g. a chosen voice ID) shown once
  // connected. Stored under its own key id in the same key map.
  extraField?: { id: string; label: string; hint: string };
};

type Category = {
  key: string;
  label: string;
  icon: LucideIcon;
  desc: string;
};

const CATEGORIES: Category[] = [
  { key: "loadboards", label: "Load Boards", icon: Truck, desc: "Find and book freight" },
  { key: "gps", label: "Truck GPS & Navigation", icon: Navigation, desc: "Truck-legal routing and turn-by-turn" },
  { key: "telematics", label: "ELD & Telematics", icon: Radio, desc: "Hours of service, tracking, diagnostics" },
  { key: "accounting", label: "Accounting & Payments", icon: Calculator, desc: "Invoicing, factoring, expenses" },
  { key: "lastmile", label: "Last-Mile & Delivery", icon: PackageCheck, desc: "On-demand and local delivery gigs" },
  { key: "fuel", label: "Fuel & Savings", icon: Fuel, desc: "Discounts and station networks" },
  { key: "maintenance", label: "Fleet & Maintenance", icon: Wrench, desc: "Service, parts, and asset tracking" },
  { key: "voice", label: "Co-Pilot Voice", icon: AudioLines, desc: "Give your Co-Pilot a real human voice" },
  { key: "brain", label: "Co-Pilot Brain", icon: Brain, desc: "Upgrade your Co-Pilot's reasoning with Claude" },
];

const PLUGINS: Plugin[] = [
  { id: "dat", name: "DAT", category: "loadboards", blurb: "The largest load board network in North America.", status: "beta" },
  { id: "truckstop", name: "Truckstop", category: "loadboards", blurb: "Load board, rate insights, and broker credit checks.", status: "beta" },
  { id: "truckerpath", name: "Trucker Path", category: "loadboards", blurb: "Loads, parking, weigh stations, and truck-safe routing.", status: "beta" },

  { id: "trimble", name: "Trimble Maps", category: "gps", blurb: "PC*MILER truck-legal routing and mileage. Connect your key and the Maps screen switches to Trimble automatically.", status: "beta", needsKey: true, keyHint: "Trimble Maps API key" },
  { id: "googlemaps", name: "Google Maps", category: "gps", blurb: "Google Maps engine for the in-app map. Add your Maps JavaScript API key to power it.", status: "beta", needsKey: true, keyHint: "Google Maps API key" },
  { id: "herewego", name: "HERE Maps", category: "gps", blurb: "HERE navigation with truck attributes (dimensions, weight, hazmat).", status: "beta", needsKey: true, keyHint: "HERE API key" },
  { id: "hammer", name: "Hammer GPS", category: "gps", blurb: "Truck-safe GPS routing (Hammer Trucking).", status: "soon" },
  { id: "truckmap", name: "TruckMap", category: "gps", blurb: "Truck routing, fuel, parking, and weigh stations.", status: "soon" },
  { id: "copilot", name: "CoPilot Truck GPS", category: "gps", blurb: "Commercial truck navigation by Trimble.", status: "soon" },
  { id: "sygic", name: "Sygic Truck", category: "gps", blurb: "Truck & RV navigation with offline maps.", status: "soon" },
  { id: "smarttruckroute", name: "SmartTruckRoute", category: "gps", blurb: "Live truck-legal routing by TeleType.", status: "soon" },
  { id: "ptv", name: "PTV Navigator", category: "gps", blurb: "Professional truck routing and logistics.", status: "soon" },
  { id: "motive", name: "Motive", category: "telematics", blurb: "ELD, dash cams, and fleet management (formerly KeepTruckin).", status: "beta" },
  { id: "geotab", name: "Geotab", category: "telematics", blurb: "GPS tracking and vehicle telematics.", status: "soon" },
  { id: "samsara", name: "Samsara", category: "telematics", blurb: "Connected operations: ELD, cameras, and diagnostics.", status: "soon" },
  { id: "quickbooks", name: "QuickBooks", category: "accounting", blurb: "Sync loads to invoices, expenses, and profit reports.", status: "beta" },
  { id: "mudflap", name: "Mudflap", category: "fuel", blurb: "Instant diesel discounts at thousands of stations.", status: "soon" },
  { id: "pilot", name: "Pilot Flying J", category: "fuel", blurb: "myRewards Plus loyalty pricing and station data.", status: "soon" },
  { id: "loves", name: "Love's", category: "fuel", blurb: "Love's Connect fuel savings and amenities.", status: "soon" },
  { id: "roadie", name: "Roadie", category: "lastmile", blurb: "On-demand delivery marketplace by UPS.", status: "beta" },
  { id: "bungii", name: "Bungii", category: "lastmile", blurb: "Big & bulky local delivery on demand.", status: "soon" },
  { id: "senpex", name: "Senpex", category: "lastmile", blurb: "Same-day courier and route delivery.", status: "soon" },
  { id: "fleetio", name: "Fleetio", category: "maintenance", blurb: "Maintenance schedules, work orders, and parts.", status: "beta" },

  { id: "elevenlabs", name: "ElevenLabs", category: "voice", blurb: "Swap the built-in voice for a genuinely human one. Paste your ElevenLabs API key. Heads up: free ElevenLabs plans can't use the stock voices over the API — add your own voice in your ElevenLabs library and paste its Voice ID below, or upgrade your plan.", status: "beta", needsKey: true, keyHint: "ElevenLabs API key", extraField: { id: "elevenlabs_voice", label: "Voice ID", hint: "ElevenLabs Voice ID (optional)" } },

  { id: "anthropic", name: "Claude (Anthropic)", category: "brain", blurb: "Give your Co-Pilot Claude's brain — it reasons, researches, and talks like a real co-driver instead of a script. Paste your own Anthropic API key. It stays on THIS device only and bills only your usage — nobody else's. Without a key the Co-Pilot still runs on the free built-in brain.", status: "beta", needsKey: true, keyHint: "Anthropic API key (sk-ant-…)", extraField: { id: "anthropic_model", label: "Model (optional)", hint: "e.g. claude-haiku-4-5-20251001" } },
];

const STORAGE_KEY = STORAGE_KEY_SHARED;

// Honest state per integration. Nothing pulls live data until its API is wired,
// so we only advertise what's actually available today.
const STATUS_STYLE: Record<string, string> = {
  beta: "bg-electric/15 text-electric ring-1 ring-electric/30",
  soon: "bg-white/10 text-white/50 ring-1 ring-white/15",
};

const STATUS_LABEL: Record<string, string> = {
  beta: "Available",
  soon: "Coming soon",
};

function initials(name: string) {
  return name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function IntegrationsPage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<KeyMap>({});
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEnabled(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setKeys(readKeys());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
  }, [enabled, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(PLUGIN_KEYS_KEY, JSON.stringify(keys));
  }, [keys, hydrated]);

  function toggle(id: string) {
    setEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setKey(id: string, value: string) {
    setKeys((prev) => {
      const next = { ...prev };
      if (value.trim()) next[id] = value.trim();
      else delete next[id];
      return next;
    });
  }

  const enabledCount = useMemo(
    () => PLUGINS.filter((p) => enabled[p.id]).length,
    [enabled]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLUGINS;
    return PLUGINS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div>
      <PageHeader
        title="Plugin Engine"
        subtitle="Connect the apps you already use. Everything shows up inside one interface — no app-switching."
      />

      {/* Hero / value banner */}
      <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 border-electric/25 bg-electric/5 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-electric shadow-glow">
            <Plug className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold">One app. All your tools.</div>
            <div className="text-xs text-white/50">
              Turn on the services you use. Live data sync rolls out per integration as each
              provider is connected — “Available” apps are wired up first.
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold text-electric">{enabledCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            of {PLUGINS.length} connected
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search integrations…"
          className="input w-full pl-9"
        />
      </div>

      {query.trim() ? (
        <PluginGrid plugins={filtered} enabled={enabled} keys={keys} onToggle={toggle} onSetKey={setKey} />
      ) : (
        CATEGORIES.map((cat) => {
          const items = PLUGINS.filter((p) => p.category === cat.key);
          if (!items.length) return null;
          const Icon = cat.icon;
          return (
            <section key={cat.key} className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <Icon className="h-[18px] w-[18px] text-electric" />
                <h2 className="text-base font-bold">{cat.label}</h2>
                <span className="text-xs text-white/40">— {cat.desc}</span>
              </div>
              <PluginGrid plugins={items} enabled={enabled} keys={keys} onToggle={toggle} onSetKey={setKey} />
            </section>
          );
        })
      )}

      {query.trim() && !filtered.length && (
        <div className="card p-10 text-center text-sm text-white/50">
          No integrations match “{query}”.
        </div>
      )}
    </div>
  );
}

function PluginGrid({
  plugins,
  enabled,
  keys,
  onToggle,
  onSetKey,
}: {
  plugins: Plugin[];
  enabled: Record<string, boolean>;
  keys: KeyMap;
  onToggle: (id: string) => void;
  onSetKey: (id: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {plugins.map((p) => {
        const on = !!enabled[p.id];
        const hasKey = !!keys[p.id]?.trim();
        return (
          <div
            key={p.id}
            className={clsx(
              "card flex flex-col gap-3 p-4 transition",
              on ? "ring-1 ring-electric/40" : ""
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={clsx(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold",
                    on ? "bg-electric text-white" : "bg-white/10 text-white/70"
                  )}
                >
                  {initials(p.name)}
                </div>
                <div className="leading-tight">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {p.name}
                    {p.needsKey && on && hasKey ? (
                      <span className="chip bg-success/15 px-2 py-0.5 text-[10px] text-success ring-1 ring-success/30">
                        Connected
                      </span>
                    ) : (
                      p.status && (
                        <span
                          className={clsx("chip px-2 py-0.5 text-[10px]", STATUS_STYLE[p.status])}
                        >
                          {STATUS_LABEL[p.status]}
                        </span>
                      )
                    )}
                  </div>
                </div>
              </div>
              <ToggleSwitch on={on} onClick={() => onToggle(p.id)} label={p.name} />
            </div>
            <p className="text-xs leading-relaxed text-white/50">{p.blurb}</p>
            {p.needsKey && on && (
              <KeyField
                value={keys[p.id] ?? ""}
                hint={p.keyHint ?? "API key"}
                onSave={(v) => onSetKey(p.id, v)}
              />
            )}
            {p.extraField && on && (
              <PlainField
                label={p.extraField.label}
                value={keys[p.extraField.id] ?? ""}
                hint={p.extraField.hint}
                onSave={(v) => onSetKey(p.extraField!.id, v)}
              />
            )}
            {p.id === "elevenlabs" && on && (
              <ElevenTest
                apiKey={keys["elevenlabs"] ?? ""}
                voiceId={keys["elevenlabs_voice"] ?? ""}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function KeyField({
  value,
  hint,
  onSave,
}: {
  value: string;
  hint: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const saved = !!value.trim();
  const dirty = draft.trim() !== value.trim();

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Paste your ${hint}`}
          className="input h-9 flex-1 text-xs"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className={clsx("btn-primary h-9 px-3 text-xs", !dirty && "cursor-not-allowed opacity-50")}
        >
          {saved ? "Update" : "Save"}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-white/40">
        {saved
          ? "Key saved on this device only — never sent to our servers."
          : "Stored only on your device, never in our system."}
      </div>
    </div>
  );
}

// The default ElevenLabs voice (Rachel). Only usable on paid plans via the API.
const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

// A one-click check so the driver knows immediately whether their key + voice
// actually work — without hunting through the Co-Pilot screen to find out.
function ElevenTest({ apiKey, voiceId }: { apiKey: string; voiceId: string }) {
  const [state, setState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    if (!apiKey.trim()) {
      setState("fail");
      setMsg("Paste your API key first.");
      return;
    }
    setState("testing");
    setMsg("");
    const id = voiceId.trim() || ELEVEN_DEFAULT_VOICE;
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey.trim(),
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: "Hey, your co-pilot's talking now. This is the voice you'll hear on the road.",
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
        }),
      });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        setState("ok");
        setMsg("That's your voice — you're all set. It'll speak in the Co-Pilot now.");
        return;
      }
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.detail?.message || body?.detail?.status || "";
      } catch {
        /* ignore */
      }
      setState("fail");
      if (res.status === 402 || /paid_plan|payment/i.test(detail)) {
        setMsg(
          "Your ElevenLabs plan can't use this voice over the API. Either upgrade your ElevenLabs plan, or add a voice you own in your ElevenLabs library and paste its Voice ID above.",
        );
      } else if (res.status === 401) {
        setMsg("That key was rejected. Double-check you pasted it correctly.");
      } else {
        setMsg(`ElevenLabs said no (${res.status}). ${detail}`.trim());
      }
    } catch (e: any) {
      setState("fail");
      setMsg(`Couldn't reach ElevenLabs. ${e?.message ?? ""}`.trim());
    }
  }

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "testing"}
        className={clsx(
          "btn-primary h-9 w-full text-xs",
          state === "testing" && "cursor-wait opacity-70",
        )}
      >
        {state === "testing" ? "Testing…" : "Test voice"}
      </button>
      {msg && (
        <div
          className={clsx(
            "mt-1.5 text-[11px] leading-relaxed",
            state === "ok" ? "text-success" : "text-amber-400",
          )}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

function PlainField({
  label,
  value,
  hint,
  onSave,
}: {
  label: string;
  value: string;
  hint: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value.trim();

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hint}
          className="input h-9 flex-1 text-xs"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className={clsx("btn-primary h-9 px-3 text-xs", !dirty && "cursor-not-allowed opacity-50")}
        >
          {value.trim() ? "Update" : "Save"}
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Disconnect" : "Connect"} ${label}`}
      onClick={onClick}
      className={clsx(
        "relative h-6 w-11 shrink-0 rounded-full transition",
        on ? "bg-electric" : "bg-white/15"
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white transition-all",
          on ? "left-[22px]" : "left-0.5"
        )}
      >
        {on && <Check className="h-3 w-3 text-electric" />}
      </span>
    </button>
  );
}
