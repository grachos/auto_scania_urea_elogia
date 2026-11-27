import { describe, it, expect } from 'vitest';
import { classify, isStale } from '../src/report/classify.js';

const t = { critical: 50, low: 70 };
describe('classify', () => {
  it.each([[49.99, 'ROJO'], [50, 'ROJO'], [50.01, 'AMARILLO'], [70, 'AMARILLO'], [70.01, 'VERDE'], [null, 'SIN_DATO']] as const)('%s -> %s', (l, s) => {
    expect(classify(l, t)).toBe(s);
  });
  it('stale after 24h', () => {
    const now = new Date('2026-01-02T12:00:00Z');
    expect(isStale('2026-01-01T12:01:00Z', now)).toBe(false);
    expect(isStale('2026-01-01T11:59:00Z', now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });
});
