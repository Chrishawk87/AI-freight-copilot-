import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { UsageService } from './usage.service';

// Read-only view of this tenant's AI usage for the current month, so the
// operator (and the driver) can see how much of the shared OCR / Co-Pilot
// allowance has been used and how much is left.
@UseGuards(JwtAuthGuard)
@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    return this.usage.summary(user.id, user.carrierId);
  }
}
