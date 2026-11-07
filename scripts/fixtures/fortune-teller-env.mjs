import './isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {fileURLToPath} from 'node:url';
import {LEDGER_SQL} from '../../server/ledger/schema.mjs';
import {createOriginalWalletStore} from '../../server/casino/original-wallet-store.mjs';
import {createOriginalWalletRouter} from '../../server/casino/original-wallet.mjs';
import {createFortuneTellerProtocol} from '../../server/casino/fortune-teller-protocol.mjs';
import {FORTUNE_DATA} from '../../server/casino/fortune-teller-engine.mjs';

// In-memory PostgreSQL only. These deterministic draws are never installed in production.
export async function fortuneFixture(){
 const sql=new PGlite();await sql.exec(LEDGER_SQL);
 let queue=Promise.resolve(),draws=[],drawCount=0;
 const database={async connect(){let release;const next=new Promise(resolve=>release=resolve),before=queue;queue=next;await before;return {query:(...args)=>sql.query(...args),release};}};
 const manager=randomUUID(),user=randomUUID(),other=randomUUID();
 for(const[id,role,balance,owner]of [[manager,'MANAGER',10000,null],[user,'PLAYER',10000,manager],[other,'PLAYER',10000,null]])await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1,$2,$3,$4,$5,$6)',[id,id,'test-only',role,balance,owner]);
 const random=bound=>{drawCount++;const value=draws.length?draws.shift():0;assert.ok(value>=0&&value<bound,'fixture draw is a valid stop');return value;};
 const fortuneTeller=createFortuneTellerProtocol({random});
 const makeStore=()=>createOriginalWalletStore({database,fortuneTeller});let store=makeStore();
 const balance=async(id=user)=>Number((await sql.query('select balance from app_user where id=$1',[id])).rows[0].balance);
 const count=async()=>Number((await sql.query('select count(*) as n from app_casino_round')).rows[0].n);
 const reels=FORTUNE_DATA.reels[String(FORTUNE_DATA.defaultRtp)];
 function stops(symbol,count){return reels.map((reel,index)=>{
  const stop=reel.findIndex((_,start)=>{const window=[0,1,2].map(row=>reel[(start+row)%reel.length]);return index<count?window.includes(symbol)&&!window.includes(symbol===2?3:2):!window.includes(2)&&!window.includes(3);});
  assert.ok(stop>=0);return stop;
 });}
 function scenario(kind='cards'){
  assert.equal(draws.length,0,'previous scripted round was consumed');
  const neutral=stops(2,0),cards=stops(3,3);
  draws=kind==='normal'?neutral:kind==='free'?[...stops(2,3),...cards,0,2,3,...Array.from({length:14},()=>neutral).flat()]:[...cards,0,2,3];
 }
 const app=express();app.use(express.json());let drop=null;const commands=[];
 app.use('/app/api/casino/original',(req,res,next)=>{
  if(req.query.request){const command=JSON.parse(req.query.request)[0];commands.push(command);
   if(command.command===drop){drop=null;const json=res.json.bind(res);res.json=()=>json.call(res.status(503),{message:'Simulated lost success response after commit'});}
  }next();
 });
 const auth=(req,res,next)=>{if(req.get('x-test-player')!=='isolated-player')return res.sendStatus(401);req.user={id:user,role:'PLAYER',status:'ACTIVE'};next();};
 // Delegate to the current store to simulate a server restart without losing SQL state.
 const delegate=Object.fromEntries(['launch','act','close','inspect'].map(name=>[name,(...args)=>store[name](...args)]));
 app.use('/app/api/casino/original',createOriginalWalletRouter({store:delegate,auth,ready:()=>true}));
 app.use('/app',express.static(fileURLToPath(new URL('../../web/public/',import.meta.url))));
 app.get('/',(_req,res)=>res.type('html').send('<!doctype html><title>Isolated Fortune Teller test</title>'));
 return {sql,app,user,other,manager,balance,count,scenario,commands,makeStore,
  get store(){return store;},get drawCount(){return drawCount;},get remainingDraws(){return draws.length;},
  restart(){store=makeStore();},dropNext(command){drop=command;},async close(){await sql.close();}};
}
