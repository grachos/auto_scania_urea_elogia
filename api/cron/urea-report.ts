import { timingSafeEqual } from 'node:crypto';
import { buildDeps } from '../../src/deps.js';
import { runReport, type Deps, type RunResult } from '../../src/runReport.js';
import { isReportHour } from '../../src/schedule.js';

// Minimal req/res shapes (Vercel Node runtime) so we need no @vercel/node dependency.
interface Req { headers: Record<string, string | string[] | undefined>; url?: string }
interface Res { status(n: number): Res; json(b: unknown): void }

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createHandler(
  build: () => Deps = buildDeps,
  run: (d: Deps) => Promise<RunResult> = runReport,
  secret: () => string | undefined = () => process.env.CRON_SECRET,
  // Hostinger's cron runs hourly in the server's own timezone; we decide here, in TZ_REPORT, which hours send the report.
  shouldRun: () => boolean = () => isReportHour(process.env.REPORT_HOURS ?? '0,4,8,12,16,20', process.env.TZ_REPORT || 'America/Bogota'),
) {
  return async (req: Req, res: Res) => {
    const expected = secret();
    const got = String(req.headers.authorization ?? '');
    if (!expected || !safeEq(got, `Bearer ${expected}`)) return res.status(401).json({ error: 'unauthorized' });
    const force = /[?&]force=1(&|$)/.test(req.url ?? '');
    if (!force && !shouldRun()) return res.status(200).json({ status: 'skipped', reason: 'not a report hour' });
    try {
      const r = await run(build());
      return res.status(r.status === 'error' ? 500 : 200).json({ status: r.status, error: r.error, vehicles: r.rows?.length });
    } catch (e) {
      return res.status(500).json({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export default createHandler();
