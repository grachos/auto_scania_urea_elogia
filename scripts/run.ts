import { loadConfig } from '../src/config.js';
import { buildDeps } from '../src/deps.js';
import { runReport } from '../src/runReport.js';

const dryRun = process.argv.includes('--dry-run');
try {
  const r = await runReport(buildDeps(loadConfig()), { dryRun });
  console.log(`Result: ${r.status}${r.error ? ' - ' + r.error : ''}`);
  process.exit(r.status === 'error' ? 1 : 0);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
