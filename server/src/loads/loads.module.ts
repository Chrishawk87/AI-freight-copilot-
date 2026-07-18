import { Module } from '@nestjs/common';
import { LoadsService } from './loads.service';
import { LoadsController } from './loads.controller';
import { BidsModule } from '../bids/bids.module';
import { LearningModule } from '../learning/learning.module';

@Module({
  imports: [BidsModule, LearningModule],
  providers: [LoadsService],
  controllers: [LoadsController],
})
export class LoadsModule {}
