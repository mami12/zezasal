import {createFortunePyramidProtocol} from './fortune-pyramid-protocol.mjs';
import {managerCasinoSettings} from './manager-settings.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {pool} from '../db.mjs';
import {assertPlayerCanBet} from '../ledger/player-controls.mjs';
import {creditPendingWin} from './transactions.mjs';
import {createCtProtocol} from './ct-protocol.mjs';
import {createAgtProtocol} from './agt-protocol.mjs';
import {vikingsConfig,mapVikingsRound} from './vikings-ct-router.mjs';
import {spin as vikingSpin,spinRound} from './vikings-engine.mjs';
import {DENOMS} from './clover-ct-config.mjs';
import {getGameProfile,getPaidGameProfile} from './game-rtp-profiles.mjs';
import {casinoControls,assertCasinoMathAcknowledged} from './casino-controls.mjs';
import {selectCustomRound} from './custom-math.mjs';
import {casinoStakeCents,walletCtDenoms} from './bet-limits.mjs';
import {createFireJokerProtocol} from './firejoker-protocol.mjs';
import {createFortuneTellerProtocol} from './fortune-teller-protocol.mjs';

export const ORIGINAL_GAMES={
 'ice-fruits-6x3':{title:'Ice Fruits 6 Reels',kind:'agt',folder:'ice-fruits-6x3',app:'6megaice'},
 'fortune-pyramid':{title:'Fortune Pyramid',kind:'ct',folder:'fortune-pyramid',app:'FortunePyramid',lines:20},
 'fortune-teller':{title:'Fortune Teller',kind:'ct',folder:'fortune-teller',app:'FortuneTeller',lines:20},
 'firejoker':{title:'Fire Joker',kind:'ct',folder:'firejoker',app:'FireJoker'},
 'lucky-clover-x3':{title:'Lucky Clover X3',kind:'ct',folder:'lucky-clover-x3',app:'LuckyCloverX3'},
 'vikings-fun':{title:"Viking's Fun",kind:'ct',folder:'vikings-fun',app:'VikingsFun'},
 'fruit-queen':{title:'Fruit Queen',kind:'agt',app:'fruitqueen'},
 'seven-hot':{title:'Seven Hot',kind:'agt',app:'sevenhot20'},
};
export {ORIGINAL_WALLET_SQL} from './original-wallet-schema.mjs';
export const walletFault=(status,message)=>Object.assign(new Error(message),{status});
const cents=n=>Math.round(Number(n)*100),money=n=>n/100;
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const uuid=x=>/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(x));

