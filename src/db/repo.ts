import { createClient } from '@supabase/supabase-js';
import type { VehicleReading } from '../sources/FleetSource.js';

export interface PrevReading { level: number | null; receivedAt: string }

export interface Repo {
  upsertVehicles(v: { vin: string; plate: string | null; name?: string | null }[]): Promise<void>;
  /** Insert readings, silently ignoring duplicates on (vin, received_at). */
  insertReadings(r: VehicleReading[]): Promise<void>;
  /** Latest stored reading per VIN strictly older than the given current receivedAt. */
  getPrevious(cur: { vin: string; receivedAt: string | null }[]): Promise<Map<string, PrevReading>>;
  getRecipients(): Promise<string[]>;
  /** Returns run id, or null if a 'running' run younger than 10 min exists. */
  startRun(now?: Date): Promise<string | null>;
  finishRun(id: string, status: 'ok' | 'error', detail?: string): Promise<void>;
}

export const LOCK_MS = 10 * 60 * 1000;
const hasData = (r: VehicleReading): r is VehicleReading & { receivedAt: string } => !!r.receivedAt;

export function memoryRepo(recipients: string[] = []): Repo & { readings: any[]; runs: any[] } {
  const readings: any[] = [];
  const runs: any[] = [];
  let n = 0;
  return {
    readings, runs,
    async upsertVehicles() {},
    async insertReadings(rs) {
      for (const r of rs.filter(hasData))
        if (!readings.some((x) => x.vin === r.vin && x.receivedAt === r.receivedAt)) readings.push({ ...r });
    },
    async getPrevious(cur) {
      const out = new Map<string, PrevReading>();
      for (const c of cur) {
        const prev = readings
          .filter((x) => x.vin === c.vin && (!c.receivedAt || x.receivedAt < c.receivedAt))
          .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))[0];
        if (prev) out.set(c.vin, { level: prev.ureaLevel, receivedAt: prev.receivedAt });
      }
      return out;
    },
    async getRecipients() { return recipients; },
    async startRun(now = new Date()) {
      if (runs.some((r) => r.status === 'running' && now.getTime() - r.startedAt.getTime() < LOCK_MS)) return null;
      const id = `run-${++n}`;
      runs.push({ id, status: 'running', startedAt: now });
      return id;
    },
    async finishRun(id, status, detail) { Object.assign(runs.find((r) => r.id === id)!, { status, detail }); },
  };
}

export function supabaseRepo(url: string, key: string): Repo {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const check = (error: { message: string } | null, what: string) => { if (error) throw new Error(`Supabase ${what}: ${error.message}`); };
  return {
    async upsertVehicles(v) {
      if (!v.length) return;
      check((await db.from('urea_vehicles').upsert(v.map((x) => ({ vin: x.vin, plate: x.plate, name: x.name ?? null, updated_at: new Date().toISOString() })), { onConflict: 'vin' })).error, 'upsert vehicles');
    },
    async insertReadings(rs) {
      const rows = rs.filter(hasData).map((r) => ({ vin: r.vin, urea_level: r.ureaLevel, fuel_level: r.fuelLevel, received_at: r.receivedAt, lat: r.lat, lon: r.lon, odometer_m: r.odometerM }));
      if (!rows.length) return;
      check((await db.from('urea_readings').upsert(rows, { onConflict: 'vin,received_at', ignoreDuplicates: true })).error, 'insert readings');
    },
    async getPrevious(cur) {
      const out = new Map<string, PrevReading>();
      const vins = cur.map((c) => c.vin);
      if (!vins.length) return out;
      // Pull recent rows for all VINs in one query, newest first, and pick per VIN in JS.
      const { data, error } = await db.from('urea_readings').select('vin,urea_level,received_at').in('vin', vins)
        .order('received_at', { ascending: false }).limit(vins.length * 20);
      check(error, 'get previous');
      const curTs = new Map(cur.map((c) => [c.vin, c.receivedAt ? Date.parse(c.receivedAt) : Infinity]));
      for (const row of data ?? []) {
        if (out.has(row.vin)) continue;
        if (Date.parse(row.received_at) < (curTs.get(row.vin) ?? Infinity)) out.set(row.vin, { level: row.urea_level == null ? null : Number(row.urea_level), receivedAt: row.received_at });
      }
      return out;
    },
    async getRecipients() {
      const { data, error } = await db.from('urea_recipients').select('email').eq('active', true);
      check(error, 'get recipients');
      return (data ?? []).map((r) => r.email as string);
    },
    async startRun(now = new Date()) {
      // Not atomic (read-then-insert); acceptable for a 4-hourly cron.
      const since = new Date(now.getTime() - LOCK_MS).toISOString();
      const { data, error } = await db.from('urea_job_runs').select('id').eq('status', 'running').gt('started_at', since).limit(1);
      check(error, 'check lock');
      if (data?.length) return null;
      const ins = await db.from('urea_job_runs').insert({ status: 'running', started_at: now.toISOString() }).select('id').single();
      check(ins.error, 'start run');
      return ins.data!.id as string;
    },
    async finishRun(id, status, detail) {
      check((await db.from('urea_job_runs').update({ status, detail: detail?.slice(0, 1000) ?? null, finished_at: new Date().toISOString() }).eq('id', id)).error, 'finish run');
    },
  };
}
