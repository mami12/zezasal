import {statsProviders} from './stats-providers/index.mjs';
import {footballInformation,FOOTBALL_INFORMATION_SQL} from './stats-providers/football-information.mjs';
import {inheritEventPlayers} from './live-event-timeline.mjs';
import {toClientMatches} from './ledger/view.mjs';
import {persistProviderMarketDefinitions} from './ledger/provider-offer-archive.mjs';
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketServer } from 'socket.io';
import { staticCacheHeaders } from './static-cache.mjs';
import { config, dbTarget, dbTargetLabel, dbErrorHint } from './config.mjs';
import { initSchema, dbHealth, getOddsHistory, getOddsForMatches as getDbOddsForMatches, recentRawFrames, closePool, logRawFrame, query } from './db.mjs';
import { initLedgerSchema } from './ledger/store.mjs';
import { importDatabaseSeedIfEmpty } from './ledger/seed-import.mjs';
import { purgeDeletedPlayerHistory } from './ledger/user-removal.mjs';
import * as overrides from './ledger/overrides.mjs';
import { ensureDefaultAccounts } from './ledger/auth.mjs';
import { ledgerRouter } from './ledger/routes.mjs';
import { adminRouter } from './ledger/admin.mjs';
import {financialMonitoringRouter} from './ledger/financial-monitoring.mjs';
import { directoryRouter } from './ledger/directory.mjs';
import {pruneUnbetMatchEvidence} from './ledger/event-evidence.mjs';
import {matchSnapshots} from './ledger/match-snapshots.mjs';
import {mergeTeamStats} from './match-statistics.mjs';
import {pool as financialDatabase} from './db.mjs';
import {withDatabaseRequest} from './database-request-context.mjs';
import {createFinancialResetRouter} from './ledger/financial-reset.mjs';
import { settleAll, voidUnresolved } from './ledger/settler.mjs';
import { isFinished, archiveFinishedMatch } from './ledger/results.mjs';
import { createPendingResultTracker } from './pending-results.mjs';
import {
  getMatches, getMatchById, getLeagues, getCounts, applyMatchInfo, knownMatchIds,
  getSubscriptionIds, getFeedFreshness, matchStats, boostMatch, upsertMatches, expireStaleMatches,
} from './matches.mjs';
import {normalizeOddsPayload,applyOddsRows,groupByMatch,providerOfferArchiveHealth} from './odds.mjs';
import * as oddsStore from './odds-store.mjs';
import { decodePushBatch } from './push-decode.mjs';
import { startPusher } from './pusher.mjs';
import {startYbetsFeed} from './ybets-feed.mjs';
import {startZizoFeed,isZizoId} from './zizobet-feed.mjs';
import {startLegacyYbetsResults} from './legacy-ybets-results.mjs';
import {isYbetsMatchId} from './ybets-normalize.mjs';
import { startCollector, withOdds, buildMarkets, toDbOddsShape, statsFromRow } from './collector.mjs';
import { liveClock } from './minute.mjs';
import { liveRiskReason, riskMinute } from './live-risk.mjs';
import { liveRiskSettings, subscribeLiveRiskSettings } from './live-risk-settings.mjs';
import { freshFeed, freshSocketHeaders, liveBoardFacts } from './feed-sync.mjs';
import { refreshLiveRiskSettings } from './ledger/live-risk-store.mjs';
import { createIdleMonitor, getFeedMode, feedIsStopped } from './idle-mode.mjs';
import {quoteValidUntil} from './ledger/quote-validity.mjs';
import {projectOddsDelta} from './ledger/odds-delta.mjs';
import {refreshMarketCatalog,onMarketPolicy} from './ledger/market-catalog-store.mjs';
import {emitScopedOdds,setSocketScope,detailProjection,offeredMarket} from './market-delivery.mjs';
import {isBoardOddsRow,projectClientBoardMatches} from './ledger/board-projection.mjs';
import {catalogRows,categoryPolicies,scopeBlockRows} from './market-catalog.mjs';
import {refreshBoardSettings} from './ledger/board-settings-store.mjs';
import {subscribeBoardSettings,selectPublishedMatches,filterBoardSubscriptionPlan} from './board-settings.mjs';
import { createVikingsRouter } from './casino/vikings-ct-router.mjs';
import { createAgtRouter } from './casino/agt-router.mjs';
import { createCtProtocolRouter } from './casino/clover-ct-router.mjs';
import { fireJokerConfig, mapFireJokerRound } from './casino/firejoker-protocol.mjs';
import { initialFireJokerGrid, spinFireJokerRound } from './casino/firejoker-engine.mjs';
import {createOriginalWalletRouter,originalFrameShellRouter} from './casino/original-wallet.mjs';
import { createFireJokerLauncherRouter } from './casino/firejoker-launcher.mjs';
import { casinoWalletRouter } from './casino/wallet.mjs';
import { casinoFinanceRouter } from './casino/finance.mjs';
import {createSizzlingDemoRouter} from './casino/sizzling-demo.mjs';
import {createSizzlingRealRouter, casinoSessionRouter} from './casino/sizzling-real.mjs';
import {createBookOfRaDemoRouter, createBookOfRaRealRouter, casinoBookOfRaSessionRouter} from './casino/bookofra.mjs';
import { installGracefulShutdown } from './lifecycle.mjs';

const app = express();
app.use((_req,_res,next)=>withDatabaseRequest(financialDatabase,financialDatabase.generation,next));
const corsOrigin = config.allowedOrigins.includes('*') ? true : config.allowedOrigins;

let collector = null;
let legacyYbetsResults=null;
let pusher = null;
app.locals.loadMatchDetail=async id=>{boostMatch(Number(id));if(['ybets','zizobet'].includes(config.sportsProvider)){await collector?.focus(Number(id)).catch(()=>{});await flushFeedBuffer();}else pusher?.subscribeFull(Number(id));};
let oddsStatus = { connected: false };
let shuttingDown = false;
// One ordered feed stream per process. Client detects missed broadcasts and
// reconciles from the authoritative REST snapshot after reconnect.
const feedStreamId=randomUUID();
let liveBoardSequence=0,matchInfoSequence=0;
let riskRefreshTimer = null;
let socketTasks = 0;
const backgroundTasks = new Set();
function trackBackground(task) {
  const pending = Promise.resolve(task);
  backgroundTasks.add(pending);
  void pending.finally(() => backgroundTasks.delete(pending)).catch(() => {});
  return pending;
}

// prices for one selection can arrive from two books at once ("10:…" and "12:L:…"): keep one
// of them per selection so the board cannot show a price that changes and then changes back
oddsStore.configure({ pinProvider: config.oddsProviderPin });

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false, limit: '4mb' }));
app.use(['/api', '/app/api'], freshFeed);

const requireToken = (req, res, next) => {
  if (!config.ingestToken) return next();
  const token = req.get('x-ingest-token') ?? req.query.token;
  if (token !== config.ingestToken) return res.status(401).json({ error: 'invalid token' });
  return next();
};

const asInt = (v, def, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(1, Math.trunc(n)), max);
};

app.get('/api/info', (_req, res) => res.json({ name: 'faqja-football-board', ok: true }));

