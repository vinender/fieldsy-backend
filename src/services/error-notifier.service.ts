//@ts-nocheck
import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

const DEVELOPER_EMAIL = 'chandel.vinender@gmail.com';
const EMAIL_HOST = process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587');
const EMAIL_SECURE = process.env.EMAIL_SECURE === 'true';
const EMAIL_USER = process.env.SMTP_USER || process.env.EMAIL_USER || '';
const EMAIL_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '"Fieldsy" <noreply@fieldsy.com>';
const APP_ENV = process.env.NODE_ENV || 'development';

let transporter: any = null;

if (EMAIL_USER && EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_SECURE,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
}

// Throttle: max 1 email per error type per 5 minutes to avoid flooding
const recentErrors = new Map<string, number>();
const THROTTLE_MS = 5 * 60 * 1000;

function getErrorKey(error: Error, context?: string): string {
  return `${context || 'unknown'}:${error.message?.substring(0, 100)}`;
}

function isThrottled(key: string): boolean {
  const lastSent = recentErrors.get(key);
  if (lastSent && Date.now() - lastSent < THROTTLE_MS) {
    return true;
  }
  recentErrors.set(key, Date.now());
  // Clean old entries periodically
  if (recentErrors.size > 200) {
    const now = Date.now();
    for (const [k, v] of recentErrors) {
      if (now - v > THROTTLE_MS) recentErrors.delete(k);
    }
  }
  return false;
}

interface ErrorContext {
  type: 'API_ERROR' | 'UNCAUGHT_EXCEPTION' | 'UNHANDLED_REJECTION' | 'WEBHOOK_ERROR' | 'PAYMENT_ERROR';
  method?: string;
  url?: string;
  userId?: string;
  body?: any;
  statusCode?: number;
}

export async function notifyError(error: Error, context?: ErrorContext): Promise<void> {
  // Skip 4xx client errors (not server bugs)
  if (context?.statusCode && context.statusCode < 500 && context.statusCode >= 400) {
    return;
  }

  if (!transporter) {
    console.error('[ErrorNotifier] No email transporter configured');
    return;
  }

  const key = getErrorKey(error, context?.type);
  if (isThrottled(key)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const sanitizedBody = context?.body ? sanitizeBody(context.body) : null;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto;">
      <div style="background: #DC2626; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">⚠️ Fieldsy ${context?.type || 'ERROR'}</h2>
        <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">${APP_ENV.toUpperCase()} — ${timestamp}</p>
      </div>

      <div style="border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 8px 12px; font-weight: 600; color: #374151; width: 120px; vertical-align: top;">Error</td>
            <td style="padding: 8px 12px; color: #DC2626; font-weight: 500;">${escapeHtml(error.message)}</td>
          </tr>
          ${context?.method && context?.url ? `
          <tr style="background: #F9FAFB;">
            <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Endpoint</td>
            <td style="padding: 8px 12px; color: #111827;">${context.method} ${escapeHtml(context.url)}</td>
          </tr>` : ''}
          ${context?.statusCode ? `
          <tr>
            <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Status Code</td>
            <td style="padding: 8px 12px; color: #111827;">${context.statusCode}</td>
          </tr>` : ''}
          ${context?.userId ? `
          <tr style="background: #F9FAFB;">
            <td style="padding: 8px 12px; font-weight: 600; color: #374151;">User ID</td>
            <td style="padding: 8px 12px; color: #111827;">${context.userId}</td>
          </tr>` : ''}
          ${sanitizedBody ? `
          <tr>
            <td style="padding: 8px 12px; font-weight: 600; color: #374151; vertical-align: top;">Request Body</td>
            <td style="padding: 8px 12px;"><pre style="background: #F3F4F6; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; margin: 0;">${escapeHtml(JSON.stringify(sanitizedBody, null, 2))}</pre></td>
          </tr>` : ''}
        </table>

        <div style="margin-top: 20px;">
          <p style="font-weight: 600; color: #374151; margin-bottom: 8px; font-size: 14px;">Stack Trace</p>
          <pre style="background: #1F2937; color: #F9FAFB; padding: 16px; border-radius: 8px; font-size: 12px; overflow-x: auto; line-height: 1.5;">${escapeHtml(error.stack || 'No stack trace')}</pre>
        </div>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: DEVELOPER_EMAIL,
      subject: `[Fieldsy ${APP_ENV.toUpperCase()}] ${context?.type || 'ERROR'}: ${error.message?.substring(0, 80)}`,
      html,
    });
  } catch (emailErr: any) {
    console.error('[ErrorNotifier] Failed to send error email:', emailErr.message);
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  const sensitiveKeys = ['password', 'token', 'secret', 'card', 'cvv', 'cvc', 'authorization', 'cookie'];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}
