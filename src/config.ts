import { z } from 'zod';

const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(emptyToUndef, s.optional());

const schema = z
  .object({
    SCANIA_CLIENT_ID: opt(z.string()),
    SCANIA_SECRET_KEY: opt(z.string()),
    SCANIA_BASE_URL: z.preprocess(emptyToUndef, z.string().url().default('https://dataaccess.scania.com')),
    SUPABASE_URL: opt(z.string().url()),
    SUPABASE_SERVICE_ROLE_KEY: opt(z.string()),
    MAIL_PROVIDER: z.preprocess(emptyToUndef, z.enum(['resend', 'smtp']).default('resend')),
    RESEND_API_KEY: opt(z.string()),
    SMTP_HOST: opt(z.string()),
    SMTP_PORT: z.preprocess(emptyToUndef, z.coerce.number().int().default(587)),
    SMTP_USER: opt(z.string()),
    SMTP_PASS: opt(z.string()),
    MAIL_FROM: z.string().min(3),
    MAIL_TO: opt(z.string()),
    CRON_SECRET: opt(z.string()),
    THRESHOLD_CRITICAL: z.preprocess(emptyToUndef, z.coerce.number().default(20)),
    THRESHOLD_LOW: z.preprocess(emptyToUndef, z.coerce.number().default(35)),
    TZ_REPORT: z.preprocess(emptyToUndef, z.string().default('America/Bogota')),
    SOURCE: z.preprocess(emptyToUndef, z.enum(['rfms', 'scrape']).default('rfms')),
    MYSCANIA_USER: opt(z.string()),
    MYSCANIA_PASS: opt(z.string()),
  })
  .superRefine((c, ctx) => {
    const need = (ok: unknown, path: string, msg: string) =>
      ok || ctx.addIssue({ code: 'custom', path: [path], message: msg });
    if (c.SOURCE === 'rfms') {
      need(c.SCANIA_CLIENT_ID, 'SCANIA_CLIENT_ID', 'required when SOURCE=rfms');
      need(c.SCANIA_SECRET_KEY, 'SCANIA_SECRET_KEY', 'required when SOURCE=rfms');
    } else {
      need(c.MYSCANIA_USER, 'MYSCANIA_USER', 'required when SOURCE=scrape');
      need(c.MYSCANIA_PASS, 'MYSCANIA_PASS', 'required when SOURCE=scrape');
    }
    if (c.MAIL_PROVIDER === 'resend') need(c.RESEND_API_KEY, 'RESEND_API_KEY', 'required when MAIL_PROVIDER=resend');
    else need(c.SMTP_HOST, 'SMTP_HOST', 'required when MAIL_PROVIDER=smtp');
    need(!c.SUPABASE_URL === !c.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_URL', 'set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or neither');
    need(c.THRESHOLD_CRITICAL <= c.THRESHOLD_LOW, 'THRESHOLD_CRITICAL', 'must be <= THRESHOLD_LOW');
  });

export type Config = z.infer<typeof schema> & { mailTo: string[] };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new Error('Invalid configuration: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const mailTo = (r.data.MAIL_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return { ...r.data, mailTo };
}
