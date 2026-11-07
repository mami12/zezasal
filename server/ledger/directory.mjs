/** Shared ADMIN/AGENT account directory. Every scope is established on the server. */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../db.mjs';
import { requireAuth, hashPassword } from './auth.mjs';
import {assertAccountPassword} from './account-password-policy.mjs';
import * as ledger from './store.mjs';
import { getManagerCommissionRates, managerCommissionReport } from './manager-finance.mjs';

export const directoryRouter=express.Router();
const fail=(status,message)=>Object.assign(new Error(message),{status});
const money=x=>Number(Number(x||0).toFixed(2));
const uuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x));
const checkedId=x=>{if(!uuid(x))throw fail(400,'ID e pavlefshme.');return String(x);};
const roles=['ADMIN','AGENT','MANAGER','PLAYER'];
const guard=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');res.json(await fn(req));}catch(e){if(!e.status&&e.code!=='23505'||e.status>=500)console.error('[directory]',e.message);res.status(e.status||(e.code==='23505'?409:500)).json({message:e.code==='23505'?'Ky emër përdoruesi është në përdorim.':e.status?e.message:'Veprimi nuk u krye. Provo përsëri.'});}};
const access=(role)=>[requireAuth,(req,res,next)=>!ledger.isLedgerReady()?res.status(503).json({message:'Databaza nuk është gati.'}):req.user.role!==role||req.user.status!=='ACTIVE'?res.status(403).json({message:'Nuk ke të drejtë për këtë veprim.'}):next()];
async function transaction(fn){const c=await pool.connect();try{await c.query('begin');const result=await fn(c);await c.query('commit');return result;}catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}}
async function audit(c,actor,action,id,input={}){await c.query(`insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,$3,$4,'user',$5,$6::jsonb)`,[actor.id,actor.username,actor.role,action,id,JSON.stringify(input)]);}
async function ownedManager(c,actor,id){const r=await c.query('select * from app_user where id=$1 for update',[checkedId(id)]);const row=r.rows[0];if(!row||row.deleted_at||row.role!=='MANAGER'||row.agent_id!==actor.id)throw fail(404,'Menaxheri nuk u gjet.');return row;}
const userView=row=>({id:row.id,username:row.username,role:row.role,status:row.status,balance:money(row.balance),currency:row.currency,managerId:row.manager_id,agentId:row.agent_id,createdAt:row.created_at,updatedAt:row.updated_at});

