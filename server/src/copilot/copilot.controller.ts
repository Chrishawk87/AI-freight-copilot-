import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { UsageService } from '../usage/usage.service';

// The Co-Pilot's open-ended "brain". The rules engine in the app handles the
// common freight asks (loads, reloads, fuel, bids, earnings). When it can't
// confidently answer, the front-end hands the question off here and we ask
// Claude to reply in the driver's voice. If no ANTHROPIC_API_KEY is set, we
// return { speak: null } so the app falls back to its built-in reply — the
// whole feature is plug-and-play and costs nothing until a key is present.

class LlmDto {
  @IsString()
  message: string;

  // A compact, plain-text snapshot of the driver's real situation (top loads,
  // earnings, fuel, carrier basics) assembled on the client. Optional.
  @IsOptional()
  @IsString()
  facts?: string;

  // Which personality the driver picked, so tone can flex a little.
  @IsOptional()
  @IsString()
  personality?: string;
}

// Chris's persona. This is the character the Co-Pilot plays: a sharp, warm
// co-driver — never a corporate chatbot.
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

@UseGuards(JwtAuthGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly usage: UsageService) {}

  @Post('llm')
  async llm(
    @Body() dto: LlmDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ speak: string | null }> {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
      // No key wired — let the app fall back to its built-in reply.
      return { speak: null };
    }

    // Protect the shared Anthropic account: over the monthly cap we decline the
    // paid call and let the app fall back to its free built-in brain.
    const within = await this.usage.withinCap(
      'copilot_llm',
      user.id,
      user.carrierId,
    );
    if (!within) return { speak: null };

    const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001';

    let system = PERSONA;
    if (dto.personality) {
      system += `\n\nThe driver has set your personality to "${dto.personality}". Lean into it, but keep every rule above.`;
    }
    if (dto.facts?.trim()) {
      system += `\n\nHere's what's real for this driver right now (use it when relevant, don't invent beyond it):\n${dto.facts.trim()}`;
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 320,
          system,
          messages: [{ role: 'user', content: dto.message }],
        }),
      });
      if (!res.ok) return { speak: null };
      const data: any = await res.json();
      const text: string | null =
        Array.isArray(data?.content) && data.content[0]?.type === 'text'
          ? String(data.content[0].text || '').trim()
          : null;
      const speak = text && text.length ? text : null;

      // Meter the paid call against the company's shared Anthropic account.
      if (speak) {
        await this.usage.record({
          kind: 'copilot_llm',
          provider: 'anthropic',
          billable: true,
          userId: user.id,
          carrierId: user.carrierId,
        });
      }
      return { speak };
    } catch {
      return { speak: null };
    }
  }
}
