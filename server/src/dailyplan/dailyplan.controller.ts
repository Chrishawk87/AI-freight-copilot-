import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { DailyPlanService } from './dailyplan.service';

@UseGuards(JwtAuthGuard)
@Controller('daily-plan')
export class DailyPlanController {
  constructor(private readonly plan: DailyPlanService) {}

  // Optional lat/lon from the driver's device sharpens the fuel-stop pick.
  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
  ) {
    return this.plan.build(user, {
      lat: lat != null ? Number(lat) : undefined,
      lon: lon != null ? Number(lon) : undefined,
    });
  }
}
