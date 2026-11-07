/** Destructive operation is exposed only to an active authenticated ADMIN. */
import express from 'express';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,open,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool} from '../db.mjs';
import {requireAuth,signToken,verifyPassword} from './auth.mjs';
import {isLedgerReady,publicUser} from './store.mjs';
import {outsideDatabaseRequest} from '../database-request-context.mjs';
import {localDatabaseDirectory} from '../database-location.mjs';

export const FINANCIAL_RESET_TABLES=Object.freeze([
 'app_manager_commission','app_ticket_line','app_ticket_batch','app_ticket','app_bet_rejection','app_transaction','app_staff_transfer',
 'app_casino_gamble_event','app_casino_gamble_state','app_casino_freespin_state',
 'app_casino_original_event','app_casino_original_state','app_casino_round','app_admin_audit',
 'app_manual_review_notice','app_settlement_override','app_live_settlement_preview',
]);
const defaultBackupDir=fileURLToPath(new URL('../../backups/',import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const attempts=new Map();
function verifyInput(actor,{code,confirmation,requestId}={}){
 if(actor?.role!=='ADMIN'||actor.status!=='ACTIVE')throw fail(403,'Vetëm administratori aktiv mund të kryejë zerimin.');
 const at=Date.now(),previous=attempts.get(actor.id);
 if(previous&&previous.until>at&&previous.count>=5)throw fail(429,'Shumë kode të pasakta. Provo përsëri pas 5 minutash.');
 const hash=value=>createHash('sha256').update(String(value??'')).digest();
 let codeValid=false;
 try{
  if(timingSafeEqual(hash(code),hash(process.env.FINANCIAL_RESET_CODE||'1122'))) codeValid=true;
 }catch{}
 if(!codeValid&&actor?.password_hash){
  try{
   if(verifyPassword(String(code??''),actor.password_hash)) codeValid=true;
  }catch{}
 }
 if(!codeValid){
  attempts.set(actor.id,{count:previous?.until>at?previous.count+1:1,until:at+300000});
  if(attempts.size>1000)for(const [id,entry] of attempts)if(entry.until<at)attempts.delete(id);
  throw fail(403,'Kodi i zerimit nuk është i saktë.');
 }
 if(confirmation!=='RESET')throw fail(400,'Shkruaj RESET për të konfirmuar fshirjen.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(requestId)))throw fail(400,'Kërkesë zerimi e pavlefshme.');
 attempts.delete(actor.id);
}
export async function previewFinancialReset({database=pool}={}){
 const counts={};
 for(const table of FINANCIAL_RESET_TABLES){
  try{
   const r=await database.query(`select count(*)::int as n from "${table}"`);
   counts[table]=Number(r.rows[0]?.n??0);
  }catch{
   counts[table]=0;
  }
 }
 const {rows}=await database.query(`select count(*)::int as accounts,coalesce(sum(balance),0) as balance,count(*) filter(where balance<>0)::int as nonzero from app_user`);
 return {counts,accounts:Number(rows[0].accounts),totalBalance:Number(rows[0].balance),accountsWithBalance:Number(rows[0].nonzero),preserves:['accounts','passwords','roles','ownership','settings','player-controls','provider-results'],requiresLogin:true};
}
async function saveBackup({client,resetId,backupDir}){
 const directory=localDatabaseDirectory(resolve(backupDir));await mkdir(directory,{recursive:true,mode:0o700});
 const filename=`before-financial-reset-${new Date().toISOString().replace(/[:.]/g,'-')}-${resetId}.tgz`;
 const target=join(directory,filename),temporary=target+'.partial',blob=await client.backup('gzip');
 const bytes=Buffer.from(await blob.arrayBuffer());if(bytes.length<1)throw Error('Empty backup');
 const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
 await rename(temporary,target);return {backupFile:target};
}
export async function executeFinancialReset(actor,input,{database=pool,backup=saveBackup,backupDir=defaultBackupDir,onReset=async()=>{}}={}){
 verifyInput(actor,input);
 if(typeof database.exclusive!=='function')throw fail(503,'Zerimi me backup mbështetet vetëm me databazën lokale.');
 let committed=false;
 const response=await database.exclusive(async client=>{
  const current=(await client.query('select role,status,deleted_at,financial_epoch from app_user where id=$1',[actor.id])).rows[0];
  if(current?.role!=='ADMIN'||current.status!=='ACTIVE'||current.deleted_at)throw fail(403,'Vetëm administratori aktiv mund të kryejë zerimin.');
  const old=await client.query('select actor_id,response from app_financial_reset where request_id=$1',[input.requestId]);
  if(old.rows.length){if(old.rows[0].actor_id!==actor.id)throw fail(409,'Kërkesa është përdorur më parë.');return old.rows[0].response;}
  if(Number(current.financial_epoch)!==Number(actor.financialEpoch??0))throw fail(401,'Sesioni përfundoi. Identifikohu përsëri.');
  const preview=await previewFinancialReset({database:client}),resetId=randomUUID();
  let saved;try{saved=await (backup||saveBackup)({client,resetId,backupDir});if(!saved?.backupFile)throw Error('No verified backup path');}catch(error){console.error('[financial reset] backup failed; no history deleted');throw fail(503,'Backup-i nuk u ruajt. Zerimi nuk u krye.');}
  const result={resetId,requestId:input.requestId,counts:preview.counts,accounts:preview.accounts,previousTotalBalance:preview.totalBalance,backupFile:saved.backupFile,requiresLogin:true};
  await client.query('begin');
  try{
   const existingTablesRes = await client.query(
    'select tablename from pg_tables where schemaname = $1 and tablename = any($2)',
    ['public', FINANCIAL_RESET_TABLES]
   );
   const toTruncate = existingTablesRes.rows.map(r => `"${r.tablename}"`);
   if (toTruncate.length) {
    await client.query(`truncate table ${toTruncate.join(',')} restart identity cascade`);
   }
   await client.query('update app_user set balance=0,financial_epoch=financial_epoch+1,updated_at=now()');
   await client.query(`insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,'ADMIN','FINANCIAL_RESET','system',$3,$4::jsonb)`,[actor.id,actor.username,resetId,JSON.stringify({counts:preview.counts,backupFile:saved.backupFile,accounts:preview.accounts})]);
   await client.query('insert into app_financial_reset(request_id,actor_id,response) values($1,$2,$3::jsonb)',[input.requestId,actor.id,JSON.stringify(result)]);
   await client.query('commit');committed=true;client.invalidateGeneration();
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}
  return result;
 });
 if(committed){try{await outsideDatabaseRequest(()=>onReset(response));}catch(error){console.error('[financial reset] committed; refresh notification failed');}}
 // Renew only the administrator who completed/retrieved this authenticated request.
 // The permanent idempotency receipt never contains a reusable login token.
 const current=await outsideDatabaseRequest(()=>database.query('select * from app_user where id=$1 and deleted_at is null',[actor.id]));
 const user=publicUser(current.rows[0]);
 return user?.role==='ADMIN'&&user.status==='ACTIVE'?{...response,token:signToken(user),user}:response;
}
export function createFinancialResetRouter(options={}){
 const router=express.Router();
 const access=[requireAuth,(req,res,next)=>!isLedgerReady()?res.status(503).json({message:'Databaza nuk është gati.'}):req.user.role!=='ADMIN'||req.user.status!=='ACTIVE'?res.status(403).json({message:'Vetëm administratori aktiv.'}):next()];
 const safe=fn=>async(req,res)=>{try{res.set('Cache-Control','no-store');res.json(await fn(req));}catch(error){console.error('[financial reset] operation error:', error);res.status(error.status||500).json({message:error.message||'Zerimi nuk u krye. Të dhënat e mëparshme u ruajtën.'});}};
 router.get('/admin/financial-reset/preview',...access,safe(()=>previewFinancialReset({database:options.database||pool})));
 router.post('/admin/financial-reset',...access,safe(req=>executeFinancialReset(req.user,req.body,options)));
 return router;
}
