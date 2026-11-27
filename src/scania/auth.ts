import { createHmac } from 'node:crypto';

// Endpoint names isolated here in case Scania changes them.
export const EP = {
  challenge: '/auth/clientid2challenge',
  token: '/auth/response2token',
  refresh: '/auth/refreshtoken',
} as const;

export const b64uDecode = (s: string) => Buffer.from(s, 'base64url');
export const b64uEncode = (b: Buffer) => b.toString('base64url');

/** response = base64url(HMAC-SHA256(key=b64uDecode(secret), msg=b64uDecode(challenge))) */
export function computeResponse(secretKey: string, challenge: string): string {
  return b64uEncode(createHmac('sha256', b64uDecode(secretKey)).update(b64uDecode(challenge)).digest());
}

export interface AuthOpts {
  baseUrl: string;
  clientId: string;
  secretKey: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface TokenState { token: string; refreshToken?: string; expiresAt: number }

export class ScaniaAuth {
  private state?: TokenState;
  private f: typeof fetch;
  private now: () => number;
  constructor(private o: AuthOpts) {
    this.f = o.fetchFn ?? fetch;
    this.now = o.now ?? Date.now;
  }

  private form(p: Record<string, string>) {
    return { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(p).toString() };
  }

  private store(j: any) {
    const token = j?.token ?? j?.Token;
    if (!token) throw new Error('Scania auth: no token in response');
    const ttl = Number(j.expiresIn ?? j.expires_in ?? 3600);
    // refresh a minute early
    this.state = { token, refreshToken: j.refreshToken ?? j.RefreshToken ?? this.state?.refreshToken, expiresAt: this.now() + Math.max(ttl - 60, 30) * 1000 };
  }

  private async login() {
    const { baseUrl, clientId, secretKey } = this.o;
    const cr = await this.f(`${baseUrl}${EP.challenge}?clientId=${encodeURIComponent(clientId)}`, { headers: { Accept: 'application/json' } });
    if (!cr.ok) throw new Error(`Scania auth: challenge failed (${cr.status})`);
    const cj: any = await cr.json();
    const challenge = cj?.challenge ?? cj?.Challenge;
    if (!challenge) throw new Error('Scania auth: no challenge in response');
    const tr = await this.f(`${baseUrl}${EP.token}`, this.form({ clientId, Response: computeResponse(secretKey, challenge) }));
    if (!tr.ok) throw new Error(`Scania auth: token failed (${tr.status})`);
    this.store(await tr.json());
  }

  private async refresh(): Promise<boolean> {
    const rt = this.state?.refreshToken;
    if (!rt) return false;
    const r = await this.f(`${this.o.baseUrl}${EP.refresh}`, this.form({ refreshToken: rt }));
    if (!r.ok) return false;
    this.store(await r.json());
    return true;
  }

  async getToken(): Promise<string> {
    if (this.state && this.state.expiresAt > this.now()) return this.state.token;
    if (!(this.state && (await this.refresh()))) await this.login();
    return this.state!.token;
  }

  /** Drop cached token (e.g. after a 401) so the next call does a full login. */
  invalidate() { this.state = undefined; }
}
