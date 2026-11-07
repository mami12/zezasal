/**
 * Monetary guardrails on the real ticket transaction, never on client input.
 * Payout liabilities are deliberately conservative: the full potential payout
 * of every pending ticket is counted against each live match it references.
 * The caller MUST have locked the global app_live_risk_settings row first.
 */
import { getMatchById } from '../matches.mjs';
import { liveRiskReason } from '../live-risk.mjs';
import { isSameGameComboLine } from './automatic-combos.mjs';
import { config } from '../config.mjs';

const fail = (message, code = 'LIVE_RISK_LIMIT') => {
  throw Object.assign(new Error(message), { status: 400, code });
};

/** Pure guards, shared by single and multi-column requests. */
export function assertLiveMoneyLimits(liveStake, livePayout, limits) {
  const { maxLiveStake, maxLivePayout } = limits;
  if (maxLiveStake !== null && liveStake > maxLiveStake + 0.001) {
    fail(`Shuma maksimale për bastet LIVE në këtë kupon është ${maxLiveStake} Lek.`);
  }
  if (maxLivePayout !== null && livePayout > maxLivePayout + 0.001) {
    fail(`Pagesa e mundshme LIVE kalon kufirin ${maxLivePayout} Lek.`);
  }
}

export function assertLiveMatchExposure(newLiability, pending, maxMatchExposure) {
  if (maxMatchExposure === null) return;
  for (const [matchId, additional] of newLiability) {
    if ((pending.get(matchId) ?? 0) + additional > maxMatchExposure + 0.001) {
      fail(`Kufiri i ekspozimit LIVE për ndeshjen ${matchId} është arritur.`, 'LIVE_MATCH_EXPOSURE');
    }
  }
}

export async function assertLiveBetRisk(client, columns, settings) {
  // This switch applies to prematch too, independently of LIVE risk controls.
  // Read under the persisted settings row lock to close the disable/place race.
  if (settings.combosEnabled === false && columns.some(c => c.lines.some(isSameGameComboLine))) {
    fail('Combot janë çaktivizuar nga administrata.', 'COMBOS_DISABLED');
  }
  if (!settings.enabled) return;
  const liveMatches = new Map();
  const newLiability = new Map();
  let liveStake = 0;
  let livePayout = 0;

  for (const column of columns) {
    let containsLive = false;
    for (const line of column.lines) {
      const id = String(line.matchId);
      let match = liveMatches.get(id);
      if (match === undefined) {
        match = config.matchStore === 'db'
          ? (await client.query('select * from matches where match_id = $1',[Number(id)])).rows[0] ?? null
          : await getMatchById(Number(id));
        // The match may be prematch; it still has a sentinel in the map.
        liveMatches.set(id, match ?? null);
      }
      if (!match) fail('Ndeshja nuk është më e disponueshme.');
      const live = String(match.service).toUpperCase() === 'LIVE';
      if (!live) continue;
      containsLive = true;
      const legs = Array.isArray(line.builderLegs) ? line.builderLegs : [line];
      for (const leg of legs) {
        const reason = liveRiskReason(match, {
          marketName: leg.market_name ?? leg.marketName,
          marketKey: leg.market_key ?? leg.marketKey,
          outcomeName: leg.outcome_name ?? leg.outcomeName,
          outcomeKey: leg.outcome_key ?? leg.outcomeKey,
          price: leg.price,
        }, Date.now(), settings);
        if (reason) fail('Një zgjedhje është bllokuar nga menaxhimi i rrezikut.', 'LIVE_RISK_SUSPENDED');
      }
      newLiability.set(id,(newLiability.get(id) ?? 0) + column.payout);
    }
    if (containsLive) {
      liveStake += column.stake;
      livePayout += column.payout;
    }
  }

  if (!newLiability.size) return;
  assertLiveMoneyLimits(liveStake, livePayout, settings.limits);
  const { maxMatchExposure } = settings.limits;
  if (maxMatchExposure === null) return;

  // The singleton settings row (FOR UPDATE) serializes this query with all
  // other bet placements, including simultaneous bets by DIFFERENT players.
  const ids = [...newLiability.keys()].map(Number);
  const { rows } = await client.query(
    `select l.match_id, coalesce(sum(t.potential_payout),0) as pending
       from app_ticket_line l
       join app_ticket t on t.id=l.ticket_id
      where t.status='PENDING' and t.user_id is not null and l.match_id = any($1::bigint[])
      group by l.match_id`,
    [ids],
  );
  const pending = new Map(rows.map(row => [String(row.match_id),Number(row.pending)]));
  assertLiveMatchExposure(newLiability, pending, maxMatchExposure);
}
