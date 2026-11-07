import {OutcomeFeedContext,createOutcomeStore} from './outcomeFeed';
import {bindFeedScope,hasFeedInterest,hasDetailFeedInterest} from './feedScope';
import {createSourceReopenTracker} from './sourceReopen';
import {setCatalogRows,setCategoryPolicies,setScopeBlocks} from '../../../server/market-catalog.mjs';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Match, MatchEvent, OddsDelta } from '../types';
import { frozenSelectionPrice } from '../../../server/ledger/system-columns.mjs';
import { mergeMatchFacts, snapshotTime, timestamp } from './matchSync';
import {optionalFeedNumber} from './feedNumbers';

/**
 * One shared Socket.IO connection for the whole board.
 *
 * Every odds button used to call useWebSocket(), so a board with ~150 matches opened hundreds
 * of sockets (three per card), and the hook listened to odds:update only - which meant the
 * minute, the score, the corners and the cards arrived through the 15s REST poll instead of by
 * push. The provider owns a single connection and publishes:
 *
 *   oddsDeltas  - just the outcomes whose price moved, per outcome id
 *   livePatches - per-match minute / score / corners / cards / status
 *   matchEvents - the last 50 match-info events
 */

/** the pushed state of one match, already in the client's field names */
export interface LivePatch {
  displayOrder?: number;
  competitionOrder?: number;
  listingStale?: boolean;
  status?: Match['status'];
  currentMinute?: number;
  /** seconds within the current minute (0-59), from the feed clock */
  currentSecond?: number;
  period?: string | null;
  homeScore?: number;
  awayScore?: number;
  scoreAt?: string;
  clockAt?: string | null;
  phaseAt?: string | null;
  snapshotAt?: string;
  /** Optional team names used by the favorites alert view. */
  homeTeam?: string;
  awayTeam?: string;
  corners?: { home: number; away: number } | null;
  cards?: { home: number; away: number } | null;
  shots?: { home: number; away: number } | null;
  shotsOnTarget?: { home: number; away: number } | null;
  fouls?: { home: number; away: number } | null;
  /** how many markets the board currently prices for this match (0 = nothing to bet yet) */
  marketCount?: number;
  isSuspended?: boolean;
  updatedAt: string;
}

interface LiveFeedValue {
  oddsDeltas: Record<string, OddsDelta>;
  livePatches: Record<string, LivePatch>;
  matchEvents: MatchEvent[];
  connected: boolean;
  /**
   * 'live'   the feed is running: prices are fresh and bets are accepted
   * 'idle'   the server paused the feed because nobody was on the board
   * 'waking' it is collecting the first cycle again - the board is rebuilt in a few seconds
   * While this is not 'live' the board shows "odds are being refreshed" instead of an empty
   * list, and a bet would be refused by the server anyway.
   */
  feedMode: FeedMode;
  /** prices the feed has locked right now, keyed exactly like the REST payload ids */
  lockedOutcomes: Record<string, boolean>;
  riskLockedOutcomes: Record<string, boolean>;
  lockedMarkets: Record<string, boolean>;
  lockedMatches: Record<string, boolean>;
  combosEnabled: boolean;
  invalidateSelections: (outcomeIds: string[]) => void;
  /** Changes on a collector snapshot, reconnect or browser resume. */
  refreshVersion: number;
  /** REST and push enter the same timestamp-ordered state. */
  acceptMatches: (matches: Match[]) => void;
}

export type FeedMode = 'live' | 'idle' | 'waking';

const EMPTY: LiveFeedValue = {
  oddsDeltas: {},
  livePatches: {},
  matchEvents: [],
  connected: false,
  feedMode: 'live',
  lockedOutcomes: {},
  riskLockedOutcomes: {},
  lockedMarkets: {},
  lockedMatches: {},
  combosEnabled: true,
  invalidateSelections: () => {},
  refreshVersion: 0,
  acceptMatches: () => {},
};

