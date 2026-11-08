/**
 * Regression: a result with first-half scores used to supply 11 values to
 * a SQL INSERT with nine placeholders. Every settlement pass failed and
 * finished players' tickets remained PENDING.
 *
 * Pure assertions and disposable local PostgreSQL tests. Never live balances.
 */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalPool } from '../server/local-database.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';

process.env.DB_DRIVER = 'postgres';
const { isFinished, FINISHED_RESULT_INSERT, finishedResultParameters, verifiedFirstHalf, archiveFinishedMatch, unsettledMatchIds } = await import('../server/ledger/results.mjs');
const { isStillOnBoard, gradeLine, hasRequiredSettlementEvidence, settleAll, recalcTicket } = await import('../server/ledger/settler.mjs');
const { playerBetStatuses } = await import('../server/ledger/bet-history.mjs');
const { pool } = await import('../server/db.mjs');

const scoreAt = new Date().toISOString();
const fulltime = {
  match_id: 123, service: 'LIVE', status: 'ended', feed_status: 'FT',
  score_at: scoreAt, home_score: 2, away_score: 1,
  home: 'Home', away: 'Away',
  periods_score: [{t1:1,t2:0},{t1:1,t2:1}],
  stats: {
    home: {corners:6,yellow:2,red:0},
    away: {corners:4,yellow:1,red:0},
  },
};

assert.equal(isFinished(fulltime), true);
assert.equal(isFinished({...fulltime,status:'live',feed_status:'1H'}), false,
  'do not settle live matches just because a timer passed 110 minutes');
assert.equal(isFinished({...fulltime,service:'PREMATCH'}), true,
  'verified final score outranks a stale PREMATCH catalogue classification');
assert.equal(isFinished({...fulltime,service:'PREMATCH',feed_status:null}), false);
assert.equal(isFinished({...fulltime,service:'PREMATCH',score_at:null,home_score:0,away_score:0}), false,
  'default prematch scores and a missing provider score timestamp prove nothing');
assert.equal(isFinished({...fulltime,score_at:null}), false,
  'never settle a default-score placeholder');
assert.equal(isFinished({...fulltime,home_score:null}), false);
assert.equal(isFinished({...fulltime,home_score:-1}), false);
assert.equal(isFinished({...fulltime,status:'live',feed_status:'full time'}), true,
  'explicit provider full-time signal should close the match');
assert.equal(isFinished({...fulltime,status:'ended',feed_status:'1H'}), false,
  'collector expiry or inferred kickoff end is never valid settlement evidence');
assert.equal(isFinished({...fulltime,status:'ended',feed_status:null}), false,
  'memory eviction cannot prove the final score');
assert.equal(isFinished({...fulltime,status:'live',feed_status:'FT'}), true);
assert.deepEqual(verifiedFirstHalf(fulltime.periods_score),{home:1,away:0});

