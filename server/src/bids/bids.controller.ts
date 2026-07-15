import { Controller, Get, UseGuards } from '@nestjs/common';
import { BidsService } from './bids.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class BidsController {
  constructor(private readonly bids: BidsService) {}

  @Get('bookings')
  bookings(@CurrentUser() user: AuthUser) {
    return this.bids.myBookings(user);
  }

  @Get('bids')
  myBids(@CurrentUser() user: AuthUser) {
    return this.bids.myBids(user);
  }
}
