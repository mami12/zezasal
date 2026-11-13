import {matchOverride} from './overrides.mjs';
import {statsProviders} from '../stats-providers/index.mjs';
import {footballInformation,setFootballInformationMapping,inspectFootballInformation} from '../stats-providers/football-information.mjs';
import {query} from '../db.mjs';
import {filterFixtureRowsByDay} from '../fixture-dates.mjs';
import {isSyntheticFootballMatch} from '../football-competitions.mjs';
/**
 * API for the React app, mounted at /app/api.
 *
 * The existing board API (/api/*) is untouched: this router serves the app's own
 * contract (auth, sports tree, matches) from our live in-memory board.
 */
import express from 'express';
import { authenticate, requireAuth, requireAdmin } from './auth.mjs';
import * as ledger from './store.mjs';
import * as bets from './bets.mjs';
import * as betHistory from './bet-history.mjs';
import * as builders from './bet-builders.mjs';
import { getMatches as getMatchRows, getMatchById as getMatchRow, boostMatch } from '../matches.mjs';
import { withOdds } from '../collector.mjs';
import { sportsTree, toClientMatch, toClientMatches } from './view.mjs';
import { getPlayerControls, requestSelfExclusion, updatePlayerLimits } from './player-controls.mjs';
import { refreshLiveRiskSettings, writeLiveRiskSettings, setAllCombosEnabled } from './live-risk-store.mjs';
import { DEFAULT_LIVE_RISK_SETTINGS } from '../live-risk-settings.mjs';
import {detailProjection,CATEGORIES} from '../market-delivery.mjs';
import { projectClientBoardMatches,projectBoardMatches } from './board-projection.mjs';
import { freshFeed } from '../feed-sync.mjs';
import {trackerTeamStatistics} from '../match-statistics.mjs';
import {recentFinishedFavorites} from './favorite-history.mjs';
import {publishedBoard,filterPublishedRows,refreshBoardSettings,saveBoardSettings} from './board-settings-store.mjs';
import {DEFAULT_BOARD_SETTINGS} from '../board-settings.mjs';

import {catalogRows,categoryPolicies,marketFamily,nativeMarketPolicyKeys,scopeBlockRows} from '../market-catalog.mjs';
import {refreshMarketCatalog,saveMarketPolicy,saveScopePolicy} from './market-catalog-store.mjs';
import {providerMarketCoverage} from './market-coverage.mjs';
export const ledgerRouter = express.Router();
ledgerRouter.use(freshFeed);

/**
 * Async wrapper that also maps a thrown error to its intended status. Bet rules throw
 * errors carrying `status` (400 for a refused bet, 403 for a blocked account); without
 * this they would surface as 500 and the betslip would show a generic failure instead of
 * the real reason. Both `message` and `error` are set: the app reads either.
 */
const guard = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    const status = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
    if (status >= 500) console.error('[app api]', req.method, req.originalUrl, '-', e?.message);
    const body = { message: e?.message ?? 'error', error: e?.message ?? 'error' };
    if (e?.code) body.code = e.code;
    if (e?.outcomeId) body.outcomeId = e.outcomeId;
    if (e?.sourceOutcomeId) body.sourceOutcomeId = e.sourceOutcomeId;
    if (e?.oldOdds !== undefined) body.oldOdds = e.oldOdds;
    if (e?.newOdds !== undefined) body.newOdds = e.newOdds;
    if (e?.outcomeName) body.outcomeName = e.outcomeName;
    if (e?.marketName) body.marketName = e.marketName;
    if (e?.matchName) body.matchName = e.matchName;
    res.status(status).json(body);
  });
/**
 * Only a definite 4xx rejection from a bet-placement handler is logged.
 * Never log server errors as rejected bets, and never affect the wallet.
 * Auditing must not replace the original betting error if the DB write fails.
 */
