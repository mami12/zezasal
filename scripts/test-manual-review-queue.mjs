import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {reviewReason,manualReviewQueue} from '../server/ledger/manual-review-queue.mjs';
import {manualSettlement} from '../server/ledger/financial-monitoring.mjs';
import {SETTLEMENT_REVIEW_SQL} from '../server/ledger/settlement-review.mjs';

const now=Date.parse('2026-11-05T20:00:00Z');
const base={line_id:'line-a',ticket_id:'ticket-a',match_id:123,
 market_key:'corner-five',line:'11-15',outcome_key:'Yes',
 market_name:'Corner in minutes 11-15',outcome_name:'Yes',match_name:'Home - Away',
 line_status:'PENDING',ticket_status:'PENDING',result_id:123,
 placed_at:new Date(now-86400000).toISOString(),stake:100,odds_at_placement:2,
 username:'tester',home_score:2,away_score:1,statistics_review:null,
 feed_status:'FT',match_status:'ended'};
assert.equal(reviewReason(base,now),'MISSING_EVENT_TIMELINE');
assert.equal(reviewReason({...base,market_name:'Total Corners'},now),'MISSING_MARKET_STATISTICS');
assert.equal(reviewReason({...base,market_name:'Total Shots on Target',
 statistics_review:{conflicts:{shotsOnTarget:{a:{home:2,away:3},b:{home:4,away:2}}}}},now),'CONFLICTING_API_STATISTICS');
assert.equal(reviewReason({...base,line_status:'VOID',ticket_status:'VOID'},now),'VOID_NEEDS_CONFIRMATION');
assert.equal(reviewReason({...base,result_id:null,match_status:'live',feed_status:'live'},now),null,'active fixtures are not invalid');
assert.equal(reviewReason({...base,result_id:null,match_status:'ended',feed_status:'ended'},now),'MISSING_FINAL_RESULT');

const rows=[
 base,
 {...base,line_id:'line-b',ticket_id:'ticket-b',market_name:'Total Corners'},
 {...base,line_id:'line-c',ticket_id:'ticket-c',line_status:'VOID',ticket_status:'VOID'},
 {...base,line_id:'line-d',ticket_id:'ticket-d',result_id:null,feed_status:'live',match_status:'live'},
];
let observedSql='',observedParams;
const notices=new Map();
const runQuery=async(sql,params)=>{
 if(sql.includes('insert into app_manual_review_notice')){
  if(!notices.has(params[0]))notices.set(params[0],params[1]);
  return {rows:[{first_seen_at:notices.get(params[0])}]};
 }
 observedSql=sql;observedParams=params;
 return {rows:rows.map(row=>({...row,first_seen_at:notices.get(row.line_id)}))};
};
const queue=await manualReviewQueue({runQuery,now,limit:25});
assert.equal(queue.notificationCount,3);
assert.equal(queue.items[0].noticeExpiresAt,new Date(now+48*3600000).toISOString());
const justBefore=await manualReviewQueue({runQuery,now:now+48*3600000-1,limit:25});
assert.equal(justBefore.notificationCount,3);
const expired=await manualReviewQueue({runQuery,now:now+48*3600000,limit:25});
assert.equal(expired.notificationCount,0);
assert.equal(expired.items.length,3,'expiry does not close unresolved cases');
assert.match(observedSql,/o.status='PENDING'/,'an explicit pending decision keeps the review open');
assert.equal(queue.items.length,3);
assert.deepEqual(queue.items.map(r=>r.lineId),['line-a','line-b','line-c']);
assert.equal(queue.items[0].finalScore,'2 - 1');
assert.equal(queue.items[2].lineStatus,'VOID');
assert.match(observedSql,/app_settlement_override/);
assert.deepEqual(observedParams,[75]);

// Simulate one approved selection only, in a two-line ticket. No live DB
// or wallet is used; assert that only the selected UUID is changed.
const admin={id:'admin',username:'admin'};
const ticketId='00000000-0000-4000-8000-000000000001';
const lineId='00000000-0000-4000-8000-000000000002';
const otherId='00000000-0000-4000-8000-000000000003';
const lines=[
 {id:lineId,ticket_id:ticketId,match_id:123,market_key:'corner',line:'',outcome_key:'Yes',status:'PENDING',odds_at_placement:2},
 {id:otherId,ticket_id:ticketId,match_id:124,market_key:'result',line:'',outcome_key:'1',status:'PENDING',odds_at_placement:2},
];
const ticket={id:ticketId,user_id:'player',stake:100,status:'PENDING',potential_payout:400,original_potential_payout:400};
const writes=[],calls=[];
const client={async query(sql,params=[]){
 calls.push(sql);
 if(sql==='select role,status,deleted_at from app_user where id=$1 for share')return {rows:[{role:'ADMIN',status:'ACTIVE',deleted_at:null}]};
 if(sql==='select * from app_ticket_line where id=$1')return {rows:lines.filter(l=>l.id===params[0]).map(l=>({...l}))};
 if(sql==='select * from app_ticket where id=$1 for update')return {rows:[{...ticket}]};
 if(sql==='select * from app_ticket_line where ticket_id=$1 order by id for update')return {rows:lines.map(l=>({...l}))};
 if(sql.startsWith('update app_ticket_line')){writes.push({id:params[0],status:params[1]});return {rowCount:1};}
 if(sql.startsWith('insert into app_settlement_override'))return {rowCount:1};
 if(sql.startsWith('update app_ticket set'))return {rowCount:1};
 if(sql.startsWith('insert into app_admin_audit'))return {rowCount:1};
 if(sql==='begin'||sql==='commit'||sql==='rollback')return {};
 throw Error('Unexpected SQL: '+sql);
 },release(){}};
const database={connect:async()=>client};
const result=await manualSettlement({lineId,status:'VOID',reason:'Confirmed market cancellation',source:'Official provider'},admin,{database});
assert.equal(result.changed.length,1);
assert.deepEqual(writes,[{id:lineId,status:'VOID'}]);
assert.match(SETTLEMENT_REVIEW_SQL,/PENDING','WON','LOST','VOID/);
await assert.rejects(()=>manualSettlement({lineId:otherId,status:'NOT_VALID',reason:'x',source:'x'},admin,{database}),e=>e.status===400);
console.log('PASS manual review queue and selection-specific audited decisions; no real wallet writes');
