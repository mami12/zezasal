/**
 * simulimi: offline/read-only market settlement audit.
 * Never posts frames, places tickets, writes balances, or calls a sports API.
 *
 * node scripts/simulimi.mjs
 * node scripts/simulimi.mjs --catalog=quotes.json
 * node scripts/simulimi.mjs --db --strict
 */
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
const args=process.argv.slice(2);
const has=flag=>args.includes('--'+flag);
const option=key=>args.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3)??null;
if(has('db')&&option('catalog'))throw Error('Choose --db OR --catalog, not both.');
// The default and --catalog routes are isolated from configured real databases.
if(!has('db'))await import('./fixtures/isolated-casino-env.mjs');
const {gradeLine}=await import('../server/ledger/settler.mjs');
const {liveContract,gradeLiveContract}=await import('../server/ledger/live-contract-rules.mjs');
const {auditQuotedMarket,summarizeMarketCoverage}=await import('../server/ledger/market-coverage.mjs');
const {automaticComboTemplates}=await import('../server/ledger/automatic-combos.mjs');

const bet=(market_name,outcome_name,line='',extra={})=>({
 market_name,outcome_name,outcome_key:outcome_name,line,period:0,...extra
});
const create=(name,goals=[],corners=[],cards=[])=>{
 const events=[...goals.map(([minute,team],i)=>({id:name+'-g'+i,type:'goal',minute,team,seconds:minute*60+10,player:team+' scorer'})),
  ...corners.map(([minute,team],i)=>({id:name+'-c'+i,type:'corner',minute,team,seconds:minute*60+20})),
  ...cards.map(([minute,team],i)=>({id:name+'-k'+i,type:'card',minute,team,seconds:minute*60+30,cardColor:'yellow'}))]
  .sort((a,b)=>a.seconds-b.seconds);
 const scoreOf=(items,side)=>items.filter(x=>x[1]===side).length;
 const score={
  home_team:'Home Team',away_team:'Away Team',
  home_score:scoreOf(goals,'home'),away_score:scoreOf(goals,'away'),
  half_home_score:scoreOf(goals.filter(x=>x[0]<45),'home'),
  half_away_score:scoreOf(goals.filter(x=>x[0]<45),'away'),
  corners_home:scoreOf(corners,'home'),corners_away:scoreOf(corners,'away'),
  cards_home:scoreOf(cards,'home'),cards_away:scoreOf(cards,'away'),
  statistics:{shots:{home:14,away:9},shotsOnTarget:{home:6,away:3},fouls:{home:12,away:15}}
 };
 const evidenceAt=(clock,ended=false,complete=true)=>{
  const observed=events.filter(e=>e.minute<=clock);
  const counters=kind=>({home:observed.filter(e=>e.type===kind&&e.team==='home').length,
   away:observed.filter(e=>e.type===kind&&e.team==='away').length});
  const team={goal:counters('goal'),corner:counters('corner'),card:counters('card')};
  return {clock,ended,events:observed,teams:team,
   counts:Object.fromEntries(Object.keys(team).map(k=>[k,team[k].home+team[k].away])),
   coverage:complete?{goalThrough:clock,cornerThrough:clock,cardThrough:clock}:{},
   eventListAvailable:true,cardColorsVerified:true};
 };
 return {name,score,final:evidenceAt(96,true),early:evidenceAt(28,false),gap:evidenceAt(96,true,false)};
};
const fixtures=[
 create('HOME_2_1',[[12,'home'],[48,'away'],[63,'home']],
  [[3,'home'],[10,'away'],[15,'home'],[22,'home'],[31,'away'],[39,'home'],[51,'home'],[62,'away'],[70,'home'],[80,'away'],[88,'home']],
  [[17,'home'],[35,'away'],[76,'home']]),
 create('AWAY_0_3',[[20,'away'],[56,'away'],[83,'away']],
  [[8,'away'],[19,'away'],[30,'home'],[48,'away'],[72,'away']],
  [[33,'away'],[47,'away']]),
 create('DRAW_0_0',[],
  [[8,'home'],[28,'away'],[48,'home'],[75,'away']],[]),
 create('DRAW_1_1',[[10,'home'],[70,'away']],
  [[10,'home'],[20,'away'],[30,'home'],[40,'away'],[50,'home'],[60,'away']],
  [[15,'home'],[65,'away']]),
 create('HOME_3_0',[[6,'home'],[40,'home'],[87,'home']],
  [[8,'home'],[14,'home'],[25,'home'],[39,'home'],[49,'home'],[58,'home'],[69,'home']],
  [[19,'home']])
];
const baseline={goal:{home:0,away:0},corner:{home:0,away:0},card:{home:0,away:0}};
const definitionsSample=[
 ['Full Time Result',['1','X','2']],
 ['Double Chance',['1X','12','X2']],
 ['Both Teams to Score',['Yes','No']],
 ['Total Goals',['Over','Under'],'2.5'],
 ['Home Team Total Goals',['Over','Under'],'1.5'],
 ['Total Corners',['Over','Under'],'9.5'],
 ['Total Cards',['Over','Under'],'2.5'],
 ['Correct Score',['2:1','0:0']],
 ['Half Time / Full Time',['1/1','X/2','X/X']],
 ['1st Half Result',['1','X','2']],
 ['2nd Half Result',['1','X','2']],
 ['1st Half Total Goals',['Over','Under'],'0.5'],
 ['2nd Half Total Goals',['Over','Under'],'1.5'],
 ['Result and Total',['1 and Over 2.5','2 and Under 2.5']],
 ['Result and BTTS',['1 & Yes','2 & No']],
 ['Total and BTTS',['Over 2.5 & Yes','Under 2.5 & No']],
 ['1st Half Result and Total',['1 and Over 0.5','2 and Under 0.5']],
 ['Next Goal',['1','2','No Goal']],
 ['Next Corner',['1','2','No Corner']],
 ['First Goal',['1','2','None']],
 ['Last Goal',['1','2','None']],
 ['First Corner',['1','2','None']],
 ['Last Corner',['1','2','None']],
 ['First Card',['1','2','None']],
 ['Which team wins race to 2 goals',['1','2','None']],
 ['Which team wins race to 3 corners',['1','2','None']],
 ['Which team wins race to 2 cards',['1','2','None']],
 ['Will there be a goal in minutes 10-20',['Yes','No']],
 ['Will there be a corner in minutes 10-20',['Yes','No']],
 ['Will there be a card in minutes 10-20',['Yes','No']],
 ['Total Goals in minutes 10-20',['Over','Under'],'0.5'],
 ['Total Corners in minutes 10-20',['Over','Under'],'0.5'],
 ['Who scores most goals in minutes 10-20',['1','X','2']],
 ['Who takes most corners in minutes 10-20',['1','X','2']],
 ['1st half - Home team exact corners',['1','2']],
 ['2nd half - Away team exact cards',['0','1']],
 ['1st half - Away team red card',['Yes','No']],
 ['Player to Score Anytime',['Home scorer','Away scorer']],
 ['Player to Receive Yellow Card',['Home player','Away player']],
 ['Shots on Target: Total',['Over','Under'],'8.5'],
 ['Total Fouls',['Over','Under'],'24.5'],
 ['Asian Handicap',['Home','Away'],'1.25']
];
const builtin=definitionsSample.flatMap(([market,choices,line],i)=>
 choices.map(choice=>({...bet(market,choice,line??''),
  native_market_id:String(10000+i),native_market_name:market,market_key:'simulimi-'+i,scope:'SIMULATED'})));