export async function directoryReport(actor){
  const scoped=actor.role==='AGENT';
  const {rows}=await query(`select u.* from app_user u where ($1::uuid is null or u.id=$1 or u.agent_id=$1 or u.manager_id in(select id from app_user where agent_id=$1 and role='MANAGER')) order by u.username,u.id`,[scoped?actor.id:null]);
  const visible=rows.filter(u=>!u.deleted_at);
  const ids=rows.map(u=>u.id);
  const rates=await getManagerCommissionRates(query);
  const commissions=await managerCommissionReport(query);
  const financial=await query(`select u.id,
    coalesce(s.turnover,0) as turnover,coalesce(s.settled,0) as settled,coalesce(s.pending,0) as pending,
    coalesce(s.exposure,0) as exposure,coalesce(s.payout,0) as payout,coalesce(s.cnt,0) as tickets,
    coalesce(s.pending_count,0) as pending_count,coalesce(c.stake,0) as casino_stake,coalesce(c.payout,0)+coalesce(g.gamble,0) as casino_payout,
    coalesce(c.pending,0) as casino_pending,coalesce(c.pending_stake,0) as casino_pending_stake,coalesce(c.turnover,0) as casino_turnover,coalesce(c.paid_all,0)+coalesce(g.gamble,0) as casino_paid,
    coalesce(k.commission,0) as commission,coalesce(d.deposits,0) as deposits,coalesce(d.withdrawals,0) as withdrawals
    from app_user u
    left join lateral(select sum(t.stake) filter(where t.status in('PENDING','WON','LOST')) as turnover,
      sum(t.stake) filter(where t.status in('WON','LOST')) as settled,
      sum(t.stake) filter(where t.status='PENDING') as pending,sum(t.potential_payout) filter(where t.status='PENDING') as exposure,
      sum(w.paid) filter(where t.status='WON') as payout,
      count(distinct coalesce('SYS-'||b.id::text,t.id::text)) as cnt,
      count(distinct coalesce('SYS-'||b.id::text,t.id::text)) filter(where t.status='PENDING') as pending_count
      from app_ticket t left join app_ticket_batch b on b.ticket_ids @> ARRAY[t.id] and b.user_id=t.user_id
      left join lateral(select sum(x.amount) as paid from app_transaction x where x.reference_id=t.id and x.user_id=t.user_id and x.type='BET_WON') w on true where t.user_id=u.id) s on true
    left join lateral(select sum(r.stake) filter(where r.payout<=coalesce(w.paid,0)) as stake,
      sum(w.paid) filter(where r.payout<=coalesce(w.paid,0)) as payout,
      sum(greatest(r.payout-coalesce(w.paid,0),0)) as pending,
      sum(r.stake) filter(where r.payout>coalesce(w.paid,0)) as pending_stake,
      sum(r.stake) as turnover,sum(w.paid) as paid_all
      from app_casino_round r left join lateral(select sum(amount) as paid from app_transaction where user_id=u.id and reference_id=r.id and type='CASINO_WIN') w on true
      where r.user_id=u.id) c on true
    left join lateral(select sum(amount) as gamble from app_transaction where user_id=u.id and type in('CASINO_GAMBLE_WIN','CASINO_GAMBLE_LOSS')) g on true
    left join lateral(select sum(-amount) as commission from app_transaction where (user_id=u.id or (u.role='PLAYER' and reference_id in(select id from app_ticket where user_id=u.id))) and type in('MANAGER_COMMISSION_DEBIT','MANAGER_COMMISSION_REFUND')) k on true
    left join lateral(select sum(amount) filter(where type='DEPOSIT') as deposits,-sum(amount) filter(where type='WITHDRAWAL') as withdrawals from app_transaction where user_id=u.id) d on true
    where u.id=any($1::uuid[])`,[ids]);
  const own=new Map(financial.rows.map(r=>[r.id,{turnover:money(r.turnover),settledStake:money(r.settled),pendingStake:money(r.pending),pendingExposure:money(r.exposure),payout:money(r.payout),tickets:Number(r.tickets),pendingTickets:Number(r.pending_count),casinoStake:money(r.casino_stake),casinoPayout:money(r.casino_payout),casinoPending:money(r.casino_pending),casinoPendingStake:money(r.casino_pending_stake),casinoTurnover:money(r.casino_turnover),casinoPaid:money(r.casino_paid),commission:money(r.commission),deposits:money(r.deposits),withdrawals:money(r.withdrawals)}]));
  for(const u of rows){const f=own.get(u.id);if(f)Object.assign(f,{commission:0,sportCommission:0,casinoCommission:0},(u.role==='MANAGER'?commissions.managers:commissions.players).get(u.id)||{});}
  const all=new Map(rows.map(u=>[u.id,u]));
  const descendant=(u,parent)=>u.id===parent.id||(parent.role==='MANAGER'&&u.manager_id===parent.id)||(parent.role==='AGENT'&&(u.agent_id===parent.id||all.get(u.manager_id)?.agent_id===parent.id));
  const aggregate=group=>{
    const stats={turnover:0,settledStake:0,pendingStake:0,pendingExposure:0,payout:0,tickets:0,pendingTickets:0,casinoStake:0,casinoPayout:0,casinoPending:0,casinoPendingStake:0,casinoTurnover:0,casinoPaid:0,commission:0,sportCommission:0,casinoCommission:0,deposits:0,withdrawals:0,playerBalance:0,managerBalance:0,players:0,managers:0};
    for(const u of group){const f=own.get(u.id)||{};if(u.role==='PLAYER'){for(const k of ['turnover','settledStake','pendingStake','pendingExposure','payout','tickets','pendingTickets','casinoStake','casinoPayout','casinoPending','casinoPendingStake','casinoTurnover','casinoPaid','deposits','withdrawals'])stats[k]+=f[k]||0;if(group.length===1)for(const k of ['commission','sportCommission','casinoCommission'])stats[k]+=f[k]||0;if(!u.deleted_at){stats.playerBalance+=Number(u.balance);stats.players++;}}if(u.role==='MANAGER'){for(const k of ['commission','sportCommission','casinoCommission'])stats[k]+=f[k]||0;if(!u.deleted_at){stats.managerBalance+=Number(u.balance);stats.managers++;}}}
    for(const k of Object.keys(stats))stats[k]=money(stats[k]);
    stats.sportGross=money(stats.settledStake-stats.payout);stats.casinoGross=money(stats.casinoStake-stats.casinoPayout);stats.houseGross=money(stats.sportGross+stats.casinoGross);stats.houseWithCommission=money(stats.houseGross-stats.commission);stats.houseAfterCommission=stats.houseWithCommission;stats.managerNet=money(stats.houseGross-stats.commission);
    return stats;
  };
  const users=visible.filter(u=>!scoped||u.id!==actor.id).map(u=>({...userView(u),manager:all.get(u.manager_id)?{id:u.manager_id,username:all.get(u.manager_id).username}:null,agent:all.get(u.agent_id)?{id:u.agent_id,username:all.get(u.agent_id).username}:null,financial:aggregate(rows.filter(p=>descendant(p,u))),ownFinancial:own.get(u.id),canManage:!scoped||u.role==='MANAGER'}));
  return {users,summary:aggregate(rows),commissionRates:rates,wallet:await ledger.getUserById(actor.id),asOf:new Date().toISOString(),commissionBasis:'REPORT_ONLY_ON_STAKE',incomeBasis:'SETTLED_STAKES_MINUS_POSTED_PAYOUTS',includesDeletedHistory:true};
}
export async function directoryDetail(actor,id){
  const report=await directoryReport(actor);const user=report.users.find(u=>u.id===checkedId(id));if(!user)throw fail(404,'Përdoruesi nuk u gjet.');
  const {rows:transactions}=await query(`select id,amount,type,balance_after as "balanceAfter",description,created_at as "createdAt" from app_transaction where user_id=$1 order by created_at desc,id desc limit 100`,[id]);
  const childIds=report.users.filter(u=>u.id===id||u.managerId===id||(user.role==='AGENT'&&(u.agentId===id||report.users.find(m=>m.id===u.managerId)?.agentId===id))).map(u=>u.id);
  const {rows:tickets}=await query(`select t.id,t.booking_code as "bookingCode",u.username,t.stake,t.status,t.potential_payout as "potentialPayout",t.placed_at as "placedAt" from app_ticket t join app_user u on u.id=t.user_id where t.user_id=any($1::uuid[]) order by t.placed_at desc,t.id desc limit 50`,[childIds]);
  return {user,commissionRates:report.commissionRates,children:report.users.filter(u=>u.managerId===id||u.agentId===id),transactions:transactions.map(t=>({...t,amount:money(t.amount),balanceAfter:money(t.balanceAfter)})),tickets:tickets.map(t=>({...t,stake:money(t.stake),potentialPayout:money(t.potentialPayout)})),historyLimit:100,ticketLimit:50};
}

