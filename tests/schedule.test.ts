import { describe, it, expect, vi } from 'vitest';
import { isReportHour } from '../src/schedule.js';
import { createHandler } from '../api/cron/urea-report.js';

describe('isReportHour', () => {
  const tz = 'America/Bogota';
  it('empty list always runs', () => expect(isReportHour('', tz)).toBe(true));
  it('uses Bogotá hour, not UTC', () => {
    expect(isReportHour('0,4,8,12,16,20', tz, new Date('2026-11-28T01:00:00Z'))).toBe(true); // 20:00 Bogotá
    expect(isReportHour('0,4,8,12,16,20', tz, new Date('2026-11-28T00:00:00Z'))).toBe(false); // 19:00 Bogotá
    expect(isReportHour('0,4,8,12,16,20', tz, new Date('2026-11-28T05:00:00Z'))).toBe(true); // 00:00 Bogotá
  });
});

describe('handler schedule gate', () => {
  const res = () => { const r: any = {}; r.status = (n: number) => { r.code = n; return r; }; r.json = (b: unknown) => { r.body = b; }; return r; };
  const auth = { authorization: 'Bearer s' };
  it('skips without running when not a report hour', async () => {
    const run = vi.fn(async () => ({ status: 'ok' as const }));
    const r = res();
    await createHandler(() => ({}) as any, run, () => 's', () => false)({ headers: auth }, r);
    expect(r.body).toMatchObject({ status: 'skipped' });
    expect(run).not.toHaveBeenCalled();
  });
  it('force=1 bypasses the gate', async () => {
    const run = vi.fn(async () => ({ status: 'ok' as const, rows: [] }));
    const r = res();
    await createHandler(() => ({}) as any, run, () => 's', () => false)({ headers: auth, url: '/api/cron/urea-report?force=1' }, r);
    expect(run).toHaveBeenCalled();
  });
});