const params = finishedResultParameters(fulltime);
const matches = [...FINISHED_RESULT_INSERT.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]));
const maxPlaceholder = Math.max(...matches);
assert.equal(maxPlaceholder,12,'all stored match+half statistics must have placeholders');
assert.equal(new Set(matches).size,12,'no skipped parameter indexes');
assert.equal(params.length,maxPlaceholder,'PostgreSQL bind count must match SQL');
assert.deepEqual(params,[123,'Home','Away',2,1,6,4,2,1,1,0,'{}']);
assert.match(FINISHED_RESULT_INSERT,/half_home_score\s*=\s*coalesce\(/i);
assert.match(FINISHED_RESULT_INSERT,/half_away_score\s*=\s*coalesce\(/i);

const withoutStats = finishedResultParameters({...fulltime,stats:null,periods_score:null});
assert.equal(withoutStats.length,12);
assert.deepEqual(withoutStats.slice(5),[null,null,null,null,null,null,'{}']);

// Provider actual push stats are keyed by competitor ID, not home/away.
const idStats = finishedResultParameters({
  ...fulltime,
  raw: { homeTeam: { id: 100 }, awayTeam: { id: 200 } },
  stats: { '100': { corners: 6, yellow: 2, red: 0 },
           '200': { corners: 4, yellow: 1, red: 0 } },
});
assert.deepEqual(idStats, params, 'real feed-shaped stats must settle corners/cards');

const resolved = { home_team:'Home', away_team:'Away', home_score:2, away_score:1,
  half_home_score:1, half_away_score:0, corners_home:6, corners_away:4,
  cards_home:2, cards_away:1 };
const firstHalfTotal = {market_name:'1st half. Total',outcome_key:'Over',outcome_name:'Over',
  line:'1.5', builder_legs:null};
assert.equal(gradeLine(firstHalfTotal, resolved),'LOST',
  'one first-half goal is NOT Over 1.5 even if full-time goals exceed it');
assert.equal(gradeLine({...firstHalfTotal,outcome_key:'Under',outcome_name:'Under'},resolved),'WON');
assert.equal(gradeLine({...firstHalfTotal,market_name:'Full time Total'},resolved),'WON');
assert.equal(gradeLine({...firstHalfTotal,market_name:'1st half. Total'},{
  ...resolved,half_home_score:null,half_away_score:null,
}), null, 'missing half-time facts stay PENDING; they cannot use full-time totals');
assert.equal(hasRequiredSettlementEvidence(firstHalfTotal,resolved),true);
assert.equal(hasRequiredSettlementEvidence(firstHalfTotal,{...resolved,half_home_score:null}),false,
  'wait for authoritative half-time score before grading');
assert.equal(hasRequiredSettlementEvidence({market_name:'Corners. Total'},{
  ...resolved,corners_home:null}),false);
assert.equal(hasRequiredSettlementEvidence({market_name:'Total Cards'},{
  ...resolved,cards_away:null}),false);
for(const unsafe of ['Home team total cards','Away team total cards','1st half total cards',
 '2nd half total cards','Home team exact corners','Away team exact corners',
 '1st half exact corners','Home team exact goals',
 'Inter Milan exact corners','Inter Milan exact goals']){
 const line={market_name:unsafe,line:'2.5',outcome_key:'Over',outcome_name:'Over',builder_legs:null};
 assert.equal(hasRequiredSettlementEvidence(line,resolved),false,unsafe+' cannot use full-match totals');
 assert.equal(gradeLine(line,resolved),null,unsafe+' cannot pay from unrelated totals');
}
const verifiedGlobalCards={market_name:'Total Cards',line:'2.5',outcome_key:'Over',
 outcome_name:'Over',builder_legs:null};
assert.equal(gradeLine(verifiedGlobalCards,resolved),'WON',
 'Full-time total cards still uses the verified full-match card count');

assert.equal(hasRequiredSettlementEvidence({market_name:'Full time result (Early payout 1:0)'},resolved),false,
  'early payout cannot be graded solely from final score');
assert.equal(hasRequiredSettlementEvidence({market_name:'Full time result'},resolved),true);
assert.equal(hasRequiredSettlementEvidence({builder_legs:[
  {market_name:'Full time result'},firstHalfTotal,
]}, {...resolved,half_home_score:null}), false);
assert.match(FINISHED_RESULT_INSERT,/where app_match_result.source = 'FEED'/);
assert.match(LEDGER_SQL,/add column if not exists source text/);

// Inactive match rows remain retrievable by ID. They are no longer
// "on the board" and may be refunded after the existing 72h limit.
assert.equal(isStillOnBoard({active:true,status:'live'}),true);
assert.equal(isStillOnBoard({active:false,status:'ended'}),false);
assert.equal(isStillOnBoard({active:true,status:'ended'}),false);
assert.equal(isStillOnBoard(null),false);
const observedAt = Date.parse('2026-10-18T15:00:00Z');
assert.equal(isStillOnBoard({
  active:true,status:'live',start_at:'2026-10-15T12:00:00Z',
},observedAt),false,'a three-day stale provider LIVE row cannot freeze the 72h review forever');
assert.equal(isStillOnBoard({
  active:true,status:'live',start_at:'2026-10-18T12:00:00Z',
},observedAt),true);


for(const filter of ['ALL','WON','LOST','PENDING','CANCELLED','REJECTED']) {
  assert.equal(playerBetStatuses(filter).key,filter);
}
assert.deepEqual(playerBetStatuses('CANCELLED').statuses,['CANCELLED','REVERTED','VOID']);
assert.deepEqual(playerBetStatuses('REJECTED').statuses,[]);
assert.throws(()=>playerBetStatuses('WHATEVER'),e=>e.status===400);
assert.match(LEDGER_SQL,/create table if not exists app_bet_rejection\s*\(/i);
assert.match(LEDGER_SQL,/create unique index if not exists app_bet_rejection_idempotency_idx/i);

const temporaryRoot = fileURLToPath(new URL('../tmp/', import.meta.url));
await mkdir(temporaryRoot, { recursive: true });
const temporary = await mkdtemp(join(temporaryRoot, 'settlement-recovery-'));
const local = createLocalPool({ dataDir: join(temporary, 'database') });
const originalQuery = pool.query, originalConnect = pool.connect;
let injectedFailures = 0;
const expectedErrors = [], originalError = console.error;
try {
  pool.query = (...args) => local.query(...args);
  pool.connect = async () => {
    const client = await local.connect(), runQuery = client.query;
    client.query = (text, params) => {
      if (injectedFailures > 0 && /update app_ticket set status\s*=/.test(String(text))) {
        injectedFailures--;
        return Promise.reject(Object.assign(new Error('test: interrupted ticket payment'), { code: '08006' }));
      }
      return runQuery(text, params);
    };
    return client;
  };
  await local.query(LEDGER_SQL);
  const userId = randomUUID();
  await local.query("insert into app_user(id,username,password_hash,balance) values($1,'isolated-settlement','test-only',1000)", [userId]);
  const makeTicket = async (matchId, marketName = 'Full Time Result') => {
    const id = randomUUID();
    await local.query("insert into app_ticket(id,user_id,stake,total_odds,potential_payout,status) values($1,$2,100,2,200,'PENDING')", [id, userId]);
    await local.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,$2,'result','1','Home',$3,'Home vs Away',2,'PENDING')", [id, matchId, marketName]);
    return id;
  };
  await archiveFinishedMatch({ ...fulltime, match_id: 9000 });
  const interrupted = await makeTicket(9000);
  injectedFailures = 2; // Both initial close and same-pass recovery fail.
  console.error = (...args) => {
    if (args.join(' ').includes('test: interrupted ticket payment')) expectedErrors.push(args.join(' '));
    else originalError(...args);
  };
  await settleAll();
  assert.equal(expectedErrors.length, 2);
  assert.equal((await local.query('select status from app_ticket_line where ticket_id=$1', [interrupted])).rows[0].status, 'WON', 'Line grading committed before the interrupted payout.');
  assert.equal((await local.query('select status from app_ticket where id=$1', [interrupted])).rows[0].status, 'PENDING');
  assert.equal((await local.query('select balance from app_user where id=$1', [userId])).rows[0].balance, 1000, 'Failed payment rolls back its money movements.');
  const repaired = await settleAll();
  assert.equal(repaired.recovered, 1, 'Next pass retries resolved pending tickets independently of pending lines.');
  assert.equal((await local.query('select status from app_ticket where id=$1', [interrupted])).rows[0].status, 'WON');
  assert.equal((await local.query('select balance from app_user where id=$1', [userId])).rows[0].balance, 1200);
  assert.ok((await local.query('select settled_at from app_match_result where match_id=9000')).rows[0].settled_at,
    'Recovered payment atomically freezes its accepted final result.');
  assert.equal((await archiveFinishedMatch({ ...fulltime, match_id: 9000, home_score: 4 })).recorded, false,
    'A conflicting later provider score cannot replace the result already paid.');
  await settleAll(); await recalcTicket(interrupted);
  assert.equal((await local.query("select count(*) as count from app_transaction where reference_id=$1 and type='BET_WON'", [interrupted])).rows[0].count, 1, 'Retries never duplicate the payout.');

  // A lost leg closes an accumulator even when another match has not finished.
  // A failed close is retried without creating a payout or duplicate settlement.
  const earlyLostTicket = randomUUID();
  await local.query("insert into app_ticket(id,user_id,stake,total_odds,potential_payout,ticket_type,status) values($1,$2,50,4,200,'COMBO','PENDING')",
    [earlyLostTicket,userId]);
  await local.query(`insert into app_ticket_line
    (ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status)
    values ($1,9191,'result','1','Home','Full Time Result','First',2,'LOST'),
           ($1,9192,'result','1','Home','Full Time Result','Second',2,'PENDING')`,[earlyLostTicket]);
  injectedFailures=1;
  await assert.rejects(recalcTicket(earlyLostTicket),/interrupted ticket payment/);
  assert.equal((await local.query('select status from app_ticket where id=$1',[earlyLostTicket])).rows[0].status,'PENDING');
  const earlyRecovered=await settleAll();
  assert.equal(earlyRecovered.recovered,1,'An interrupted loss with pending matches must be recovered.');
  assert.equal((await local.query('select status from app_ticket where id=$1',[earlyLostTicket])).rows[0].status,'LOST');
  assert.equal((await local.query("select status from app_ticket_line where ticket_id=$1 and match_id=9192",[earlyLostTicket])).rows[0].status,'PENDING',
    'Other match lines retain their accurate in-progress state.');
  assert.equal(Number((await local.query('select balance from app_user where id=$1',[userId])).rows[0].balance),1200,
    'An early loss must not credit the player.');
  assert.equal(await recalcTicket(earlyLostTicket),null,'A finalized loss cannot be closed twice.');

  // More than the old 200-match cap lack corner evidence. A gradeable later
  // result must still be reached in the same pass, without voiding the others.
  await local.query("insert into app_match_result(match_id,home_team,away_team,home_score,away_score) select n,'Home','Away',2,1 from generate_series(1000,1204) as n");
  const waitingTickets = (await local.query("insert into app_ticket(user_id,stake,total_odds,potential_payout,status) select $1,100,2,200,'PENDING' from generate_series(1,205) returning id", [userId])).rows.map(row => row.id);
  await local.query(`insert into app_ticket_line(ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status)
    select id,1000+row_number() over(order by id)-1,'corners','2.5','Over','Over','Corners Total','Home vs Away',2,'PENDING'
    from app_ticket where id=any($1::uuid[])`, [waitingTickets]);
  await archiveFinishedMatch({ ...fulltime, match_id: 999999 });
  const later = await makeTicket(999999);
  assert.equal((await unsettledMatchIds()).length, 206);
  await settleAll();
  assert.equal((await local.query('select status from app_ticket where id=$1', [later])).rows[0].status, 'WON');
  assert.equal((await local.query("select count(*) as count from app_ticket where id=any($1::uuid[]) and status='PENDING'", [waitingTickets])).rows[0].count, 205, 'Missing statistics stay pending rather than being guessed or wrongly refunded.');
  assert.equal((await local.query('select balance from app_user where id=$1', [userId])).rows[0].balance, 1400);
  const staleCatalogueFinal = await archiveFinishedMatch({ ...fulltime, match_id: 800000, service: 'PREMATCH' });
  assert.equal(staleCatalogueFinal.recorded, true);
  assert.equal((await archiveFinishedMatch({ ...fulltime, match_id: 800001, service: 'PREMATCH', score_at: null, home_score: 0, away_score: 0 })).recorded, false);
  assert.equal((await local.query('select count(*) as count from app_match_result where match_id=800001')).rows[0].count, 0);
  console.log('Automatic settlement: verified final scores, interrupted-payment recovery, idempotent payouts, >200-match fairness, refunds and status filters passed.');
} finally {
  console.error = originalError;
  pool.query = originalQuery; pool.connect = originalConnect;
  await local.end(); await pool.end();
  assert.ok(resolve(temporary).startsWith(resolve(temporaryRoot) + '\\') || resolve(temporary).startsWith(resolve(temporaryRoot) + '/'));
  await rm(temporary, { recursive: true, force: true });
}
