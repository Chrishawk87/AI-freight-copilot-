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
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

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
}

function serialize(carrier: any) {
  if (!carrier) return null;
  return { ...carrier, serviceAreas: JSON.parse(carrier.serviceAreas || '[]') };
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
    const carrier = await this.prisma.carrier.update({
      where: { id: user.carrierId },
      data,
      include: { drivers: true, equipment: true },
    });
    return serialize(carrier);
  }
}
