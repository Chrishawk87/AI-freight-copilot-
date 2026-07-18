import { Module } from '@nestjs/common';
import { TruckMapModule } from '../truckmap/truckmap.module';
import { FuelModule } from '../fuel/fuel.module';
import { DailyPlanService } from './dailyplan.service';
import { DailyPlanController } from './dailyplan.controller';

@Module({
  imports: [TruckMapModule, FuelModule],
  controllers: [DailyPlanController],
  providers: [DailyPlanService],
  exports: [DailyPlanService],
})
export class DailyPlanModule {}