/* --- database status is probed in the background: a dead database must never
   hang /health (Railway healthcheck) or stop the odds board ------------------ */
let dbStatus = { ok: false, error: 'probing' };
let feedStatus = null;
let dbProbe = { at: null, ms: null };
let probing = false;

async function probeDb() {
  if (shuttingDown || probing) return; // a slow/dead database must not pile up probes
  probing = true;
  const started = Date.now();
  try {
    dbStatus = await dbHealth();
  } catch (e) {
    dbStatus = { ok: false, error: dbErrorHint(e.message) };
  }
  try {
    feedStatus = await getFeedFreshness();
  } catch (e) {
    feedStatus = { error: dbErrorHint(e.message) };
  } finally {
    probing = false;
    dbProbe = { at: new Date().toISOString(), ms: Date.now() - started };
  }

  // the ledger schema is created/retried whenever the database actually answers
  if (dbStatus.ok && !ledgerReady) await ensureLedgerSchema();
}

/** the ledger tables (users/tickets/results) are created on boot and retried until the database answers */
let ledgerReady = false;
let settleTimer = null;
let supplementalTimer = null;
let pendingLiveMonitor = null;
let settlementBusy = false;
let lastUnresolvedCheck = 0;
// De-duplicate repeated full-time frames after durable result persistence.
const archivedTerminalMatches = new Set();
const pendingResults = createPendingResultTracker({query,archive:archiveFinishedMatch,isFinished,saveSnapshot:row=>matchSnapshots.save(row),loadSnapshots:ids=>matchSnapshots.load(ids),onArchived:()=>void runSettlement('pending provider final score')});
async function ensureLedgerSchema() {
  if (shuttingDown) return false;
  if (ledgerReady) return true;
  try {
    await initSchema();
    await initLedgerSchema(); // users / transactions / tickets (additive, create-only)
    // Supplementary AiScore mappings are optional, never wallet-critical.
    try{await query(FOOTBALL_INFORMATION_SQL);}catch(error){console.warn('[aiscore] optional schema unavailable:',error.message);}
    await refreshLiveRiskSettings({ initialize: true });
    await refreshBoardSettings();
    await refreshMarketCatalog({initialize:true});
    await importDatabaseSeedIfEmpty();
    await ensureDefaultAccounts();
    // admin overrides live in the database and are read through a snapshot: warm it now so a
    // restart does not silently drop a suspension or a pinned price until someone edits again
    await overrides.refresh(true);
    ledgerReady = true;
    console.log('[db] ledger schema ready');
    armSettlement(); // Also starts after a late DB recovery, not just at boot.
    armSupplementalInformation();
  } catch (e) {
    console.error('[db] ledger schema not ready yet:', dbErrorHint(e.message));
    if (config.dbInitStrict) {
      console.error('[db] DB_INIT_STRICT on: exiting instead of running without the ledger schema');
      process.exit(1);
    }
  }
  return ledgerReady;
}

/** the probe is pure database traffic - idle mode stops it so nothing goes out on the wire */
let probeTimer = null;
function armProbe() {
  if (shuttingDown || probeTimer) return false;
  trackBackground(probeDb());
  probeTimer = setInterval(() => trackBackground(probeDb()), 15000);
  probeTimer.unref?.();
  return true;
}
function stopProbe() {
  clearInterval(probeTimer);
  probeTimer = null;
  return true;
}

armProbe();

/* --------------------------------------------------------- feed idle state
 * App visitors keep the live provider feed and background settlement active.
 * -------------------------------------------------------------------------- */

const feedState = () => ({
  ...idle.state(),
  at: new Date().toISOString(),
  oddsRows: oddsStore.stats().rows,
});

function broadcastFeedState() {
  try {
    io?.emit('feed:state', feedState());
  } catch {
    /* ignore: no clients */
  }
}

/**
 * Settlement pass: store the results of matches that have finished, then close every ticket
 * whose lines are all decided. Retries and payment recovery remain idempotent.
 */
let lastDeletedHistoryCleanup = 0;
let lastUnbetEvidenceCleanup = 0;
const settlementHealth = {lastAttemptAt:null,lastSuccessAt:null,lastError:null,lastResult:null};
async function runSettlement(why = 'periodic') {
  if (shuttingDown || !ledgerReady || settlementBusy) return null;
  settlementBusy = true;
  settlementHealth.lastAttemptAt = new Date().toISOString();
  try {
    trackBackground(statsProviders.tick().catch(()=>{}));
    // Optional read-only football enrichment: only mapped primary matches
    // with pending bets and available upstream market names are eligible.
    trackBackground(footballInformation.tick().catch(error=>console.warn('[football information] tick:',error.message)));
    const out = await settleAll();
    settlementHealth.lastSuccessAt = new Date().toISOString();
    settlementHealth.lastError = null;
    settlementHealth.lastResult = out;
    if (out.closed || why !== 'periodic') {
      console.log(
        `[settle] (${why}) captured=${out.captured} matches=${out.matches} lines=${out.lines} tickets=${out.closed}`,
      );
    }
    return out;
  } catch (e) {
    settlementHealth.lastError = 'SETTLEMENT_FAILED';
    console.error('[settle] pass failed:', e.message);
    return null;
  } finally {
    // Even when finished-result capture fails (bad feed row / DB hiccup),
    // old unresolvable tickets must still reach the separate 72h review.
    if (why !== 'periodic' || Date.now() - lastUnresolvedCheck >= 15 * 60 * 1000) {
      lastUnresolvedCheck = Date.now();
      try {
        const unresolved = await voidUnresolved(72);
        if (unresolved.voided) console.log('[settle] unresolved lines voided:', unresolved.voided);
      } catch (error) {
        console.error('[settle] unresolved review failed:', error.message);
      }
    }
    if (Date.now() - lastDeletedHistoryCleanup >= 5 * 60 * 1000) {
      lastDeletedHistoryCleanup = Date.now();
      try {
        const cleaned = await purgeDeletedPlayerHistory();
        if (cleaned.purged) console.log('[ledger] removed-player history cleanup:', cleaned.purged, 'cutoff:', cleaned.cutoff);
      } catch (error) { console.error('[ledger] removed-player history cleanup failed:', error.message); }
    }
    if (Date.now() - lastUnbetEvidenceCleanup >= 60 * 60 * 1000) {
      lastUnbetEvidenceCleanup = Date.now();
      try { await pruneUnbetMatchEvidence(); }
      catch(error) { console.error('[ledger] temporary match evidence cleanup failed:',error.message); }
    }
    try { await pendingResults.refresh(); }
    catch(error) { console.error('[settle] pending result subscriptions could not refresh:',error.message); }
    settlementBusy = false;
  }
}

/** Independent information loop: unlike settlement, it tracks uncovered
 * LIVE and imminent PREMATCH fixtures with a bounded quota-aware cadence.
 * All source data is informational; it never overwrites Zizobet prices.
 */
