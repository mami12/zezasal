import assert from 'node:assert/strict';
import {parseEventWindow,parseSequenceBet,parseLastEvent,parseCountMarket,gradeLiveContract,gradeFromAcceptedCounters} from '../server/ledger/live-contract-rules.mjs';

const windowLine=(market,side)=>({market_name:market,outcome_name:side});
const w=parseEventWindow(windowLine('Will there be a goal in minutes 20-45','Yes'));
assert.deepEqual([w.kind,w.event,w.from,w.to,w.choice],['window','goal',20,45,true]);
const obs=(event,events,clock,coverage)=>({
 clock,counts:{[event]:events.length},
 events:events.map((minute,index)=>({id:String(index),type:event,minute,team:'home'})),
 coverage:{[event+'Through']:coverage},
});
assert.equal(gradeLiveContract(w,obs('goal',[20],23,23)),'WON','Minute 20 is included');
assert.equal(gradeLiveContract(w,obs('goal',[],46,46)),'LOST','No goal by elapsed interval = yes lost');
assert.equal(gradeLiveContract(w,obs('goal',[],43,43)),null,'Do not settle no-event early');
assert.equal(gradeLiveContract(w,obs('goal',[],46,30)),null,'Missing coverage is pending');
const no=parseEventWindow(windowLine('Goal in minutes 20-45','No'));
assert.equal(gradeLiveContract(no,obs('goal',[21],25,25)),'LOST','No goal bet loses as soon as goal verified');
assert.equal(gradeLiveContract(no,obs('goal',[],46,46)),'WON','No goal bet wins only after interval closes');
assert.equal(gradeLiveContract(no,obs('goal',[],46,30)),null,'No goal cannot win on a data gap');
const card=parseEventWindow(windowLine('Will there be a card in first 10 minutes','Yes'));
assert.equal(gradeLiveContract(card,obs('card',[9],9,9)),'WON');
assert.equal(gradeLiveContract(card,obs('card',[],11,11)),'LOST');
const corner=parseEventWindow(windowLine('Corner in next 10 minutes','Yes'),20);
assert.deepEqual([corner.from,corner.to,corner.startExclusive],[20,30,true]);
assert.equal(gradeLiveContract(corner,obs('corner',[20],22,22)),null,'Start excludes previous corner');
assert.equal(gradeLiveContract(corner,obs('corner',[21],22,22)),'WON');
assert.equal(gradeLiveContract(corner,obs('corner',[30],31,31)),null,'Minute-only event at closing boundary is ambiguous');
assert.equal(parseEventWindow(windowLine('Goal within 10 minutes','Yes')),null,'Unanchored rolling window is unsafe');
const next=parseSequenceBet(windowLine('Next Goal','Chelsea'),{goal:{home:1,away:0}});
assert.equal(next,null,'Unknown team labels must use explicit provider identity');
const g=parseSequenceBet(windowLine('Next Goal','2'),{goal:{home:1,away:0}});
assert.deepEqual([g.target,g.side],[2,'away']);
// The original Zizobet market title carries a FIXED goal ordinal. Never
// collapse "Next Goal 2nd" into the bare dynamic "Next Goal".
for(const [name,goalNumber] of [
 ['Next Goal 1st',1],['Next Goal 2nd',2],['Next Goal 3rd',3],
 ['Next Goal 4th',4],['Next Goal 10th',10],['Next Goal 2',2]
]){
 const c=parseSequenceBet(windowLine(name,'2'),{goal:{home:3,away:0}});
 assert.deepEqual([c?.kind,c?.event,c?.target,c?.side],['sequence','goal',goalNumber,'away'],
  'Provider ordinal preserved irrespective of current scoreboard: '+name);
}
const thirdCorner=parseSequenceBet(windowLine('Next Corner 3rd','1'),{corner:{home:4,away:4}});
assert.equal(thirdCorner?.target,3,'Numbered NEXT corner does not become corner #9');
assert.equal(parseSequenceBet(windowLine('Next Goal 2nd extra','2'),{goal:{home:0,away:0}}),null,
 'An unrecognized numbered market cannot default to the live next goal');
