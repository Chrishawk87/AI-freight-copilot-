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
        auth: { user: cfg.user, pass: cfg.pass },
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
      this.logger.warn(`Email send failed: ${e?.message || e}`);
      return { sent: false, reason };
    }
  }

  // Turn raw SMTP errors into something a driver can act on.
  private friendly(e: any): string {
    const msg = String(e?.message || e || '').toLowerCase();
    if (msg.includes('invalid login') || msg.includes('username and password') || msg.includes('535')) {
      return 'Login failed. For Gmail/Yahoo/Outlook use an app password, not your normal password.';
    }
    if (msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('enotfound')) {
      return 'Could not reach your email server. Double-check the server address and port.';
    }
    if (msg.includes('self signed') || msg.includes('certificate')) {
      return 'Your mail server rejected the secure connection. Try the other port (587 vs 465).';
    }
    return 'The email could not be sent. Check your email connection in Profile.';
  }
}