function armSupplementalInformation(){
 if(shuttingDown||supplementalTimer)return;
 const interval=Math.max(10000,Number(process.env.STATS_TICK_MS)||15000);
 supplementalTimer=setInterval(()=>{
  if(shuttingDown||!ledgerReady||feedIsStopped())return;
  trackBackground(statsProviders.tick().catch(error=>console.warn('[stats] refresh:',error.message)));
  trackBackground(footballInformation.tick().catch(error=>console.warn('[aiscore] refresh:',error.message)));
 },interval);
 supplementalTimer.unref?.();
}
/** Start once after ledger creation OR database recovery. */
function armSettlement() {
  if (shuttingDown || !ledgerReady || settleTimer) return;
  void runSettlement('ledger ready');
  const delay = Math.max(10000, Number(process.env.SETTLE_INTERVAL_MS) || 30000);
  settleTimer = setInterval(() => void runSettlement('periodic'), delay);
  settleTimer.unref?.();
}

// An all-match archive must continue polling when no browser is connected.
// Operator can opt out with ZIZO_HISTORY_ALWAYS_ON=false; that restores idle mode.
const archiveAlwaysOn=config.sportsProvider==='zizobet'&&process.env.ZIZO_HISTORY_ALWAYS_ON!=='false';
const idle = createIdleMonitor({
  enabled: process.env.FEED_IDLE_ENABLED !== 'false'&&!archiveAlwaysOn,
  idleAfterMs: Number(process.env.FEED_IDLE_AFTER_MS ?? 60_000),
  coldBootIdleMs: Number(process.env.FEED_IDLE_COLD_BOOT_MS ?? 60_000),
  onIdle: () => {
    collector?.pause?.();
    pusher?.pause?.();
    legacyYbetsResults?.pause?.();
    stopProbe();
    clearInterval(settleTimer);
    settleTimer = null;
    broadcastFeedState();
  },
  onWake: () => {
    armProbe();
    armSettlement();
    collector?.resume?.();
    pusher?.resume?.();
    legacyYbetsResults?.resume?.();
    broadcastFeedState();
  },
  onMode: () => broadcastFeedState(),
});

/** Accepted event wagers require a live feed even when no browser is open.
 * This is one LOCAL DB check every 15 seconds, not an extra provider request.
 */
async function keepFeedForPendingLiveBets(){
 if(shuttingDown||!ledgerReady)return false;
 try{
  const {rows}=await query(`select exists(
    select 1 from app_ticket_line l
    join app_ticket t on t.id=l.ticket_id
    left join app_match_result r on r.match_id=l.match_id
    where l.status='PENDING' and t.status='PENDING'
      and l.live_contract is not null and r.match_id is null
  ) as active`);
  if(rows[0]?.active===true){idle.touch();return true;}
 }catch(error){console.warn('[live contracts] pending wager check:',error.message);}
 return false;
}

/**
 * What counts as a visitor: a board socket (see io.on('connection')) or a call to the app's
 * API. /health and the static bundle are deliberately NOT: an uptime monitor or a crawler
 * pinging them must not keep the feed - and the invoice - running.
 */
const ACTIVITY_RE = /^\/(app\/api|api\/(matches|meta|leagues|odds|raw-frames|info)|ingest)\b/;
app.use((req, _res, next) => {
  if (ACTIVITY_RE.test(req.path)) idle.touch();
  next();
});

app.get('/health', (_req, res) => {
  // 200 even when the database is down: prices come from memory, so a database outage
  // must not restart-loop the service. db.ok / feed.error carry the detail.
  res.json({
    ok: true,
    db: dbStatus,
    dbProbe,
    target: dbTarget(),
    feed: feedStatus,
    matches: matchStats(),
    ledger: { ready: ledgerReady },
    odds: { ...oddsStore.stats(), mode: config.oddsStore },
    providerOfferArchive: providerOfferArchiveHealth(),
    providers: oddsStore.providerReport(10),
    collector: collector?.state ?? null,
    oddsSocket: oddsStatus,
    pusher: pusher?.stats() ?? null,
    statsProviders: statsProviders.health(),
    settlementWatch: pendingResults.stats(),
    settlement: {...settlementHealth,running:settlementBusy},
    // idle mode: 'live' | 'idle' | 'waking' plus the visitor counters, and what the tiers cost
    feedMode: getFeedMode(),
    idle: {
      ...idle.state(),
      // the database probe is outbound traffic too: whether it is currently stopped is what
      // decides if the instance is really free to sleep
      stopDbProbeOnIdle: idle.state().enabled,
      dbProbeStopped: probeTimer === null,
    },
    tiers: {
      soonMin: config.prematchSoonMin,
      soonMs: config.prematchSoonRefreshMs,
      laterMs: config.prematchRefreshMs,
      unpricedMs: config.prematchUnpricedRefreshMs,
      enabled: config.prematchRefreshMs > 0,
    },
    sportsProvider: config.sportsProvider,
    upstream: config.sportsProvider==='zizobet'?'https://zizobet.com':config.sportsProvider==='ybets'?'https://sportsbook.ybets.net':config.gateway,
    at: new Date().toISOString(),
  });
});

app.get('/api/meta', async (_req, res, next) => {
  try {
    const counts = await getCounts();
    res.json({ ...counts, collector: collector?.state ?? null, oddsSocket: oddsStatus });
  } catch (e) {
    next(e);
  }
});

app.get('/api/leagues', async (_req, res, next) => {
  try {
    res.json({ items: await getLeagues() });
  } catch (e) {
    next(e);
  }
});

app.get('/api/matches', async (req, res, next) => {
  try {
    const service = req.query.service && req.query.service !== 'all' ? String(req.query.service) : null;
    const rows = await getMatches({
      service,
      league: req.query.league ? String(req.query.league) : null,
      q: req.query.q ? String(req.query.q) : null,
      limit: asInt(req.query.limit, 500, 2000),
      offset: asInt(req.query.offset, 0, 100000),
    });
    // List endpoints are always lightweight. Only /api/matches/:id requests
    // a full selected fixture; do not serialize old cached extra markets here.
    const items = req.query.odds === '0' ? rows.map((r) => r) : await withOdds(rows,Date.now(),{board:true});
    const counts = await getCounts();
    res.json({ counts, items });
  } catch (e) {
    next(e);
  }
});

app.get('/api/matches/:id', async (req, res, next) => {
  try {
    const row = await getMatchById(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'match not found' });
    boostMatch(row.match_id); // opened matches always get their full market list
    if (['ybets','zizobet'].includes(config.sportsProvider) && (isYbetsMatchId(row.match_id)||isZizoId(row.match_id))) {await collector?.focus(row.match_id).catch(()=>{});await flushFeedBuffer();}
    else pusher?.subscribeFull(row.match_id);
    const [match] = await withOdds([row],Date.now(),{displayStats:true});
    res.json(match);
  } catch (e) {
    return next(e);
  }
});

app.get('/api/odds/:matchId/history', async (req, res, next) => {
  try {
    const matchId = Number(req.params.matchId);
    const limit = asInt(req.query.limit, 200, 1000);
    // prices live in memory by default, so the history covers this process lifetime only
    const items =
      config.oddsStore === 'db' ? await getOddsHistory(matchId, limit) : oddsStore.getHistory(matchId, limit);
    res.json({ items, store: config.oddsStore });
  } catch (e) {
    next(e);
  }
});

/* The provider's locks and our reversible risk locks travel separately.
 * Recompute against server prices whenever a score/clock or odds frame changes. */
