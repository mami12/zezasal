import assert from 'node:assert/strict';
import {liveContract,parsePlayerCardContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';

const line=(title,choice='Yes')=>({
 market_name:title+' · Kiefersauer, Xaver',outcome_name:choice
});
const yellow=parsePlayerCardContract(line('Player to receive a yellow card'));
assert.deepEqual([yellow.kind,yellow.event,yellow.cardColor,yellow.playerName,yellow.choice],
 ['player-card','card','yellow','Kiefersauer, Xaver',true]);
assert.equal(parsePlayerCardContract(line('Player to be booked','No'))?.choice,false);
assert.equal(parsePlayerCardContract(line('Player to be sent off'))?.cardColor,'red',
 'A yellow booking alone must never win a sent-off proposition');
assert.equal(liveContract(line('Player to be booked'))?.kind,'player-card');
assert.equal(parsePlayerCardContract({market_name:'Player to be booked',outcome_name:'Yes'}),null,
 'Yes for unnamed player is ambiguous');
assert.equal(parsePlayerCardContract({market_name:'Player Shots On Target · Xaver Kiefersauer',outcome_name:'Yes'}),null);

const at=Date.parse('2026-11-08T13:15:00Z');
const prematch={service:'PREMATCH',start_at:'2030-01-01T20:00:00Z'};
assert.equal(frozenLiveContract(line('Player to be booked'),prematch,at)?.kind,'player-card');
const live={service:'LIVE',match_time_ms:30*60000,clock_at:new Date(at).toISOString(),
 score_at:new Date(at).toISOString(),home_score:0,away_score:0};
assert.throws(()=>frozenLiveContract(line('Player to be booked'),live,at),
 err=>err.code==='MARKET_EVIDENCE_UNSUPPORTED',
 'No live player card bet without confirmed baseline');
const confirmed={through_minute:30,observed_at:new Date(at).toISOString(),
 confirmed_at:new Date(at).toISOString(),booked:false};
assert.equal(frozenLiveContract({...line('Player to be booked'),
 playerCardSnapshot:confirmed},live,at)?.kind,'player-card');
assert.throws(()=>frozenLiveContract({...line('Player to be booked'),
 playerCardSnapshot:{...confirmed,booked:true}},live,at),
 err=>err.code==='MARKET_DECIDED');

const result={cards_home:1,cards_away:0,home_score:0,away_score:0};
const execute=(actors,verified=true)=>async(sql,args)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:1,away:0,count_home:1,count_away:0,total:1,complete:true,
  card_colors_verified:verified,through_minute:91,open_recovery_gap:false,
  observed_at:'2026-11-08T13:30:00Z',confirmed_at:'2026-11-08T13:30:00Z',
  second_poll_at:'2026-11-08T13:30:00Z'
 }]};
 if(sql.includes('select player_id,player_name,card_color'))return {rows:actors};
 if(sql.includes('select 1 from app_match_event_coverage'))return {rows:[{exists:1}]};
 throw Error('Unexpected SQL '+sql.slice(0,80));
};
const accepted=(choice,market='Player to be booked')=>({
 id:'00000000-0000-4000-8000-000000000001',match_id:77,
 live_contract:liveContract(line(market,choice))
});
const actor=[{player_id:'p1',player_name:'Xaver Kiefersauer',card_color:'yellow'}];
assert.equal(await gradeStoredEventContract(accepted('Yes'),result,{execute:execute(actor)}),'WON');
assert.equal(await gradeStoredEventContract(accepted('No'),result,{execute:execute(actor)}),'LOST');
assert.equal(await gradeStoredEventContract(accepted('Yes'),result,{execute:execute([])}),null,
 'Missing booking does not prove player participation');
assert.equal(await gradeStoredEventContract(accepted('Yes','Player to receive a yellow card'),result,
 {execute:execute(actor)}),'WON');
assert.equal(await gradeStoredEventContract(accepted('Yes','Player to receive a yellow card'),result,
 {execute:execute(actor,false)}),null,'Color needs confirmed color-specific evidence');
console.log('PASS player booking identity, database confirmation, live accepted baseline and missing-participation holds');
