import type { Status } from './classify.js';

export interface ReportRow {
  plate: string | null;
  vin: string;
  level: number | null;
  status: Status;
  /** change vs previous stored reading, in percentage points */
  delta: number | null;
  receivedAt: string | null;
  stale: boolean;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function parts(d: Date, tz: string) {
  const m: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)) m[p.type] = p.value;
  return m;
}
export const fmtShort = (d: Date, tz: string) => { const p = parts(d, tz); return `${p.day}/${p.month} ${p.hour}:${p.minute}`; };
const fmtFull = (iso: string | null, tz: string) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return '—';
  const p = parts(new Date(iso), tz);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
};

const COLORS: Record<Status, string> = { CRITICO: '#c62828', BAJO: '#ef6c00', OK: '#2e7d32', SIN_DATO: '#757575' };
const ORDER = (r: ReportRow) => (r.level == null ? Infinity : r.level);

const fmtDelta = (d: number | null) => (d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)} pp`);
const fmtLevel = (l: number | null) => (l == null ? '—' : `${l.toFixed(1)}%`);

export function renderReport(rows: ReportRow[], opts: { now: Date; tz: string }) {
  const sorted = [...rows].sort((a, b) => ORDER(a) - ORDER(b));
  const n = (s: Status) => rows.filter((r) => r.status === s).length;
  const crit = n('CRITICO'), low = n('BAJO'), ok = n('OK'), nodata = n('SIN_DATO');
  const when = fmtShort(opts.now, opts.tz);
  const subject = `[Urea Scania] ${crit} críticos / ${low} bajos – ${when}`;
  const stale = rows.filter((r) => r.stale).length;
  const summary = `Total ${rows.length} · Críticos ${crit} · Bajos ${low} · OK ${ok} · Sin dato ${nodata}` + (stale ? ` · Desactualizados (>24h) ${stale}` : '');

  const th = 'style="padding:6px 10px;text-align:left;background:#263238;color:#fff;font-size:13px"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e0e0e0;font-size:13px"';
  const body = sorted
    .map((r) => {
      const c = COLORS[r.status];
      return `<tr><td ${td}><b>${esc(r.plate ?? '—')}</b></td><td ${td}>${esc(r.vin)}</td><td ${td}>${fmtLevel(r.level)}</td>` +
        `<td ${td}><span style="background:${c};color:#fff;padding:2px 8px;border-radius:10px;font-size:12px">${r.status}</span></td>` +
        `<td ${td}>${fmtDelta(r.delta)}</td><td ${td}>${esc(fmtFull(r.receivedAt, opts.tz))}${r.stale ? ' <span style="color:#c62828">(desactualizado)</span>' : ''}</td></tr>`;
    })
    .join('');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#212121">` +
    `<h2 style="margin:0 0 4px">Nivel de Urea (AdBlue) – Flota Scania</h2>` +
    `<p style="margin:0 0 12px;color:#555">${esc(when)} (${esc(opts.tz)})</p>` +
    `<p style="margin:0 0 12px;font-size:14px"><b>${esc(summary)}</b></p>` +
    `<table style="border-collapse:collapse;width:100%"><thead><tr><th ${th}>Placa</th><th ${th}>VIN</th><th ${th}>Nivel %</th><th ${th}>Estado</th><th ${th}>Variación</th><th ${th}>Última actualización</th></tr></thead>` +
    `<tbody>${body}</tbody></table></div>`;
  const text =
    `${subject}\n${summary}\n\n` +
    sorted.map((r) => `${(r.plate ?? '—').padEnd(9)} ${r.vin}  ${fmtLevel(r.level).padStart(7)}  ${r.status.padEnd(8)} ${fmtDelta(r.delta).padStart(9)}  ${fmtFull(r.receivedAt, opts.tz)}${r.stale ? ' (desactualizado)' : ''}`).join('\n');
  return { subject, html, text };
}