const placementGuard = (fn) => guard(async (req, res, next) => {
  try {
    return await fn(req, res, next);
  } catch (e) {
    const code = Number(e?.status);
    if (code >= 400 && code < 500 && req.user?.id && req.user?.role === 'PLAYER') {
      const body = req.body ?? {};
      const columns = Array.isArray(body.columns) ? body.columns : [];
      const count = Array.isArray(body.selections) ? body.selections.length :
        columns.reduce((sum, col) => sum + (Array.isArray(col) ? col.length : 0), 0);
      try {
        await betHistory.recordRejectedBet({
          userId: req.user.id, requestId: body.clientRequestId,
          stake: body.totalStake ?? body.stake, selectionCount: count, reason: e?.message,
        });
      } catch (auditError) {
        console.warn('[bet rejection audit] write failed:', auditError?.message);
      }
    }
    throw e;
  }
});

const asLimit = (v, def, max) => Math.min(Math.max(1, Number(v) || def), max);

/**
 * Login and everything money-related needs the ledger tables. The board endpoints below
 * do not, so they keep serving while the database is down.
 */
const requireLedger = (req, res, next) =>
  ledger.isLedgerReady() ? next() : res.status(503).json({ message: 'ledger database unavailable' });

/* ------------------------------------------------------------------- auth */

ledgerRouter.post(
  '/auth/login',
  requireLedger,
  guard(async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ message: 'username and password are required' });

    const result = await authenticate(username, password);
    if (!result) return res.status(401).json({ message: 'invalid username or password' });
    if (result.user.status === 'BANNED') return res.status(403).json({ message: 'account is banned' });
    return res.json(result);
  }),
);

ledgerRouter.get('/auth/me', requireLedger, requireAuth, (req, res) => res.json(req.user));

ledgerRouter.get(
  '/me/transactions',
  requireLedger,
  requireAuth,
  guard(async (req, res) => res.json(await ledger.listTransactions({
    role: 'PLAYER',
    userId: req.user.id,
    from: req.query.from,
    to: req.query.to,
    limit: asLimit(req.query.limit, 100, 500),
  }))),
);

/** Player's actual ticket statuses and separately audited rejected attempts. */
ledgerRouter.get(
  '/me/bets',
  requireLedger,
  requireAuth,
  guard(async (req, res) => {
    if (req.user.role !== 'PLAYER') return res.status(403).json({ message: 'player only' });
    res.json(await betHistory.listPlayerBetActivity({
      userId: req.user.id, status: req.query.status,
      from: req.query.from, to: req.query.to,
      limit: asLimit(req.query.limit, 200, 500),
    }));
  }),
);

ledgerRouter.get(
  '/me/transactions/summary',
  requireLedger,
  requireAuth,
  guard(async (req, res) => {
    if (req.user.role !== 'PLAYER') return res.status(403).json({ message: 'player only' });
    return res.json(await ledger.playerTransactionSummary({
      userId: req.user.id,
      from: req.query.from,
      to: req.query.to,
    }));
  }),
);

ledgerRouter.get(
  '/me/controls',
  requireLedger,
  requireAuth,
  guard(async (req, res) => {
    if (req.user.role !== 'PLAYER') return res.status(403).json({ message: 'player only' });
    return res.json(await getPlayerControls(req.user.id));
  }),
);

ledgerRouter.patch(
  '/me/controls/limits',
  requireLedger,
  requireAuth,
  guard(async (req, res) => {
    if (req.user.role !== 'PLAYER') return res.status(403).json({ message: 'player only' });
    return res.json(await updatePlayerLimits(req.user.id, req.body ?? {}));
  }),
);

ledgerRouter.post(
  '/me/controls/self-exclusion',
  requireLedger,
  requireAuth,
  guard(async (req, res) => {
    if (req.user.role !== 'PLAYER') return res.status(403).json({ message: 'player only' });
    return res.json(await requestSelfExclusion(req.user.id, req.body?.days));
  }),
);

/* ------------------------------------------------------- admin live risk configuration */
ledgerRouter.get('/admin/live-risk', requireLedger, requireAuth, requireAdmin,
  guard(async (req,res) => res.json({ settings: await refreshLiveRiskSettings(), defaults: DEFAULT_LIVE_RISK_SETTINGS })));
