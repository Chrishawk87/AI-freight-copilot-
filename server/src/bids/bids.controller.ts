import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
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

  // Remove a booked load the driver is done with (archives the booking).
  @Delete('bookings/:id')
  removeBooking(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bids.removeBooking(user, id);
  }

  @Get('bids')
  myBids(@CurrentUser() user: AuthUser) {
    return this.bids.myBids(user);
  }
}
