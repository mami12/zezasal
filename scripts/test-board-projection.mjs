import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../server/db.mjs';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import { config } from '../server/config.mjs';
import { projectBoardMatches } from '../server/ledger/board-projection.mjs';
import { ledgerRouter } from '../server/ledger/routes.mjs';
import { initLedgerSchema } from '../server/ledger/store.mjs';
import * as matches from '../server/match-store.mjs';
import * as odds from '../server/odds-store.mjs';
import { snapshot } from '../server/ledger/overrides.mjs';
import { signToken } from '../server/ledger/auth.mjs';

const raw = [{id:'1',marketCount:80,markets:[
  {name:'1st Half Result',period:1,line:''},
  {name:'Full Time Result',period:0,line:''},
  {name:'Match Result',period:0,line:''},
  {name:'Total Goals',period:0,line:'3.5'},
  {name:'Total Goals',period:0,line:'2.5'},
  {name:'Both Teams To Score',period:0,line:''},
  {name:'Result and Total Goals',period:0,line:'2.5'},
  {name:'Corners',period:0,line:'2.5'},
]}];
const original = structuredClone(raw), projected = projectBoardMatches(raw);
assert.deepEqual(raw,original,'projection never mutates full detail data');
assert.equal(projected[0].marketCount,80);
assert.deepEqual(projected[0].markets.map(m=>m.name),['Full Time Result','Total Goals','Total Goals','Both Teams To Score']);
assert.deepEqual(projected[0].markets.filter(m=>m.name==='Total Goals').map(m=>m.line),['3.5','2.5']);
assert.equal(projectBoardMatches([{markets:raw[0].markets}])[0].marketCount,8);
assert.deepEqual(projectBoardMatches([{marketCount:20}])[0].markets,[]);

const suspendedResult={id:'native-result',name:'Full Time Result',period:0,status:'SUSPENDED',outcomes:[{id:'original-1',price:2.1}]};
const doubleChance={id:'native-dc',name:'Double Chance',period:0,status:'ACTIVE',outcomes:[{id:'original-1x',price:1.4}]};
const alternatives=projectBoardMatches([{markets:[suspendedResult,doubleChance,
  ...Array.from({length:13},(_,index)=>({name:'Total Goals',period:0,line:String(index+0.5),status:index===2?'SUSPENDED':'ACTIVE'})),
  {name:'Total Corners',period:0,line:'3.5'},
  {name:'Total Cards',period:0,line:'3.5'},
  {name:'Home Total Goals',period:0,line:'3.5'},
  {name:'Total Goals',period:1,line:'3.5'},
  {name:'First Half Total Goals',period:0,line:'3.5'},
  {name:'Total Goals and BTTS',period:0,line:'3.5'},
]}])[0];
assert.equal(alternatives.markets[0],suspendedResult,'suspended 1X2 is kept with its original identity');
assert.equal(alternatives.markets[1],doubleChance,'double chance is available as a distinct native fallback');
assert.equal(alternatives.markets.filter(m=>m.name==='Total Goals').length,13,'higher playable totals cannot be cut off by a fixed line limit');
assert.equal(alternatives.markets.at(-1).line,'12.5');
assert.equal(alternatives.markets.length,15,'half, team, corner, card and mixed contracts are excluded');
assert.equal(alternatives.markets.find(m=>m.line==='2.5').status,'SUSPENDED','projection does not unlock or discard suspended totals');

