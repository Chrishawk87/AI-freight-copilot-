import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OcrService } from './ocr.service';
import { CarrierModule } from '../carrier/carrier.module';

@Module({
  imports: [CarrierModule], // for EmailOauthService (OAuth send)
  providers: [DocumentsService, OcrService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
