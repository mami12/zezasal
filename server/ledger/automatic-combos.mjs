import { createHash } from 'node:crypto';
import { normalizeBuilder } from './bet-builder-contracts.mjs';

// Only full-time football contracts with an existing, tested settlement rule.
// Prices always come from the two real selections, never from a saved browser price.
export { multipliedComboPrice, COMBO_PRICE_LIMIT } from './combo-price.mjs';
export { isSameGameComboLine } from './combo-policy.mjs';
const lines = ['0.5','1.5','2.5','3.5','4.5','5.5','6.5'];
const outcomes = { '1X2':['1','X','2'], DC:['1X','12','X2'], BTTS:['Yes','No'] };
const compatibility = new Map();

export const comboSignature = legs => [...legs].map(l => `${l.market}:${l.outcome}:${l.line ?? ''}`).sort().join('|');

function wins(leg, home, away) {
  const result = home > away ? '1' : home < away ? '2' : 'X';
  if (leg.market === '1X2') return leg.outcome === result;
  if (leg.market === 'DC') return leg.outcome.includes(result);
  if (leg.market === 'BTTS') return (leg.outcome === 'Yes') === (home > 0 && away > 0);
  if (leg.market === 'TOTAL') return leg.outcome === 'Over' ? home + away > Number(leg.line) : home + away < Number(leg.line);
  return false;
}

/** Exclude impossible pairs and a leg already guaranteed by the other leg. */
export function isCompatibleComboPair(legs) {
  if (!Array.isArray(legs) || legs.length !== 2) return false;
  try { legs = normalizeBuilder({legs}).legs; } catch { return false; }
  const signature = comboSignature(legs);
  if (compatibility.has(signature)) return compatibility.get(signature);
  const limit = Math.ceil(Math.max(7, ...legs.filter(l => l.market === 'TOTAL').map(l => Number(l.line)))) + 2;
  if (!Number.isFinite(limit) || limit > 12) return false;
  let together = false, leftOnly = false, rightOnly = false;
  for (let home = 0; home <= limit; home++) for (let away = 0; away <= limit; away++) {
    const a = wins(legs[0], home, away), b = wins(legs[1], home, away);
    together ||= a && b;
    leftOnly ||= a && !b;
    rightOnly ||= !a && b;
  }
  const valid = together && leftOnly && rightOnly;
  compatibility.set(signature,valid);
  return valid;
}

function stableId(signature) {
  const hex = createHash('sha256').update('faqja:auto-combo:v1:' + signature).digest('hex').slice(0,32).split('');
  hex[12] = '5'; hex[16] = '8';
  const id = hex.join('');
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

const templates = [];
const add = legs => {
  if (!isCompatibleComboPair(legs)) return;
  const normalized = normalizeBuilder({legs,active:true});
  templates.push(Object.freeze({...normalized,legs:Object.freeze(normalized.legs.map(Object.freeze)),id:stableId(comboSignature(normalized.legs)),automatic:true}));
};
for (const result of outcomes['1X2']) for (const btts of outcomes.BTTS) add([
  {market:'1X2',outcome:result,line:''},{market:'BTTS',outcome:btts,line:''},
]);
for (const line of lines) for (const side of ['Over','Under']) {
  for (const kind of ['1X2','DC','BTTS']) for (const outcome of outcomes[kind]) add([
    {market:kind,outcome,line:''},{market:'TOTAL',outcome:side,line},
  ]);
}
export function automaticComboTemplates() { return templates; }
