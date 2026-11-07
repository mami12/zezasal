/**
 * Persisted, replay-safe gamble for the Sizzling Hot Deluxe real wallet.
 *
 * The spin already debited the stake; the win is PENDING until the player
 * collects. Red/black only doubles or forfeits that pending amount, so the
 * sportsbook balance and the casino meter always show the same number.
 */
import {randomInt} from 'node:crypto';
import {pool} from '../db.mjs';
import {creditPendingWin,syncCasinoRoundPayout} from './transactions.mjs';

const money=n=>Number(Number(n).toFixed(2));
const fault=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const suits=['hearts','diamonds','clubs','spades'];
const randomCard=()=>({rank:randomInt(2,15),suit:suits[randomInt(suits.length)]});
const basic=(before,after)=>({
  balance:{before:money(before),after:money(after)},denomination:1,
});

/** Action IDs are derived from the authenticated Pixi session and request_id. */
export async function casinoGambleAction({userId,requestId,action,choice},{database=pool}={}){
  if(!uuid.test(String(requestId)))throw fault(400,'INVALID_REQUEST_ID');
  if(!['get_double','set_double','collect'].includes(action))throw fault(400,'INVALID_ACTION');
  const db=await database.connect();
  try{
    await db.query('begin');
    // Match the exact lock order used for sportsbook and slot spins.
    const lookup=await db.query('select manager_id from app_user where id=$1',[userId]);
    if(!lookup.rows.length)throw fault(404,'PLAYER_NOT_FOUND');
    const ids=[userId,lookup.rows[0].manager_id].filter(Boolean).sort();
    const locked=await db.query(
      'select id,username,role,status,balance,manager_id from app_user where id=any($1::uuid[]) order by id for update',[ids]);
    const users=new Map(locked.rows.map(row=>[row.id,row]));
    const player=users.get(userId),manager=player?.manager_id?users.get(player.manager_id):null;
    if(!player||player.role!=='PLAYER'||player.status!=='ACTIVE')throw fault(403,'PLAYER_BLOCKED');
    if(player.manager_id!==lookup.rows[0].manager_id)throw fault(409,'MANAGER_CHANGED');
    if(player.manager_id&&(!manager||manager.role!=='MANAGER'))throw fault(409,'MANAGER_UNAVAILABLE');
    const cached=await db.query(
      'select action,response from app_casino_gamble_event where user_id=$1 and request_id=$2',
      [userId,requestId]);
    if(cached.rows.length){
      if(cached.rows[0].action!==action)throw fault(409,'REQUEST_ID_ALREADY_USED');
      await db.query('commit');
      return cached.rows[0].response;
    }
    // OFF stops new gambling, while committed replies and owed collection
    // remain available. Keep this check under the same transaction lock.
    if(action!=='collect'){
      const settings=await db.query('select enabled from app_casino_settings where id=1 for share');
      if(!settings.rows[0]?.enabled)throw fault(403,'CASINO_DISABLED');
      const bonus=await db.query('select left_spins from app_casino_freespin_state where user_id=$1 for update',[userId]);
      if(Number(bonus.rows[0]?.left_spins)>0)throw fault(409,'FREE_SPINS_PENDING');
    }
    const result=await db.query(
      'select round_id,pending,step,player_card from app_casino_gamble_state where user_id=$1 for update',
      [userId]);
    const state=result.rows[0];
    const previous=Number(player.balance),pending=Number(state?.pending||0);
    let answer;

    if(action==='collect'){
      // This is where the pending win finally reaches the wallet.
      const after=pending>0
        ? await creditPendingWin(db,{userId,player,manager,pending,roundId:state.round_id})
        : previous;
      if(pending>0)await syncCasinoRoundPayout(db,userId,state?.round_id);
      await db.query(
        'update app_casino_gamble_state set pending=0,step=0,player_card=null,updated_at=now() where user_id=$1',
        [userId]);
      answer={...basic(previous,after),available_actions:['spin'],
        macro_round:{wins:{total:'0'}},collect:{total:money(pending).toFixed(2)}};
    }else if(action==='get_double'){
      if(!state||pending<=0||state.step>=5)throw fault(409,'NOTHING_TO_GAMBLE');
      const card=state.player_card||randomCard();
      if(!state.player_card)await db.query(
        'update app_casino_gamble_state set player_card=$2::jsonb,updated_at=now() where user_id=$1',
        [userId,JSON.stringify(card)]);
      answer={...basic(previous,previous),available_actions:['collect','set_double'],
        gamble:{start_bet:money(pending),bet:money(pending),win:money(pending*2),
          status:'idle',current_step:state.step,max_step:5,
          history:{items:{0:card}}}};
    }else{
      if(!state||pending<=0||state.step>=5)throw fault(409,'NOTHING_TO_GAMBLE');
      const selected=Number(choice);
      if(!Number.isInteger(selected)||![0,1].includes(selected))throw fault(400,'INVALID_GAMBLE_COLOR');
      const initial=state.player_card||randomCard();
      const dealer=randomCard();
      const red=dealer.suit==='hearts'||dealer.suit==='diamonds';
      const won=(selected===0)===red;
      // Only the PENDING amount moves; the wallet is untouched until collect.
      const newPending=won?money(pending*2):0;
      const step=state.step+1;
      await db.query(
        'update app_casino_gamble_state set pending=$2,step=$3,player_card=$4::jsonb,updated_at=now() where user_id=$1',
        [userId,newPending,step,JSON.stringify(dealer)]);
      await syncCasinoRoundPayout(db,userId,state.round_id,newPending);
      answer={...basic(previous,previous),
        available_actions:newPending>0?
          ['collect',...(step<5?['get_double']:[]),'spin']:['spin'],
        macro_round:{wins:{total:newPending.toFixed(2)}},
        gamble:{start_bet:money(won?pending:0),bet:money(newPending),
          win:money(newPending*2),status:won?'win':'lose',
          current_step:step,max_step:5,
          history:{items:{0:initial,1:dealer}}}};
    }
    await db.query(
      'insert into app_casino_gamble_event(user_id,request_id,action,response) values($1,$2,$3,$4::jsonb)',
      [userId,requestId,action,JSON.stringify(answer)]);
    await db.query('commit');
    return answer;
  }catch(error){
    await db.query('rollback').catch(()=>{});
    throw error;
  }finally{db.release();}
}
