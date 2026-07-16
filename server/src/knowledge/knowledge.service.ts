import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KNOWLEDGE_SEED } from './knowledge.seed';

export interface MemoryInput {
  category?: string;
  key: string;
  value: string;
  source?: string;
  pinned?: boolean;
}

export interface KnowledgeInput {
  category: string;
  subcategory?: string;
  topic: string;
  content: string;
  keywords?: string;
}

/**
 * The Co-Pilot's persistent memory.
 *
 * SURFACE  — CarrierMemory: per-carrier facts the driver (or the brain) teaches
 *            it. Read on every Co-Pilot call so answers are personal.
 * SUBSURFACE — KnowledgeEntry: the shared freight knowledge base, seeded once
 *            (scope="global") and answerable with no live Claude call. Drivers
 *            can add their own entries (scope=carrierId).
 *
 * Everything here is best-effort and wrapped so a memory hiccup can NEVER break
 * a load lookup or a Co-Pilot reply.
 */
@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Seed the global knowledge base on boot. Idempotent: keyed on seedKey, so
  // every environment (and every one of thousands of tenants) ends up with the
  // same baseline, and edits to the seed roll out on the next deploy.
  async onModuleInit(): Promise<void> {
    try {
      for (const e of KNOWLEDGE_SEED) {
        await this.prisma.knowledgeEntry.upsert({
          where: { seedKey: e.seedKey },
          create: {
            scope: 'global',
            category: e.category,
            subcategory: e.subcategory ?? '',
            topic: e.topic,
            content: e.content,
            keywords: e.keywords,
            source: 'seed',
            seedKey: e.seedKey,
          },
          update: {
            category: e.category,
            subcategory: e.subcategory ?? '',
            topic: e.topic,
            content: e.content,
            keywords: e.keywords,
          },
        });
      }
      this.logger.log(`Knowledge base seeded (${KNOWLEDGE_SEED.length} entries).`);
    } catch (err) {
      // A seed failure (e.g. table not migrated yet) must not crash boot.
      this.logger.warn(`Knowledge seed skipped: ${err}`);
    }
  }

  // ── Carrier memory (surface) ────────────────────────────────────────────────

  async listMemory(carrierId: string) {
    if (!carrierId) return [];
    try {
      return await this.prisma.carrierMemory.findMany({
        where: { carrierId },
        orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      });
    } catch {
      return [];
    }
  }

  async addMemory(carrierId: string, input: MemoryInput) {
    return this.prisma.carrierMemory.create({
      data: {
        carrierId,
        category: input.category?.trim() || 'general',
        key: input.key.trim(),
        value: input.value.trim(),
        source: input.source === 'copilot' ? 'copilot' : 'driver',
        pinned: !!input.pinned,
      },
    });
  }

  async updateMemory(carrierId: string, id: string, input: Partial<MemoryInput>) {
    const existing = await this.prisma.carrierMemory.findFirst({
      where: { id, carrierId },
    });
    if (!existing) return null;
    return this.prisma.carrierMemory.update({
      where: { id },
      data: {
        category: input.category?.trim() || existing.category,
        key: input.key?.trim() || existing.key,
        value: input.value?.trim() ?? existing.value,
        pinned: typeof input.pinned === 'boolean' ? input.pinned : existing.pinned,
      },
    });
  }

  async deleteMemory(carrierId: string, id: string) {
    const existing = await this.prisma.carrierMemory.findFirst({
      where: { id, carrierId },
    });
    if (!existing) return { ok: false };
    await this.prisma.carrierMemory.delete({ where: { id } });
    return { ok: true };
  }

  // ── Knowledge base (subsurface) ──────────────────────────────────────────────

  // The carrier sees the shared global base plus anything they've added.
  async listKnowledge(carrierId: string | null, category?: string) {
    try {
      const where: any = {
        OR: [{ scope: 'global' }, ...(carrierId ? [{ scope: carrierId }] : [])],
      };
      if (category && category !== 'all') where.category = category;
      return await this.prisma.knowledgeEntry.findMany({
        where,
        orderBy: [{ category: 'asc' }, { topic: 'asc' }],
      });
    } catch {
      return [];
    }
  }

  async addKnowledge(carrierId: string, input: KnowledgeInput) {
    return this.prisma.knowledgeEntry.create({
      data: {
        scope: carrierId, // a carrier's own contribution, layered on the global base
        category: input.category.trim(),
        subcategory: input.subcategory?.trim() || '',
        topic: input.topic.trim(),
        content: input.content.trim(),
        keywords: (input.keywords || input.topic).toLowerCase().trim(),
        source: 'driver',
      },
    });
  }

  async deleteKnowledge(carrierId: string, id: string) {
    // A carrier can only remove its OWN additions, never the shared base.
    const existing = await this.prisma.knowledgeEntry.findFirst({
      where: { id, scope: carrierId },
    });
    if (!existing) return { ok: false };
    await this.prisma.knowledgeEntry.delete({ where: { id } });
    return { ok: true };
  }

  // Cheap, offline keyword match — no LLM needed. Scores each entry by how many
  // query words hit its keywords/topic/content, so the brain can pull the right
  // reference even when Claude is unreachable.
  async searchKnowledge(carrierId: string | null, query: string, limit = 5) {
    const q = (query || '').toLowerCase();
    const words = Array.from(
      new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3)),
    );
    if (!words.length) return [];
    const all = await this.listKnowledge(carrierId);
    const scored = all
      .map((e) => {
        const kw = (e.keywords || '').toLowerCase();
        const topic = (e.topic || '').toLowerCase();
        const body = (e.content || '').toLowerCase();
        let score = 0;
        for (const w of words) {
          if (kw.includes(w)) score += 3;
          if (topic.includes(w)) score += 2;
          if (body.includes(w)) score += 1;
        }
        return { e, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.e);
    return scored;
  }

  // Assemble the plain-text block the Co-Pilot injects into its system prompt:
  // the carrier's remembered facts + the knowledge most relevant to THIS message.
  // Spoken-friendly, capped so it never blows the token budget.
  async buildContext(
    carrierId: string | null,
    message: string,
  ): Promise<string> {
    try {
      const parts: string[] = [];

      if (carrierId) {
        const mem = await this.listMemory(carrierId);
        if (mem.length) {
          const lines = mem
            .slice(0, 25)
            .map((m) => `- ${m.key}: ${m.value}`)
            .join('\n');
          parts.push(`What this carrier has taught you (use it, it's true):\n${lines}`);
        }
      }

      const hits = await this.searchKnowledge(carrierId, message, 4);
      if (hits.length) {
        const lines = hits.map((h) => `- ${h.topic}: ${h.content}`).join('\n');
        parts.push(`Relevant freight know-how for this question:\n${lines}`);
      }

      return parts.join('\n\n');
    } catch {
      return '';
    }
  }
}