const publishedRiskLocks = new Map();

async function broadcastLiveRiskLocks(matchId, matchRow) {
  if (!io || !matchRow) return;
  const id = String(matchId);
  const previous = publishedRiskLocks.get(id) ?? new Set();
  const next = new Set();
  const minute = riskMinute(matchRow);
  const policy = liveRiskSettings();
  const firstRuleMinute = Math.min(
    ...policy.leaderRules.map(rule => rule.minute),
    ...policy.lowOddsRules.map(rule => rule.minute),
    ...(policy.marketClosureRules ?? []).map(rule => rule.minute),
  );
  if (config.liveRiskEnabled && policy.enabled &&
      String(matchRow.service).toUpperCase() === 'LIVE' &&
      minute !== null && minute >= firstRuleMinute) {
    const odds = config.oddsStore === 'db'
      ? await getDbOddsForMatches([Number(matchId)])
      : oddsStore.getOddsForMatches([Number(matchId)]);
    for (const item of odds) {
      const forced = overrides.outcomeOverride(matchId, item.market_key, item.line, item.outcome_key);
      const price = forced?.price ?? item.price;
      if (liveRiskReason(matchRow, {
        marketName: item.market_name,
        marketKey: item.market_key,
        outcomeName: item.outcome_name,
        outcomeKey: item.outcome_key,
        price,
      })) {
        next.add(id + '|' + item.market_key + '|' + (item.line ?? '') + '|' + item.outcome_key);
      }
    }
  }

  const locks = {};
  for (const key of previous) if (!next.has(key)) locks[key] = false;
  for (const key of next) if (!previous.has(key)) locks[key] = true;
  if (next.size) publishedRiskLocks.set(id, next);
  else publishedRiskLocks.delete(id);
  if (Object.keys(locks).length) io.emit('risk:locks', { matchId: id, at: new Date().toISOString(), locks });
}

// Admin edits (and changes made on another instance) immediately re-evaluate
// already visible odds, including reversibly unlocking old risk-only locks.
subscribeLiveRiskSettings(() => {
  if (io) io.emit('combos:settings', {enabled:liveRiskSettings().combosEnabled !== false});
  void (async () => {
    if (!io) return;
    const rows = await getMatches({ service: 'LIVE', limit: 2000 });
    for (const row of rows) await broadcastLiveRiskLocks(row.match_id ?? row.id, row);
  })().catch(e => console.error('[live risk] lock refresh failed:',e.message));
});
subscribeBoardSettings(()=>io?.emit('board:settings',{at:new Date().toISOString()}));

/* ------------------------------------------------------------ odds ingestion */

const publishedBoardKeys=new Map();
async function broadcastOdds(changed) {
  if (!io || !changed.length) return;
  const byMatch = groupByMatch(changed);
  for (const [matchId, list] of byMatch) {
    // If the feed reports no open odds for this match, skip broadcasting — the board
    // already hides it via serializeMatch, and pushing placeholder prices (41.00 / 1.29)
    // would only confuse the frontend.
    const row = await getMatchById(Number(matchId));
    if (!row || row.has_open_odds === false) continue;
    // Include live minute so the frontend can advance the clock even when
    // match-info-snapshot frames are rare
    const now = Date.now();
    const clock = row.service === 'LIVE' ? liveClock(row.start_at, now) : { minute: null, phase: 'pre' };
    const feedMinute = Number.isFinite(row.match_time_ms)
      ? Math.floor(Number(row.match_time_ms) / 60000) +
        (row.clock_at ? Math.max(0, Math.floor((now - new Date(row.clock_at).getTime()) / 60000)) : 0)
      : null;
    const minute = feedMinute ?? clock.minute;
    const payload={
      matchId,
      at: new Date().toISOString(),
      minute: Number.isFinite(minute) ? minute : undefined,
      clockAt: row.clock_at ? new Date(row.clock_at).toISOString() : undefined,
      phaseAt: row.feed_status_at ? new Date(row.feed_status_at).toISOString() : undefined,
      phase: row.phase ?? clock.phase ?? null,
      markets: projectOddsDelta(row,buildMarkets(toDbOddsShape(list.filter(o=>offeredMarket({market_name:o.marketName,market_key:o.marketKey},row))),{includeRemoved:true}),{matchOverride:overrides.matchOverride,marketOverride:overrides.marketOverride,outcomeOverride:overrides.outcomeOverride,prematchMaxAgeMs:config.prematchStaleMs,now}),
    };
    let boardKeys=new Set();
    const boardConsidered=io.sockets.adapter.rooms.get('feed:board:'+matchId)?.size&&list.some(o=>isBoardOddsRow({market_name:o.marketName,period:o.period}));if(boardConsidered){const [full]=await withOdds([row],Date.now(),{board:true});const [board]=projectClientBoardMatches(toClientMatches([full]));boardKeys=new Set((board.markets??[]).map(m=>m.extId+'|'+(m.line??'')));}
    const before=publishedBoardKeys.get(String(matchId));if(boardConsidered){payload.boardChanged=!!before&&[...new Set([...before,...boardKeys])].some(key=>before.has(key)!==boardKeys.has(key));publishedBoardKeys.set(String(matchId),boardKeys);if(before)boardKeys=new Set([...boardKeys,...before]);}
    emitScopedOdds(io,payload,boardKeys);
    await broadcastLiveRiskLocks(matchId, row);
  }
}

/** applies a decoded match-info (score / clock / stats) and broadcasts it */
async function applyInfoFromFeed(info) {
  // match-info names the book the site itself sells this match from: prefer its prices over
  // whatever priced the selection first, so our odds match the source site's
  if (info.providerId !== null && info.providerId !== undefined && Number.isFinite(Number(info.providerId))) {
    oddsStore.setProvider(info.matchId, info.providerId);
  }

  // if scoreBoard carried per-team goals, keep them as the match score even
  // when later frames only report corners/cards
  let enriched = info;
  if (info.stats && info.homeScore === null) {
    const row = await getMatchById(info.matchId);
    const hId = row?.raw?.homeTeam?.id != null ? String(row.raw.homeTeam.id) : null;
    const aId = row?.raw?.awayTeam?.id != null ? String(row.raw.awayTeam.id) : null;
    const goalsOf = (s) => {
      if (!s) return null;
      const hit = Object.entries(s).find(([k]) => k.startsWith('goals:'));
      return hit ? hit[1] : null;
    };
    const hg = hId ? goalsOf(info.stats[hId]) : null;
    const ag = aId ? goalsOf(info.stats[aId]) : null;
    if (hg !== null && ag !== null) enriched = { ...info, homeScore: hg, awayScore: ag };
  }

  const updated = await applyMatchInfo(enriched);
  if(ledgerReady&&updated){try{await matchSnapshots.save(updated);}catch(error){console.error('[settle] provider snapshot persistence failed:',info.matchId,error.message);}}
  if (ledgerReady) {
    try { await pendingResults.observe(enriched, updated); }
    catch(error) { console.error('[settle] pending final snapshot could not be saved:',info.matchId,error.message); }
  }
  if (updated) {
    // Save a *feed-confirmed* FT result at the moment it arrives. Without this
    // write, the next deploy/idle expiry can erase the only stored score and
    // leave ticket lines PENDING indefinitely.
    if (ledgerReady && !archivedTerminalMatches.has(String(updated.match_id)) && isFinished(updated)) {
      try {
        await archiveFinishedMatch(updated);
        archivedTerminalMatches.add(String(updated.match_id));
        void runSettlement('provider final score');
      } catch (e) {
        // A later FT frame or the 30s periodic pass will retry.
        console.error('[settle] failed to preserve provider FT match', updated.match_id, e.message);
      }
    }
    io?.emit('match:info', { ...enriched, ...updated, at: new Date().toISOString(), stats: statsFromRow(updated),syncStream:feedStreamId,syncSequence:++matchInfoSequence });
    await broadcastLiveRiskLocks(info.matchId, updated);
  }
  return updated;
}

