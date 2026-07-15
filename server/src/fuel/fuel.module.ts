import { Module } from '@nestjs/common';
import { FuelController } from './fuel.controller';

@Module({
  controllers: [FuelController],
})
export class FuelModule {}
