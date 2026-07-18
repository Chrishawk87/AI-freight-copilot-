"use client";

import { useMemo, useState } from "react";
import {
  Brain,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Search,
  BookOpen,
  Loader2,
} from "lucide-react";
import { PageHeader, Loading, ErrorState } from "@/components/ui";
import { api, type MemoryEntry, type KnowledgeEntry } from "@/lib/api";
import { useApi } from "@/lib/useApi";

const MEM_CATEGORIES = [
  "preference",
  "lane",
  "cost",
  "broker",
  "equipment",
  "contact",
  "general",
];

const KB_CATEGORIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "trailers", label: "Trailers" },
  { id: "load-types", label: "Load types" },
  { id: "trucks", label: "Trucks" },
  { id: "documents", label: "Documents" },
  { id: "brokers", label: "Brokers" },
  { id: "shippers", label: "Shippers" },
  { id: "truck-stops", label: "Truck stops" },
  { id: "routes", label: "Routes" },
  { id: "regulations", label: "Regulations" },
  { id: "qa", label: "Q&A" },
];

export default function MemoryPage() {
  const [tab, setTab] = useState<"memory" | "knowledge">("memory");

  return (
    <div>
      <PageHeader
        title="Co-Pilot Memory"
        subtitle="Teach the brain once and it remembers — on every reply, even offline."
      />

      <div className="mb-5 flex gap-2">
        <TabButton active={tab === "memory"} onClick={() => setTab("memory")} icon={Brain}>
          What it knows about you
        </TabButton>
        <TabButton active={tab === "knowledge"} onClick={() => setTab("knowledge")} icon={BookOpen}>
          Freight knowledge base
        </TabButton>
      </div>

      {tab === "memory" ? <MemoryTab /> : <KnowledgeTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
        active
          ? "border-electric/50 bg-electric/10 text-white"
          : "border-white/10 text-white/60 hover:bg-white/5"
      }`}
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

// ── Surface: per-carrier memory ────────────────────────────────────────────────
function MemoryTab() {
  const mem = useApi(() => api.memory(), []);
  const [category, setCategory] = useState("preference");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function add() {
    if (!key.trim() || !value.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.addMemory({ category, key: key.trim(), value: value.trim(), pinned });
      setKey("");
      setValue("");
      setPinned(false);
      mem.reload();
    } catch (e: any) {
      setError(e.message || "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(m: MemoryEntry) {
    await api.updateMemory(m.id, { pinned: !m.pinned });
    mem.reload();
  }

  async function remove(id: string) {
    await api.deleteMemory(id);
    setConfirmId(null);
    mem.reload();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div>
        {mem.loading ? (
          <Loading />
        ) : mem.error ? (
          <ErrorState message={mem.error} />
        ) : mem.data && mem.data.length > 0 ? (
          <div className="grid gap-3">
            {mem.data.map((m) => (
              <div key={m.id} className="card flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <span className="chip bg-white/5">{m.category}</span>
                    {m.source === "copilot" && (
                      <span className="chip bg-electric/10 text-electric">learned by Co-Pilot</span>
                    )}
                    {m.pinned && <span className="chip bg-amber-500/10 text-amber-300">pinned</span>}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold">{m.key}</div>
                  <div className="mt-0.5 text-sm text-white/60">{m.value}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => togglePin(m)}
                    title={m.pinned ? "Unpin" : "Pin (always tell the brain)"}
                    className="rounded-lg border border-white/10 p-2 text-white/40 transition hover:text-amber-300"
                  >
                    {m.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </button>
                  {confirmId === m.id ? (
                    <>
                      <button
                        onClick={() => remove(m.id)}
                        className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs font-semibold text-danger transition hover:bg-danger/20"
                      >
                        Forget
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="rounded-lg border border-white/10 px-2.5 py-2 text-xs text-white/60 transition hover:bg-white/5"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmId(m.id)}
                      title="Forget this"
                      className="rounded-lg border border-white/10 p-2 text-white/40 transition hover:border-danger/40 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-10 text-center text-sm text-white/50">
            <Brain className="mx-auto mb-3 h-8 w-8 text-white/20" />
            Nothing taught yet. Add your home base, your real cost per mile, lanes you like,
            brokers you trust — the Co-Pilot will use it on every reply.
          </div>
        )}
      </div>

      <div className="card h-fit p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-electric" /> Teach the Co-Pilot
        </div>
        <label className="mb-1 block text-xs text-white/40">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        >
          {MEM_CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-navy-900">
              {c}
            </option>
          ))}
        </select>
        <label className="mb-1 block text-xs text-white/40">Label</label>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. Home base"
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs text-white/40">The fact</label>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Dallas, TX — prefer loads within 500 miles, no NYC"
          rows={3}
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-white/60">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin it — always tell the brain this
        </label>
        {error && <div className="mb-2 text-xs text-danger">{error}</div>}
        <button onClick={add} disabled={busy} className="btn-primary w-full justify-center">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save to memory"}
        </button>
      </div>
    </div>
  );
}

// ── Subsurface: shared freight knowledge base ──────────────────────────────────
function KnowledgeTab() {
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const kb = useApi<KnowledgeEntry[]>(
    () => api.knowledge({ category, q: q.trim() || undefined }),
    [category, q],
  );
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, KnowledgeEntry[]>();
    for (const e of kb.data || []) {
      const arr = map.get(e.category) || [];
      arr.push(e);
      map.set(e.category, arr);
    }
    return Array.from(map.entries());
  }, [kb.data]);

  async function remove(id: string) {
    await api.deleteKnowledge(id);
    setConfirmId(null);
    kb.reload();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the knowledge base…"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <button
          onClick={() => setAdding((s) => !s)}
          className="btn-primary shrink-0"
        >
          <Plus className="h-4 w-4" /> Add entry
        </button>
      </div>

      {!q && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {KB_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                category === c.id
                  ? "bg-electric/15 text-white ring-1 ring-electric/40"
                  : "bg-white/5 text-white/50 hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {adding && <AddKnowledge onDone={() => { setAdding(false); kb.reload(); }} />}

      {kb.loading ? (
        <Loading />
      ) : kb.error ? (
        <ErrorState message={kb.error} />
      ) : (kb.data || []).length === 0 ? (
        <div className="card p-10 text-center text-sm text-white/50">No entries match.</div>
      ) : (
        <div className="grid gap-5">
          {grouped.map(([cat, entries]) => (
            <div key={cat}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-white/40">
                {KB_CATEGORIES.find((c) => c.id === cat)?.label || cat}
              </h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {entries.map((e) => (
                  <div key={e.id} className="card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold">{e.topic}</div>
                      {e.scope !== "global" &&
                        (confirmId === e.id ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => remove(e.id)}
                              className="rounded-lg border border-danger/40 bg-danger/10 px-2 py-1 text-xs font-semibold text-danger transition hover:bg-danger/20"
                            >
                              Remove
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/60 transition hover:bg-white/5"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(e.id)}
                            title="Remove your entry"
                            className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition hover:border-danger/40 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ))}
                    </div>
                    <div className="mt-1 text-sm text-white/60">{e.content}</div>
                    {e.scope !== "global" && (
                      <span className="mt-2 inline-block chip bg-electric/10 text-electric">
                        your entry
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddKnowledge({ onDone }: { onDone: () => void }) {
  const [category, setCategory] = useState("qa");
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!topic.trim() || !content.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.addKnowledge({ category, topic: topic.trim(), content: content.trim() });
      onDone();
    } catch (e: any) {
      setError(e.message || "Couldn't save");
      setBusy(false);
    }
  }

  return (
    <div className="card mb-4 p-4">
      <div className="mb-3 text-sm font-semibold">Add to the knowledge base</div>
      <div className="grid gap-3 lg:grid-cols-[160px_1fr]">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        >
          {KB_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
            <option key={c.id} value={c.id} className="bg-navy-900">
              {c.label}
            </option>
          ))}
        </select>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic or question (e.g. 'What paperwork does XYZ broker want?')"
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="The answer / details the Co-Pilot should know."
        rows={3}
        className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
      />
      {error && <div className="mt-2 text-xs text-danger">{error}</div>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={busy} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save entry"}
        </button>
        <button onClick={onDone} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60">
          Cancel
        </button>
      </div>
    </div>
  );
}
