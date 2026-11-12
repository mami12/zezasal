import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {pool} from '../server/db.mjs';
import {
 gradeLine,hasRequiredSettlementEvidence,settleMatch,recalcTicket,createPendingLineScanner,
 settleVerifiedHalftimes
} from '../server/ledger/settler.mjs';
import {captureHalfTimeResults} from '../server/ledger/halftime-results.mjs';

const ft={home_team:'Home',away_team:'Away',home_score:2,away_score:1,
 half_home_score:1,half_away_score:0,corners_home:4,corners_away:5,cards_home:2,cards_away:2,
 statistics:{}};
const line=(market_name,outcome_name,extra={})=>({
 market_name,outcome_name,outcome_key:outcome_name,line:'',...extra
});
const basic=[
 [line('Full Time Result','1'),'WON'],
 [line('Full Time Result','X'),'LOST'],
 [line('Full Time Result','2'),'LOST'],
 [line('Double Chance','1X'),'WON'],
 [line('Double Chance','X2'),'LOST'],
 [line('Both Teams To Score','Yes'),'WON'],
 [line('Both Teams To Score','No'),'LOST'],
 [line('Full Time Total Goals','Over',{line:'2.5'}),'WON'],
 [line('Full Time Total Goals','Under',{line:'2.5'}),'LOST'],
 [line('Full Time Total Goals','Over',{line:'3.0'}),'VOID'],
 [line('Full Time Total Goals','Under',{line:'3.0'}),'VOID'],
 [line('Correct Score','2:1'),'WON'],
 [line('Correct Score','1:1'),'LOST'],
 [line('1st half - Result','1',{period:1}),'WON'],
 [line('1st half - Result','X',{period:1}),'LOST'],
 [line('1st half - Total Goals','Over',{period:1,line:'0.5'}),'WON'],
 [line('1st half - Total Goals','Under',{period:1,line:'1.0'}),'VOID'],
 [line('HT/FT','1/1'),'WON'],
 [line('HT/FT','1/X'),'LOST'],
 [line('Draw No Bet','1'),'WON'],
 [line('Draw No Bet','2'),'LOST'],
];
for(const [pick,want] of basic){
 assert.equal(hasRequiredSettlementEvidence(pick,ft),true,'Full evidence: '+JSON.stringify(pick));
 assert.equal(gradeLine(pick,ft),want,JSON.stringify(pick));
}
assert.equal(gradeLine(line('HT/FT','1/1'),{...ft,half_home_score:null}),null);
assert.equal(gradeLine(line('1st half - Result','1',{period:1}),
 {...ft,half_home_score:null}),null);
assert.equal(gradeLine(line('Full Time Result','unknown'),ft),null,
 'Never manufacture LOST for an unfamiliar selection');
assert.equal(hasRequiredSettlementEvidence(line('Full Time Total Goals','Over',{line:'2.5'}),
 {...ft,home_score:null}),false,'No final scoreboard means no settlement');

