import {managerCasinoSettings} from './manager-settings.mjs';
/**
 * Server-authoritative settlement for Book of Ra Deluxe (real wallet).
 *
 * Same money flow as Sizzling: a paid spin debits only the stake and keeps the
 * win PENDING; the free spins add to that pending amount; collect pays it.
 */
import {pool} from '../db.mjs';
import {assertPlayerCanBet} from '../ledger/player-controls.mjs';
import {creditPendingWin,syncCasinoRoundPayout} from './transactions.mjs';
import {FREE_SPINS, LINES, PAYTABLE, gradeGrid, pickMudSymbol, randomGrid} from './bookofra.mjs';
import {getGameProfile,getPaidGameProfile} from './game-rtp-profiles.mjs';
import {casinoControls,assertCasinoMathAcknowledged} from './casino-controls.mjs';
import {selectCustomRound} from './custom-math.mjs';
import {validateWalletPixiBet} from './bet-limits.mjs';

const money=n=>Number(Number(n).toFixed(2));
const fault=(status,message)=>Object.assign(new Error(message),{status});
const LABEL='Book of Ra Deluxe';

async function lockAccounts(db,userId){
  const lookup=await db.query('select manager_id from app_user where id=$1',[userId]);
  if(!lookup.rows.length)throw fault(404,'Player not found');
  const ids=[userId,lookup.rows[0].manager_id].filter(Boolean).sort();
  const locked=await db.query(
    'select id,username,role,status,balance,manager_id,agent_id from app_user where id=any($1::uuid[]) order by id for update',[ids]);
  const accounts=new Map(locked.rows.map(x=>[x.id,x]));
  const player=accounts.get(userId);
  if(!player||player.role!=='PLAYER'||player.status!=='ACTIVE')throw fault(403,'Player account disabled');
  if(player.manager_id!==lookup.rows[0].manager_id)throw fault(409,'Manager changed: retry');
  const manager=player.manager_id?accounts.get(player.manager_id):null;
  if(player.manager_id&&(!manager||manager.role!=='MANAGER'))throw fault(409,'Manager unavailable');
  return {player,manager};
}

/** Credits a pending win that a previous round left behind (reload/new spin). */
async function flushPending(db,userId,player,manager){
  const state=await db.query('select round_id,pending from app_casino_gamble_state where user_id=$1 for update',[userId]);
  const pending=Number(state.rows[0]?.pending||0);
  if(pending>0){
    await creditPendingWin(db,{userId,player,manager,pending,roundId:state.rows[0].round_id,label:LABEL+' · auto-collect'});
    await syncCasinoRoundPayout(db,userId,state.rows[0]?.round_id);
  }
  await db.query('update app_casino_gamble_state set pending=0,step=0,player_card=null,updated_at=now() where user_id=$1',[userId]);
}

export async function bookOfRaFreeState(userId,{database=pool}={}){
  const {rows}=await database.query(
    `select f.*,coalesce(g.pending,0) as pending,r.result as paid_result,r.bet as paid_bet,r.denomination as paid_denomination,r.lines as paid_lines
       from app_casino_freespin_state f
       left join app_casino_gamble_state g on g.user_id=f.user_id and g.round_id=f.round_id
       join app_casino_round r on r.id=f.round_id where f.user_id=$1`,[userId]);
  return rows[0]||null;
}

