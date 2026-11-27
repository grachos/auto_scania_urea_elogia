import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage { to: string[]; subject: string; html: string; text: string }
export interface Mailer { send(m: MailMessage): Promise<void> }

export function createMailer(cfg: Config, fetchFn: typeof fetch = fetch): Mailer {
  if (cfg.MAIL_PROVIDER === 'resend') {
    return {
      async send(m) {
        const r = await fetchFn('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: cfg.MAIL_FROM, to: m.to, subject: m.subject, html: m.html, text: m.text }),
        });
        if (!r.ok) throw new Error(`Resend failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_PORT === 465,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
  });
  return { async send(m) { await transport.sendMail({ from: cfg.MAIL_FROM, ...m }); } };
}