ledgerRouter.put('/admin/live-risk', requireLedger, requireAuth, requireAdmin,
  guard(async (req,res) => res.json(await writeLiveRiskSettings(req.body?.settings,req.user))));

/* ------------------------------------------------------- optional AiScore match identities.
 * The upstream ID must be supplied explicitly and confirmed against the exact
 * fixture before a scorer can be displayed. Never fuzzy-match two fixtures.
 */
ledgerRouter.get('/admin/football-information/:matchId',requireLedger,requireAuth,requireAdmin,
  guard(async(req,res)=>{
    const id=Number(req.params.matchId);
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({message:'Invalid match ID'});
    const {rows}=await query('select match_id,aiscore_id,thesports01_id,mapping_status,last_checked_at,last_error,next_check_at from app_football_information_map where match_id=$1',[id]);
    return res.json({mapping:rows[0]??null,enabled:footballInformation.enabled()});
  }));
ledgerRouter.put('/admin/football-information/:matchId',requireLedger,requireAuth,requireAdmin,
  guard(async(req,res)=>{
    const mapping=await setFootballInformationMapping({
      matchId:req.params.matchId,aiscoreId:req.body?.aiscoreId,
      thesports01Id:req.body?.thesports01Id,actorId:req.user.id,
    });
    res.json({mapping});
  }));
ledgerRouter.post('/admin/football-information/:matchId/inspect',requireLedger,requireAuth,requireAdmin,
  guard(async(req,res)=>res.json(await inspectFootballInformation(req.params.matchId,{
    needsOverride:['player'],
  }))));

/* ------------------------------------------------------- universal bet builders */
ledgerRouter.get('/admin/bet-builders/catalog', requireLedger, requireAuth, requireAdmin,
  (req,res) => res.json(builders.builderCatalog()));
ledgerRouter.get('/admin/bet-builders', requireLedger, requireAuth, requireAdmin,
  guard(async (req,res) => res.json(await builders.listTemplates())));
ledgerRouter.patch('/admin/bet-builders/enabled',requireLedger,requireAuth,requireAdmin,
  guard(async(req,res)=>res.json(await setAllCombosEnabled(req.body?.enabled,req.user))));
ledgerRouter.post('/admin/bet-builders', requireLedger, requireAuth, requireAdmin,
  guard(async (req,res) => res.json(await builders.saveTemplate(req.body ?? {}))));
ledgerRouter.delete('/admin/bet-builders/:id', requireLedger, requireAuth, requireAdmin,
  guard(async (req,res) => { await builders.deleteTemplate(req.params.id); res.json({ ok:true }); }));

/* ------------------------------------------------------- bets (stage 2) */

/** place a real ticket: validates against the live feed, then charges the balance */
ledgerRouter.post(
  '/bets/place',
  requireLedger,
  requireAuth,
  placementGuard(async (req, res) => {
    const { stake, selections, ticketType, type, systemType, clientRequestId } = req.body ?? {};
    const ticket = await bets.placeBet({
      user: req.user,
      stake,
      selections,
      clientRequestId,
      ticketType: ticketType ?? type ?? null,
      systemType: systemType ?? null,
    });
    res.json(ticket);
  }),
);

/** Multiple ordinary columns: one atomic wallet transaction. */
ledgerRouter.post('/bets/place-columns', requireLedger, requireAuth, placementGuard(async (req, res) => {
  res.json(await bets.placeColumns({
    user: req.user,
    stake: req.body?.stake,
    totalStake: req.body?.totalStake,
    selections: req.body?.selections,
    columns: req.body?.columns,
    clientRequestId: req.body?.clientRequestId,
  }));
}));

/** shareable booking code: no stake, no account */
ledgerRouter.post(
  '/bets/book',
  requireLedger,
  guard(async (req, res) => {
    const { stake, selections, ticketType, type, systemType } = req.body ?? {};
    res.json(
      await bets.bookTicket({
        stake,
        selections,
        ticketType: ticketType ?? type ?? null,
        systemType: systemType ?? null,
      }),
    );
  }),
);