export async function placeBookOfRaSpin({userId,requestId,bet,denomination=1,lines=10,mode='spin',mathVersion},{database=pool,random,checkBet=assertPlayerCanBet,chooseRound=selectCustomRound}={}){
  if(!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(String(requestId)))throw fault(400,'Unique UUID required');
  if(!['spin','freespin'].includes(mode))throw fault(400,'Invalid spin mode');
  bet=Number(bet);denomination=Number(denomination);lines=Number(lines);
  const db=await database.connect();
  try{
    await db.query('begin');
    const {player,manager}=await lockAccounts(db,userId);
    const settings=await db.query('select enabled,game_profiles,game_controls from app_casino_settings where id=1 for share');
    settings.rows[0]=await managerCasinoSettings(db.query.bind(db),settings.rows[0],player.manager_id,{lock:true,agentId:player.agent_id});

    if(mode==='freespin'){
      const cached=await db.query('select action,response from app_casino_gamble_event where user_id=$1 and request_id=$2',[userId,requestId]);
      if(cached.rows.length){
        if(cached.rows[0].action!=='bookofra:freespin')throw fault(409,'Request key was used for another action');
        await db.query('commit');return cached.rows[0].response;
      }
      const state=await db.query(
        'select round_id,left_spins,done_spins,mud,bet,lines,math_profile,custom_round from app_casino_freespin_state where user_id=$1 for update',[userId]);
      const fs=state.rows[0];
      if(!fs)throw fault(409,'NO_FREE_SPINS');
      const profile=getGameProfile('bookofra',{bookofra:fs.math_profile??'BOOKOFRA_ORIGINAL_REELS_V2'});
      const frozen=fs.custom_round;
      const customSpin=frozen?.spins.shift();
      if(frozen&&!customSpin)throw fault(500,'Awarded custom bonus is incomplete');
      const grid=customSpin?customSpin.grid:randomGrid(random,profile.reels);
      const graded=customSpin?customSpin.graded:gradeGrid(grid,Number(fs.bet),Number(fs.lines),Number(fs.mud));
      const left=Number(fs.left_spins)-1, done=Number(fs.done_spins)+1;
      const pending=await db.query('select round_id,pending from app_casino_gamble_state where user_id=$1 for update',[userId]);
      const unrelated=pending.rows[0]&&pending.rows[0].round_id!==fs.round_id;
      if(unrelated)await flushPending(db,userId,player,manager);
      const before=unrelated?0:Number(pending.rows[0]?.pending||0);
      const total=money(before+graded.total);
      await db.query(
        `insert into app_casino_gamble_state(user_id,round_id,pending,step,player_card)
         values($1,$2,$3,0,null)
         on conflict(user_id) do update set pending=excluded.pending,round_id=excluded.round_id,updated_at=now()`,
        [userId,fs.round_id,total]);
      if(left>0)await db.query('update app_casino_freespin_state set left_spins=$2,done_spins=$3,custom_round=$4::jsonb,updated_at=now() where user_id=$1',
        [userId,left,done,frozen?JSON.stringify(frozen):null]);
      else await db.query('delete from app_casino_freespin_state where user_id=$1',[userId]);
      await syncCasinoRoundPayout(db,userId,fs.round_id,total);
      const answer={grid,graded,balance:Number(player.balance),pending:total,free:{left,done,mud:Number(fs.mud)},
        mathProfile:{id:profile.id,theoreticalRtp:frozen?.rtp??profile.theoreticalRtp},
        ...(frozen?{customMath:{version:frozen.version,rtp:frozen.rtp,hitFrequency:frozen.hitFrequency}}:{})};
      await db.query('insert into app_casino_gamble_event(user_id,request_id,action,response) values($1,$2,$3,$4::jsonb)',[userId,requestId,'bookofra:freespin',JSON.stringify(answer)]);
      await db.query('commit');
      return answer;
    }

    const stake=money(bet*denomination*lines);
    const previous=await db.query('select * from app_casino_round where user_id=$1 and client_request_id=$2',[userId,requestId]);
    if(previous.rows.length){
      const old=previous.rows[0];
      if(old.game_id!=='bookofra'||Number(old.bet)!==bet||Number(old.denomination)!==denomination||Number(old.lines)!==lines)throw fault(409,'Request key was used for a different wager');
      let accepted=old.result.acceptedSpin;
      if(!accepted){
        const grid=Array.from({length:5},(_,x)=>Array.from({length:3},(_,y)=>Number(old.result.symbols[x][y].code)));
        const fs=(await db.query('select * from app_casino_freespin_state where user_id=$1 and round_id=$2',[userId,old.id])).rows[0];
        accepted={stake:Number(old.stake),payout:Number(old.result.total),balance:Number(old.balance_after),grid,
          graded:{line_wins:old.result.line_wins,total:Number(old.result.total)},
          free:fs?{left:Number(fs.left_spins),done:Number(fs.done_spins),add:0,mud:Number(fs.mud),wins:{total:Number(old.result.total),win_before_chain:0},type:'freespins'}:null};
      }
      await db.query('commit');
      return {...accepted,roundId:old.id,result:old.result,replayed:true};
    }
    if(!settings.rows[0]?.enabled)throw fault(403,'Casino disabled by administrator');
    if(lines!==LINES.length)throw fault(400,'Invalid Book of Ra bet, lines or denomination');
    validateWalletPixiBet(bet,denomination,lines);
    const activeFree=await db.query('select left_spins from app_casino_freespin_state where user_id=$1 for update',[userId]);
    if(Number(activeFree.rows[0]?.left_spins)>0)throw fault(409,'FREE_SPINS_PENDING');
    assertCasinoMathAcknowledged('bookofra',settings.rows[0],mathVersion);
    await flushPending(db,userId,player,manager);
    if(Number(player.balance)<stake)throw fault(400,'Insufficient balance');
    await checkBet(db,userId,stake);
    const controls=casinoControls(settings.rows[0].game_controls,'bookofra');
    const customRound=controls.mode==='custom'?chooseRound('bookofra',{stakeCents:Math.round(stake*100),lines,controls},random):null;
    const profile=customRound?.mathProfile??getPaidGameProfile('bookofra',settings.rows[0]?.game_profiles);
    const grid=customRound?customRound.spins[0].grid:randomGrid(random,profile.reels);
    const graded=customRound?customRound.spins[0].graded:gradeGrid(grid,money(bet*denomination),lines);
    const balance=money(Number(player.balance)-stake);
    const books=grid.flat().filter(s=>s===0).length;
    const mud=customRound?(customRound.spins.length>1?customRound.spins[0].mud:null):books>=3&&process.env.BOOKOFRA_FREE_SPINS==='1'?pickMudSymbol():null;
    const free=mud==null?null:{left:FREE_SPINS,done:0,add:0,mud,wins:{total:graded.total,win_before_chain:0},type:'freespins'};
    const acceptedSpin={stake,payout:graded.total,balance,grid,graded,free};
    const round=await db.query(
      `insert into app_casino_round(user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result)
       values($1,$2,'bookofra',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning id`,
      [userId,requestId,customRound?.version??profile.id,bet,denomination,lines,stake,graded.total,balance,
        JSON.stringify({symbols:Object.fromEntries(grid.map((c,i)=>[i,Object.fromEntries(c.map((s,r)=>[r,{code:s}]))])),
          line_wins:graded.line_wins,total:graded.total.toFixed(2),mathProfile:{id:profile.id,theoreticalRtp:customRound?.rtp??profile.theoreticalRtp},acceptedSpin,
          ...(customRound?{customMath:{version:customRound.version,rtp:customRound.rtp,hitFrequency:customRound.hitFrequency,maxPayoutCents:customRound.maxPayoutCents}}:{})})]);
    const roundId=round.rows[0].id;
    await db.query(
      `insert into app_casino_gamble_state(user_id,round_id,pending,step,player_card)
       values($1,$2,$3,0,null)
       on conflict(user_id) do update set round_id=excluded.round_id,pending=excluded.pending,step=0,player_card=null,updated_at=now()`,
      [userId,roundId,graded.total]);
    await db.query(
      "insert into app_transaction(user_id,amount,type,reference_id,balance_after,description) values($1,$2,'CASINO_SPIN',$3,$4,$5)",
      [userId,-stake,roundId,balance,LABEL+' · spin']);
    await db.query('update app_user set balance=$2,updated_at=now() where id=$1',[userId,balance]);
    // Stake commission is recorded by the database without changing manager funds.
    // Free spins stay OFF until the client FS handshake is finished.
    if(free){
      await db.query(
        `insert into app_casino_freespin_state(user_id,round_id,left_spins,done_spins,mud,bet,lines,math_profile,custom_round)
         values($1,$2,$3,0,$4,$5,$6,$7,$8::jsonb)
         on conflict(user_id) do update set round_id=excluded.round_id,left_spins=excluded.left_spins,
           done_spins=0,mud=excluded.mud,bet=excluded.bet,lines=excluded.lines,math_profile=excluded.math_profile,custom_round=excluded.custom_round,updated_at=now()`,
        [userId,roundId,FREE_SPINS,mud,money(bet*denomination),lines,profile.id,customRound?JSON.stringify({version:customRound.version,rtp:customRound.rtp,hitFrequency:customRound.hitFrequency,spins:customRound.spins.slice(1)}):null]);
    }
    await db.query('commit');
    return {roundId,stake,payout:graded.total,balance,grid,graded,free,replayed:false};
  }catch(error){await db.query('rollback').catch(()=>{});throw error;}
  finally{db.release();}
}

export {PAYTABLE};
