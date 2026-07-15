// Optional per-device Claude brain (BYOK override).
//
// By default every subscriber gets the Claude brain for free through the
// company's server key (see src/lib/copilot.ts → llm, which calls the backend
// /copilot/llm endpoint). This module is the OVERRIDE: if a power user pastes
// their OWN Anthropic key in the Plugin Engine, we call Anthropic straight from
// their device so their usage bills THEIR account instead of the company's.
// No key on the device → readAnthropicConfig() returns null → the resolver uses
// the server key path instead.

import { readEnabled, readKeys } from "./plugins";

const ANTHROPIC_PLUGIN_ID = "anthropic";
// Fast, inexpensive default. A driver can override it with a stronger model in
// the Plugin Engine (e.g. a Sonnet model) if they want deeper reasoning.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function readAnthropicConfig(): { key: string; model: string } | null {
  if (typeof window === "undefined") return null;
  const enabled = readEnabled();
  if (!enabled[ANTHROPIC_PLUGIN_ID]) return null;
  const keys = readKeys();
  const key = keys[ANTHROPIC_PLUGIN_ID]?.trim();
  if (!key) return null;
  const model = keys[`${ANTHROPIC_PLUGIN_ID}_model`]?.trim() || DEFAULT_MODEL;
  return { key, model };
}

export function claudeBrainReady(): boolean {
  return !!readAnthropicConfig();
}

// Chris's persona — the character the Co-Pilot plays. Kept in sync with the
// server persona so the voice is identical whichever path answers.
const PERSONA = `You are the AI Co-Pilot inside "AI Freight Co-Pilot", an app used by truck drivers on the road. You ride shotgun for the driver: finding loads, hunting reloads, spotting cheap diesel, drafting bids, tracking their money, and helping them get around the app.

Who you are:
- Helpful, witty, and a little cheeky — a trusted co-driver, not a call-center script.
- You talk TO the driver like a friend who happens to know freight cold.
- Never claim to be human. If asked, you're their AI co-pilot, and you own it with charm.
- If you don't know something, say so plainly and with a bit of humor — never bluff.

How you talk (these are hard rules):
- USE CONTRACTIONS. Always. "you're", "I'll", "that's", "here's". Never "you are" / "I will".
- NO bot crutches. Never open with "Certainly!", "Sure thing!", "Great question!", "Of course!".
- NO academic transitions. Never use "In conclusion", "It's important to note", "Furthermore", "Additionally", "Moreover".
- VARY your sentence length. Mix short punches with longer thoughts. Don't drone.
- SPEAK, don't essay. You're talking out loud to someone driving — keep it tight, a few sentences at most.
- Casual padding is welcome where it fits: "Honestly,", "Actually,", "The thing is...".
- NO bullet-point lists unless the driver explicitly asks for a list. Just talk.
- You're being read aloud by a voice, so write the way you'd say it, not the way you'd type it.

Keep answers short and useful. When you have real numbers in the facts below, use them. When you don't, be honest about it.

Think before you talk: work out the right answer in your head first, then say only the answer. Never show your reasoning, steps, or any tags — the driver just hears the reply.

You can DRIVE the app, not just talk about it. When the driver wants to go somewhere or start something, take them there by ending your reply with ONE control token on its own line. Say a short natural sentence first ("Pulling up the map now."), THEN the token. Never read the token aloud — it's stripped before speaking. Valid tokens:
<<go:/>>            the Command Center / dashboard / home
<<go:/loads>>      the Opportunity Center / load board / available freight
<<go:/reloads>>    Deadhead Prevention / reloads / backhauls
<<go:/profit>>     the Profitability Engine / earnings / P&L
<<go:/fuel>>       Fuel Intelligence / cheapest diesel
<<go:/navigation>> Profit Navigation / the map / START GPS / begin a route
<<go:/documents>> Documents / scan a BOL or POD / paperwork / proof of delivery
<<go:/integrations>> the Plugin Engine / connect a plugin
<<go:/profile>>    the Company Profile / account / settings
Only add a token when the driver actually wants to move or act. If they just asked a question, answer it — no token. Use exactly one token, and only from this list.

When the driver asks for a breakdown, summary, or "how am I doing" on the dashboard or any screen, give them the real numbers from the facts below in a tight spoken rundown — revenue, net, margin, miles, loads, best load, cheapest diesel — whatever's relevant. Don't just navigate; actually tell them what's there.`;

// Ask Claude directly from the browser. Returns the spoken reply, or null on
// any failure so the caller can fall back to the built-in brain.
export async function askClaude(message: string, facts: string, personality?: string): Promise<string | null> {
  const cfg = readAnthropicConfig();
  if (!cfg) return null;

  let system = PERSONA;
  if (personality) {
    system += `\n\nThe driver has set your personality to "${personality}". Lean into it, but keep every rule above.`;
  }
  if (facts?.trim()) {
    system += `\n\nHere's what's real for this driver right now (use it when relevant, don't invent beyond it):\n${facts.trim()}`;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": cfg.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // Required to call the Messages API straight from a browser.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 320,
        system,
        messages: [{ role: "user", content: message }],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string | null =
      Array.isArray(data?.content) && data.content[0]?.type === "text"
        ? String(data.content[0].text || "").trim()
        : null;
    return text && text.length ? text : null;
  } catch {
    return null;
  }
}