ledgerRouter.get(
  '/bets/active',
  requireLedger,
  requireAuth,
  guard(async (req, res) => res.json(await bets.listActive(req.user.id))),
);

ledgerRouter.get(
  '/bets/history',
  requireLedger,
  requireAuth,
  guard(async (req, res) => res.json(await bets.listHistory(req.user.id))),
);

/** the betslip's "find ticket" box: booking code or a ticket id fragment */
ledgerRouter.get(
  '/tickets/search',
  requireLedger,
  guard(async (req, res) => {
    const ticket = await bets.searchTickets(req.query.q);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    return res.json(ticket);
  }),
);

/** a booking code can be opened by anyone (that is the point of sharing it) */
ledgerRouter.get(
  '/booking/:code',
  requireLedger,
  guard(async (req, res) => {
    const ticket = await bets.getBookingTicket(req.params.code);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    return res.json(ticket);
  }),
);

ledgerRouter.get('/market-policy',(_req,res)=>res.set('Cache-Control','no-store').json({markets:catalogRows(),categories:categoryPolicies(),scopes:scopeBlockRows()}));
ledgerRouter.get('/admin/market-catalog',requireLedger,requireAuth,requireAdmin,guard(async(_req,res)=>res.json({markets:await refreshMarketCatalog(),categories:categoryPolicies(),scopes:scopeBlockRows()})));
ledgerRouter.get('/admin/market-coverage',requireLedger,requireAuth,requireAdmin,guard(async(req,res)=>{
 const sampled=Math.max(100,Math.min(15000,Number(req.query.sampleLimit)||12000));
 res.set('Cache-Control','no-store').json(await providerMarketCoverage({quoteLimit:sampled}));
}));
ledgerRouter.patch('/admin/market-catalog',requireLedger,requireAuth,requireAdmin,guard(async(req,res)=>res.json({markets:await saveMarketPolicy(req.body,req.user),categories:categoryPolicies(),scopes:scopeBlockRows()})));
ledgerRouter.get('/admin/market-catalog/scopes',requireLedger,requireAuth,requireAdmin,guard(async(_req,res)=>res.json({scopes:scopeBlockRows()})));
ledgerRouter.put('/admin/market-catalog/scopes',requireLedger,requireAuth,requireAdmin,guard(async(req,res)=>{const scopes=await saveScopePolicy(req.body?.scopes,req.user);res.json({scopes,markets:await refreshMarketCatalog()});}));
ledgerRouter.get('/admin/market-catalog/matches',requireLedger,requireAuth,requireAdmin,guard(async(req,res)=>{
 const family=String(req.query.family??'').trim();
 if(!family)return res.status(400).json({message:'Zgjidh nje treg.'});
 const selected=await publishedBoard();
 const rows=filterPublishedRows(selected.rows,{});
 const serialized=await withOdds(rows,Date.now(),{board:false});
 const matches=[];
 for(const row of serialized){
  const match=toClientMatch(row);
  const hits=(match.markets??[]).filter(m=>marketFamily(m)?.key===family||nativeMarketPolicyKeys(m,match).includes(family));
  if(!hits.length)continue;
  matches.push({id:match.id,home:match.home?.name??'',away:match.away?.name??'',league:match.tournament?.name??'',country:match.tournament?.category?.name??'',startTime:match.startTime??null,live:match.status==='LIVE',markets:hits.length,outcomes:hits.reduce((n,m)=>n+(m.outcomes??[]).length,0)});
 }
 matches.sort((a,b)=>Number(b.live)-Number(a.live)||String(a.startTime??'').localeCompare(String(b.startTime??'')));
 res.json({family,count:matches.length,matches});
}));
/* ------------------------------------------------------------ board views */

