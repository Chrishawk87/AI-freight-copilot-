import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LoadsService } from './loads.service';
import { BidsService } from '../bids/bids.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

class BidDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  message?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('loads')
export class LoadsController {
  constructor(
    private readonly loads: LoadsService,
    private readonly bids: BidsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('equipment') equipment?: string) {
    return this.loads.list(user, equipment);
  }

  @Get('reloads')
  reloads(@CurrentUser() user: AuthUser, @Query('radius') radius?: string) {
    return this.loads.reloads(user, radius ? Number(radius) : 200);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.loads.dashboard(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.loads.getOne(user, id);
  }

  @Post(':id/bid')
  bid(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: BidDto,
  ) {
    return this.bids.create(user, id, dto.amount, dto.message);
  }

  @Post(':id/book')
  book(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bids.book(user, id);
  }
}
