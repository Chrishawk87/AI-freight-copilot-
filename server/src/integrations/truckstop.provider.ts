import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoadBoardProvider, ProviderLoad } from './load-board.provider';

// Truckstop partner-API skeleton. Stays dormant until TRUCKSTOP_API_KEY is set.
// Truckstop offers a partner API (approval required) for load search and
// posting. Once approved, fill in fetchLoads() with the real call + response
// mapping — everything downstream already consumes ProviderLoad.
@Injectable()
export class TruckstopProvider implements LoadBoardProvider {
  readonly name = 'Truckstop';

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('TRUCKSTOP_API_KEY');
  }

  async fetchLoads(): Promise<ProviderLoad[]> {
    if (!this.isEnabled()) return [];
    // const key = this.config.get<string>('TRUCKSTOP_API_KEY');
    // const res = await fetch('https://api.truckstop.com/searchLoads', {
    //   headers: { Authorization: `Bearer ${key}` },
    // });
    // const json = await res.json();
    // return json.loads.map(mapTruckstopLoadToProviderLoad);
    return [];
  }
}
