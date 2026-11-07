import 'dotenv/config';
import { localDatabaseDirectory, assertNoDatabaseMaintenance } from './database-location.mjs';

assertNoDatabaseMaintenance();

const databaseDriver = (process.env.DB_DRIVER ?? 'postgres').trim().toLowerCase();
if (!['postgres', 'local'].includes(databaseDriver)) throw new Error('DB_DRIVER must be postgres or local');

const list = (v, fallback) =>
  (v ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  sportsProvider: (process.env.SPORTS_PROVIDER ?? 'zizobet').trim().toLowerCase(),
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseDriver,
  localDatabaseDir: databaseDriver === 'local' ? localDatabaseDirectory(process.env.LOCAL_DATABASE_DIR || 'data/database') : null,

  // the database is only the ledger now (users / tickets / results): the board runs from
  // memory, so a dead database must NOT stop the service. Set DB_INIT_STRICT=true if you
  // would rather fail the deploy when the ledger is unreachable.
  dbInitStrict: (process.env.DB_INIT_STRICT ?? (databaseDriver === 'local' ? 'true' : 'false')) === 'true',

  // where the match list lives: 'memory' (default - survives a database outage) or 'db'
  matchStore: (process.env.MATCH_STORE ?? 'memory').toLowerCase(),

  // ledger + auth (users, tickets, admin panel). Default accounts are created on boot
  // when they are missing - change these or set SEED_DEFAULT_ACCOUNTS=false before going live.
  jwtSecret: process.env.JWT_SECRET ?? 'faqja-dev-secret-change-me',
  jwtTtl: process.env.JWT_TTL ?? '7d',
  seedDefaultAccounts: process.env.SEED_DEFAULT_ACCOUNTS !== 'false',
  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
  demoUser: process.env.DEMO_USER ?? 'demo',
  demoPassword: process.env.DEMO_PASSWORD ?? 'demo',

  // upstream sports API
  gateway: process.env.UPSTREAM_GATEWAY ?? 'https://api-gateway.gw-lucky-bet.com',
  partnerId: process.env.PARTNER_ID ?? 'd3edfa27-7cac-4f77-9e6e-4e2fa2d1ab5f',
  lang: process.env.LANG_CODE ?? 'en-001',

  // collector
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 30000),
  matchPageLimit: Number(process.env.MATCH_PAGE_LIMIT ?? 1000),

  // browser clients
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, '*'),

  // odds storage: 'memory' (default) keeps prices in RAM and pushes them straight to
  // browsers - no odds writes at all; 'db' mirrors them into odds_current/odds_history
  oddsStore: (process.env.ODDS_STORE ?? 'memory').toLowerCase(),

  // odds ingestion
  ingestToken: process.env.INGEST_TOKEN ?? '',

  // A selection can be priced by two providers at the same time (the frames carry both
  // "10:…" and "12:L:…" odds ids for one match). Without this, the two books overwrite each
  // other in the odds store and the board shows whichever frame arrived last - a price that
  // changes and then changes back. Pin the provider that match-info reports for the match.
  oddsProviderPin: (process.env.ODDS_PROVIDER_PIN ?? 'true') !== 'false',

  // The feed frames some groups twice - once with the line ("Total 2.5") and once with none,
  // where the line can only be invented ("#1"). Showing both put one selection on the board
  // twice, with two prices that moved independently. Hide the invented copy.
  oddsHideSyntheticLines: (process.env.ODDS_HIDE_SYNTHETIC_LINES ?? 'true') !== 'false',

  // how long a match may sit past the derived full-time clock before we believe it is over,
  // when the push feed has stopped reporting a clock for it (ms)
  feedEvidenceMs: Number(process.env.FEED_EVIDENCE_MS ?? 900000),

  subscribeFrames: (process.env.ODDS_SUBSCRIBE_FRAMES ?? '')
    .split('||')
    .map((s) => s.trim())
    .filter(Boolean),
  logRawFrames: process.env.LOG_RAW_FRAMES !== 'false',

  /* ------------------------------------------------------- subscription tiers
   * A re-subscribe is what makes the feed resend a match's prices (and its clock/score
   * snapshot), so the cadence is what it costs. Live and near-kickoff fixtures need it often;
   * the rest are still on the board from the 6h the odds store keeps (server/subscribe-plan.mjs).
   */
  prematchSoonMin: Number(process.env.PREMATCH_SOON_MIN ?? 30),
  prematchSoonRefreshMs: Number(process.env.PREMATCH_SOON_MS ?? 5 * 60 * 1000),
  // PREMATCH_REFRESH_MS=0 restores the old behaviour (prematch follows the live cadence)
  prematchRefreshMs: Number(process.env.PREMATCH_REFRESH_MS ?? 60 * 60 * 1000),
  prematchUnpricedRefreshMs: Number(process.env.PREMATCH_UNPRICED_MS ?? 60 * 1000),
  // prematch prices may be this old and still be sold (the hourly tier plus a margin); live
  // keeps its own, much tighter window in ledger/bets.mjs
  prematchStaleMs: Number(process.env.PREMATCH_STALE_MS ?? 90 * 60 * 1000),

  // Retired Railway sleep settings: legacy environment values are ignored.
  idleFeed: false,
  idleAfterMs: 0,
  idleColdBootMs: 0,
  idleStopDbProbe: false,

  // Automatic live risk controls. The provider's original prices remain untouched.
  liveRiskEnabled: (process.env.LIVE_RISK_ENABLED ?? 'true') !== 'false',
  liveRiskLeadMinute: Number(process.env.LIVE_RISK_LEAD_MINUTE ?? 75),
  liveRiskLeadGoals: Number(process.env.LIVE_RISK_LEAD_GOALS ?? 2),
  liveRiskLeadOdds: Number(process.env.LIVE_RISK_LEAD_ODDS ?? 1.50),
  liveRiskLateMinute: Number(process.env.LIVE_RISK_LATE_MINUTE ?? 85),
  liveRiskLateOdds: Number(process.env.LIVE_RISK_LATE_ODDS ?? 1.10),
  liveRiskUltraOdds: Number(process.env.LIVE_RISK_ULTRA_ODDS ?? 1.05),

  // this feed's football sport id (verified)
  footballSportId: Number(process.env.FOOTBALL_SPORT_ID ?? 18),
};

