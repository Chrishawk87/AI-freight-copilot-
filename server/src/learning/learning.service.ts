import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import {
  buildLearningProfile,
  EMPTY_PROFILE,
  LearningProfile,
} from './learning';

// Serves a per-carrier LearningProfile distilled from that carrier's own booking
// history. Cached in-memory with a short TTL so the profile is computed at most
// once per carrier per window — each carrier is isolated, so this scales to
// thousands without cross-tenant work or a per-request DB scan on every load.
@Injectable()
export class LearningService {
  private cache = new Map<string, { profile: LearningProfile; at: number }>();
  private readonly TTL_MS = 5 * 60 * 1000; // recompute at most every 5 minutes

  constructor(private readonly prisma: PrismaService) {}

  async profile(user: AuthUser): Promise<LearningProfile> {
    const carrierId = user.carrierId;
    if (!carrierId) return EMPTY_PROFILE;

    const hit = this.cache.get(carrierId);
    if (hit && Date.now() - hit.at < this.TTL_MS) return hit.profile;

    // Learn from real, non-archived bookings for this carrier only.
    const bookings = await this.prisma.booking.findMany({
      where: { carrierId, status: { not: 'archived' } },
      include: { load: true },
    });
    const profile = buildLearningProfile(
      bookings.map((b) => ({ bookedAt: b.bookedAt, load: b.load })),
    );
    this.cache.set(carrierId, { profile, at: Date.now() });
    return profile;
  }

  // Drop a carrier's cached profile so the next read reflects a just-booked load
  // immediately (called after a booking so learning feels live).
  invalidate(carrierId: string | null | undefined): void {
    if (carrierId) this.cache.delete(carrierId);
  }
}
