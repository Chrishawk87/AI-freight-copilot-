import { Module } from '@nestjs/common';
import { PoiController } from './poi/poi.controller';
import { PoiService } from './poi/poi.service';
import { OverpassIngestService } from './ingestion/overpass.ingest';
import { OrsProvider } from './routing/ors.provider';
import { OsrmProvider } from './routing/osrm.provider';
import { RoutingService } from './routing/routing.service';
import { RoutingController } from './routing/routing.controller';
import { VehicleService } from './vehicle/vehicle.service';
import { VehicleController } from './vehicle/vehicle.controller';

@Module({
  controllers: [PoiController, RoutingController, VehicleController],
  providers: [
    PoiService,
    OverpassIngestService,
    OrsProvider,
    OsrmProvider,
    RoutingService,
    VehicleService,
  ],
  exports: [PoiService, OverpassIngestService, RoutingService, VehicleService],
})
export class TruckMapModule {}
