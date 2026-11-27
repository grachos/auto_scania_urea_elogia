import type { ScaniaAuth } from './auth.js';

export interface ClientOpts {
  baseUrl: string;
  auth: Pick<ScaniaAuth, 'getToken' | 'invalidate'>;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

export class ScaniaClient {
  private f: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  constructor(private o: ClientOpts) {
    this.f = o.fetchFn ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getJson<T = any>(path: string, accept: string): Promise<T> {
    const max = this.o.maxAttempts ?? 4;
    let reauthed = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.o.auth.getToken();
      const res = await this.f(`${this.o.baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && !reauthed) {
        reauthed = true;
        this.o.auth.invalidate();
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= max) throw new Error(`Scania GET ${path.split('?')[0]} failed: HTTP ${res.status}`);
      const ra = Number(res.headers.get('retry-after'));
      await this.sleep(res.status === 429 && ra > 0 ? ra * 1000 : 500 * 2 ** (attempt - 1));
    }
  }
}
