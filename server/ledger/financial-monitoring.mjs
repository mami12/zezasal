import express from 'express';
import {pool,query} from '../db.mjs';
import {requireAuth} from './auth.mjs';
import {isLedgerReady} from './store.mjs';
import {systemColumnPayout} from './system-columns.mjs';
import {manualReviewQueue} from './manual-review-queue.mjs';
import {setFootballInformationMapping,inspectFootballInformation,sourceMatchNeeds,describeJsonStructure} from '../stats-providers/football-information.mjs';
import {getMatchById} from '../matches.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const cents=n=>Math.round(Number(n)*100),money=n=>Number((n/100).toFixed(2));
const splitCents=(amount,keys)=>{
 const sorted=[...keys].sort(),base=Math.floor(amount/sorted.length),remainder=amount%sorted.length;
 return new Map(sorted.map((key,index)=>[key,base+(index<remainder?1:0)]));
};

/** Each physical paid column is counted once; linked parlay liabilities remain conditional. */
export function buildMatchExposure(rows){
 const tickets=new Map(),matches=new Map();
 for(const row of rows){
  let ticket=tickets.get(row.ticket_id);
  if(!ticket){ticket={id:row.ticket_id,logicalId:row.logical_id??row.ticket_id,userId:row.user_id,username:row.username,
   stake:cents(row.stake),quote:cents(row.original_potential_payout??row.potential_payout),status:row.ticket_status,matches:new Map()};tickets.set(row.ticket_id,ticket);}
  const id=String(row.match_id),list=ticket.matches.get(id)??[];list.push(row);ticket.matches.set(id,list);
 }
 for(const ticket of tickets.values())for(const [id,lines]of ticket.matches){
  let match=matches.get(id);if(!match){match={matchId:id,name:lines[0].match_name,users:new Map(),tickets:new Set(),physicalColumns:0,linkedStake:0,allocatedStake:0,pendingStake:0,markets:new Map()};matches.set(id,match);}
  const allocated=splitCents(ticket.stake,ticket.matches.keys()).get(id);
  match.tickets.add(ticket.logicalId);match.physicalColumns++;match.linkedStake+=ticket.stake;match.allocatedStake+=allocated;
  if(ticket.status==='PENDING')match.pendingStake+=ticket.stake;
  const user=match.users.get(ticket.userId)??{id:ticket.userId,username:ticket.username,linkedStake:0,allocatedStake:0,tickets:new Set()};
  user.linkedStake+=ticket.stake;user.allocatedStake+=allocated;user.tickets.add(ticket.logicalId);match.users.set(ticket.userId,user);
  const selected=new Map(lines.map(line=>[[line.market_key,line.line??'',line.outcome_key].join('|'),line]));
  const selectionShares=splitCents(allocated,selected.keys());
  for(const [key,line]of selected){
   const marketId=[line.market_key,line.line??''].join('|');
   const market=match.markets.get(marketId)??{id:marketId,marketKey:line.market_key,name:line.market_name,line:line.line,outcomes:new Map()};
   const outcome=market.outcomes.get(line.outcome_key)??{key:line.outcome_key,name:line.outcome_name,users:new Set(),members:new Map(),tickets:new Set(),linkedStake:0,allocatedStake:0,maxConditionalPayout:0,odds:new Set()};
   outcome.users.add(ticket.userId);outcome.tickets.add(ticket.logicalId);outcome.linkedStake+=ticket.stake;outcome.allocatedStake+=selectionShares.get(key);outcome.odds.add(Number(line.odds_at_placement));
   const member=outcome.members.get(ticket.userId)??{id:ticket.userId,username:ticket.username,linkedStake:0,allocatedStake:0,tickets:new Set(),odds:new Set()};
   member.linkedStake+=ticket.stake;member.allocatedStake+=selectionShares.get(key);member.tickets.add(ticket.logicalId);member.odds.add(Number(line.odds_at_placement));outcome.members.set(ticket.userId,member);
   if(ticket.status==='PENDING'&&line.status!=='LOST')outcome.maxConditionalPayout+=ticket.quote;
   market.outcomes.set(line.outcome_key,outcome);match.markets.set(marketId,market);
  }
 }
 return {totals:{tickets:new Set([...tickets.values()].map(t=>t.logicalId)).size,physicalColumns:tickets.size,
  stake:money([...tickets.values()].reduce((n,t)=>n+t.stake,0)),pendingStake:money([...tickets.values()].filter(t=>t.status==='PENDING').reduce((n,t)=>n+t.stake,0))},
  matches:[...matches.values()].map(m=>({...m,uniqueUsers:m.users.size,tickets:m.tickets.size,linkedStake:money(m.linkedStake),allocatedStake:money(m.allocatedStake),pendingStake:money(m.pendingStake),
   users:[...m.users.values()].map(u=>({...u,tickets:u.tickets.size,linkedStake:money(u.linkedStake),allocatedStake:money(u.allocatedStake)})),
   markets:[...m.markets.values()].map(market=>({...market,outcomes:[...market.outcomes.values()].map(o=>({...o,users:o.users.size,members:[...o.members.values()].map(u=>({...u,linkedStake:money(u.linkedStake),allocatedStake:money(u.allocatedStake),tickets:u.tickets.size,odds:[...u.odds]})),tickets:o.tickets.size,odds:[...o.odds],linkedStake:money(o.linkedStake),allocatedStake:money(o.allocatedStake),maxConditionalPayout:money(o.maxConditionalPayout),netAtRisk:money(m.pendingStake-o.maxConditionalPayout)}))}))}))};
}
export async function matchExposure(execute=query){
 const rows=(await execute(`select l.*,t.id as ticket_id,t.user_id,t.stake,t.potential_payout,t.original_potential_payout,t.status as ticket_status,u.username,
  coalesce((select b.id::text from app_ticket_batch b where t.id=any(b.ticket_ids) limit 1),t.id::text) as logical_id
  from app_ticket_line l join app_ticket t on t.id=l.ticket_id left join app_user u on u.id=t.user_id
  where t.status not in ('REVERTED','CANCELLED') order by t.placed_at,t.id,l.id`)).rows;
 return buildMatchExposure(rows);
}

