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

const COLORS: Record<Exclude<Status, 'SIN_DATO'>, { bg: string; fg: string }> = {
  ROJO: { bg: '#ffcdd2', fg: '#b71c1c' },
  AMARILLO: { bg: '#fff3cd', fg: '#8a6100' },
  VERDE: { bg: '#c8e6c9', fg: '#1b5e20' },
};

const fmtDelta = (d: number | null) => (d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)} pp`);
const fmtLevel = (l: number | null) => (l == null ? '—' : `${l.toFixed(1)}%`);
const byLevel = (a: ReportRow, b: ReportRow) => (a.level ?? Infinity) - (b.level ?? Infinity);

export function observation(r: ReportRow, now: Date): string {
  let o = r.level != null && r.level < 40 ? 'Por debajo del 40 % – recargar urea' : 'Cerca del 40 % – programar recarga';
  if (r.stale) {
    const ts = r.receivedAt ? Date.parse(r.receivedAt) : NaN;
    o += Number.isNaN(ts) ? ' · dato desactualizado' : ` · dato de hace ${Math.max(1, Math.floor((now.getTime() - ts) / 3600000))} h`;
  }
  return o;
}

export function renderReport(rows: ReportRow[], opts: { now: Date; tz: string }) {
  const reporting = rows.filter((r) => r.level != null && r.status !== 'SIN_DATO');
  const excluded = rows.length - reporting.length;
  const red = reporting.filter((r) => r.status === 'ROJO').sort(byLevel);
  const rest = reporting.filter((r) => r.status !== 'ROJO');
  const rank = (r: ReportRow) => (r.status === 'AMARILLO' ? 0 : 1);
  rest.sort((a, b) => rank(a) - rank(b) || byLevel(a, b));
  const yellow = rest.filter((r) => r.status === 'AMARILLO').length;
  const green = rest.length - yellow;
  const when = fmtShort(opts.now, opts.tz);
  const subject = `[Urea Scania] ${red.length} requieren atención – ${when}`;
  const stale = reporting.filter((r) => r.stale).length;
  const summary = `Con nivel ${reporting.length} · Rojo ${red.length} · Amarillo ${yellow} · Verde ${green}` + (stale ? ` · Desactualizados (>24h) ${stale}` : '');
  const exclNote = excluded ? `${excluded} ${excluded === 1 ? 'vehículo no reporta' : 'vehículos no reportan'} nivel de urea y no se ${excluded === 1 ? 'incluye' : 'incluyen'}` : '';

  const th = 'style="padding:6px 10px;text-align:left;background:#263238;color:#fff;font-size:13px"';
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e0e0e0;font-size:13px"';
  const row = (r: ReportRow, obs: boolean) => {
    const c = COLORS[r.status as keyof typeof COLORS];
    return `<tr style="background:${c.bg}"><td ${td}><b>${esc(r.plate ?? '—')}</b></td><td ${td}>${esc(r.vin)}</td>` +
      `<td ${td}><b style="color:${c.fg}">${fmtLevel(r.level)}</b></td><td ${td}>${fmtDelta(r.delta)}</td>` +
      `<td ${td}>${esc(fmtFull(r.receivedAt, opts.tz))}${r.stale ? ' <span style="color:#b71c1c">(desactualizado)</span>' : ''}</td>` +
      (obs ? `<td ${td}>${esc(observation(r, opts.now))}</td>` : '') + `</tr>`;
  };
  const table = (list: ReportRow[], obs: boolean) =>
    `<table style="border-collapse:collapse;width:100%"><thead><tr><th ${th}>Placa</th><th ${th}>VIN</th><th ${th}>Nivel %</th><th ${th}>Variación</th><th ${th}>Última actualización</th>${obs ? `<th ${th}>Observación</th>` : ''}</tr></thead>` +
    `<tbody>${list.map((r) => row(r, obs)).join('')}</tbody></table>`;
  const h3 = (t: string) => `<h3 style="margin:18px 0 6px">${t}</h3>`;
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#212121">` +
    `<h2 style="margin:0 0 4px">Nivel de Urea (AdBlue) – Flota Scania</h2>` +
    `<p style="margin:0 0 12px;color:#555">${esc(when)} (${esc(opts.tz)})</p>` +
    `<p style="margin:0 0 4px;font-size:14px"><b>${esc(summary)}</b></p>` +
    (exclNote ? `<p style="margin:0 0 12px;font-size:12px;color:#757575">${esc(exclNote)}</p>` : '') +
    h3('Requieren atención') +
    (red.length ? table(red, true) : `<p style="margin:0;color:#2e7d32">Ningún vehículo requiere atención</p>`) +
    h3('Resto de la flota') +
    (rest.length ? table(rest, false) : `<p style="margin:0;color:#555">Sin vehículos en esta sección</p>`) +
    `</div>`;

  const line = (r: ReportRow, obs: boolean) =>
    `${(r.plate ?? '—').padEnd(9)} ${r.vin}  ${fmtLevel(r.level).padStart(7)}  ${fmtDelta(r.delta).padStart(9)}  ${fmtFull(r.receivedAt, opts.tz)}${r.stale ? ' (desactualizado)' : ''}` +
    (obs ? `  ${observation(r, opts.now)}` : '');
  const text =
    `${subject}\n${summary}\n` + (exclNote ? `${exclNote}\n` : '') +
    `\nREQUIEREN ATENCIÓN\n` + (red.length ? red.map((r) => line(r, true)).join('\n') : 'Ningún vehículo requiere atención') +
    `\n\nRESTO DE LA FLOTA\n` + (rest.length ? rest.map((r) => line(r, false)).join('\n') : 'Sin vehículos en esta sección');
  return { subject, html, text };
}
