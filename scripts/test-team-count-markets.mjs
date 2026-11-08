import assert from 'node:assert/strict';
import {parseTeamCountMarket,liveContract,gradeLiveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
const line=(market_name,outcome_name,amount='')=>({market_name,outcome_name,line:amount});
for(const [market,outcome,amount,event,side,kind] of [
 ['Home Team Total Corners','Over','2.5','corner','home','over'],
 ['Away Team Yellow Cards','Over','1.5','card','away','over'],
 ['Total Home Team Corners','Under','4.5','corner','home','under'],
 ['Total Corners Away Team','Exactly 2','','corner','away','exact'],
 ['Team 1 Total Corners','Over','2.5','corner','home','over'],
 ['Team 2 Total Cards','Under','3.5','card','away','under'],
 ['Full time - Home team Total Cards (3.5)','Over','3.5','card','home','over'],
 ['Home Team Total Goals','Over','1.5','goal','home','team-total-goals'],
 ['Home Team Total Fouls','2+','','foul','home','atLeast']
]){
 const quote=line(market,outcome,amount);
 const contract=event==='foul'?parseTeamCountMarket(quote):liveContract(quote);
 // Final-match fouls use certified statistics, not a fictitious live
 // foul-incident chronology. Their raw team/line grammar still parses.
 if(event==='foul')assert.equal(liveContract(quote),null,
  'Fouls must never be accepted as verified live event contracts');
 assert.equal(contract?.event,event,market+' event');
 assert.equal(contract?.side,side,market+' side');
 assert.equal(contract?.kind,kind,market+' kind');
 if(event==='goal'){
  assert.equal(contract.choice,'over','Team goal contract preserves the quoted Over direction');
  assert.equal(contract.threshold,1.5,'Team goal contract preserves the quoted 1.5 line');
 }

}
for(const input of [
 line('Home Team Total Corners','Over','2.25'),
 line('Home Team Total Corners (1.5)','Over','2.5'),
 line('Home Team Total Corners and Goals','Over','2.5'),
 line('Home Team Yellow Red Cards','Over','2.5'),
 line('1st Half - Home Team Total Cards','Over','2.5')
])assert.equal(parseTeamCountMarket(input),null,
 'Unsupported or inconsistent quote must not become an aggregate count: '+input.market_name);

const teamGoals=liveContract(line('Home Team Total Goals','Over','1.5'));
assert.equal(gradeLiveContract(teamGoals,{clock:65,
 teams:{goal:{home:1,away:5}}}),null,
 'Five away goals must not settle a home Over 1.5 market');
assert.equal(gradeLiveContract(teamGoals,{clock:66,
 teams:{goal:{home:2,away:5}}}),'WON',
 'Home Over 1.5 wins when two confirmed home goals exist');
const home=liveContract(line('Home Team Total Corners','Over','2.5'));
const frame={clock:45,counts:{corner:10},teams:{corner:{home:1,away:9}}};
assert.equal(gradeLiveContract(home,frame),null,'Nine away corners cannot win a HOME corner line');
assert.equal(gradeLiveContract(home,{...frame,teams:{corner:{home:3,away:7}}}),'WON');
const yellow=liveContract(line('Home Team Yellow Cards','Over','1.5'));
assert.equal(yellow.cardColor,'yellow');
assert.equal(gradeLiveContract(yellow,{clock:80,counts:{card:6},teams:{card:{home:3,away:3}}}),null,
 'Generic card counts cannot be used as yellow-card evidence');

const execute=async(sql,args)=>{
 assert.match(sql,/with covered as/);
 assert.equal(args[4],'home');
 assert.equal(args[14],'yellow');
 return {rows:[{
  home:2,away:2,total:4,count_home:2,count_away:2,
  color_home:2,color_away:0,color_total:2,
  through_minute:91,complete:true,card_colors_verified:true,
  observed_at:'2026-11-08T13:10:00Z',confirmed_at:'2026-11-08T13:10:00Z',
  second_poll_at:'2026-11-08T13:10:00Z',open_recovery_gap:false
 }]};
};
assert.equal(await gradeStoredEventContract({
 id:'00000000-0000-4000-8000-000000000001',match_id:11,
 live_contract:liveContract(line('Home Team Yellow Cards','Over','1.5'))
},{home_score:0,away_score:0,cards_home:2,cards_away:2},{execute}),'WON',
 'Persisted confirmed player/team card colors grade the correct home side');
console.log('PASS scoped team goals/corners/cards/fouls parsing and color-safe financial evidence');
