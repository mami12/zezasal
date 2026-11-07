import {managerCasinoSettings} from './manager-settings.mjs';
/**
 * Same-origin real wallet protocol for the unchanged Novomatic Pixi/Spine
 * browser client. This adapter is NOT licensed/certified provider game math.
 * It is completely isolated from the original demo endpoint.
 */
import {Router,raw} from 'express';
import jwt from 'jsonwebtoken';
import {randomUUID,createHash} from 'node:crypto';
import {config} from '../config.mjs';
import {requireAuth} from '../ledger/auth.mjs';
import {getUserById,isLedgerReady} from '../ledger/store.mjs';
import {query} from '../db.mjs';
import {decodeRequest,initResponse} from './sizzling-demo.mjs';
import {placeCasinoSpin,settlePendingWin} from './transactions.mjs';
import {casinoGambleAction} from './gamble.mjs';
import {assertCasinoMathAcknowledged} from './casino-controls.mjs';

const COOKIE='casino_pixi_wallet_session',MAX_AGE=60*60*2;
const fault=(status,message)=>Object.assign(new Error(message),{status});
const cookieValue=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim())
  .find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
// The original Pixi XHR maps *any* non-200 status to "Internal Server
// Error! Back to Lobby". Expected game failures are protocol JSON errors,
// not infrastructure failures. Preserve genuine HTTP 5xx for server faults.
const deny=(res,error,action='unknown')=>{
  const status=Number(error?.status)||500;
  const message=status>=500?'CASINO_SERVICE_ERROR':String(error.message||'CASINO_REQUEST_REJECTED');
  if(status>=500)console.error('[casino pixi] failed action='+action,error);
  else console.warn('[casino pixi] rejected action='+action+' status='+status+' code='+message);
  if(status<500)return res.status(200).json({error:{code:status,message}});
  return res.status(status).json({error:{code:status,message}});
};
function uuidFromId(nonce,requestId){
  const h=createHash('sha256').update(nonce+':'+requestId).digest();
  h[6]=(h[6]&0x0f)|0x40;h[8]=(h[8]&0x3f)|0x80;
  const a=h.toString('hex').slice(0,32);
  return [a.slice(0,8),a.slice(8,12),a.slice(12,16),a.slice(16,20),a.slice(20)].join('-');
}
async function ensureAdminEnabled(){
  const {rows}=await query('select enabled,game_profiles,game_controls from app_casino_settings where id=1');
  if(!rows[0]?.enabled)throw fault(403,'CASINO_DISABLED');
  return rows[0];
}
async function getWalletPlayer(req,getUser=getUserById){
  const token=cookieValue(req);
  if(!token)throw fault(401,'CASINO_SESSION_REQUIRED');
  let claim;
  try{claim=jwt.verify(token,config.jwtSecret);}catch{throw fault(401,'CASINO_SESSION_EXPIRED');}
  if(claim.kind!=='casino-pixi-wallet'||typeof claim.jti!=='string')throw fault(401,'CASINO_SESSION_INVALID');
  const user=await getUser(claim.sub);
  if(!user||user.role!=='PLAYER'||user.status!=='ACTIVE')throw fault(403,'PLAYER_BLOCKED');
  if(Number(claim.epoch??0)!==Number(user.financialEpoch??user.financial_epoch??0))throw fault(401,'CASINO_SESSION_EXPIRED');
  return {user,nonce:claim.jti,mathVersion:claim.mathVersion};
}
function spinProtocol(round,bet,lines,denomination,reqId){
  // The win is PENDING (paid on collect), so the wallet only lost the stake.
  const before=Number((round.balance+round.stake).toFixed(2));
  const total=round.payout.toFixed(2);
  return {
    balance:{before,after:round.balance},denomination,
    available_actions:round.payout>0?['collect','gamble','spin']:['spin'],
    macro_round:{wins:{total}},
    spin:{bet,lines,multiplier:1,next_multiplier:1,next_request_id:reqId+1,
      type:'spin',symbols:round.result.symbols,
      wins:{line_wins:round.result.line_wins,total}},
  };
}
export function createSizzlingRealRouter(dependencies={}){
  const ready=dependencies.isLedgerReady??isLedgerReady;
  const getUser=dependencies.getUserById??getUserById;
  const settle=dependencies.settlePendingWin??settlePendingWin;
  const place=dependencies.placeCasinoSpin??placeCasinoSpin;
  const gamble=dependencies.casinoGambleAction??casinoGambleAction;
  const router=Router();
  router.post('/play',raw({type:()=>true,limit:'128kb'}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    let action='unknown';
    try{
      if(!ready())throw fault(503,'LEDGER_UNAVAILABLE');
      if(req.headers.origin){
        const origin=new URL(req.headers.origin);
        if(origin.host!==req.headers.host)throw fault(403,'CROSS_ORIGIN_DENIED');
      }
      const {user,nonce,mathVersion}=await getWalletPlayer(req,getUser);
      const request=decodeRequest(req);
      action=String(request.action||'init');
      const rawId=request.request_id;
      const id=rawId==null?null:Number(rawId);
      if(rawId!=null&&(!Number.isSafeInteger(id)||id<0||id>1e9))throw fault(400,'INVALID_REQUEST_ID');
      if(action==='init'){
        // A pending win survives page reloads/tab closes: credit it first so
        // the casino meter and the sportsbook balance stay in sync.
        await settle(user.id);
        const fresh=await getUser(user.id);
        const credits=Number(fresh?.balance ?? user.balance);
        const init=initResponse({credits, requestId:id==null?1:id+1,walletLimits:true});
        init.init.currency='LEK';
        return res.json(init);
      }
      if(action==='spin'){
        if(id==null)throw fault(400,'SPIN_REQUEST_ID_REQUIRED');
        const bet=Number(request.bet),lines=Number(request.lines),denomination=Number(request.denomination??1);
        const round=await place({userId:user.id,requestId:uuidFromId(nonce,id),
          bet,denomination,lines,mathVersion});
        return res.json(spinProtocol(round,bet,lines,denomination,id));
      }
      if(action==='collect'||action==='get_double'||action==='set_double'){
        if(id==null)throw fault(400,'ACTION_REQUEST_ID_REQUIRED');
        const reply=await gamble({
          userId:user.id,requestId:uuidFromId(nonce,id),action,choice:request.choice,
        });
        return res.json(reply);
      }
      throw fault(400,'INVALID_ACTION');
    }catch(error){deny(res,error,action);}
  });
  return router;
}
export const casinoSessionRouter=Router();
casinoSessionRouter.post('/casino/session',requireAuth,async(req,res)=>{
  try{
    if(!isLedgerReady())throw fault(503,'LEDGER_UNAVAILABLE');
    if(req.user.role!=='PLAYER'||req.user.status!=='ACTIVE')throw fault(403,'PLAYER_BLOCKED');
    const settings=await managerCasinoSettings(query,await ensureAdminEnabled(),req.user.managerId??req.user.manager_id??req.user.agentId??req.user.agent_id);
    const mathVersion=assertCasinoMathAcknowledged('sizzling',settings,req.body?.mathVersion);
    const claim={sub:req.user.id,jti:randomUUID(),kind:'casino-pixi-wallet',mathVersion,epoch:Number(req.user.financialEpoch??0)};
    const token=jwt.sign(claim,config.jwtSecret,{expiresIn:MAX_AGE});
    res.cookie(COOKIE,token,{
      httpOnly:true,sameSite:'strict',secure:req.secure||req.headers['x-forwarded-proto']==='https',
      path:'/app/api/casino/sizzlinghotdeluxe/real',maxAge:MAX_AGE*1000,
    });
    res.set('Cache-Control','no-store');
    res.json({ready:true,gameUrl:'/app/casino-original/sizzling/index-real.html',expiresIn:MAX_AGE,mathVersion});
  }catch(error){deny(res,error);}
});