export async function transferAgentFunds(actor,managerId,amount,direction,requestId){
  if(typeof amount!=='number'&&(typeof amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(amount)))throw fail(400,'Shumë e pavlefshme.');
  const value=Number(amount);if(!Number.isFinite(value)||value<=0||value>999999999999.99||money(value)!==value)throw fail(400,'Shuma duhet të jetë pozitive, me maksimumi 2 shifra pas presjes.');
  if(!['deposit','withdraw'].includes(direction))throw fail(400,'Veprim i pavlefshëm.');checkedId(requestId);
  return transaction(async c=>{
    const locked=await c.query('select * from app_user where id=any($1::uuid[]) order by id for update',[[actor.id,checkedId(managerId)]]);
    const agent=locked.rows.find(u=>u.id===actor.id),manager=locked.rows.find(u=>u.id===managerId);
    if(agent?.role!=='AGENT'||agent.status!=='ACTIVE'||agent.deleted_at||manager?.role!=='MANAGER'||manager.agent_id!==actor.id||manager.deleted_at)throw fail(403,'Nuk lejohet ky transferim.');
    const saved=await c.query('select payload,response from app_staff_transfer where actor_id=$1 and request_id=$2',[actor.id,requestId]);
    const payload=JSON.stringify({managerId,amount:value,direction});
    if(saved.rows.length){if(saved.rows[0].payload!==payload)throw fail(409,'Kërkesa është përdorur për një transferim tjetër.');return saved.rows[0].response;}
    const delta=direction==='deposit'?value:-value;
    const afterAgent=money(Number(agent.balance)-delta),afterManager=money(Number(manager.balance)+delta);
    if(afterAgent<0||afterManager<0)throw fail(400,'Bilanci nuk mjafton.');
    const ref=randomUUID();
    for(const [u,change,after,type] of [[agent,-delta,afterAgent,direction==='deposit'?'AGENT_MANAGER_FUNDING':'AGENT_MANAGER_RETURN'],[manager,delta,afterManager,direction==='deposit'?'DEPOSIT':'WITHDRAWAL']]){
      await c.query('update app_user set balance=$2,updated_at=now() where id=$1',[u.id,after]);
      await c.query(`insert into app_transaction(user_id,amount,type,reference_id,balance_after,description) values($1,$2,$3,$4,$5,$6)`,[u.id,change,type,ref,after,`Transferim agjent / menaxher: ${agent.username} → ${manager.username}`]);
    }
    await audit(c,actor,'TRANSFER AGENT_MANAGER',managerId,{amount:value,direction,requestId});
    const response={success:true,agentBalance:afterAgent,managerBalance:afterManager,referenceId:ref};
    await c.query('insert into app_staff_transfer(actor_id,request_id,payload,response) values($1,$2,$3,$4::jsonb)',[actor.id,requestId,payload,JSON.stringify(response)]);return response;
  });
}

