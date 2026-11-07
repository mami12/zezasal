import { pool } from '../db.mjs';

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Remove access immediately; retain the original ledger until monthly cleanup.
 * Only the balance available under the account lock moves, exactly once.
 * Existing pending tickets keep their owner and their original manager.
 */
export async function removePlayer(id, actor, { database = pool } = {}) {
  if (!actor?.id || id === actor.id) throw fail(400, 'Nuk mund të fshish llogarinë tënde.');
  const client = await database.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      'select id,username,role,status,balance,manager_id,deleted_at,deleted_by from app_user where id=any($1::uuid[]) order by id for update nowait',
      [[id, actor.id]],
    );
    const owner = rows.find(row => row.id === actor.id), player = rows.find(row => row.id === id);
    if (!owner || owner.role !== 'ADMIN' || owner.status !== 'ACTIVE' || owner.deleted_at) throw fail(403, 'Ky veprim lejohet vetëm për administratorin aktiv.');
    if (!player) throw fail(404, 'Lojtari nuk u gjet.');
    if (owner.role === 'MANAGER' && (player.role !== 'PLAYER' || player.manager_id !== owner.id)) throw fail(403, 'Lojtari nuk i përket këtij menaxheri.');
    if (player.deleted_at) {
      if (player.deleted_by !== owner.id) throw fail(404, 'Lojtari nuk u gjet.');
      await client.query('commit');
      return { id, transferred: 0, alreadyDeleted: true };
    }
    // Arithmetic stays in NUMERIC(14,2), avoiding binary floating-point money.
    const amount = String(player.balance);
    const credited = await client.query('update app_user set balance=balance+$2::numeric,updated_at=now() where id=$1 returning balance', [owner.id, amount]);
    await client.query("update app_user set balance=0,status='BANNED',deleted_at=now(),deleted_by=$2,updated_at=now() where id=$1", [id, owner.id]);
    if (Number(amount) !== 0) {
      await client.query(`insert into app_transaction(user_id,amount,type,reference_id,balance_after,description)
        values($1,-$3::numeric,'PLAYER_DELETE_TRANSFER_OUT',$2,0,$4),
              ($2,$3::numeric,'PLAYER_DELETE_TRANSFER_IN',$1,$5,$6)`,
      [id, owner.id, amount, `Kalimi i bilancit pas fshirjes te ${owner.username}`, credited.rows[0].balance, `Bilanc nga lojtari i fshirë ${player.username}`]);
    }
    await client.query(`insert into app_admin_audit(actor_id,actor_name,actor_role,action,target_type,target_id,details)
      values($1,$2,$3,'PLAYER_REMOVED','user',$4,$5::jsonb)`,
    [owner.id, owner.username, owner.role, id, JSON.stringify({ username: player.username, transferred: amount, recipientId: owner.id, futurePayoutsTransferred: false })]);
    await client.query('commit');
    return { id, transferred: Number(amount), recipientId: owner.id, alreadyDeleted: false };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    if (error.code === '55P03') throw fail(409, 'Llogaria po përditësohet. Provo fshirjen përsëri.');
    throw error;
  } finally { client.release(); }
}

/** The first midnight after the second day, in the site's Albanian timezone.
 * On days 1–2 return the previous cleanup boundary; missed jobs catch up.
 */
export function deletedHistoryCutoff(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = date => Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const local = parts(now);
  const target = new Date(Date.UTC(local.year, local.month - 1 - (local.day <= 2 ? 1 : 0), 3));
  const wanted = target.getTime();
  let instant = wanted;
  for (let iteration = 0; iteration < 3; iteration++) {
    const observed = parts(new Date(instant));
    const represented = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    instant += wanted - represented;
  }
  return new Date(instant);
}

/** Kept for old scheduled callers. Protected financial history is retained indefinitely. */
export async function purgeDeletedPlayerHistory({ now = new Date() } = {}) {
  return { purged: 0, deferred: 0, cutoff: deletedHistoryCutoff(now).toISOString(), retained: true };
}
