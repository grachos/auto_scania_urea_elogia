import type { Config } from '../config.js';
import type { FleetSource, VehicleReading } from './FleetSource.js';

// TODO: fill in once the fleet UI DOM is known. Override via env if needed.
export const SEL = {
  email: 'input[type="email"], input[name="email"], #email',
  username: 'input[name="username"], #username',
  password: 'input[name="password"], #password',
  submit: 'button[type="submit"], input[type="submit"]',
  mfa: 'input[name="otp"], input[name="totp"], #otp',
  fleetUrl: process.env.MYSCANIA_FLEET_URL ?? 'https://my.scania.com', // TODO: real fleet/vehicles page
  vehicleRow: process.env.MYSCANIA_ROW_SELECTOR ?? '', // TODO
  vin: '', // TODO relative to row
  plate: '', // TODO
  urea: '', // TODO
};

/** Optional Playwright scraper. Playwright is an optionalDependency, loaded dynamically. */
export function scrapeSource(cfg: Config): FleetSource {
  return {
    async fetchReadings(): Promise<VehicleReading[]> {
      const mod = 'playwright'; // variable keeps TS/bundlers from resolving it statically
      let pw: any;
      try {
        pw = await import(mod);
      } catch {
        throw new Error('SOURCE=scrape needs the optional dependency "playwright" (npm i playwright && npx playwright install chromium)');
      }
      const browser = await pw.chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto('https://my.scania.com', { waitUntil: 'domcontentloaded' });

        // Keycloak: step 1 email (if present), step 2 username/password. Forms are filled live; no captured session_code URLs.
        const email = page.locator(SEL.email).first();
        if (await email.isVisible({ timeout: 15000 }).catch(() => false)) {
          await email.fill(cfg.MYSCANIA_USER!);
          await page.locator(SEL.submit).first().click();
        }
        const user = page.locator(SEL.username).first();
        if (await user.isVisible({ timeout: 15000 }).catch(() => false)) await user.fill(cfg.MYSCANIA_USER!);
        const pass = page.locator(SEL.password).first();
        if (!(await pass.isVisible({ timeout: 15000 }).catch(() => false))) {
          throw new Error('Scrape login: password field not found (unknown login DOM)');
        }
        await pass.fill(cfg.MYSCANIA_PASS!);
        await page.locator(SEL.submit).first().click();
        await page.waitForLoadState('networkidle').catch(() => {});

        if (await page.locator(SEL.mfa).first().isVisible({ timeout: 3000 }).catch(() => false)) {
          throw new Error('Scrape login: MFA/OTP required; automated login is not possible with this account');
        }
        if (!SEL.vehicleRow || !SEL.urea) {
          throw new Error('Scrape: fleet extraction selectors not configured yet (see SEL in src/sources/scrapeSource.ts)');
        }
        await page.goto(SEL.fleetUrl, { waitUntil: 'networkidle' });
        const rows: { vin: string; plate: string; urea: string }[] = await page.$$eval(
          SEL.vehicleRow,
          (els: Element[], s: any) => els.map((e) => ({
            vin: e.querySelector(s.vin)?.textContent?.trim() ?? '',
            plate: e.querySelector(s.plate)?.textContent?.trim() ?? '',
            urea: e.querySelector(s.urea)?.textContent?.trim() ?? '',
          })),
          SEL,
        );
        if (!rows.length) throw new Error('Scrape: no vehicle rows found (unknown fleet DOM)');
        const now = new Date().toISOString();
        return rows.map((r) => {
          const n = parseFloat(r.urea.replace(',', '.'));
          return { vin: r.vin, plate: r.plate || null, ureaLevel: Number.isFinite(n) ? n : null, fuelLevel: null, receivedAt: now, lat: null, lon: null, odometerM: null };
        });
      } finally {
        await browser.close();
      }
    },
  };
}
