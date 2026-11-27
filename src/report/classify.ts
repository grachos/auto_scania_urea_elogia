export type Status = 'CRITICO' | 'BAJO' | 'OK' | 'SIN_DATO';

export interface Thresholds { critical: number; low: number }

export const STALE_MS = 24 * 3600 * 1000;

export function classify(level: number | null | undefined, t: Thresholds): Status {
  if (level == null || Number.isNaN(level)) return 'SIN_DATO';
  if (level < t.critical) return 'CRITICO';
  if (level < t.low) return 'BAJO';
  return 'OK';
}

/** Stale when the last reading is older than 24h (or missing/unparseable). */
export function isStale(receivedAt: string | null | undefined, now: Date): boolean {
  const ts = receivedAt ? Date.parse(receivedAt) : NaN;
  return Number.isNaN(ts) || now.getTime() - ts > STALE_MS;
}
