/** Manager overrides inherit global math; player identity never selects RNG outcomes. */
import {validateControls} from './custom-math.mjs';
import {validateGameProfile} from './game-rtp-profiles.mjs';
export const MANAGER_CASINO_SQL=`
create table if not exists app_manager_casino_settings(
 manager_id uuid primary key references app_user(id) on delete restrict,
 game_profiles jsonb not null default '{}'::jsonb,
 game_controls jsonb not null default '{}'::jsonb,
 commission_pct numeric(5,2) check(commission_pct>=0 and commission_pct<=100),
 updated_by uuid references app_user(id),updated_at timestamptz not null default now());
`;
export async function managerCasinoSettings(execute,global,managerId,{lock=false,agentId=null}={}){
 if(!managerId&&!agentId)return global;
 const owner=managerId?(await execute('select role,agent_id from app_user where id=$1',[managerId])).rows[0]:null;
 const agent=owner?.role==='AGENT'?managerId:owner?.agent_id??agentId;
 const scopes=[...(managerId&&owner?.role!=='AGENT'?[managerId]:[]),...(agent?[agent]:[])];
 let result=global;
 // Agent is merged last: its explicit per-game values override every descendant.
 for(const id of [...new Set(scopes)]){
  const row=(await execute('select game_profiles,game_controls,commission_pct from app_manager_casino_settings where manager_id=$1'+(lock?' for share':''),[id])).rows[0];
  if(row)result={...result,game_profiles:{...result?.game_profiles,...row.game_profiles},game_controls:{...result?.game_controls,...row.game_controls},managerId,agentId:agent,casinoCommission:row.commission_pct==null?result?.casinoCommission:Number(row.commission_pct)};
 }
 return result;
}
export async function saveManagerCasinoSettings(body,actor,database){
 const fail=(status,message)=>Object.assign(new Error(message),{status});
 const managerId=body?.managerId||null;
 if(managerId&&!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(managerId))throw fail(400,'Identifikues menaxheri i pavlefshëm.');
 if(!body||Object.keys(body).some(key=>!['managerId','gameId','profile','mode','rtp','hitFrequency','commission'].includes(key)))throw fail(400,'Cilësime të pavlefshme.');
 const commission=body.commission;
 if(commission!==undefined&&(typeof commission!=='number'||!Number.isFinite(commission)||commission<0||commission>100||Math.abs(commission*100-Math.round(commission*100))>1e-7))throw fail(400,'Komisioni duhet të jetë 0–100%, me deri dy shifra pas presjes.');
 let controls,profile;
 if(body.gameId){if(body.profile!==undefined)profile=validateGameProfile(body.gameId,body.profile).id;else controls=validateControls(body.gameId,{mode:body.mode,rtp:body.rtp,hitFrequency:body.hitFrequency});}
 if(commission===undefined&&!controls&&!profile)throw fail(400,'Zgjidh një ndryshim.');
 if(!managerId&&(controls||profile))throw fail(400,'Zgjidh menaxherin.');
 const db=await database.connect();
 try{
  await db.query('begin');
  const owner=(await db.query('select role,status,deleted_at from app_user where id=$1 for share',[actor.id])).rows[0];
  if(owner?.role!=='ADMIN'||owner.status!=='ACTIVE'||owner.deleted_at)throw fail(403,'Vetëm administratori aktiv.');
  if(managerId){
   const manager=(await db.query('select role,status,deleted_at from app_user where id=$1 for update',[managerId])).rows[0];
   if(!['MANAGER','AGENT'].includes(manager?.role)||manager.status!=='ACTIVE'||manager.deleted_at)throw fail(404,'Menaxheri ose agjenti nuk është aktiv.');
   await db.query('insert into app_manager_casino_settings(manager_id)values($1)on conflict do nothing',[managerId]);
   if(commission!==undefined)await db.query('update app_manager_casino_settings set commission_pct=$2,updated_by=$3,updated_at=now() where manager_id=$1',[managerId,commission,actor.id]);
   if(profile)await db.query('update app_manager_casino_settings set game_profiles=game_profiles||$2::jsonb,game_controls=game_controls||$4::jsonb,updated_by=$3,updated_at=now()where manager_id=$1',[managerId,JSON.stringify({[body.gameId]:profile}),actor.id,JSON.stringify({[body.gameId]:{mode:'original',rtp:95,hitFrequency:10}})]);
   if(controls)await db.query('update app_manager_casino_settings set game_controls=game_controls||$2::jsonb,updated_by=$3,updated_at=now()where manager_id=$1',[managerId,JSON.stringify({[body.gameId]:controls}),actor.id]);
  }else await db.query('update app_commission_config set casino_pct=$1,updated_by=$2,updated_at=now()where id=1',[commission,actor.id]);
  await db.query("insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details)values($1,$2,'ADMIN','CASINO_MANAGER_SETTINGS','casino',$3,$4::jsonb)",[actor.id,actor.username,managerId||'global',JSON.stringify({gameId:body.gameId,commission,controls,profile,scope:managerId||'global',futurePaidRoundsOnly:true})]);
  await db.query('commit');
 }catch(error){await db.query('rollback').catch(()=>{});throw error;}finally{db.release();}
}
