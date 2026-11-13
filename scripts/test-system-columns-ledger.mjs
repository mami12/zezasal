import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import { createColumnsPlacer, toClientTicket, revertTicket, placeBet, bookTicket, getTicketWithLines, listActive, listHistory, listLogicalTickets, searchTickets, withLines } from '../server/ledger/bets.mjs';
import { listPlayerBetActivity } from '../server/ledger/bet-history.mjs';
import { listTransactions, managerFinancials, ledgerStats } from '../server/ledger/store.mjs';
import { recalcTicket, gradeLine } from '../server/ledger/settler.mjs';
import { managerCommissionReport } from '../server/ledger/manager-finance.mjs';
import { DEFAULT_LIVE_RISK_SETTINGS } from '../server/live-risk-settings.mjs';
import { upsert } from '../server/match-store.mjs';

// Production transaction + manager/player controls run against a fresh embedded
// PostgreSQL database. The bootstrap prevents all production database connections.
const sql = new PGlite();
await sql.exec(LEDGER_SQL);
await sql.query('insert into app_live_risk_settings(id,settings) values(1,$1::jsonb)', [JSON.stringify(DEFAULT_LIVE_RISK_SETTINGS)]);
upsert([1497, 6983].map(match_id => ({ match_id, home: 'Home', away: 'Away', service: 'PREMATCH', start_at: new Date(Date.now() + 3600000) })));
let queue = Promise.resolve();
const database = { async connect() {
  let release;
  const next = new Promise(resolve => { release = resolve; }), before = queue;
  queue = next; await before;
  return { query: (...args) => sql.query(...args), release };
} };
const runQuery = async (...args) => { const client = await database.connect(); try { return await client.query(...args); } finally { client.release(); } };
const getTicket = async id => {
  const client = await database.connect();
  try {
    const ticket = (await client.query('select * from app_ticket where id=$1', [id])).rows[0];
    const lines = (await client.query('select * from app_ticket_line where ticket_id=$1 order by id', [id])).rows;
    return toClientTicket(ticket, lines);
  } finally { client.release(); }
};
const managerId = randomUUID();
await sql.query('insert into app_user(id,username,password_hash,role,balance) values($1::uuid,$1::text,$2,\'MANAGER\',10000)', [managerId, 'test-only']);
async function player(balance = 1000) {
  const id = randomUUID();
  await sql.query('insert into app_user(id,username,password_hash,role,balance,manager_id) values($1::uuid,$1::text,$2,\'PLAYER\',$3,$4)', [id, 'test-only', balance, managerId]);
  return { id, role: 'PLAYER', status: 'ACTIVE' };
}
const balance = async id => Number((await sql.query('select balance from app_user where id=$1', [id])).rows[0].balance);
const count = async table => Number((await sql.query(`select count(*) n from ${table}`)).rows[0].n);
const source = new Map([
  ['1497|result||1', { matchId: '1497', marketKey: 'result', line: '', outcomeKey: '1', outcomeName: 'Home', marketName: '1X2', matchName: 'Al Arabi vs Al Nejmeh', price: 5 }],
  ['1497|total|3.5|over', { matchId: '1497', marketKey: 'total', line: '3.5', outcomeKey: 'over', outcomeName: 'Over', marketName: 'Total Goals', matchName: 'Al Arabi vs Al Nejmeh', price: 2.1 }],
  ['6983|result||1', { matchId: '6983', marketKey: 'result', line: '', outcomeKey: '1', outcomeName: 'Home', marketName: '1X2', matchName: 'Saturn vs Rodina', price: 15.18 }],
  ['1497|result||x', { matchId: '1497', marketKey: 'result', line: '', outcomeKey: 'x', outcomeName: 'Draw', marketName: '1X2', matchName: 'Al Arabi vs Al Nejmeh', price: 3.2 }],
  ['1497|btts||yes', { matchId: '1497', marketKey: 'btts', line: '', outcomeKey: 'yes', outcomeName: 'Yes', marketName: 'Both Teams to Score', matchName: 'Al Arabi vs Al Nejmeh', price: 3.2 }],
]);
let failResolution = null, resolveCalls = 0;
const resolve = async pick => {
  resolveCalls++;
  if (pick.outcomeId === failResolution?.id) throw Object.assign(new Error(failResolution.message), { status: 400, code: failResolution.code });
  const line = source.get(pick.outcomeId); assert.ok(line, 'test fixture selection exists'); return { ...line };
};
// Historical system batches remain readable, refundable and settleable.
// Exercise the old funded-column math only inside this isolated integration.
const place = createColumnsPlacer({ database, runQuery, getTicket, resolve,allowHistoricalSystemAlternatives:true });
const selections = [...source.keys()].slice(0, 3).map(outcomeId => ({ outcomeId, oddsAtPlacement: source.get(outcomeId).price }));
const input = user => ({ user, totalStake: 100, selections, clientRequestId: randomUUID() });
try {
  const user = await player(100), request = input(user), managerBefore = await balance(managerId);
  const [batch, replay] = await Promise.all([place(request), place(request)]);
  assert.deepEqual(batch, replay);
  assert.equal(resolveCalls, 9, 'each request resolves unique picks once; only the committing request rechecks under lock');
  assert.deepEqual(batch.system.columns.map(t => t.stake), [50, 50]);
  assert.equal(batch.stake, 100); assert.equal(batch.system.columnCount, 2);
  assert.equal(await balance(user.id), 0, '100 total is accepted with only 100 available');
  assert.equal(await count('app_ticket'), 2); assert.equal(await count('app_ticket_batch'), 1);
  assert.deepEqual(batch.system.columns.map(t => t.potentialPayout), [3795, 1593.9]);
  assert.deepEqual(batch.system.columns.map(t => t.lines.length), [2, 2]);
  assert.deepEqual(batch.system.columns.map(t => t.ticketType), ['SYSTEM', 'SYSTEM']);
  assert.deepEqual(batch.system.columns.map(t => t.systemType), ['AUTO:1/2', 'AUTO:2/2']);
  assert.match(batch.id,/^SYS-/); assert.equal(batch.ticketType,'SYSTEM');
  assert.equal(batch.tickets,undefined,'placement returns one logical ticket, never a receipt queue');
  assert.equal(batch.lines.length,3,'same match appears once for each original selected market');
  assert.deepEqual(batch.lines.map(line=>line.matchId),['1497','1497','6983']);
  const read = id => getTicketWithLines(id,{runQuery});
  assert.equal((await read(batch.id)).id,batch.id);
  for(const column of batch.system.columns) assert.equal((await read(column.id)).id,batch.id,'legacy child links resolve to complete logical ticket');
  assert.equal((await searchTickets(batch.id,{runQuery})).id,batch.id);
  assert.equal((await searchTickets(batch.system.columns[1].id,{runQuery})).id,batch.id);
  const compactBatchId=batch.system.batchId.replace(/-/g,'');
  assert.equal((await searchTickets('SYS-'+compactBatchId.slice(0,12),{runQuery})).id,batch.id,'printed System barcode searches its normalized UUID prefix');
  assert.equal((await searchTickets('SYS'+compactBatchId.slice(0,7),{runQuery})).id,batch.id,'legacy compact System barcode stays searchable');
  assert.equal((await searchTickets(batch.system.columns[0].id.replace(/-/g,'').slice(0,10),{runQuery})).id,batch.id,'legacy compact child barcode resolves the full logical ticket');
  assert.equal((await listActive(user.id,{runQuery})).length,1);
  assert.equal((await listHistory(user.id,{runQuery})).length,0);
  assert.equal((await listLogicalTickets({managerId,limit:1},{runQuery}))[0].id,batch.id);
  assert.equal((await listLogicalTickets({managerId:randomUUID()},{runQuery})).length,0);
  assert.equal((await withLines((await sql.query('select * from app_ticket where user_id=$1',[user.id])).rows,{runQuery})).length,1);
  const placedView = await listTransactions({userId:user.id},{runQuery});
  assert.equal(placedView.length,1,'one visible placement debit, two raw financial columns');
  assert.equal(placedView[0].amount,-100);assert.equal(placedView[0].balanceAfter,0);
  assert.equal(placedView[0].referenceId,batch.id);assert.equal(placedView[0].rawTransactionIds.length,2);
  assert.equal((await ledgerStats(managerId,{runQuery})).tickets,1);
  assert.equal((await ledgerStats(managerId,{runQuery})).pendingTickets,1);
  const financial=await managerFinancials(managerId,{runQuery});
  assert.equal(financial.manager.ticketCount,1);assert.equal(financial.players[0].ticketCount,1);
  assert.equal(financial.manager.totalStake,100,'logical ticket counts do not double the actual financial stake');
  assert.equal(await balance(managerId), managerBefore, 'system commissions are informational and do not debit the manager');
  assert.equal(financial.manager.sportCommission,5,'two actual 50 stakes at 5% produce 5 of reported sport commission');
  assert.equal(financial.manager.casinoCommission,0,'sport commission is kept separate from casino');
  assert.equal(financial.players[0].sportCommission,5);
  assert.equal(financial.players[0].commissionByTier.double,5);
  const placed = (await sql.query("select amount,balance_after from app_transaction where user_id=$1 and type='BET_PLACED' order by balance_after desc", [user.id])).rows;
  assert.deepEqual(placed.map(t => Number(t.amount)), [-50, -50]);
  assert.deepEqual(placed.map(t => Number(t.balance_after)), [50, 0]);
  // Replay survives feed suspension and still cannot debit twice.
  failResolution = { id: selections[0].outcomeId, message: 'suspended' };
  assert.deepEqual(await place(request), batch); failResolution = null;
  await assert.rejects(place({ ...request, totalStake: 101 }), error => error.status === 409);
  await assert.rejects(place({ ...request, clientRequestId: randomUUID() }), /Bilanci/);
  assert.equal(await count('app_ticket'), 2);

  // Both alternative columns may win. Their payouts add, exactly once.
  for (const ticket of batch.system.columns) {
    const rawLines = (await sql.query('select * from app_ticket_line where ticket_id=$1', [ticket.id])).rows;
    for (const line of rawLines) {
      const result = { home_score: line.match_id == 1497 ? 4 : 1, away_score: 0, home_team: 'Home', away_team: 'Away' };
      await sql.query('update app_ticket_line set status=$2 where id=$1', [line.id, gradeLine(line, result)]);
    }
  }
  for (const [index,ticket] of batch.system.columns.entries()) {
    assert.equal((await recalcTicket(ticket.id, { database })).status, 'WON');
    assert.equal(await recalcTicket(ticket.id, { database }), null);
    const groupedRead=await read(batch.id);
    assert.equal(groupedRead.status,index===0?'PENDING':'WON');
    if(index===0){
      assert.equal(groupedRead.actualPayout,3795);
      assert.equal((await listActive(user.id,{runQuery})).length,1);
      assert.equal((await listHistory(user.id,{runQuery})).length,0,'partially paid System never appears in settled history');
      await assert.rejects(revertTicket(batch.id,managerId,{database}),/completely pending/);
      await assert.rejects(revertTicket(batch.system.columns[1].id,managerId,{database}),/completely pending/);
    }
  }
  assert.equal(await balance(user.id), 5388.9);
  assert.equal(await balance(managerId),managerBefore,'settlement credits the player while leaving the manager wallet unchanged');
  assert.equal((await managerCommissionReport(runQuery)).players.get(user.id).sportCommission,5,'settlement preserves frozen commission terms');
  assert.equal(Number((await sql.query("select count(*) n from app_transaction where user_id=$1 and type='BET_WON'", [user.id])).rows[0].n), 2);
  assert.equal((await read(batch.id)).actualPayout,5388.9);
  assert.equal((await listHistory(user.id,{runQuery})).length,1);
  assert.equal((await listPlayerBetActivity({userId:user.id,status:'WON'},{runQuery})).length,1);
  assert.equal((await listPlayerBetActivity({userId:user.id,status:'PENDING'},{runQuery})).length,0);
  assert.equal((await listTransactions({userId:user.id},{runQuery})).filter(row=>row.type==='BET_WON').length,2,'distinct actual payments remain separate financial events');

  const poor = await player(99.99);
  await assert.rejects(place(input(poor)), /Bilanci/); assert.equal(await balance(poor.id), 99.99);
  const controls = await player(100);
  await sql.query('insert into app_player_controls(user_id,daily_limit) values($1,100)', [controls.id]);
  const capped = await place(input(controls)); assert.equal(capped.system.columns.length, 2, 'period cap applies total100 once');
  await assert.rejects(place(input(controls)), /kufi|kufir/i);
  const excluded = await player();
  await sql.query("insert into app_player_controls(user_id,self_excluded_until) values($1,now()+interval '1 day')", [excluded.id]);
  await assert.rejects(place(input(excluded)), /vetëpërjashtim/);

  for (const rejection of [{ message: 'suspended', code: 'MARKET_SUSPENDED' }, { message: 'odds changed', code: 'ODDS_CHANGED' }]) {
    const user = await player(), beforeCount = await count('app_ticket');
    failResolution = { id: selections[1].outcomeId, ...rejection };
    await assert.rejects(place(input(user)), error => error.code === rejection.code);
    assert.equal(await balance(user.id), 1000); assert.equal(await count('app_ticket'), beforeCount);
  }
  failResolution = null;
  // Fail on the second ticket insert after the first ticket and commission exist:
  // the real SQL rollback must remove all rows and restore both balances.
  const failingUser = await player(); let inserts = 0;
  const failingDatabase = { async connect() {
    const client = await database.connect();
    return { release: client.release, query: (text, params) => {
      if (/insert into app_ticket \(/.test(text) && ++inserts === 2) throw new Error('injected second-column write failure');
      return client.query(text, params);
    } };
  } };
  const failingPlace = createColumnsPlacer({ database: failingDatabase, runQuery, getTicket, resolve,allowHistoricalSystemAlternatives:true });
  const beforeTickets = await count('app_ticket'), beforeTransactions = await count('app_transaction'), beforeReports = await count('app_manager_commission'), beforeManager = await balance(managerId);
  await assert.rejects(failingPlace(input(failingUser)), /injected/);
  assert.equal(await count('app_ticket'), beforeTickets); assert.equal(await count('app_transaction'), beforeTransactions);
  assert.equal(await count('app_manager_commission'),beforeReports,'failed column placement rolls back its commission reports too');
  assert.equal(await balance(failingUser.id), 1000); assert.equal(await balance(managerId), beforeManager);

  const threeUser = await player(100);
  const three = await place({ ...input(threeUser), selections: [selections[0], selections[1], { outcomeId: '1497|btts||yes', oddsAtPlacement: 3.2 }] });
  assert.deepEqual(three.system.columns.map(t => t.stake), [33.34, 33.33, 33.33]);
  assert.equal((await managerCommissionReport(runQuery)).players.get(threeUser.id).sportCommission,3,'single-selection columns report rounded per-column commission');
  // One win, one loss, one void: settlement and void refund are independent.
  for (let i = 0; i < three.system.columns.length; i++) {
    await sql.query('update app_ticket_line set status=$2 where ticket_id=$1', [three.system.columns[i].id, ['WON', 'LOST', 'VOID'][i]]);
    const done = await recalcTicket(three.system.columns[i].id, { database });
    assert.equal(done.status, ['WON', 'LOST', 'VOID'][i]);
    assert.equal(await recalcTicket(three.system.columns[i].id, { database }), null);
  }
  assert.equal(await balance(threeUser.id), 200.03); //33.34*5 +33.33 refund
  assert.equal((await managerCommissionReport(runQuery)).players.get(threeUser.id).sportCommission,2,'the wholly VOID column is excluded from commission earnings');

  const cancelUser = await player(100), cancelManager = await balance(managerId);
  const cancel = await place(input(cancelUser));
  await assert.rejects(revertTicket(cancel.id,randomUUID(),{database}),error=>error.status===403);
  assert.equal(await balance(cancelUser.id),0,'unauthorized cancellation cannot refund any column');
  let refundWrites=0;
  const failingRefundDatabase={async connect(){const client=await database.connect();return {release:client.release,query(text,params){
    if(text.includes("'TICKET_REVERT'")&&++refundWrites===2)throw new Error('injected second-column refund failure');
    return client.query(text,params);
  }};}};
  const cancelTxBefore=await count('app_transaction'),cancelManagerAfterPlacement=await balance(managerId);
  await assert.rejects(revertTicket(cancel.id,managerId,{database:failingRefundDatabase}),/injected/);
  assert.equal(await balance(cancelUser.id),0);assert.equal(await balance(managerId),cancelManagerAfterPlacement);
  assert.equal(await count('app_transaction'),cancelTxBefore);
  assert.ok((await read(cancel.id)).system.columns.every(column=>column.status==='PENDING'),'all-or-none cancellation rollback');
  const cancellationRace=await Promise.allSettled([
    revertTicket(cancel.id,managerId,{database}),revertTicket(cancel.system.columns[0].id,managerId,{database}),
  ]);
  assert.equal(cancellationRace.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(cancellationRace.find(result=>result.status==='fulfilled').value.refunded,100);
  assert.match(cancellationRace.find(result=>result.status==='rejected').reason.message,/only.*pending/);
  for (const ticket of cancel.system.columns) {
    await assert.rejects(revertTicket(ticket.id, null, { database }), /only.*pending/);
    assert.equal(await recalcTicket(ticket.id, { database }), null);
  }
  assert.equal(await balance(cancelUser.id), 100); assert.equal(await balance(managerId), cancelManager);
  assert.equal((await managerCommissionReport(runQuery)).players.has(cancelUser.id),false,'reverted columns are excluded from the report without a wallet refund');
  assert.equal((await read(cancel.id)).status,'REVERTED');assert.equal((await read(cancel.id)).actualPayout,100);

  // Preserve the price contract accepted by legacy tickets. With a removed VOID
  // leg, recompute using only the surviving frozen price instead.
  const legacyUser = await player(100), legacy = await place(input(legacyUser));
  await sql.query('update app_ticket set potential_payout=3794.99 where id=$1', [legacy.system.columns[0].id]);
  await sql.query("update app_ticket_line set status='WON' where ticket_id=$1", [legacy.system.columns[0].id]);
  assert.equal((await recalcTicket(legacy.system.columns[0].id, { database })).payout, 3794.99);
  await sql.query("update app_ticket_line set status=case when match_id=6983 then 'VOID' else 'WON' end where ticket_id=$1", [legacy.system.columns[1].id]);
  assert.equal((await recalcTicket(legacy.system.columns[1].id, { database })).payout, 105);
  assert.equal(await balance(legacyUser.id), 3899.99);
  assert.equal((await read(legacy.id)).actualPayout,3899.99,'late VOID reduction is consolidated from independently graded columns');
  for (const ticket of legacy.system.columns) assert.equal(await recalcTicket(ticket.id, { database }), null);

  // Forged structures, duplicate picks/columns, and partial Cartesian products.
  const forged = await player();
  await assert.rejects(place({ ...input(forged), selections: [selections[0], selections[0]] }), /përsëritura/);
  await assert.rejects(place({ ...input(forged), columns: [[selections[0], selections[2]], [selections[0], selections[2]]] }), /përputhen/);
  await assert.rejects(place({ ...input(forged), columns: [[selections[0], selections[1]], [selections[1], selections[2]]] }), /përputhen/);
  await assert.rejects(place({ ...input(forged), selections: undefined, columns: [[selections[0], selections[2]]] }), /kolonash/);
  await assert.rejects(place({ ...input(forged), totalStake: 99.99 }), /minimale totale/);
  assert.equal(await balance(forged.id), 1000);
  await assert.rejects(place({ user: forged, stake: 100, columns: [[selections[0], selections[2]], [selections[1], selections[2]]], clientRequestId: randomUUID() }), /Rifresko faqen/);
  assert.equal(await balance(forged.id), 1000, 'old per-column client cannot silently place a differently priced slip');
  const regular = request => placeBet(request, { database, runQuery, getTicket, resolve });
  // One choice per exact market is a server rule across the WHOLE logical
  // ticket, even though alternatives would otherwise go into separate columns.
  const duplicateMarket = [selections[0], { outcomeId:'1497|result||x', oddsAtPlacement:3.2 }, selections[2]];
  const duplicateError = error => error.status === 400 && error.code === 'DUPLICATE_MARKET';
  const beforeInvalid = {
    funds:await balance(forged.id), manager:await balance(managerId),
    tickets:await count('app_ticket'), batches:await count('app_ticket_batch'), transactions:await count('app_transaction'),
  };
  await assert.rejects(place({ ...input(forged), selections:duplicateMarket }), duplicateError);
  await assert.rejects(place({ ...input(forged), selections:undefined, columns:[
    [duplicateMarket[0],duplicateMarket[2]], [duplicateMarket[1],duplicateMarket[2]],
  ] }), duplicateError);
  await assert.rejects(regular({ user:forged, stake:100, selections:duplicateMarket.slice(0,2) }), duplicateError);
  await assert.rejects(bookTicket({ stake:100, selections:duplicateMarket.slice(0,2) }), duplicateError);
  const disguised = { ...duplicateMarket[1], marketId:'forged-different-market', matchId:'another-match', marketName:'Other' };
  await assert.rejects(place({ ...input(forged), selections:[duplicateMarket[0],disguised,duplicateMarket[2]] }), duplicateError);
  // Raw IDs are only preflight evidence. Canonical resolved fields must also
  // agree, so an alternate identifier cannot turn one source market into two.
  source.set('1497|alias||x', { ...source.get('1497|result||x') });
  await assert.rejects(place({ ...input(forged), selections:[selections[0],{outcomeId:'1497|alias||x',oddsAtPlacement:3.2},selections[2]] }), duplicateError);
  // Synthetic templates sharing two source markets are choices in the same
  // grouped builder market, even when both template IDs and outcomes differ.
  const yesOverId=randomUUID(),noUnderId=randomUUID(),otherLineId=randomUUID(),otherFamilyId=randomUUID();
  const builderPick=(id,first,second)=>{
    const outcomeId=`BB|1497|${id}`;
    source.set(outcomeId,{matchId:'1497',marketKey:`BB:${id}`,line:'',outcomeKey:'builder',
      outcomeName:'Builder option',marketName:'Bet Builder',matchName:'Home vs Away',price:4,
      builderLegs:[first,second].map(part=>({match_id:1497,...part})),
    });
    return {outcomeId,oddsAtPlacement:4};
  };
  const yesOverPick=builderPick(yesOverId,{market_key:'btts',line:'',outcome_key:'yes'},{market_key:'total',line:'2.5',outcome_key:'over'});
  const noUnderPick=builderPick(noUnderId,{market_key:'total',line:'2.5',outcome_key:'under'},{market_key:'btts',line:'',outcome_key:'no'});
  await assert.rejects(place({ ...input(forged), selections:[yesOverPick,noUnderPick,selections[2]] }),duplicateError);
  await assert.rejects(regular({user:forged,stake:100,selections:[yesOverPick,noUnderPick]}),duplicateError);
  const disguisedBuilder={...noUnderPick,builderLegs:[{marketId:'fake|one|',outcomeId:'fake|one||yes'},{marketId:'fake|two|',outcomeId:'fake|two||over'}]};
  await assert.rejects(place({...input(forged),selections:[yesOverPick,disguisedBuilder,selections[2]]}),duplicateError,'fake submitted constituent metadata cannot evade authoritative builder identity');
  assert.deepEqual({
    funds:await balance(forged.id), manager:await balance(managerId),
    tickets:await count('app_ticket'), batches:await count('app_ticket_batch'), transactions:await count('app_transaction'),
  }, beforeInvalid, 'rejected same-market requests cannot create tickets, debits, commissions or batches');
  // Distinct goal lines and periods remain independent valid contracts.
  source.set('1497|total|4.5|under', { ...source.get('1497|total|3.5|over'), line:'4.5', outcomeKey:'under', outcomeName:'Under', price:1.8 });
  source.set('1497|totalp1|3.5|under', { ...source.get('1497|total|3.5|over'), marketKey:'totalp1', outcomeKey:'under', outcomeName:'Under', marketName:'First Half Total Goals', price:1.9 });
  const distinctContracts = await place({ ...input(forged), selections:[
    selections[1], {outcomeId:'1497|total|4.5|under',oddsAtPlacement:1.8},
    {outcomeId:'1497|totalp1|3.5|under',oddsAtPlacement:1.9}, selections[2],
  ] });
  assert.equal(distinctContracts.system.columnCount,3);
  assert.deepEqual(distinctContracts.system.columns.map(column=>column.stake),[33.34,33.33,33.33]);
  assert.equal(distinctContracts.stake,100); assert.equal(await balance(forged.id),900);
  assert.equal(distinctContracts.lines.length,4,'all different-market choices print on one logical ticket');
  const otherLinePick=builderPick(otherLineId,{market_key:'btts',line:'',outcome_key:'yes'},{market_key:'total',line:'3.5',outcome_key:'over'});
  const otherFamilyPick=builderPick(otherFamilyId,{market_key:'result',line:'',outcome_key:'1'},{market_key:'total',line:'2.5',outcome_key:'over'});
  const builderUser=await player(100);
  const distinctBuilders=await place({...input(builderUser),selections:[yesOverPick,otherLinePick,otherFamilyPick,selections[0]]});
  assert.equal(distinctBuilders.system.columnCount,4,'different builder families/lines and a native market remain independent choices');
  assert.equal(distinctBuilders.lines.length,4);assert.equal(distinctBuilders.stake,100);
  assert.deepEqual(distinctBuilders.system.columns.map(column=>column.stake),[25,25,25,25]);
  assert.equal(await balance(builderUser.id),0);
  await assert.rejects(regular({ user, stake: 100, selections: [selections[0]], clientRequestId: request.clientRequestId }), error => error.status === 409);
  const singleUser = await player(), singleId = randomUUID();
  const ordinaryTicket=await regular({ user: singleUser, stake: 100, selections: [selections[0]], clientRequestId: singleId });
  assert.equal((await searchTickets(ordinaryTicket.id.replace(/-/g,'').slice(0,10),{runQuery})).id,ordinaryTicket.id);
  await sql.query('update app_ticket set booking_code=$2 where id=$1',[ordinaryTicket.id,compactBatchId.slice(0,6).toUpperCase()]);
  assert.equal((await searchTickets(compactBatchId.slice(0,6),{runQuery})).id,ordinaryTicket.id,'exact booking codes take priority over ID fragments');
  await assert.rejects(place({ ...input(singleUser), clientRequestId: singleId }), error => error.status === 409);
  assert.equal(await balance(singleUser.id), 900);
  // The key is shared across ordinary and system endpoints under the same wallet lock.
  const racing = await player(), sharedId = randomUUID();
  const race = await Promise.allSettled([
    regular({ user: racing, stake: 100, selections: [selections[0]], clientRequestId: sharedId }),
    place({ ...input(racing), clientRequestId: sharedId }),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(await balance(racing.id), 900);
  for (const invalid of [Infinity, NaN, -1, 99.99, 100.001]) await assert.rejects(regular({ user: racing, stake: invalid, selections: [selections[0]] }));
  await assert.rejects(regular({ user: racing, stake: 100, selections: [selections[0], selections[1]] }), /njëjta ndeshje/);
  // Global LIVE limits see the total slip100, rather than accidentally counting200.
  upsert([1497, 6983].map(match_id => ({ match_id, home: 'Home', away: 'Away', service: 'LIVE' })));
  const riskUser = await player();
  const riskSettings = { ...DEFAULT_LIVE_RISK_SETTINGS, limits: { ...DEFAULT_LIVE_RISK_SETTINGS.limits, maxLiveStake: 100, maxMatchExposure: null } };
  await sql.query('update app_live_risk_settings set settings=$1::jsonb where id=1', [JSON.stringify(riskSettings)]);
  const riskBatch = await place(input(riskUser)); assert.equal(riskBatch.stake, 100);
  const riskRejected = await player();
  await assert.rejects(place({ ...input(riskRejected), totalStake: 100.01 }), error => error.code === 'LIVE_RISK_LIMIT');
  assert.equal(await balance(riskRejected.id), 1000);
  await sql.query('update app_live_risk_settings set settings=$1::jsonb where id=1', [JSON.stringify(DEFAULT_LIVE_RISK_SETTINGS)]);
  const sameKeyOtherUser=await player();
  const independent=await place({...input(sameKeyOtherUser),clientRequestId:request.clientRequestId});
  assert.notEqual(independent.id,batch.id,'public System ID is globally unique even when two users choose the same request key');
  assert.equal((await read(independent.id)).userId,sameKeyOtherUser.id);
  const ambiguousOther=await player(),ambiguous=await place(input(ambiguousOther));
  await sql.query('update app_ticket_batch set id=$2 where id=$1',[independent.system.batchId,'aaaaaaaa-aaaa-4000-8000-000000000001']);
  await sql.query('update app_ticket_batch set id=$2 where id=$1',[ambiguous.system.batchId,'aaaaaaaa-aaaa-4000-8000-000000000002']);
  await assert.rejects(searchTickets('SYS-aaaaaaaaaaaa',{runQuery}),/paqartë/,'ambiguous printed prefixes never return a random ticket');
  await sql.query('update app_ticket_batch set id=$2 where id=$1',['aaaaaaaa-aaaa-4000-8000-000000000001',independent.system.batchId]);
  await sql.query('update app_ticket_batch set id=$2 where id=$1',['aaaaaaaa-aaaa-4000-8000-000000000002',ambiguous.system.batchId]);
  const newManager=randomUUID();
  await sql.query("insert into app_user(id,username,password_hash,role,balance) values($1::uuid,$1::text,'test-only','MANAGER',5000)",[newManager]);
  for(const system of [true,false]){
    const reassigned=await player(100),originalManagerBalance=await balance(managerId);
    const placed=system?await place(input(reassigned)):await regular({user:reassigned,stake:100,selections:[selections[0]],clientRequestId:randomUUID()});
    assert.equal(await balance(managerId),originalManagerBalance,'new commission report does not debit the original manager');
    const frozen=(await sql.query('select manager_id,amount from app_manager_commission where player_id=$1',[reassigned.id])).rows;
    assert.equal(frozen.length,system?2:1);assert.ok(frozen.every(row=>row.manager_id===managerId),'commission ownership is frozen at placement');
    assert.equal(frozen.reduce((sum,row)=>sum+Number(row.amount),0),system?5:3);
    await sql.query('update app_user set manager_id=$2 where id=$1',[reassigned.id,newManager]);
    await assert.rejects(revertTicket(placed.id,managerId,{database}),error=>error.status===403,'previous manager cannot cancel a reassigned player ticket');
    assert.equal(await balance(reassigned.id),0);
    assert.equal((await revertTicket(placed.id,newManager,{database})).refunded,100);
    assert.equal(await balance(reassigned.id),100);
    assert.equal(await balance(managerId),originalManagerBalance,'cancellation does not create an unearned wallet credit');
    assert.equal(await balance(newManager),5000,'new manager receives no commission wallet credit either');
    assert.equal((await managerCommissionReport(runQuery)).players.has(reassigned.id),false,'reverted commission is excluded after player reassignment');
  }
  // Simulate pre-unified batches: the migration backfills only metadata, never funds.
  const balancesBeforeMigration=(await sql.query('select id,balance from app_user order by id')).rows;
  const rawTransactionsBeforeMigration=await count('app_transaction');
  await sql.query('alter table app_ticket_batch drop column id');
  await sql.query('alter table app_ticket_batch drop column selection_order');
  await sql.exec(LEDGER_SQL);
  assert.deepEqual((await sql.query('select id,balance from app_user order by id')).rows,balancesBeforeMigration);
  assert.equal(await count('app_transaction'),rawTransactionsBeforeMigration);
  const migrated=await read(batch.system.columns[0].id);
  assert.equal(migrated.lines.length,3);assert.equal(migrated.stake,100);assert.equal(migrated.actualPayout,5388.9);
  await sql.exec(LEDGER_SQL);
  assert.equal((await read(batch.system.columns[0].id)).id,migrated.id,'idempotent metadata migration preserves the public ticket ID');
  assert.equal(await balance(managerId),10000,'all placements, cancellations and settlements leave the manager wallet unchanged');
  assert.equal(Number((await sql.query('select count(*) n from app_transaction where user_id=$1',[managerId])).rows[0].n),0,'report-only commissions and match results never post manager wallet movements');
  console.log('PASS system SQL ledger: total minimum100, exact50/33.34 split, server Cartesian validation, idempotent race/retry, atomic rollback, report-only commissions, exclusions/limits, cancellation, additive wins/losses/VOID and no double credits');
} finally { await sql.close(); }
