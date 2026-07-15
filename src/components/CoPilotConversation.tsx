"use client";

// Presentational conversation view shared by the full-screen Co-Pilot page and
// the floating panel that appears on every other tab. All state comes from the
// global CoPilotProvider, so both views show the exact same live conversation.

import { useEffect, useRef } from "react";
import { Bot, Send, User, Loader2, Mic, Check, CircleDashed } from "lucide-react";
import { money } from "./ui";
import { useCoPilot } from "@/lib/copilot-context";

export default function CoPilotConversation({ variant = "full" }: { variant?: "full" | "panel" }) {
  const { msgs, input, setInput, busy, handsFree, voice, send } = useCoPilot();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    return () => clearTimeout(id);
  }, [msgs, busy, voice.partial]);

  return (
    <div className={variant === "full" ? "flex h-full flex-col" : "flex h-full min-h-0 flex-col"}>
      <div className="card flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  m.role === "ai" ? "bg-electric/20" : "bg-white/10"
                }`}
              >
                {m.role === "ai" ? <Bot className="h-4 w-4 text-electric" /> : <User className="h-4 w-4" />}
              </div>
              <div className={`max-w-[85%] ${m.role === "user" ? "text-right" : ""}`}>
                <div
                  className={`inline-block rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === "ai" ? "bg-navy-700 text-white/90" : "bg-electric text-white"
                  }`}
                >
                  {m.text}
                </div>

                {m.steps && m.steps.length > 0 && (
                  <div className="mt-2 space-y-1.5 rounded-xl border border-white/10 bg-navy-800/60 p-3 text-left">
                    {m.steps.map((s, si) => (
                      <div key={si} className="flex items-center gap-2 text-xs">
                        {s.simulated ? (
                          <CircleDashed className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        ) : (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        )}
                        <span className={s.simulated ? "text-white/60" : "text-white/85"}>{s.label}</span>
                        {s.simulated && (
                          <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            simulated
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {m.loads && m.loads.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {m.loads.map((l) => (
                      <div key={l.id} className="rounded-xl border border-white/10 bg-navy-800/60 p-3 text-left text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">
                            {l.originCity}, {l.originState} → {l.destCity}, {l.destState}
                          </span>
                          <span
                            className="font-bold"
                            style={{ color: l.overall >= 72 ? "#16C784" : l.overall >= 48 ? "#F59E0B" : "#EF4444" }}
                          >
                            {l.overall}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-white/50">
                          <span>{l.equipment}</span>
                          <span>{money(l.rate)}</span>
                          <span>${l.allInRpm.toFixed(2)}/mi</span>
                          <span style={{ color: l.netProfit >= 0 ? "#16C784" : "#EF4444" }}>net {money(l.netProfit)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {m.followups && m.followups.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.followups.map((f) => (
                      <button
                        key={f}
                        onClick={() => send(f)}
                        disabled={busy}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/5 disabled:opacity-50"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {(busy || (voice.listening && !!voice.partial)) && (
            <div className="flex gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-electric/20">
                <Bot className="h-4 w-4 text-electric" />
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl bg-navy-700 px-4 py-2.5 text-sm text-white/60">
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5 animate-pulse text-electric" />
                    {voice.partial}
                  </>
                )}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={handsFree ? 'Say "hey co-pilot", or type…' : "Ask your Co-Pilot…"}
          className="flex-1 rounded-xl border border-white/10 bg-navy-800/70 px-4 py-3 text-sm outline-none focus:border-electric/50"
        />
        <button type="submit" disabled={busy} className="btn-primary h-11 w-11 !px-0">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