assert.equal(parseSequenceBet(windowLine('Next Goal 2nd half','2'),{goal:{home:0,away:0}}),null,
 'Half-specific NEXT cannot be graded from full match goals');
const early=obs('goal',[12,29],30,30);early.events[0].team='home';early.events[1].team='away';
assert.equal(gradeLiveContract(g,early),'WON');
assert.equal(gradeLiveContract({...g,side:'home'},early),'LOST');
assert.equal(gradeLiveContract({...g,side:'none'},early),'LOST');
assert.equal(gradeLiveContract({...g,target:3},early),null);
assert.equal(gradeLiveContract({...g,target:3,side:'none'},early,{ended:true}),'WON');
assert.equal(parseSequenceBet(windowLine('Who scores goal 2','X')).target,2);
const ambiguous=obs('goal',[12,12],30,30);ambiguous.events[1].team='away';
assert.equal(gradeLiveContract(g,ambiguous),null,'Same-minute goal ordering cannot be guessed');
const race=parseSequenceBet(windowLine('Which team wins race to 3 corners','1'));
const corners=obs('corner',[2,5,10,25,30],35,35);
corners.events.forEach((e,i)=>{e.team=['home','away','home','away','home'][i];});
assert.equal(gradeLiveContract(race,corners),'WON');
assert.equal(gradeLiveContract({...race,side:'away'},corners),'LOST');
assert.equal(gradeLiveContract(race,{...corners,coverage:{cornerThrough:10}}),null);
assert.equal(gradeLiveContract({...race,target:6},corners,{ended:true}),null,'Unreached race needs the official cancellation rule');
assert.equal(gradeLiveContract(w,obs('goal',[],15,15),{ended:true}),null,'Abandoned early match is not an elapsed window');
// Last goal/corner/card are final-event bets: never declare a winner before FT.
for(const [name,event] of [['Last Goal','goal'],['Last Corner','corner'],['Last Card','card']]){
 const last=parseLastEvent(windowLine(name,'1'));
 assert.equal(last.kind,'last-event');
 assert.equal(last.event,event);
 const frame=obs(event,[10,20],90,90);
 frame.events[0].team='home';frame.events[1].team='away';
 assert.equal(gradeLiveContract(last,frame),null,'Last event is unknowable before FT');
 assert.equal(gradeLiveContract(last,frame,{ended:true}),'LOST');
 assert.equal(gradeLiveContract({...last,side:'away'},frame,{ended:true}),'WON');
 assert.equal(gradeLiveContract({...last,side:'none'},frame,{ended:true}),'LOST');
 assert.equal(gradeLiveContract({...last,noneOffered:true},obs(event,[],90,90),{ended:true}),'LOST');
 assert.equal(gradeLiveContract({...last,side:'none',noneOffered:true},obs(event,[],90,90),{ended:true}),'WON');
 assert.equal(gradeLiveContract(last,obs(event,[],90,90),{ended:true}),'VOID');
}
assert.equal(parseLastEvent(windowLine('2nd Half Last Goal','1')),null);
assert.equal(parseLastEvent(windowLine('Last Goalscorer','1')),null);
const over=parseCountMarket(windowLine('Total Goals','Over'));assert.equal(over,null,'Missing threshold cannot be invented');
const o=parseCountMarket({...windowLine('Total Goals','Over'),line:'2.5'});
assert.equal(gradeLiveContract(o,{counts:{goal:3}}),'WON');
assert.equal(gradeLiveContract(o,{counts:{goal:2}}),null);
assert.equal(gradeLiveContract(o,{counts:{goal:2}},{ended:true}),'LOST');
const u=parseCountMarket({...windowLine('Total Goals','Under'),line:'2.5'});
assert.equal(gradeLiveContract(u,{counts:{goal:3}}),'LOST');
assert.equal(gradeLiveContract(u,{counts:{goal:2}},{ended:true}),'WON');
const integer=parseCountMarket({...windowLine('Total Goals','Under'),line:'2'});
assert.equal(gradeLiveContract(integer,{counts:{goal:2}}),null);
assert.equal(gradeLiveContract(integer,{counts:{goal:2}},{ended:true}),'VOID');
const exact=parseCountMarket(windowLine('Total Corners','Exactly 2'));
assert.equal(gradeLiveContract(exact,{counts:{corner:2}}),null);
assert.equal(gradeLiveContract(exact,{counts:{corner:3}}),'LOST');
assert.equal(gradeLiveContract(exact,{counts:{corner:2}},{ended:true}),'WON');
const band=parseCountMarket(windowLine('Total Cards','1-4'));
assert.equal(gradeLiveContract(band,{counts:{card:3}}),null);
assert.equal(gradeLiveContract(band,{counts:{card:5}}),'LOST');
assert.equal(gradeLiveContract(band,{counts:{card:3}},{ended:true}),'WON');
const fouls=parseCountMarket(windowLine('Total Fouls','2+'));
assert.equal(gradeLiveContract(fouls,{counts:{foul:2}}),'WON');
const deltaNext={...g,baseline:{home:1,away:0}};
assert.equal(gradeFromAcceptedCounters(deltaNext,{teams:{goal:{home:1,away:1}}}),'WON');
assert.equal(gradeFromAcceptedCounters({...deltaNext,side:'home'},{teams:{goal:{home:1,away:1}}}),'LOST');
assert.equal(gradeFromAcceptedCounters(deltaNext,{teams:{goal:{home:2,away:1}}}),null,
 'Two goals between snapshots require history from the backup API');
