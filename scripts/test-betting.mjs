import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Every suite runs in its own process with the explicit isolated database
// bootstrap, including older tests that import the database driver indirectly.
const root = fileURLToPath(new URL('../',import.meta.url));
const suites = [
  'test-auth-refresh-browser.mjs',
  'test-admin-match-reads.mjs', 'test-admin-match-control-browser.mjs',
  'test-mobile-sportsbar.mjs', 'test-language-browser.mjs', 'test-match-order.mjs', 'test-user-removal.mjs',
  'test-match-pages.mjs', 'test-pending-results.mjs', 'test-subscribe-plan.mjs',
  'test-ticket-pricing.mjs', 'test-manager-finance.mjs', 'test-player-control-policy.mjs',
  'test-live-risk.mjs', 'test-live-money-risk.mjs', 'test-result-btts.mjs',
  'test-mixed-combos.mjs', 'test-bet-builder-admin.mjs', 'test-bet-builder.mjs',
  'test-system-columns.mjs', 'test-system-columns-ledger.mjs', 'test-system-columns-feed.mjs',
  'test-automatic-combos.mjs', 'test-combo-risk-settings.mjs', 'test-combo-placement.mjs', 'test-combo-feasibility.mjs',
  'test-selection-market.mjs', 'test-betslip-columns.mjs', 'test-format-odds.mjs', 'test-betslip-browser.mjs', 'test-betslip-layout.mjs', 'test-sportsbook-labels.mjs', 'test-user-error.mjs', 'test-board-projection.mjs', 'test-static-cache.mjs',
  'test-market-expiry.mjs', 'test-market-identity.mjs', 'test-settlement-results.mjs', 'test-mobile-betslip-badge.mjs',
  'test-match-sync.mjs', 'test-match-sync-browser.mjs',
];
for (const suite of suites) {
  process.stdout.write(`\n[betting] ${suite}\n`);
  const result = spawnSync(process.execPath, ['--import','./scripts/fixtures/isolated-casino-env.mjs',`scripts/${suite}`], {
    cwd:root,stdio:'inherit',env:process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
process.stdout.write(`\nPASS all ${suites.length} isolated betting suites\n`);
