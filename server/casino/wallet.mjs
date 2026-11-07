import {managerCasinoSettings,saveManagerCasinoSettings} from './manager-settings.mjs';
import express from 'express';
import { pool, query } from '../db.mjs';
import { requireAuth } from '../ledger/auth.mjs';
import { isLedgerReady } from '../ledger/store.mjs';
import {publicGameProfiles,validateGameProfile} from './game-rtp-profiles.mjs';
import {validateControls,customGameSummary,supportsCustomCasinoMath,CUSTOM_CONTROL_LIMITS} from './custom-math.mjs';
import {casinoControls,casinoMathVersion} from './casino-controls.mjs';

// Sizzling uses the same authenticated PostgreSQL balance as sports betting.
// The admin may suspend wagering at any time; math remains uncertified.
const fault = (status, message) => Object.assign(new Error(message), { status });
const safe = handler => (req, res) => Promise.resolve(handler(req, res)).catch(error => {
  if (!error.status || error.status >= 500) console.error('[casino wallet]', error);
  return res.status(error.status || 500).json({ message: error.status ? error.message : 'Casino service unavailable' });
});
const isAdmin = (req, res, next) => req.user.role === 'ADMIN'
  ? next() : res.status(403).json({ message: 'Administrator only' });
export async function getCasinoSettings(executor = query, managerId=null) {
  if(managerId&&!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(String(managerId)))throw fault(400,'Menaxher i pavlefshëm.');
  try {
    await executor('alter table app_casino_settings add column if not exists hidden_games jsonb not null default \'[]\'');
  } catch {}
  const { rows } = await executor('select enabled, profile, game_profiles, game_controls, coalesce(hidden_games, \'[]\'::jsonb) as hidden_games from app_casino_settings where id = 1');
  const setting = await managerCasinoSettings(executor, rows[0] || { enabled: false, profile: 'SIZZLING_STANDARD_V1' }, managerId);
  const hiddenGames = Array.isArray(rows[0]?.hidden_games) ? rows[0].hidden_games : [];
  const globalCommission=Number((await executor('select casino_pct from app_commission_config where id=1')).rows[0]?.casino_pct??0);
  const games=publicGameProfiles(setting.game_profiles).map(game=>{
    const controls=casinoControls(setting.game_controls,game.gameId);
    const supportsCustomMath=supportsCustomCasinoMath(game.gameId);
    let summary={version:null,customLimits:null,controlLimits:CUSTOM_CONTROL_LIMITS,maxPayoutMultiplier:null},configurationError;
    if(supportsCustomMath){try{summary=customGameSummary(game.gameId,{controls});}catch(error){try{summary=customGameSummary(game.gameId);configurationError=error.message;}catch{configurationError=error.message;}}}
    let mathVersion=null;try{mathVersion=casinoMathVersion(game.gameId,setting);}catch{}
    const hidden = hiddenGames.includes(game.gameId);
    return {...game,supportsCustomMath,configurationError:configurationError??(controls.mode==='custom'?null:game.configurationError),controls,customLimits:summary.customLimits,controlLimits:summary.controlLimits,
      effectiveRtp:controls.mode==='custom'?controls.rtp:game.theoreticalRtp,
      effectiveHitFrequency:controls.mode==='custom'?controls.hitFrequency:null,
      mathVersion,customVersion:summary.version,maxPayoutMultiplier:summary.maxPayoutMultiplier,
      hidden};
  }),sizzling=games.find(game=>game.gameId==='sizzling');
  return {
    managerId, casinoCommission:Number(setting.casinoCommission??globalCommission),
    enabled: Boolean(setting.enabled),
    stakeLimits:{min:20,max:5000,currency:'ALL'},
    deploymentEnabled: true,
    realMoneyAvailable: true,
    profile:sizzling.profile,profiles:sizzling.profiles,games,
    hiddenGames,
    mathApproved:false,certified:false,theoreticalRtp:sizzling.theoreticalRtp,
    legacyProfileIgnored:setting.profile!=='SIZZLING_STANDARD_V1',
    warning: setting.profile!=='SIZZLING_STANDARD_V1'?'Konfigurimi i vjetër me përqindje nuk kontrollonte të gjitha lojërat. Aktiv janë vetëm profilet për lojë të shfaqura më poshtë.':null,
  };
}