assert.equal(gradeFromAcceptedCounters(deltaNext,{teams:{goal:{home:0,away:1}}}),null,
 'Score rollback or VAR correction must not pay');
assert.equal(gradeFromAcceptedCounters({...deltaNext,side:'none'},
 {teams:{goal:{home:1,away:0}},ended:true}),'WON');
const deltaRace={...race,baseline:{home:2,away:1}};
assert.equal(gradeFromAcceptedCounters(deltaRace,{teams:{corner:{home:3,away:2}}}),'WON');
assert.equal(gradeFromAcceptedCounters(deltaRace,{teams:{corner:{home:3,away:3}}}),null,
 'If both sides crossed the threshold, order is unknown');
const integerOver=parseCountMarket({...windowLine('Total Goals','Over'),line:'2'});
assert.equal(gradeLiveContract(integerOver,{counts:{goal:2}}),null);
assert.equal(gradeLiveContract(integerOver,{counts:{goal:2}},{ended:true}),'VOID');
assert.equal(gradeLiveContract(integerOver,{counts:{goal:1}},{ended:true}),'LOST');
const missingMinute=obs('goal',[null],11,11);
const firstTen=parseEventWindow(windowLine('Goal in first 10 minutes','Yes'));
assert.equal(gradeLiveContract(firstTen,missingMinute),null,'Missing event minute is not minute zero');
console.log('PASS live event window yes/no, next goal, race, irreversible totals, exact and range');

const homeWindow=parseEventWindow(windowLine('Home team corner in minutes 20-45','Yes'));
assert.equal(homeWindow.side,'home');
const awayCorner=obs('corner',[20],25,25);
awayCorner.events[0].team='away';
assert.equal(gradeLiveContract(homeWindow,awayCorner),null);
assert.equal(gradeLiveContract(homeWindow,{...awayCorner,clock:46,coverage:{cornerThrough:46}}),'LOST');
assert.equal(gradeLiveContract(homeWindow,obs('corner',[20],25,25)),'WON');
assert.equal(gradeLiveContract({...homeWindow,choice:false},obs('corner',[20],25,25)),'LOST');
