/**
 * Durable and auditable live risk settings. All actual wallet debits take the
 * same singleton row lock, serializing match-exposure checks across users.
 */
import { pool } from '../db.mjs';
import {
  DEFAULT_LIVE_RISK_SETTINGS, liveRiskSettings,
  validateLiveRiskSettings, setLiveRiskSettings,
} from '../live-risk-settings.mjs';

export async function refreshLiveRiskSettings({ initialize = false, database = pool } = {}) {
  if (initialize) {
    await database.query(
      `insert into app_live_risk_settings (id,settings)
       values (1,$1::jsonb) on conflict (id) do nothing`,
      [JSON.stringify(DEFAULT_LIVE_RISK_SETTINGS)],
    );
  }
  const { rows } = await database.query('select settings from app_live_risk_settings where id=1');
  if (!rows.length) throw new Error('Live risk settings are not initialized.');
  const settings = validateLiveRiskSettings(rows[0].settings);
  if (JSON.stringify(liveRiskSettings()) !== JSON.stringify(settings)) setLiveRiskSettings(settings);
  return settings;
}

export async function lockLiveRiskSettings(client) {
  const { rows } = await client.query(
    'select settings from app_live_risk_settings where id=1 for update',
  );
  if (!rows.length) throw new Error('Live risk settings unavailable.');
  return validateLiveRiskSettings(rows[0].settings);
}

export async function writeLiveRiskSettings(value, actor, { database = pool, comboOnly = false } = {}) {
  const candidate = validateLiveRiskSettings(value);
  const client = await database.connect();
  try {
    await client.query('begin');
    const persisted = await lockLiveRiskSettings(client);
    // A previously opened admin screen may omit the new switch. Preserve the
    // locked value so saving unrelated rules cannot accidentally enable combos.
    const settings = comboOnly ? {...persisted,combosEnabled:candidate.combosEnabled} : {
      ...candidate,
      combosEnabled: value.combosEnabled === undefined
        ? persisted.combosEnabled : candidate.combosEnabled,
    };
    const { rows } = await client.query(
      `update app_live_risk_settings
         set settings=$1::jsonb, updated_by=$2, updated_at=now()
         where id=1 returning updated_at as "updatedAt"`,
      [JSON.stringify(settings),actor.id],
    );
    if (!rows.length) throw new Error('Live risk settings row missing.');
    if(comboOnly)await client.query('update app_bet_builder_template set active=$1,updated_at=now() where active is distinct from $1',[settings.combosEnabled]);
    await client.query(
      `insert into app_admin_audit
         (actor_id,actor_name,actor_role,action,target_type,target_id,details)
       values ($1,$2,$3,'UPDATE LIVE_RISK','settings','live-risk',$4::jsonb)`,
      [actor.id,actor.username,actor.role,JSON.stringify({ settings })],
    );
    await client.query('commit');
    setLiveRiskSettings(settings);
    return { settings, updatedAt: rows[0].updatedAt };
  } catch(e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }
}

export function setAllCombosEnabled(enabled,actor,options={}) {
  if(typeof enabled!=='boolean')throw Object.assign(new Error('enabled must be boolean'),{status:400});
  return writeLiveRiskSettings({...DEFAULT_LIVE_RISK_SETTINGS,combosEnabled:enabled},actor,{...options,comboOnly:true});
}
