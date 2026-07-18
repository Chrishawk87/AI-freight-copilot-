import { Module } from '@nestjs/common';
import { DispatcherController } from './dispatcher.controller';
import { LoadsService } from '../loads/loads.service';
import { LearningModule } from '../learning/learning.module';

@Module({
  imports: [LearningModule],
  providers: [LoadsService],
  controllers: [DispatcherController],
})
export class DispatcherModule {}