/**
 * pg >= 8.16 treats sslmode=require as verify-full, which fails on the Supabase
 * pooler certificate chain. Strip sslmode and force the relaxed check instead.
 */
export function pgClientOptions(connectionString = config.databaseUrl, max = 5) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? false : { rejectUnauthorized: false },
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  };
}

/**
 * Password-free description of the configured database. Logged at boot and exposed by
 * /health so "which database is this process actually using?" is never a guessing game,
 * and so the IPv6-only direct host is recognisable instead of looking like a DNS outage.
 */
export function dbTarget(connectionString = config.databaseUrl) {
  if (config.databaseDriver === 'local') return { configured: true, driver: 'local', directory: config.localDatabaseDir };
  if (!connectionString) return { configured: false };
  try {
    const url = new URL(connectionString.replace(/^postgres:\/\//, 'postgresql://'));
    return {
      configured: true,
      host: url.hostname,
      port: Number(url.port || 5432),
      database: url.pathname.replace(/^\//, '') || 'postgres',
      user: decodeURIComponent(url.username ?? ''), // never the password
      pooler: /\.pooler\.supabase\.com$/i.test(url.hostname),
      ipv6OnlyDirectHost: /^db\..*\.supabase\.co$/i.test(url.hostname),
    };
  } catch {
    return { configured: true, invalid: true };
  }
}

/** one-line, credential-free rendition of dbTarget() for logs */
export function dbTargetLabel(target = dbTarget()) {
  if (target.driver === 'local') return `local PostgreSQL files: ${target.directory}`;
  if (!target.configured) return 'not set (DATABASE_URL is empty)';
  if (target.invalid) return 'unparseable DATABASE_URL';
  return `${target.user}@${target.host}:${target.port}/${target.database}`;
}

/**
 * pg and Supavisor (the Supabase pooler) report failures as terse strings such as
 * "Failed to connect to database: {:error, :econnrefused}" - which says nothing about
 * the cause. Append what it means and what to check, so the log line is actionable.
 */
export function dbErrorHint(message = '') {
  const m = String(message);
  if (/econnrefused|Failed to connect to database/i.test(m)) {
    return `${m} - DATABASE_URL points at a pooler whose Postgres is not running (paused or deleted Supabase project); use the live project's pooler URL`;
  }
  if (/tenant or user not found/i.test(m)) {
    return `${m} - the pooler does not know this project: expected postgresql://postgres.<project-ref>:PASSWORD@aws-<n>-<region>.pooler.supabase.com:5432/postgres`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) {
    return `${m} - the host did not resolve: db.<ref>.supabase.co is IPv6-only, use the pooler host`;
  }
  if (/password authentication failed/i.test(m)) {
    return `${m} - the password in DATABASE_URL is wrong`;
  }
  return m;
}
