import { loadConfig, type Config } from './config.js';
import { createMailer } from './mail/index.js';
import { memoryRepo, supabaseRepo } from './db/repo.js';
import { rfmsSource } from './sources/rfmsSource.js';
import { scrapeSource } from './sources/scrapeSource.js';
import type { Deps } from './runReport.js';

export function buildDeps(cfg: Config = loadConfig()): Deps {
  return {
    source: cfg.SOURCE === 'scrape' ? scrapeSource(cfg) : rfmsSource(cfg),
    repo: cfg.SUPABASE_URL ? supabaseRepo(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY!) : memoryRepo(),
    mailer: createMailer(cfg),
    thresholds: { critical: cfg.THRESHOLD_CRITICAL, low: cfg.THRESHOLD_LOW },
    tz: cfg.TZ_REPORT,
    fallbackTo: cfg.mailTo,
  };
}
