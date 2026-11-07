import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {eventMarketRequirement} from '../server/ledger/event-market-policy.mjs';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {resolveSelection} from '../server/ledger/bets.mjs';
import {toClientMatch} from '../server/ledger/view.mjs';
import {config} from '../server/config.mjs';
import {pool} from '../server/db.mjs';
import * as matches from '../server/match-store.mjs';
import * as odds from '../server/odds-store.mjs';
import {setFeedMode,FEED_LIVE} from '../server/idle-mode.mjs';

const src=new URL('../web/src/utils/marketExpiry.ts',import.meta.url);
const code=ts.transpileModule(readFileSync(src,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText
 .replace(/from\s+(['"])(\.[^'"]+)\1/g,(_m,q,relative)=>`from ${q}${new URL(relative,src).href}${q}`);
const {filterDecidedOutcomes,isMarketOfferSupported}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const unsupported=['Player to score','Anytime Goal Scorer - Within the Regular Time','Player to Score Anytime','Player Total Goals','Haaland to score 2 goals',
 'Time of Scoring','Goal before 20 minutes','1X2 till the 15th minute','Total Goals in Minutes 1-15','To Score In Both Halves',
 'Next Goal','First Team To Score','Last Goal','3rd Goal','Race to 3 Goals','Own Goals','Full Time Result (Early payout 1:0)',
 'To Score Anytime','Mohamed Salah to Score','Mohamed Salah Total Goals','Total Goals (00:00 - 14:59)','Goals 0-15'];
const final={home_team:'Home',away_team:'Away',home_score:8,away_score:2,corners_home:10,corners_away:5,cards_home:4,cards_away:1};
config.matchStore='memory';config.oddsStore='memory';setFeedMode(FEED_LIVE);
matches.upsert([{match_id:887111,home:'Home',away:'Away',service:'PREMATCH',active:true,start_at:new Date(Date.now()+3600000),raw:{}}]);
let sqlCalls=0;
const executor=async()=>{sqlCalls++;throw Error('No database calls or wallet writes expected for unsupported contracts');};
try{
 for(const [i,name] of unsupported.entries()){
  const line={market_name:name,outcome_name:'Over',outcome_key:'Over',line:'1.5'};
  assert.ok(eventMarketRequirement(line),name);
  assert.equal(hasRequiredSettlementEvidence(line,final),false,name+' needs event evidence');
  assert.equal(gradeLine(line,final),'VOID',name+' cannot be paid/lost from final totals');
  const market={name,line:'1.5',outcomes:[{id:'o',name:'Over',odds:2,status:'ACTIVE'}]};
  assert.equal(isMarketOfferSupported(market),false);
  assert.deepEqual(filterDecidedOutcomes(market.outcomes,market,{status:'PREMATCH'}),[]);
  assert.deepEqual(filterDecidedOutcomes(market.outcomes,market,{status:'LIVE',currentMinute:1,homeScore:0,awayScore:0}),[]);
  const key='event-'+i;
  odds.applyRows([{matchId:887111,marketKey:key,marketName:name,line:'1.5',outcomeKey:'Over',outcomeName:'Over',price:2,column:'other'}]);
  await assert.rejects(resolveSelection({outcomeId:`887111|${key}|1.5|Over`,oddsAtPlacement:2},{executor}),error=>error.code==='MARKET_EVIDENCE_UNSUPPORTED');
  const shown=toClientMatch({id:887111,home:'Home',away:'Away',markets:[{key,name,line:'1.5',outcomes:[{key:'Over',name:'Over',price:2}]}]});
  assert.equal(shown.markets.length,0,'public API never advertises unsupported event contracts');
 }
 assert.equal(sqlCalls,0);
 for(const name of ['1X2','Full Time Result','Both Teams To Score','Total Goals','Double Chance','1st Half Total','2nd Half Total'])assert.equal(eventMarketRequirement({name}),null,name);
 assert.equal(hasRequiredSettlementEvidence({market_name:'Full Time Result'},final),true);
 assert.equal(hasRequiredSettlementEvidence({builder_legs:[{market_name:'1X2'},{market_name:'Player to Score Anytime'}]},final),false);
 const shot={market_name:'Total Shots on Target',line:'8.5',outcome_key:'Over',outcome_name:'Over'};
 assert.equal(hasRequiredSettlementEvidence(shot,final),false,'goal score cannot substitute for on-target shots');
 assert.equal(gradeLine(shot,{...final,statistics:{shotsOnTarget:{home:5,away:2}}}),'LOST');
 assert.equal(gradeLine({...shot,line:'6.5'},{...final,statistics:{shotsOnTarget:{home:5,away:2}}}),'WON');
 const teamFinal={...final,home_team:'Arsenal',away_team:'Chelsea',home_score:1,away_score:4};
 const goalLine={line:'2.5',outcome_key:'Over',outcome_name:'Over'};
 assert.equal(gradeLine({...goalLine,market_name:'Arsenal Total Goals'},teamFinal),'LOST','team goals cannot use both teams');
 assert.equal(gradeLine({...goalLine,market_name:'Chelsea Total Goals'},teamFinal),'WON');
 assert.equal(gradeLine({...goalLine,market_name:'Total Goals'},teamFinal),'WON');
 assert.equal(gradeLine({...goalLine,market_name:'Red Star Total Goals'},{...teamFinal,home_team:'Red Star'}),'LOST','team name is not a red-card contract');
 assert.equal(eventMarketRequirement({name:'Arsenal Total Goals'},teamFinal),null);
 assert.equal(eventMarketRequirement({name:'Salah Total Goals'},teamFinal),'GOAL_CONTRACT_DATA_REQUIRED');
 assert.equal(isMarketOfferSupported({name:'Arsenal Total Goals'}, {homeTeam:'Arsenal',awayTeam:'Chelsea'}),true);
 console.log('PASS event contracts: publication + frontend + authoritative placement + settlement agree; no player/minute/event-order guesses, no wallet calls, stat counters never replaced by goals');
}finally{odds.clearMatch(887111);matches.clear();await pool.end();}
