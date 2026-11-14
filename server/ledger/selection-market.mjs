/** Stable market GROUP identity. Quoted lines are alternatives within one provider market key.\n * Never group by translated names or generic marketType: those may describe different contracts. */
export function selectionMarketIdentity(selection) {
  const outcome = String(selection?.outcomeId ?? '').split('|');
  const market = String(selection?.marketId ?? '').split('|');
  const marketKey = selection?.marketKey ?? selection?.market_key;
  const isBuilder = outcome[0] === 'BB' || market[0] === 'BB' || String(marketKey ?? '').startsWith('BB:') ||
    String(outcome[1] ?? '').startsWith('BB:') || String(market[1] ?? '').startsWith('BB:');
  if (isBuilder && Array.isArray(selection?.builderLegs) && selection.builderLegs.length === 2) {
    const matchId = outcome[0] === 'BB' ? outcome[1] : outcome.length >= 4 ? outcome[0]
      : market[0] === 'BB' ? market[1] : selection.matchId ?? selection.match_id ?? market[0];
    // Builder options sharing the same two source market groups are alternatives,
    // even when one leg quotes a different numeric line.
    const legs = selection.builderLegs.map(leg => leg && typeof leg === 'object' ? selectionMarketIdentity({
      ...leg, matchId:leg.matchId ?? leg.match_id ?? matchId, builderLegs:undefined,
    }) : null);
    if (matchId != null && String(matchId) && legs.every(identity => identity !== null)) {
      return JSON.stringify([String(matchId), 'BB:markets', ...legs.sort()]);
    }
  }
  // Before server resolution the only trusted evidence is the saved template.
  if (outcome[0] === 'BB' && outcome.length >= 3 && outcome[1] && outcome[2]) {
    return JSON.stringify([outcome[1], `BB:${outcome[2]}`, '']);
  }
  if (outcome.length >= 4 && outcome[0] && outcome[1]) {
    return JSON.stringify(outcome.slice(0, 2));
  }
  // The resolver supplies authoritative fields, rather than browser metadata.
  const matchId = selection?.matchId ?? selection?.match_id;
  if (matchId != null && marketKey != null) {
    return JSON.stringify([String(matchId), String(marketKey)]);
  }
  if (market[0] === 'BB' && market.length >= 3 && market[1] && market[2]) {
    return JSON.stringify([market[1], `BB:${market[2]}`, '']);
  }
  if (market.length >= 3 && market[0] && market[1]) {
    return JSON.stringify(market.slice(0, 2));
  }
  if (selection?.matchId != null && selection?.marketId) {
    return JSON.stringify([String(selection.matchId), String(selection.marketId)]);
  }
  return null;
}

/** A logical slip may contain ONE outcome per match/provider market group.
 * Quoted lines (e.g. goal totals 1.5, 2.5, 3.5) are alternatives, not
 * independent picks. Different markets on the SAME match remain compatible.
 * Clicking another outcome REPLACES the previous one.
 * Historical columns already paid out remain intact in the database.
 */
export function toggleMarketSelection(previous, selection) {
  const sameOutcome = previous.some(pick => pick.outcomeId === selection.outcomeId);
  const identity = selectionMarketIdentity(selection);
  if (identity === null) {
    return sameOutcome
      ? previous.filter(pick => pick.outcomeId !== selection.outcomeId)
      : [...previous, selection];
  }
  const first = previous.findIndex(pick => selectionMarketIdentity(pick) === identity);
  // Remove all duplicate-market picks from an older client state as well.
  const remaining = previous.filter(pick => selectionMarketIdentity(pick) !== identity);
  if (sameOutcome) return remaining;
  if (first === -1) return [...remaining, selection];
  remaining.splice(Math.min(first,remaining.length), 0, selection);
  return remaining;
}

/** Guard the entire logical slip, including alternatives split into columns. */
export function assertDistinctSelectionMarkets(selections) {
  const seen = new Set();
  for (const selection of selections) {
    const identity = selectionMarketIdentity(selection);
    if (identity === null) continue; // The normal resolver rejects unidentified picks.
    if (seen.has(identity)) {
      throw Object.assign(new Error('Lejohet vetëm një zgjedhje nga i njëjti grup tregu. Hiq zgjedhjen tjetër dhe provo përsëri.'), {
        status: 400, code: 'DUPLICATE_MARKET', outcomeId: selection.outcomeId,
      });
    }
    seen.add(identity);
  }
}