export function createCasinoWalletRouter({database=pool,runQuery=query,auth=requireAuth,ready=isLedgerReady}={}){
const casinoWalletRouter=express.Router();
const access=[auth,(_req,res,next)=>ready()?next():res.status(503).json({message:'Ledger database unavailable'})];

casinoWalletRouter.get('/casino/status', ...access, safe(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...await getCasinoSettings(runQuery,req.user.managerId??req.user.manager_id??req.user.agentId??req.user.agent_id??null), balance: req.user.balance });
}));

// Game-specific protocol routes own wagering; these endpoints manage global settings.

casinoWalletRouter.get('/admin/casino/settings', ...access, isAdmin, safe(async (req,res) => res.json(await getCasinoSettings(runQuery,req.query.managerId||null))));
casinoWalletRouter.patch('/admin/casino/settings', ...access, isAdmin, safe(async(req,res)=>{
  if(typeof req.body?.enabled !== 'boolean') throw fault(400, 'enabled must be boolean');
  const client=await database.connect();
  try {
    await client.query('begin');
    const update=await client.query('update app_casino_settings set enabled=$1,updated_by=$2,updated_at=now() where id=1 returning enabled,profile',[req.body.enabled,req.user.id]);
    await client.query(
      "insert into app_admin_audit (actor_id,actor_name,actor_role,action,target_type,target_id,details) values ($1,$2,$3,'PATCH /admin/casino/settings','casino','sizzling',$4::jsonb)",
      [req.user.id,req.user.username,req.user.role,JSON.stringify({enabled:req.body.enabled,profile:update.rows[0].profile})]);
    await client.query('commit');
    res.json(await getCasinoSettings(client.query.bind(client)));
  } catch(error) { await client.query('rollback').catch(()=>{});throw error; }
  finally {client.release();}
}));


// Switch only between published, immutable profiles; no per-player RTP.
// Active rounds hold FOR SHARE; this update takes an exclusive row lock.
casinoWalletRouter.patch('/admin/casino/profile', ...access, isAdmin, safe(async(req,res)=>{
  if(req.body?.managerId){await saveManagerCasinoSettings(req.body,req.user,database);return res.json(await getCasinoSettings(runQuery,req.body.managerId));}
  if(!req.body||Object.keys(req.body).some(key=>!['gameId','profile'].includes(key)))throw fault(400,'Select a supported global game profile');
  const profile=String(req.body?.profile||''),gameId=String(req.body?.gameId||'');
  validateGameProfile(gameId,profile);
  const client=await database.connect();
  try {
    await client.query('begin');
    const settings=await client.query('select game_profiles from app_casino_settings where id=1 for update');
    if(!settings.rows.length)throw fault(503,'Casino settings unavailable');
    const previous=settings.rows[0].game_profiles?.[gameId]??null;
    const next={...settings.rows[0].game_profiles,[gameId]:profile};
    await client.query('update app_casino_settings set game_profiles=$1::jsonb,updated_by=$2,updated_at=now() where id=1',
      [JSON.stringify(next),req.user.id]);
    await client.query(
      "insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,$3,'PATCH /admin/casino/profile','casino',$4,$5::jsonb)",
      [req.user.id,req.user.username,req.user.role,gameId,JSON.stringify({from:previous,to:profile,scope:'all players; future paid rounds only'})]);
    await client.query('commit');
    res.json(await getCasinoSettings(client.query.bind(client)));
  } catch(error){await client.query('rollback').catch(()=>{});throw error;}
  finally {client.release();}
}));