/**
 * The feed sends the clock and the score only in `match-info-snapshot` frames; the
 * periodic `match-info` deltas that follow carry neither. Coalescing a burst by
 * replacing the whole object therefore threw the snapshot away, which is what froze
 * scores and minutes for ~60% of live matches. Merge field by field instead, so a
 * stats-only delta can never erase a clock or a score.
 */
function mergeInfo(prev, next) {
  if (!prev) return next;
  if (!next) return prev;
  return {
    ...next,
    matchTimeMs: Number.isFinite(next.matchTimeMs) ? next.matchTimeMs : prev.matchTimeMs,
    homeScore: Number.isFinite(next.homeScore) ? next.homeScore : prev.homeScore,
    awayScore: Number.isFinite(next.awayScore) ? next.awayScore : prev.awayScore,
    periodsScore: next.periodsScore?.length ? next.periodsScore : prev.periodsScore,
    events: Array.isArray(next.events)?inheritEventPlayers(next.events,prev.events):prev.events,
    stats: next.stats ? mergeTeamStats(prev.stats,next.stats) : prev.stats,
    feedStatus: next.feedStatus ?? prev.feedStatus,
    hasOpenOdds: next.hasOpenOdds ?? prev.hasOpenOdds,
    broadcastUrl: next.broadcastUrl ?? prev.broadcastUrl,
    enabledOddsCount: next.enabledOddsCount ?? prev.enabledOddsCount,
  };
}

/* ---- coalescer for the server-side subscription (frames arrive in bursts) ---- */
const oddsBuffer = [];
const infoBuffer = new Map();
let flushing = false;

async function flushFeedBuffer() {
  if (shuttingDown || flushing || (!oddsBuffer.length && !infoBuffer.size)) return;
  flushing = true;
  try {
    if (oddsBuffer.length) {
      const rows = oddsBuffer.splice(0, oddsBuffer.length);
      broadcastOdds(await applyOddsRows(rows)).catch((e) => console.warn('[feed] broadcast error:', e.message));
    }
    if (infoBuffer.size) {
      const infos = [...infoBuffer.values()];
      infoBuffer.clear();
      for (const info of infos) await applyInfoFromFeed(info);
    }
  } catch (e) {
    console.error('[feed] flush failed:', e.message);
  } finally {
    flushing = false;
  }
}
const feedFlushTimer = setInterval(() => trackBackground(flushFeedBuffer()), 1000);

app.post('/ingest/odds', requireToken, async (req, res, next) => {
  try {
    const rows = normalizeOddsPayload(req.body, {
      matchId: req.query.matchId ? Number(req.query.matchId) : undefined,
      marketKey: req.query.marketKey ? String(req.query.marketKey) : undefined,
    });
    if (!rows.length) {
      return res.status(422).json({
        error: 'no usable odds in payload',
        hint: 'see README -> "Odds ingest format"',
      });
    }
    const changed = await applyOddsRows(rows);
    broadcastOdds(changed).catch((e) => console.warn('[odds] broadcast error:', e.message));
    return res.json({
      accepted: rows.length,
      changed: changed.length,
      matches: [...new Set(rows.map((r) => r.matchId))],
    });
  } catch (e) {
    return next(e);
  }
});

app.get('/api/raw-frames', requireToken, async (req, res, next) => {
  try {
    res.json({ items: await recentRawFrames(asInt(req.query.limit, 20, 200)) });
  } catch (e) {
    next(e);
  }
});

/**
 * Native frames from the platform's push channel (push-server-v2), forwarded by
 * the browser relay (docs/frames-relay.user.js) or pasted by hand.
 *
 * Accepts: { text: '42["u",{...},"id"]' } | { frames: ['42[...]', ...] }
 *          | { payload: {...} } | { messages: [{messageType,data}, ...] }
 */
app.post('/ingest/frames', requireToken, async (req, res, next) => {
  try {
    const body = req.body ?? {};

    // outgoing (client -> server) frames are only archived: they reveal the
    // subscribe protocol needed for the server-side socket path.
    if (req.query.direction === 'out') {
      const list = body.frames ?? (body.text ? [body.text] : []);
      for (const f of list.slice(0, 50)) await logRawFrame('client-out', { text: String(f).slice(0, 2000) });
      return res.json({ stored: Math.min(list.length, 50) });
    }

    const input = body.frames ?? body.messages ?? (body.text ? [body.text] : (body.payload ?? body));

    const { infos, odds, unknown, frames } = decodePushBatch(input);

    // only keep odds for matches this board actually tracks (football), unless ?storeUnknown=1
    const trackOnly = req.query.storeUnknown !== '1';
    const known = trackOnly
      ? await knownMatchIds([...new Set(odds.map((o) => o.matchId).filter(Number.isFinite))])
      : null;
    let skippedUnknown = 0;

    let oddsRows = 0;
    const changed = [];
    for (const decoded of odds) {
      if (trackOnly && !known.has(decoded.matchId)) {
        skippedUnknown += decoded.rows.length;
        continue;
      }
      const rows = decoded.rows;
      oddsRows += rows.length;
      changed.push(...(await applyOddsRows(rows)));
    }
    if (changed.length) broadcastOdds(changed).catch((e) => console.warn('[frames] broadcast error:', e.message));

    let matchInfoApplied = 0;
    for (const info of infos) {
      if (await applyInfoFromFeed(info)) matchInfoApplied++;
    }

    if (unknown.length) {
      for (const u of unknown.slice(0, 20)) await logRawFrame('ingest-frames', u);
    }

    return res.json({
      frames: frames || 1,
      matchInfo: infos.length,
      matchInfoApplied,
      oddsMessages: odds.length,
      oddsRows,
      skippedNotTracked: skippedUnknown,
      changed: changed.length,
      unknown: unknown.length,
      matchIds: [...new Set([...odds.map((o) => o.matchId), ...infos.map((i) => i.matchId)])],
    });
  } catch (e) {
    return next(e);
  }
});

/* --------------------------------------- React app (betting / admin panels) */

// Public and admin detail routes invoke the shared loader after fixture validation.

