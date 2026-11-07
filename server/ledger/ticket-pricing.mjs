export function ticketTypeForSelectionCount(requestedType, selectionCount) {
  return selectionCount > 1 ? 'COMBO' : requestedType || 'SINGLE';
}

export function totalOddsForSelections(selections) {
  if (!selections.length) return 0;
  return selections.reduce((total, selection) => total * Number(selection.price), 1);
}

export function potentialPayout(stake, totalOdds) {
  return Number((Number(stake) * Number(totalOdds)).toFixed(2));
}
