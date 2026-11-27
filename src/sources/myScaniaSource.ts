import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { FleetSource, VehicleReading } from './FleetSource.js';

/** All endpoints / identifiers of the My Scania (Keycloak) login flow live here. */
export const MYSCANIA = {
  authUrl: 'https://mylogin.scania.com/auth/realms/fg-ext/protocol/openid-connect/auth',
  tokenUrl: 'https://mylogin.scania.com/auth/realms/fg-ext/protocol/openid-connect/token',
  fleetUrl: 'https://fleetposition.do.prod.gf.aws.scania.com/v5/fleetposition?settingsChanged=false',
  clientId: 'cs_fmp_fleetposition_app',
  redirectUri: 'https://fleetposition.scania.com/post-login',
  userAgent: 'Mozilla/5.0',
} as const;

type FetchFn = typeof fetch;

/** Minimal path-aware cookie jar (key host|path|name). */
export class CookieJar {
  private jar = new Map<string, string>();

  store(url: string, res: Response): void {
    const host = new URL(url).host;
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const parts = c.split(';').map((x) => x.trim());
      const kv = parts[0]!;
      const i = kv.indexOf('=');
      if (i < 0) continue;
      const path = (parts.find((x) => /^path=/i.test(x)) || 'path=/').slice(5);
      const expired = /max-age=0|expires=thu, 01.jan.1970/i.test(c);
      const key = `${host}|${path}|${kv.slice(0, i)}`;
      if (expired) this.jar.delete(key);
      else this.jar.set(key, kv);
    }
  }

  header(url: string): string {
    const u = new URL(url);
    return [...this.jar.entries()]
      .filter(([k]) => {
        const [h, p] = k.split('|');
        return h === u.host && u.pathname.startsWith(p!);
      })
      .map(([, v]) => v)
      .join('; ');
  }
}

interface Hop {
  url: string;
  html: string;
  final?: string;
}

const formAction = (html: string, base: string): string | null => {
  const m = html.match(/"loginAction":\s*"([^"]+)"/) || html.match(/<form[^>]*action="([^"]+)"/i);
  return m ? new URL(m[1]!.replace(/\\\//g, '/').replace(/&amp;/g, '&'), base).toString() : null;
};
const pageId = (h: string) => h.match(/"pageId":\s*"([^"]+)"/)?.[1];
const summary = (h: string) => h.match(/"summary":\s*"([^"]*)"/)?.[1];

export interface MyScaniaOpts {
  user: string;
  pass: string;
  fetchFn?: FetchFn;
}

/** Logs in through the Keycloak flow (PKCE) and returns an access token. */
export async function loginMyScania(o: MyScaniaOpts): Promise<string> {
  const f = o.fetchFn ?? fetch;
  const jar = new CookieJar();

  async function go(url: string, init: RequestInit = {}): Promise<Hop> {
    for (let i = 0; i < 15; i++) {
      const res = await f(url, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers as Record<string, string> | undefined), cookie: jar.header(url), 'user-agent': MYSCANIA.userAgent },
      });
      jar.store(url, res);
      const loc = res.headers.get('location');
      if (loc && res.status >= 300 && res.status < 400) {
        const next = new URL(loc, url).toString();
        if (next.startsWith(MYSCANIA.redirectUri)) return { url, html: '', final: next };
        url = next;
        init = {};
        continue;
      }
      return { url, html: await res.text() };
    }
    throw new Error('My Scania login: too many redirects');
  }

  const post = (hop: Hop, body: Record<string, string>) => {
    const action = formAction(hop.html, hop.url);
    if (!action) throw new Error(`My Scania login: no login form found (pageId=${pageId(hop.html) ?? 'unknown'})`);
    return go(action, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  };

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authUrl =
    MYSCANIA.authUrl +
    '?' +
    new URLSearchParams({
      client_id: MYSCANIA.clientId,
      redirect_uri: MYSCANIA.redirectUri,
      response_type: 'code',
      response_mode: 'fragment',
      scope: 'openid',
      state: randomUUID(),
      nonce: randomUUID(),
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

  let r = await go(authUrl);
  if (!r.final) r = await post(r, { email: o.user, login: '' });
  if (!r.final) r = await post(r, { username: o.user, password: o.pass, credentialId: '', login: '' });
  if (!r.final) {
    throw new Error(
      `My Scania login failed: page "${pageId(r.html) ?? 'unknown'}"${summary(r.html) ? ` - ${summary(r.html)}` : ''} (wrong credentials, MFA/OTP or other required action)`,
    );
  }

  const code = new URLSearchParams(new URL(r.final).hash.slice(1)).get('code');
  if (!code) throw new Error('My Scania login: no authorization code in redirect');

  const t = await f(MYSCANIA.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: MYSCANIA.redirectUri,
      client_id: MYSCANIA.clientId,
      code_verifier: verifier,
    }),
  });
  if (!t.ok) throw new Error(`My Scania token exchange failed: HTTP ${t.status}`);
  const tok = (await t.json()) as { access_token?: string };
  if (!tok.access_token) throw new Error('My Scania token exchange returned no access_token');
  return tok.access_token;
}

export function mapFleet(items: any[]): VehicleReading[] {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const out: VehicleReading[] = [];
  for (const it of items) {
    const eq = it?.equipment ?? {};
    if (eq.withdrawn === true) continue;
    const vin = eq.vin || eq.chassisNumber || eq.externalEquipmentReference;
    if (!vin) continue;
    out.push({
      vin: String(vin),
      plate: eq.registrationNumber ?? null,
      name: eq.alias ?? null,
      ureaLevel: num(it.adBlueLevel),
      fuelLevel: num(it.fuelLevel),
      receivedAt: it.timeMessage ?? null,
      lat: num(it.position?.latitude),
      lon: num(it.position?.longitude),
      odometerM: num(it.odometerInMeters),
    });
  }
  return out;
}

export function myScaniaSource(cfg: Config, fetchFn?: FetchFn): FleetSource {
  return {
    async fetchReadings() {
      const f = fetchFn ?? fetch;
      const token = await loginMyScania({ user: cfg.MYSCANIA_USER!, pass: cfg.MYSCANIA_PASS!, fetchFn: f });
      const res = await f(MYSCANIA.fleetUrl, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'x-client': MYSCANIA.clientId,
          'x-correlation-id': randomUUID(),
        },
      });
      if (!res.ok) throw new Error(`My Scania fleetposition failed: HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('My Scania fleetposition: unexpected response (not an array)');
      return mapFleet(data);
    },
  };
}
