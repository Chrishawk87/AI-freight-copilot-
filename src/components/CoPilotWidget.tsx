"use client";

// Floating Co-Pilot launcher + panel. Rendered globally so the driver can talk
// to the Co-Pilot — or watch it work — from any tab. Hidden on the full-screen
// Co-Pilot page itself (that page already shows the whole conversation).

import { usePathname } from "next/navigation";
import { Bot, X, Radio, Volume2, VolumeX } from "lucide-react";
import { useCoPilot } from "@/lib/copilot-context";
import CoPilotConversation from "./CoPilotConversation";

export default function CoPilotWidget() {
  const pathname = usePathname();
  const { panelOpen, setPanelOpen, handsFree, phase, profile, toggleHandsFree, toggleVoiceOut, voice } = useCoPilot();

  // The Co-Pilot screen shows the conversation full-screen already.
  if (pathname === "/dispatcher") return null;

  const active = phase !== "wake";

  return (
    <>
      {/* Launcher */}
      {!panelOpen && (
        <button
          onClick={() => setPanelOpen(true)}
          title="Open Co-Pilot"
          className="fixed bottom-28 right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-electric text-white shadow-glow transition hover:brightness-110 lg:bottom-6 lg:right-6"
        >
          <Bot className="h-6 w-6" />
          {handsFree && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${
                  active ? "animate-ping bg-emerald-400" : "bg-emerald-500/70"
                }`}
              />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500" />
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {panelOpen && (
        <div className="fixed bottom-28 right-4 z-40 flex h-[70vh] max-h-[560px] w-[calc(100vw-2rem)] max-w-sm flex-col rounded-2xl border border-white/10 bg-navy-900/95 p-3 shadow-glow backdrop-blur lg:bottom-6 lg:right-6">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-electric/20">
                <Bot className="h-4 w-4 text-electric" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold">Co-Pilot</div>
                <div className="text-[11px] text-white/40">
                  {handsFree ? (active ? "Listening…" : 'Say "hey co-pilot"') : "Hands-free off"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {voice.sttSupported && (
                <button
                  onClick={toggleHandsFree}
                  title={handsFree ? "Turn off hands-free" : "Turn on hands-free"}
                  className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
                    handsFree ? "border-electric/60 bg-electric/10 text-white" : "border-white/10 text-white/60 hover:bg-white/5"
                  }`}
                >
                  <Radio className={`h-4 w-4 ${handsFree ? "animate-pulse text-electric" : ""}`} />
                </button>
              )}
              <button
                onClick={toggleVoiceOut}
                title={profile.voiceEnabled ? "Mute spoken replies" : "Speak replies aloud"}
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5"
              >
                {profile.voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setPanelOpen(false)}
                title="Close"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CoPilotConversation variant="panel" />
          </div>
        </div>
      )}
    </>
  );
}
