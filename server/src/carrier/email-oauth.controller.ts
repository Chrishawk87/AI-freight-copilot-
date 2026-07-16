import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { EmailOauthService, OAuthProvider } from './email-oauth.service';
import { encryptSecret } from '../common/secret';

// One-click "Connect Gmail / Connect Outlook" so each carrier sends document
// packages FROM their own company mailbox — no shared account, no app
// passwords. The refresh token is stored encrypted per-carrier; access tokens
// are minted on demand and never persisted.
@Controller('carrier/email/oauth')
export class EmailOauthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: EmailOauthService,
  ) {}

  private assertProvider(provider: string): OAuthProvider {
    if (provider !== 'google' && provider !== 'microsoft') {
      throw new BadRequestException('Unsupported email provider.');
    }
    return provider;
  }

  // Begin the flow. Guarded — we need the logged-in carrier to sign the state
  // so the (unauthenticated) callback can tie the tokens back to them.
  @UseGuards(JwtAuthGuard)
  @Get(':provider/start')
  async start(
    @CurrentUser() user: AuthUser,
    @Param('provider') providerParam: string,
  ) {
    const provider = this.assertProvider(providerParam);
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    if (!this.oauth.available(provider)) {
      throw new BadRequestException(
        `${provider === 'google' ? 'Gmail' : 'Outlook'} sign-in isn't configured on the server yet.`,
      );
    }
    const state = this.oauth.signState({
      carrierId: user.carrierId,
      userId: user.id,
      provider,
    });
    return { url: this.oauth.buildAuthUrl(provider, state) };
  }

  // OAuth redirect target. NOT guarded — the provider sends the browser here
  // with no auth header; we trust the signed state instead. Always redirect
  // back to the profile page with a status flag rather than returning JSON.
  @Get(':provider/callback')
  async callback(
    @Param('provider') providerParam: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const back = (status: string) =>
      res.redirect(`${frontend}/profile?email=${status}`);

    try {
      const provider = this.assertProvider(providerParam);
      if (error) return back('error');
      if (!code || !state) return back('error');

      const payload = this.oauth.readState(state);
      if (payload.provider !== provider) return back('error');

      const { refreshToken, email } = await this.oauth.exchangeCode(
        provider,
        code,
      );
      if (!refreshToken) {
        // No refresh token means we can't send later without re-consent.
        return back('noretoken');
      }

      await this.prisma.carrier.update({
        where: { id: payload.carrierId },
        data: {
          emailOauthProvider: provider,
          emailOauthEmail: email,
          emailOauthRefresh: encryptSecret(refreshToken),
        },
      });
      return back('connected');
    } catch {
      return back('error');
    }
  }

  // Disconnect — clear the stored OAuth connection.
  @UseGuards(JwtAuthGuard)
  @Post('disconnect')
  async disconnect(@CurrentUser() user: AuthUser) {
    if (!user.carrierId) throw new NotFoundException('No carrier profile');
    await this.prisma.carrier.update({
      where: { id: user.carrierId },
      data: {
        emailOauthProvider: '',
        emailOauthEmail: '',
        emailOauthRefresh: '',
      },
    });
    return { disconnected: true };
  }
}
