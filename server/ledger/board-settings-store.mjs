import {matchOverride} from './overrides.mjs';
import {pool} from '../db.mjs';
import {getMatches} from '../matches.mjs';
import {boardSettings,setBoardSettings,validateBoardSettings,selectPublishedMatches} from '../board-settings.mjs';
export async function refreshBoardSettings({database=pool}={}){const r=await database.query('select settings,updated_at from app_board_settings where id=1');if(!r.rows.length)throw Error('Board settings are not initialized');setBoardSettings(r.rows[0].settings);return {settings:boardSettings(),updatedAt:r.rows[0].updated_at};}
// Settings are loaded on boot, after each save and by the server refresh timer.
// Public board reads must not depend on a responsive ledger database.
export async function publishedBoard(){return selectPublishedMatches((await getMatches({catalog:true})).filter(row=>!matchOverride(row.match_id)?.hidden));}
export function filterPublishedRows(rows,{service,league,tournamentId,sportId,q}={}){const needle=String(q??'').toLowerCase();return rows.filter(r=>(!service||String(r.service).toUpperCase()===String(service).toUpperCase())&&(!league||String(r.category_slug)===String(league))&&(tournamentId==null||String(r.tournament_id)===String(tournamentId))&&(sportId==null||String(r.sport_id)===String(sportId))&&(!needle||`${r.home} ${r.away} ${r.category_name} ${r.tournament_name}`.toLowerCase().includes(needle)));}
export async function saveBoardSettings(value,actor,{database=pool}={}){
 const candidate=validateBoardSettings(value),c=await database.connect();
 try{await c.query('begin');const active=(await c.query('select role,status,deleted_at from app_user where id=$1 for share',[actor.id])).rows[0];if(active?.role!=='ADMIN'||active.status!=='ACTIVE'||active.deleted_at)throw Object.assign(new Error('Vetëm administratori aktiv mund ta ndryshojë listën.'),{status:403});
 await c.query('select id from app_board_settings where id=1 for update');
 const result=await c.query('update app_board_settings set settings=$1::jsonb,updated_by=$2,updated_at=now() where id=1 returning updated_at',[JSON.stringify(candidate),actor.id]);if(!result.rows.length)throw Error('Missing board settings');
 await c.query(`insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details) values($1,$2,'ADMIN','UPDATE BOARD_SETTINGS','settings','board',$3::jsonb)`,[actor.id,actor.username,JSON.stringify(candidate)]);
 await c.query('commit');setBoardSettings(candidate);return {settings:candidate,updatedAt:result.rows[0].updated_at};
 }catch(e){await c.query('rollback').catch(()=>{});throw e;}finally{c.release();}
}
