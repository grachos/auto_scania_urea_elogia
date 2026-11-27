import type { ScaniaClient } from './client.js';
import type { VehicleReading } from '../sources/FleetSource.js';

export const RFMS = {
  vehicles: '/rfms4/vehicles',
  statuses: '/rfms4/vehiclestatuses?latestOnly=true&contentFilter=SNAPSHOT',
  acceptVehicles: 'application/json; rfms=vehicles.v4.0',
  acceptStatuses: 'application/json; rfms=vehiclestatuses.v4.0',
} as const;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Follow moreDataAvailable + lastVin; `pick` extracts the item array from a page. */
async function paginate(client: ScaniaClient, path: string, accept: string, pick: (page: any) => any[]) {
  const out: any[] = [];
  let lastVin: string | undefined;
  for (let guard = 0; guard < 500; guard++) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await client.getJson(lastVin ? `${path}${sep}lastVin=${encodeURIComponent(lastVin)}` : path, accept);
    const items = pick(page) ?? [];
    out.push(...items);
    const more = page?.moreDataAvailable ?? page?.vehicleStatusResponse?.moreDataAvailable ?? page?.vehicleResponse?.moreDataAvailable;
    const last = items.length ? items[items.length - 1].vin : undefined;
    if (!more || !last || last === lastVin) break;
    lastVin = last;
  }
  return out;
}

export async function fetchRfmsReadings(client: ScaniaClient): Promise<VehicleReading[]> {
  const vehicles = await paginate(client, RFMS.vehicles, RFMS.acceptVehicles, (p) => p?.vehicleResponse?.vehicles ?? p?.vehicles);
  const statuses = await paginate(client, RFMS.statuses, RFMS.acceptStatuses, (p) => p?.vehicleStatusResponse?.vehicleStatuses ?? p?.vehicleStatuses);

  // keep the newest status per VIN
  const latest = new Map<string, any>();
  for (const s of statuses) {
    const cur = latest.get(s.vin);
    if (!cur || String(s.receivedDateTime) > String(cur.receivedDateTime)) latest.set(s.vin, s);
  }
  const info = new Map<string, any>(vehicles.map((v) => [v.vin, v]));
  const vins = new Set([...info.keys(), ...latest.keys()]);

  return [...vins].map((vin) => {
    const v = info.get(vin);
    const s = latest.get(vin);
    const snap = s?.snapshotData ?? {};
    const pos = snap.gnssPosition ?? {};
    return {
      vin,
      plate: v?.licensePlate ?? v?.registrationNumber ?? null,
      name: v?.customerVehicleName ?? null,
      ureaLevel: num(snap.catalystFuelLevel),
      fuelLevel: num(snap.fuelLevel1),
      receivedAt: s?.receivedDateTime ?? null,
      lat: num(pos.latitude),
      lon: num(pos.longitude),
      odometerM: num(snap.hrTotalVehicleDistance),
    };
  });
}
