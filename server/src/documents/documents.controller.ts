import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

class ScanDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() imageData?: string; // base64 data URL
  @IsOptional() @IsString() loadId?: string;
  @IsOptional() @IsString() bookingId?: string;
  @IsOptional() @IsString() ocrKey?: string; // per-driver OCR key from Plugins
}

class EmailPackageDto {
  @IsString() to!: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() message?: string;
}

class UpdateDocDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() bolNumber?: string;
  @IsOptional() @IsString() proNumber?: string;
  @IsOptional() @IsString() shipper?: string;
  @IsOptional() @IsString() consignee?: string;
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsInt() @Min(0) pieceCount?: number;
  @IsOptional() @IsInt() @Min(0) weightLbs?: number;
  @IsOptional() @IsString() shipDate?: string;
  @IsOptional() @IsString() deliveryDate?: string;
  @IsOptional() @IsBoolean() signaturePresent?: boolean;
  @IsOptional() @IsString() signedBy?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Post('scan')
  scan(@CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.docs.scan(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.docs.list(user);
  }

  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser) {
    return this.docs.jobs(user);
  }

  @Get('jobs/:jobId/package')
  jobPackage(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.docs.jobPackage(user, jobId);
  }

  @Post('jobs/:jobId/email')
  emailPackage(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() dto: EmailPackageDto,
  ) {
    return this.docs.emailJobPackage(user, jobId, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.getOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocDto,
  ) {
    return this.docs.update(user, id, dto as Record<string, any>);
  }

  @Post(':id/invoice')
  stageInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.docs.stageInvoice(user, id);
  }
}
