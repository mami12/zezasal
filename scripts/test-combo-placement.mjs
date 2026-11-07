import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../server/db.mjs';
import { config } from '../server/config.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import { SCHEMA_SQL } from '../server/schema.mjs';
import { placeBet, resolveSelection } from '../server/ledger/bets.mjs';
import { assertLiveBetRisk } from '../server/ledger/bet-risk.mjs';
import { automaticComboTemplates, comboSignature } from '../server/ledger/automatic-combos.mjs';
import { builderId } from '../server/ledger/bet-builders.mjs';
import { gradeLine } from '../server/ledger/settler.mjs';
import { DEFAULT_LIVE_RISK_SETTINGS, liveRiskSettings, setLiveRiskSettings } from '../server/live-risk-settings.mjs';
import * as matches from '../server/match-store.mjs';
import * as odds from '../server/odds-store.mjs';
import * as overrides from '../server/ledger/overrides.mjs';
import { getFeedMode, setFeedMode, FEED_LIVE, FEED_WAKING } from '../server/idle-mode.mjs';

// Exercise the REAL production resolver, risk lock, wallet transaction and SQL.
// The pool is replaced only in this isolated test process; production credentials
// have already been overridden by the fixture before any server module imported.
const sql = new PGlite();
await sql.exec(LEDGER_SQL);
await sql.exec(SCHEMA_SQL);
const original = {
  query: pool.query, connect: pool.connect, settings: structuredClone(liveRiskSettings()),
  matchStore: config.matchStore, oddsStore: config.oddsStore, liveRiskEnabled: config.liveRiskEnabled,
  feedMode: getFeedMode(),
};
let queue = Promise.resolve();
let beforeConnect = null;
let failTicketLine = false;
let transactionActive = false;
pool.query = (text, params) => {
  assert.ok(!(transactionActive && /\b(?:app_bet_builder_template|matches|odds_current)\b/i.test(text)),
    'catalog/feed revalidation under wallet locks must reuse the transaction client instead of borrowing a second pool connection');
  return sql.query(text, params);
};
pool.connect = async () => {
  let release;
  const before = queue;
  queue = new Promise(resolve => { release = resolve; });
  await before;
  try {
    if (beforeConnect) {
      const hook = beforeConnect; beforeConnect = null;
      await hook();
    }
  } catch (error) { release(); throw error; }
  return {
    query: async (text, params) => {
      if (failTicketLine && /insert into app_ticket_line/i.test(text)) {
        failTicketLine = false;
        return Promise.reject(new Error('isolated ticket-line failure'));
      }
      const result = await sql.query(text, params);
      if (/^\s*begin\s*;?\s*$/i.test(text)) transactionActive = true;
      if (/^\s*(?:commit|rollback)\s*;?\s*$/i.test(text)) transactionActive = false;
      return result;
    },
    release,
  };
};
config.matchStore = 'memory';
config.oddsStore = 'memory';
config.liveRiskEnabled = true;
setFeedMode(FEED_LIVE);
const user = { id: randomUUID(), username: 'isolated-combo-player', role: 'PLAYER', status: 'ACTIVE' };
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',
  [user.id, user.username, 'test-only', user.role, 10000]);