// Sizzling Hot Deluxe — REAL player wallet (sportsbook balance).
// The original Pixi client posts to /real/play with the HttpOnly casino session
// cookie issued by POST /app/api/casino/session; every spin settles against the
// same ledger used by sports bets. Mounted BEFORE the demo router.
app.use('/app/api/casino/sizzlinghotdeluxe/real', createSizzlingRealRouter());
app.use('/app/api/casino/bookofra/real', createBookOfRaRealRouter());
app.use('/app/api', casinoSessionRouter);
app.use('/app/api', casinoBookOfRaSessionRouter);
app.use('/app/api/casino/original',createOriginalWalletRouter());
app.use('/app/casino-original',originalFrameShellRouter);

// Play'n GO Fire Joker 8.1.3 ContainerLauncher resolves game metadata from
// `/games/getgamebygid/:gid` on the SAME origin as the game URL. Without it the
// loader stalls at getGameByGid and the canvas stays black. The endpoint is a
// pure metadata shim: it never touches balances or balances math. Real
// spins still settle against `original-wallet.mjs`.
app.get('/games/getgamebygid/:gid', (req, res) => {
  const gid = String(req.params.gid || 'firejoker');
  res.json({
    Gid: gid,
    GameId: 'firejoker',
    GameName: 'Fire Joker',
    gId: gid,
    gameId: 'firejoker',
    name: 'Fire Joker',
    ProductGroup: 2,
    Practice: 0,
    Language: 'en_GB',
    Channel: 'desktop',
    Currency: 'ALL',
    Brand: 'png',
    ContextId: '',
    ShowPoweredBy: false,
    CoreWebUrl: (req.protocol || 'http') + '://' + (req.get('host') || 'localhost') + '/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/',
    ResourceRoot: '/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/',
    Country: 'AL',
    Region: 'AL',
    Jurisdiction: 'AL',
    ExternalId: '',
    Ticket: '',
    SessionId: 'wallet-session',
  });
});
app.get('/games/getgamebygameid/:gameId', (req, res) => {
  const gid = 'firejoker';
  res.json({
    Gid: gid,
    GameId: String(req.params.gameId || 'firejoker'),
    GameName: 'Fire Joker',
    gId: gid,
    gameId: String(req.params.gameId || 'firejoker'),
    name: 'Fire Joker',
    ProductGroup: 2,
    Practice: 0,
    Language: 'en_GB',
    Channel: 'desktop',
    Currency: 'ALL',
    Brand: 'png',
    ContextId: '',
    ShowPoweredBy: false,
    CoreWebUrl: (req.protocol || 'http') + '://' + (req.get('host') || 'localhost') + '/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/',
    ResourceRoot: '/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292/',
    Country: 'AL',
    Region: 'AL',
    Jurisdiction: 'AL',
    ExternalId: '',
    Ticket: '',
    SessionId: 'wallet-session',
  });
});

// Play'n GO 8.1.3's ContainerLauncher replaces the pathname with
// `/configuration/v2` when it requests its configuration. It therefore calls
// the domain root, even when the game assets live under the versioned folder.
// Keep this root route pointed at the same local Fire Joker assets.
app.use('/', createFireJokerLauncherRouter());

// Isolated demo protocol (virtual credits, no wallet) — kept for staff testing.
app.use('/app/api/casino/luckycloverx3',createCtProtocolRouter());
app.use('/app/api/casino/firejoker', createCtProtocolRouter({
  spinFn: (bet, _lines, options = {}) => spinFireJokerRound({ stakeCents: Number(bet), mathProfile: options.mathProfile }),
  configFn: fireJokerConfig,
  initialGrid: options => initialFireJokerGrid(options),
  selectedLines: 5,
  mapRound: mapFireJokerRound,
  cookieName: 'ct_firejoker_demo',
  apiPath: '/app/api/casino/firejoker',
}));
app.use('/app/api/casino/vikingsfun', createVikingsRouter());
app.use('/app/api/casino/agt', createAgtRouter());
app.use('/app/api/casino/sizzlinghotdeluxe',createSizzlingDemoRouter());
app.use('/app/api/casino/bookofra',createBookOfRaDemoRouter());

// Keep staff settings/finance history, but disable the old wallet spin API.
app.use('/app/api', casinoWalletRouter);
app.use('/app/api', casinoFinanceRouter);
app.use('/app/api', adminRouter);
app.use('/app/api', financialMonitoringRouter);
app.use('/app/api', directoryRouter);
app.use('/app/api',createFinancialResetRouter({onReset:async()=>{await pendingResults.refresh();io?.emit('finance:reset',{requiresLogin:true});}}));
app.use('/app/api', ledgerRouter);

const webDist = fileURLToPath(new URL('../web/dist/', import.meta.url));
if (existsSync(webDist)) {
  // Serve the original game files (demo entry index.html AND real-wallet entry
  // index-real.html) without SPA fallback. If an asset is missing, return a
  // real 404 instead of React's index.html with a misleading 200.
  // Reuse large media on repeat launches; boot code always reloads after updates.
  app.use('/app/casino-original/bookofra',
    express.static(path.join(webDist,'casino-original/bookofra'),{
      fallthrough:false,
      setHeaders:staticCacheHeaders,
    }));
  app.use('/app/casino-original/sizzling',
    express.static(path.join(webDist,'casino-original/sizzling'),{
      fallthrough:false,
      setHeaders:staticCacheHeaders,
    }));
  app.use('/app/casino-original/prophecy-ra-demo',
    express.static(path.join(webDist,'casino-original/prophecy-ra-demo'),{
      fallthrough:false,
      setHeaders:staticCacheHeaders,
    }));
  // Play'n GO 8.1.3 ContainerLauncher shim: the launcher fetches
  // configuration/v2 and configuration/prelaunchconfiguration from the same
  // origin as the game. Mount these BEFORE the static handler so they take
  // precedence over any stale JSON left in the build.
  app.use('/app/casino-original/firejoker/provider-original/8.1.3-firejoker.292', createFireJokerLauncherRouter());
  app.use('/app/casino-original/firejoker',
    express.static(path.join(webDist,'casino-original/firejoker'),{
      fallthrough:false,
      setHeaders:staticCacheHeaders,
    }));
  app.use('/app/casino-original/fortune-teller',express.static(path.join(webDist,'casino-original/fortune-teller'),{fallthrough:false,setHeaders:staticCacheHeaders}));
  app.use('/app', express.static(webDist,{setHeaders:staticCacheHeaders}));
  // deep links (/app/login, /app/admin, ...) fall through to the SPA shell
  app.get(/^\/app(?!\/api)(\/.*)?$/, (_req, res) => {
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.sendFile(path.join(webDist, 'index.html'));
  });
  console.log(`[app] serving the React app from ${webDist}`);
} else {
  app.get('/app', (_req, res) =>
    res.status(503).json({ error: 'app not built yet', hint: 'run npm run build:web' }),
  );
}

/* ---------------------------------------------------------------- delivery */

const docsDir = fileURLToPath(new URL('../docs/', import.meta.url));
// Open the betting app when a visitor enters only the public domain.
app.get('/', (_req, res) => res.redirect(302, '/app/'));
app.use(express.static(docsDir));

app.use((err, _req, res, _next) => {
  console.error('[http]', dbErrorHint(err.message));
  res.status(500).json({ error: err.message });
});

const server = app.listen(config.port, () => {
  console.log(`[http] listening on :${config.port} (frontend: ${docsDir})`);
});

