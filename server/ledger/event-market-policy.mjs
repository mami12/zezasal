import {marketDiagnosticAll} from '../market-diagnostic.mjs';
/** A final aggregate score cannot prove who scored, when, or event order.
 * These contracts need a verified event/participation feed which this provider
 * adapter does not currently supply. Never substitute full-time total goals.
 * Shared by publication, placement and settlement, including stale clients.
 */
import {goalTotalContract} from './goal-total-contract.mjs';
export function eventMarketRequirement(market = {},teams={}) {
  const name = String(market.market_name ?? market.marketName ?? market.name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  if (/\b(?:players?|goalscorers?|goal scorers?|scorers?|assists?|hat[ -]?trick|golashenues(?:it)?|lojtari|lojtare(?:t)?)\b/.test(name) ||
      /\bto score\s+(?:a goal|[2-9]\+? goals?|two|three|four)\b/.test(name)) return 'PLAYER_EVENT_DATA_REQUIRED';
  if(/\b(?:headed goals?|header goals?|penalty goals?|left[ -]foot|right[ -]foot|scoring method|method of (?:the )?goal)\b/.test(name))return 'GOAL_CONTRACT_DATA_REQUIRED';
  if(/\banytime\b/.test(name)&&/\b(?:score|scoring)\b/.test(name))return 'PLAYER_EVENT_DATA_REQUIRED';
  if(/\bto score\b/.test(name)&&!(/\bboth (?:teams?|sides?)\b/.test(name)||/^(?:home(?: team)?|away(?: team)?|team [12]) to score$/.test(name)))return 'PLAYER_EVENT_DATA_REQUIRED';
  if (/^when will (?:the )?(?:goal \d+|next goal) be scored\b/.test(name))return 'TIMED_EVENT_DATA_REQUIRED';
  if (/\b(?:minutes?|mins?|time of|scoring time|timed? goal|goal time|koha e|minuten?|minuta)\b/.test(name) ||
      /\b(?:goals?|scores?|scoring|to score)\s+(?:before|after|within|between|until|during|by|in)\b/.test(name) ||
      /\b(?:score|goals?)\b.*\b(?:either|each|both)\s+hal(?:f|ves)\b/.test(name) ||
      /\b\d{1,2}:\d{2}\s*[-â€“]\s*\d{1,2}:\d{2}\b/.test(name) ||
      /\bgoals?\s+\(?\d{1,2}\s*[-â€“]\s*\d{1,2}\)?\s*$/.test(name)) return 'TIMED_EVENT_DATA_REQUIRED';
  if (/^who (?:scores (?:goal \d+|most goals)|takes most corners|receives most cards)\b/.test(name))return 'EVENT_SEQUENCE_DATA_REQUIRED';
  if (/\b(?:first|last|next|1st|2nd|3rd|4th|5th|second|third|fourth|fifth)\s+(?:(?:team|player)\s+to\s+(?:score|receive)|goals?|corners?|cards?|bookings?|scorers?|fouls?)\b/.test(name) ||
      /\b(?:race to|early payout|own goals?)\b/.test(name)) return 'EVENT_SEQUENCE_DATA_REQUIRED';
  // An explicit three-way GOALS total has an exact-count outcome, not an
  // unnamed player/team total. Its final result is directly gradeable from
  // the verified match score, without a separate player event timeline.
  if(/\b(?:3[\s-]*way|three[\s-]*way)\b/.test(name)&&
      /\b(?:total goals?|goals? total)\b/.test(name))return null;
  // A name such as "Salah Total Goals" must never mean both teams' goals.
  // Explicit team totals are allowed only against verified team identities.
  if(/\b(?:total goals?|goals? total)\b/.test(name)&&!/[&+]|\b(?:result|1x2|btts|both teams|double chance|exact|range|odd|even|handicap|asian)\b/.test(name)&&!goalTotalContract(market,teams))return 'GOAL_CONTRACT_DATA_REQUIRED';
  return null;
}

