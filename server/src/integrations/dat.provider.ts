import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoadBoardProvider, ProviderLoad } from './load-board.provider';

// Example real-integration skeleton. It stays dormant until DAT_API_KEY is set.
// Fill in fetchLoads() with the real DAT API call + response mapping when you
// have credentials — everything downstream already consumes ProviderLoad.
@Injectable()
export class DatProvider implements LoadBoardProvider {
  readonly name = 'DAT';

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('DAT_API_KEY');
  }

  async fetchLoads(): Promise<ProviderLoad[]> {
    if (!this.isEnabled()) return [];
    // const key = this.config.get<string>('DAT_API_KEY');
    // const res = await fetch('https://freight.api.dat.com/...', {
    //   headers: { Authorization: `Bearer ${key}` },
    // });
    // const json = await res.json();
    // return json.matches.map(mapDatLoadToProviderLoad);
    return [];
  }
}
