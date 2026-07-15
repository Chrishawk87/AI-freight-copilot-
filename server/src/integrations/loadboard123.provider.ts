import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoadBoardProvider, ProviderLoad } from './load-board.provider';

// 123Loadboard partner-API skeleton. Stays dormant until LOADBOARD123_API_KEY
// is set. 123Loadboard exposes a partner API (search loads, post trucks, check
// rates) — request access via partner-integrations@123loadboard.com, then fill
// in fetchLoads() with the real call + response mapping. Everything downstream
// already consumes ProviderLoad.
@Injectable()
export class Loadboard123Provider implements LoadBoardProvider {
  readonly name = '123Loadboard';

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return !!this.config.get<string>('LOADBOARD123_API_KEY');
  }

  async fetchLoads(): Promise<ProviderLoad[]> {
    if (!this.isEnabled()) return [];
    // const key = this.config.get<string>('LOADBOARD123_API_KEY');
    // const res = await fetch('https://api.123loadboard.com/loads/search', {
    //   headers: { Authorization: `Bearer ${key}` },
    // });
    // const json = await res.json();
    // return json.loads.map(map123LoadToProviderLoad);
    return [];
  }
}
