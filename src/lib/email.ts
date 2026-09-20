import nodemailer, { type Transporter } from "nodemailer";
import { logActivity } from "./db";

/**
 * DUAL MAILBOX EMAIL — SMTP via Mailbux (my.mailbux.com, STARTTLS :587).
 *
 *  · marketing → info@imeantech.com   — campaigns, outreach, newsletters
 *  · formal    → admin@imeantech.com  — quotations, invoices, receipts, serious mail
 *
 * Credentials live in .env only, never in git.
 */

export type Mailbox = "marketing" | "formal";

interface BoxConfig {
  user: string;
  pass: string;
  from: string;
}

function boxConfig(box: Mailbox): BoxConfig {
  const user = (box === "marketing" ? process.env.SMTP_INFO_USER : process.env.SMTP_ADMIN_USER) ?? "";
  const pass = box === "marketing" ? process.env.SMTP_INFO_PASS : process.env.SMTP_ADMIN_PASS;
  if (!user || !pass) throw new Error(`Mailbox "${box}" is not configured in .env (missing ${box === "marketing" ? "SMTP_INFO_USER/PASS" : "SMTP_ADMIN_USER/PASS"}).`);
  return { user, pass, from: user };
}

export function mailer(box: Mailbox): Transporter {
  const cfg = boxConfig(box);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "my.mailbux.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false, // STARTTLS on 587
    requireTLS: true,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 12_000,
  });
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  mailbox?: Mailbox;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export async function sendEmail(input: SendEmailInput): Promise<{ messageId: string; from: string }> {
  const mailbox = input.mailbox ?? "formal";
  const cfg = boxConfig(mailbox);
  const transport = mailer(mailbox);
  const info = await transport.sendMail({
    from: `"IMT General System" <${cfg.from}>`,
    to: input.to,
    subject: input.subject,
    text: input.text ?? input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    html: input.html,
    replyTo: input.replyTo,
    attachments: input.attachments,
  });
  logActivity("EMAIL_SENT", `${mailbox}:${cfg.from} → ${input.to} — ${input.subject}`.slice(0, 180));
  return { messageId: info.messageId, from: cfg.from };
}

/** Verify a mailbox authenticates against the SMTP server (no mail sent). */
export async function verifyMailbox(box: Mailbox): Promise<boolean> {
  try {
    await mailer(box).verify();
    return true;
  } catch {
    return false;
  }
}

/** Branded base styling for outgoing mail. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:620px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
    <div style="background:#0e7490;color:#ffffff;padding:18px 24px;">
      <span style="font-size:13px;letter-spacing:3px;">IMT GENERAL SYSTEM</span>
      <div style="font-size:20px;font-weight:600;margin-top:4px;">${title}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;">${bodyHtml}</div>
    <div style="padding:14px 24px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
      IMT General System · imeantech.com · Waris Mall, Kenya<br/>
      Using technology as a bridge to future dev.
    </div>
  </div></body></html>`;
}
