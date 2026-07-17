"use client";

// The Co-Pilot "brain": a built-in, offline intent + action engine with a
// professional trucking personality. It understands what the driver asks,
// pulls REAL data from the app's own API where it's wired, performs actions
// (navigating tabs, drafting bids), and clearly LABELS anything that is a
// simulated/demo step (TPMS, ELD hours, weather feeds, broker submission).
//
// It also learns the driver over time (name, home base, preferred equipment)
// and speaks in one of four selectable personalities.
//
// LLM-ready: runCoPilot accepts an optional `llm` resolver. When the rules
// engine can't confidently handle an utterance, it hands off to the LLM (if a
// client has wired one). Until then everything works with no API key or cost.

import type { ScoredLoad, Equipment } from "./types";
import type { CarrierDetail, DashboardResponse, FuelResponse } from "./api";
import { askClaude, claudeBrainReady } from "./anthropic";
import { api } from "./api";
import type { EnabledMap } from "./plugins";

// ---------------- Personality + driver profile ----------------

export type Personality = "friendly" | "dispatcher" | "minimal" | "fleet";

export interface CoPilotProfile {
  name?: string;
  homeBase?: string;
  preferredEquipment?: Equipment | null;
  personality: Personality;
  voiceEnabled: boolean; // auto-speak replies
  autoListen: boolean; // re-open the mic after speaking (hands-free loop)
}

export const DEFAULT_PROFILE: CoPilotProfile = {
  personality: "friendly",
  voiceEnabled: true,
  autoListen: false,
};

export const PERSONALITIES: { id: Personality; name: string; blurb: string }[] = [
  { id: "friendly", name: "Friendly Co-Pilot", blurb: "Warm, upbeat, encouraging." },
  { id: "dispatcher", name: "Professional Dispatcher", blurb: "Calm, precise, professional." },
  { id: "minimal", name: "Minimal", blurb: "Only the essentials. Few words." },
  { id: "fleet", name: "Fleet Mode", blurb: "Tuned for company drivers." },
];

const PROFILE_KEY = "aifc_copilot";

