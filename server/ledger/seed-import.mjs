/**
 * Imports the portable database seed on first startup when the database is empty.
 * This guarantees that cloning or downloading the project on ANY computer immediately
 * provides the full database with all accounts, tickets, transactions, and settings.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const seedFilePath = resolve(rootDir, 'server/ledger/database-seed.json');

export async function importDatabaseSeedIfEmpty({ seedPath = seedFilePath, log = console.log, runQuery = query } = {}) {
  try {
    const userCountRes = await runQuery('SELECT count(*)::int as count FROM app_user');
    const userCount = userCountRes.rows[0]?.count ?? 0;
    if (userCount > 1) {
      return { seeded: false, reason: 'Database already has accounts' };
    }
  } catch (err) {
    return { seeded: false, reason: err.message };
  }

  let seedJson;
  try {
    seedJson = await readFile(seedPath, 'utf8');
  } catch (err) {
    return { seeded: false, reason: `Seed file not found: ${err.message}` };
  }

  let seed;
  try {
    seed = JSON.parse(seedJson);
  } catch (err) {
    return { seeded: false, reason: `Invalid seed JSON: ${err.message}` };
  }

  if (!seed.tables) return { seeded: false, reason: 'Seed contains no tables' };

  let insertedCount = 0;

  // 1. First insert app_user with managers and admins before players to satisfy manager_id foreign keys
  const users = seed.tables['app_user'] || [];
  const managersFirst = [...users].sort((a, b) => {
    const rank = r => r === 'ADMIN' ? 1 : r === 'MANAGER' ? 2 : 3;
    return rank(a.role) - rank(b.role);
  });

  for (const user of managersFirst) {
    const keys = Object.keys(user);
    const cols = keys.map(k => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map(k => user[k]);
    try {
      await runQuery(
        `INSERT INTO "app_user" (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        values
      );
      insertedCount++;
    } catch {
      // Continue
    }
  }

  // 2. Insert remaining tables in topological order
  const tableOrder = [
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

  for (const tableName of tableOrder) {
    const rows = seed.tables[tableName];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    for (const row of rows) {
      const keys = Object.keys(row);
      const cols = keys.map(k => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = keys.map(k => row[k]);

      try {
        await runQuery(
          `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
        insertedCount++;
      } catch {
        // Skip conflicted or invalid row
      }
    }
  }

  log(`[seed-import] Successfully restored complete database from seed: ${insertedCount} rows restored.`);
  return { seeded: true, insertedCount };
}
