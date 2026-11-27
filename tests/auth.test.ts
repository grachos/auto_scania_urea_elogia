import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { computeResponse, b64uDecode, b64uEncode, ScaniaAuth } from '../src/scania/auth.js';

describe('auth', () => {
  it('base64url roundtrip without padding', () => {
    const buf = Buffer.from([251, 255, 254, 1, 2]);
    const s = b64uEncode(buf);
    expect(s).not.toMatch(/[+/=]/);
    expect(b64uDecode(s).equals(buf)).toBe(true);
  });
  it('computes HMAC-SHA256 over decoded challenge with decoded secret', () => {
    const key = Buffer.from('super-secret-key-bytes');
    const chal = Buffer.from('challenge-bytes-123');
    const expected = createHmac('sha256', key).update(chal).digest('base64url');
    expect(computeResponse(key.toString('base64url'), chal.toString('base64url'))).toBe(expected);
  });
  it('logs in, caches the token, then refreshes when expired', async () => {
    let t = 0;
    const f = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('clientid2challenge')) return Response.json({ challenge: b64uEncode(Buffer.from('c')) });
      if (u.includes('response2token')) return Response.json({ token: 'T1', refreshToken: 'R1', expiresIn: 100 });
      if (u.includes('refreshtoken')) return Response.json({ token: 'T2', expiresIn: 100 });
      return new Response('', { status: 404 });
    });
    const a = new ScaniaAuth({ baseUrl: 'https://x', clientId: 'id', secretKey: b64uEncode(Buffer.from('k')), fetchFn: f as any, now: () => t });
    expect(await a.getToken()).toBe('T1');
    expect(await a.getToken()).toBe('T1');
    expect(f).toHaveBeenCalledTimes(2);
    t = 1e6;
    expect(await a.getToken()).toBe('T2');
  });
});