/** An audited manual correction posts only the difference from an existing payment. */
export async function manualSettlement(input,actor,{database=pool}={}){
 const status=String(input.status??'');
 // The authenticated ADMIN's choice is sufficient in the UI. Keep a truthful
 // server-side audit entry without presenting evidence that was never checked.
 const reason=String(input.reason??'').trim()||'Ndryshim manual i statusit nga administratori.';
 const source=String(input.source??'').trim()||'ADMIN_PANEL';
 if(!['WON','LOST','PENDING','VOID'].includes(status)||reason.length>1000||source.length>500)throw fail(400,'Zgjidh një gjendje të vlefshme.');
 const ticketId=input.ticketId?String(input.ticketId):null,lineId=input.lineId?String(input.lineId):null,matchId=Number(input.matchId),marketKey=String(input.marketKey??''),outcomeKey=String(input.outcomeKey??'');
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if((ticketId&&!uuid.test(ticketId))||(lineId&&!uuid.test(lineId))||(ticketId&&lineId))throw fail(400,'Zgjidh një biletë ose përzgjedhje të vlefshme.');
 if(!ticketId&&!lineId&&(!Number.isSafeInteger(matchId)||matchId<=0||!marketKey||!outcomeKey))throw fail(400,'Zgjidh biletën ose ndeshjen, tregun dhe përzgjedhjen e saktë.');
 const client=await database.connect();
 try{
  await client.query('begin');
  const owner=(await client.query('select role,status,deleted_at from app_user where id=$1 for share',[actor.id])).rows[0];
  if(owner?.role!=='ADMIN'||owner.status!=='ACTIVE'||owner.deleted_at)throw fail(403,'Vetëm administratori aktiv mund të verifikojë shlyerjen.');
  const selectedSql=lineId?'select * from app_ticket_line where id=$1':ticketId?'select * from app_ticket_line where ticket_id=$1':'select * from app_ticket_line where match_id=$1 and market_key=$2 and line=$3 and outcome_key=$4';
   const selectedParams=lineId?[lineId]:ticketId?[ticketId]:[matchId,marketKey,String(input.line??''),outcomeKey];
   const selected=(await client.query(selectedSql,selectedParams)).rows;
  if(!selected.length)throw fail(404,'Nuk u gjetën përzgjedhje për këtë vendim.');
  const ids=[...new Set(selected.map(l=>l.ticket_id))].sort(),selectedIds=new Set(selected.map(l=>l.id)),changed=[];
  for(const id of ids){
   const ticket=(await client.query('select * from app_ticket where id=$1 for update',[id])).rows[0];
   if(['CANCELLED','REVERTED','CASHED_OUT'].includes(ticket.status))throw fail(409,'Bileta është anuluar, kthyer ose paguar para kohe; kërkohet kontroll i veçantë financiar.');
   const lines=(await client.query('select * from app_ticket_line where ticket_id=$1 order by id for update',[id])).rows;
   const decisions=lines.filter(line=>selectedIds.has(line.id)).map(line=>({lineId:line.id,matchId:String(line.match_id),marketKey:line.market_key,line:line.line,outcomeKey:line.outcome_key,from:line.status,to:status}));
   for(const line of lines)if(selectedIds.has(line.id)){
    await client.query('update app_ticket_line set status=$2 where id=$1',[line.id,status]);line.status=status;
    await client.query(`insert into app_settlement_override(line_id,status,actor_id,reason,source)values($1,$2,$3,$4,$5)
     on conflict(line_id)do update set status=excluded.status,actor_id=excluded.actor_id,reason=excluded.reason,source=excluded.source,updated_at=now()`,[line.id,status,actor.id,reason,source]);
   }
   // A losing accumulator must close immediately even when other legs wait.
   const next=lines.some(l=>l.status==='LOST')?'LOST':lines.some(l=>l.status==='PENDING')?'PENDING':lines.every(l=>l.status==='VOID')?'VOID':'WON';
   const quote=Number(ticket.original_potential_payout??ticket.potential_payout);
   const paid=next==='WON'?(lines.some(l=>l.status==='VOID')?systemColumnPayout(Number(ticket.stake),lines.filter(l=>l.status==='WON').map(l=>l.odds_at_placement)):quote):next==='VOID'?Number(ticket.stake):0;
   const previousPaid=['WON','VOID'].includes(ticket.status)?Number(ticket.potential_payout):0,delta=cents(paid)-cents(previousPaid);
   if(delta&&ticket.user_id){
    const user=(await client.query('select balance from app_user where id=$1 for update',[ticket.user_id])).rows[0];
    if(!user||cents(user.balance)+delta<0)throw fail(409,'Bilanci nuk mbulon kthimin e pagesës së mëparshme. Kontrollo llogarinë para korrigjimit.');
    const after=money(cents(user.balance)+delta);
    await client.query('update app_user set balance=$2,updated_at=now() where id=$1',[ticket.user_id,after]);
    await client.query("insert into app_transaction(user_id,amount,type,reference_id,balance_after,description)values($1,$2,'MANUAL_SETTLEMENT_CORRECTION',$3,$4,$5)",[ticket.user_id,money(delta),id,after,reason]);
   }
   await client.query("update app_ticket set status=$2,potential_payout=$3,settled_at=case when $2='PENDING' then null else now() end where id=$1",[id,next,next==='PENDING'?quote:paid]);
   const details={from:ticket.status,to:next,paymentDifference:money(delta),reason,source,decisions,matchId:ticketId||lineId?null:matchId,marketKey:ticketId||lineId?null:marketKey};
   await client.query("insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details)values($1,$2,'ADMIN','MANUAL_SETTLEMENT','ticket',$3,$4::jsonb)",[actor.id,actor.username,id,JSON.stringify(details)]);
   changed.push({ticketId:id,status:next,actualPayout:paid,paymentDifference:money(delta)});
  }
  await client.query('commit');return {changed};
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
}
export const financialMonitoringRouter=express.Router();
financialMonitoringRouter.use(['/admin/match-exposure','/admin/statistics-review','/admin/manual-settlement','/admin/settlement-review-queue','/admin/football-information/fixture','/admin/football-information/map','/admin/football-information/probe'],requireAuth,(req,res,next)=>req.user.role!=='ADMIN'?res.status(403).json({message:'Vetëm administratori.'}):!isLedgerReady()?res.status(503).json({message:'Databaza nuk është gati.'}):next());
const safe=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(error=>error.status?res.status(error.status).json({message:error.message}):next(error));
financialMonitoringRouter.get('/admin/match-exposure',safe(async(_req,res)=>res.set('Cache-Control','no-store').json(await matchExposure())));
financialMonitoringRouter.get('/admin/statistics-review',safe(async(_req,res)=>res.set('Cache-Control','no-store').json({reviews:(await query('select match_id,payload,updated_at from app_stat_review order by updated_at desc')).rows})));
financialMonitoringRouter.post('/admin/manual-settlement',safe(async(req,res)=>res.json(await manualSettlement(req.body??{},req.user))));
financialMonitoringRouter.get('/admin/settlement-review-queue',safe(async(req,res)=>res.set('Cache-Control','no-store').json(await manualReviewQueue({limit:req.query.limit}))));
/** Read-only football enrichment diagnostics, isolated from settlement and money. */
financialMonitoringRouter.get('/admin/football-information/fixture',safe(async(req,res)=>{
 const id=Number(req.query.matchId);
 if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({message:'ID e ndeshjes është e pavlefshme.'});
 const match=await getMatchById(id);
 const [map,needs,snapshots]=await Promise.all([
  query('select match_id,aiscore_id,thesports01_id,mapping_status,last_checked_at,last_error from app_football_information_map where match_id=$1',[id]),
  sourceMatchNeeds(id),
  query('select distinct on(source) source,payload,observed_at from app_football_information_snapshot where match_id=$1 order by source,observed_at desc',[id])
 ]);
 res.set('Cache-Control','no-store').json({
  match:match?{matchId:id,home:match.home,away:match.away,startAt:match.start_at,
    football:match.sport_tag==='football'||[1,18].includes(Number(match.sport_id))}:null,
  mapping:map.rows[0]??null,needs,
  snapshots:snapshots.rows.map(row=>({source:row.source,observedAt:row.observed_at,
    shape:describeJsonStructure(row.payload)}))
 });
}));
financialMonitoringRouter.post('/admin/football-information/map',safe(async(req,res)=>{
 const data=await setFootballInformationMapping({
  matchId:req.body?.matchId,aiscoreId:req.body?.aiscoreId,
  thesports01Id:req.body?.thesports01Id,actorId:req.user.id
 });
 res.set('Cache-Control','no-store').json({mapping:data,
  note:'Lidhja e burimeve është manuale dhe e paverifikuar për pagesat.'});
}));
financialMonitoringRouter.post('/admin/football-information/probe',safe(async(req,res)=>{
 const id=Number(req.body?.matchId);
 if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({message:'ID e ndeshjes është e pavlefshme.'});
 const report=await inspectFootballInformation(id);
 res.set('Cache-Control','no-store').json(report);
}));