const LiveFeedContext = createContext<LiveFeedValue>(EMPTY);

/** drops undefined keys, so spreading a patch over a REST match cannot blank a real value */
const compact = <T extends object>(input: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out as T;
};

const counterOf = (stats:any,field:string) => {
  const home=stats?.home?.[field],away=stats?.away?.[field];
  if(home==null&&away==null)return undefined;
  return [home,away].every(value=>typeof value==='number'&&Number.isInteger(value)&&value>=0)?{home:Number(home),away:Number(away)}:null;
};
const cornersOf = (stats:any) => counterOf(stats,'corners');

const cardsOf = (stats: any) => {
  if(!stats?.home&&!stats?.away)return undefined;
  if(['home','away'].every(side=>['yellow','red'].every(field=>stats?.[side]?.[field]===undefined)))return undefined;
  if (!counterOf(stats,'yellow')||!counterOf(stats,'red')) return null;
  const count = (side: any) => side.yellow + side.red;
  return { home: count(stats.home), away: count(stats.away) };
};

export function LiveFeedProvider({ children }: { children: ReactNode }) {
  const outcomeStore=useRef(createOutcomeStore());
  const [oddsDeltas, setOddsDeltas] = useState<Record<string, OddsDelta>>({});
  const [livePatches, setLivePatches] = useState<Record<string, LivePatch>>({});
  const [matchEvents, setMatchEvents] = useState<MatchEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lockedOutcomes, setLockedOutcomes] = useState<Record<string, boolean>>({});
  const [riskLockedOutcomes, setRiskLockedOutcomes] = useState<Record<string, boolean>>({});
  const [lockedMarkets, setLockedMarkets] = useState<Record<string, boolean>>({});
  const [lockedMatches, setLockedMatches] = useState<Record<string, boolean>>({});
  const [feedMode, setFeedMode] = useState<FeedMode>('live');
  const [combosEnabled, setCombosEnabled] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [rejectedOutcomes,setRejectedOutcomes] = useState<Record<string,number>>({});
  const invalidateSelections = useCallback((ids:string[]) => {
    const at=Date.now();
    setRejectedOutcomes(previous=>({...previous,...Object.fromEntries(ids.filter(Boolean).map(id=>[id,at]))}));
  },[]);
  const prevOdds = useRef<Record<string, number>>({});
  const prevOddsAt = useRef<Record<string, number>>({});
  const prevMarketAt = useRef<Record<string, number>>({});
  const prevMatchAt = useRef<Record<string, number>>({});
  const prevRiskAt = useRef<Record<string, number>>({});
  const prevTimelineAt = useRef<Record<string, number>>({});
  const reopenRefresh=useRef<(id:string)=>void>(()=>{});
  const reopenTracker=useRef(createSourceReopenTracker(id=>reopenRefresh.current(id)));
  const knownScores=useRef<Record<string,{score:string;at:number}>>({});
  const observeScore=useCallback((id:string,home:unknown,away:unknown,at:number,notify=true)=>{
    if(typeof home!=='number'||typeof away!=='number'||!Number.isFinite(home)||!Number.isFinite(away)||!at)return;
    const previous=knownScores.current[id];if(previous&&at<previous.at)return;
    const score=home+':'+away;knownScores.current[id]={score,at};
    if(notify&&previous&&previous.score!==score&&hasFeedInterest(id))setRefreshVersion(v=>v+1);
  },[]);

  const acceptMatches = useCallback((matches: Match[]) => {
    // A delayed REST snapshot must not remove an incident already pushed to
    // another tab. Order complete timelines by capture time, like score facts.
    const timelines=matches.filter(match=>{
      if(!Array.isArray(match.events))return false;
      const id=String(match.id),at=snapshotTime(match);
      if(at<(prevTimelineAt.current[id]??0))return false;
      prevTimelineAt.current[id]=at;return true;
    });
    if(timelines.length)setMatchEvents(previous=>{
      const ids=new Set(timelines.map(match=>String(match.id)));
      return [...previous.filter(event=>!ids.has(event.matchId)),...timelines.flatMap(match=>match.events??[])].slice(-500);
    });
    const patches: Record<string, LivePatch> = {};
    const deltas: Record<string, OddsDelta> = {};
    const outcomeLocks: Record<string, boolean> = {}, marketLocks: Record<string, boolean> = {};
    const matchLocks: Record<string, boolean> = {}, riskLocks: Record<string, boolean> = {};
    for (const match of matches) {
      if (!match?.id) continue;
      const at = snapshotTime(match);
      const id = String(match.id);
      observeScore(id,match.homeScore,match.awayScore,timestamp(match.scoreAt),false);
      patches[id] = compact({
        displayOrder: match.displayOrder, competitionOrder: match.competitionOrder, listingStale: match.listingStale,
        status: match.status, currentMinute: match.currentMinute, currentSecond: (match as any).currentSecond,
        homeScore: match.homeScore, awayScore: match.awayScore, scoreAt: match.scoreAt ?? undefined,
        clockAt: match.clockAt, phaseAt: match.phaseAt, snapshotAt: match.snapshotAt, updatedAt: match.updatedAt ?? match.snapshotAt ?? '',
        period: match.period, corners: match.corners, cards: match.cards,
        shots:match.shots,shotsOnTarget:match.shotsOnTarget,fouls:match.fouls,
        marketCount: (match as any).marketCount, isSuspended: match.isSuspended,
        homeTeam: match.homeTeam, awayTeam: match.awayTeam,
      });
      if (at >= (prevMatchAt.current[id] ?? 0)) {
        prevMatchAt.current[id] = at;
        matchLocks[id] = match.isSuspended === true;
        reopenTracker.current.observe(id,'match:'+id,matchLocks[id],at);
      }
      for (const market of match.markets ?? []) {
        if (at >= (prevMarketAt.current[market.id] ?? 0)) {
          prevMarketAt.current[market.id] = at;
          marketLocks[market.id] = market.status === 'SUSPENDED';
          reopenTracker.current.observe(id,'market:'+market.id,marketLocks[market.id],at);
        }
        for (const outcome of market.outcomes ?? []) {
          if (at < (prevOddsAt.current[outcome.id] ?? 0)) continue;
          prevOddsAt.current[outcome.id] = at;
          outcomeLocks[outcome.id] = outcome.feedSuspended ??
            (outcome.status === 'SUSPENDED' && outcome.riskSuspended !== true);
          reopenTracker.current.observe(id,'outcome:'+outcome.id,outcomeLocks[outcome.id],at);
          if (at >= (prevRiskAt.current[outcome.id] ?? 0)) {
            prevRiskAt.current[outcome.id] = at;
            riskLocks[outcome.id] = outcome.riskSuspended === true;
          }
          if (!Number.isFinite(outcome.odds) || outcome.odds < 1) continue;
          prevOdds.current[outcome.id] = outcome.odds;
          deltas[outcome.id] = { outcomeId: outcome.id, newOdds: outcome.odds, at, direction: 'up', changed: false,priceValidUntil:outcome.priceValidUntil,quoteSuspended:outcome.quoteSuspended };
        }
      }
    }
    setLivePatches(previous => {
      const next = { ...previous };
      for (const [id, patch] of Object.entries(patches)) next[id] = mergeMatchFacts(previous[id], patch);
      return next;
    });
    setLockedMatches(previous => ({ ...previous, ...matchLocks }));
    setLockedMarkets(previous => ({ ...previous, ...marketLocks }));
    setLockedOutcomes(previous => ({ ...previous, ...outcomeLocks }));
    setRiskLockedOutcomes(previous => ({ ...previous, ...riskLocks }));
    setOddsDeltas(previous => ({ ...previous, ...deltas }));
    setRejectedOutcomes(previous => {
      const next = { ...previous };
      for (const [id, refusedAt] of Object.entries(previous)) {
        if ((deltas[id]?.at ?? 0) >= refusedAt && outcomeLocks[id] === false) delete next[id];
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const socket: Socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    const unbindScope=bindFeedScope(socket);

    const refresh = () => setRefreshVersion(value => value + 1);
    let reopenTimer:ReturnType<typeof setTimeout>|undefined,lastReopenRefresh=-Infinity;
    const reopenedMatches=new Set<string>();
    reopenRefresh.current=id=>{
      if(!hasDetailFeedInterest(id))return;
      reopenedMatches.add(id);if(reopenTimer)return;
      reopenTimer=setTimeout(()=>{
        reopenTimer=undefined;const interested=[...reopenedMatches].some(hasDetailFeedInterest);reopenedMatches.clear();
        if(interested){lastReopenRefresh=Date.now();refresh();}
      },Math.max(150,3000-(Date.now()-lastReopenRefresh)));
    };
    socket.on('connect', () => { setConnected(true); refresh(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('finance:reset',()=>window.dispatchEvent(new Event('finance:reset')));
    socket.on('board:settings',refresh);socket.on('matches:visibility',refresh);
    const applyPolicy=(data:any)=>{if(Array.isArray(data?.markets)){setCatalogRows(data.markets);setCategoryPolicies(data.categories??[]);setScopeBlocks(data.scopes??[]);refresh();}};
    const readPolicy=()=>fetch('/app/api/market-policy',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(applyPolicy).catch(()=>{});
    socket.on('markets:policy',applyPolicy);socket.on('connect',readPolicy);void readPolicy();
    // Mobile browsers suspend timers and may miss whole collector cycles. Their
    // next foreground view must request a fresh authoritative snapshot.
    const resume = () => { if (document.visibilityState !== 'hidden') refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', refresh);

    // idle mode: the server says when it paused the feed (nobody was on the board) and when it
    // is filling it again, so the board can say "odds are being refreshed" instead of looking
    // broken. `hello` carries the mode on connect, `feed:state` on every change.
    const useMode = (payload: any) => {
      const mode = payload?.mode;
      if (mode === 'live' || mode === 'idle' || mode === 'waking') setFeedMode(mode);
    };
    socket.on('hello', useMode);
    socket.on('meta', useMode);
    socket.on('feed:state', useMode);

    socket.on('odds:update', (payload: { matchId: string | number; markets?: any[] }) => {
      if((payload as any).boardChanged)refresh();
      const incomingAt = Date.parse((payload as any).at) || Date.now();
      const deltas: Record<string, OddsDelta> = {};
      const outcomeLocks: Record<string, boolean> = {};
      const marketLocks: Record<string, boolean> = {};

      for (const market of payload?.markets ?? []) {
        const marketId = `${payload.matchId}|${market.key}|${market.line ?? ''}`;

        for (const outcome of market?.outcomes ?? []) {
          const outcomeId = `${marketId}|${outcome.key}`;
          if (incomingAt < (prevOddsAt.current[outcomeId] ?? 0)) continue;
          prevOddsAt.current[outcomeId] = incomingAt;

          // The feed locks a price around a goal or a dangerous attack: "status":2 arrives as
          // suspended. This is the whole point of using the socket - by REST poll the market
          // stayed open for up to 15s, which is exactly the window nobody may bet in.
          if (outcome?.suspended === true || outcome?.suspended === false) {
            outcomeLocks[outcomeId] = outcome.suspended === true;
            const validPrice=outcome.price!=null&&Number(outcome.price)>1&&Number.isFinite(Number(outcome.price));
            const validUntil=outcome.priceValidUntil;
            const fresh=validPrice&&validUntil!==null&&(validUntil===undefined||(Number.isFinite(validUntil)&&validUntil>=Date.now()));
            reopenTracker.current.observe(String(payload.matchId),'outcome:'+outcomeId,outcome.suspended,incomingAt,true,fresh);
          }

          if (outcome?.price === null || outcome?.price === undefined) continue;
          const rawPrice = Number(outcome.price);
          if (!Number.isFinite(rawPrice) || rawPrice < 1 || rawPrice > 9999999999.9999) continue;
          const next = frozenSelectionPrice(rawPrice);
          const before = prevOdds.current[outcomeId];
          prevOdds.current[outcomeId] = next;
          deltas[outcomeId] = { outcomeId, newOdds: next, direction: before === undefined || next >= before ? 'up' : 'down', at: incomingAt, changed:before !== undefined && before !== next,priceValidUntil:outcome.priceValidUntil,quoteSuspended:outcome.quoteSuspended };
        }

        // only the rows that moved are pushed, so "every row in this frame is suspended" is
        // what a fully locked market looks like over the socket
        const outcomes = market?.outcomes ?? [];
        if (outcomes.length && incomingAt >= (prevMarketAt.current[marketId] ?? 0)) {
          // This is a delta, not the complete market. One suspended line
          // cannot lock every other selection in the market.
          if(outcomes.some((o:any)=>o.suspended===false))marketLocks[marketId]=false;
          if(marketLocks[marketId]===false){
            const fresh=outcomes.some((o:any)=>o.suspended===false&&o.price!=null&&Number(o.price)>1&&Number.isFinite(Number(o.price))&&o.priceValidUntil!==null&&(o.priceValidUntil===undefined||(Number.isFinite(o.priceValidUntil)&&o.priceValidUntil>=Date.now())));
            reopenTracker.current.observe(String(payload.matchId),'market:'+marketId,false,incomingAt,true,fresh);
          }
          prevMarketAt.current[marketId] = incomingAt;
        }
      }

      // React coalesces updates within the current event; no extra timer delays prices.
      if(Object.keys(deltas).length)setOddsDeltas(previous=>{const next={...previous};for(const[id,delta]of Object.entries(deltas))if((delta.at??0)>=(previous[id]?.at??0))next[id]=delta;return next;});
      if (Object.keys(outcomeLocks).length) setLockedOutcomes(prev => ({ ...prev, ...outcomeLocks }));
      if (Object.keys(marketLocks).length) setLockedMarkets(prev => ({ ...prev, ...marketLocks }));
      // Reopen a locally refused choice only after a newer, explicitly active
      // provider price. A mere render or an old REST quote cannot reopen it.
      if (Object.keys(deltas).length) setRejectedOutcomes(previous=> {
        const next={...previous}; let changed=false;
        for(const [id,at] of Object.entries(previous)) if((deltas[id]?.at??0)>=at && outcomeLocks[id]===false) {delete next[id];changed=true;}
        return changed?next:previous;
      });

      // also update the live clock when odds arrive (minute + phase travel with odds:update now)
      const minute = (payload as any).minute;
      const phase = (payload as any).phase;
      if (Number.isFinite(minute) || phase) {
        setLivePatches(prev => ({
          ...prev,
          [String(payload.matchId)]: mergeMatchFacts(prev[String(payload.matchId)], compact({
            currentMinute: Number.isFinite(minute) ? minute : undefined,
            period: phase ?? undefined,
            clockAt: (payload as any).clockAt,
            phaseAt: (payload as any).phaseAt,
            snapshotAt: (payload as any).at,
            updatedAt: (payload as any).at ?? new Date().toISOString(),
          }) as LivePatch),
        }));
      }
    });

    // Reversible server-side risk suspensions (separate from provider locks).
    socket.on('risk:locks', (payload: { locks?: Record<string, boolean>; at?: string }) => {
      if (!payload?.locks || typeof payload.locks !== 'object') return;
      const at = timestamp(payload.at) || Date.now();
      const locks: Record<string, boolean> = {};
      for (const [id, locked] of Object.entries(payload.locks)) {
        if (at < (prevRiskAt.current[id] ?? 0)) continue;
        prevRiskAt.current[id] = at;
        locks[id] = locked;
      }
      setRiskLockedOutcomes(prev => ({ ...prev, ...locks }));
    });
    socket.on('combos:settings', (payload: {enabled?: boolean}) => {
      if (typeof payload?.enabled === 'boolean') setCombosEnabled(payload.enabled);
    });

    // the whole live board, once per collector cycle
    let liveMembership='';
    socket.on('matches:live', (payload: { matches?: any[] }) => {
      useMode(payload); // the first board after a wake also announces the mode
      // List membership also has a 30-second REST fallback. Only a changed
      // live ID set needs an immediate refetch, not every clock snapshot.
      const membership=(payload.matches??[]).map(m=>String(m.id)).sort().join(',');
      if(membership!==liveMembership){liveMembership=membership;refresh();}
      const patches: Record<string, LivePatch> = {};
      for (const m of payload?.matches ?? []) {
        if (!m || m.id === undefined || m.id === null) continue;
        const minute = optionalFeedNumber(m.minute);
        const home = optionalFeedNumber(m?.score?.home);
        const away = optionalFeedNumber(m?.score?.away);
        observeScore(String(m.id),m?.score?.home,m?.score?.away,timestamp(m.scoreAt));
        patches[String(m.id)] = compact({
          displayOrder: m.displayOrder, competitionOrder: m.competitionOrder, listingStale: m.listingStale,
          status: m.status === 'live' ? 'LIVE' : m.status === 'ended' ? 'ENDED' : undefined,
          currentMinute: minute,
          currentSecond: optionalFeedNumber(m.currentSecond),
          marketCount: optionalFeedNumber(m.marketCount),
          period: m.phase,
          homeScore: home,
          awayScore: away,
          scoreAt: typeof m.scoreAt==='string'?m.scoreAt:undefined,
          clockAt: m.clockAt,
          phaseAt: m.phaseAt,
          corners: cornersOf(m.stats),
          cards: cardsOf(m.stats),
          shots:counterOf(m.stats,'shots'),shotsOnTarget:counterOf(m.stats,'shotsOnTarget'),fouls:counterOf(m.stats,'fouls'),
          isSuspended: typeof m.suspended==='boolean'?m.suspended:undefined,
          snapshotAt: m.snapshotAt ?? (payload as any).at,
          updatedAt: m.updatedAt ?? (payload as any).at ?? '',
        }) as LivePatch;
      }
      if (Object.keys(patches).length) {
        setLivePatches(prev => {
          const next = { ...prev };
          for (const [id, patch] of Object.entries(patches)) next[id] = mergeMatchFacts(prev[id], patch);
          return next;
        });
        // the board's own view: a match whose every market is locked
        const matchLocks: Record<string, boolean> = {};
        for (const [id, p] of Object.entries(patches)) {
          if(typeof p.isSuspended!=='boolean')continue;
          const at = snapshotTime(p);
          if (at < (prevMatchAt.current[id] ?? 0)) continue;
          prevMatchAt.current[id] = at;
          matchLocks[id] = p.isSuspended === true;
          reopenTracker.current.observe(id,'match:'+id,matchLocks[id],at,true);
        }
        setLockedMatches(prev => ({ ...prev, ...matchLocks }));
      }
    });

    // one match (score / clock / stats), between poll cycles
    socket.on('match:info', (info: any) => {
      const id = info?.match_id ?? info?.matchId;
      if (id === undefined || id === null) return;

      const at = info.at ?? info.updated_at ?? '';
      const clockAt = info.clock_at ? new Date(info.clock_at).toISOString() : undefined;
      const rawClock = info.match_time_ms ?? info.matchTimeMs;
      const clock = rawClock == null ? NaN : Number(rawClock) +
        (clockAt ? Math.max(0, timestamp(at) - timestamp(clockAt)) : 0);
      const minute = Number.isFinite(clock) ? Math.floor(clock / 60000) : undefined;
      const second = Number.isFinite(clock) ? Math.floor((clock % 60000) / 1000) : undefined;
      const patch = compact({
        status: /finish|ended|\bFT\b|after (?:match|penalt)/i.test(info.feed_status ?? '') ? 'ENDED' : undefined,
        currentMinute: minute,
        currentSecond: second,
        period: info.feed_status ?? undefined,
        homeScore: info.home_score === null || info.home_score === undefined ? undefined : Number(info.home_score),
        awayScore: info.away_score === null || info.away_score === undefined ? undefined : Number(info.away_score),
        scoreAt: info.score_at ? new Date(info.score_at).toISOString() : undefined,
        clockAt,
        phaseAt: info.feed_status_at ? new Date(info.feed_status_at).toISOString() : undefined,
        isSuspended: typeof info.has_open_odds === 'boolean' ? info.has_open_odds === false : undefined,
        corners: cornersOf(info.stats),
        cards: cardsOf(info.stats),
        shots:counterOf(info.stats,'shots'),shotsOnTarget:counterOf(info.stats,'shotsOnTarget'),fouls:counterOf(info.stats,'fouls'),
        snapshotAt: at,
        updatedAt: info.updated_at ? new Date(info.updated_at).toISOString() : at,
      }) as LivePatch;

      const key = String(id);
      observeScore(key,patch.homeScore,patch.awayScore,timestamp(patch.scoreAt));
      // the feed's own "this match has no open odds" flag locks every price on it
      if (typeof info.has_open_odds === 'boolean' && snapshotTime(patch) >= (prevMatchAt.current[key] ?? 0)) {
        prevMatchAt.current[key] = snapshotTime(patch);
        reopenTracker.current.observe(key,'match:'+key,info.has_open_odds===false,snapshotTime(patch),true);
        setLockedMatches(prev => ({ ...prev, [key]: info.has_open_odds === false }));
      }
      setLivePatches(prev => ({ ...prev, [key]: mergeMatchFacts(prev[key], patch) }));
      if(Array.isArray(info.events)&&snapshotTime(patch)>=(prevTimelineAt.current[key]??0)){
        prevTimelineAt.current[key]=snapshotTime(patch);
        setMatchEvents(prev=>[...prev.filter(event=>event.matchId!==key),...info.events.filter((event:any)=>event.matchId===key&&Number.isFinite(event.minute))].slice(-500));
      }
    });

    socket.on('connect_error', (e: Error) => console.warn('[socket] connect_error:', e.message));

    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', refresh);
      if(reopenTimer)clearTimeout(reopenTimer);reopenedMatches.clear();reopenRefresh.current=()=>{};
      unbindScope();socket.close();
    };
  }, []);

  const value = useMemo<LiveFeedValue>(
    () => ({ oddsDeltas, livePatches, matchEvents, connected, feedMode,
      lockedOutcomes:{...lockedOutcomes,...Object.fromEntries(Object.keys(rejectedOutcomes).map(id=>[id,true]))},
      riskLockedOutcomes, lockedMarkets, lockedMatches, combosEnabled, invalidateSelections, refreshVersion, acceptMatches }),
    [oddsDeltas, livePatches, matchEvents, connected, feedMode, lockedOutcomes, riskLockedOutcomes, lockedMarkets, lockedMatches, combosEnabled, rejectedOutcomes,invalidateSelections, refreshVersion, acceptMatches],
  );

  useLayoutEffect(()=>outcomeStore.current.publish(value),[value]);
  return <OutcomeFeedContext.Provider value={outcomeStore.current}><LiveFeedContext.Provider value={value}>{children}</LiveFeedContext.Provider></OutcomeFeedContext.Provider>;
}

export const useLiveFeed = () => useContext(LiveFeedContext);

/** the pushed patch for one match (minute / score / corners / cards), undefined if none yet */
export const useLivePatch = (matchId?: string | number | null): LivePatch | undefined => {
  const { livePatches } = useContext(LiveFeedContext);
  if (matchId === undefined || matchId === null || matchId === '') return undefined;
  return livePatches[String(matchId)];
};
