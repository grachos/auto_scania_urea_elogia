import { timingSafeEqual } from 'node:crypto';
import { buildDeps } from '../../src/deps.js';
import { runReport, type Deps, type RunResult } from '../../src/runReport.js';

// Minimal req/res shapes (Vercel Node runtime) so we need no @vercel/node dependency.
interface Req { headers: Record<string, string | string[] | undefined> }
interface Res { status(n: number): Res; json(b: unknown): void }

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createHandler(
  build: () => Deps = buildDeps,
  run: (d: Deps) => Promise<RunResult> = runReport,
  secret: () => string | undefined = () => process.env.CRON_SECRET,
) {
  return async (req: Req, res: Res) => {
    const expected = secret();
    const got = String(req.headers.authorization ?? '');
    if (!expected || !safeEq(got, `Bearer ${expected}`)) return res.status(401).json({ error: 'unauthorized' });
    try {
      const r = await run(build());
      return res.status(r.status === 'error' ? 500 : 200).json({ status: r.status, error: r.error, vehicles: r.rows?.length });
    } catch (e) {
      return res.status(500).json({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export default createHandler();
