import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';

@Injectable()
export class BidsService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.booking.create({
      data: {
        loadId: load.id,
        userId: user.id,
        carrierId: user.carrierId,
      },
    });
  }

  async myBookings(user: AuthUser) {
    return this.prisma.booking.findMany({
      where: { userId: user.id },
      include: { load: true },
      orderBy: { bookedAt: 'desc' },
    });
  }

  async myBids(user: AuthUser) {
    return this.prisma.bid.findMany({
      where: { userId: user.id },
      include: { load: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
