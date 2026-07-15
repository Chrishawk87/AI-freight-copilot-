import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

  activeProviders() {
    return this.providers.filter((p) => p.isEnabled()).map((p) => p.name);
  }

  /** Pull from every enabled provider and upsert into the DB. */
  async syncLoads(): Promise<number> {
    let count = 0;
    for (const provider of this.providers) {
      if (!provider.isEnabled()) continue;
      let loads;
      try {
        loads = await provider.fetchLoads();
      } catch (e) {
        this.logger.error(`Provider ${provider.name} failed: ${e}`);
        continue;
      }
      for (const l of loads) {
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
          },
          update: {
            rate: l.rate,
            demandIndex: l.demandIndex,
            reloadIndex: l.reloadIndex,
          },
        });
        count++;
      }
    }
    this.logger.log(`Synced ${count} loads from ${this.activeProviders().join(', ') || 'no providers'}`);
    return count;
  }

  private async seedFuelIfEmpty() {
    const existing = await this.prisma.fuelStation.count();
    if (existing > 0) return;
    await this.prisma.fuelStation.createMany({ data: SIMULATED_FUEL });
  }
}