const uniqueRows=rows=>{
 const seen=new Set();
 return rows.filter(row=>{
  const key=JSON.stringify([row.native_market_id,row.native_market_name,row.market_key,row.market_name,
   row.outcome_key,row.outcome_name,row.line,row.period]);
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
};
const normalized=raw=>{
 const quote=raw?.quotes??raw?.offers??raw?.rows??(Array.isArray(raw)?raw:[]);
 const definitions=raw?.definitions??raw?.markets??[];
 if(!Array.isArray(quote)||!Array.isArray(definitions))throw Error('JSON must contain arrays quotes and definitions.');
 return {definitions,quotes:uniqueRows(quote)};
};
async function loadSource(){
 if(option('catalog')){
  const data=JSON.parse(await readFile(resolve(option('catalog')),'utf8'));
  return {...normalized(data),source:'catalog-file'};
 }
 if(has('db')){
  const {pool}=await import('../server/db.mjs');
  const client=await pool.connect();
  try{
   await client.query('BEGIN READ ONLY');
   await client.query("SET LOCAL statement_timeout = '60000ms'");
   const definitions=(await client.query("select provider_id,scope,native_market_id,native_market_name from app_provider_market_definition where lower(provider_id)='zizobet'")).rows;
   const limit=Number(option('limit')??100001);
   if(!Number.isSafeInteger(limit)||limit<1||limit>500000)throw Error('Invalid --limit: 1..500000.');
   const quotes=(await client.query("select distinct native_market_id,native_market_name,market_key,market_name,outcome_key,outcome_name,line,period from app_provider_offer_current where lower(provider_id)='zizobet' or market_key like 'zz%@%' limit $1",[limit])).rows;
   await client.query('ROLLBACK');
   return {definitions,quotes:uniqueRows(quotes),source:'read-only-db',partial:quotes.length===limit,limit};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();await pool.end();}
 }
 return {definitions:definitionsSample.map(([name],i)=>({native_market_id:String(10000+i),native_market_name:name,scope:'SAMPLE'})),quotes:builtin,source:'built-in-samples'};
}
function simulateQuote(row){
 const line=bet(row.market_name??row.native_market_name,row.outcome_name??row.outcome_key,row.line??'',row);
 const mapping=auditQuotedMarket(line);
 let contract=null,parseError=null;
 try{contract=liveContract(line,{counts:baseline,clock:0,teams:{home:'Home Team',away:'Away Team'}});}
 catch(e){parseError=String(e.message);}
 const snapshots=[],seen=new Set(),conflicts=[];
 for(const fixture of fixtures){
  const final=fixture.final;
  let live=null,ft=null,early=null,gap=null;
  try{
   if(contract){
    live=gradeLiveContract(contract,final,{ended:true,scopeEnded:true});
    early=gradeLiveContract(contract,fixture.early,{ended:false});
    gap=gradeLiveContract(contract,fixture.gap,{ended:true,scopeEnded:true});
   }
   ft=gradeLine(line,fixture.score);
  }catch(e){conflicts.push({scenario:fixture.name,error:String(e.message)});}
  if(live&&ft&&live!==ft)conflicts.push({scenario:fixture.name,live,final:ft});
  const status=live??ft??'PENDING';
  seen.add(status);
  snapshots.push({fixture:fixture.name,status,live:live??'PENDING',final:ft??'PENDING',
   early:early??'PENDING',gap:gap??'PENDING'});
 }
 const status=conflicts.length?'CONFLICT':
  mapping.status!=='RULE_MAPPED'?'NEEDS_RULE':
  seen.size===1&&seen.has('PENDING')?'NOT_EXERCISED':'EXERCISED_NOT_CERTIFIED';
 return {nativeMarketId:String(row.native_market_id??''),market:line.market_name,
  outcome:line.outcome_name,line:line.line,period:line.period,
  mapping:mapping.status,rule:mapping.rule??null,contract:contract?.kind??null,
  status,results:[...seen],parseError,conflicts,snapshots};
}
function independentlyExpected(selection,home,away){
 const outcome=selection.outcome;
 if(selection.market==='1X2')return outcome===(home>away?'1':home<away?'2':'X');
 if(selection.market==='DC')return outcome==='1X'?home>=away:outcome==='X2'?away>=home:home!==away;
 if(selection.market==='BTTS')return outcome==='Yes'?home>0&&away>0:home===0||away===0;
 if(selection.market==='TOTAL')return outcome==='Over'?home+away>Number(selection.line):home+away<Number(selection.line);
 throw Error('Unknown automatic combo leg '+selection.market);
}
function runAssertions(){
 const checks=[],check=(name,run)=>{
  try{run();checks.push({name,status:'PASS'});}
  catch(e){checks.push({name,status:'FAIL',reason:String(e.message)});}
 };
 const H=fixtures[0],A=fixtures[1],Z=fixtures[2];
 for(const [title,line,scenario,expected] of [
  ['1X2 home',bet('Full Time Result','1'),H,'WON'],
  ['1X2 away',bet('Full Time Result','2'),H,'LOST'],
  ['1X2 draw',bet('Full Time Result','X'),Z,'WON'],
  ['Double Chance',bet('Double Chance','1X'),H,'WON'],
  ['BTTS yes',bet('Both Teams to Score','Yes'),H,'WON'],
  ['BTTS no',bet('Both Teams to Score','No'),Z,'WON'],
  ['Total over',bet('Total Goals','Over','2.5'),H,'WON'],
  ['Total under',bet('Total Goals','Under','2.5'),H,'LOST'],
  ['Whole-line push',bet('Total Goals','Over','3.0'),H,'VOID'],
  ['Corner over',bet('Total Corners','Over','10.5'),H,'WON'],
  ['Card under',bet('Total Cards','Under','3.5'),H,'WON'],
  ['Correct score',bet('Correct Score','2:1'),H,'WON'],
  ['1H result',bet('1st Half Result','1'),H,'WON'],
  ['2H result',bet('2nd Half Result','1'),H,'LOST'],
  ['Result + total',bet('Result and Total','1 and Over 2.5'),H,'WON'],
  ['Lose result + total',bet('Result and Total','2 and Over 2.5'),H,'LOST']
 ])check(title,()=>assert.equal(gradeLine(line,scenario.score),expected));
 check('Two-leg combo: both must win',()=>{
  const legs=[bet('Full Time Result','1'),bet('Both Teams to Score','Yes')];
  assert.equal(gradeLine({builder_legs:legs},H.score),'WON');
  assert.equal(gradeLine({builder_legs:legs},A.score),'LOST');
 });
 for(const [name,line,scenario,expected] of [
  ['Next Goal home',bet('Next Goal','1',{toString:()=>''}),H,'WON'],
  ['Next Goal away',bet('Next Goal','2'),H,'LOST'],
  ['Next Corner home',bet('Next Corner','1'),H,'WON'],
  ['Race to 2 goals home',bet('Which team wins race to 2 goals','1',{},{raceNoneOffered:true}),H,'WON'],
  ['Race to 2 goals none',bet('Which team wins race to 2 goals','None','',{raceNoneOffered:true}),Z,'WON'],
  ['Goal interval yes',bet('Will there be a goal in minutes 10-20','Yes'),H,'WON'],
  ['Goal interval no',bet('Will there be a goal in minutes 10-20','No'),H,'LOST'],
  ['Last Goal home',bet('Last Goal','1'),H,'WON'],
  ['Last Goal none',bet('Last Goal','None','',{lastNoneOffered:true}),Z,'WON']
 ])check(name,()=>{
  const contract=liveContract(line,{counts:baseline,clock:0,teams:{home:'Home Team',away:'Away Team'}});
  assert.ok(contract,'Parser did not accept '+name);
  assert.equal(gradeLiveContract(contract,scenario.final,{ended:true}),expected);
 });
 // Complete matrix of every existing automatic 2-leg combination.
 let comboCases=0;
 for(const template of automaticComboTemplates()){
  if(!Array.isArray(template.legs)||template.legs.length!==2)continue;
  check('Automatic combo '+template.name,()=>{
   const names={'1X2':'Full Time Result',DC:'Double Chance',BTTS:'Both Teams to Score',TOTAL:'Total Goals'};
   const legs=template.legs.map(x=>bet(names[x.market],x.outcome,x.line??''));
   for(let h=0;h<=5;h++)for(let a=0;a<=5;a++){
    if(template.legs.some(x=>x.market==='TOTAL'&&Number.isInteger(Number(x.line))))continue;
    const expected=template.legs.every(x=>independentlyExpected(x,h,a))?'WON':'LOST';
    assert.equal(gradeLine({builder_legs:legs},{home_score:h,away_score:a,home_team:'Home Team',away_team:'Away Team'}),expected,
     template.name+' score '+h+':'+a);
    comboCases++;
   }
  });
 }
 return {checks,comboCases,passed:checks.filter(x=>x.status==='PASS').length,
  failed:checks.filter(x=>x.status==='FAIL')};
}
let report;
try{
 const source=await loadSource();
 const regressions=runAssertions();
 const outcomes=source.quotes.map(simulateQuote);
 const statusCounts={};
 for(const row of outcomes)statusCounts[row.status]=(statusCounts[row.status]??0)+1;
 const coverage=summarizeMarketCoverage(source.definitions,source.quotes);
 report={name:'simulimi',createdAt:new Date().toISOString(),source:source.source,
  readOnly:true,noApiCalls:true,noTicketsCreated:true,noBalanceChanges:true,
  partial:source.partial??false,limit:source.limit??null,
  totalDefinitions:source.definitions.length,totalQuotedSelections:source.quotes.length,
  testedSelections:outcomes.length,summary:statusCounts,
  regressions,coverage:coverage.summary,marketFamilies:coverage.markets,
  selections:outcomes,
  warning:'EXERCISED_NOT_CERTIFIED means the real grader returned a status in a synthetic scenario, NOT that the real ticket settlement is fully verified. NOT_EXERCISED and NEEDS_RULE require investigation. --db reads the database only; no writes.'};
 const file=resolve(option('report')??'simulimi-report.json');
 await mkdir(dirname(file),{recursive:true});
 await writeFile(file,JSON.stringify(report,null,2)+'\n','utf8');
 console.log('SIMULIMI | source='+source.source+' | definitions='+source.definitions.length+
  ' | selections='+outcomes.length+' | canaries='+regressions.passed+'/'+regressions.checks.length);
 console.log('Results: '+JSON.stringify(statusCounts)+' | report='+file);
 for(const failure of regressions.failed)console.error('FAIL '+failure.name+': '+failure.reason);
 if(source.partial)console.error('WARNING: Query limit reached. NOT all quote variants were included.');
 if(has('strict')&&(outcomes.some(r=>r.status!=='EXERCISED_NOT_CERTIFIED')||
   coverage.markets.some(m=>m.status==='NOT_QUOTED_IN_SAMPLE')))process.exitCode=1;
 if(regressions.failed.length||outcomes.some(r=>r.status==='CONFLICT'))process.exitCode=1;
}catch(e){
 console.error('SIMULIMI FAILED:',e.stack??e);
 process.exitCode=1;
}
