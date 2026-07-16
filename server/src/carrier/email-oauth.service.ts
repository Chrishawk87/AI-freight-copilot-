import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { encryptSecret, decryptSecret } from '../common/secret';

export type OAuthProvider = 'google' | 'microsoft';

interface ProviderCfg {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId?: string;
  clientSecret?: string;
  // Extra auth params required to get a refresh token.
  extraAuthParams: Record<string, string>;
}

// Short-lived signed "state" so the (unauthenticated) OAuth callback can tell
// which carrier/user started the flow. Reuses our AES secret box.
interface StatePayload {
  carrierId: string;
  userId: string;
  provider: OAuthProvider;
  ts: number;
}

@Injectable()
export class EmailOauthService {
  private readonly logger = new Logger('EmailOauthService');

  private cfg(provider: OAuthProvider): ProviderCfg {
    if (provider === 'google') {
      return {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        // gmail.send is a "sensitive" (not "restricted") scope — the scalable
        // choice; it lets us send as the user without the costly security
        // assessment that full-mailbox scopes require.
        scopes: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/userinfo.email',
          'openid',
        ],
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        extraAuthParams: {
          access_type: 'offline', // needed to receive a refresh token
          prompt: 'consent', // force refresh token on re-consent
        },
      };
    }
    const tenant = process.env.MICROSOFT_OAUTH_TENANT || 'common';
    return {
      authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scopes: [
        'openid',
        'email',
        'offline_access', // needed for a refresh token
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/User.Read',
      ],
      clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
      extraAuthParams: {},
    };
  }

  available(provider: OAuthProvider): boolean {
    const c = this.cfg(provider);
    return !!(c.clientId && c.clientSecret);
  }

  private redirectUri(provider: OAuthProvider): string {
    // Public backend URL incl. the /api prefix, e.g.
    // https://api.example.com/api  → callback below.
    const base = (process.env.OAUTH_REDIRECT_BASE || '').replace(/\/$/, '');
    return `${base}/carrier/email/oauth/${provider}/callback`;
  }

  // ---- state helpers ----
  signState(p: Omit<StatePayload, 'ts'>): string {
    return encryptSecret(JSON.stringify({ ...p, ts: Date.now() }));
  }
  readState(state: string): StatePayload {
    const json = decryptSecret(state || '');
    if (!json) throw new BadRequestException('Invalid OAuth state.');
    let parsed: StatePayload;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new BadRequestException('Invalid OAuth state.');
    }
    if (!parsed?.carrierId || Date.now() - parsed.ts > 15 * 60 * 1000) {
      throw new BadRequestException('OAuth session expired. Please try again.');
    }
    return parsed;
  }

  buildAuthUrl(provider: OAuthProvider, state: string): string {
    const c = this.cfg(provider);
    if (!c.clientId) {
      throw new BadRequestException(
        `${provider} sign-in isn't configured on the server yet.`,
      );
    }
    const params = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: c.scopes.join(' '),
      state,
      ...c.extraAuthParams,
    });
    return `${c.authUrl}?${params.toString()}`;
  }

  // Exchange the authorization code for tokens; return the refresh token and
  // the connected email address.
  async exchangeCode(
    provider: OAuthProvider,
    code: string,
  ): Promise<{ refreshToken: string; email: string }> {
    const c = this.cfg(provider);
    const body = new URLSearchParams({
      client_id: c.clientId || '',
      client_secret: c.clientSecret || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri(provider),
    });
    const res = await fetch(c.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok || !json.access_token) {
      this.logger.warn(`Token exchange failed: ${JSON.stringify(json)}`);
      throw new BadRequestException(
        json.error_description || 'Could not complete sign-in with your email provider.',
      );
    }
    const email = await this.fetchEmail(provider, json.access_token);
    return { refreshToken: json.refresh_token || '', email };
  }

  // Mint a fresh access token from a stored refresh token.
  async accessTokenFromRefresh(
    provider: OAuthProvider,
    refreshToken: string,
  ): Promise<string> {
    const c = this.cfg(provider);
    const body = new URLSearchParams({
      client_id: c.clientId || '',
      client_secret: c.clientSecret || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    if (provider === 'microsoft') body.set('scope', c.scopes.join(' '));
    const res = await fetch(c.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok || !json.access_token) {
      this.logger.warn(`Token refresh failed: ${JSON.stringify(json)}`);
      throw new BadRequestException(
        'Your email connection expired. Reconnect it in Profile.',
      );
    }
    return json.access_token as string;
  }

  private async fetchEmail(
    provider: OAuthProvider,
    accessToken: string,
  ): Promise<string> {
    try {
      if (provider === 'google') {
        const r = await fetch(
          'https://www.googleapis.com/oauth2/v2/userinfo',
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const j: any = await r.json();
        return j.email || '';
      }
      const r = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j: any = await r.json();
      return j.mail || j.userPrincipalName || '';
    } catch {
      return '';
    }
  }
}
