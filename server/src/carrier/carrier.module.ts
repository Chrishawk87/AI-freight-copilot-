import { Module } from '@nestjs/common';
import { CarrierController } from './carrier.controller';

@Module({
  controllers: [CarrierController],
})
export class CarrierModule {}
