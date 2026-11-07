import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const suites=['test-casino-math.mjs','test-original-engine-profiles.mjs','test-original-wallet-profiles.mjs',
  'test-legacy-wallet-profiles.mjs','test-casino-profile-admin.mjs','test-original-spin-sampling.mjs',
  'test-bookofra-profile-protocol.mjs','test-sizzling-profile-protocol.mjs',
  'test-casino-bet-limits.mjs','test-custom-casino-math.mjs','test-custom-casino-wallet.mjs','test-casino-rtp-extended.mjs','test-casino-controls-browser.mjs','test-vikings-gamble-cents.mjs'];
for(const suite of suites) {
  process.stdout.write(`\n[casino profiles] ${suite}\n`);
  const result=spawnSync(process.execPath,['--import','./scripts/fixtures/isolated-casino-env.mjs',`scripts/${suite}`],{cwd:root,stdio:'inherit',env:process.env});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status||1);
}
console.log(`PASS all ${suites.length} isolated casino profile suites`);