export function readProfile(): CoPilotProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function writeProfile(p: CoPilotProfile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

// ---------------- Result + context shapes ----------------

export interface CoPilotStep {
  label: string;
  simulated?: boolean; // true = demo step, not a real integration yet
}

export interface PendingAction {
  kind: "submit_bid" | "prepare_offer" | "book_load" | "book_repair" | "open_screen";
  load?: ScoredLoad;
  amount?: number;
  route?: string; // for open_screen: where "yes" takes the driver
}

export interface CoPilotResult {
  speak: string; // spoken + displayed reply
  loads?: ScoredLoad[];
  steps?: CoPilotStep[];
  navigate?: string; // route to push after replying
  followups?: string[]; // quick-reply chips
  profilePatch?: Partial<CoPilotProfile>; // facts to persist
  pending?: PendingAction; // a yes/no the driver can confirm next turn
  uiEvent?: string; // a UI command for the current screen (e.g. "map:close")
}

export interface CoPilotContext {
  profile: CoPilotProfile;
  plugins: EnabledMap;
  pending?: PendingAction | null;
  data: {
    loads: () => Promise<ScoredLoad[]>;
    reloads: () => Promise<ScoredLoad[]>;
    fuel: () => Promise<FuelResponse>;
    dashboard: () => Promise<DashboardResponse>;
    carrier: () => Promise<CarrierDetail>;
  };
}

export type LlmResolver = (input: string, ctx: CoPilotContext) => Promise<CoPilotResult | null>;

// ---------------- helpers ----------------

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const EQUIP: [string, Equipment][] = [
  ["reefer", "Reefer"],
  ["flatbed", "Flatbed"],
  ["dry van", "Dry Van"],
  ["step deck", "Step Deck"],
  ["power only", "Power Only"],
  ["box truck", "Box Truck"],
  ["hotshot", "Hotshot"],
  ["sprinter", "Sprinter Van"],
  ["tanker", "Tanker"],
  ["auto", "Auto Transport"],
];

function detectEquipment(q: string): Equipment | null {
  const hit = EQUIP.find(([k]) => q.includes(k));
  return hit ? hit[1] : null;
}

// Personality-aware phrasing. `brief` is what Minimal mode uses; `ask` is an
// optional trailing question. We write the `core` strings to already sound like
// a relaxed human — contractions, no bot crutches, no academic transitions — so
// there's no canned prefix to bolt on. Minimal just swaps in the short version.
function say(
  p: Personality,
  parts: { core: string; brief?: string; good?: boolean; ask?: string }
): string {
  const { core, brief, ask } = parts;
  if (p === "minimal") return brief ?? core;
  return `${core}${ask ? " " + ask : ""}`;
}

const CONFIRM = /\b(yes|yeah|yep|sure|do it|go ahead|please do|submit|confirm|book it)\b/;
const DENY = /\b(no|nope|cancel|stop|not now|never mind|nevermind)\b/;

function driveHours(miles: number) {
  return Math.max(1, Math.round(miles / 52));
}

// ---------------- the engine ----------------

export async function runCoPilot(
  raw: string,
  ctx: CoPilotContext,
  llm?: LlmResolver | null
): Promise<CoPilotResult> {
  const q = raw.trim().toLowerCase();
  const P = ctx.profile.personality;
  if (!q) return { speak: say(P, { core: "I'm right here. What's up?", brief: "Yeah?" }) };

  // ---- Confirm / deny a pending action ----
  if (ctx.pending && CONFIRM.test(q)) {
    return executePending(ctx.pending, P);
  }
  if (ctx.pending && DENY.test(q)) {
    return { speak: say(P, { core: "No worries, I'll leave it. Just say the word.", brief: "Standing by." }) };
  }

  // ---- Greeting / wake word ----
  if (/^(hey|hi|hello|yo)?\s*(co[- ]?pilot|copilot)?[?.! ]*$/.test(q) || q === "hey" || q === "hello") {
    const name = ctx.profile.name ? `, ${ctx.profile.name}` : "";
    return {
      speak: say(P, {
        core: `Hey${name}. What do you need?`,
        brief: "Yeah?",
      }),
      followups: ["What's my best move today?", "Find the highest-paying reefer load", "How much did I make this week?"],
    };
  }

  // ---- Personality switch ----
  const modeHit = matchPersonality(q);
  if (modeHit) {
    const label = PERSONALITIES.find((x) => x.id === modeHit)!.name;
    return {
      speak: say(P, { core: `You got it — ${label} it is.`, brief: `${label}.` }),
      profilePatch: { personality: modeHit },
    };
  }

  // ---- Learn the driver ----
  const learned = matchLearning(q, raw);
  if (learned) return learned;

  // ---- Capabilities / getting started ----
  if (/(what can you do|get started|getting started|^help$|who are you|how do you work)/.test(q)) {
    return {
      speak: say(P, {
        core:
          "Think of me as your co-pilot. I'll dig up loads, find you a reload so you're not running empty, sniff out the cheapest diesel on your route, draft and send bids, run your navigation, and keep tabs on what you're actually making. I can open any screen too. And I pick up on how you like to run as we go. Just talk to me.",
        brief: "Loads, reloads, fuel, bids, navigation, your money. I'll open any screen too. Just ask.",
      }),
      followups: ["Find loads near me", "Cheapest diesel on my route", "Open plugins", "Switch to minimal mode"],
    };
  }

  // ---- Connect a plugin / integrations help ----
  if (/(connect|add|set up|setup|enable).*(plugin|integration|trimble|dat|truckstop|uber|eld|tpms|fuel card)/.test(q) ||
      /(plugin|integration)s?\b.*(how|help|connect)/.test(q)) {
    return {
      speak: say(P, {
        core:
          "Easy — head to the Plugin Engine and flip on whatever you already run. Load boards, ELD, TPMS, fuel cards, maps, you name it. Some of them just need you to paste an API key and I'll wire it up from there. Taking you over now.",
        brief: "Opening the Plugin Engine. Flip on what you use.",
      }),
      navigate: "/integrations",
    };
  }

  // ---- Navigate between tabs ----
  const navHit = matchNavigation(q);
  if (navHit) {
    return {
      speak: say(P, { core: `Pulling up ${navHit.name} now.`, brief: `${navHit.name}.` }),
      navigate: navHit.route,
    };
  }

  // ---- Dashboard / "how am I doing" breakdown ----
  // Runs BEFORE the intent classifier on purpose: the word "breakdown" would
  // otherwise be misread as a truck breakdown and fire the maintenance reply.
  // We exclude anything that's clearly about the vehicle.
  const summaryVerb =
    /(break ?it ?down|break ?down|breakdown|summ(ary|arize|arise)|overview|rundown|run down|recap|full picture|how am i doing|how'?s my|hows my|how is my|bottom line)/.test(q);
  const dashScope =
    /(dashboard|command center|my week|this week|my numbers|the numbers|my business|overall|everything|my money|how i'?m doing|how im doing|bottom line|how am i doing)/.test(q);
  const notVehicle = !/(broke down|broken down|check engine|tire|tyre|tpms|engine light|warning light|def light)/.test(q);
  if (summaryVerb && dashScope && notVehicle) {
    const dash = await ctx.data.dashboard();
    const w = dash.weekly;
    const goDash = /(dashboard|command center|open|show|pull up|take me)/.test(q) ? "/" : undefined;
    if (!w.loadsCompleted) {
      return {
        speak: say(P, {
          core: "Nothing to break down yet — you haven't booked a load this week, so revenue and net are still sitting at zero. Grab one and I'll track every number for you right here.",
          brief: "No booked loads this week yet.",
        }),
        navigate: goDash,
      };
    }
    const margin = ((w.netProfit / w.revenue) * 100).toFixed(0);
    const rpm = (w.revenue / Math.max(1, w.miles)).toFixed(2);
    return {
      speak: say(P, {
        core: `Here's your week at a glance. ${money(w.revenue)} in revenue across ${w.loadsCompleted} loads, and after fuel and fixed costs you're keeping ${money(
          w.netProfit,
        )} — that's a ${margin}% margin. You ran ${w.miles.toLocaleString()} miles, ${w.deadheadMiles.toLocaleString()} of them empty, so roughly $${rpm} a mile top line.`,
        brief: `${money(w.revenue)} in, ${money(w.netProfit)} net, ${margin}% margin, ${w.miles.toLocaleString()} mi.`,
      }),
      navigate: goDash,
    };
  }

  // ---- Everything else: score the utterance against known intents ----
  // This is tolerant of natural phrasing ("are there loads for tomorrow",
  // "what are the best rates for a flatbed", "which way am I heading").
  const intentDetail = classifyIntentDetailed(q);
  const intent = intentDetail?.id ?? null;

  // ---- Close / exit the full-screen map by voice ----
  if (/(close|exit|hide|shrink|minimize|get out of|leave)\s+(the\s+)?(map|full ?screen|navigation)/.test(q) ||
      /\b(exit|close)\s+full ?screen\b/.test(q)) {
    return {
      speak: say(P, { core: "Closing the map.", brief: "Map closed." }),
      uiEvent: "map:close",
    };
  }

  // ---- Knowledge base (offline freight know-how) ----
  // The canned intents above/below handle app actions and the driver's own
  // numbers. For everything else — regs, procedures, "what do I do when..." —
  // consult the shared knowledge base. This is a free, no-LLM lookup, so it
  // works even when the Claude brain isn't wired. We only let it win when the
  // intent classifier ISN'T confident (no strong keyword): a solid KB match on
  // a shaky intent means the driver asked a freight question that a generic
  // "here's a load" reply would wrongly swallow.
  if (!intentDetail?.strong) {
    const kb = await lookupKnowledge(raw, P);
    if (kb) return kb;
  }

  if (intent === "start_nav") {
    // Try to pull a spoken destination ("navigate to Dallas Texas",
    // "take me to 500 Main Street Dallas"). If we get one, the map routes
    // straight there; otherwise it routes to the accepted load's drop.
    const destM = raw.match(/\b(?:navigate|route|drive|go|get me|take me|guide me)\s+(?:to|toward|towards)\s+(.+)/i);
    const to = destM ? destM[1].trim().replace(/[.?!]+$/, "") : "";
    const qs = new URLSearchParams({ start: "1", fs: "1" });
    if (to) qs.set("to", to);
    return {
      speak: to
        ? say(P, {
            core: `Routing you to ${to} from your current location. Firing up the map now.`,
            brief: `Routing to ${to}.`,
          })
        : say(P, {
            core: "Alright, kicking off from wherever you're parked and running you straight to the drop. Full-screen map coming up.",
            brief: "Route's set. Opening the map.",
          }),
      navigate: `/navigation?${qs.toString()}`,
    };
  }

  if (intent === "heading") {
    return {
      speak: say(P, {
        core:
          "You're pointed east on I-20, about 180 miles out from the drop in Atlanta. Call it 3 hours 20 at this pace. Heads up though, that's a simulated read for now — your real GPS heading and ETA live over on the Map screen.",
        brief: "Eastbound on I-20, ~180 mi / 3h 20m to Atlanta. (Simulated.)",
      }),
      followups: ["Open the map", "Find reloads near my delivery"],
    };
  }

  if (intent === "earnings") {
    const dash = await ctx.data.dashboard();
    const w = dash.weekly;
    if (!w.loadsCompleted) {
      return {
        speak: say(P, {
          core: "Nothing to show yet — you haven't booked anything. Grab a load and I'll start tracking your revenue, net, and margin right here.",
          brief: "No booked loads yet.",
        }),
      };
    }
    const margin = ((w.netProfit / w.revenue) * 100).toFixed(0);
    return {
      speak: say(P, {
        core: `Here's your week. ${money(w.revenue)} came in, and after fuel and running costs you're keeping about ${money(
          w.netProfit
        )}. That's a ${margin}% margin across ${w.miles.toLocaleString()} miles on ${w.loadsCompleted} loads. Not bad at all.`,
        brief: `${money(w.revenue)} in, ${money(w.netProfit)} net, ${margin}% margin.`,
      }),
    };
  }

  if (intent === "hos") {
    const eld = ctx.plugins["eld"];
    return {
      speak: say(P, {
        core: `You've got about 6 hours 12 left on your clock.${
          eld ? "" : " Heads up though — that's a simulated number for now. Hook up your ELD and I'll read it live."
        }`,
        brief: "≈ 6h 12m left. (Simulated ELD.)",
      }),
      steps: [{ label: "Read ELD / Hours of Service", simulated: !eld }],
    };
  }

  if (intent === "weather") {
    return {
      speak: say(P, {
        core:
          "Bit of a slowdown about 20 miles up. There's an alt route that'll save you around 12 minutes. Weather's clear on your lane, so nothing to sweat there. This is simulated for now — connect a weather or traffic plugin and I'll give you the real thing.",
        brief: "Slowdown ahead, alt saves ~12m. (Simulated feeds.)",
      }),
      steps: [
        { label: "Query weather feed", simulated: true },
        { label: "Query traffic / DOT feed", simulated: true },
      ],
    };
  }

  if (intent === "maintenance") {
    return {
      speak: say(P, {
        core:
          "Just peeked at your tire sensors — front-left's running about 12 PSI low. There's a truck shop 9 miles up that can squeeze you in. I can book it, bump your ETA, and give the broker a heads up. Want me to handle it? Quick note — the sensor read and booking are simulated until you connect those.",
        brief: "Front-left ~12 PSI low. Shop 9 mi ahead. Book it?",
      }),
      steps: [
        { label: "Read TPMS sensors", simulated: true },
        { label: "Check weather along route", simulated: true },
        { label: "Read maintenance history", simulated: true },
        { label: "Find nearby repair shop", simulated: true },
      ],
      pending: { kind: "book_repair" },
    };
  }

  if (intent === "reloads") {
    const reloads = await ctx.data.reloads();
    const t = reloads[0];
    return {
      speak: t
        ? say(P, {
            core: `Found ${reloads.length} you could grab near the drop. Best of the bunch is ${t.originCity} → ${t.destCity} at ${money(
              t.rate
            )}, nets you ${money(t.netProfit)}, and keeps your deadhead under ${t.deadheadMiles} miles.`,
            brief: `${reloads.length} reloads. Top: ${t.originCity}→${t.destCity}, net ${money(t.netProfit)}.`,
            ask: "Want a closer look?",
          })
        : say(P, { core: "Nothing near your drop right now. I'll keep an eye out.", brief: "No reloads yet." }),
      loads: reloads.slice(0, 3),
      // "Want a closer look?" → yes opens the reloads screen with these on it.
      pending: t ? { kind: "open_screen", route: "/reloads", load: t } : undefined,
    };
  }

  if (intent === "fuel") {
    const f = await ctx.data.fuel();
    const onRoute = [...f.stations].filter((s) => s.onRoute).sort((a, b) => a.price - b.price)[0];
    return {
      speak: onRoute
        ? say(P, {
            core: `Cheapest diesel on your route is ${onRoute.name} in ${onRoute.city}, ${onRoute.state} — $${onRoute.price.toFixed(
              2
            )} a gallon, about ${onRoute.distanceMi} miles up. National average is sitting at $${f.nationalAvg.toFixed(2)}, so you're coming out ahead there.`,
            brief: `${onRoute.name}, $${onRoute.price.toFixed(2)}/gal, ${onRoute.distanceMi} mi ahead.`,
          })
        : say(P, { core: "No fuel data on your route right now.", brief: "No fuel data." }),
      followups: ["Open fuel screen"],
    };
  }

  if (intent === "bid") {
    const all = await ctx.data.loads();
    const eq = detectEquipment(q);
    const pool = eq ? all.filter((l) => l.equipment === eq) : all;
    const t = ctx.pending?.load ?? pool[0] ?? all[0];
    if (!t) return { speak: say(P, { core: "Don't see anything to bid on right now.", brief: "No loads." }) };
    const target = Math.round((t.rate * 1.08) / 5) * 5;
    return {
      speak: say(P, {
        core: `${t.externalId ?? t.id} (${t.originCity} → ${t.destCity}) is posted at ${money(
          t.rate
        )}. Honestly, the market'll bear more than that — I'd come in at ${money(target)}. Want me to send it?`,
        brief: `Posted ${money(t.rate)}. I'd bid ${money(target)}. Send it?`,
      }),
      loads: [t],
      pending: { kind: "submit_bid", load: t, amount: target },
    };
  }

  if (intent === "book") {
    const all = await ctx.data.loads();
    const eq = detectEquipment(q);
    const pool = eq ? all.filter((l) => l.equipment === eq) : all;
    const t = pool[0];
    if (!t) return { speak: say(P, { core: `Nothing ${eq ?? ""} to book right now.`, brief: "No loads." }) };
    const target = Math.round((t.rate * 1.06) / 5) * 5;
    return {
      speak: say(P, {
        core: `Best ${eq ?? "one"} I've got is ${t.originCity} → ${t.destCity} at ${money(t.rate)} — nets ${money(
          t.netProfit
        )}, and I rate it ${t.overall} out of 100. I'll pitch ${money(target)}, and the second it's yours I'll route you and keep track of it. Want me to send the offer?`,
        brief: `${t.originCity}→${t.destCity}, ${money(t.rate)}. Bid ${money(target)}?`,
      }),
      loads: [t],
      steps: [
        { label: "Search connected load sources" },
        { label: "Compare profitability after fuel + fixed cost" },
        { label: "Generate recommended bid" },
        { label: "Submit offer to broker", simulated: true },
        { label: "Route driver on award", simulated: true },
        { label: "Track load to delivery", simulated: true },
      ],
      pending: { kind: "book_load", load: t, amount: target },
    };
  }

  if (intent === "loads") {
    const all = await ctx.data.loads();
    const eq = detectEquipment(q) ?? ctx.profile.preferredEquipment ?? null;
    const pool = eq ? all.filter((l) => l.equipment === eq) : all;
    const list = pool.length ? pool : all;
    const t = list[0];
    if (!t)
      return {
        speak: say(P, {
          core: eq ? `Nothing ${eq} on your sources right now.` : "Nothing on your sources right now.",
          brief: "No loads.",
        }),
      };
    // If the driver asked specifically about rates, lead with the rate framing.
    const aboutRate = /(rate|paying|per mile|per-mile|rpm|\$)/.test(q);
    const core = aboutRate
      ? `Best ${eq ? eq + " " : ""}rate on the board's ${t.originCity}, ${t.originState} → ${t.destCity}, ${t.destState} at ${money(
          t.rate
        )} — that's $${t.allInRpm.toFixed(2)} a mile all-in, about ${money(t.netProfit)} net. Found ${list.length} ${
          eq ? eq + " " : ""
        }loads in total. Want me to put together an offer?`
      : `Dug through ${list.length} ${eq ? eq + " " : ""}loads. Best one's ${t.originCity}, ${t.originState} → ${t.destCity}, ${t.destState} at ${money(
          t.rate
        )} — about ${money(t.netProfit)} net once you cover fuel and fixed costs, $${t.allInRpm.toFixed(2)} a mile all-in, roughly ${driveHours(
          t.miles
        )} hours of driving. And there's a ${t.scores.reload}% shot at a reload near the drop. Want me to put together an offer?`;
    return {
      speak: say(P, {
        core,
        brief: `Top: ${t.originCity}→${t.destCity}, ${money(t.rate)}, net ${money(t.netProfit)}.`,
      }),
      loads: list.slice(0, 3),
      pending: { kind: "prepare_offer", load: t, amount: Math.round((t.rate * 1.06) / 5) * 5 },
    };
  }

  // ---- LLM fallback (if a client wired one) ----
  if (llm) {
    const res = await llm(raw, ctx);
    if (res) return res;
  }

  // ---- Default ----
  return {
    speak: say(P, {
      core:
        "Not totally sure what you're after there. I'm best with loads, reloads, cheap diesel, bids, your earnings, hours, and getting around the app. Try something like \"what's my best move today\" or \"find me the cheapest diesel.\"",
      brief: "Try: best move today, find loads, cheapest diesel, my earnings.",
    }),
    followups: ["What's my best move today?", "Find reloads near my delivery", "How much did I make this week?"],
  };
}

// ---------------- pending execution ----------------

function executePending(pending: PendingAction, P: Personality): CoPilotResult {
  switch (pending.kind) {
    case "open_screen":
      return {
        speak: say(P, { core: "You got it — pulling it up now.", brief: "Opening it." }),
        navigate: pending.route ?? "/loads",
        loads: pending.load ? [pending.load] : undefined,
      };
    case "submit_bid":
    case "prepare_offer":
      return {
        speak: say(P, {
          core: `Done — sent it at ${pending.amount ? money(pending.amount) : "the rate I quoted"}. I'll ping you the second the broker comes back. One thing: that's a simulated send for now. Connect a load board and it goes out for real.`,
          brief: `Sent${pending.amount ? " at " + money(pending.amount) : ""}. (Simulated.)`,
        }),
        loads: pending.load ? [pending.load] : undefined,
        steps: [
          { label: "Generate offer" },
          { label: "Submit to broker", simulated: true },
          { label: "Await approval", simulated: true },
        ],
      };
    case "book_load":
      return {
        speak: say(P, {
          core: `Alright, it's in at ${pending.amount ? money(pending.amount) : "the rate I quoted"}. Soon as it's yours I'll route you from your GPS and track it to the drop. Heads up — the send and tracking are simulated till you connect a load board.`,
          brief: `Offer in${pending.amount ? " at " + money(pending.amount) : ""}. (Simulated.)`,
        }),
        loads: pending.load ? [pending.load] : undefined,
        steps: [
          { label: "Submit offer to broker", simulated: true },
          { label: "Route driver on award", simulated: true },
          { label: "Track load to delivery", simulated: true },
        ],
      };
    case "book_repair":
      return {
        speak: say(P, {
          core: "You're set. Booked the shop 9 miles up, bumped your ETA 45 minutes, and let the broker know you'll be late. The booking and that broker ping are simulated for now — connect those plugins and it's all real.",
          brief: "Repair booked, ETA +45m, broker notified. (Simulated.)",
        }),
        steps: [
          { label: "Book appointment", simulated: true },
          { label: "Adjust ETA", simulated: true },
          { label: "Notify broker", simulated: true },
        ],
      };
    default:
      return { speak: say(P, { core: "Done.", brief: "Done." }) };
  }
}

// ---------------- intent classifier ----------------
// Keyword-scored so natural phrasing works. Each intent has weighted phrase
// groups; the highest-scoring intent above threshold wins. Order in the list
// also acts as a tie-breaker (earlier = more specific).

type IntentId =
  | "start_nav"
  | "heading"
  | "earnings"
  | "hos"
  | "weather"
  | "maintenance"
  | "reloads"
  | "fuel"
  | "bid"
  | "book"
  | "loads";

const INTENTS: { id: IntentId; kws: string[]; strong?: string[] }[] = [
  {
    id: "book",
    kws: ["book it", "book the", "book me", "book a", "take this load", "take that load", "grab this", "grab that", "accept the load", "lock it in"],
    strong: ["book it", "take this load", "lock it in"],
  },
  {
    id: "bid",
    kws: ["bid", "offer", "negotiate", "counter", "counteroffer", "make an offer", "send an offer", "what should i offer"],
    strong: ["bid", "counteroffer", "negotiate"],
  },
  {
    id: "reloads",
    kws: ["reload", "backhaul", "back haul", "deadhead", "next load", "load after", "after this load", "near my delivery", "near delivery", "near my destination", "on my way back", "avoid empty"],
    strong: ["reload", "backhaul", "deadhead"],
  },
  {
    id: "fuel",
    kws: ["fuel", "diesel", "def", "fill up", "filling up", "gas station", "truck stop", "pump", "gallon", "cheapest gas", "where to fuel"],
    strong: ["diesel", "fuel", "def"],
  },
  {
    id: "hos",
    kws: ["hours of service", "hours left", "how many hours", "drive time", "hos", "how long can i drive", "cycle", "clock", "reset", "break time", "log book", "logbook", "run out of hours"],
    strong: ["hours of service", "hos", "drive time"],
  },
  {
    id: "weather",
    kws: ["weather", "traffic", "storm", "snow", "ice", "rain", "fog", "wind", "road condition", "delay ahead", "forecast", "closures", "accident ahead"],
    strong: ["weather", "traffic", "forecast"],
  },
  {
    id: "maintenance",
    kws: ["tire", "tyre", "tpms", "pressure", "psi", "maintenance", "repair", "breakdown", "broke down", "check engine", "service center", "mechanic", "oil change", "def light", "warning light"],
    strong: ["tire", "tpms", "breakdown", "check engine"],
  },
  {
    id: "earnings",
    kws: [
      "revenue", "profit", "net profit", "earnings", "income", "take home", "take-home", "paycheck",
      "margin", "how much did i make", "how much have i made", "how much money", "made this week",
      "my money", "bottom line", "p&l", "p and l", "profit and loss", "what did i clear", "what i made",
    ],
    strong: ["revenue", "profit", "earnings", "how much did i make", "net profit", "how much money"],
  },
  {
    id: "heading",
    kws: ["direction", "heading", "which way", "where am i", "how far", "eta", "how long until", "how long till", "how many miles left", "distance to", "current location", "my location", "am i heading", "am i going"],
    strong: ["which way", "where am i", "heading", "eta"],
  },
  {
    id: "start_nav",
    kws: ["navigate", "navigation", "directions", "take me to", "route to", "start route", "start the route", "start my route", "start navigation", "start the nav", "start gps", "gps", "fire up the gps", "begin route", "drive to", "get me to", "gps to", "let's roll", "lets roll", "hit the road", "guide me"],
    strong: ["navigate", "navigation", "start route", "start navigation", "start gps", "directions"],
  },
  {
    id: "loads",
    kws: [
      "load", "loads", "freight", "haul", "available", "any loads", "are there loads", "loads for", "book board", "load board", "on the board",
      "best rate", "best rates", "good rates", "best paying", "highest paying", "high paying", "most profitable", "best move", "best load", "top load",
      "what should i", "what's my best", "whats my best", "find me", "show me", "pick up", "pickup", "tomorrow", "this morning", "opportunit", "paying loads", "rate for", "rates for", "what pays",
      // equipment names help route equipment-specific rate questions here
      "reefer", "flatbed", "dry van", "step deck", "power only", "box truck", "hotshot", "sprinter", "tanker",
    ],
    strong: ["best rate", "best rates", "highest paying", "most profitable", "best move", "any loads", "are there loads", "load board"],
  },
];

// Minimum keyword score before we trust a knowledge-base hit enough to answer
// from it. Scoring is +3 keyword / +2 topic / +1 content per query word, so ~6
// means a couple of solid term matches — enough to beat a coincidental single
// content-word hit while still catching real freight questions.
const KB_MIN_SCORE = 6;

// Consult the shared freight knowledge base (offline, free, no Claude call).
// Returns a spoken reply built from the best-matching entry when it's a strong
// match, or null so the caller falls through to its other handlers.
async function lookupKnowledge(
  raw: string,
  P: Personality,
): Promise<CoPilotResult | null> {
  try {
    const { hits } = await api.copilotKnowledge(raw, 3);
    const top = hits?.[0];
    if (!top || top.score < KB_MIN_SCORE) return null;
    const content = (top.content || "").trim();
    if (!content) return null;
    const brief =
      content.length > 160 ? content.slice(0, 157).trimEnd() + "…" : content;
    return {
      speak: say(P, { core: content, brief }),
    };
  } catch {
    // KB unreachable (offline / server hiccup) — let the caller carry on.
    return null;
  }
}

function classifyIntent(q: string): IntentId | null {
  return classifyIntentDetailed(q)?.id ?? null;
}

// Same scoring as classifyIntent, but also reports whether the winning intent
// matched a STRONG keyword. A strong hit means the driver clearly wants an app
// action or their own data (a load board, cheapest diesel, start GPS, "how much
// did I make") — so we keep the canned reply. A win on only weak/generic words
// (e.g. "what should I do") is shaky, and a solid knowledge-base match should
// win instead so freight questions get real answers.
function classifyIntentDetailed(
  q: string,
): { id: IntentId; score: number; strong: boolean } | null {
  let best: { id: IntentId; score: number; strong: boolean } | null = null;
  for (const intent of INTENTS) {
    let score = 0;
    let strong = false;
    for (const k of intent.kws) if (q.includes(k)) score += 1;
    for (const k of intent.strong ?? [])
      if (q.includes(k)) {
        score += 2;
        strong = true;
      }
    if (score > 0 && (!best || score > best.score))
      best = { id: intent.id, score, strong };
  }
  return best;
}

// ---------------- matchers ----------------

function matchPersonality(q: string): Personality | null {
  if (/(minimal|quiet|brief)\s*(mode)?/.test(q) && /(mode|switch|set|use|go)/.test(q)) return "minimal";
  if (/(dispatcher|professional)\s*(mode)?/.test(q) && /(mode|switch|set|use|go)/.test(q)) return "dispatcher";
  if (/(fleet|company)\s*(mode)?/.test(q) && /(mode|switch|set|use|go)/.test(q)) return "fleet";
  if (/(friendly|copilot|co-pilot|casual)\s*(mode)/.test(q)) return "friendly";
  return null;
}

function matchLearning(q: string, raw: string): CoPilotResult | null {
  // Name
  const nameM = raw.match(/\b(?:call me|my name is|i'm|i am)\s+([A-Z][a-zA-Z]+)\b/);
  if (nameM && /(call me|my name is)/i.test(raw)) {
    const name = nameM[1];
    return {
      speak: `Nice to meet you, ${name}. I'll remember that.`,
      profilePatch: { name },
    };
  }
  // Home base
  const baseM = raw.match(/\b(?:based (?:in|out of)|home base is|i'm out of|operate out of)\s+([A-Za-z .,'-]{2,40})/i);
  if (baseM) {
    const homeBase = baseM[1].trim().replace(/[.?!]$/, "");
    return {
      speak: `Got it — ${homeBase}'s home. I'll keep that in mind.`,
      profilePatch: { homeBase },
    };
  }
  // Preferred equipment
  if (/(i (drive|run|haul|pull)|my (truck|trailer) is|i'm a|prefer)\b/.test(q)) {
    const eq = detectEquipment(q);
    if (eq) {
      return {
        speak: `Good to know — I'll put ${eq} loads front and center from here on.`,
        profilePatch: { preferredEquipment: eq },
      };
    }
  }
  return null;
}

const NAV_MAP: { test: RegExp; route: string; name: string }[] = [
  { test: /(command center|dashboard|home screen|^home$|go home)/, route: "/", name: "the Command Center" },
  { test: /(opportunity|loads? (board|screen|tab)|open loads|show loads|go to loads)/, route: "/loads", name: "the Opportunity Center" },
  { test: /(profit|p&l|profitability|earnings screen)/, route: "/profit", name: "the Profitability Engine" },
  { test: /(dispatcher screen|ai screen)/, route: "/dispatcher", name: "the Dispatcher" },
  { test: /(reload|deadhead) (screen|tab|center)/, route: "/reloads", name: "Deadhead Prevention" },
  { test: /(fuel (screen|tab|intelligence)|open fuel|show fuel)/, route: "/fuel", name: "Fuel Intelligence" },
  { test: /(map|navigation|gps|route screen)/, route: "/navigation", name: "Profit Navigation" },
  { test: /(document|bol|b\.o\.l|proof of delivery|pod|paperwork|scan (a |the |my )?(doc|bill|paper))/, route: "/documents", name: "Documents" },
  { test: /(plugin|integration)/, route: "/integrations", name: "the Plugin Engine" },
  { test: /(profile|company|my account|settings)/, route: "/profile", name: "your Company Profile" },
];

function matchNavigation(q: string): { route: string; name: string } | null {
  // Only treat as navigation when the driver is clearly asking to open a screen.
  if (!/(open|show|go to|take me to|pull up|switch to|navigate to|bring up)\b/.test(q)) {
    // Allow bare "fuel screen" style too via NAV_MAP explicit phrases.
  }
  for (const n of NAV_MAP) {
    if (n.test.test(q) && /(open|show|go to|take me to|pull up|switch to|bring up|scan|screen|tab|center|engine)\b/.test(q)) {
      return { route: n.route, name: n.name };
    }
  }
  return null;
}

// Assemble a compact, plain-text snapshot of the driver's real situation so the
// LLM can answer with actual numbers instead of guessing. Everything is pulled
// defensively — any piece that isn't available just gets skipped.
async function buildFacts(ctx: CoPilotContext): Promise<string> {
  const lines: string[] = [];
  const p = ctx.profile;
  if (p.name) lines.push(`Driver's name: ${p.name}.`);
  if (p.homeBase) lines.push(`Home base: ${p.homeBase}.`);
  if (p.preferredEquipment) lines.push(`Preferred equipment: ${p.preferredEquipment}.`);

  try {
    const loads = await ctx.data.loads();
    if (loads.length) {
      const t = loads[0];
      lines.push(
        `Top load on the board: ${t.originCity}, ${t.originState} → ${t.destCity}, ${t.destState}, ${t.equipment}, pays ${money(t.rate)} (net ${money(t.netProfit)}, ${t.allInRpm.toFixed(2)}/mi). ${loads.length} loads available total.`,
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const dash = await ctx.data.dashboard();
    const w = dash.weekly;
    if (w.loadsCompleted > 0) {
      const margin = w.revenue ? Math.round((w.netProfit / w.revenue) * 100) : 0;
      const rpm = w.miles ? (w.revenue / w.miles).toFixed(2) : "0.00";
      lines.push(
        `Dashboard / this week: ${w.loadsCompleted} loads completed, ${money(w.revenue)} revenue, ${money(w.netProfit)} net profit, ${margin}% margin, ${w.miles.toLocaleString()} miles driven (${w.deadheadMiles.toLocaleString()} of them deadhead), about $${rpm} revenue per mile.`,
      );
    } else {
      lines.push("Dashboard: no loads booked yet this week, so revenue and net are still at zero.");
    }
  } catch {
    /* ignore */
  }
  try {
    const reloads = await ctx.data.reloads();
    if (reloads.length) {
      const r = reloads[0];
      lines.push(
        `Reloads near the drop: ${reloads.length} available. Best is ${r.originCity}, ${r.originState} → ${r.destCity}, ${r.destState}, ${money(r.rate)} (net ${money(r.netProfit)}), ${r.deadheadMiles} mi deadhead.`,
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const fuel = await ctx.data.fuel();
    const onRoute = fuel.stations.find((s) => s.onRoute) ?? fuel.stations[0];
    if (onRoute) {
      lines.push(
        `Cheapest diesel: ${onRoute.name}, ${onRoute.city}, ${onRoute.state} at $${onRoute.price.toFixed(2)}/gal (national avg $${fuel.nationalAvg.toFixed(2)}).`,
      );
    }
  } catch {
    /* ignore */
  }
  try {
    const carrier = await ctx.data.carrier();
    if (carrier?.insuranceExpiry) {
      const days = Math.ceil((new Date(carrier.insuranceExpiry).getTime() - Date.now()) / 86400000);
      lines.push(`Insurance expires in ${days} day${days === 1 ? "" : "s"}.`);
    }
  } catch {
    /* ignore */
  }
  return lines.join("\n");
}

// LLM slot: the open-ended brain. When the rules engine can't confidently
// answer, this hands the question to Claude — called straight from the driver's
// own device using THEIR per-device Anthropic key (Plugin Engine). Each person
// pays only for their own usage; nobody shares a server key. No key on the
// device → returns null → the app falls back to its free built-in reply. No
// key, no cost, still works.
// Routes the Co-Pilot's brain is allowed to open via a <<go:/route>> token.
// Anything outside this allowlist is ignored (a hallucinated route never
// navigates the driver somewhere that doesn't exist).
const ALLOWED_ROUTES = new Set([
  "/",
  "/loads",
  "/reloads",
  "/profit",
  "/fuel",
  "/navigation",
  "/documents",
  "/integrations",
  "/profile",
]);

// Pull a single control token out of Claude's reply, returning the cleaned
// spoken text and the route to navigate to (if the token was valid).
function extractNavigation(reply: string): { speak: string; navigate?: string } {
  let navigate: string | undefined;
  const speak = reply
    .replace(/<<\s*go\s*:\s*([^>]+?)\s*>>/gi, (_m, route: string) => {
      const r = route.trim();
      if (!navigate && ALLOWED_ROUTES.has(r)) navigate = r;
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return navigate ? { speak, navigate } : { speak };
}

export const llm: LlmResolver | null = async (input, ctx) => {
  try {
    const facts = await buildFacts(ctx);

    // Server-first: every subscriber gets the Claude brain for free using the
    // company's own key (ANTHROPIC_API_KEY on the server). A power user who has
    // pasted their OWN Anthropic key in the Plugin Engine overrides this and
    // bills their own account, calling Claude straight from their device.
    let reply: string | null = null;
    if (claudeBrainReady()) {
      reply = await askClaude(input, facts, ctx.profile.personality);
    } else {
      const res = await api.copilotLlm(input, facts, ctx.profile.personality);
      reply = res.speak;
    }

    if (reply) {
      const { speak, navigate } = extractNavigation(reply);
      if (speak) return { speak, navigate };
    }
  } catch {
    /* fall through to built-in reply */
  }
  return null;
};

// Proactive, spoken-style alerts built from REAL data (insurance expiry, cheap
// fuel ahead, a strong load on the board). Used for the opening greeting.
export async function proactiveAlerts(ctx: CoPilotContext): Promise<string[]> {
  const out: string[] = [];
  try {
    const carrier = await ctx.data.carrier();
    if (carrier?.insuranceExpiry) {
      const days = Math.ceil((new Date(carrier.insuranceExpiry).getTime() - Date.now()) / 86400000);
      if (days >= 0 && days <= 30) out.push(`your insurance is up in ${days} day${days === 1 ? "" : "s"}, so keep that on your radar.`);
    }
  } catch {
    /* ignore */
  }
  try {
    const loads = await ctx.data.loads();
    const t = loads[0];
    if (t) out.push(`there's a solid one on the board — ${t.originCity} to ${t.destCity}, nets ${money(t.netProfit)}.`);
  } catch {
    /* ignore */
  }
  return out.slice(0, 2);
}
