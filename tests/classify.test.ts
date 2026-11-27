import { describe, it, expect } from 'vitest';
import { classify, isStale } from '../src/report/classify.js';

const t = { critical: 20, low: 35 };
describe('classify', () => {
  it.each([[19.99, 'CRITICO'], [20, 'BAJO'], [34.99, 'BAJO'], [35, 'OK'], [null, 'SIN_DATO']] as const)('%s -> %s', (l, s) => {
    expect(classify(l, t)).toBe(s);
  });
  it('stale after 24h', () => {
    const now = new Date('2026-01-02T12:00:00Z');
    expect(isStale('2026-01-01T12:01:00Z', now)).toBe(false);
    expect(isStale('2026-01-01T11:59:00Z', now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });
});
