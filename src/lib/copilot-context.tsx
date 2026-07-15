"use client";

// Global Co-Pilot brain + voice session.
//
// This provider is mounted once in the authenticated AppShell, so it stays
// alive across every tab. That's what makes "hey co-pilot" work no matter
// where the driver is in the app — the mic session and the conversation state
// machine live here, above the router, and never unmount on navigation.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { ScoredLoad } from "./types";
import { api } from "./api";
import { readEnabled } from "./plugins";
import { useVoice } from "./voice";
import {
  runCoPilot,
  proactiveAlerts,
  readProfile,
  writeProfile,
  llm,
  type CoPilotProfile,
  type CoPilotResult,
  type CoPilotStep,
  type PendingAction,
  type Personality,
} from "./copilot";

export interface Msg {
  role: "user" | "ai";
  text: string;
  loads?: ScoredLoad[];
  steps?: CoPilotStep[];
  followups?: string[];
}

type Phase = "wake" | "active" | "confirming";

interface CoPilotContextValue {
  msgs: Msg[];
  input: string;
  setInput: (s: string) => void;
  busy: boolean;
  handsFree: boolean;
  phase: Phase;
  panelOpen: boolean;
  setPanelOpen: (b: boolean) => void;
  profile: CoPilotProfile;
  voice: ReturnType<typeof useVoice>;
  send: (t: string) => void;
  toggleHandsFree: () => void;
  toggleVoiceOut: () => void;
  pickPersonality: (id: Personality) => void;
}

const Ctx = createContext<CoPilotContextValue | null>(null);

export function useCoPilot(): CoPilotContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCoPilot must be used within CoPilotProvider");
  return v;
}

// How long the Co-Pilot waits in silence before it checks "is that all?".
const SILENCE_MS = 5000;

// ---- Hands-free speech parsing (pure helpers) ----
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "hey co-pilot" (and natural variants) wakes the assistant.
function isWake(t: string): boolean {
  return /co[\s-]?pilot/.test(normalize(t));
}

