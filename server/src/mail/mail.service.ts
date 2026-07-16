import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import MailComposer = require('nodemailer/lib/mail-composer');

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string; // DECRYPTED plaintext — decrypt before calling
  from: string; // visible "From" address
}

export interface SendInput {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');

  /** A carrier is ready to send once it has a host, a login and a password. */
  configured(cfg: Partial<SmtpConfig> | null | undefined): cfg is SmtpConfig {
    return !!(cfg && cfg.host && cfg.user && cfg.pass);
  }

  /**
   * Shared platform sending account (set once by us via env). This is the
   * server-first default: every subscriber can email document packages without
   * connecting their own inbox. Their company email is used as reply-to so
   * broker replies still land with the carrier, not us.
   */
  platformConfig(): SmtpConfig | null {
    const host = process.env.PLATFORM_SMTP_HOST;
    const user = process.env.PLATFORM_SMTP_USER;
    const pass = process.env.PLATFORM_SMTP_PASS;
    if (!host || !user || !pass) return null;
    const port = Number(process.env.PLATFORM_SMTP_PORT) || 587;
    return {
      host,
      port,
      // Default secure to true only on 465 unless explicitly set.
      secure: process.env.PLATFORM_SMTP_SECURE
        ? process.env.PLATFORM_SMTP_SECURE === 'true'
        : port === 465,
      user,
      pass,
      from: process.env.PLATFORM_SMTP_FROM || user,
    };
  }

  /** Is the shared platform sender available? */
  platformAvailable(): boolean {
    return !!(
      process.env.PLATFORM_SMTP_HOST &&
      process.env.PLATFORM_SMTP_USER &&
      process.env.PLATFORM_SMTP_PASS
    );
  }

  /**
   * Send a real email using the CARRIER's own SMTP account. Nothing is shared
   * across tenants — each client's provider credentials send their own mail.
   */
  async send(
    cfg: SmtpConfig,
    input: SendInput,
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure, // true for 465, false for 587 (STARTTLS)
        // App passwords are commonly copied with spaces (Gmail shows
        // "abcd efgh ijkl mnop"). SMTP auth fails unless we strip them.
        auth: { user: cfg.user, pass: (cfg.pass || '').replace(/\s+/g, '') },
        // Fail fast with a clear reason instead of hanging if the host/port
        // is wrong or the provider is unreachable from the server.
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      });
      await transporter.sendMail({
        from: cfg.from || cfg.user,
        to: input.to,
        replyTo: input.replyTo,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments,
      });
      return { sent: true };
    } catch (e: any) {
      const reason = this.friendly(e);
      this.logger.warn(`Email send failed: ${e?.code || ''} ${e?.message || e}`);
      return { sent: false, reason };
    }
  }

  /**
   * Send FROM the carrier's own mailbox using an OAuth access token — the
   * scalable, one-click path (no app passwords). We send through the provider's
   * HTTP API (Gmail API / Microsoft Graph) rather than SMTP XOAUTH2, because the
   * API paths only need the lightweight gmail.send / Mail.Send scopes and avoid
   * the costly restricted-scope security assessment.
   *
   * `accessToken` is minted on demand by the caller from the stored refresh
   * token; nothing is persisted here.
   */
  async sendOauth(
    provider: 'google' | 'microsoft',
    accessToken: string,
    fromEmail: string,
    input: SendInput,
  ): Promise<{ sent: boolean; reason?: string }> {
    try {
      if (provider === 'google') {
        const raw = await this.buildMime(fromEmail, input);
        const b64url = raw
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        const res = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw: b64url }),
          },
        );
        if (!res.ok) {
          const body = await res.text();
          this.logger.warn(`Gmail API send failed: ${res.status} ${body}`);
          return { sent: false, reason: this.friendlyOauth(res.status, body) };
        }
        return { sent: true };
      }

      // Microsoft Graph sendMail.
      const message = {
        subject: input.subject,
        body: { contentType: 'Text', content: input.text },
        toRecipients: [{ emailAddress: { address: input.to } }],
        replyTo: input.replyTo
          ? [{ emailAddress: { address: input.replyTo } }]
          : undefined,
        attachments: (input.attachments || []).map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType || 'application/octet-stream',
          contentBytes: a.content.toString('base64'),
        })),
      };
      const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Graph sendMail failed: ${res.status} ${body}`);
        return { sent: false, reason: this.friendlyOauth(res.status, body) };
      }
      return { sent: true };
    } catch (e: any) {
      this.logger.warn(`OAuth send failed: ${e?.message || e}`);
      return {
        sent: false,
        reason:
          'Could not send from your connected inbox. Try reconnecting it in Profile.',
      };
    }
  }

  // Compose a full RFC-822 MIME message (with attachments) as a Buffer.
  private buildMime(fromEmail: string, input: SendInput): Promise<Buffer> {
    const composer = new MailComposer({
      from: fromEmail,
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.text,
      attachments: input.attachments,
    });
    return new Promise((resolve, reject) => {
      composer.compile().build((err: Error | null, msg: Buffer) => {
        if (err) reject(err);
        else resolve(msg);
      });
    });
  }

  private friendlyOauth(status: number, _body: string): string {
    if (status === 401 || status === 403) {
      return 'Your connected inbox lost authorization. Reconnect it in Profile → Send email.';
    }
    return 'Your email provider refused the message. Reconnect your inbox in Profile if this keeps happening.';
  }

  // Turn raw SMTP errors into something a driver can act on. We also append the
  // provider's own words so the real cause is visible without server logs.
  private friendly(e: any): string {
    const raw = String(e?.message || e || '');
    const msg = raw.toLowerCase();
    const detail = raw ? ` (${raw.split('\n')[0].slice(0, 160)})` : '';

    if (
      msg.includes('invalid login') ||
      msg.includes('username and password') ||
      msg.includes('5.7.8') ||
      msg.includes('535')
    ) {
      return `Login rejected by your email provider. For Gmail/Google Workspace, Yahoo, or Outlook you must use an app password (with 2-step verification on), not your normal password.${detail}`;
    }
    if (msg.includes('missing credentials')) {
      return 'No app password is saved. Open Profile → Send email and enter your app password, then Save email.';
    }
    if (
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('timeout') ||
      msg.includes('enotfound')
    ) {
      return `Could not reach your email server — it may be the wrong server/port, or your host blocks outbound email.${detail}`;
    }
    if (
      msg.includes('self signed') ||
      msg.includes('certificate') ||
      msg.includes('wrong version') ||
      msg.includes('ssl')
    ) {
      return 'Secure connection failed — this is usually the wrong port. Gmail/Yahoo use 465 (SSL); Outlook/Microsoft 365 use 587.';
    }
    if (msg.includes('relay') || msg.includes('not allowed') || msg.includes('spf') || msg.includes('sender')) {
      return `Your provider refused the "from" address. Your send-from email must match the account you signed in with.${detail}`;
    }
    return `The email could not be sent.${detail} Check your email connection in Profile.`;
  }
}