ledgerRouter.get('/admin/board-settings',requireLedger,requireAuth,requireAdmin,guard(async(req,res)=>{
 if(req.user.status!=='ACTIVE')return res.status(403).json({message:'Vetëm administratori aktiv.'});
 const saved=await refreshBoardSettings(),board=await publishedBoard();res.json({...saved,defaults:DEFAULT_BOARD_SETTINGS,summary:board.summary,protectedCompetitions:board.protectedCompetitions});
}));
ledgerRouter.put('/admin/board-settings',requireLedger,requireAuth,requireAdmin,guard(async(req,res)=>{
 const saved=await saveBoardSettings(req.body?.settings,req.user),board=await publishedBoard();res.json({...saved,summary:board.summary,protectedCompetitions:board.protectedCompetitions});
}));

/** the sidebar tree (also served at /sports, which the sidebar tries first) */
ledgerRouter.get(
  ['/sports', '/sports/tree'],
  guard(async (_req, res) => {
    const {rows} = await publishedBoard();
    res.json(sportsTree(rows));
  }),
);

ledgerRouter.get(
  '/matches',
  guard(async (req, res) => {
    const { tournamentId, categoryId, sportId, status, q } = req.query;
    const service = status === 'LIVE' ? 'LIVE' : status === 'PREMATCH' ? 'PREMATCH' : null;

    const selected = await publishedBoard();
    const fixtureIds=req.query.favoriteIds===undefined?null:new Set(
      String(req.query.favoriteIds).split(',').filter(value=>/^\d{1,16}$/.test(value)).slice(0,100));
    const allRows = filterPublishedRows(filterFixtureRowsByDay(selected.rows,req.query.day),{
      service,
      league: categoryId ? String(categoryId) : null,
      tournamentId: tournamentId ? String(tournamentId) : null,
      sportId: sportId ? String(sportId) : null,
      q: q ? String(q) : null,
    }).filter(row=>!fixtureIds||fixtureIds.has(String(row.match_id)));

    // Pagination is opt-in: preserve existing API consumers, but never
    // serialize all 300+ odds boards for a browser showing its first screen.
    const paged=String(req.query.page??'')==='1';
    const limit=paged?Math.min(60,Math.max(1,Math.floor(Number(req.query.limit)||24))):allRows.length;
    const offset=paged?Math.min(10000,Math.max(0,Math.floor(Number(req.query.offset)||0))):0;
    const rows=paged?allRows.slice(offset,offset+limit):allRows;
    const serialized = await withOdds(rows,Date.now(),{board:true});
    const matches=toClientMatches(projectBoardMatches(serialized));
    if(paged)return res.json({items:matches,total:allRows.length,
      nextOffset:offset+matches.length,hasMore:offset+matches.length<allRows.length});
    return res.json(matches);
  }),
);

/** Only explicitly favorited IDs: bounded recent results, never betting prices.
 * The general board still excludes ended fixtures.
 */
ledgerRouter.get('/matches/favorites',guard(async(req,res)=>{
 if(!ledger.isLedgerReady())return res.json([]);
 return res.json(await recentFinishedFavorites(req.query.ids));
}));