export async function adjustAdminFunds(actor,userId,amount,direction,requestId){
  if(actor.role!=='ADMIN'||actor.status!=='ACTIVE')throw fail(403,'Vetëm administratori.');
  if(typeof amount!=='number'&&(typeof amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(amount)))throw fail(400,'Shumë e pavlefshme.');
  const value=Number(amount);if(!Number.isFinite(value)||value<=0||value>999999999999.99||money(value)!==value||!['deposit','withdraw'].includes(direction))throw fail(400,'Shumë ose veprim i pavlefshëm.');
  checkedId(requestId);checkedId(userId);
  return transaction(async c=>{
    const locked=await c.query('select * from app_user where id=any($1::uuid[]) order by id for update',[[actor.id,userId]]);
    const admin=locked.rows.find(u=>u.id===actor.id),target=locked.rows.find(u=>u.id===userId);
    if(admin?.role!=='ADMIN'||admin.status!=='ACTIVE'||admin.deleted_at)throw fail(403,'Vetëm administratori aktiv.');
    if(!target||target.deleted_at)throw fail(404,'Përdoruesi nuk u gjet.');
    const payload=JSON.stringify({userId,amount:value,direction,mode:'admin'});
    const saved=await c.query('select payload,response from app_staff_transfer where actor_id=$1 and request_id=$2',[actor.id,requestId]);
    if(saved.rows.length){if(saved.rows[0].payload!==payload)throw fail(409,'Kërkesa është përdorur për një veprim tjetër.');return saved.rows[0].response;}
    const delta=direction==='deposit'?value:-value,after=money(Number(target.balance)+delta),referenceId=randomUUID();if(after<0)throw fail(400,'Bilanci nuk mjafton.');
    await c.query('update app_user set balance=$2,updated_at=now() where id=$1',[userId,after]);
    await c.query(`insert into app_transaction(user_id,amount,type,reference_id,balance_after,description) values($1,$2,$3,$4,$5,$6)`,[userId,delta,direction==='deposit'?'DEPOSIT':'WITHDRAWAL',referenceId,after,'Veprim nga administratori']);
    await audit(c,actor,'ADJUST DIRECTORY_FUNDS',userId,{amount:value,direction,requestId});const response={success:true,balance:after,referenceId};
    await c.query('insert into app_staff_transfer(actor_id,request_id,payload,response) values($1,$2,$3,$4::jsonb)',[actor.id,requestId,payload,JSON.stringify(response)]);return response;
  });
}

