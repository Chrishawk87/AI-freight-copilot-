// ---------------------------------------------------------------------------
// mail.service.ts — one shared, company-configured mailer for every subscriber.
//
// Same server-key model as OCR / Claude: the COMPANY sets SMTP creds once as
// env vars and every driver can email document packages out of the box —
// nothing to plug in per device. If SMTP isn't configured, sending is simply
// reported as unavailable (the feature degrades gracefully, never crashes).
//
//   SMTP_HOST   e.g. smtp.sendgrid.net
//   SMTP_PORT   e.g. 587
//   SMTP_USER   smtp username / api key user
//   SMTP_PASS   smtp password / api key
//   MAIL_FROM   the "from" address, e.g. "AI Freight Co-Pilot <docs@yourco.com>"
// ---------------------------------------------------------------------------
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

@Injectable()
export class MailService {
  private readonly log = new Logger('MailService');
  private transporter: nodemailer.Transporter | null = null;

  configured(): boolean {
    return !!(
      process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.MAIL_FROM
    );
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.configured()) return null;
    if (this.transporter) return this.transporter;
    const port = Number(process.env.SMTP_PORT) || 587;
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // implicit TLS on 465, STARTTLS otherwise
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    return this.transporter;
  }

  async send(msg: {
    to: string;
    subject: string;
    text: string;
    replyTo?: string;
    cc?: string;
    attachments?: MailAttachment[];
  }): Promise<{ sent: boolean; reason?: string }> {
    const t = this.getTransporter();
    if (!t) {
      return {
        sent: false,
        reason:
          'Email is not set up yet. Ask your company admin to configure the mail (SMTP) settings.',
      };
    }
    try {
      await t.sendMail({
        from: process.env.MAIL_FROM,
        to: msg.to,
        cc: msg.cc || undefined,
        replyTo: msg.replyTo || undefined,
        subject: msg.subject,
        text: msg.text,
        attachments: msg.attachments,
      });
      return { sent: true };
    } catch (e: any) {
      this.log.error(`Send failed: ${e?.message || e}`);
      return { sent: false, reason: 'The email could not be sent. Please try again.' };
    }
  }
}