const io = new SocketServer(server, {
  cors: { origin: corsOrigin },
  path: '/socket.io',
});
onMarketPolicy(()=>io.emit('markets:policy',{markets:catalogRows(),categories:categoryPolicies(),scopes:scopeBlockRows()}));
io.engine.on('headers', freshSocketHeaders);

overrides.onVisibilityChange(change=>io.emit('matches:visibility',change));
io.on('connection', async (socket) => {
  if (shuttingDown) return socket.disconnect(true);
  socket.join('feed:legacy');
  socket.on('feed:scope',value=>{
    const version=socket.data.scopeVersion=(socket.data.scopeVersion??0)+1;
    socket.data.scopeQueue=(socket.data.scopeQueue??Promise.resolve()).catch(()=>{}).then(async()=>{
    if(version!==socket.data.scopeVersion||!socket.connected||shuttingDown)return;socketTasks++;
    try{const previous=socket.data.feedScope;const scope=await setSocketScope(socket,value);const interested=new Set([...scope.boardIds,...(scope.detail?[scope.detail.id]:[]),...scope.selectionIds.map(id=>id.split('|')[0])]);const pending=socket.data.pendingScopeSnapshots??new Set();socket.data.pendingScopeSnapshots=pending;for(const id of [...pending])if(!interested.has(id))pending.delete(id);for(const id of scope.boardIds)if(!previous?.boardIds.includes(id))pending.add(id);if(scope.detail&&(scope.detail.id!==previous?.detail?.id||scope.detail.category!==previous?.detail?.category))pending.add(scope.detail.id);for(const key of scope.selectionIds)if(!previous?.selectionIds.includes(key))pending.add(key.split('|')[0]);const ids=[...pending];
      for(const id of ids){if(!socket.connected||socket.data.scopeVersion!==version)return;const row=await getMatchById(Number(id));if(!row){pending.delete(id);continue;}const [full]=await withOdds([row],Date.now(),{board:scope.detail?.id!==id&&!scope.selectionIds.some(key=>key.startsWith(id+'|')),displayStats:scope.detail?.id===id});const [client]=toClientMatches([full]);
        const board=projectClientBoardMatches([client])[0],keys=new Set((board.markets??[]).map(m=>m.extId+'|'+(m.line??''))),selected=new Set(scope.selectionIds);if(scope.boardIds.includes(id))publishedBoardKeys.set(id,keys);
        const detail=scope.detail?.id===id?new Set(detailProjection(client,scope.detail.category).markets.map(m=>m.extId+'|'+(m.line??''))):new Set();
        const markets=(full.markets??[]).filter(m=>offeredMarket(m)).map(m=>({...m,outcomes:(m.outcomes??[]).filter(o=>(scope.boardIds.includes(id)&&keys.has(m.key+'|'+(m.line??'')))||detail.has(m.key+'|'+(m.line??''))||selected.has(id+'|'+m.key+'|'+(m.line??'')+'|'+o.key)).map(o=>({...o,priceValidUntil:quoteValidUntil(o.priceUpdatedAt,row,config.prematchStaleMs)}))})).filter(m=>m.outcomes.length);
        if(socket.data.scopeVersion===version){if(markets.length)socket.emit('odds:update',{matchId:id,at:new Date().toISOString(),markets:projectOddsDelta(row,markets,{matchOverride:overrides.matchOverride,marketOverride:overrides.marketOverride,outcomeOverride:overrides.outcomeOverride,prematchMaxAgeMs:config.prematchStaleMs})});pending.delete(id);}
      }
    }catch(e){console.warn('[feed scope]',e.message);}finally{socketTasks--;}
    });
  });
  // a visitor: the feed must be live while this socket is open (idle mode wakes it here)
  idle.clientOpen();
  socket.on('disconnect', () => idle.clientClose());

  // `mode` lets the board say "odds are being refreshed" instead of showing an empty list
  // while the first feed cycle is in flight
  socket.emit('hello', { at: new Date().toISOString(), pollMs: config.pollIntervalMs, mode: getFeedMode() });
  socket.emit('combos:settings', {enabled:liveRiskSettings().combosEnabled !== false});
  socketTasks++;
  try {
    const counts = await getCounts();
    socket.emit('meta', { ...counts, mode: getFeedMode() });
    // while waking, the collector's own broadcast carries the first board (it emits to every
    // socket), so this must not send an empty list first
    if (getFeedMode() !== 'live') return;
    const rows = await getMatches({ service: 'LIVE', catalog:true });
    socket.emit('matches:live', {
      at: new Date().toISOString(),
      counts,
      mode: getFeedMode(),
      matches: liveBoardFacts(await withOdds(rows,Date.now(),{board:true})),
    });
  } catch (e) {
    socket.emit('server:error', { message: e.message });
  } finally {
    socketTasks--;
  }
});

/* ------------------------------------------------------- push subscription plan */

/** PREMATCH_REFRESH_MS=0 turns the tiers off: prematch follows the live cadence again */
const tieredPrematch = () => config.prematchRefreshMs > 0;

/** how far ahead a kickoff counts as "soon" (0 = nothing is soon, everything is "later") */
const soonWindowMs = () => (tieredPrematch() ? Math.max(0, config.prematchSoonMin * 60 * 1000) : 0);

/**
 * What the push channel should be subscribed to right now: the store's ids split by tier, plus
 * the prematch fixtures the feed has not priced yet.
 *
 * The unpriced set is recomputed on every pass, so a fixture that appears without prices is
 * asked for within a minute instead of waiting for the next scheduled refresh - without it the
 * "hide matches without prices" rule would keep a new fixture invisible for up to an hour.
 */
async function subscriptionPlan() {
  if(['ybets','zizobet'].includes(config.sportsProvider))return {live:[],prematch:[],prematchSoon:[],prematchLater:[],unpriced:[],pendingResults:pendingResults.ids().filter(id=>!isYbetsMatchId(id)&&!isZizoId(id))};
  const ids = await getSubscriptionIds({
    liveLimit: 0,
    prematchLimit: 0,
    soonMs: soonWindowMs(),
  });
  const visible=selectPublishedMatches(await getMatches({catalog:true})).rows;
  const filtered=filterBoardSubscriptionPlan(ids,visible,{prematchLimit:0,soonMs:soonWindowMs()});
  const prematch = filtered.prematch ?? [];
  return {
    ...filtered,
    pendingResults: pendingResults.ids(),
    // ODDS_STORE=db keeps prices in Postgres, where there is no cheap "has a price?" check
    unpriced: config.oddsStore === 'db' ? [] : oddsStore.missingPrices(prematch),
  };
}

