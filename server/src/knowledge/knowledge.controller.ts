import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { KnowledgeService } from './knowledge.service';

class MemoryDto {
  @IsOptional() @IsString() category?: string;
  @IsString() key: string;
  @IsString() value: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}

class MemoryPatchDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() key?: string;
  @IsOptional() @IsString() value?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}

class KnowledgeDto {
  @IsString() category: string;
  @IsOptional() @IsString() subcategory?: string;
  @IsString() topic: string;
  @IsString() content: string;
  @IsOptional() @IsString() keywords?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('memory')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  // ── Carrier memory (surface) ──
  @Get()
  memory(@CurrentUser() user: AuthUser) {
    return this.knowledge.listMemory(user.carrierId || '');
  }

  @Post()
  addMemory(@CurrentUser() user: AuthUser, @Body() dto: MemoryDto) {
    return this.knowledge.addMemory(user.carrierId || '', dto);
  }

  @Patch(':id')
  updateMemory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MemoryPatchDto,
  ) {
    return this.knowledge.updateMemory(user.carrierId || '', id, dto);
  }

  @Delete(':id')
  deleteMemory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledge.deleteMemory(user.carrierId || '', id);
  }

  // ── Knowledge base (subsurface) ──
  @Get('knowledge')
  knowledgeList(
    @CurrentUser() user: AuthUser,
    @Query('category') category?: string,
    @Query('q') q?: string,
  ) {
    if (q && q.trim()) {
      return this.knowledge.searchKnowledge(user.carrierId, q, 10);
    }
    return this.knowledge.listKnowledge(user.carrierId, category);
  }

  @Post('knowledge')
  addKnowledge(@CurrentUser() user: AuthUser, @Body() dto: KnowledgeDto) {
    return this.knowledge.addKnowledge(user.carrierId || '', dto);
  }

  @Delete('knowledge/:id')
  deleteKnowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.knowledge.deleteKnowledge(user.carrierId || '', id);
  }
}
