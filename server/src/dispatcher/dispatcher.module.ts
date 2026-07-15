import { Module } from '@nestjs/common';
import { DispatcherController } from './dispatcher.controller';
import { LoadsService } from '../loads/loads.service';

@Module({
  providers: [LoadsService],
  controllers: [DispatcherController],
})
export class DispatcherModule {}