// All account, round, pending-win and protocol changes commit together. The same
// account locks serialize sportsbook wagers, cashier transfers and casino tabs.
export function createOriginalWalletStore({database=pool,checkBet=assertPlayerCanBet,ct=createCtProtocol(),vikings=createCtProtocol({spinFn:spinRound,configFn:vikingsConfig,initialGrid:options=>vikingSpin(25,25,false,options).grid,selectedLines:25,mapRound:mapVikingsRound}),firejoker=createFireJokerProtocol(),fortuneTeller=createFortuneTellerProtocol(),fortunePyramid=createFortunePyramidProtocol(),agt=createAgtProtocol(),chooseRound=selectCustomRound}={}){
 const protocol=id=>id==='fortune-pyramid'?fortunePyramid:id==='vikings-fun'?vikings:id==='firejoker'?firejoker:id==='fortune-teller'?fortuneTeller:ORIGINAL_GAMES[id]?.kind==='ct'?ct:agt;
 const hydrate=s=>({...s,results:new Map()});
 const encode=s=>JSON.stringify({...s,results:undefined});
 async function transaction(userId,gameId,fn,expectedEpoch){
  const game=ORIGINAL_GAMES[gameId];if(!game)throw walletFault(404,'Unknown game');
  const db=await database.connect();
  try{
   await db.query('begin');
   const lookup=await db.query('select manager_id from app_user where id=$1',[userId]);
   if(!lookup.rows.length)throw walletFault(401,'Player not found');
   const ids=[userId,lookup.rows[0].manager_id].filter(Boolean).sort();
   const locked=await db.query('select id,username,role,status,balance,currency,manager_id,agent_id,financial_epoch from app_user where id=any($1::uuid[]) order by id for update',[ids]);
   const player=locked.rows.find(x=>x.id===userId),manager=locked.rows.find(x=>x.id===player?.manager_id);
   if(!player||player.role!=='PLAYER'||player.status!=='ACTIVE')throw walletFault(403,'Player account disabled');
   if(expectedEpoch!==undefined&&Number(expectedEpoch)!==Number(player.financial_epoch??0))throw walletFault(401,'Game session expired. Reopen the game.');
   if(player.manager_id!==lookup.rows[0].manager_id)throw walletFault(409,'Manager changed. Retry.');
   if(player.manager_id&&(!manager||manager.role!=='MANAGER'))throw walletFault(409,'Manager unavailable');
   const settings=await db.query('select enabled,game_profiles,game_controls,coalesce(hidden_games,\'[]\'::jsonb) as hidden_games from app_casino_settings where id=1 for share');
   settings.rows[0]=await managerCasinoSettings(db.query.bind(db),settings.rows[0],player.manager_id,{lock:true,agentId:player.agent_id});
   const saved=(await db.query('select * from app_casino_original_state where user_id=$1 and game_id=$2 for update',[userId,gameId])).rows[0];
   const context={db,player,manager,game,saved,enabled:!!settings.rows[0]?.enabled,gameProfiles:settings.rows[0]?.game_profiles??{},settings:settings.rows[0]??{}};
   const answer=await fn(context);
   await db.query('commit');return answer;
  }catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{db.release();}
 }
 async function pay(ctx,amount,roundId){
  if(!Number.isSafeInteger(amount)||amount<0||amount>9e13)throw walletFault(400,'Invalid payout');
  if(amount)await creditPendingWin(ctx.db,{userId:ctx.player.id,player:ctx.player,manager:ctx.manager,pending:money(amount),roundId,label:ctx.game.title});
 }
 async function writeState(ctx,state,sessionId){
  await ctx.db.query(`insert into app_casino_original_state(user_id,game_id,session_id,state) values($1,$2,$3,$4::jsonb)
   on conflict(user_id,game_id) do update set session_id=excluded.session_id,state=excluded.state,updated_at=now()`,[ctx.player.id,ctx.saved?.game_id||state.gameId,sessionId,encode(state)]);
 }
 async function settle(ctx,s){
  await pay(ctx,Number(s.pending||0),s.roundId);s.pending=0;await syncPayout(ctx,s.roundId,0);
 }
 async function syncPayout(ctx,roundId,pending){
  if(roundId)await ctx.db.query(`update app_casino_round r set payout=coalesce((
   select sum(t.amount) from app_transaction t where t.user_id=r.user_id
   and t.reference_id=r.id and t.type='CASINO_WIN'),0)+$2::numeric where r.id=$1`,[roundId,money(pending)]);
 }
 return {
  async inspect(userId,gameId,sessionId,{epoch}={}){return transaction(userId,gameId,async ctx=>{
   if(!ctx.saved||ctx.saved.session_id!==sessionId||ctx.saved.state.closed)throw walletFault(401,'Game session expired');
   return {balance:Number(ctx.player.balance)};
  },epoch);},
  async launch(userId,gameId,{mathVersion,epoch}={}){return transaction(userId,gameId,async ctx=>{
   const old=ctx.saved?hydrate(ctx.saved.state):null;
   // Awarded free games survive a reload, explicit close, process restart and
   // later profile changes. A fresh session invalidates the older game frame.
   if(ctx.game.kind==='agt'&&Number(old?.remaining)>0){
    if(mathVersion)old.mathVersion=assertCasinoMathAcknowledged(gameId,ctx.settings,mathVersion);
    await settle(ctx,old);
    Object.assign(old,{credit:cents(ctx.player.balance),cash:cents(ctx.player.balance),currency:ctx.player.currency||'LEK',closed:false});
    if(!old.mathProfile)old.mathProfile={...getGameProfile(gameId)};
    const sessionId=randomUUID();await writeState(ctx,old,sessionId);return {sessionId,mathVersion:old.mathVersion};
   }
   if(!ctx.enabled)throw walletFault(403,'Casino disabled');
   if(Array.isArray(ctx.settings?.hidden_games)&&ctx.settings.hidden_games.includes(gameId))throw walletFault(403,'Kjo lojë është çaktivizuar përkohësisht nga administratori.');
   const acknowledged=assertCasinoMathAcknowledged(gameId,ctx.settings,mathVersion);
   // A new launch invalidates the earlier frame. Closing/reloading never loses
   // an already awarded win, including the precalculated CT free-game chain.
   if(old)await settle(ctx,old);
   const originalProfiles=casinoControls(ctx.settings.game_controls,gameId).mode==='custom'?{}:ctx.gameProfiles;
   const control=casinoControls(ctx.settings.game_controls,gameId),initialProfile={...getPaidGameProfile(gameId,originalProfiles),
    ...(control.mode==='custom'?{customMath:{rtp:control.rtp,hitFrequency:control.hitFrequency}}:{})};
   const s=protocol(gameId).initialState(ORIGINAL_GAMES[gameId].app,{mathProfile:initialProfile,walletLimits:true}),sessionId=randomUUID();
   Object.assign(s,{credit:cents(ctx.player.balance),cash:cents(ctx.player.balance),currency:ctx.player.currency||'LEK',gameId,maxSequence:-1,mathVersion:mathVersion?acknowledged:undefined});
   await writeState(ctx,s,sessionId);return {sessionId,mathVersion:acknowledged};
  },epoch);},
  async close(userId,gameId,sessionId,{epoch}={}){return transaction(userId,gameId,async ctx=>{
   if(!ctx.saved||ctx.saved.session_id!==sessionId)throw walletFault(401,'Game session expired');
   const s=hydrate(ctx.saved.state);await settle(ctx,s);s.closed=true;
   await writeState(ctx,s,sessionId);return {balance:Number(ctx.player.balance)};
  },epoch);},
  async act(userId,gameId,sessionId,params,{epoch}={}){return transaction(userId,gameId,async ctx=>{
   if(!ctx.saved||ctx.saved.session_id!==sessionId||ctx.saved.state.closed)throw walletFault(401,'Game session expired. Reopen the game.');
   const s=hydrate(ctx.saved.state),isCt=ctx.game.kind==='ct';
   const commands=isCt?params:[params],responses=[];
   // A wager must commit on its own. Otherwise a caller could append a
   // result-dependent invalid command and roll back only losing spins/gambles.
   if(isCt&&commands.length!==1&&commands.some(c=>['play','continue'].includes(c.command)))throw walletFault(400,'Send each wager as one command');
   for(const command of commands){
    const action=isCt?command.command:command.action;
    const requestId=isCt?'ct:'+command.sequence_number:command.request_id;
    const mutating=isCt?!['poll','trace','init_game','subgame_finished'].includes(action):['spin','freespin','double','save'].includes(action);
    if(!isCt&&command.gamename!==ctx.game.app)throw walletFault(400,'Game mismatch');
    if(!isCt&&mutating&&!uuid(requestId))throw walletFault(400,'Unique request ID required');
    const fingerprint=digest(command);
    if(isCt||mutating){
     const old=(await ctx.db.query('select fingerprint,response from app_casino_original_event where user_id=$1 and session_id=$2 and request_id=$3',[userId,sessionId,requestId])).rows[0];
     if(old){if(old.fingerprint!==fingerprint)throw walletFault(409,'Request ID reused');responses.push(old.response);continue;}
     if(isCt&&command.sequence_number<=s.maxSequence)throw walletFault(409,'Stale sequence');
    }
    const before=cents(ctx.player.balance);
    s.credit=before;s.cash=before;
    const paidSpin=isCt?action==='play':action==='spin';
    const gambling=isCt?action==='continue'&&command.continue_params?.double_betpart!=='skip':action==='double';
    // Replayed events above retain their original unit. New paid spins use the
    // current total limits even if the browser held a pre-update session open.
    if(paidSpin)s.walletLimits=true;
    const denoms=isCt?(s.walletLimits?walletCtDenoms(ctx.game.lines??(gameId==='vikings-fun'?25:5)):DENOMS):null;
    let stake=paidSpin?casinoStakeCents(isCt?Number(command.total_bet)*denoms.find(d=>d.id===command.game_denom)?.cents/100:command.amount):0;
    if(paidSpin||gambling){
     if(!ctx.enabled)throw walletFault(403,'Casino disabled');
   if(Array.isArray(ctx.settings?.hidden_games)&&ctx.settings.hidden_games.includes(gameId))throw walletFault(403,'Kjo lojë është çaktivizuar përkohësisht nga administratori.');
     if(paidSpin)assertCasinoMathAcknowledged(gameId,ctx.settings,s.mathVersion);
     if(paidSpin&&(!Number.isSafeInteger(stake)||stake<=0||stake>9e13))throw walletFault(400,'Invalid stake');
     await checkBet(ctx.db,userId,money(stake));
    }
    // The administrator's profile affects the next paid round only. Awarded
    // wins and AGT free-game sequences retain the paid round's original math.
    let customRound;
    if(paidSpin){
     const controls=casinoControls(ctx.settings.game_controls,gameId);
     if(controls.mode==='custom'){
      customRound=chooseRound(gameId,{stakeCents:stake,lines:Number(command.lines??command.li),controls});
      s.mathProfile={...customRound.mathProfile,customMath:{version:customRound.version,rtp:customRound.rtp,hitFrequency:customRound.hitFrequency,maxPayoutCents:customRound.maxPayoutCents}};
     }else{s.mathProfile={...getPaidGameProfile(gameId,ctx.gameProfiles)};s.customRound=null;}
    }
    else if(!isCt&&Number(s.remaining)>0&&!s.mathProfile)s.mathProfile={...getGameProfile(gameId)};
    const response=isCt?protocol(gameId).run(s,[command],{mathProfile:s.mathProfile,customRound})[0]:agt.run(s,command,{mathProfile:s.mathProfile,customRound});
    if(isCt&&response.status?.status!=='ok')throw walletFault(400,response.status?.msg||'Game action rejected');
    const after=isCt?s.credit:s.cash,credited=after-before+stake;
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(s.pending)||s.pending<0||s.pending>9e13||credited<0)throw walletFault(400,'Invalid game settlement');
    if(credited){await pay(ctx,credited,s.roundId);if(paidSpin)await syncPayout(ctx,s.roundId,0);}
    if(paidSpin){
     const balance=cents(ctx.player.balance)-stake;
     if(balance<0)throw walletFault(400,'Insufficient balance');
     const result=await ctx.db.query(`insert into app_casino_round(user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) returning id`,
      [userId,randomUUID(),gameId,customRound?customRound.version:s.mathProfile.id,isCt?command.line_bet:money(stake),isCt?money(denoms.find(d=>d.id===command.game_denom).cents):1,isCt?command.lines:command.li,money(stake),money(s.pending),money(balance),JSON.stringify({...response,mathProfile:s.mathProfile})]);
     s.roundId=result.rows[0].id;
     await ctx.db.query('update app_user set balance=$2,updated_at=now() where id=$1',[userId,money(balance)]);ctx.player.balance=money(balance);
     await ctx.db.query("insert into app_transaction(user_id,amount,type,reference_id,balance_after,description) values($1,$2,'CASINO_SPIN',$3,$4,$5)",[userId,-money(stake),s.roundId,money(balance),ctx.game.title+' · spin']);
     // Manager earnings are reported separately; no automatic wallet transfer.
    }else if(s.roundId&&(credited||gambling||action==='freespin')){
     await syncPayout(ctx,s.roundId,s.pending);
    }
    if(isCt)s.maxSequence=Math.max(s.maxSequence,command.sequence_number);
    if(isCt||mutating)await ctx.db.query('insert into app_casino_original_event(user_id,session_id,request_id,fingerprint,response) values($1,$2,$3,$4,$5::jsonb)',[userId,sessionId,requestId,fingerprint,JSON.stringify(response)]);
    responses.push(response);
   }
   await writeState(ctx,s,sessionId);return isCt?responses:responses[0];
  },epoch);}
 };
}
