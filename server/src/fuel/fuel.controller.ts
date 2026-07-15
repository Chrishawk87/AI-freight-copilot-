import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DIESEL_PRICE } from '../scoring/scoring';

@UseGuards(JwtAuthGuard)
@Controller('fuel')
export class FuelController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const stations = await this.prisma.fuelStation.findMany({
      orderBy: { price: 'asc' },
    });
    return { nationalAvg: DIESEL_PRICE, stations };
  }
}
