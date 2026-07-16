import { Controller, Get } from '@nestjs/common';
import { MailService } from './mail.service';

// Read-only diagnostic: which senders does the SERVER actually see configured?
// Reports booleans + the non-secret "from" address so you can confirm env vars
// landed on this service and redeployed — without ever exposing a key. Left
// unauthenticated on purpose so it can be checked straight from the browser;
// it exposes no secrets, only whether config is present.
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