// Use an isolated in-memory PostgreSQL emulator. No real wallets or provider calls.
const pg=new PGlite();
const originalQuery=pool.query,originalConnect=pool.connect;
try{
 await pg.exec(LEDGER_SQL);
 pool.query=(...a)=>pg.query(...a);
 pool.connect=async()=>({query:(...a)=>pg.query(...a),release(){}});
 const q=(sql,params=[])=>pg.query(sql,params);
 const player=(await q("insert into app_user(username,password_hash,balance) values('isolated-elementary-coverage','fixture',1000) returning id")).rows[0].id;
 await q("insert into app_match_result(match_id,home_team,away_team,home_score,away_score,half_home_score,half_away_score) values(4101,'Home','Away',2,1,1,0),(4102,'Home','Away',0,0,0,0)");
 const mk=async({stake=10,payout=20,items})=>{
  const tid=(await q("insert into app_ticket(user_id,stake,total_odds,potential_payout,ticket_type,status) values($1,$2,2,$3,'COMBO','PENDING') returning id",
   [player,stake,payout])).rows[0].id;
  for(const {id,market='Full Time Result',choice='1',threshold=''} of items){
   await q("insert into app_ticket_line(ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,$2,'test-market',$3,$4,$4,$5,'Home vs Away',2,'PENDING')",
    [tid,id,threshold,choice,market]);
  }
  return tid;
 };
 const won=await mk({items:[{id:4101}]});
 const combo=await mk({payout:40,items:[{id:4101},{id:4102,choice:'X'}]});
 const earlyLost=await mk({payout:40,items:[{id:4102,choice:'1'},{id:99999}]});
 const push=await mk({items:[{id:4101,market:'Full Time Total Goals',choice:'Over',threshold:'3.0'}]});
 const htft=await mk({items:[{id:4101,market:'HT/FT',choice:'1/1'}]});
 const incomplete=await mk({items:[{id:4101,market:'HT/FT',choice:'bad'}]});
 let result=await settleMatch(4101);
 assert.ok(result.settled>=5);
 result=await settleMatch(4102);
 assert.ok(result.settled>=2);
 const read=async id=>(await q('select status,potential_payout from app_ticket where id=$1',[id])).rows[0];
 assert.equal((await read(won)).status,'WON');
 assert.equal((await read(combo)).status,'WON','Two independently resolved matches close an accumulator');
 assert.equal((await read(earlyLost)).status,'LOST','One losing selection closes a combo before other FT');
 assert.equal((await read(push)).status,'VOID','Integer totals refund at equality');
 assert.equal((await read(htft)).status,'WON');
 assert.equal((await read(incomplete)).status,'PENDING','Unrecognized HT/FT is not a fabricated loss');
 const balance=(await q('select balance from app_user where id=$1',[player])).rows[0].balance;
 assert.equal(Number(balance),1000+20+40+10+20);
 await settleMatch(4101);await settleMatch(4102);
 assert.equal(await recalcTicket(won),null);
 assert.equal(Number((await q('select balance from app_user where id=$1',[player])).rows[0].balance),Number(balance));
 assert.equal((await q("select count(*)::int as n from app_transaction where type='BET_WON' and reference_id=$1",[won])).rows[0].n,1);

 // An old ungradable row should never crowd out a later, gradeable row.
 const scan=createPendingLineScanner();
 const {rows:sorted}=await q("select id from app_ticket_line where ticket_id=$1 order by id",[incomplete]);
 const skipId=sorted[0].id;
 // Stable ordering comes from the PK; mock an additional gradeable row.
 const another=(await q("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,4101,'test-market','X','X','Full Time Result','Home vs Away',2,'PENDING') returning id",[incomplete])).rows[0].id;
 const base="select l.* from app_ticket_line l where l.ticket_id=$3";
 // The scanner appends $1/$2; use constant ticket ID in SQL for the test.
 const statement="select l.* from app_ticket_line l where l.ticket_id='"+incomplete+"'";
 const first=await scan(q,statement,1),second=await scan(q,statement,1),third=await scan(q,statement,1);
 const visited=new Set([...first,...second,...third].map(x=>x.id));
 assert.equal(visited.has(skipId),true);
 assert.equal(visited.has(another),true,'Round-robin eventually scans after an unresolved line');

 // A stripped in-memory LIVE row cannot hide a saved verified HT snapshot.
 const source={match_id:99001,home:'Home',away:'Away',feed_status:'HT',
  score_at:'2026-11-12T10:42:00Z',feed_status_at:'2026-11-12T10:42:01Z',
  home_score:1,away_score:0,periods_score:[{t1:1,t2:0}],
  raw:{provider:'ZIZOBET'}};
 const captured=await captureHalfTimeResults({
  runQuery:async(sql,params)=>sql.startsWith('select distinct l.match_id from app_ticket_line')?
   {rows:[{match_id:99001}]}:q(sql,params),
  loadMatches:async()=>[{...source,periods_score:null}],
  loadSnapshots:async()=>[source],
  loadMatch:async()=>{throw Error('Valid snapshot must avoid extra read');}
 });
 assert.equal(captured.recorded,1,'Persist a valid HT snapshot even when the active board has no SetScores');
 const half=(await q('select half_home_score,half_away_score from app_match_half_result where match_id=99001')).rows[0];
 assert.deepEqual([Number(half.half_home_score),Number(half.half_away_score)],[1,0]);

 console.log('PASS elementary markets FT/HT, two-way pushes, two-match combos, pending safety, payout idempotency, rotating queue and saved HT recovery');
}finally{
 pool.query=originalQuery;pool.connect=originalConnect;
 await pg.close();
}
