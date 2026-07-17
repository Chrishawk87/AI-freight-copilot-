import { Module } from '@nestjs/common';
import { PoiController } from './poi/poi.controller';
import { PoiService } from './poi/poi.service';
import { OverpassIngestService } from './ingestion/overpass.ingest';

@Module({
  controllers: [PoiController],
  providers: [PoiService, OverpassIngestService],
  exports: [PoiService, OverpassIngestService],
})
export class TruckMapModule {}
