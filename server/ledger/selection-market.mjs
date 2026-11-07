/** Exact contract identity. Display names and translated labels are never IDs. */
export function selectionMarketIdentity(selection) {
  const outcome = String(selection?.outcomeId ?? '').split('|');
  const market = String(selection?.marketId ?? '').split('|');
  const marketKey = selection?.marketKey ?? selection?.market_key;
  const isBuilder = outcome[0] === 'BB' || market[0] === 'BB' || String(marketKey ?? '').startsWith('BB:') ||
    String(outcome[1] ?? '').startsWith('BB:') || String(market[1] ?? '').startsWith('BB:');
  if (isBuilder && Array.isArray(selection?.builderLegs) && selection.builderLegs.length === 2) {
    const matchId = outcome[0] === 'BB' ? outcome[1] : outcome.length >= 4 ? outcome[0]
      : market[0] === 'BB' ? market[1] : selection.matchId ?? selection.match_id ?? market[0];
    // Different templates are options of one builder market when their two
    // source markets match. Outcomes do not identify a market; lines/periods do.
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
    return JSON.stringify(outcome.slice(0, 3));
  }
  // The resolver supplies authoritative fields, rather than browser metadata.
  const matchId = selection?.matchId ?? selection?.match_id;
  if (matchId != null && marketKey != null) {
    return JSON.stringify([String(matchId), String(marketKey), String(selection.line ?? '')]);
  }
  if (market[0] === 'BB' && market.length >= 3 && market[1] && market[2]) {
    return JSON.stringify([market[1], `BB:${market[2]}`, '']);
  }
  if (market.length >= 3 && market[0] && market[1]) {
    return JSON.stringify(market.slice(0, 3));
  }
  if (selection?.matchId != null && selection?.marketId) {
    return JSON.stringify([String(selection.matchId), String(selection.marketId), String(selection.marketLine ?? ''), Number(selection.period ?? 0)]);
  }
  return null;
}

/** Clicking an active option removes it; another option replaces its market. */
export function toggleMarketSelection(previous, selection) {
  if (previous.some(pick => pick.outcomeId === selection.outcomeId)) {
    return previous.filter(pick => pick.outcomeId !== selection.outcomeId);
  }
  const identity = selectionMarketIdentity(selection);
  // Keep the market in its current position so changing 1/X/2 does not reorder a slip.
  const index = identity === null ? -1 : previous.findIndex(pick => selectionMarketIdentity(pick) === identity);
  if (index < 0) return [...previous, selection];
  return previous.flatMap((pick, position) => position === index ? [selection]
    : selectionMarketIdentity(pick) === identity ? [] : [pick]);
}

/** Guard the entire logical slip, including alternatives split into columns. */
export function assertDistinctSelectionMarkets(selections) {
  const seen = new Set();
  for (const selection of selections) {
    const identity = selectionMarketIdentity(selection);
    if (identity === null) continue; // The normal resolver rejects unidentified picks.
    if (seen.has(identity)) {
      throw Object.assign(new Error('Lejohet vetëm një zgjedhje nga i njëjti treg. Hiq zgjedhjen tjetër dhe provo përsëri.'), {
        status: 400, code: 'DUPLICATE_MARKET', outcomeId: selection.outcomeId,
      });
    }
    seen.add(identity);
  }
}
