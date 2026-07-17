import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TruckInput, VehicleService } from './vehicle.service';

// Vehicle (truck) profiles for the signed-in carrier. These feed the truck
// routing engine so returned routes are legal for the rig.
@UseGuards(JwtAuthGuard)
@Controller('truckmap/vehicles')
export class VehicleController {
  constructor(private readonly vehicles: VehicleService) {}

  private carrierId(user: AuthUser): string {
    if (!user?.carrierId) throw new NotFoundException('No carrier profile');
    return user.carrierId;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const trucks = await this.vehicles.list(this.carrierId(user));
    return { trucks, count: trucks.length };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: TruckInput) {
    return this.vehicles.create(this.carrierId(user), body ?? {});
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: TruckInput,
  ) {
    return this.vehicles.update(this.carrierId(user), id, body ?? {});
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.vehicles.remove(this.carrierId(user), id);
  }
}
