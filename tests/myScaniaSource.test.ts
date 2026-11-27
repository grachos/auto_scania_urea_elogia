import { describe, it, expect, vi } from 'vitest';
import { loginMyScania, mapFleet, myScaniaSource, MYSCANIA } from '../src/sources/myScaniaSource.js';
import { loadConfig } from '../src/config.js';

const AUTH = 'https://mylogin.scania.com/auth/realms/fg-ext/';
const CIAM = 'https://mylogin.scania.com/auth/realms/ciam/';
const page = (action: string, pageId: string, extra = '') =>
  new Response(`<html><script>kcContext = {"loginAction": "${action.replace(/\//g, '\\/')}", "pageId": "${pageId}"${extra}}</script></html>`);
const redirect = (loc: string, cookies: string[] = []) => {
  const h = new Headers({ location: loc });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
};

function mockFlow(opts: { secondPage?: Response } = {}) {
  const calls: { url: string; init: any }[] = [];
  const f = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(MYSCANIA.authUrl + '?'))
      return new Response(
        `{"loginAction": "${AUTH}login-actions/authenticate?x=1&amp;y=2", "pageId": "login-email"}`,
        { headers: { 'set-cookie': 'AUTH_SESSION_ID=fg; Path=/auth/realms/fg-ext/' } },
      );
    if (u.startsWith(AUTH + 'login-actions/authenticate'))
      return redirect(CIAM + 'protocol/openid-connect/auth?z=1', ['AUTH_SESSION_ID=ciam; Path=/auth/realms/ciam/']);
    if (u.startsWith(CIAM + 'protocol/openid-connect/auth')) return page(CIAM + 'login-actions/authenticate?s=1', 'login');
    if (u.startsWith(CIAM + 'login-actions/authenticate'))
      return opts.secondPage ?? redirect(MYSCANIA.redirectUri + '#state=s&session_state=q&code=CODE123');
    if (u === MYSCANIA.tokenUrl) return Response.json({ access_token: 'TOK', expires_in: 300 });
    if (u === MYSCANIA.fleetUrl)
      return Response.json([
        { adBlueLevel: 42, fuelLevel: 80, odometerInMeters: 1000, timeMessage: '2026-01-01T00:00:00Z', position: { latitude: 1, longitude: 2 }, equipment: { vin: 'V1', registrationNumber: 'ABC123', alias: 'A' } },
        { adBlueLevel: null, fuelLevel: 10, odometerInMeters: 5, timeMessage: null, equipment: { chassisNumber: 'C2', registrationNumber: 'XYZ999' } },
        { adBlueLevel: 5, equipment: { vin: 'GONE', withdrawn: true } },
      ]);
    return new Response('', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('myScaniaSource', () => {
  it('logs in through both pages, sends path-aware cookies, extracts fragment code and exchanges token', async () => {
    const { f, calls } = mockFlow();
    const tok = await loginMyScania({ user: 'u@x.com', pass: 'pw', fetchFn: f });
    expect(tok).toBe('TOK');

    const p1 = calls.find((c) => c.url.startsWith(AUTH + 'login-actions/authenticate'))!;
    expect(p1.url).toContain('x=1&y=2');
    expect(p1.init.method).toBe('POST');
    expect(String(p1.init.body)).toBe('email=u%40x.com&login=');
    expect(p1.init.headers.cookie).toBe('AUTH_SESSION_ID=fg');

    const p2 = calls.find((c) => c.url.startsWith(CIAM + 'login-actions/authenticate'))!;
    expect(p2.init.headers.cookie).toBe('AUTH_SESSION_ID=ciam');
    const body = new URLSearchParams(String(p2.init.body));
    expect(body.get('username')).toBe('u@x.com');
    expect(body.get('password')).toBe('pw');
    expect(body.get('credentialId')).toBe('');

    const tokenCall = calls.find((c) => c.url === MYSCANIA.tokenUrl)!;
    const tb = new URLSearchParams(String(tokenCall.init.body));
    expect(tb.get('code')).toBe('CODE123');
    expect(tb.get('grant_type')).toBe('authorization_code');
    expect(tb.get('code_verifier')).toBeTruthy();
    const auth = new URL(calls[0]!.url).searchParams;
    expect(auth.get('code_challenge_method')).toBe('S256');
    expect(auth.get('response_mode')).toBe('fragment');
  });

  it('throws a clear error without the password when the second page returns an error', async () => {
    const { f } = mockFlow({ secondPage: page(CIAM + 'login-actions/authenticate?s=2', 'login', ', "message": {"summary": "Invalid username or password."}') });
    const err = await loginMyScania({ user: 'u@x.com', pass: 'sekret', fetchFn: f }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/login/);
    expect(err.message).toMatch(/Invalid username or password/);
    expect(err.message).not.toMatch(/sekret/);
  });

  it('fetchReadings maps vehicles: null adBlue kept as null, withdrawn skipped', async () => {
    const { f, calls } = mockFlow();
    const cfg = loadConfig({ SOURCE: 'scrape', MYSCANIA_USER: 'u@x.com', MYSCANIA_PASS: 'pw', RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.co' });
    const r = await myScaniaSource(cfg, f).fetchReadings();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ vin: 'V1', plate: 'ABC123', name: 'A', ureaLevel: 42, fuelLevel: 80, odometerM: 1000, lat: 1, lon: 2, receivedAt: '2026-01-01T00:00:00Z' });
    expect(r[1]).toMatchObject({ vin: 'C2', plate: 'XYZ999', ureaLevel: null, receivedAt: null, lat: null });
    const fl = calls.find((c) => c.url === MYSCANIA.fleetUrl)!;
    expect(fl.init.headers.authorization).toBe('Bearer TOK');
    expect(fl.init.headers['x-client']).toBe(MYSCANIA.clientId);
  });

  it('mapFleet skips withdrawn', () => {
    expect(mapFleet([{ equipment: { vin: 'A', withdrawn: true } }])).toEqual([]);
  });
});
