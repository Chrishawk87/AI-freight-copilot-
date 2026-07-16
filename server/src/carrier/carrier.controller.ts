import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
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
  Min,
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

class DriverDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() cdlClass?: string;
  @IsOptional() @IsString() status?: string;
}

class EquipmentDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsInt() @Min(1900) year?: number;
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

  // Pull registration details straight from the FMCSA carrier registry so the
  // operator can auto-fill their profile instead of typing everything. Requires
  // a free FMCSA API webKey (env FMCSA_WEBKEY). Returns a normalized subset.
  @Get('lookup')
  async lookup(@Query('dot') dot?: string, @Query('mc') mc?: string) {
    const webKey = process.env.FMCSA_WEBKEY;
    if (!webKey) {
      throw new ServiceUnavailableException(
        "DOT lookup isn't configured yet. Add a free FMCSA API webKey as FMCSA_WEBKEY on the server to enable it (mobile.fmcsa.dot.gov).",
      );
    }
    const base = 'https://mobile.fmcsa.dot.gov/qc/services';
    const key = encodeURIComponent(webKey);

    let carrier: any;
    try {
      if (dot && dot.trim()) {
        const res = await fetch(
          `${base}/carriers/${encodeURIComponent(dot.trim())}?webKey=${key}`,
        );
        const json: any = await res.json();
        carrier = json?.content?.carrier;
      } else if (mc && mc.trim()) {
        const res = await fetch(
          `${base}/carriers/docket-number/${encodeURIComponent(mc.trim())}?webKey=${key}`,
        );
        const json: any = await res.json();
        const first = Array.isArray(json?.content) ? json.content[0] : json?.content;
        carrier = first?.carrier ?? first;
      } else {
        throw new BadRequestException('Provide a DOT or MC number to look up.');
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new ServiceUnavailableException(
        'Could not reach the FMCSA carrier registry. Please try again shortly.',
      );
    }

    if (!carrier) {
      throw new NotFoundException(
        'No carrier found for that number in the FMCSA registry.',
      );
    }

    const dotNum = carrier.dotNumber != null ? String(carrier.dotNumber) : dot || '';

    // Resolve an MC/docket number when we looked up by DOT (best-effort).
    let mcNumber = '';
    if (mc && mc.trim()) {
      mcNumber = mc.trim();
    } else if (dotNum) {
      try {
        const res = await fetch(
          `${base}/carriers/${encodeURIComponent(dotNum)}/docket-numbers?webKey=${key}`,
        );
        const json: any = await res.json();
        const list = Array.isArray(json?.content) ? json.content : [];
        const entry =
          list.find((d: any) => String(d?.prefix || '').toUpperCase() === 'MC') ||
          list[0];
        if (entry?.docketNumber != null) {
          mcNumber = `${entry.prefix || 'MC'}${entry.docketNumber}`;
        }
      } catch {
        /* MC is optional — leave blank if the registry doesn't return one */
      }
    }

    return {
      companyName: carrier.legalName || carrier.dbaName || '',
      dbaName: carrier.dbaName || '',
      dotNumber: dotNum,
      mcNumber,
      phyCity: carrier.phyCity || '',
      phyState: carrier.phyState || '',
      powerUnits: Number(carrier.totalPowerUnits) || 0,
      drivers: Number(carrier.totalDrivers) || 0,
      allowedToOperate: carrier.allowedToOperate || '',
    };
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

  // ---- Drivers (manual roster management) ----
  @Post('drivers')
  async addDriver(@CurrentUser() user: AuthUser, @Body() dto: DriverDto) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Driver name is required.');
    }
    await this.prisma.driver.create({
      data: {
        carrierId: user.carrierId,
        name: dto.name.trim(),
        cdlClass: dto.cdlClass || 'Class A',
        status: dto.status || 'Active',
      },
    });
    return this.get(user);
  }

  @Patch('drivers/:id')
  async updateDriver(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: DriverDto,
  ) {
    await this.ownDriver(user, id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.cdlClass !== undefined) data.cdlClass = dto.cdlClass;
    if (dto.status !== undefined) data.status = dto.status;
    await this.prisma.driver.update({ where: { id }, data });
    return this.get(user);
  }

  @Delete('drivers/:id')
  async removeDriver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ownDriver(user, id);
    await this.prisma.driver.delete({ where: { id } });
    return this.get(user);
  }

  // ---- Equipment (manual fleet management) ----
  @Post('equipment')
  async addEquipment(@CurrentUser() user: AuthUser, @Body() dto: EquipmentDto) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    if (!dto.type || !dto.type.trim()) {
      throw new BadRequestException('Equipment type is required.');
    }
    await this.prisma.equipment.create({
      data: {
        carrierId: user.carrierId,
        type: dto.type.trim(),
        unit: dto.unit || '',
        year: dto.year || new Date().getFullYear(),
      },
    });
    return this.get(user);
  }

  @Patch('equipment/:id')
  async updateEquipment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EquipmentDto,
  ) {
    await this.ownEquipment(user, id);
    const data: any = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.year !== undefined) data.year = dto.year;
    await this.prisma.equipment.update({ where: { id }, data });
    return this.get(user);
  }

  @Delete('equipment/:id')
  async removeEquipment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ownEquipment(user, id);
    await this.prisma.equipment.delete({ where: { id } });
    return this.get(user);
  }

  // Guard: the record must belong to the caller's carrier.
  private async ownDriver(user: AuthUser, id: string) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    const row = await this.prisma.driver.findUnique({ where: { id } });
    if (!row || row.carrierId !== user.carrierId) {
      throw new NotFoundException('Driver not found');
    }
  }
  private async ownEquipment(user: AuthUser, id: string) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    const row = await this.prisma.equipment.findUnique({ where: { id } });
    if (!row || row.carrierId !== user.carrierId) {
      throw new NotFoundException('Equipment not found');
    }
  }
}
