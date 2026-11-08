import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {isPlayerGoalSpecial,parsePlayerGoalSpecial,gradePlayerGoalSpecial} from '../server/ledger/player-goal-specials.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const select=(market_name,outcome_name,line='')=>({market_name,outcome_name,line});
const athlete='Yasin Zor';
for(const [title,choice,line,threshold,half] of [
 ['Player Total Goals · Yasin Zor','Over 1.5','',1.5,null],
 ['Player Total Goals · Yasin Zor','Under','2.5',2.5,null],
 ['Player to Score 2 or More Goals · Yasin Zor','Yes','',2,null],
 ['Player to Score 3+ Goals · Yasin Zor','Yes','',3,null],
 ['Player to Score a Hat Trick · Yasin Zor','Yes','',3,null],
 ['Player to Score in 1st Half · Yasin Zor','Yes','',null,1],
 ['Player to Score in 2nd Half · Yasin Zor','Yes','',null,2],
 ['Player to Score in Both Halves · Yasin Zor','Yes','',null,'both']
]){
 const line=select(title,choice,line);
 assert.equal(isPlayerGoalSpecial(line),true,title);
 const contract=parsePlayerGoalSpecial(line);
 assert.equal(contract?.kind,'player-goal-special',title);
 assert.equal(contract.playerName,athlete);
 if(threshold!==null)assert.equal(contract.threshold,threshold);
 if(half!==null)assert.equal(contract.half,half);
 assert.equal(liveContract(line)?.kind,'player-goal-special');
}
for(const line of [
 select('Player Total Goals · Yasin Zor','Over 0.25'),
 select('Player Total Goals · Yasin Zor','Over'),
 select('Player Total Goals · Yasin Zor','Over 1.5','2.5'),
 select('Player to Score 2 or More Goals','Yes'),
 {...select('Player to Score in 1st Half · Yasin Zor','Yes'),period:2}
]){
 const contract=parsePlayerGoalSpecial(line);
 if(line.period===2)assert.equal(contract,null);
 else assert.equal(contract,null,'Invalid or unnamed player quote must remain unsupported');
}
const facts=[
 {team:'home',minute:12,phase:'H1',player_name:'Yasin Zor',own_goal:false},
 {team:'home',minute:50,phase:'H2',player_name:'Yasin Zor',own_goal:false},
 {team:'away',minute:60,phase:'H2',player_name:'Xaver',own_goal:false}
];
const verdict=(title,choice,f=facts,extras={})=>
 gradePlayerGoalSpecial(parsePlayerGoalSpecial(select(title,choice)),f,{complete:true,...extras});
assert.equal(verdict('Player Total Goals · Yasin Zor','Over 1.5'),'WON');
assert.equal(verdict('Player Total Goals · Yasin Zor','Under 1.5'),'LOST');
assert.equal(verdict('Player Total Goals · Yasin Zor','Under 2.5'),'WON');
assert.equal(verdict('Player Total Goals · Yasin Zor','Exactly 2'),'WON');
assert.equal(verdict('Player to Score 2 or More Goals · Yasin Zor','Yes'),'WON');
assert.equal(verdict('Player to Score 3+ Goals · Yasin Zor','Yes'),'LOST');
assert.equal(verdict('Player to Score a Hat Trick · Yasin Zor','No'),'WON');
assert.equal(verdict('Player to Score in Both Halves · Yasin Zor','Yes'),'WON');
assert.equal(verdict('Player to Score in 2nd Half · Yasin Zor','No'),'LOST');
assert.equal(verdict('Player to Score in 1st Half · Yasin Zor','Yes',
 [{...facts[0],own_goal:true},...facts.slice(1)]),'LOST',
 'Only the second-half goal is the named scorer; first-half own goal is ignored');
assert.equal(verdict('Player to Score 2 or More Goals · Mystery','No',
 facts),null,'A missing player is not proof of participation');
assert.equal(verdict('Player Total Goals · Mystery','Under 0.5',
 facts),null,'Player at zero goals without lineup cannot be marked winner');
assert.equal(gradePlayerGoalSpecial(parsePlayerGoalSpecial(
 select('Player Total Goals · Yasin Zor','Under 2.5')),facts,{complete:false}),null,
 'Incomplete goal history cannot settle a final UNDER');
const uncertain=[...facts,{team:'home',minute:72,player_name:null,own_goal:null}];
assert.equal(verdict('Player Total Goals · Yasin Zor','Under 2.5',uncertain),null,
 'An unknown player could have scored the goal that changes Under');

const stamp='2026-11-08T13:30:00Z';
const execute=async(sql)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:2,away:1,total:3,count_home:2,count_away:1,
  through_minute:92,complete:true,open_recovery_gap:false,
  confirmed_at:stamp,observed_at:stamp,second_poll_at:stamp
 }]};
 if(sql.includes('select minute,seconds,team,phase,player_id'))return {rows:facts};
 throw Error('Unexpected SQL '+sql.slice(0,120));
};
const c=liveContract(select('Player Total Goals · Yasin Zor','Over 1.5'));
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000501',match_id:250,live_contract:c
},{home_score:2,away_score:1},{execute}),'WON');
console.log('PASS player goals 2+/hat trick/total Over Under/exact/each half and confirmed SQL scorer facts');