async function boot() {
  const target = dbTarget();
  console.log(`[db] target ${dbTargetLabel(target)}`);
  if (target.ipv6OnlyDirectHost) {
    console.warn(
      '[db] DATABASE_URL uses the IPv6-only direct host db.<ref>.supabase.co - use the pooler host (aws-<n>-<region>.pooler.supabase.com) unless this host has IPv6',
    );
  }

  await ensureLedgerSchema(); // the board does not need the ledger, so a failure here is not fatal
  if (shuttingDown) return;
  // DB remains authoritative when multiple instances serve the sportsbook.
  // For betting, the policy is reread under the singleton row lock regardless.
  riskRefreshTimer = setInterval(() => {
    if(!shuttingDown&&!feedIsStopped()&&ledgerReady)trackBackground(refreshMarketCatalog().catch(e=>console.warn('[market catalog]',e.message)));
    if (!shuttingDown && !feedIsStopped() && ledgerReady) trackBackground(refreshBoardSettings().catch(e=>console.warn('[board settings] refresh failed:',e.message)));
    if (!shuttingDown && !feedIsStopped() && ledgerReady) trackBackground(refreshLiveRiskSettings().catch(e =>
      console.warn('[live risk] refresh failed:',e.message)));
  }, 10000);
  riskRefreshTimer.unref?.();

  // The ledger-ready transition starts settlement, including when Postgres
  // first becomes available after boot. Do not schedule duplicate timers.
  armSettlement();
  if (!ledgerReady) console.warn('[settle] waiting for ledger; will start automatically after DB recovery');

  if(['ybets','zizobet'].includes(config.sportsProvider)) {
    if(config.oddsStore==='db'||config.matchStore==='db')throw new Error('Ybets requires MATCH_STORE=memory and ODDS_STORE=memory; the financial database remains local.');
    collector=(config.sportsProvider==='zizobet'?startZizoFeed:startYbetsFeed)({
      pollMs:config.pollIntervalMs,
      onMatch:row=>{
        // Lightweight registration only. External info refresh runs in its
        // own bounded loop, not inside the odds/feed callback.
        if(config.sportsProvider==='zizobet'){
          statsProviders.observeMatch(row);
          footballInformation.observeMatch(row);
        }
        return upsertMatches([row]);
      },
      onOdds:rows=>{oddsBuffer.push(...rows);},
      onMarketDefinitions:definitions=>{
        if(!ledgerReady||config.sportsProvider!=='zizobet')return;
        // Never block the provider refresh on a slow/offline database.
        trackBackground(persistProviderMarketDefinitions(definitions,{execute:query})
          .catch(error=>console.warn('[market archive] dictionary:',error.message)));
      },
      onInfo:info=>{if(info.homeScore==null&&info.matchTimeMs==null)return applyMatchInfo(info);infoBuffer.set(info.matchId,mergeInfo(infoBuffer.get(info.matchId),info));},
      onStatus:s=>{oddsStatus={...oddsStatus,...s,provider:config.sportsProvider.toUpperCase()};io.emit('odds:socket',oddsStatus);},
      onCycle:async()=>{
        idle.markLive();
        broadcastFeedState();
        await expireStaleMatches(180);
        const rows=await getMatches({service:'LIVE',catalog:true});
        const matches=await withOdds(rows,Date.now(),{board:true}),counts=await getCounts();
        io.emit('matches:live',{at:new Date().toISOString(),counts,matches:liveBoardFacts(matches),syncStream:feedStreamId,syncSequence:++liveBoardSequence});
      },
      selectRows:rows=>{
        const visible=selectPublishedMatches(rows.filter(r=>!['closed','uncovered','ended'].includes(r.status)),{prematchLimit:0}).rows;
        return visible;
      },
      getWatchedIds:()=>pendingResults.ids(),
    });
  } else if(config.sportsProvider==='luckybet') {
    collector=startCollector({io,onCycle:()=>{idle.markLive();broadcastFeedState();}});
  } else throw new Error('SPORTS_PROVIDER must be zizobet, ybets or luckybet');

  if(config.sportsProvider==='zizobet'&&process.env.LEGACY_YBETS_RESULTS==='true')legacyYbetsResults=startLegacyYbetsResults({getIds:()=>pendingResults.ids(),onFinal:(info,row)=>pendingResults.observe(info,row)});
  if (process.env.ODDS_SOCKET === 'true' && config.sportsProvider === 'luckybet') {
    const resubscribeMs = Number(process.env.RESUBSCRIBE_MS ?? 20000);
    pusher = startPusher({
      getIds: () => subscriptionPlan(),
      fullMarkets: process.env.SUBSCRIBE_FULL_MARKETS !== 'false',
      fullMarketsLiveLimit: Number(process.env.SUBSCRIBE_FULL_LIMIT ?? 60),
      // 'recent' (default) spends the full-market quota on the matches that just kicked off
      fullMarketsOrder: process.env.SUBSCRIBE_FULL_ORDER ?? 'recent',
      // re-subscribing is what makes the feed resend the clock+score snapshot
      resubscribeMs,
      // prematch tiers: near-kickoff fixtures are refreshed often, the rest hourly. With
      // PREMATCH_REFRESH_MS=0 (kill switch) every group follows the live cadence again.
      prematchSoonMs: tieredPrematch() ? config.prematchSoonRefreshMs : resubscribeMs,
      prematchLaterMs: tieredPrematch() ? config.prematchRefreshMs : resubscribeMs,
      prematchUnpricedMs: tieredPrematch() ? config.prematchUnpricedRefreshMs : resubscribeMs,
      onOdds: (rows) => {if(!['ybets','zizobet'].includes(config.sportsProvider))oddsBuffer.push(...rows);},
      onInfo: (info) => infoBuffer.set(info.matchId, mergeInfo(infoBuffer.get(info.matchId), info)),
      onStatus: (s) => {
        if(!['ybets','zizobet'].includes(config.sportsProvider)){oddsStatus = { ...oddsStatus, ...s };io.emit('odds:socket', oddsStatus);}
      },
    });
    console.log(
      `[pusher] server-side odds subscription enabled (prematch tiers: ` +
        (tieredPrematch()
          ? `soon<=${config.prematchSoonMin}min every ${Math.round(config.prematchSoonRefreshMs / 1000)}s, ` +
            `later every ${Math.round(config.prematchRefreshMs / 60000)}min`
          : 'off, live cadence for everything') +
        `)`,
    );
  } else {
    console.log('[odds] server-side subscription off (set ODDS_SOCKET=true); the browser relay still feeds /ingest/frames');
  }

  idle.start();
  pendingLiveMonitor=setInterval(()=>trackBackground(keepFeedForPendingLiveBets()),15000);
  pendingLiveMonitor.unref?.();
  void keepFeedForPendingLiveBets();
  console.log(`[idle] ${idle.state().enabled ? 'enabled' : 'disabled'}; feed pauses after ${Math.round(idle.state().idleAfterMs / 1000)}s without visitors.`);

}

installGracefulShutdown({
  server,
  io,
  closePool,
  stopBackground() {
    shuttingDown = true;
    idle.stop();
    collector?.stop();
    legacyYbetsResults?.stop();
    pusher?.close();
    stopProbe();
    clearInterval(settleTimer);
    clearInterval(supplementalTimer);
    clearInterval(pendingLiveMonitor);
    clearInterval(feedFlushTimer);
    clearInterval(riskRefreshTimer);
  },
  async waitForBackground() {
    await collector?.drain?.();
    await legacyYbetsResults?.drain();
    while (backgroundTasks.size || collector?.state.running || settlementBusy || flushing || socketTasks) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  },
});

trackBackground(boot()).catch(error => {
  console.error('[app] startup failed:', error?.message ?? error);
  process.exit(1);
});
