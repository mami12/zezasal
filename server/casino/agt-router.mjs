import {Router} from 'express';
import {randomBytes,randomInt} from 'node:crypto';
import {DATA,spin} from './agt-engine.mjs';
import {createAgtProtocol} from './agt-protocol.mjs';
export {formatAgtSpin} from './agt-protocol.mjs';
export function createAgtRouter({spinFn=spin,cardRandom=randomInt}={}){
 const router=Router(),sessions=new Map(),protocol=createAgtProtocol({spinFn,cardRandom});
 router.get('/dinit.php',(req,res)=>{
  res.set({'Cache-Control':'no-store',token:'demo'});
  if(req.get('sec-fetch-site')==='cross-site')return res.sendStatus(403);
  const id=String(req.query.gamename||''),d=DATA.games[id];
  if(!d)return res.status(400).json({error:1,error_txt:'game_not_found'});
  const now=Date.now();for(const [key,s] of sessions)if(now-s.seen>4*3600000)sessions.delete(key);
  const name='agt_'+id+'_demo';let cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1),s=sessions.get(cookie);
  if(!s){if(sessions.size>=2000)return res.sendStatus(503);cookie=randomBytes(24).toString('hex');s={...protocol.initialState(id),seen:now};sessions.set(cookie,s);res.append('Set-Cookie',`${name}=${cookie}; Path=/app/api/casino/agt; HttpOnly; SameSite=Strict; Max-Age=14400${req.secure?'; Secure':''}`);}
  s.seen=now;
  try{return res.json(protocol.run(s,req.query));}catch{return res.status(400).json({error:1,error_txt:'not_enough_credits'});}
 });
 return router;
}
