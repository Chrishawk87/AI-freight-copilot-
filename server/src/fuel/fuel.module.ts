import { Module } from '@nestjs/common';
import { FuelController } from './fuel.controller';
import { FuelPricesService } from './fuel-prices';
import { FuelScrapeService } from './fuel-scrape';

@Module({
  controllers: [FuelController],
  providers: [FuelPricesService, FuelScrapeService],
})
export class FuelModule {}
