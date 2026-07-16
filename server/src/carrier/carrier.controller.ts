import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { encryptSecret } from '../common/secret';

class UpdateCarrierDto {
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() dotNumber?: string;
  @IsOptional() @IsString() mcNumber?: string;
  @IsOptional() @IsString() insuranceProvider?: string;
  @IsOptional() @IsString() insuranceExpiry?: string;
  @IsOptional() @IsBoolean() w9OnFile?: boolean;
  @IsOptional() @IsArray() serviceAreas?: string[];
  @IsOptional() @IsNumber() mpg?: number;
  @IsOptional() @IsNumber() fixedCostPerMile?: number;
  // Per-carrier outbound email (their own provider).
  @IsOptional() @IsString() smtpHost?: string;
  @IsOptional() @IsInt() smtpPort?: number;
  @IsOptional() @IsBoolean() smtpSecure?: boolean;
  @IsOptional() @IsString() smtpUser?: string;
  @IsOptional() @IsString() smtpPass?: string; // plaintext app password; encrypted before store
}

// Never leak the stored password. Expose only whether email is connected.
function serialize(carrier: any) {
  if (!carrier) return null;
  const { smtpPass, ...rest } = carrier;
  return {
    ...rest,
    serviceAreas: JSON.parse(carrier.serviceAreas || '[]'),
    emailConnected: !!(carrier.smtpHost && carrier.smtpUser && smtpPass),
  };
}

@UseGuards(JwtAuthGuard)
@Controller('carrier')
export class CarrierController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    const carrier = await this.prisma.carrier.findUnique({
      where: { id: user.carrierId },
      include: { drivers: true, equipment: true },
    });
    return serialize(carrier);
  }

  @Put()
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateCarrierDto) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    const data: any = { ...dto };
    if (dto.serviceAreas) data.serviceAreas = JSON.stringify(dto.serviceAreas);

    // Email credentials: only touch the password when a new one is supplied,
    // and always store it encrypted. Default the SMTP login to the email.
    if (dto.smtpPass !== undefined) {
      if (dto.smtpPass) data.smtpPass = encryptSecret(dto.smtpPass);
      else delete data.smtpPass; // empty = leave existing password untouched
    }
    if ((dto.smtpUser === undefined || dto.smtpUser === '') && dto.contactEmail) {
      data.smtpUser = dto.contactEmail;
    }

    const carrier = await this.prisma.carrier.update({
      where: { id: user.carrierId },
      data,
      include: { drivers: true, equipment: true },
    });
    return serialize(carrier);
  }
}
