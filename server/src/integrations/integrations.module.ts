import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';
import { SimulatedProvider } from './simulated.provider';
import { DatProvider } from './dat.provider';
import {
  LOAD_BOARD_PROVIDERS,
  LoadBoardProvider,
} from './load-board.provider';

@Module({
  providers: [
    SimulatedProvider,
    DatProvider,
    {
      // Register every provider here. Real ones activate when their key is set.
      provide: LOAD_BOARD_PROVIDERS,
      useFactory: (
        simulated: SimulatedProvider,
        dat: DatProvider,
        config: ConfigService,
      ): LoadBoardProvider[] => {
        const providers: LoadBoardProvider[] = [dat];
        // Only fall back to the simulated feed when no real board is configured.
        const anyReal = [dat].some((p) => p.isEnabled());
        if (!anyReal) providers.push(simulated);
        return providers;
      },
      inject: [SimulatedProvider, DatProvider, ConfigService],
    },
    IntegrationsService,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
