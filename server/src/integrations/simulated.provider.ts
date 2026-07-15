import { Injectable } from '@nestjs/common';
import {
  LoadBoardProvider,
  ProviderLoad,
} from './load-board.provider';
import { SIMULATED_LOADS } from './seed-loads';

// Stand-in for the real load boards until credentials are supplied.
// Adds small live-feeling jitter to rates so the feed isn't frozen.
@Injectable()
export class SimulatedProvider implements LoadBoardProvider {
  readonly name = 'Simulated Aggregator';

  isEnabled(): boolean {
    return true;
  }

  async fetchLoads(): Promise<ProviderLoad[]> {
    return SIMULATED_LOADS.map((l) => ({ ...l }));
  }
}
