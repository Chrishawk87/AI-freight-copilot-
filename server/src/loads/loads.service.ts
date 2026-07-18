import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { scoreLoad, ScoredLoad } from '../scoring/scoring';
import { AuthUser } from '../auth/current-user.decorator';
import { LearningService } from '../learning/learning.service';
import { applyLearning, LearningProfile } from '../learning/learning';

@Injectable()
export class LoadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly learning: LearningService,
  ) {}

  private opts(user: AuthUser) {
    const c = user.carrier;
    return {
      mpg: c?.mpg ?? 6.5,
      fixedCostPerMile: c?.fixedCostPerMile ?? 0.72,
    };
  }

  // Score, then re-rank with the carrier's learned preferences. On a cold-start
  // carrier the profile has zero confidence, so applyLearning is a no-op.
  private rank(
    loads: any[],
    user: AuthUser,
    profile: LearningProfile,
  ): ScoredLoad[] {
    const opts = this.opts(user);
    return loads
      .map((l) => applyLearning(scoreLoad(l, opts), profile))
      .sort((a, b) => b.overall - a.overall);
  }

  async list(user: AuthUser, equipment?: string): Promise<ScoredLoad[]> {
    // Carrier-originated Rate Con loads are the driver's own committed freight,
    // not open opportunities — they belong on the dashboard/booked view, not in
    // this ranked feed of bookable loads.
    const where: any = {
      isReloadPool: false,
      active: true,
      source: { not: 'RateCon' },
    };
    if (equipment && equipment !== 'All') where.equipment = equipment;
    const [loads, profile] = await Promise.all([
      this.prisma.load.findMany({ where }),
      this.learning.profile(user),
    ]);
    return this.rank(loads, user, profile);
  }

  async reloads(user: AuthUser, radius = 200): Promise<ScoredLoad[]> {
    const [loads, profile] = await Promise.all([
      this.prisma.load.findMany({
        where: { isReloadPool: true, deadheadMiles: { lte: radius } },
      }),
      this.learning.profile(user),
    ]);
    return this.rank(loads, user, profile);
  }

  async getOne(user: AuthUser, id: string): Promise<ScoredLoad> {
    const load = await this.prisma.load.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    });
    if (!load) throw new NotFoundException('Load not found');
    const profile = await this.learning.profile(user);
    return applyLearning(scoreLoad(load, this.opts(user)), profile);
  }

  async dashboard(user: AuthUser) {
    const bookings = await this.prisma.booking.findMany({
      where: { userId: user.id, status: { not: 'archived' } },
      include: { load: true },
    });
    const scored = bookings.map((b) => scoreLoad(b.load, this.opts(user)));
    const revenue = scored.reduce((s, l) => s + l.rate, 0);
    const miles = scored.reduce((s, l) => s + l.miles + l.deadheadMiles, 0);
    const deadheadMiles = scored.reduce((s, l) => s + l.deadheadMiles, 0);
    const netProfit = scored.reduce((s, l) => s + l.netProfit, 0);

    const top = await this.list(user);
    return {
      weekly: {
        revenue,
        miles,
        deadheadMiles,
        netProfit,
        loadsCompleted: bookings.length,
      },
      topLoads: top.slice(0, 3),
    };
  }
}
