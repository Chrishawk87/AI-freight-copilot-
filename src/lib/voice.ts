"use client";

// Hands-free voice for the Co-Pilot. Uses the browser's built-in Web Speech APIs:
//  - SpeechRecognition  → microphone → text (what the driver says)
//  - speechSynthesis     → text → spoken audio (what the Co-Pilot says back)
// Everything degrades gracefully: if a browser doesn't support these, the text
// chat still works and `supported` reports false.

import { useCallback, useEffect, useRef, useState } from "react";
import { readEnabled, readKeys } from "./plugins";

type Listeners = {
  onResult?: (text: string) => void; // final transcript
  onPartial?: (text: string) => void; // live interim transcript
  onEnd?: () => void;
  onError?: (err: string) => void;
};

// ---- ElevenLabs (real human voice) ----
// When the driver connects ElevenLabs in the Plugin Engine and pastes their
// free API key, we synthesize speech through their API for a genuinely human
// voice. Without a key we fall back to the browser's built-in speech. The key
// lives only in the driver's own browser (localStorage), never in source.
const ELEVEN_PLUGIN_ID = "elevenlabs";
// Rachel — a warm, natural female voice from ElevenLabs' free default set.
const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

function readElevenConfig(): { key: string; voiceId: string } | null {
  if (typeof window === "undefined") return null;
  const enabled = readEnabled();
  if (!enabled[ELEVEN_PLUGIN_ID]) return null;
  const keys = readKeys();
  const key = keys[ELEVEN_PLUGIN_ID]?.trim();
  if (!key) return null;
  const voiceId = keys[`${ELEVEN_PLUGIN_ID}_voice`]?.trim() || ELEVEN_DEFAULT_VOICE;
  return { key, voiceId };
}

// Returns an object URL for spoken audio, or null on any failure (so callers
// can fall back to the browser voice cleanly).
async function elevenSynthesize(text: string, cfg: { key: string; voiceId: string }): Promise<string | null> {
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": cfg.key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// Whether a real human voice is currently wired up.
export function humanVoiceReady(): boolean {
  return !!readElevenConfig();
}

function getRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function speechSupported(): boolean {
  return !!getRecognitionCtor();
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Score a voice for how natural it's likely to sound. Higher = better.
// Neural/premium/cloud voices sound far closer to Siri than the default
// eSpeak-style robotic fallback, so we rank those to the top.
function scoreVoice(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  let s = 0;
  if (/en-us/.test(lang)) s += 6;
  else if (/^en/.test(lang)) s += 3;
  if (/natural|neural|premium|enhanced/.test(name)) s += 10;
  if (/google/.test(name)) s += 8; // Chrome's cloud voice, very natural
  if (/samantha|aria|jenny|ava|allison|siri|serena|nicky|zoe/.test(name)) s += 7; // Apple/Windows premium
  if (/microsoft/.test(name)) s += 4;
  if (/albert|zarvox|bad news|bahh|bells|boing|bubbles|cellos|fred|jester|organ|superstar|trinoids|whisper|wobble|deranged|hysterical|ralph|junior|kathy/.test(name)) s -= 20;
  if (v.localService) s += 1;
  return s;
}

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en/i.test(v.lang || ""));
  const pool = en.length ? en : voices;
  return [...pool].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] ?? null;
}

// ---- Number-to-words (so money is spoken as dollars & cents, not digits) ----
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

// 0..999 -> words ("one hundred forty-eight").
function underThousand(n: number): string {
  let out = "";
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) out += `${ONES[h]} hundred`;
  if (r) {
    if (out) out += " ";
    if (r < 20) out += ONES[r];
    else {
      out += TENS[Math.floor(r / 10)];
      if (r % 10) out += `-${ONES[r % 10]}`;
    }
  }
  return out;
}

// Whole number -> words. Handles up to the billions (plenty for freight $).
function spellNumber(n: number): string {
  if (!isFinite(n) || n < 0) return String(n);
  if (n === 0) return "zero";
  const scales: [number, string][] = [
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
    [1, ""],
  ];
  let rem = Math.floor(n);
  const parts: string[] = [];
  for (const [val, name] of scales) {
    if (rem >= val) {
      const count = Math.floor(rem / val);
      rem %= val;
      parts.push(underThousand(count) + (name ? ` ${name}` : ""));
    }
  }
  return parts.join(" ").trim();
}

