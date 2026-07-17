import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Sane defaults for a standard US 53' dry van tractor-trailer, used when a
// field is omitted on create.
const DEFAULTS = {
  heightIn: 162, // 13'6"
  widthIn: 102, // 8'6"
  lengthIn: 636, // 53'
  weightLbs: 80000,
  axles: 5,
};

export type TruckInput = {
  label?: string;
  heightIn?: number;
  widthIn?: number;
  lengthIn?: number;
  weightLbs?: number;
  axles?: number;
  hazmatClass?: string | null;
  isDefault?: boolean;
};

function clampInt(n: any, lo: number, hi: number, fallback: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

@Injectable()
export class VehicleService {
  constructor(private readonly prisma: PrismaService) {}

  async list(carrierId: string) {
    return this.prisma.truck.findMany({
      where: { carrierId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(carrierId: string, input: TruckInput) {
    const data = {
      carrierId,
      label: (input.label || 'My Truck').slice(0, 80),
      heightIn: clampInt(input.heightIn, 60, 240, DEFAULTS.heightIn),
      widthIn: clampInt(input.widthIn, 60, 144, DEFAULTS.widthIn),
      lengthIn: clampInt(input.lengthIn, 120, 960, DEFAULTS.lengthIn),
      weightLbs: clampInt(input.weightLbs, 5000, 200000, DEFAULTS.weightLbs),
      axles: clampInt(input.axles, 2, 12, DEFAULTS.axles),
      hazmatClass: input.hazmatClass ?? null,
      isDefault: !!input.isDefault,
    };

    // First truck for a carrier is always the default.
    const count = await this.prisma.truck.count({ where: { carrierId } });
    if (count === 0) data.isDefault = true;

    const truck = await this.prisma.truck.create({ data });
    if (truck.isDefault) await this.clearOtherDefaults(carrierId, truck.id);
    return truck;
  }

  async update(carrierId: string, id: string, input: TruckInput) {
    await this.owned(carrierId, id);
    const patch: any = {};
    if (input.label != null) patch.label = String(input.label).slice(0, 80);
    if (input.heightIn != null)
      patch.heightIn = clampInt(input.heightIn, 60, 240, DEFAULTS.heightIn);
    if (input.widthIn != null)
      patch.widthIn = clampInt(input.widthIn, 60, 144, DEFAULTS.widthIn);
    if (input.lengthIn != null)
      patch.lengthIn = clampInt(input.lengthIn, 120, 960, DEFAULTS.lengthIn);
    if (input.weightLbs != null)
      patch.weightLbs = clampInt(
        input.weightLbs,
        5000,
        200000,
        DEFAULTS.weightLbs,
      );
    if (input.axles != null)
      patch.axles = clampInt(input.axles, 2, 12, DEFAULTS.axles);
    if (input.hazmatClass !== undefined) patch.hazmatClass = input.hazmatClass;
    if (input.isDefault != null) patch.isDefault = !!input.isDefault;

    const truck = await this.prisma.truck.update({ where: { id }, data: patch });
    if (truck.isDefault) await this.clearOtherDefaults(carrierId, truck.id);
    return truck;
  }

  async remove(carrierId: string, id: string) {
    const truck = await this.owned(carrierId, id);
    await this.prisma.truck.delete({ where: { id } });
    // If we deleted the default, promote the oldest remaining truck.
    if (truck.isDefault) {
      const next = await this.prisma.truck.findFirst({
        where: { carrierId },
        orderBy: { createdAt: 'asc' },
      });
      if (next)
        await this.prisma.truck.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
    }
    return { ok: true };
  }

  private async owned(carrierId: string, id: string) {
    const truck = await this.prisma.truck.findFirst({
      where: { id, carrierId },
    });
    if (!truck) throw new NotFoundException('Truck not found');
    return truck;
  }

  private async clearOtherDefaults(carrierId: string, keepId: string) {
    await this.prisma.truck.updateMany({
      where: { carrierId, isDefault: true, id: { not: keepId } },
      data: { isDefault: false },
    });
  }
}
