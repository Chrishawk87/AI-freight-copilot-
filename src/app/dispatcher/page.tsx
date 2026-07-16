"use client";

import { useState } from "react";
import { Radio, Volume2, VolumeX, Sparkles, Brain, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import CoPilotConversation from "@/components/CoPilotConversation";
import { useCoPilot } from "@/lib/copilot-context";
import { PERSONALITIES, type Personality } from "@/lib/copilot";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export default function DispatcherPage() {
  const { profile, handsFree, voice, toggleHandsFree, toggleVoiceOut, pickPersonality } = useCoPilot();
  const [showModes, setShowModes] = useState(false);

  const activeMode = PERSONALITIES.find((m) => m.id === profile.personality)!;

  function choose(id: Personality) {
    pickPersonality(id);
    setShowModes(false);
  }

  return (
    <div className="flex h-[calc(100vh-140px)] flex-col lg:h-[calc(100vh-96px)]">
      <PageHeader
        title="AI Co-Pilot"
        subtitle={`${activeMode.name} · voice ${profile.voiceEnabled ? "on" : "off"}${handsFree ? " · hands-free" : ""}`}
        action={
          <div className="flex items-center gap-2">
            <BrainStatus />
            {voice.sttSupported && (
              <button
                onClick={toggleHandsFree}
                title={handsFree ? 'Hands-free on — say "hey co-pilot"' : "Turn on hands-free"}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition ${
                  handsFree ? "border-electric/60 bg-electric/10 text-white" : "border-white/10 text-white/70 hover:bg-white/5"
                }`}
              >
                <Radio className={`h-3.5 w-3.5 ${handsFree ? "animate-pulse text-electric" : ""}`} /> Hands-free
              </button>
            )}
            <button
              onClick={toggleVoiceOut}
              title={profile.voiceEnabled ? "Mute spoken replies" : "Speak replies aloud"}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-white/70 transition hover:bg-white/5"
            >
              {profile.voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setShowModes((s) => !s)}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 transition hover:bg-white/5"
            >
              <Sparkles className="h-3.5 w-3.5 text-electric" /> {activeMode.name}
            </button>
          </div>
        }
      />

      {showModes && (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {PERSONALITIES.map((m) => (
            <button
              key={m.id}
              onClick={() => choose(m.id)}
              className={`rounded-xl border p-3 text-left transition ${
                m.id === profile.personality ? "border-electric/60 bg-electric/10" : "border-white/10 hover:bg-white/5"
              }`}
            >
              <div className="text-sm font-semibold">{m.name}</div>
              <div className="mt-0.5 text-xs text-white/50">{m.blurb}</div>
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <CoPilotConversation variant="full" />
      </div>
    </div>
  );
}

function BrainStatus() {
  const health = useApi(() => api.copilotHealth(), []);
  const [open, setOpen] = useState(false);

  if (health.loading) {
    return (
      <span className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking brain
      </span>
    );
  }

  // If the check itself failed to reach our server, treat it as unknown rather
  // than lying about the brain being live.
  const h = health.data;
  const live = !!h?.live;
  const detail = health.error
    ? "Couldn't reach the server to check the brain."
    : h?.detail ?? "Unknown status.";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        title={detail}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition ${
          live
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            : "border-amber-500/50 bg-amber-500/10 text-amber-300"
        }`}
      >
        <Brain className="h-3.5 w-3.5" /> {live ? "Brain live" : "Basic mode"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-white/10 bg-[#0B0F1A] p-3 text-xs shadow-xl">
          <div className="font-semibold text-white/90">
            {live ? "Full AI brain is live" : "Running in basic mode"}
          </div>
          <div className="mt-1 text-white/60">{detail}</div>
          {h?.model && (
            <div className="mt-2 text-[11px] text-white/40">Model: {h.model}</div>
          )}
          <button
            onClick={() => health.reload()}
            className="mt-2 text-electric hover:underline"
          >
            Re-check
          </button>
        </div>
      )}
    </div>
  );
}