export async function saveDirectoryUser(actor,id,input){
  if(Number(input.initialBalance||0)!==0)throw fail(400,'Krijo llogarinë me bilanc zero, pastaj përdor veprimin e fondeve.');
  return transaction(async c=>{
    const initial=id?(await c.query('select * from app_user where id=$1',[checkedId(id)])).rows[0]:null;
    const lockIds=[actor.id,id,input.managerId,input.agentId,initial?.manager_id,initial?.agent_id].filter(uuid);
    await c.query('select id from app_user where id=any($1::uuid[]) order by id for update',[lockIds]);
    const currentActor=(await c.query('select role,status,deleted_at from app_user where id=$1',[actor.id])).rows[0];
    if(!currentActor||currentActor.deleted_at||currentActor.status!=='ACTIVE'||currentActor.role!==actor.role||!['ADMIN','AGENT'].includes(currentActor.role))throw fail(403,'Nuk lejohet ky veprim.');
    const existing=id?(await c.query('select * from app_user where id=$1',[id])).rows[0]:null;
    if(id&&(!existing||existing.deleted_at))throw fail(404,'Përdoruesi nuk u gjet.');
    if(actor.role==='AGENT'){
      if(existing&&(existing.role!=='MANAGER'||existing.agent_id!==actor.id))throw fail(404,'Menaxheri nuk u gjet.');
      if(input.role&&input.role!=='MANAGER'||input.managerId||input.agentId&&input.agentId!==actor.id||Number(input.initialBalance||0)!==0)throw fail(403,'Agjenti krijon vetëm menaxherë të vet me bilanc fillestar zero. Përdor transferimin për fondet.');
    }
    const role=actor.role==='AGENT'?'MANAGER':String(input.role||existing?.role||'PLAYER');
    if(!roles.includes(role))throw fail(400,'Rol i pavlefshëm.');
    const username=String(input.username??existing?.username??'').trim();if(username.length<3||username.length>64)throw fail(400,'Emri duhet të ketë 3–64 karaktere.');
    const password=String(input.password||'');if(!id&&!password)throw fail(400,'Fjalëkalimi është i detyrueshëm.');if(password)assertAccountPassword(password,role);
    const status=String(input.status||existing?.status||'ACTIVE');if(!['ACTIVE','FROZEN','BANNED'].includes(status))throw fail(400,'Gjendje e pavlefshme.');
    if(id===actor.id&&(role!==actor.role||status!=='ACTIVE'))throw fail(400,'Nuk mund të heqësh të drejtat ose të bllokosh llogarinë tënde.');
    if(existing&&existing.role!==role){const children=await c.query('select 1 from app_user where (manager_id=$1 or agent_id=$1) and deleted_at is null limit 1',[id]);const history=await c.query('select exists(select 1 from app_ticket where user_id=$1) or exists(select 1 from app_transaction where user_id=$1) or exists(select 1 from app_casino_round where user_id=$1) or exists(select 1 from app_manager_commission where manager_id=$1 or player_id=$1) as present',[id]);if(children.rows.length||Number(existing.balance)!==0||history.rows[0].present)throw fail(409,'Llogaria ka bilanc, vartës ose histori. Krijo një llogari të re për rolin tjetër.');}
    const managerId=role==='PLAYER'?(input.managerId!==undefined?input.managerId:existing?.manager_id)||null:null;
    const agentId=role==='MANAGER'?(actor.role==='AGENT'?actor.id:(input.agentId!==undefined?input.agentId:existing?.agent_id)||null):null;
    for(const [parent,expected] of [[managerId,'MANAGER'],[agentId,'AGENT']])if(parent){const p=await c.query('select role,deleted_at,status from app_user where id=$1 for update',[checkedId(parent)]);if(p.rows[0]?.role!==expected||p.rows[0].deleted_at)throw fail(400,'Llogaria përgjegjëse nuk është e vlefshme.');}
    let userId=id;
    if(id)await c.query(`update app_user set username=$2,role=$3,status=$4,manager_id=$5,agent_id=$6,password_hash=coalesce($7,password_hash),updated_at=now() where id=$1`,[id,username,role,status,managerId,agentId,password?hashPassword(password):null]);
    else {const r=await c.query('insert into app_user(username,password_hash,role,status,manager_id,agent_id) values($1,$2,$3,$4,$5,$6) returning id',[username,hashPassword(password),role,status,managerId,agentId]);userId=r.rows[0].id;}
    await audit(c,actor,id?'UPDATE DIRECTORY_USER':'CREATE DIRECTORY_USER',userId,{username,role,status,managerId,agentId});
    const result=await c.query('select * from app_user where id=$1',[userId]);return userView(result.rows[0]);
  });
}

for(const [prefix,role] of [['admin','ADMIN'],['agent','AGENT']]){
  directoryRouter.get(`/${prefix}/directory`,...access(role),guard(req=>directoryReport(req.user)));
  directoryRouter.get(`/${prefix}/directory/:id`,...access(role),guard(req=>directoryDetail(req.user,req.params.id)));
  directoryRouter.post(`/${prefix}/directory`,...access(role),guard(req=>saveDirectoryUser(req.user,null,req.body||{})));
  directoryRouter.patch(`/${prefix}/directory/:id`,...access(role),guard(req=>saveDirectoryUser(req.user,req.params.id,req.body||{})));
}
directoryRouter.post('/agent/users/:id/:direction',...access('AGENT'),guard(req=>transferAgentFunds(req.user,req.params.id,req.body?.amount,req.params.direction,req.body?.requestId)));
directoryRouter.post('/admin/directory/:id/funds',...access('ADMIN'),guard(req=>adjustAdminFunds(req.user,req.params.id,req.body?.amount,req.body?.direction,req.body?.requestId)));
