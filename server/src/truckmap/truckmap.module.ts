import { Module } from '@nestjs/common';
import { FuelModule } from '../fuel/fuel.module';
import { PoiController } from './poi/poi.controller';
import { PoiService } from './poi/poi.service';
import { OverpassIngestService } from './ingestion/overpass.ingest';
import { OrsProvider } from './routing/ors.provider';
import { OsrmProvider } from './routing/osrm.provider';
import { RoutingService } from './routing/routing.service';
import { RoutingController } from './routing/routing.controller';
import { VehicleService } from './vehicle/vehicle.service';
import { VehicleController } from './vehicle/vehicle.controller';
import { FuelIntelService } from './fuel/fuel-intel.service';
import { FuelController } from './fuel/fuel.controller';

@Module({
  imports: [FuelModule],
  controllers: [
    PoiController,
    RoutingController,
    VehicleController,
    FuelController,
  ],
  providers: [
    PoiService,
    OverpassIngestService,
    OrsProvider,
    OsrmProvider,
    RoutingService,
    VehicleService,
    FuelIntelService,
  ],
  exports: [
    PoiService,
    OverpassIngestService,
    RoutingService,
    VehicleService,
    FuelIntelService,
  ],
})
export class TruckMapModule {}
