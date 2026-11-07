/**
 * Exports the application database seed (users, settings, transactions, tickets, casino state)
 * into a portable JSON seed file for deployment and repository synchronization.
 */
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../server/db.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedFilePath = resolve(rootDir, 'server/ledger/database-seed.json');

export const SEED_TABLES = [
  'app_user',
  'app_commission_config',
  'app_board_settings',
  'app_casino_settings',
  'app_market_category_policy',
  'app_manager_commission',
  'app_transaction',
  'app_ticket_batch',
  'app_ticket',
  'app_ticket_line',
  'app_casino_original_state',
  'app_casino_round',
  'app_casino_original_event',
  'app_match_result',
];

export async function exportDatabaseSeed({ targetPath = seedFilePath, log = console.log } = {}) {
  const seed = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of SEED_TABLES) {
    try {
      const res = await query(`SELECT * FROM ${table}`);
      seed.tables[table] = res.rows;
      log(`[seed-export] ${table}: ${res.rows.length} rows`);
    } catch (err) {
      log(`[seed-export] skipped ${table}: ${err.message}`);
    }
  }

  const json = JSON.stringify(seed, null, 2);
  await writeFile(targetPath, json, 'utf8');
  log(`[seed-export] Complete database seed written to ${targetPath} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);
  return seed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await exportDatabaseSeed();
  process.exit(0);
}
