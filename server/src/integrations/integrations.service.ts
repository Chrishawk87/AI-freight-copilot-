import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  LOAD_BOARD_PROVIDERS,
  LoadBoardProvider,
} from './load-board.provider';
import { SIMULATED_FUEL } from './seed-loads';

@Injectable()
export class IntegrationsService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOAD_BOARD_PROVIDERS)
    private readonly providers: LoadBoardProvider[],
  ) {}

  async onModuleInit() {
    // Sync on boot so the DB always has a live feed to serve.
    await this.syncLoads();
    await this.seedFuelIfEmpty();
  }

  // Auto-refresh every 6 hours: pull fresh loads and drop any that fell off the
  // board. Keeps the Opportunity Center honest without any manual action.
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledSync() {
    this.logger.log('Scheduled 6-hour load sync starting…');
    await this.syncLoads();
  }

  activeProviders() {
    return this.providers.filter((p) => p.isEnabled()).map((p) => p.name);
  }

  /**
   * Pull from every enabled provider, upsert what's live, and soft-remove loads
   * that are no longer on the board.
   *
   * Removal is scoped by `source`: for every board we successfully pulled from
   * this run, any active load from that same board that wasn't in the fresh
   * pull is marked inactive (active=false) so it disappears from the feed. We
   * never hard-delete — a booked load keeps its row so bookings stay intact.
   * Boards that errored or returned nothing this run are left untouched.
   */
  async syncLoads(): Promise<{ upserted: number; removed: number }> {
    const seenIds = new Set<string>();
    const seenSources = new Set<string>();
    let upserted = 0;

    for (const provider of this.providers) {
      if (!provider.isEnabled()) continue;
      let loads;
      try {
        loads = await provider.fetchLoads();
      } catch (e) {
        this.logger.error(`Provider ${provider.name} failed: ${e}`);
        continue;
      }
      if (!loads.length) continue;
      for (const l of loads) {
        seenIds.add(l.externalId);
        seenSources.add(l.source);
        await this.prisma.load.upsert({
          where: { externalId: l.externalId },
          create: {
            externalId: l.externalId,
            equipment: l.equipment,
            originCity: l.originCity,
            originState: l.originState,
            destCity: l.destCity,
            destState: l.destState,
            miles: l.miles,
            deadheadMiles: l.deadheadMiles,
            rate: l.rate,
            weightLbs: l.weightLbs,
            broker: l.broker,
            brokerRating: l.brokerRating,
            pickupDate: l.pickupDate,
            source: l.source,
            demandIndex: l.demandIndex,
            reloadIndex: l.reloadIndex,
            isReloadPool: l.isReloadPool ?? false,
            active: true,
            lastSeenAt: new Date(),
          },
          update: {
            rate: l.rate,
            demandIndex: l.demandIndex,
            reloadIndex: l.reloadIndex,
            active: true,
            lastSeenAt: new Date(),
          },
        });
        upserted++;
      }
    }

    // Soft-remove loads that vanished from any board we actually refreshed.
    let removed = 0;
    if (seenIds.size > 0) {
      const stale = await this.prisma.load.updateMany({
        where: {
          active: true,
          source: { in: [...seenSources] },
          externalId: { notIn: [...seenIds] },
        },
        data: { active: false },
      });
      removed = stale.count;
    }

    this.logger.log(
      `Synced ${upserted} loads, removed ${removed} stale from ${this.activeProviders().join(', ') || 'no providers'}`,
    );
    return { upserted, removed };
  }

  private async seedFuelIfEmpty() {
    const existing = await this.prisma.fuelStation.count();
    if (existing > 0) return;
    await this.prisma.fuelStation.createMany({ data: SIMULATED_FUEL });
  }
}