casinoWalletRouter.patch('/admin/casino/controls',...access,isAdmin,safe(async(req,res)=>{
  if(req.body?.managerId){await saveManagerCasinoSettings(req.body,req.user,database);return res.json(await getCasinoSettings(runQuery,req.body.managerId));}
  if(!req.body||Object.keys(req.body).some(key=>!['gameId','mode','rtp','hitFrequency'].includes(key)))throw fault(400,'Select global game controls');
  const gameId=String(req.body.gameId||'');
  const controls=validateControls(gameId,{mode:req.body.mode,rtp:req.body.rtp,hitFrequency:req.body.hitFrequency});
  const client=await database.connect();
  try{
    await client.query('begin');
    const locked=await client.query('select game_controls from app_casino_settings where id=1 for update');
    if(!locked.rows.length)throw fault(503,'Casino settings unavailable');
    const previous=casinoControls(locked.rows[0].game_controls,gameId);
    const updated={...locked.rows[0].game_controls,[gameId]:controls};
    await client.query('update app_casino_settings set game_controls=$1::jsonb,updated_by=$2,updated_at=now() where id=1',[JSON.stringify(updated),req.user.id]);
    await client.query("insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,$3,'PATCH /admin/casino/controls','casino',$4,$5::jsonb)",
      [req.user.id,req.user.username,req.user.role,gameId,JSON.stringify({from:previous,to:controls,scope:'all players; future paid rounds only'})]);
    await client.query('commit');
    res.json(await getCasinoSettings(client.query.bind(client)));
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}
  finally{client.release();}
}));
casinoWalletRouter.get('/casino/config', safe(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await runQuery('alter table app_casino_settings add column if not exists hidden_games jsonb not null default \'[]\'');
  } catch {}
  const { rows } = await runQuery('select enabled, coalesce(hidden_games, \'[]\'::jsonb) as hidden_games from app_casino_settings where id = 1');
  const row = rows[0] || { enabled: true, hidden_games: [] };
  res.json({
    enabled: Boolean(row.enabled),
    hiddenGames: Array.isArray(row.hidden_games) ? row.hidden_games : [],
  });
}));

casinoWalletRouter.patch('/admin/casino/toggle-game', ...access, isAdmin, safe(async (req, res) => {
  const gameId = String(req.body?.gameId || '').trim();
  if (!gameId) throw fault(400, 'gameId kërkohet.');
  const client = await database.connect();
  try {
    await client.query('begin');
    await client.query('alter table app_casino_settings add column if not exists hidden_games jsonb not null default \'[]\'');
    const settings = await client.query('select hidden_games from app_casino_settings where id=1 for update');
    if (!settings.rows.length) throw fault(503, 'Cilësimet e kazinosë nuk u gjetën.');
    const current = Array.isArray(settings.rows[0].hidden_games) ? settings.rows[0].hidden_games : [];
    let next;
    if (typeof req.body.hidden === 'boolean') {
      if (req.body.hidden) {
        next = [...new Set([...current, gameId])];
      } else {
        next = current.filter(id => id !== gameId);
      }
    } else {
      next = current.includes(gameId) ? current.filter(id => id !== gameId) : [...current, gameId];
    }
    await client.query('update app_casino_settings set hidden_games=$1::jsonb,updated_by=$2,updated_at=now() where id=1', [JSON.stringify(next), req.user.id]);
    await client.query(
      "insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,$3,'PATCH /admin/casino/toggle-game','casino',$4,$5::jsonb)",
      [req.user.id, req.user.username, req.user.role, gameId, JSON.stringify({ gameId, hidden: next.includes(gameId) })]
    );
    await client.query('commit');
    res.json(await getCasinoSettings(client.query.bind(client)));
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

casinoWalletRouter.get('/admin/casino/managers',...access,isAdmin,safe(async(_req,res)=>res.json((await runQuery("select id,username,role from app_user where role in ('MANAGER','AGENT') and status='ACTIVE' and deleted_at is null order by username,id")).rows)));
casinoWalletRouter.patch('/admin/casino/commission',...access,isAdmin,safe(async(req,res)=>{await saveManagerCasinoSettings(req.body,req.user,database);res.json(await getCasinoSettings(runQuery,req.body.managerId||null));}));
return casinoWalletRouter;
}
export const casinoWalletRouter=createCasinoWalletRouter();
