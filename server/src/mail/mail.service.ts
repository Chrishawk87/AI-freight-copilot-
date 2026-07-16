import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

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