const matchId = 941497;
const regularId = `${matchId}|result||1`;
const totalId = `${matchId}|total|2.5|Over`;
const pair = [{market:'1X2',outcome:'1',line:''},{market:'TOTAL',outcome:'Over',line:'2.5'}];
const template = automaticComboTemplates().find(t => comboSignature(t.legs) === comboSignature(pair));
assert.ok(template);
const comboId = builderId(matchId, template.id);
const comboPick = (price = 3.96) => ({outcomeId:comboId, oddsAtPlacement:price});
const rows = () => [
  {matchId, marketKey:'result', marketName:'1X2', line:'', outcomeKey:'1', outcomeName:'1', price:2.2, column:'result'},
  {matchId, marketKey:'result', marketName:'1X2', line:'', outcomeKey:'X', outcomeName:'X', price:3.4, column:'result'},
  {matchId, marketKey:'result', marketName:'1X2', line:'', outcomeKey:'2', outcomeName:'2', price:4.1, column:'result'},
  {matchId, marketKey:'total', marketName:'Total', line:'2.5', outcomeKey:'Over', outcomeName:'Over', price:1.8, column:'total'},
  {matchId, marketKey:'total', marketName:'Total', line:'2.5', outcomeKey:'Under', outcomeName:'Under', price:1.9, column:'total'},
];
const seed = (service = 'PREMATCH') => {
  matches.clear(); odds.clearMatch(matchId);
  matches.upsert([{
    match_id:matchId, sport_id:18, sport_tag:'football', category_slug:'test', category_name:'Test league',
    tournament_id:1, tournament_name:'Test only', home:'Home', away:'Away', service,
    start_at:new Date(Date.now() + (service === 'LIVE' ? -10 : 60)*60000).toISOString(),
    status:service === 'LIVE' ? 'live' : 'scheduled', raw:{},
  }]);
  if (service === 'LIVE') matches.applyInfo({matchId, matchTimeMs:10*60000, homeScore:0, awayScore:0, feedStatus:'First Half'});
  odds.applyRows(rows());
};
const persist = async (patch = {}, {snapshot = true} = {}) => {
  const settings = {...structuredClone(DEFAULT_LIVE_RISK_SETTINGS), ...patch};
  await sql.query('insert into app_live_risk_settings(id,settings) values(1,$1::jsonb) on conflict(id) do update set settings=excluded.settings',
    [JSON.stringify(settings)]);
  if (snapshot) setLiveRiskSettings(settings);
  return settings;
};
const wallet = async () => ({
  balance:Number((await sql.query('select balance from app_user where id=$1',[user.id])).rows[0].balance),
  tickets:Number((await sql.query('select count(*) as n from app_ticket')).rows[0].n),
  transactions:Number((await sql.query('select count(*) as n from app_transaction')).rows[0].n),
});
const request = (selections = [comboPick()], rest = {}) => ({user, stake:100, selections, clientRequestId:randomUUID(), ...rest});
const rejectWithoutMoney = async (fn, expected, detail) => {
  const before = await wallet();
  await assert.rejects(fn, expected, detail);
  assert.deepEqual(await wallet(), before, `${detail ?? 'rejected combo'} must not create tickets or move money`);
};
try {
  await overrides.refresh(true);
  await persist(); seed();
  const resolved = await resolveSelection(comboPick());
  assert.equal(resolved.price, 3.96);
  assert.equal(resolved.builderLegs.length, 2);
  assert.deepEqual(resolved.builderLegs.map(l => [l.market_key, l.outcome_key, l.price]),
    [['result','1',2.2],['total','Over',1.8]]);
  assert.equal(resolved.marketName, 'Bet Builder');

  // Same-game switch is enforced before any LIVE-only early return, and never
  // confuses normal multiple-event COMBO ticket types with builder selections.
  const synthetic = {matchId:String(matchId), marketName:'Bet Builder', builderLegs:resolved.builderLegs};
  for (const enabled of [false, true]) {
    await assert.rejects(assertLiveBetRisk({}, [{stake:100,payout:396,lines:[synthetic]}],
      {...DEFAULT_LIVE_RISK_SETTINGS, enabled, combosEnabled:false}), error => error.code === 'COMBOS_DISABLED');
  }
  await assertLiveBetRisk({}, [{stake:100,payout:220,lines:[{matchId:String(matchId),marketName:'1X2',price:2.2}]}],
    {...DEFAULT_LIVE_RISK_SETTINGS,enabled:false,combosEnabled:false});

  await rejectWithoutMoney(() => placeBet(request([comboPick(3.95)])), error => error.code === 'ODDS_CHANGED' && error.newOdds === 3.96,
    'a changed or tampered synthetic quote needs explicit acceptance');
  const total = odds.getOddsForMatches([matchId]).find(r => r.market_key === 'total' && r.outcome_key === 'Over');
  total.price = 1.81;
  await rejectWithoutMoney(() => placeBet(request()), error => error.code === 'ODDS_CHANGED' && error.newOdds === 3.98,
    'placement recalculates product using current server legs');
  total.price = 1.8;
  total.suspended = true;
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400,
    'a constituent suspended by the provider cannot be sold through a builder');
  total.suspended = false;
  total.updated_at = new Date(Date.now()-2*60*60*1000);
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400,
    'an otherwise active stale constituent blocks the complete combo');
  seed();
  await overrides.upsert('outcome',totalId,{suspended:true});
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400,
    'an admin constituent suspension blocks the complete combo');
  await overrides.clear('outcome',totalId);
  await overrides.upsert('match',String(matchId),{suspended:true});
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400, 'an admin match suspension blocks the combo');
  await overrides.clear('match',String(matchId));

  odds.clearMatch(matchId);
  odds.applyRows(rows().filter(r => r.marketKey !== 'total'));
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400, 'a missing required total market blocks the combo');
  seed();
  setFeedMode(FEED_WAKING);
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400, 'a warming feed cannot sell synthetic quotes');
  setFeedMode(FEED_LIVE);
  const tooHigh = odds.getOddsForMatches([matchId]);
  tooHigh.find(r => r.market_key === 'result' && r.outcome_key === '1').price = 40;
  tooHigh.find(r => r.market_key === 'total' && r.outcome_key === 'Over').price = 30;
  await rejectWithoutMoney(() => placeBet(request([comboPick(1200)])), error => error.status === 400,
    'server placement enforces the same product cap as the offer');
  seed();

  for (const service of ['PREMATCH','LIVE']) {
    seed(service);
    await persist({enabled:false,combosEnabled:false});
    await rejectWithoutMoney(() => placeBet(request()), error => error.code === 'COMBOS_DISABLED',
      `global OFF blocks ${service} even when LIVE risk is off`);
    await persist({enabled:false,combosEnabled:true});
    beforeConnect = () => persist({enabled:false,combosEnabled:false},{snapshot:false});
    await rejectWithoutMoney(() => placeBet(request()), error => error.code === 'COMBOS_DISABLED',
      'the locked database setting closes a disable/place race after quote resolution');
  }
  seed();
  odds.applyRows([{matchId,marketKey:'native-combo',marketName:'Result and Total',line:'',
    outcomeKey:'1&O2.5',outcomeName:'Home And Over 2.5',price:3.5,column:'other'}]);
  const nativePick = {outcomeId:`${matchId}|native-combo||1&O2.5`,oddsAtPlacement:3.5};
  await persist({enabled:false,combosEnabled:false});
  await rejectWithoutMoney(() => placeBet(request([nativePick])), error => error.code === 'COMBOS_DISABLED',
    'global OFF also blocks provider-native same-game combos');
  await persist({enabled:false,combosEnabled:true});
  await persist({enabled:false,combosEnabled:false},{snapshot:false});
  await rejectWithoutMoney(() => placeBet(request([nativePick])), error => error.code === 'COMBOS_DISABLED',
    'the locked switch also protects native combos when the process snapshot is stale');
  for (const [index,alias] of ['Winner and Both Teams to Score','Result / BTTS','Result and Both Score','Result with BTTS'].entries()) {
    const key = `native-btts-alias-${index}`;
    odds.applyRows([{matchId,marketKey:key,marketName:alias,line:'',outcomeKey:'1&Yes',outcomeName:'Home And Yes',price:3.5,column:'other'}]);
    const pick = {outcomeId:`${matchId}|${key}||1&Yes`,oddsAtPlacement:3.5};
    await persist({enabled:false,combosEnabled:false});
    await rejectWithoutMoney(() => placeBet(request([pick])), error => error.code === 'COMBOS_DISABLED',
      `global OFF blocks the supported native alias ${alias}`);
    await persist({enabled:false,combosEnabled:true});
    await persist({enabled:false,combosEnabled:false},{snapshot:false});
    await rejectWithoutMoney(() => placeBet(request([pick])), error => error.code === 'COMBOS_DISABLED',
      `locked OFF blocks the supported native alias ${alias} when snapshot is stale`);
  }

  seed('LIVE'); await persist();
  matches.applyInfo({matchId,matchTimeMs:20*60000,homeScore:2,awayScore:1,feedStatus:'First Half'});
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400,
    'LIVE score evidence prunes a completed total during actual placement');
  // Both legs remain individually possible, but their combination cannot win:
  // at 1-2, a home win needs at least two more goals while Under3.5 needs none.
  seed('LIVE');await persist();
  matches.applyInfo({matchId,matchTimeMs:30*60000,homeScore:1,awayScore:2,feedStatus:'First Half'});
  odds.applyRows([
    {matchId,marketKey:'total35',marketName:'Total',line:'3.5',outcomeKey:'Under',outcomeName:'Under',price:1.9,column:'total'},
    {matchId,marketKey:'native-impossible',marketName:'Result and Total Goals',line:'3.5',outcomeKey:'1&U3.5',outcomeName:'Home And Under 3.5',price:3.5,column:'other'},
  ]);
  const impossiblePair=[{market:'1X2',outcome:'1',line:''},{market:'TOTAL',outcome:'Under',line:'3.5'}];
  const impossibleTemplate=automaticComboTemplates().find(t=>comboSignature(t.legs)===comboSignature(impossiblePair));
  assert.ok(impossibleTemplate);
  const impossibleBuilder=builderId(matchId,impossibleTemplate.id);
  await rejectWithoutMoney(()=>placeBet(request([{outcomeId:impossibleBuilder,oddsAtPlacement:4.18}])),
    error=>error.code==='MARKET_DECIDED'&&error.outcomeId===impossibleBuilder,
    'synthetic home+Under3.5 at 1-2 is rejected before any funds move');
  const impossibleNative=`${matchId}|native-impossible|3.5|1&U3.5`;
  await rejectWithoutMoney(()=>placeBet(request([{outcomeId:impossibleNative,oddsAtPlacement:3.5}])),
    error=>error.code==='MARKET_DECIDED'&&error.outcomeId===impossibleNative,
    'native home+Under3.5 at 1-2 is rejected before any funds move');
  seed('LIVE');
  matches.applyInfo({matchId,matchTimeMs:90*60000,homeScore:0,awayScore:0,feedStatus:'Second Half'});
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400,
    'LIVE risk suspension of an underlying result blocks its synthetic combo');

  seed(); await persist();
  beforeConnect = () => {
    const current = odds.getOddsForMatches([matchId]);
    current.find(r => r.market_key === 'result' && r.outcome_key === '1').price = 3.3;
    current.find(r => r.market_key === 'total' && r.outcome_key === 'Over').price = 1.2;
  };
  await rejectWithoutMoney(() => placeBet(request()),
    error => error.code === 'ODDS_CHANGED' && error.oldOdds === 3.96 && error.newOdds === 3.96,
    'wallet-lock revalidation detects changed constituent prices even when their product is unchanged');
  seed();
  beforeConnect = () => {
    odds.getOddsForMatches([matchId]).find(r => r.market_key === 'total' && r.outcome_key === 'Over').suspended = true;
  };
  await rejectWithoutMoney(() => placeBet(request()), error => error.status === 400,
    'a constituent suspension while waiting for wallet locks blocks the placement');
  seed();
  await rejectWithoutMoney(() => placeBet(request([
    {outcomeId:regularId,oddsAtPlacement:2.2}, {outcomeId:totalId,oddsAtPlacement:1.8},
  ])), error => error.status === 400,
    'ordinary tickets cannot multiply two correlated selections from the same event');
  const successful = request();
  const ticket = await placeBet(successful);
  assert.equal(ticket.stake,100); assert.equal(ticket.totalOdds,3.96); assert.equal(ticket.potentialPayout,396);
  assert.equal(ticket.lines.length,1); assert.equal(ticket.lines[0].oddsAtPlacement,3.96);
  assert.deepEqual(await wallet(), {balance:9900,tickets:1,transactions:1});
  const savedLine = (await sql.query('select * from app_ticket_line where ticket_id=$1',[ticket.id])).rows[0];
  assert.equal(savedLine.builder_legs.length,2);
  assert.deepEqual(savedLine.builder_legs.map(l => [l.market_key,l.outcome_key,l.price]),
    [['result','1',2.2],['total','Over',1.8]]);
  assert.equal(Number(savedLine.odds_at_placement),3.96);
  const final = (home,away) => ({home_score:home,away_score:away,home_team:'Home',away_team:'Away'});
  assert.equal(gradeLine(savedLine,final(3,0)),'WON');
  assert.equal(gradeLine(savedLine,final(2,0)),'LOST');
  assert.equal(gradeLine(savedLine,final(0,3)),'LOST');
  assert.equal(gradeLine({...savedLine,builder_legs:[savedLine.builder_legs[0],{...savedLine.builder_legs[1],market_name:'Unrecognized contract'}]},final(3,0)),'VOID');

  // A network retry must return its already paid ticket, even when quotes or
  // settings changed subsequently. It must never debit the wallet a second time.
  await persist({combosEnabled:false});
  const frozen = await placeBet(successful);
  assert.equal(frozen.id,ticket.id);
  assert.deepEqual(await wallet(), {balance:9900,tickets:1,transactions:1});
  await persist();
  await rejectWithoutMoney(() => placeBet({...successful,stake:200}), error => error.status === 409,
    'reusing an idempotency key for another stake is rejected');
  failTicketLine = true;
  await rejectWithoutMoney(() => placeBet(request()), /isolated ticket-line failure/,
    'SQL failure rolls back all ticket and wallet changes');

  // Global combo OFF must leave a genuine multi-match accumulator available.
  await persist({enabled:false,combosEnabled:false});
  const secondId = matchId+1;
  matches.upsert([{...matches.getById(matchId),match_id:secondId,home:'Second home',away:'Second away'}]);
  odds.clearMatch(secondId);
  odds.applyRows([{...rows()[0],matchId:secondId,price:3}]);
  const accumulator = await placeBet(request([
    {outcomeId:regularId,oddsAtPlacement:2.2},
    {outcomeId:`${secondId}|result||1`,oddsAtPlacement:3},
  ]));
  assert.equal(accumulator.ticketType,'COMBO'); assert.equal(accumulator.totalOdds,6.6);
  assert.equal(accumulator.lines.length,2);
  assert.deepEqual(await wallet(), {balance:9800,tickets:2,transactions:2});
  odds.clearMatch(secondId);
  await persist(); seed();
  const parallelRequest = request();
  const parallel = await Promise.all([placeBet(parallelRequest),placeBet(parallelRequest)]);
  assert.equal(parallel[0].id,parallel[1].id,'simultaneous retry returns one committed combo ticket');
  assert.deepEqual(await wallet(), {balance:9700,tickets:3,transactions:3},
    'simultaneous retry debits exactly once and creates one money movement');

  // The rollback/compatibility modes may store both matches and odds in SQL.
  // Validate the production path there too, including its locked risk read,
  // without borrowing another connection while the wallet transaction is open.
  seed('LIVE');
  const rawMatch = matches.getById(matchId);
  const matchColumns = ['match_id','sport_id','sport_tag','category_slug','category_name','tournament_id','tournament_name',
    'home','away','service','start_at','status','home_score','away_score','score_at','match_time_ms','clock_at','feed_status'];
  await sql.query(`insert into matches(${matchColumns.join(',')}) values(${matchColumns.map((_,i)=>'$'+(i+1)).join(',')})`,
    matchColumns.map(key=>rawMatch[key]));
  const oddsColumns = ['match_id','market_key','market_name','line','outcome_key','outcome_name','price','suspended','updated_at',
    'is_base','grp_order','period','board_column'];
  for (const row of odds.getOddsForMatches([matchId])) {
    await sql.query(`insert into odds_current(${oddsColumns.join(',')}) values(${oddsColumns.map((_,i)=>'$'+(i+1)).join(',')})`,
      oddsColumns.map(key=>row[key]));
  }
  config.matchStore = 'db'; config.oddsStore = 'db';
  const databaseTicket = await placeBet(request());
  assert.equal(databaseTicket.totalOdds,3.96);
  assert.equal(databaseTicket.lines.length,1);
  assert.deepEqual(await wallet(), {balance:9600,tickets:4,transactions:4});
  console.log('PASS real combo placement: server leg/product resolution, odds acceptance, suspension/staleness/missing market, disable race under DB lock, LIVE expiry/risk, atomic wallet SQL, frozen settlement, idempotency and ordinary accumulator preservation');
} finally {
  beforeConnect = null;
  pool.query = original.query; pool.connect = original.connect;
  config.matchStore = original.matchStore; config.oddsStore = original.oddsStore;
  config.liveRiskEnabled = original.liveRiskEnabled;
  setFeedMode(original.feedMode); setLiveRiskSettings(original.settings);
  matches.clear(); odds.clearMatch(matchId);
  await sql.close();
  await pool.end();
}
