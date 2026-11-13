import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pool} from '../server/db.mjs';
import {config} from '../server/config.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {SCHEMA_SQL} from '../server/schema.mjs';
import {resolveSelection,placeBet} from '../server/ledger/bets.mjs';
import {gradeLine,hasRequiredSettlementEvidence,recalcTicket} from '../server/ledger/settler.mjs';
import {refreshMarketCatalog} from '../server/ledger/market-catalog-store.mjs';
import {refreshLiveRiskSettings} from '../server/ledger/live-risk-store.mjs';
import {reviewReason} from '../server/ledger/manual-review-queue.mjs';
import {gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';
import {DEFAULT_LIVE_RISK_SETTINGS,setLiveRiskSettings,liveRiskSettings} from '../server/live-risk-settings.mjs';
import {setFeedMode,getFeedMode,FEED_LIVE} from '../server/idle-mode.mjs';
import * as matches from '../server/match-store.mjs';
import * as odds from '../server/odds-store.mjs';
import * as overrides from '../server/ledger/overrides.mjs';

// Isolated SQL and in-memory offer source; no public Zizobet request or real wallet.
const db=new PGlite();
await db.exec(LEDGER_SQL);
await db.exec(SCHEMA_SQL);
const original={query:pool.query,connect:pool.connect,matchStore:config.matchStore,
  oddsStore:config.oddsStore,liveRiskEnabled:config.liveRiskEnabled,
  settings:structuredClone(liveRiskSettings()),feedMode:getFeedMode()};
pool.query=(sql,args)=>db.query(sql,args);
pool.connect=async()=>({query:(sql,args)=>db.query(sql,args),release(){}});
config.matchStore='memory';
config.oddsStore='memory';
config.liveRiskEnabled=false;
setLiveRiskSettings({...DEFAULT_LIVE_RISK_SETTINGS,enabled:false});
setFeedMode(FEED_LIVE);

const matchId=8000075149063;
const make=(marketId,marketName,outcomeName,line='',extra={})=>{
  const params={},key='zz'+marketId+'@'+Buffer.from(JSON.stringify(params)).toString('base64url');
  const outcomeKey='z'+marketId;
  return {matchId,marketKey:key,marketName,line,outcomeKey,outcomeName,
    providerId:'ZIZOBET',nativeMarketId:String(marketId),
    nativeOutcomeId:String(marketId),nativeMarketName:marketName,
    nativeOutcomeName:outcomeName,nativeParameters:params,
    price:2.2,column:'other',...extra};
};
const quoted=[
 make(999111,'Undocumented Provider Special','Option A'),
 make(999112,'Anytime Goalscorer','Player X'),
 make(999113,'Total corners in minutes 11-20 (10-minute interval)','Over','0.5'),
 make(999114,'Next Goal','1'),
 make(999115,'1X2 + BTTS','1 & Yes'),
 make(999120,'Silva, Bernardo - Shots on goal (incl. extra time)','Over','0.5')
];
const id=row=>[matchId,row.marketKey,row.line,row.outcomeKey].join('|');
try{
  const isolatedDatabase={query:(sql,args)=>db.query(sql,args)};
  await refreshMarketCatalog({initialize:true,database:isolatedDatabase});
  await refreshLiveRiskSettings({initialize:true,database:isolatedDatabase});
  setLiveRiskSettings({...DEFAULT_LIVE_RISK_SETTINGS,enabled:false});
  await overrides.refresh(true);
  matches.clear();
  matches.upsert([{
    match_id:matchId,sport_id:18,sport_tag:'football',category_slug:'test',
    category_name:'Isolated test',tournament_id:1,tournament_name:'Isolated test',
    home:'Home',away:'Away',service:'PREMATCH',is_real:true,
    start_at:new Date(Date.now()+3600000).toISOString(),
    status:'scheduled',raw:{provider:'ZIZOBET',nativeId:75149063}
  }]);
  odds.applyRows(quoted);
  await assert.rejects(resolveSelection({outcomeId:id(quoted[5]),oddsAtPlacement:2.2}),
    error=>error?.code==='MARKET_NOT_OFFERED',
    'An old cached retired Zizobet player quote must never pass wallet validation');
  const unknown=await resolveSelection({outcomeId:id(quoted[0]),oddsAtPlacement:2.2});
  assert.equal(unknown.settlementHold,'NATIVE_FINAL_RULE_UNMAPPED');
  assert.equal(unknown.liveContract,null);
  const scorer=await resolveSelection({outcomeId:id(quoted[1]),oddsAtPlacement:2.2});
  assert.equal(scorer.settlementHold,null);
  assert.equal(scorer.liveContract?.kind,'player-goal');
  assert.equal(scorer.liveContract?.playerName,'Player X');
  const interval=await resolveSelection({outcomeId:id(quoted[2]),oddsAtPlacement:2.2});
  assert.equal(interval.liveContract?.kind,'window-total');
  assert.equal(interval.liveContract?.event,'corner');
  const next=await resolveSelection({outcomeId:id(quoted[3]),oddsAtPlacement:2.2});
  assert.equal(next.liveContract?.kind,'sequence');
  assert.equal(next.liveContract?.target,1);
  const combined=await resolveSelection({outcomeId:id(quoted[4]),oddsAtPlacement:2.2});
  assert.equal(combined.price,2.2,'A native combo uses its own quoted price');
  assert.equal(combined.settlementHold,null,'A recognized provider combo has a settlement rule');
  const comboLine={market_name:combined.marketName,outcome_name:combined.outcomeName,
    outcome_key:combined.outcomeKey,line:combined.line,period:combined.providerPeriod,builder_legs:null};
  const finalHome={home_team:'Home',away_team:'Away',home_score:2,away_score:1};
  assert.equal(gradeLine(comboLine,finalHome),'WON',
    'The full native combo must satisfy both 1X2 and BTTS');
  assert.equal(gradeLine(comboLine,{...finalHome,home_score:1,away_score:0}),'LOST',
    'The combo is not a win if only the 1X2 leg succeeds');

  // Test 1: No LIVE counters/history may veto a future PREMATCH provider
  // quote for an exact numbered goal in an advertised minute interval.
  const prematchGoal=make(999116,'Who scores goal 1 in minutes 6-10','1');
  odds.applyRows([prematchGoal]);
  const firstGoalWindow=await resolveSelection({outcomeId:id(prematchGoal),oddsAtPlacement:2.2});
  assert.equal(firstGoalWindow.liveContract?.kind,'nth-time');
  assert.equal(firstGoalWindow.liveContract?.target,1);
  assert.equal(firstGoalWindow.settlementHold,null);

  const user={id:randomUUID(),username:'native-quote-test',status:'ACTIVE',role:'PLAYER'};
  await db.query('insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,1000)',
    [user.id,user.username,'test-only',user.role]);
  const ticket=await placeBet({user,stake:100,clientRequestId:randomUUID(),
    selections:[{outcomeId:id(quoted[0]),oddsAtPlacement:2.2}]});
  assert.equal(ticket.status,'PENDING');
  const {rows}=await db.query('select * from app_ticket_line where ticket_id=$1',[ticket.id]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].accepted_contract.settlementHold,'NATIVE_FINAL_RULE_UNMAPPED');
  assert.equal(rows[0].accepted_contract.nativeMarketId,'999111');
  assert.deepEqual(rows[0].accepted_contract.acceptedLiveSnapshot.counters.corner,{home:0,away:0});
  assert.equal(rows[0].accepted_contract.acceptedLiveSnapshot.scoreHome,0);
  assert.equal(rows[0].settlement_reason,'NATIVE_RULE_REVIEW');
  assert.equal(rows[0].live_contract,null);
  const final={home_score:2,away_score:1,half_home_score:1,half_away_score:0};
  assert.equal(hasRequiredSettlementEvidence(rows[0],final),false);
  assert.equal(gradeLine(rows[0],final),null);
  assert.equal(reviewReason({...rows[0],line_status:'PENDING',ticket_status:'PENDING'}),
    'NATIVE_CONTRACT_REVIEW');
  assert.equal(await recalcTicket(ticket.id),null,'Unmapped line may not be paid or voided');
  assert.equal(Number((await db.query('select balance from app_user where id=$1',[user.id])).rows[0].balance),900);

  // Test 2: minute-zero LIVE Race to 7 is valid even without Zizobet
  // score, corner counters or an incident-history database snapshot.
  matches.upsert([{
    match_id:matchId,sport_id:18,sport_tag:'football',category_slug:'test',
    category_name:'Isolated test',tournament_id:1,tournament_name:'Isolated test',
    home:'Home',away:'Away',service:'LIVE',is_real:true,
    start_at:new Date(Date.now()-10000).toISOString(),status:'live',
    raw:{provider:'ZIZOBET',nativeId:75149063}
  }]);
  matches.applyInfo({matchId,matchTimeMs:0,feedStatus:'First Half',hasOpenOdds:true});
  const race7=make(999117,'Race to 7 Corners','1');
  const race9=make(999118,'Race to 9 Corners','1');
  odds.applyRows([race7]);
  const raceSelection={outcomeId:id(race7),oddsAtPlacement:2.2};
  const raceAtZero=await resolveSelection(raceSelection);
  assert.equal(raceAtZero.liveContract?.kind,'race');
  assert.equal(raceAtZero.liveContract?.target,7);
  assert.equal(raceAtZero.liveContract?.baseline,undefined,
    'Unknown LIVE corner counts are never guessed as 0-0');

  const raceTicket=await placeBet({user,stake:100,clientRequestId:randomUUID(),
    selections:[raceSelection]});
  const storedRace=(await db.query('select * from app_ticket_line where ticket_id=$1',
    [raceTicket.id])).rows[0];
  assert.equal(storedRace.live_contract.target,7);
  assert.equal(storedRace.accepted_contract.nativeMarketId,'999117');
  assert.equal(storedRace.accepted_contract.acceptedLiveSnapshot.counters.corner,null);

  // Test 3: Zizobet removal is represented by the same tombstone emitted
  // by a complete provider feed. It must defeat a cached browser slip.
  odds.applyRows([{...race7,price:null,suspended:true},race9]);
  await assert.rejects(
    ()=>placeBet({user,stake:100,clientRequestId:randomUUID(),
      selections:[raceSelection]}),
    error=>error?.status===400&&/pezulluar|disponueshme/i.test(error.message),
    'Removed Race to 7 is rejected even when a client kept its old odds');

  // Test 4: Race to 9 is a DIFFERENT offer. The previously accepted Race
  // to 7 still has target 7 and can be graded later from its own chronology.
  const still7=(await db.query('select * from app_ticket_line where id=$1',
    [storedRace.id])).rows[0];
  assert.equal(still7.live_contract.target,7);
  assert.equal(still7.status,'PENDING');
  const events=Array.from({length:7},(_,i)=>({
    id:'home-corner-'+(i+1),type:'corner',team:'home',minute:i+1,seconds:(i+1)*60
  }));
  assert.equal(gradeLiveContract(still7.live_contract,{
    events,clock:90,coverage:{cornerThrough:90},
    counts:{corner:7},teams:{corner:{home:7,away:0}}
  },{ended:true}),'WON','Frozen Race-to-7 still grades by 7 after Race-to-9 appears');
  assert.equal((await resolveSelection({outcomeId:id(race9),oddsAtPlacement:2.2})).liveContract.target,9);

  // A partially elapsed provider interval without purchase-time counters is
  // admitted but stays held for evidence. It must never count old incidents.
  matches.applyInfo({matchId,matchTimeMs:5*60000,feedStatus:'First Half'});
  const runningInterval=make(999119,'Total corners in minutes 1-10 (10-minute interval)','Over','0.5');
  odds.applyRows([runningInterval]);
  const missingCounts=await resolveSelection({outcomeId:id(runningInterval),oddsAtPlacement:2.2});
  assert.equal(missingCounts.settlementHold,'NATIVE_INTERVAL_BASELINE_UNVERIFIED');
  assert.equal(missingCounts.liveContract,null);

  assert.equal(Number((await db.query('select balance from app_user where id=$1',[user.id])).rows[0].balance),800,
    'The removed offer and read-only checks must not charge the wallet');
  console.log('PASS native offers: PREMATCH numbered goal, LIVE minute-zero race, provider removal rejection, immutable Race-to-7 settlement, and missing interval evidence hold');
}finally{
  pool.query=original.query;pool.connect=original.connect;
  config.matchStore=original.matchStore;config.oddsStore=original.oddsStore;
  config.liveRiskEnabled=original.liveRiskEnabled;setLiveRiskSettings(original.settings);
  setFeedMode(original.feedMode);
  matches.clear();odds.clearMatch(matchId);
  await db.close();
}
