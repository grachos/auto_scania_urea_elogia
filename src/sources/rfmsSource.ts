import type { Config } from '../config.js';
import { ScaniaAuth } from '../scania/auth.js';
import { ScaniaClient } from '../scania/client.js';
import { fetchRfmsReadings } from '../scania/rfms.js';
import type { FleetSource } from './FleetSource.js';

export function rfmsSource(cfg: Config): FleetSource {
  const baseUrl = cfg.SCANIA_BASE_URL;
  const auth = new ScaniaAuth({ baseUrl, clientId: cfg.SCANIA_CLIENT_ID!, secretKey: cfg.SCANIA_SECRET_KEY! });
  const client = new ScaniaClient({ baseUrl, auth });
  return { fetchReadings: () => fetchRfmsReadings(client) };
}
