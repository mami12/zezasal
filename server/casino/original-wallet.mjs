import {Router,text as textBody} from 'express';
import jwt from 'jsonwebtoken';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {config} from '../config.mjs';
import {requireAuth} from '../ledger/auth.mjs';
import {isLedgerReady} from '../ledger/store.mjs';
import {settlePendingWin} from './transactions.mjs';
import {createOriginalWalletStore,ORIGINAL_GAMES,walletFault} from './original-wallet-store.mjs';
import {originalClientShell} from './original-client-shell.mjs';
import {decodeFortuneNative} from './fortune-teller-native.mjs';

const MAX_AGE=7200,cookieName=id=>'casino_original_'+id;
const prefix=id=>'/app/api/casino/original/'+id;
const safe=handler=>(req,res)=>Promise.resolve(handler(req,res)).catch(error=>{
 if(!error.status||error.status>=500)console.error('[original casino]',error);
 res.status(error.status||500).json({error:1,error_txt:error.status?error.message:'Casino service unavailable',message:error.status?error.message:'Casino service unavailable'});
});
function sameOrigin(req){
 if(['cross-site','same-site'].includes(req.get('sec-fetch-site')))throw walletFault(403,'Same origin required');
 if(req.get('origin')&&new URL(req.get('origin')).host!==req.get('host'))throw walletFault(403,'Same origin required');
}
function claim(req,id){
 const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(id)+'='))?.slice(cookieName(id).length+1);
 let value;try{value=jwt.verify(token,config.jwtSecret);}catch{throw walletFault(401,'Game session expired. Reopen the game.');}
 if(value.kind!=='casino-original-wallet'||value.game!==id||typeof value.jti!=='string')throw walletFault(401,'Invalid game session');
 return value;
}
const publicRoot=fileURLToPath(new URL('../../web/public/',import.meta.url));
function assetRoot(){const dist=fileURLToPath(new URL('../../web/dist/',import.meta.url));return existsSync(path.join(dist,'index.html'))?dist:publicRoot;}
function shell(file,base,settings={}){
 const html=readFileSync(path.join(assetRoot(),file),'utf8');
 return originalClientShell(html,base,settings);
}
export function createOriginalWalletRouter({store=createOriginalWalletStore(),auth=requireAuth,ready=isLedgerReady}={}){
 const router=Router();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!ready())return res.status(503).json({message:'Ledger unavailable'});next();});
 router.post('/pixi/close',auth,safe(async(req,res)=>{
  sameOrigin(req);if(req.user.role!=='PLAYER'||req.user.status!=='ACTIVE')throw walletFault(403,'Player account required');
  res.json({balance:await settlePendingWin(req.user.id)});
 }));
 router.post('/:id/session',auth,safe(async(req,res)=>{
  sameOrigin(req);const id=req.params.id;
  if(req.user.role!=='PLAYER'||req.user.status!=='ACTIVE')throw walletFault(403,'Player account required');
  const epoch=Number(req.user.financialEpoch??0),{sessionId,mathVersion}=await store.launch(req.user.id,id,{mathVersion:req.body?.mathVersion,epoch});
  res.cookie(cookieName(id),jwt.sign({kind:'casino-original-wallet',sub:req.user.id,game:id,jti:sessionId,epoch},config.jwtSecret,{expiresIn:MAX_AGE}),{httpOnly:true,sameSite:'strict',secure:req.secure||req.get('x-forwarded-proto')==='https',path:prefix(id),maxAge:MAX_AGE*1000});
  const url=new URL(prefix(id)+'/launch','http://local');
    if(ORIGINAL_GAMES[id].kind==='ct')url.search=new URLSearchParams({locale:'en-GB',lang:'en_GB',game_id:'wallet',serverurl:prefix(id)+'/rgsm',exitAllow:'0',video:'0'});
  res.json({ready:true,gameUrl:url.pathname+url.search,mathVersion});
 }));
 router.post('/:id/close',auth,safe(async(req,res)=>{
  sameOrigin(req);const c=claim(req,req.params.id);if(c.sub!==req.user.id)throw walletFault(403,'Wrong player');
  res.json(await store.close(c.sub,c.game,c.jti,{epoch:Number(c.epoch??0)}));
 }));
 router.get('/:id/launch',safe(async(req,res)=>{
  const c=claim(req,req.params.id),g=ORIGINAL_GAMES[c.game];if(!g)throw walletFault(404,'Unknown game');
  // Verify current player, casino and durable session before shipping the client.
  await store.inspect(c.sub,c.game,c.jti,{epoch:Number(c.epoch??0)});
  if(['firejoker','fortune-teller'].includes(c.game)){
   const base='/app/casino-original/'+c.game+'/';
   // Fortune Teller runs the complete supplied renderer through its native
   // packet adapter. Fire Joker retains its existing CT-compatible client.
   const entry = 'casino-original/'+c.game+'/index.html';
   return res.type('html').send(shell(entry,base,{game:c.game,serverUrl:prefix(c.game)+'/rgsm',...(c.game==='fortune-teller'?{nativeSessionId:c.jti}:{})}));
  }
    const agtFolder=g.folder??'agt';
    const base=g.kind==='ct'?`/app/casino-original/${g.folder}/vendor/html-20200413-stable/${g.app}/`:`/app/casino-original/${agtFolder}/`;
    res.type('html').send(shell(g.kind==='ct'?`casino-original/${g.folder}/vendor/html-20200413-stable/${g.app}/app.html`:`casino-original/${agtFolder}/${g.app}.html`,base,{game:c.game,agtApi:prefix(c.game)+'/dinit.php'}));
 }));
 router.get('/ice-fruits-6x3/launch/info',safe(async(req,res)=>{
  sameOrigin(req);const c=claim(req,'ice-fruits-6x3');
  await store.inspect(c.sub,c.game,c.jti,{epoch:Number(c.epoch??0)});
  const base='/app/casino-original/ice-fruits-6x3/images/games/6megaice/ui/';
  res.type('html').send([0,1,2].map(page=>`<img src="${base}page${page}.webp" alt="Ice Fruits · ${page+1}" style="display:block;width:100%;height:auto">`).join(''));
 }));
 router.get('/:id/rgsm',safe(async(req,res)=>{
  sameOrigin(req);const c=claim(req,req.params.id);
  if(ORIGINAL_GAMES[c.game]?.kind!=='ct')throw walletFault(404,'Unknown protocol');
  let commands;try{commands=JSON.parse(req.query.request);}catch{throw walletFault(400,'Invalid request');}
  if(!Array.isArray(commands)||!commands.length||commands.length>20||commands.some(x=>!x||typeof x.command!=='string'||!Number.isSafeInteger(x.sequence_number)||x.sequence_number<0))throw walletFault(400,'Invalid commands');
  if(commands.some(command=>command.native))throw walletFault(400,'Use the native game endpoint');
  res.json(await store.act(c.sub,c.game,c.jti,commands,{epoch:Number(c.epoch??0)}));
 }));
 router.post('/fortune-teller/native',textBody({type:'text/plain',limit:'8kb'}),safe(async(req,res)=>{
  sameOrigin(req);const c=claim(req,'fortune-teller');
  if(typeof req.body!=='string'||req.body.split(/\r?\n/)[1]!==c.jti)throw walletFault(401,'Game frame expired. Reopen the game.');
  const command=decodeFortuneNative(req.body);
  try{
   const [reply]=await store.act(c.sub,c.game,c.jti,[command],{epoch:Number(c.epoch??0)});
   if(!reply.native_packet)throw walletFault(400,reply.status?.msg||'Game action rejected');
   res.type('text/plain').send(reply.native_packet);
  }catch(error){
   if(error.status!==400)throw error;
   const {balance}=await store.inspect(c.sub,c.game,c.jti,{epoch:Number(c.epoch??0)});
   const message=JSON.stringify(String(error.message).replace(/[\r\n]/g,' '));
   res.type('text/plain').send('d=\r\n90 '+Math.round(balance*100)+' 0 "" '+message+'\r\n');
  }
 }));
 // Bridge for the legacy Pixi client that POSTs FormData {data:'{"action":"init"...}'}
 // or a JSON body to /rgsm. Converts to a single CT command so the same
 // wallet-store transaction settles funds. Mirrors the GET ?request= route above.
 router.post('/:id/rgsm',async(req,res,next)=>{
  const chunks=[];for await (const chunk of req) chunks.push(chunk);
  req.rawRgsmBody=Buffer.concat(chunks);
  next();
 },safe(async(req,res)=>{
  sameOrigin(req);const c=claim(req,req.params.id);
  if(ORIGINAL_GAMES[c.game]?.kind!=='ct')throw walletFault(404,'Unknown protocol');
  let payload=req.rawRgsmBody&&req.rawRgsmBody.length?req.rawRgsmBody.toString('utf8'):'';
  const ct=String(req.get('content-type')||'').toLowerCase();
  let parsed;
  if(payload){
    const trimmed=payload.trim();
    if(ct.includes('multipart/form-data')){
      const boundaryMatch=ct.match(/boundary=(?:"([^"]+)"|([^;]+))/);
      if(boundaryMatch){
        const boundary='--'+(boundaryMatch[1]||boundaryMatch[2]).trim();
        const parts=payload.split(boundary);
        const fields={};
        for(const part of parts){
          const sepIndex=part.indexOf('\r\n\r\n');
          if(sepIndex<0)continue;
          const headers=part.slice(0,sepIndex);
          const body=part.slice(sepIndex+4).replace(/\r\n--?$/,'').replace(/\r\n$/,'');
          const nameMatch=headers.match(/name="([^"]+)"/);
          if(nameMatch)fields[nameMatch[1]]=body;
        }
        parsed=fields;
      }
    }else if(ct.includes('application/json')||trimmed.startsWith('{')||trimmed.startsWith('[')){
      try{parsed=JSON.parse(trimmed);}catch{throw walletFault(400,'Invalid JSON body');}
    }else{
      try{parsed=Object.fromEntries(new URLSearchParams(trimmed));}catch{parsed=null;}
    }
  }else if(req.body&&typeof req.body==='object'&&Object.keys(req.body).length){
    parsed=req.body;
  }
  if(parsed&&typeof parsed==='object'&&typeof parsed.data==='string'){
    // Play'n GO clients have sent this field as raw JSON as well as a
    // percent-encoded JSON string, depending on which launcher build submits it.
    const data=parsed.data.replace(/^\uFEFF/,'').trim();
    let decoded=data;
    try{parsed=JSON.parse(data);}catch{
      try{decoded=decodeURIComponent(data);parsed=JSON.parse(decoded);}catch{
        console.warn('[rgsm] invalid wrapped data field',{
          contentType:ct,
          dataLength:data.length,
        });
        throw walletFault(400,'Invalid data');
      }
    }
  }
  if(!parsed||typeof parsed!=='object')throw walletFault(400,'Invalid payload');
  // The original CT client sends diagnostic packets as form-encoded arrays.
  // Acknowledge authenticated diagnostics without logging captured session data
  // or treating an unsequenced diagnostic as a financial command.
  if(typeof parsed.request==='string'){
    if(parsed.request.length>16384)throw walletFault(400,'Diagnostic packet too large');
    let diagnostics;try{diagnostics=JSON.parse(parsed.request);}catch{throw walletFault(400,'Invalid diagnostic packet');}
    if(!Array.isArray(diagnostics)||!diagnostics.length||diagnostics.length>20||diagnostics.some(item=>item?.command!=='trace'))throw walletFault(400,'Send wagering commands through the sequenced endpoint');
    await store.inspect(c.sub,c.game,c.jti,{epoch:Number(c.epoch??0)});
    return res.json(diagnostics.map(()=>({_req_command:'trace',status:{status:'ok'}})));
  }
  if(parsed.native)throw walletFault(400,'Use the native game endpoint');
  const cmd=parsed.command||parsed.action;
  if(typeof cmd!=='string'){
    console.error('[rgsm] unrecognized payload keys:',Object.keys(parsed).join(','));
    throw walletFault(400,'Invalid command: '+Object.keys(parsed).join(','));
  }
  const seq=Number.isSafeInteger(parsed.sequence_number)?parsed.sequence_number:0;
  const commands=[{...parsed,command:cmd,sequence_number:seq}];
  res.json(await store.act(c.sub,c.game,c.jti,commands,{epoch:Number(c.epoch??0)}));
 }));
 router.get('/:id/dinit.php',safe(async(req,res)=>{
  sameOrigin(req);const c=claim(req,req.params.id);
  if(ORIGINAL_GAMES[c.game]?.kind!=='agt')throw walletFault(404,'Unknown protocol');
  // Only wager fields participate in replay keys; cache busting/statistics do not.
  const fields=['action','gamename','li','di','amount','color','request_id'];
  const params=Object.fromEntries(fields.filter(k=>req.query[k]!==undefined).map(k=>[k,req.query[k]]));
  const reply=await store.act(c.sub,c.game,c.jti,params,{epoch:Number(c.epoch??0)});
  // Provider token-compatibility marker only. Authentication/funds are the
  // verified HttpOnly wallet cookie and the SQL transaction above.
  res.set('token','demo');res.json(reply);
 }));
 return router;
}
// Keep existing Pixi money clients inside the parent fullscreen container too.
export const originalFrameShellRouter=Router();
originalFrameShellRouter.get('/:id/index-real.html',safe(async(req,res,next)=>{
 if(!['sizzling','bookofra','firejoker'].includes(req.params.id))return res.sendStatus(404);
 res.set('Cache-Control','no-store').type('html').send(shell(`casino-original/${req.params.id}/index-real.html`,`/app/casino-original/${req.params.id}/`,{game:req.params.id}));
}));
