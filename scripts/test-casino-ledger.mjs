/**
 * Uses its own disposable local PostgreSQL-compatible database.
 * Tests real balance debits/payouts, replay protection, manager report-only funds,
 * staff scoping, and player self-exclusion.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import express from 'express';
const parent=resolve('tmp');await mkdir(parent,{recursive:true});
const root=await mkdtemp(join(parent,'casino-ledger-test-'));
Object.assign(process.env,{DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(root,'database'),DATABASE_URL:'invalid-test-only-cloud-url',JWT_SECRET:'isolated-casino-ledger-test-only-key',SEED_DEFAULT_ACCOUNTS:'false',CASINO_REAL_MONEY_ENABLED:'true',CASINO_MATH_APPROVED:'true'});
const {signToken}=await import('../server/ledger/auth.mjs');
const {casinoSessionRouter,createSizzlingRealRouter}=await import('../server/casino/sizzling-real.mjs');
const {casinoWalletRouter}=await import('../server/casino/wallet.mjs');
const {initLedgerSchema,createUser,getUserById}=await import('../server/ledger/store.mjs');
const {query,closePool,initSchema}=await import('../server/db.mjs');
const {placeCasinoSpin,settlePendingWin}=await import('../server/casino/transactions.mjs');
const {generateCasinoFinanceReport}=await import('../server/casino/finance.mjs');
const round=x=>Number(Number(x).toFixed(2));
try{
  await initSchema();
  // A new or migrated database should make Sizzling available to the sports
  // wallet without requiring environment variables on Railway.
  await initLedgerSchema();
  let activation=await query('select enabled,wallet_rollout_applied from app_casino_settings where id=1');
  assert.equal(activation.rows[0].enabled,true,'the sports wallet should be available after first deployment');
  assert.equal(activation.rows[0].wallet_rollout_applied,true,'the migration must run once');
  // An explicit admin shutdown must remain in force after a server restart.
  await query('update app_casino_settings set enabled=false where id=1');
  await initLedgerSchema();
  activation=await query('select enabled from app_casino_settings where id=1');
  assert.equal(activation.rows[0].enabled,false,'admin shutdown must not be reversed');
  await query('update app_casino_settings set enabled=true where id=1');
  const manager=await createUser({username:'m'+randomUUID(),passwordHash:'unused',role:'MANAGER',balance:10000});
  const other=await createUser({username:'m'+randomUUID(),passwordHash:'unused',role:'MANAGER',balance:10000});
  const player=await createUser({username:'p'+randomUUID(),passwordHash:'unused',role:'PLAYER',balance:10000,managerId:manager.id});
  const requestId=randomUUID();
  const a=await placeCasinoSpin({userId:player.id,requestId,bet:1,denomination:4,lines:5});
  const b=await placeCasinoSpin({userId:player.id,requestId,bet:1,denomination:4,lines:5});
  assert.equal(a.roundId,b.roundId);
  assert.equal(b.replayed,true);
  assert.equal(a.stake,20);
  const latest=await getUserById(player.id);
  assert.equal(latest.balance,round(10000-20),'a spin only debits the stake');
  const m=await getUserById(manager.id);
  assert.equal(m.balance,10000,'casino stakes never credit the manager wallet');
  let tx=await query('select type,amount from app_transaction where reference_id=$1 order by created_at',[a.roundId]);
  assert.equal(tx.rows.filter(x=>x.type==='CASINO_SPIN').length,1);
  assert.equal(tx.rows.filter(x=>x.type==='CASINO_MANAGER_NET').length,0);
  assert.equal(tx.rows.filter(x=>x.type==='CASINO_WIN').length,0,'the win is not paid before collect');
  let report=await generateCasinoFinanceReport({managerId:manager.id,userId:player.id});
  assert.equal(report.players.length,1);
  assert.equal(report.players[0].casinoSpins,1);
  assert.equal(report.players[0].casinoStake,20);
  assert.equal(report.players[0].casinoPayout,a.payout);
  assert.equal(report.players[0].net,round(a.payout-20));
  const unauthorized=await generateCasinoFinanceReport({managerId:other.id,userId:player.id});
  assert.equal(unauthorized.players.length,0);
  assert.deepEqual(unauthorized.transactions,[]);
  // A second Sizzling wager is settled into the same shared wallet.
  const second=await placeCasinoSpin({userId:player.id,requestId:randomUUID(),bet:2,denomination:4,lines:5});
  assert.equal(second.stake,40);
  report=await generateCasinoFinanceReport({managerId:manager.id,userId:player.id});
  assert.equal(report.players[0].casinoSpins,2);
  assert.equal(report.players[0].casinoStake,60);
  assert.equal(report.players[0].casinoPayout,round(a.payout+second.payout));
  const currentPlayer=await getUserById(player.id);
  const currentManager=await getUserById(manager.id);
  // The first win was still pending, so it is auto-collected before the second
  // wager; the second win itself stays pending until collect.
  assert.equal(currentPlayer.balance,round(10000-20+a.payout-40),
    'an uncollected win is credited automatically before the next spin');
  assert.equal(currentManager.balance,10000);
  // The actual Pixi client uses a same-origin cookie rather than Bearer on
  // its multipart spin requests; prove that its balance is the SPORT balance.
  const app=express();
  app.use(express.json());
  app.get('/app/api/auth/me',async(req,res)=>{
    const auth=req.get('authorization')||'';
    res.json(auth.startsWith('Bearer ')?await getUserById(player.id):null);
  });
  app.use('/app/api',casinoSessionRouter);
  app.use('/app/api',casinoWalletRouter);
  app.use('/app/api/casino/sizzlinghotdeluxe/real',createSizzlingRealRouter());
  const http=await new Promise(ok=>{
    const listener=app.listen(0,'127.0.0.1',()=>ok(listener));
  });
  try{
    const origin='http://127.0.0.1:'+http.address().port;
    const token=signToken(player);
    // The previous wager is still pending (paid on collect): settle it first so
    // this block starts from a stable, unencumbered sportsbook balance.
    await settlePendingWin(player.id);
    const before=await getUserById(player.id);
    const state=await fetch(origin+'/app/api/casino/status',{headers:{Authorization:'Bearer '+token}});
    assert.equal(state.status,200);
    const walletStatus=await state.json();
    assert.equal(walletStatus.realMoneyAvailable,true);
    assert.equal(walletStatus.balance,before.balance,'casino status uses sportsbook balance');
    const session=await fetch(origin+'/app/api/casino/session',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',
    });
    assert.equal(session.status,200,'Pixi wallet must establish authenticated session');
    assert.equal((await session.json()).gameUrl,'/app/casino-original/sizzling/index-real.html');
    const cookie=session.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('casino_pixi_wallet_session='));
    const play=async(payload)=>{
      const form=new FormData();
      form.append('data',JSON.stringify(payload));
      const response=await fetch(origin+'/app/api/casino/sizzlinghotdeluxe/real/play',{
        method:'POST',headers:{Cookie:cookie,Origin:origin},body:form,
      });
      return {status:response.status,body:await response.json()};
    };
    const init=await play({action:'init',request_id:'0'});
    assert.equal(init.status,200);
    assert.equal(init.body.balance.after,before.balance,'Pixi cabinet must start at sports balance');
    const request={action:'spin',bet:1,lines:5,denomination:4,request_id:'1'};
    const spin=await play(request);
    assert.equal(spin.status,200);
    assert.ok(spin.body.spin.symbols&&spin.body.spin.wins,'Pixi receives graphical reel outcome');
    const after=await getUserById(player.id);
    assert.equal(after.balance,spin.body.balance.after,'sports header must equal Pixi wallet');
    assert.equal(after.balance,round(before.balance-20),'the spin debits the stake only');
    const pending=Number(spin.body.spin.wins.total);
    // The legacy Pixi client treats every non-200 response as a fatal
    // "Internal Server Error" and exits to lobby. Expected rejects instead
    // use the client's documented JSON error envelope (HTTP 200).
    const invalid=await play({action:'spin',bet:1001,lines:5,denomination:1,request_id:'777'});
    assert.equal(invalid.status,200,'Pixi must not drop to lobby on invalid virtual bets');
    assert.equal(invalid.body.error?.code,400);
    assert.match(invalid.body.error?.message||'',/Casino stake must be between 20 and 5000 ALL/);
    assert.equal((await getUserById(player.id)).balance,after.balance,
      'rejected Pixi bet must never change the virtual wallet');
    const replay=await play(request);
    assert.deepEqual(replay.body,spin.body,'repeated Pixi request must not deduct again');
    assert.equal((await getUserById(player.id)).balance,after.balance);
    const collect=await play({action:'collect',request_id:'2'});
    assert.equal(collect.status,200);
    assert.equal(collect.body.balance.after,round(after.balance+pending),
      'collect credits exactly the pending win');

    // Deterministic fixture for a winning spin: confirm that Gamble uses the
    // shared wallet, pays just the delta, and survives duplicate HTTP retries.
    await query('update app_casino_gamble_state set pending=15,step=0,player_card=null where user_id=$1',
      [player.id]);
    const walletBeforeGamble=await getUserById(player.id);
    const managerBeforeGamble=await getUserById(manager.id);
    const offer=await play({action:'get_double',request_id:'3'});
    assert.equal(offer.status,200);
    assert.equal(offer.body.gamble.bet,15);
    assert.ok(offer.body.available_actions.includes('set_double'));
    assert.equal(offer.body.balance.after,walletBeforeGamble.balance);
    const offerRetry=await play({action:'get_double',request_id:'3'});
    assert.deepEqual(offerRetry.body,offer.body,'Gamble offer retries must not change the card');
    const gambleReq={action:'set_double',request_id:'4',choice:0};
    const gamble=await play(gambleReq);
    assert.equal(gamble.status,200);
    const dealer=gamble.body.gamble.history.items[1];
    const won=['hearts','diamonds'].includes(dealer.suit);
    assert.equal(gamble.body.gamble.status,won?'win':'lose');
    assert.equal(gamble.body.gamble.bet,won?30:0);
    const gambleAfter=await getUserById(player.id);
    assert.equal(gambleAfter.balance,walletBeforeGamble.balance,
      'Gamble only changes the pending win; the wallet moves on collect');
    assert.equal((await getUserById(manager.id)).balance,managerBeforeGamble.balance);
    const retry=await play(gambleReq);
    assert.deepEqual(retry.body,gamble.body,'Repeated gamble must replay the original deal');
    assert.equal((await getUserById(player.id)).balance,gambleAfter.balance);
    const cashout=await play({action:'collect',request_id:'5'});
    assert.equal(cashout.status,200);
    assert.equal(cashout.body.balance.after,round(gambleAfter.balance+(won?30:0)),
      'collect pays the doubled win (or nothing after a loss)');
    assert.deepEqual((await play({action:'collect',request_id:'5'})).body,cashout.body);
    const unavailable=await play({action:'get_double',request_id:'6'});
    assert.equal(unavailable.status,200);
    assert.equal(unavailable.body.error?.message,'NOTHING_TO_GAMBLE');
    assert.equal((await getUserById(player.id)).balance,cashout.body.balance.after);
    const me=await fetch(origin+'/app/api/auth/me',{headers:{Authorization:'Bearer '+token}});
    assert.equal((await me.json()).balance,cashout.body.balance.after,'same sports auth/me balance after collect');
  }finally{
    await new Promise(done=>http.close(done));
  }
  // A self-excluded account must not be able to wager in either category.
  await query(
    "insert into app_player_controls(user_id,self_excluded_until) values($1,now()+interval '1 day') on conflict(user_id) do update set self_excluded_until=excluded.self_excluded_until",
    [player.id]);
  await assert.rejects(
    placeCasinoSpin({userId:player.id,requestId:randomUUID(),bet:1,denomination:4,lines:5}),
    error => error?.status === 403);
  const playerLedger=await query('select coalesce(sum(amount),0) as amount from app_transaction where user_id=$1',[player.id]);
  assert.equal((await getUserById(player.id)).balance,round(10000+Number(playerLedger.rows[0].amount)),'player balance reconciles to posted casino debits and collections');
  assert.equal((await getUserById(manager.id)).balance,10000,'stakes, payouts and gambles never change manager funds');
  assert.equal(Number((await query('select count(*) as n from app_transaction where user_id=$1',[manager.id])).rows[0].n),0,'no automatic manager transaction');
  console.log('Casino wallet integration OK: player, manager, Sizzling ledger, idempotency, scoped finances, exclusion');
}finally{
  await query('update app_casino_settings set enabled=false where id=1').catch(()=>{});
  await closePool();
  assert.ok(resolve(root).startsWith(parent+sep));
  await rm(root,{recursive:true,force:true});
}
