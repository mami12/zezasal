import {Router} from 'express';
import {randomBytes,randomInt} from 'node:crypto';
import {spin} from './lucky-clover-engine.mjs';
import {ctConfig} from './clover-ct-config.mjs';
import {createCtProtocol} from './ct-protocol.mjs';
export function createCtProtocolRouter({spinFn=spin,cardRandom=randomInt,configFn=ctConfig,initialGrid=()=>spin(5).grid,selectedLines=5,cookieName='ct_clover_demo',apiPath='/app/api/casino/luckycloverx3',mapRound}={}){
 const router=Router(),sessions=new Map();
 const protocol=createCtProtocol({spinFn,cardRandom,configFn,initialGrid,selectedLines,mapRound});
 router.get('/rgsm',(req,res)=>{
  res.set('Cache-Control','no-store');if(req.get('sec-fetch-site')==='cross-site')return res.sendStatus(403);
  let commands;try{commands=JSON.parse(req.query.request);if(!Array.isArray(commands)||!commands.length||commands.length>20||commands.some(c=>!c||typeof c.command!=='string'||!Number.isSafeInteger(c.sequence_number)||c.sequence_number<0))throw 0;}catch{return res.status(400).json({error:'Invalid request'});}
  const now=Date.now();for(const [k,s] of sessions)if(now-s.seen>4*3600000)sessions.delete(k);
  let cookie=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.split('=')[1],s=sessions.get(cookie);
  if(!s){if(commands[0]?.command!=='create_session')return res.status(401).json({error:'Session expired. Reload the game.'});if(sessions.size>=2000)return res.sendStatus(503);cookie=randomBytes(24).toString('hex');s={...protocol.initialState(),seen:now};sessions.set(cookie,s);res.setHeader('Set-Cookie',`${cookieName}=${cookie}; Path=${apiPath}; HttpOnly; SameSite=Strict; Max-Age=14400${req.secure?'; Secure':''}`);}
  s.seen=now;
  const responses=protocol.run(s,commands);
  res.json(responses);
 });
 return router;
}
