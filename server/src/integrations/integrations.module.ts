import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';
import { SimulatedProvider } from './simulated.provider';
import { DatProvider } from './dat.provider';
import { Loadboard123Provider } from './loadboard123.provider';
import { TruckstopProvider } from './truckstop.provider';
import {
  LOAD_BOARD_PROVIDERS,
  LoadBoardProvider,
} from './load-board.provider';

@Module({
  providers: [
    SimulatedProvider,
    DatProvider,
    Loadboard123Provider,
    TruckstopProvider,
    {
      // Register every provider here. Real ones activate when their key is set.
      provide: LOAD_BOARD_PROVIDERS,
      useFactory: (
        simulated: SimulatedProvider,
        dat: DatProvider,
        loadboard123: Loadboard123Provider,
        truckstop: TruckstopProvider,
        config: ConfigService,
      ): LoadBoardProvider[] => {
        const real: LoadBoardProvider[] = [dat, loadboard123, truckstop];
        const providers: LoadBoardProvider[] = [...real];
        // Only fall back to the simulated feed when no real board is configured.
        const anyReal = real.some((p) => p.isEnabled());
        if (!anyReal) providers.push(simulated);
        return providers;
      },
      inject: [
        SimulatedProvider,
        DatProvider,
        Loadboard123Provider,
        TruckstopProvider,
        ConfigService,
      ],
    },
    IntegrationsService,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
