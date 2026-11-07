// Board contract selection shared with the UI.
const nameOf = (market) => String(market.name ?? "").toLowerCase().trim();
const typeOf = (market) => String(market.marketType ?? "").toUpperCase().trim();
const closed = (market) => /^(?:CLOSED|SETTLED|VOID|REMOVED|DELETED|CANCELLED|CANCELED|FINISHED|ENDED|INACTIVE)$/.test(String(market.status ?? "").trim().toUpperCase());
const fullTime = (market) => {
  if (!(market.period == null || market.period === "" || Number(market.period) === 0)) return false;
  const name = nameOf(market).replace(/\b90\s*min(?:ute)?s?\b/g, "");
  return !/\b(?:half|halves|1h|2h|quarters?|periods?|extra[ -]?time|overtime|next|remaining|first|last|min(?:ute)?s?|corners?|cards?|bookings?|points?|handicap|asian|penalty|penalties|shootout)\b|pjesa|pjesë/i.test(name) && !/CORNER|CARD|BOOKING|POINT|HANDICAP|ASIAN|HALF|PERIOD|TEAM_TOTAL/.test(typeOf(market));
};
const standalone = (market) => !/\+|&|\b(?:and|combo|combination|builder)\b/.test(nameOf(market));
const aggregateResult = (market) => !/\b(?:home|away|team\s*[12]|[12](?:st|nd)\s+team)\b/.test(nameOf(market));
const differentNamedFamily = (market) => /double chance|dopjo shans|both teams? (?:to )?score|both score|\bbtts\b|gg\/?ng|total|over\/?under|under\/?over|goal line/.test(nameOf(market));
const result = (market) => fullTime(market) && standalone(market) && aggregateResult(market) && !differentNamedFamily(market) && (typeOf(market) === "1X2" || /^(?:1x2|match result|full[ -]time result|match winner|winner|moneyline)(?:\s*\(1x2\))?$/.test(nameOf(market)));
const doubleChance = (market) => fullTime(market) && standalone(market) && aggregateResult(market) && (["DOUBLE_CHANCE", "DC"].includes(typeOf(market)) || /^(?:double chance|dopjo shans)$/.test(nameOf(market)));
const bothScore = (market) => fullTime(market) && standalone(market) && (typeOf(market) === "BTTS" || /^(?:both teams? to score|both teams? score|both score|btts|gg\/?ng)$/.test(nameOf(market)));
function getBoardTotalLine(market) {
  if (!market) return null;
  for (const value of [market.line, market.specifier]) {
    if (value == null || String(value).trim() === "") continue;
    const text = String(value).trim().replace(",", ".");
    const match = text.match(/^(?:total|goals?|line)\s*[=:]\s*(\d+(?:\.\d+)?)$/i);
    const numeric = Number(match ? match[1] : text);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  const embedded = nameOf(market).match(/(?:^|\s|\()(\d+(?:[.,]\d+)?)\)?$/);
  if (embedded) return Number(embedded[1].replace(",", "."));
  const lines = (market.outcomes ?? []).map((outcome) => String(outcome.name ?? "").match(/^(?:over|under|o|u)\s*\(?\s*(\d+(?:[.,]\d+)?)\)?$/i)).filter((match) => match !== null).map((match) => Number(match[1].replace(",", ".")));
  return lines.length && lines.every((line) => line === lines[0]) ? lines[0] : null;
}
function findBoardOutcome(market, aliases) {
  const normalized = aliases.map((alias) => String(alias).trim().toLowerCase()).filter(Boolean);
  const matches = (label) => normalized.includes(label) || normalized.some((alias) => !/^\d+(?:[.,]\d+)?$/.test(alias) && (label.startsWith(alias + " ") || label.startsWith(alias + " (")));
  const outcomes = market?.outcomes ?? [];
  const named = outcomes.find((outcome) => matches(String(outcome.name ?? "").trim().toLowerCase()));
  if (named) return named;
  return outcomes.find((outcome) => {
    const name = String(outcome.name ?? "").trim();
    return (!name || /^\d+(?:[.,]\d+)?$/.test(name)) && matches(String(outcome.code ?? outcome.key ?? "").trim().toLowerCase());
  }) ?? null;
}
// The feed renames one and the same team-level contract while the match
// progresses: before any goal it is announced as "First team to score", after
// a goal as "Next goal". Both are the next-goal column, so both are recognised
// under either title or market type. Goal-timing markets ("when will goal N be
// scored", "in X minutes interval") and player markets ("first goalscorer")
// describe different contracts and stay out.
function nextGoal(market) {
  if (Number(market?.period ?? 0) !== 0) return false;
  const name = nameOf(market);
  const type = typeOf(market);
  if (/when\s+will|minutes?\s+interval|time\s+of\s+(?:the\s+)?(?:first|next|last)\s+goal/.test(name)) return false;
  if (/goalscorer|goal\s*scorer|scorer|player|anytime/.test(name)) return false;
  if (/NEXT_GOAL|NEXTGOAL|NEXT_TEAM_TO_SCORE|GOAL_NEXT|FIRST_TEAM_TO_SCORE|TEAM_TO_SCORE|FIRST_GOAL/.test(type)) return true;
  return /next\s+goal|next\s+team\s+to\s+score|first\s+team\s+to\s+score|team\s+to\s+score|first\s+goal|who\s+scores\s+(?:the\s+)?next|goli\s+i\s+radh[eë]s|ekipi\s+i\s+par[eë]\s+q[eë]\s+sh[eë]non/i.test(name);
}
function selectBoardMarkets(markets, visible, suspended, teams = {}) {
  const main = markets.find(result) ?? null;
  const usable = (market) => !closed(market) && (visible(market) || suspended(market));
  const dc = main ? null : markets.find((market) => doubleChance(market) && usable(market)) ?? null;
  const btts = main || dc ? null : markets.find((market) => bothScore(market) && usable(market)) ?? null;
  // A feed can keep the full-time 1X2 among the extra markets under a name the
  // strict matcher does not know. It is consulted only when no strict
  // 1X2/DC/BTTS candidate exists, so a present-but-closed 1X2 still keeps its
  // own identity and the announced contract never silently changes.
  const extraResult = main || dc || btts ? null : markets.find((market) =>
    Number(market.period ?? 0) === 0 && standalone(market) && aggregateResult(market) && !differentNamedFamily(market)
    && (typeOf(market) === "1X2" || /1x2|match result|match winner|winner|moneyline/.test(nameOf(market)))
    && usable(market)) ?? null;
  const primary = main ? closed(main) ? null : main : dc ?? btts ?? extraResult;
  const primaryType = main ? "1X2" : dc ? "DC" : btts ? "BTTS" : "1X2";
  const teamNames = [teams.homeTeam, teams.awayTeam].filter(Boolean).map((name) => String(name).toLowerCase().trim());
  const namesTeam = (name, team) => team.length >= 3 ? name.includes(team) : new RegExp("(?:^|\\W)" + team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:$|\\W)").test(name);
  const totals = markets.filter((market) => {
    const name = nameOf(market);
    if (!fullTime(market) || !standalone(market) || closed(market) || /\b(?:team|home|away|both|exact|correct|odd|even)\b/.test(name)) return false;
    if (teamNames.some((team) => namesTeam(name, team))) return false;
    return (["OVER_UNDER", "TOTAL", "TOTALS", "TOTAL_GOALS"].includes(typeOf(market)) || /^(?:total goals|total|goals over\/?under|over\/?under|under\/?over|goal line)(?:\s|\(|$)/.test(name)) && // The suspended predicate must already exclude expired/decided contracts.
    getBoardTotalLine(market) !== null && usable(market);
  });
  totals.sort((a, b) => Math.abs(getBoardTotalLine(a) - 2.5) - Math.abs(getBoardTotalLine(b) - 2.5) || getBoardTotalLine(b) - getBoardTotalLine(a));
  let total = totals[0] ?? null;
  if (!total) {
    // Same fallback for the goal line: a full-time total typed as over/under
    // whose title the strict list did not recognise is still preferable to an
    // empty column. Team totals are removed through the fixture team names.
    const extraTotals = markets.filter((market) =>
      fullTime(market) && standalone(market) && !closed(market)
      && ["OVER_UNDER", "TOTAL", "TOTALS", "TOTAL_GOALS"].includes(typeOf(market))
      && getBoardTotalLine(market) !== null && usable(market)
      && !teamNames.some((team) => namesTeam(nameOf(market), team)));
    extraTotals.sort((a, b) => Math.abs(getBoardTotalLine(a) - 2.5) - Math.abs(getBoardTotalLine(b) - 2.5) || getBoardTotalLine(b) - getBoardTotalLine(a));
    total = extraTotals[0] ?? null;
  }
  const goal = markets.find((market) => nextGoal(market) && usable(market)) ?? null;
  return { primary, primaryType, total, totalLine: getBoardTotalLine(total), nextGoal: goal };
}
export {
  findBoardOutcome,
  getBoardTotalLine,
  selectBoardMarkets
};
