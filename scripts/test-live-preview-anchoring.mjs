import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createLiveSettlementPreviews} from '../server/ledger/live-shadow-settlement.mjs';

// A frequent Zizobet poll must NOT reset the first verified proposal.
// Otherwise the separate 5-second confirmation requirement is never met.
const db=new PGlite();
const now=Date.parse('2026-11-12T22:00:00Z');
await db.exec(`create table app_live_settlement_preview(
 line_id text primary key,match_id bigint not null,proposed_status text not null,
 payload jsonb not null,updated_at timestamptz not null)`);
let contract={version:1,kind:'window-total',event:'goal',choice:'over',
 threshold:0.5,from:1,to:10,entryBaseline:{home:0,away:0},entryClockMinute:6};
const frame=(clock)=>({source:'zizobet',clock,ended:false,
 counts:{goal:1},teams:{goal:{home:1,away:0}},events:[],coverage:{}});
let fixture={line_id:'line-interval',ticket_id:'ticket-interval',match_id:7001,
 live_contract:contract,provider_frame:frame(8),
 frame_at:new Date(now-11000).toISOString(),
 placed_at:new Date(now-60000).toISOString(),open_recovery_gaps:0};
const runQuery=(sql,args=[])=>sql.startsWith('select l.id as line_id')?
 Promise.resolve({rows:[fixture]}):db.query(sql,args);
const read=async()=>{
 const {rows}=await db.query('select proposed_status,payload,updated_at from app_live_settlement_preview where line_id=$1',['line-interval']);
 return rows[0];
};
try{
 assert.equal((await createLiveSettlementPreviews({runQuery,now:()=>now})).proposed,1);
 const first=await read();
 assert.equal(first.proposed_status,'WON');
 assert.equal(first.payload.frameAt,fixture.frame_at);
 fixture={...fixture,provider_frame:frame(9),frame_at:new Date(now-1000).toISOString()};
 assert.equal((await createLiveSettlementPreviews({runQuery,now:()=>now})).proposed,1);
 const later=await read();
 assert.equal(later.proposed_status,'WON');
 assert.equal(later.payload.frameAt,first.payload.frameAt,
  'Second poll must keep initial proposal evidence and confirmation age');
 assert.deepEqual(later.payload.contract,first.payload.contract);
 // A genuinely changed verdict replaces the old proposal; it cannot be
 // paid from evidence that concerned a different immutable contract.
 contract={...contract,choice:'under'};
 fixture={...fixture,live_contract:contract};
 await createLiveSettlementPreviews({runQuery,now:()=>now});
 const changed=await read();
 assert.equal(changed.proposed_status,'LOST');
 assert.equal(changed.payload.contract.choice,'under');
 console.log('PASS live proposal keeps original timestamp across matching polls, resets on a changed contract');
}finally{await db.close();}
