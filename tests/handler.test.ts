import { describe, it, expect, vi } from 'vitest';
import { createHandler } from '../api/cron/urea-report.js';

const res = () => {
  const r: any = { code: 0, body: undefined };
  r.status = (n: number) => { r.code = n; return r; };
  r.json = (b: unknown) => { r.body = b; };
  return r;
};
const run = vi.fn(async () => ({ status: 'ok' as const, rows: [] }));
const h = createHandler(() => ({}) as any, run, () => 's3cret');

describe('cron handler', () => {
  it('401 without or with wrong bearer', async () => {
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const r = res();
      await h({ headers }, r);
      expect(r.code).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });
  it('401 when CRON_SECRET unset', async () => {
    const r = res();
    await createHandler(() => ({}) as any, run, () => undefined)({ headers: { authorization: 'Bearer undefined' } }, r);
    expect(r.code).toBe(401);
  });
  it('200 with correct bearer', async () => {
    const r = res();
    await h({ headers: { authorization: 'Bearer s3cret' } }, r);
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok' });
  });
});
