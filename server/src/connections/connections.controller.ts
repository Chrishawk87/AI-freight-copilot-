import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { ConnectionsService } from './connections.service';

// All routes are per-carrier and gated by JWT. A carrier can only ever see and
// change its OWN connections — the carrierId comes from the token, never the
// client, so one tenant can't touch another's.
@UseGuards(JwtAuthGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  private carrier(user: AuthUser): string {
    if (!user.carrierId) {
      throw new BadRequestException('Your account has no carrier profile yet.');
    }
    return user.carrierId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.connections.list(this.carrier(user));
  }

  @Post(':provider/connect')
  connect(
    @CurrentUser() user: AuthUser,
    @Param('provider') provider: string,
    @Body() body: { credentials?: Record<string, any>; config?: Record<string, any>; label?: string },
  ) {
    return this.connections.connect(this.carrier(user), provider, {
      credentials: body?.credentials,
      config: body?.config,
      label: body?.label,
    });
  }

  @Post(':provider/disconnect')
  disconnect(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    return this.connections.disconnect(this.carrier(user), provider);
  }

  @Post(':provider/sync')
  syncOne(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    return this.connections.syncOne(this.carrier(user), provider);
  }

  @Post('sync')
  async syncAll(@CurrentUser() user: AuthUser) {
    await this.connections.syncCarrier(this.carrier(user));
    return this.connections.list(this.carrier(user));
  }
}
