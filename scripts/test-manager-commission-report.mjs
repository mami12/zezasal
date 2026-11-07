import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const parent=resolve('tmp');await mkdir(parent,{recursive:true});const temp=await mkdtemp(join(parent,'commission-report-'));
Object.assign(process.env,{DB_DRIVER:'local',LOCAL_DATABASE_DIR:join(temp,'database'),DATABASE_URL:'',JWT_SECRET:'isolated-report-only-test-secret-not-production',SEED_DEFAULT_ACCOUNTS:'false',CASINO_REAL_MONEY_ENABLED:'true',CASINO_MATH_APPROVED:'true'});
const {pool,initSchema}=await import('../server/db.mjs');
const ledger=await import('../server/ledger/store.mjs');
const {chargeManagerCommission,refundManagerCommission,managerCommissionReport,getManagerCommissionRates}=await import('../server/ledger/manager-finance.mjs');
const {createColumnsPlacer}=await import('../server/ledger/bets.mjs');
const {recalcTicket}=await import('../server/ledger/settler.mjs');
const {placeCasinoSpin,settlePendingWin}=await import('../server/casino/transactions.mjs');
const {placeBookOfRaSpin}=await import('../server/casino/bookofra-transactions.mjs');
const {directoryReport,saveDirectoryUser}=await import('../server/ledger/directory.mjs');
const balance=async id=>Number((await pool.query('select balance from app_user where id=$1',[id])).rows[0].balance);
try{
 await initSchema();await ledger.initLedgerSchema();
 const manager=await ledger.createUser({username:'report-manager',role:'MANAGER',balance:500,passwordHash:'test-only'}),
 player=await ledger.createUser({username:'report-player',role:'PLAYER',managerId:manager.id,balance:1000,passwordHash:'test-only'}),
 admin=await ledger.createUser({username:'report-admin',role:'ADMIN',passwordHash:'test-only'});
 await pool.query('update app_commission_config set casino_pct=10 where id=1');
 const resolveSelection=async selection=>{const [matchId,marketKey,line,outcomeKey]=selection.outcomeId.split('|');return {matchId,marketKey,line,outcomeKey,price:2,marketName:marketKey==='result'?'1X2':'Total Goals',outcomeName:outcomeKey,matchName:'Home vs Away'};};
 const place=createColumnsPlacer({resolve:resolveSelection,assertRisk:async()=>{},assertPlayer:async()=>{},lockRisk:async()=>({})});
 const req={user:player,totalStake:100,clientRequestId:randomUUID(),selections:[{outcomeId:'99|result||1',oddsAtPlacement:2},{outcomeId:'99|total|2.5|over',oddsAtPlacement:2}]};
 const placed=await place(req);assert.deepEqual(await place(req),placed);assert.equal(await balance(manager.id),500);assert.equal(await balance(player.id),900);
 let report=await managerCommissionReport(pool);assert.equal(report.managers.get(manager.id).sportCommission,3);assert.equal(report.managers.get(manager.id).casinoCommission,0);
 assert.equal(Number((await pool.query('select count(*) as n from app_manager_commission')).rows[0].n),2);
 for(const [i,col] of placed.system.columns.entries()){await pool.query('update app_ticket_line set status=$2 where ticket_id=$1',[col.id,i===0?'WON':'LOST']);await recalcTicket(col.id);await recalcTicket(col.id);}
 assert.equal(await balance(player.id),1000);assert.equal(await balance(manager.id),500,'sports player payouts/losses do not touch manager funds');
 assert.equal(Number((await pool.query("select count(*) as n from app_transaction where user_id=$1",[manager.id])).rows[0].n),0);
 const voided=randomUUID();await pool.query("insert into app_ticket(id,user_id,stake,total_odds,potential_payout,status) values($1,$2,100,2,200,'PENDING')",[voided,player.id]);
 await chargeManagerCommission(pool,{managerId:manager.id,ticketId:voided,stake:100,selectionCount:1});
 await pool.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,101,'result','1','Home','1X2','Home vs Away',2,'VOID')",[voided]);
 await recalcTicket(voided);report=await managerCommissionReport(pool);assert.equal(report.managers.get(manager.id).sportCommission,3);assert.equal(await balance(manager.id),500);
 await pool.query('update app_commission_config set single_pct=7,casino_pct=5 where id=1');
 assert.equal(await chargeManagerCommission(pool,{managerId:manager.id,ticketId:placed.system.columns[0].id,stake:50,selectionCount:1}),1.5,'original rate frozen');
 const spin=await placeCasinoSpin({userId:player.id,requestId:randomUUID(),bet:1,denomination:4,lines:5},{random:()=>0});
 const replay=await placeCasinoSpin({userId:player.id,requestId:(await pool.query('select client_request_id from app_casino_round where id=$1',[spin.roundId])).rows[0].client_request_id,bet:1,denomination:4,lines:5},{random:()=>0});assert.equal(replay.roundId,spin.roundId);
 await settlePendingWin(player.id);assert.equal(await balance(manager.id),500,'slot spin/collect never credits or debits manager');
 await placeBookOfRaSpin({userId:player.id,requestId:randomUUID(),bet:1,denomination:2,lines:10},{random:()=>0});await settlePendingWin(player.id);assert.equal(await balance(manager.id),500);
 const ids=['lucky-clover-x3','vikings-fun','fruit-queen','seven-hot'];
 for(const game of ids){const rid=randomUUID();await pool.query(`insert into app_casino_round(id,user_id,client_request_id,game_id,game_version,bet,denomination,lines,stake,payout,balance_after,result) values($1,$2,$3,$4,'test',1,1,20,20,0,100,'{}')`,[rid,player.id,randomUUID(),game]);}
 report=await managerCommissionReport(pool);assert.equal(report.managers.get(manager.id).casinoCommission,6);assert.equal(report.players.get(player.id).casinoCommission,6);
 await pool.query('update app_commission_config set casino_pct=90 where id=1');assert.equal((await managerCommissionReport(pool)).managers.get(manager.id).casinoCommission,6,'old casino rates frozen');
 const finance=await ledger.managerFinancials(manager.id);assert.equal(finance.manager.sportCommission,3);assert.equal(finance.manager.casinoCommission,6);assert.equal(finance.players[0].sportCommission,3);assert.equal(finance.players[0].casinoCommission,6);
 const directory=await directoryReport(admin);assert.equal(directory.summary.sportCommission,3);assert.equal(directory.summary.casinoCommission,6);assert.equal(directory.commissionBasis,'REPORT_ONLY_ON_STAKE');assert.equal(await balance(manager.id),500);
 // An old real debit is retained, and only an actual cancellation refunds it.
 const legacy=randomUUID();await pool.query("insert into app_ticket(id,user_id,stake,total_odds,potential_payout,status) values($1,$2,100,2,200,'PENDING')",[legacy,player.id]);
 await pool.query("insert into app_ticket_line(ticket_id,match_id,market_key,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status) values($1,102,'result','1','Home','1X2','Home vs Away',2,'VOID')",[legacy]);
 await pool.query('update app_user set balance=497 where id=$1',[manager.id]);
 await pool.query("insert into app_transaction(user_id,amount,type,reference_id,balance_after) values($1,-3,'MANAGER_COMMISSION_DEBIT',$2,497)",[manager.id,legacy]);
 await ledger.initLedgerSchema();assert.equal(await balance(manager.id),497,'startup never rewrites historical balance');
 assert.equal(await chargeManagerCommission(pool,{managerId:manager.id,ticketId:legacy,stake:100,selectionCount:1}),3);assert.equal(await balance(manager.id),497);
 const newOwner=await ledger.createUser({username:'new-report-owner',role:'MANAGER',balance:50,passwordHash:'test-only'});await pool.query('update app_user set manager_id=$2 where id=$1',[player.id,newOwner.id]);
 assert.equal(await chargeManagerCommission(pool,{managerId:newOwner.id,ticketId:legacy,stake:100,selectionCount:1}),3,'legacy owner change never duplicates the commission');assert.equal(await balance(newOwner.id),50);
 await recalcTicket(legacy);assert.equal(await balance(manager.id),500);await refundManagerCommission(pool,{managerId:manager.id,ticketId:legacy,username:player.username});assert.equal(await balance(manager.id),500,'historical debit refunded once only');
 assert.equal((await pool.query('select count(*) as n from app_manager_commission where ticket_id=$1',[legacy])).rows[0].n,0);
 await assert.rejects(saveDirectoryUser(admin,manager.id,{role:'PLAYER'}),/Llogaria ka bilanc|histori/);
 await pool.query('delete from app_ticket where id=$1',[voided]);assert.equal(Number((await pool.query('select count(*) as n from app_manager_commission where ticket_id=$1',[voided])).rows[0].n),0,'report follows retained source history');
 console.log('PASS report-only sports/slots commission: actual system stakes, frozen rates, retries, player payouts, no automatic manager wallet movements, VOID exclusion, separate per-player totals, legacy debit preservation/exact refund, idempotent schema and source cleanup');
}finally{await pool.end();assert.ok(resolve(temp).startsWith(parent));await rm(temp,{recursive:true,force:true});}
