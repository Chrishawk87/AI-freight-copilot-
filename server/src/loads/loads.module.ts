import { Module } from '@nestjs/common';
import { LoadsService } from './loads.service';
import { LoadsController } from './loads.controller';
import { BidsModule } from '../bids/bids.module';

@Module({
  imports: [BidsModule],
  providers: [LoadsService],
  controllers: [LoadsController],
})
export class LoadsModule {}