ledgerRouter.get(
  '/matches/:id',
  guard(async (req, res) => {
    const matchId=Number(req.params.id),startedAt=Date.now();
    let matchReadAt=startedAt,oddsReadAt=startedAt,decoratedAt=startedAt;
    res.once('finish',()=>{
      const totalMs=Date.now()-startedAt;
      if(totalMs>=3000)console.warn('[match-detail] slow request',{
        matchId,status:res.statusCode,totalMs,
        matchReadMs:matchReadAt-startedAt,
        oddsMs:oddsReadAt-matchReadAt,
        decorationMs:decoratedAt-oddsReadAt,
        responseMs:Date.now()-decoratedAt
      });
    });
    if(!Number.isSafeInteger(matchId)||matchId<=0)return res.status(404).json({message:'match not found'});
    let row=await getMatchRow(matchId);
    if(row&&(matchOverride(row.match_id)?.hidden||isSyntheticFootballMatch(row)))return res.status(404).json({message:'match not found'});
    if(ledger.isLedgerReady()&&(!row||row.status==='ended')){
      const archive=(await recentFinishedFavorites([matchId]))[0];
      if(archive)return res.json(archive);
    }
    if(!row)return res.status(404).json({message:'match not found'});
    matchReadAt=Date.now();
    // somebody is looking at this match: make sure it gets its full market list (corners,
    // cards, every total) on the next subscribe cycle, instead of base markets only
    boostMatch(row.match_id);
    // Explicit provider rotation: FotMob and configured statistical feeds get
    // the first chance, then mapped AiScore is checked for a missing actor.
    // This runs asynchronously; no network wait holds the market request open.
    const warmStats=statsProviders.warm(row);
    void Promise.resolve(warmStats).then(()=>footballInformation.warm(matchId))
      .catch(error=>console.warn('[aiscore] selected match:',error.message));
    // The quoted snapshot is local. Full provider markets refresh in the
    // background and reach this match through the next odds push/REST poll.
    // Do not block detail or tracker requests on provider HTTP/database writes.
    req.app.locals.loadMatchDetail?.(row.match_id);
    const [serialized] = await withOdds([row],Date.now(),{displayStats:true});
    oddsReadAt=Date.now();
    const match = toClientMatch(serialized);
    if (ledger.isLedgerReady()) await builders.decorateMatches([match]);
    decoratedAt=Date.now();
    const category=CATEGORIES.includes(req.query.category)?req.query.category:'all';
    const page=req.query.marketLimit===undefined?undefined:{
      limit:Math.min(80,Math.max(1,Math.floor(Number(req.query.marketLimit)||40))),
      offset:Math.min(10000,Math.max(0,Math.floor(Number(req.query.marketOffset)||0))),
      search:String(req.query.q??'').trim().slice(0,120),
    };
    return res.json({...detailProjection(match,category,page),fullMarketsReady:req.app.locals.matchMarketsReady?.(matchId)??true});
  }),
);

/**
 * The app's pitch tracker. Our feed gives score, clock, corners and cards but no ball
 * position, so this returns the real statistics and leaves the ball centred.
 */
ledgerRouter.get(
  '/matches/:id/tracker',
  guard(async (req, res) => {
    let row = await getMatchRow(Number(req.params.id));
    if (!row || matchOverride(row.match_id)?.hidden || isSyntheticFootballMatch(row)) return res.status(404).json({ message: 'match not found' });
    boostMatch(row.match_id);
    // The quoted snapshot is local. Full provider markets refresh in the
    // background and reach this match through the next odds push/REST poll.
    // Do not block detail or tracker requests on provider HTTP/database writes.
    req.app.locals.loadMatchDetail?.(row.match_id);

    const [serialized] = await withOdds([row],Date.now(),{displayStats:true});
    const m = toClientMatch(serialized);
    const stats=trackerTeamStatistics({...row,stats:statsProviders.displayStatistics(row)});

    return res.json({
      matchId: m.id,
      ballX: 50,
      ballY: 50,
      possessionTeam: null,
      /* the feed's own state, e.g. "2nd Half" */
      eventText: m.period ?? '',
      minute: m.currentMinute,
      score: { home: m.homeScore, away: m.awayScore },
      homeStats: stats.home,
      awayStats: stats.away,
    });
  }),
);

/** "sport 18" is football in our feed; the app asks for it by id */
ledgerRouter.get(
  '/sports/:sportId/matches',
  guard(async (req, res) => {
    if (String(req.params.sportId) !== '18') return res.json([]);
    const selected=await publishedBoard();const rows=filterPublishedRows(selected.rows,{sportId:req.params.sportId});
    const board = true;
    const serialized = await withOdds(rows,Date.now(),{board});
    const matches = (board?toClientMatches(projectBoardMatches(serialized)):toClientMatches(serialized));
    return res.json(!board&&ledger.isLedgerReady() ? await builders.decorateMatches(matches,{includeAutomatic:false}) : matches);
  }),
);
