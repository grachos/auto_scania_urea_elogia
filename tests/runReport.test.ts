import { describe, it, expect, vi } from 'vitest';
import { runReport } from '../src/runReport.js';
import { memoryRepo } from '../src/db/repo.js';
import type { VehicleReading } from '../src/sources/FleetSource.js';
import { renderReport } from '../src/report/render.js';

const now = new Date('2026-03-10T15:30:00Z'); // 10:30 Bogota
const rd = (vin: string, lvl: number | null, at: string | null = '2026-03-10T15:00:00Z'): VehicleReading =>
  ({ vin, plate: 'P' + vin, ureaLevel: lvl, fuelLevel: null, receivedAt: at, lat: null, lon: null, odometerM: null });
const mkDeps = (readings: VehicleReading[] | Error, repo = memoryRepo(['db@example.com'])) => {
  const sent: any[] = [];
  return {
    sent, repo,
    deps: {
      source: { fetchReadings: async () => { if (readings instanceof Error) throw readings; return readings; } },
      repo, mailer: { send: async (m: any) => { sent.push(m); } },
      thresholds: { critical: 50, low: 70 }, tz: 'America/Bogota', fallbackTo: ['fallback@example.com'], now: () => now, log: () => {},
    },
  };
};

describe('runReport', () => {
  it('sends sorted report, stores readings, computes delta vs previous', async () => {
    const m = mkDeps([rd('1', 60, '2026-03-10T15:00:00Z'), rd('2', 10), rd('3', null)]);
    await m.repo.insertReadings([rd('2', 30, '2026-03-10T11:00:00Z')]);
    const r = await runReport(m.deps);
    expect(r.status).toBe('ok');
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].to).toEqual(['db@example.com']);
    expect(m.sent[0].subject).toBe('[Urea Scania] 1 requieren atención – 10/03 10:30');
    expect(r.rows!.find((x) => x.vin === '2')!.delta).toBe(-20);
    expect(m.repo.readings).toHaveLength(4); // 3 new + 1 earlier
    const html = m.sent[0].html as string;
    expect(html.indexOf('P2')).toBeLessThan(html.indexOf('P1'));
    expect(html).not.toContain('P3');
    expect(html).toContain('1 vehículo no reporta nivel de urea');
  });
  it('dry run prints html and does not send or persist', async () => {
    const logs: string[] = [];
    const m = mkDeps([rd('1', 10)]);
    const r = await runReport({ ...m.deps, log: (s) => logs.push(s) }, { dryRun: true });
    expect(r.status).toBe('ok');
    expect(m.sent).toHaveLength(0);
    expect(m.repo.readings).toHaveLength(0);
    expect(logs.join('')).toContain('<table');
  });
  it('falls back to MAIL_TO when no recipients', async () => {
    const m = mkDeps([rd('1', 10)], memoryRepo([]));
    await runReport(m.deps);
    expect(m.sent[0].to).toEqual(['fallback@example.com']);
  });
  it('sends an alert and records error when Scania fails', async () => {
    const m = mkDeps(new Error('boom'));
    const r = await runReport(m.deps);
    expect(r.status).toBe('error');
    expect(m.sent[0].subject).toContain('ERROR');
    expect(m.repo.runs[0]).toMatchObject({ status: 'error', detail: 'boom' });
  });
  it('skips when a recent run is still running', async () => {
    const m = mkDeps([rd('1', 10)]);
    await m.repo.startRun(new Date(now.getTime() - 5 * 60000));
    expect((await runReport(m.deps)).status).toBe('skipped');
    expect(m.sent).toHaveLength(0);
  });
  it('ignores stale lock older than 10 minutes and duplicate readings', async () => {
    const m = mkDeps([rd('1', 10)]);
    await m.repo.startRun(new Date(now.getTime() - 11 * 60000));
    expect((await runReport(m.deps)).status).toBe('ok');
    await m.repo.insertReadings([rd('1', 10)]);
    expect(m.repo.readings).toHaveLength(1);
  });
  it('renders sections, observation text and stale suffix; excludes null', () => {
    const base = { vin: 'V', delta: null, receivedAt: '2026-03-10T15:00:00Z', stale: false };
    const rows = [
      { ...base, plate: 'AMA', level: 60, status: 'AMARILLO' as const },
      { ...base, plate: 'NUL', level: null, status: 'SIN_DATO' as const, receivedAt: null, stale: true },
      { ...base, plate: 'ROJ45', level: 45, status: 'ROJO' as const, receivedAt: '2026-03-09T09:30:00Z', stale: true },
      { ...base, plate: 'ROJ30', level: 30, status: 'ROJO' as const },
      { ...base, plate: 'VER', level: 90, status: 'VERDE' as const },
    ];
    const { html, text, subject } = renderReport(rows, { now, tz: 'America/Bogota' });
    expect(subject).toBe('[Urea Scania] 2 requieren atención – 10/03 10:30');
    expect(html).not.toContain('NUL');
    expect(html).not.toContain('SIN_DATO');
    expect(html.indexOf('Requieren atención')).toBeLessThan(html.indexOf('Resto de la flota'));
    expect(html.indexOf('ROJ30')).toBeLessThan(html.indexOf('ROJ45'));
    expect(html.indexOf('Resto de la flota')).toBeLessThan(html.indexOf('AMA'));
    expect(html.indexOf('AMA')).toBeLessThan(html.indexOf('VER'));
    expect(html).toContain('Por debajo del 40 % – recargar urea');
    expect(html).toContain('Cerca del 40 % – programar recarga · dato de hace 30 h');
    expect(html).toContain('Observación');
    expect(text).toContain('REQUIEREN ATENCIÓN');
    expect(text).toContain('RESTO DE LA FLOTA');
    expect(text).toContain('Por debajo del 40 % – recargar urea');
    expect(text).not.toContain('NUL');
  });
  it('shows empty message when no red vehicles', () => {
    const { html, subject } = renderReport([{ plate: 'V', vin: 'V', level: 90, status: 'VERDE', delta: null, receivedAt: null, stale: false }], { now, tz: 'America/Bogota' });
    expect(html).toContain('Ningún vehículo requiere atención');
    expect(subject).toContain('0 requieren atención');
  });
});
