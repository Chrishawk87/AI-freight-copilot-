import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MailService } from './mail.service';

// Read-only diagnostic: which senders does the SERVER actually see configured?
// Reports booleans + the non-secret "from" address so you can confirm env vars
// landed on this service and redeployed — without ever exposing a key.
@UseGuards(JwtAuthGuard)
@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get('status')
  status() {
    return {
      resend: this.mail.resendAvailable(),
      resendFrom: this.mail.platformFromAddress() || null,
      platformSmtp: !!(
        process.env.PLATFORM_SMTP_HOST &&
        process.env.PLATFORM_SMTP_USER &&
        process.env.PLATFORM_SMTP_PASS
      ),
      googleOauth: !!(
        process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ),
      microsoftOauth: !!(
        process.env.MICROSOFT_OAUTH_CLIENT_ID &&
        process.env.MICROSOFT_OAUTH_CLIENT_SECRET
      ),
      // Where any HTTPS relay/OAuth callback points — handy for redirect setup.
      oauthRedirectBase: process.env.OAUTH_REDIRECT_BASE || null,
    };
  }
}