// When the Co-Pilot asks "is that all?", decide what the driver's reply means.
function endIntent(t: string): "end" | "continue" | "unknown" {
  const s = normalize(t);
  if (
    /(nothing else|no more|nope more|that'?s all|that'?s it|that is all|i'?m good|im good|i'?m done|im done|all done|all good|we'?re good|were good|all set|good to go|i'?m fine|im fine)/.test(
      s,
    )
  )
    return "end";
  if (/^(yes|yeah|yep|yup|sure|correct|affirmative|ya|yea|right|that'?ll do)\b/.test(s)) return "end";
  if (
    /^(no|nope|nah|not yet|negative)\b/.test(s) ||
    /(keep going|one more|another|i (have|need|got|want|wanna)|hang on|hold on|wait|actually)/.test(s)
  )
    return "continue";
  return "unknown";
}

export function CoPilotProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const voice = useVoice();

  const [profile, setProfile] = useState<CoPilotProfile>(readProfile);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [phase, setPhase] = useState<Phase>("wake");
  const [panelOpen, setPanelOpen] = useState(false);

  // Live refs so async handlers + the once-registered voice session always see
  // fresh values.
  const pendingRef = useRef<PendingAction | null>(null);
  const profileRef = useRef<CoPilotProfile>(profile);
  const busyRef = useRef(false);
  const handsFreeRef = useRef(false);
  const convoRef = useRef<Phase>("wake");
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seededRef = useRef(false);
  const onTranscriptRef = useRef<(t: string) => void>(() => {});
  const onMicErrorRef = useRef<(e: string) => void>(() => {});
  profileRef.current = profile;
  busyRef.current = busy;

  function setConvo(p: Phase) {
    convoRef.current = p;
    setPhase(p);
  }

  function clearSilence() {
    if (silenceTimer.current) {
      clearTimeout(silenceTimer.current);
      silenceTimer.current = null;
    }
  }

  function pushAi(text: string) {
    setMsgs((m) => [...m, { role: "ai", text }]);
  }

  function buildContext() {
    return {
      profile: profileRef.current,
      plugins: readEnabled(),
      pending: pendingRef.current,
      data: {
        loads: () => api.loads(),
        reloads: () => api.reloads(),
        fuel: () => api.fuel(),
        dashboard: () => api.dashboard(),
        carrier: () => api.carrier(),
      },
    };
  }

  const speakReply = useCallback(
    (text: string) => {
      const afterSpeak = () => {
        if (!handsFreeRef.current) return;
        const st = convoRef.current;
        if (st === "active") scheduleIsThatAll();
        else if (st === "confirming") scheduleEndOnSilence();
      };
      if (!profileRef.current.voiceEnabled || !voice.ttsSupported) {
        afterSpeak();
        return;
      }
      voice.speak(text, { onDone: afterSpeak });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voice.ttsSupported],
  );

  function respond(text: string) {
    pushAi(text);
    speakReply(text);
  }

  function scheduleIsThatAll() {
    clearSilence();
    silenceTimer.current = setTimeout(() => {
      if (!handsFreeRef.current) return;
      setConvo("confirming");
      const n = profileRef.current.name;
      respond(n ? `Is that all, ${n}?` : "Is that all?");
    }, SILENCE_MS);
  }

  function scheduleEndOnSilence() {
    clearSilence();
    silenceTimer.current = setTimeout(() => {
      endConversation(true);
    }, SILENCE_MS + 2000);
  }

  function enterActive() {
    clearSilence();
    setConvo("active");
    setPanelOpen(true);
    const n = profileRef.current.name;
    respond(n ? `Hey ${n}, what can I do for you?` : "Hey, what can I do for you?");
  }

  function continueConversation() {
    clearSilence();
    setConvo("active");
    respond("What else you need?");
  }

  function endConversation(silent: boolean) {
    clearSilence();
    setConvo("wake");
    pendingRef.current = null;
    if (!silent) {
      const n = profileRef.current.name;
      respond(
        n
          ? `You got it, ${n}. Say "hey co-pilot" whenever you need me.`
          : `You got it. Say "hey co-pilot" whenever you need me.`,
      );
    }
  }

  const applyResult = useCallback(
    (res: CoPilotResult) => {
      if (res.profilePatch) {
        setProfile((p) => {
          const next = { ...p, ...res.profilePatch };
          writeProfile(next);
          profileRef.current = next;
          return next;
        });
      }
      pendingRef.current = res.pending ?? null;
      setMsgs((m) => [
        ...m,
        { role: "ai", text: res.speak, loads: res.loads, steps: res.steps, followups: res.followups },
      ]);
      speakReply(res.speak);
      if (res.uiEvent && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("copilot-ui", { detail: res.uiEvent }));
      }
      if (res.navigate) {
        setTimeout(() => router.push(res.navigate!), 600);
      }
    },
    [router, speakReply],
  );

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busyRef.current) return;
      clearSilence();
      if (convoRef.current !== "active") setConvo("active");
      setPanelOpen(true);
      setMsgs((m) => [...m, { role: "user", text: q }]);
      setInput("");
      setBusy(true);
      try {
        const res = await runCoPilot(q, buildContext(), llm);
        applyResult(res);
      } catch (e: any) {
        const msg = `Sorry — ${e?.message || "something went wrong"}.`;
        setMsgs((m) => [...m, { role: "ai", text: msg }]);
        speakReply(msg);
      } finally {
        setBusy(false);
      }
    },
    [applyResult, speakReply],
  );

  function handleTranscript(raw: string) {
    const t = (raw || "").trim();
    if (!t) return;
    if (busyRef.current) return;
    clearSilence();
    const st = convoRef.current;
    if (st === "wake") {
      if (isWake(t)) enterActive();
      return;
    }
    if (st === "confirming") {
      const intent = endIntent(t);
      if (intent === "end") return endConversation(false);
      if (intent === "continue") return continueConversation();
      setConvo("active");
      send(t);
      return;
    }
    send(t);
  }

  function handleMicError(e: string) {
    if (e === "no-speech" || e === "aborted" || e === "network") return;
    if (e === "not-allowed" || e === "service-not-allowed") {
      pushAi(
        "I need microphone access for hands-free. Allow the mic for this site in your browser, then tap the hands-free button again.",
      );
      setPanelOpen(true);
      stopSession();
      return;
    }
    if (e === "audio-capture" || e === "mic-error") {
      pushAi("I can't find a microphone. Make sure one's connected and enabled, then tap hands-free again.");
      setPanelOpen(true);
      stopSession();
      return;
    }
  }

  onTranscriptRef.current = handleTranscript;
  onMicErrorRef.current = handleMicError;

  function startSession() {
    if (!voice.sttSupported) return;
    if (!profileRef.current.voiceEnabled) {
      setProfile((p) => {
        const next = { ...p, voiceEnabled: true };
        writeProfile(next);
        profileRef.current = next;
        return next;
      });
    }
    handsFreeRef.current = true;
    setHandsFree(true);
    setConvo("wake");
    voice.startListening(
      {
        onResult: (t) => onTranscriptRef.current(t),
        onError: (e) => onMicErrorRef.current(e),
      },
      { continuous: true },
    );
  }

  function stopSession() {
    handsFreeRef.current = false;
    setHandsFree(false);
    setConvo("wake");
    clearSilence();
    voice.stopListening();
    voice.cancelSpeech();
  }

  function toggleHandsFree() {
    if (handsFreeRef.current) stopSession();
    else startSession();
  }

  function toggleVoiceOut() {
    setProfile((p) => {
      const next = { ...p, voiceEnabled: !p.voiceEnabled };
      writeProfile(next);
      profileRef.current = next;
      return next;
    });
    voice.cancelSpeech();
  }

  function pickPersonality(id: Personality) {
    setProfile((p) => {
      const next = { ...p, personality: id };
      writeProfile(next);
      profileRef.current = next;
      return next;
    });
  }

  // Seed the opening message once (silent — we only speak when woken, so we
  // never blast audio on a random tab).
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    (async () => {
      const name = profileRef.current.name ? ` ${profileRef.current.name}` : " there";
      const hf = voice.sttSupported;
      let text = hf
        ? `Hey${name}. Hands-free is on — say "hey co-pilot" from any screen and I'll jump in. Loads, reloads, cheap diesel, bids, your money, wherever you need to go.`
        : `Hey${name}. I'm your co-pilot — just talk to me. Loads, reloads, cheap diesel, bids, your money, wherever you need to go.`;
      try {
        const alerts = await proactiveAlerts(buildContext());
        if (alerts.length) text += ` Couple things while you're here: ${alerts.join(" ")}`;
      } catch {
        /* ignore */
      }
      setMsgs([
        {
          role: "ai",
          text,
          followups: ["What's my best move today?", "Find reloads near my delivery", "How much did I make this week?"],
        },
      ]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hands-free is always on while the app is open (across every tab).
  useEffect(() => {
    if (voice.sttSupported) startSession();
    return () => {
      handsFreeRef.current = false;
      clearSilence();
      voice.stopListening();
      voice.cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: CoPilotContextValue = {
    msgs,
    input,
    setInput,
    busy,
    handsFree,
    phase,
    panelOpen,
    setPanelOpen,
    profile,
    voice,
    send,
    toggleHandsFree,
    toggleVoiceOut,
    pickPersonality,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
