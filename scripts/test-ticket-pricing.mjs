import assert from 'node:assert/strict';
import {
  potentialPayout,
  ticketTypeForSelectionCount,
  totalOddsForSelections,
} from '../server/ledger/ticket-pricing.mjs';

const selections = [{ price: 1.3 }, { price: 2.4 }];
const totalOdds = totalOddsForSelections(selections);

assert.equal(totalOdds, 3.12, 'a two-match combo multiplies both odds');
assert.equal(potentialPayout(100, totalOdds), 312, 'payout uses stake times the combined odds');
assert.equal(ticketTypeForSelectionCount('SINGLE', selections.length), 'COMBO', 'multiple picks are stored as a combo');
assert.equal(ticketTypeForSelectionCount('SINGLE', 1), 'SINGLE', 'one pick remains a single');
assert.equal(totalOddsForSelections([{ price: 1.3 }]), 1.3, 'a single selection keeps its own odds');

console.log('Ticket pricing checks passed');