// US state postal codes -> full spoken names (so "TX" reads "Texas").
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "Washington D C",
};

// Rewrite text so speech engines pronounce it reliably. The browser voice in
// particular chokes on "$" and dense numeric strings — it can stall mid-word
// and never finish ("hangs up when saying numbers"). We expand money, rates,
// state codes, and percentages into plain words and strip markdown/symbols.
export function speakableText(raw: string): string {
  let t = raw;
  // Strip markdown emphasis / symbols that trip TTS.
  t = t.replace(/[*_`#>|]/g, " ");
  // Per-unit shorthands FIRST, while the digit still sits next to the slash
  // (must run before the currency rule turns "$2.85/mi" into "...dollars/mi").
  t = t.replace(/([\d.])\s*\/\s*mi\b/gi, "$1 per mile");
  t = t.replace(/([\d.])\s*\/\s*gal\b/gi, "$1 per gallon");
  t = t.replace(/([\d.])\s*\/\s*mo\b/gi, "$1 per month");
  t = t.replace(/\brpm\b/gi, "per mile");
  // Currency: spell it out as dollars and cents so "$1,148.50" reads
  // "one thousand one hundred forty-eight dollars and fifty cents" — not
  // "one comma one four eight" or "point five zero".
  t = t.replace(
    /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g,
    (_m, dollarsStr: string, centsStr?: string) => {
      const dollars = parseInt(dollarsStr.replace(/,/g, ""), 10);
      let out = `${spellNumber(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
      if (centsStr != null) {
        const cents = parseInt(centsStr.padEnd(2, "0"), 10);
        if (cents > 0) out += ` and ${spellNumber(cents)} ${cents === 1 ? "cent" : "cents"}`;
      }
      return out;
    },
  );
  // State postal codes in "City, ST" form -> full name ("Dallas, Texas").
  t = t.replace(/,\s*([A-Z]{2})\b/g, (m, code: string) => (STATE_NAMES[code] ? `, ${STATE_NAMES[code]}` : m));
  // Interstate shorthand: "I-20" -> "Interstate 20".
  t = t.replace(/\bI-(\d+)\b/g, "Interstate $1");
  // Percent.
  t = t.replace(/(\d)\s?%/g, "$1 percent");
  // Ampersand reads oddly.
  t = t.replace(/\s?&\s?/g, " and ");
  // Any remaining comma inside a number (e.g. "1,148 miles") trips the voice —
  // drop the separator so it's read as a whole number.
  t = t.replace(/(\d),(?=\d{3}\b)/g, "$1");
  // Collapse whitespace.
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// Break text into short, speakable pieces. Chrome's speechSynthesis cuts off
// (and can freeze) on utterances longer than ~15s, so we queue one sentence at
// a time — far more reliable than one long utterance.
function splitForSpeech(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 180) {
      out.push(trimmed);
    } else {
      // Very long sentence — split on commas to keep each piece short.
      let buf = "";
      for (const part of trimmed.split(/,\s*/)) {
        if ((buf + ", " + part).length > 180 && buf) {
          out.push(buf);
          buf = part;
        } else {
          buf = buf ? `${buf}, ${part}` : part;
        }
      }
      if (buf) out.push(buf);
    }
  }
  return out;
}

export function useVoice() {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState("");
  const recRef = useRef<any>(null);
  const listenersRef = useRef<Listeners>({});
  const manualStopRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Continuous "always-on" session (hands-free). When true, recognition
  // auto-restarts whenever it stops, so the driver never has to re-tap.
  const sessionRef = useRef(false);
  // True while the Co-Pilot is speaking. We stop recognition during playback
  // so it never hears (and transcribes) its own voice, then resume after.
  const speakingGuardRef = useRef(false);

  const sttOk = speechSupported();
  const ttsOk = ttsSupported();

  // Voices load asynchronously; getVoices() is often empty on first call.
  // Cache the best available voice and refresh when the list arrives.
  useEffect(() => {
    if (!ttsOk) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const v = pickBestVoice(synth.getVoices());
      if (v) voiceRef.current = v;
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [ttsOk]);

  // Build the recognition object once.
  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (interim) {
        setPartial(interim);
        listenersRef.current.onPartial?.(interim);
      }
      if (final) {
        setPartial("");
        listenersRef.current.onResult?.(final.trim());
      }
    };
    rec.onerror = (e: any) => {
      listenersRef.current.onError?.(e?.error || "speech-error");
    };
    rec.onend = () => {
      setListening(false);
      setPartial("");
      listenersRef.current.onEnd?.();
      // Keep the mic alive for hands-free: restart unless we stopped on
      // purpose or we're mid-speech (guarded so we don't hear ourselves).
      if (sessionRef.current && !manualStopRef.current && !speakingGuardRef.current) {
        setTimeout(() => {
          if (sessionRef.current && !manualStopRef.current && !speakingGuardRef.current) {
            try {
              recRef.current?.start();
              setListening(true);
            } catch {
              /* already started — ignore */
            }
          }
        }, 300);
      }
    };

    recRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const startListening = useCallback(
    (listeners: Listeners = {}, opts?: { continuous?: boolean }) => {
      if (!recRef.current) return;
      listenersRef.current = listeners;
      manualStopRef.current = false;
      sessionRef.current = !!opts?.continuous;
      try {
        recRef.current.continuous = !!opts?.continuous;
      } catch {
        /* ignore */
      }
      // If the Co-Pilot is mid-sentence, don't cut it off or open the mic now:
      // the session is marked active, so recognition starts automatically the
      // moment speech finishes (see finishAll in speak()).
      if (speakingGuardRef.current) return;
      // Don't listen to our own voice.
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      const a = audioRef.current;
      if (a) {
        try {
          a.pause();
          a.onended = null;
          a.onerror = null;
          if (a.src) URL.revokeObjectURL(a.src);
          a.src = "";
        } catch {
          /* ignore */
        }
        audioRef.current = null;
      }
      // Start recognition. SpeechRecognition opens and manages its own audio
      // stream, and its onerror reports the real, standardized reason if the
      // mic truly can't be used (not-allowed / audio-capture / network). We
      // let recognition be the source of truth for errors.
      const begin = () => {
        try {
          recRef.current.start();
          setListening(true);
        } catch {
          // start() throws only if already started — safe to ignore.
        }
      };
      // Best-effort pre-warm: requesting the mic first nudges Chrome to show
      // its permission prompt. But we do NOT block on it — some setups reject
      // getUserMedia (device busy, non-default device) while SpeechRecognition
      // still works fine, so a getUserMedia failure must never stop us. We
      // start recognition either way and rely on recognition.onerror.
      const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
      if (md?.getUserMedia) {
        md.getUserMedia({ audio: true })
          .then((stream) => {
            try {
              stream.getTracks().forEach((t) => t.stop());
            } catch {
              /* ignore */
            }
            begin();
          })
          .catch(() => {
            // Ignore the pre-warm failure and try recognition anyway.
            begin();
          });
      } else {
        begin();
      }
    },
    []
  );

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    sessionRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  // Stop and tear down any ElevenLabs audio that's playing.
  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
        a.onended = null;
        a.onerror = null;
        if (a.src) URL.revokeObjectURL(a.src);
        a.src = "";
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
  }, []);

  // Speak with the browser's built-in speech synthesis. This is the fallback
  // when ElevenLabs isn't connected or its request fails.
  //
  // Two things make Chrome's speechSynthesis reliable:
  //   1. Speak one short chunk at a time (splitForSpeech). Chrome cuts off /
  //      freezes on long utterances — the main cause of "hangs on numbers".
  //   2. A pause()/resume() keep-alive tick. Chrome silently stops the queue
  //      after ~15s; toggling pause/resume keeps it running until we're done.
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserSpeak = useCallback(
    (text: string, onDone?: () => void) => {
      if (!ttsOk) {
        onDone?.();
        return;
      }
      const synth = window.speechSynthesis;
      const chunks = splitForSpeech(text);
      if (!chunks.length) {
        onDone?.();
        return;
      }
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }

      const voice = voiceRef.current ?? pickBestVoice(synth.getVoices());
      if (voice) voiceRef.current = voice;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (keepAliveRef.current) {
          clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
        setSpeaking(false);
        onDone?.();
      };

      // Keep Chrome's synth from stalling on LONG replies. The pause/resume
      // trick causes a tiny audible hiccup, so we don't touch normal-length
      // speech at all — we only start nudging after ~13s (near Chrome's ~15s
      // stall window), which is where the freeze actually happens. This stops
      // the "voice fading in and out" on ordinary answers.
      const startedAt = Date.now();
      keepAliveRef.current = setInterval(() => {
        try {
          if (Date.now() - startedAt < 13000) return;
          if (synth.speaking && !synth.paused) {
            synth.pause();
            synth.resume();
          }
        } catch {
          /* ignore */
        }
      }, 10000);

      const speakChunk = (i: number) => {
        if (done) return;
        if (i >= chunks.length) {
          finish();
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang || "en-US";
        } else {
          u.lang = "en-US";
        }
        // Slightly slower + natural pitch reads warmer and less robotic.
        u.rate = 0.98;
        u.pitch = 1.05;
        u.volume = 1;
        if (i === 0) u.onstart = () => setSpeaking(true);
        u.onend = () => speakChunk(i + 1);
        u.onerror = () => speakChunk(i + 1);
        try {
          synth.speak(u);
        } catch {
          finish();
        }
      };

      setSpeaking(true);
      speakChunk(0);
    },
    [ttsOk]
  );

  const speak = useCallback(
    (rawText: string, opts?: { onDone?: () => void }) => {
      // Normalize once so money, rates, and percentages are pronounced
      // reliably by whichever engine speaks — this is what stops the voice
      // hanging on numbers like "$1,148" or "2.85/gal".
      const text = speakableText(rawText);
      if (!text) {
        opts?.onDone?.();
        return;
      }
      // Don't listen to ourselves: stop recognition while we speak.
      speakingGuardRef.current = true;
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      // Cancel anything already talking.
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      stopAudio();

      // Called exactly once when speech finishes (any path). Resumes the mic
      // if a hands-free session is running, then hands control back to caller.
      let finished = false;
      const finishAll = () => {
        if (finished) return;
        finished = true;
        speakingGuardRef.current = false;
        if (sessionRef.current && !manualStopRef.current) {
          setTimeout(() => {
            if (sessionRef.current && !manualStopRef.current) {
              try {
                recRef.current?.start();
                setListening(true);
              } catch {
                /* already started — ignore */
              }
            }
          }, 250);
        }
        opts?.onDone?.();
      };

      const cfg = readElevenConfig();
      if (!cfg) {
        // No human voice connected — use the browser voice.
        browserSpeak(text, finishAll);
        return;
      }

      // Try the real human voice. If anything goes wrong, fall back cleanly.
      setSpeaking(true);
      elevenSynthesize(text, cfg)
        .then((url) => {
          if (!url) {
            // API failed — fall back to browser voice.
            setSpeaking(false);
            browserSpeak(text, finishAll);
            return;
          }
          const audio = new Audio(url);
          audioRef.current = audio;
          const finish = () => {
            setSpeaking(false);
            if (audioRef.current === audio) {
              try {
                URL.revokeObjectURL(url);
              } catch {
                /* ignore */
              }
              audioRef.current = null;
            }
            finishAll();
          };
          audio.onended = finish;
          audio.onerror = () => {
            // Playback failed — fall back to browser voice.
            setSpeaking(false);
            if (audioRef.current === audio) audioRef.current = null;
            browserSpeak(text, finishAll);
          };
          audio.play().catch(() => {
            setSpeaking(false);
            if (audioRef.current === audio) audioRef.current = null;
            browserSpeak(text, finishAll);
          });
        })
        .catch(() => {
          setSpeaking(false);
          browserSpeak(text, finishAll);
        });
    },
    [browserSpeak, stopAudio]
  );

  const cancelSpeech = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
    stopAudio();
    setSpeaking(false);
    speakingGuardRef.current = false;
    // If a hands-free session is running, get the mic listening again.
    if (sessionRef.current && !manualStopRef.current) {
      setTimeout(() => {
        if (sessionRef.current && !manualStopRef.current) {
          try {
            recRef.current?.start();
            setListening(true);
          } catch {
            /* ignore */
          }
        }
      }, 200);
    }
  }, [stopAudio]);

  return {
    sttSupported: sttOk,
    ttsSupported: ttsOk,
    listening,
    speaking,
    partial,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
  };
}
