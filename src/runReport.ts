import type { FleetSource } from './sources/FleetSource.js';
import type { Repo } from './db/repo.js';
import type { Mailer } from './mail/index.js';
import { classify, isStale, type Thresholds } from './report/classify.js';
import { renderReport, fmtShort, type ReportRow } from './report/render.js';

export interface Deps {
  source: FleetSource;
  repo: Repo;
  mailer: Mailer;
  thresholds: Thresholds;
  tz: string;
  /** fallback recipients (MAIL_TO) when the repo has none */
  fallbackTo: string[];
  now?: () => Date;
  log?: (s: string) => void;
}

export interface RunResult { status: 'ok' | 'skipped' | 'error'; rows?: ReportRow[]; subject?: string; html?: string; error?: string }

export async function runReport(deps: Deps, opts: { dryRun?: boolean } = {}): Promise<RunResult> {
  const { source, repo, mailer, thresholds, tz } = deps;
  const log = deps.log ?? console.log;
  const now = (deps.now ?? (() => new Date()))();

  const runId = await repo.startRun(now);
  if (!runId) { log('Another run is in progress (<10 min); skipping'); return { status: 'skipped' }; }

  const recipients = async () => {
    const r = await repo.getRecipients().catch(() => [] as string[]);
    return r.length ? r : deps.fallbackTo;
  };

  try {
    let readings;
    try {
      readings = await source.fetchReadings();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await repo.finishRun(runId, 'error', msg);
      if (!opts.dryRun) {
        const to = await recipients();
        if (to.length) {
          await mailer.send({
            to,
            subject: `[Urea Scania] ERROR al consultar Scania – ${fmtShort(now, tz)}`,
            text: `No se pudo obtener el nivel de urea.\n\n${msg}`,
            html: `<p><b>No se pudo obtener el nivel de urea.</b></p><pre>${msg.replace(/</g, '&lt;')}</pre>`,
          }).catch((err) => log(`Alert email failed: ${err}`));
        }
      }
      return { status: 'error', error: msg };
    }

    const cur = readings.map((r) => ({ vin: r.vin, receivedAt: r.receivedAt }));
    // Previous readings are taken relative to each current receivedAt, so persisting first is safe either way.
    const prev = await repo.getPrevious(cur);
    if (!opts.dryRun) {
      await repo.upsertVehicles(readings.map((r) => ({ vin: r.vin, plate: r.plate, name: r.name })));
      await repo.insertReadings(readings);
    }

    const rows: ReportRow[] = readings.map((r) => {
      const p = prev.get(r.vin);
      return {
        plate: r.plate, vin: r.vin, level: r.ureaLevel,
        status: classify(r.ureaLevel, thresholds),
        delta: r.ureaLevel != null && p?.level != null ? r.ureaLevel - p.level : null,
        receivedAt: r.receivedAt,
        stale: isStale(r.receivedAt, now),
      };
    });
    const { subject, html, text } = renderReport(rows, { now, tz });

    if (opts.dryRun) {
      log(`Subject: ${subject}\n\n${html}`);
      await repo.finishRun(runId, 'ok', 'dry-run');
      return { status: 'ok', rows, subject, html };
    }
    const to = await recipients();
    if (!to.length) throw new Error('No recipients (recipients table empty and MAIL_TO unset)');
    await mailer.send({ to, subject, html, text });
    await repo.finishRun(runId, 'ok', `${rows.length} vehicles`);
    return { status: 'ok', rows, subject, html };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await repo.finishRun(runId, 'error', msg).catch(() => {});
    return { status: 'error', error: msg };
  }
}
