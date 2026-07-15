import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OcrService } from './ocr.service';

@Module({
  providers: [DocumentsService, OcrService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
