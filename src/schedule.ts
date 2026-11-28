/** Returns true when REPORT_HOURS is empty or the current hour in `tz` is listed (e.g. "0,4,8,12,16,20"). */
export function isReportHour(hoursCsv: string | undefined, tz: string, now: Date = new Date()): boolean {
  const hours = (hoursCsv ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (!hours.length) return true;
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hours.includes(h);
}