const sql = new PGlite(), originalQuery = pool.query;
let server, catalogQueries=0;
pool.query=(text,params)=>{
  if(/select[\s\S]*from app_bet_builder_template/i.test(text)) catalogQueries++;
  if(text===LEDGER_SQL)return sql.exec(text).then(()=>({rows:[]}));
  return sql.query(text,params);
};
try {
  config.matchStore='memory';config.oddsStore='memory';
  snapshot().at=Number.MAX_SAFE_INTEGER;
  await initLedgerSchema();catalogQueries=0;
  matches.clear();
  const matchId=774411;
  matches.upsert([{match_id:matchId,sport_id:18,sport_tag:'football',category_slug:'test',category_name:'Test',
    tournament_id:1,tournament_name:'Test league',home:'Home',away:'Away',service:'PREMATCH',start_at:new Date(Date.now()+3600000)}]);
  const source=[
    ...['1','X','2'].map((outcomeKey,index)=>({marketKey:'result',marketName:'Full Time Result',line:'',outcomeKey,outcomeName:outcomeKey,price:2+index})),
    ...['Over','Under'].map(outcomeKey=>({marketKey:'total',marketName:'Total Goals',line:'2.5',outcomeKey,outcomeName:outcomeKey,price:1.9})),
    ...['Yes','No'].map(outcomeKey=>({marketKey:'btts',marketName:'Both Teams To Score',line:'',outcomeKey,outcomeName:outcomeKey,price:1.9})),
    ...Array.from({length:100},(_,index)=>({marketKey:`corners${index}`,marketName:'Total Corners',line:`${index}.5`,outcomeKey:'Over',outcomeName:'Over',price:2})),
  ].map(row=>({matchId,...row}));
  odds.applyRows(source);
  const app=express();app.use('/app/api',ledgerRouter);
  server=await new Promise(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
  const base=`http://127.0.0.1:${server.address().port}/app/api`;
  const playerId='00000000-0000-4000-8000-000000004412';
  await sql.query(`insert into app_user(id,username,password_hash,role,balance) values($1,'sync-fixture','unused','PLAYER',321.09)`,[playerId]);
  const headers={Authorization:`Bearer ${signToken({id:playerId,username:'sync-fixture',role:'PLAYER'})}`};
  const account=await fetch(base+'/auth/me',{headers});
  assert.equal(account.status,200);assert.equal((await account.json()).balance,321.09);
  for(const key of ['cache-control','cdn-cache-control','cloudflare-cdn-cache-control'])assert.match(account.headers.get(key),/no-store/,'authenticated balance cannot be cached');
  await sql.query('update app_user set balance=222.22 where id=$1',[playerId]);
  const refreshed=await fetch(base+'/auth/me',{headers});
  assert.equal((await refreshed.json()).balance,222.22,'same account URL returns current authoritative ledger balance');
  const get=async path=>{const response=await fetch(base+path);assert.equal(response.status,200,path);return response.json();};
  for(const path of ['/matches?view=board','/sports/18/matches?view=board']){
    const board=await get(path);assert.equal(board.length,1);assert.equal(board[0].markets.length,3);
    assert.equal(board[0].marketCount,103,'board retains full detail market count');
    assert.equal(catalogQueries,0,'board must never load or decorate builder templates');
  }
  const full=await get('/matches');
  assert.equal(full[0].markets.length,103,'default API retains full market semantics');
  assert.ok(catalogQueries>0,'default full API still applies existing builder policy');
  const board=await get('/matches?view=board');
  assert.ok(JSON.stringify(board).length<JSON.stringify(full).length/8,'board payload materially shrinks while keeping playable base prices');
  assert.deepEqual(await get('/sports/99/matches?view=board'),[]);
  const detail=await get(`/matches/${matchId}`);
  assert.ok(detail.markets.length>=103,'detail endpoint retains all underlying markets');

  const fallbackId=774412;
  matches.upsert([{match_id:fallbackId,sport_id:18,sport_tag:'football',category_slug:'test',category_name:'Test',
    tournament_id:1,tournament_name:'Test league',home:'Fallback Home',away:'Fallback Away',service:'PREMATCH',start_at:new Date(Date.now()+3600000)}]);
  odds.applyRows([
    ...['1X','12','X2'].map(outcomeKey=>({marketKey:'dc',marketName:'Double Chance',line:'',outcomeKey,outcomeName:outcomeKey,price:1.6})),
    ...['3.5','4.5'].flatMap(line=>['Over','Under'].map(outcomeKey=>({marketKey:'total',marketName:'Total Goals',line,outcomeKey,outcomeName:outcomeKey,price:1.9}))),
    ...['Yes','No'].map(outcomeKey=>({marketKey:'btts',marketName:'Both Teams To Score',line:'',outcomeKey,outcomeName:outcomeKey,price:1.8})),
  ].map(row=>({matchId:fallbackId,...row})));
  for(const route of ['/matches?view=board','/sports/18/matches?view=board']) {
    const fallback=(await get(route)).find(match=>String(match.id)===String(fallbackId));
    assert.ok(fallback,'fallback fixture reaches both HTTP board endpoints');
    assert.ok(!fallback.markets.some(m=>/Full Time Result/.test(m.name)),'removed 1X2 is not synthesized');
    const dc=fallback.markets.find(m=>m.name==='Double Chance');
    assert.ok(dc,'native double chance survives the board projection');
    assert.ok(dc.outcomes.some(outcome=>outcome.id===`${fallbackId}|dc||1X`),'original outcome IDs survive HTTP serialization');
    assert.deepEqual(fallback.markets.filter(m=>m.name==='Total Goals').map(m=>String(m.line)).sort(),['3.5','4.5'],'alternate actual totals reach the browser when 2.5 is absent');
    assert.ok(fallback.markets.some(m=>m.name==='Both Teams To Score'),'BTTS fallback stays available');
  }
  console.log('PASS board projection: all native full-time goal lines, DC/BTTS alternatives, suspension identity, excluded scopes, both HTTP routes, fresh balances, no builder catalog work and smaller payload');
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  pool.query=originalQuery;await sql.close();
}
