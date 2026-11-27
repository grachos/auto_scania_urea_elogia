import { describe, it, expect, vi } from 'vitest';
import { ScaniaClient } from '../src/scania/client.js';
import { fetchRfmsReadings } from '../src/scania/rfms.js';

const auth = () => ({ getToken: vi.fn(async () => 'tok'), invalidate: vi.fn() });
const mk = (f: any, a = auth()) => ({ a, c: new ScaniaClient({ baseUrl: 'https://s', auth: a, fetchFn: f, sleep: async () => {} }) });

describe('client', () => {
  it('re-auths once on 401', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(Response.json({ ok: 1 }));
    const { a, c } = mk(f);
    expect(await c.getJson('/x', 'application/json')).toEqual({ ok: 1 });
    expect(a.invalidate).toHaveBeenCalledTimes(1);
  });
  it('gives up after a second 401', async () => {
    const f = vi.fn(async () => new Response('', { status: 401 }));
    await expect(mk(f).c.getJson('/x', 'a')).rejects.toThrow(/401/);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('honours Retry-After on 429 and retries 5xx', async () => {
    const sleeps: number[] = [];
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '3' } }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: 1 }));
    const c = new ScaniaClient({ baseUrl: 'https://s', auth: auth(), fetchFn: f as any, sleep: async (ms) => { sleeps.push(ms); } });
    expect(await c.getJson('/x', 'a')).toEqual({ ok: 1 });
    expect(sleeps[0]).toBe(3000);
    expect(sleeps).toHaveLength(2);
  });
  it('paginates rFMS with lastVin and extracts snapshot fields', async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: any) => {
      const u = String(url);
      urls.push(u);
      if (u.includes('/rfms4/vehicles?')) return Response.json({ vehicleResponse: { vehicles: [] } });
      if (u.endsWith('/rfms4/vehicles')) return Response.json({ vehicleResponse: { vehicles: [{ vin: 'A', customerVehicleName: 'n', licensePlate: 'AAA111' }, { vin: 'B', licensePlate: 'BBB222' }] } });
      if (u.includes('lastVin=A')) return Response.json({ vehicleStatusResponse: { vehicleStatuses: [{ vin: 'B', receivedDateTime: '2026-01-01T00:00:00Z', snapshotData: {} }], moreDataAvailable: false } });
      return Response.json({ vehicleStatusResponse: { vehicleStatuses: [{ vin: 'A', receivedDateTime: '2026-01-01T00:00:00Z', snapshotData: { catalystFuelLevel: 42.5, fuelLevel1: 70, hrTotalVehicleDistance: 1000, gnssPosition: { latitude: 4, longitude: -74 } } }], moreDataAvailable: true } });
    });
    const out = await fetchRfmsReadings(mk(f).c);
    expect(urls.some((u) => u.includes('lastVin=A'))).toBe(true);
    const a = out.find((r) => r.vin === 'A')!;
    expect(a).toMatchObject({ plate: 'AAA111', ureaLevel: 42.5, fuelLevel: 70, odometerM: 1000, lat: 4, lon: -74 });
    expect(out.find((r) => r.vin === 'B')!.ureaLevel).toBeNull();
  });
});
