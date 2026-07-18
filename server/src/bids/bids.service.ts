import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { LearningService } from '../learning/learning.service';

@Injectable()
export class BidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly learning: LearningService,
  ) {}

  private async resolveLoad(id: string) {
    const load = await this.prisma.load.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    });
    if (!load) throw new NotFoundException('Load not found');
    return load;
  }

  async create(user: AuthUser, loadId: string, amount: number, message?: string) {
    const load = await this.resolveLoad(loadId);
    return this.prisma.bid.create({
      data: {
        amount,
        message: message ?? '',
        loadId: load.id,
        userId: user.id,
      },
    });
  }

  async book(user: AuthUser, loadId: string) {
    if (!user.carrierId) throw new BadRequestException('No carrier profile');
    const load = await this.resolveLoad(loadId);
    const existing = await this.prisma.booking.findFirst({
      where: { loadId: load.id, userId: user.id },
    });
    if (existing) return existing;
    const booking = await this.prisma.booking.create({
      data: {
        loadId: load.id,
        userId: user.id,
        carrierId: user.carrierId,
      },
    });
    // A new booking is fresh revealed-preference signal — drop the cached
    // learning profile so the next recommendation reflects it.
    this.learning.invalidate(user.carrierId);
    return booking;
  }

  async myBookings(user: AuthUser) {
    return this.prisma.booking.findMany({
      where: { userId: user.id, status: { not: 'archived' } },
      include: { load: true },
      orderBy: { bookedAt: 'desc' },
    });
  }

  /**
   * "Remove a load I'm done with." Scoped to the driver's own booking — loads are
   * shared board listings, so we never hard-delete or deactivate the global load
   * out from under other carriers. We archive the booking (soft, reversible in
   * the DB, keeps history) so it drops off the driver's list and dashboard. For a
   * carrier-originated Rate Con load — which belongs to this carrier alone — we
   * also deactivate the load so the synthetic listing doesn't linger.
   */
  async removeBooking(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId: user.id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'archived' },
    });
    await this.prisma.load.updateMany({
      where: { id: booking.loadId, source: 'RateCon' },
      data: { active: false },
    });
    // Booking history changed — refresh the learning profile on next read.
    this.learning.invalidate(user.carrierId);
    return { ok: true };
  }

  async myBids(user: AuthUser) {
    return this.prisma.bid.findMany({
      where: { userId: user.id },
      include: { load: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
