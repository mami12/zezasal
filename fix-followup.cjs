const fs = require('fs');
const root='C:/Users/User/Desktop/faqja-main10.10.26/faqja-main/web/';
const edit=(n,f)=>fs.writeFileSync(root+n,f(fs.readFileSync(root+n,'utf8')));
edit('src/utils/marketExpiry.ts', s=> {
 s=s.replace("status === 'ENDED' ||", "status === 'CANCELLED' ||\n    status === 'ENDED' ||");
 s=s.replace("  const minute = Number(m?.currentMinute ?? 0);\n  return phase === '2H' || phase === 'HT' || phase === 'FT' || minute > 45;", "  // Added time is still the first half; use an explicit phase, not minute > 45.\n  return /^(2H|HT|FT|2ND HALF|SECOND HALF|BREAK TIME|HALF.?TIME|EXTRA TIME|PENALTIES)$/.test(phase);");
 s=s.replace('if (isFirstEventMarket(name)) {', 'if (isFirstEventMarket(name) && !isFirstHalfMarket(name) && !isSecondHalfMarket(name)) {');
 s=s.replace("  o.odds > 0 &&\n  o.suspended !== true;", "  Number.isFinite(o.odds) && o.odds > 1 &&\n  !['SETTLED', 'VOID'].includes(String(o.status).toUpperCase()) &&\n  o.suspended !== true;");
 s=s.replace('  if (!market.outcomes?.length) return false;', "  if (!market.outcomes?.length) return false;\n  if (String(market.status).toUpperCase() === 'SETTLED') return false;");
 const start=s.indexOf('/**\n * Heq outcomes');
 s=s.slice(0,start)+`/** Hide only conclusively decided full-match totals; never infer period/team counters. */
export function filterDecidedOutcomes(outcomes: any[] = [], market: any = {}, match: any = {}) {
  if (!outcomes.length || match.status !== 'LIVE' || !isTotalMarket(market)) return outcomes;
  const name = String(market.name ?? '').toLowerCase();
  if (market.period || /half|team|home|away|pjes|ekip|vendas|mysafir|handicap|remaining|rest of|set|point|game/.test(name)) return outcomes;
  const line = parseLineNum(market.line);
  // Quarter/split Asian lines can have half wins or pushes: do not infer settlement here.
  if (line == null || line < 0 || !Number.isInteger(line * 2)) return outcomes;
  const isCorners = /corner/.test(name);
  const isCards = /card|booking/.test(name);
  if (isCorners && (!match.corners || match.corners.home == null || match.corners.away == null)) return outcomes;
  if (isCards) return outcomes; // card points and card counts are not interchangeable.
  if (!isCorners && (match.homeScore == null || match.awayScore == null)) return outcomes;
  const total = counterFor(market, match);
  if (total <= line) return outcomes; // Under remains possible until the threshold is exceeded.
  return outcomes.filter(o => !isOverOutcome(o) && !isUnderOutcome(o));
}
`;
 return s;
});
edit('src/components/Betslip/Betslip.tsx',s=>{
 s=s.replace("import { useState } from 'react';", "import { useState, useRef } from 'react';");
 s=s.replace('removeSelection, clearAll, totalOdds,', 'removeSelection, clearAll, updateOdds, totalOdds,');
 s=s.replace("  const [stakeError, setStakeError] = useState('');", `  const [stakeError, setStakeError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [actionError, setActionError] = useState('');
  const acceptOdds = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setActionError('');
    try {
      const ids = [...new Set(selections.map(s => s.matchId))];
      const responses = await Promise.all(ids.map(id => apiClient.get('/matches/' + encodeURIComponent(id))));
      const updates = selections.map(selection => {
        const match = responses.map(r => r.data).find(m => String(m.id) === String(selection.matchId));
        const market = match?.markets?.find((m: any) => m.id === selection.marketId);
        const outcome = market?.outcomes?.find((o: any) => o.id === selection.outcomeId);
        if (!match || !['LIVE', 'PREMATCH'].includes(match.status) || match.isSuspended || market?.status !== 'ACTIVE' || outcome?.status !== 'ACTIVE' || !Number.isFinite(outcome.odds) || outcome.odds <= 1) throw new Error(t('sections.odds_locked'));
        return { id: selection.outcomeId, odds: outcome.odds };
      });
      updates.forEach(u => updateOdds(u.id, u.odds));
      setOddsChangedError(false);
    } catch { setActionError(t('betslip.refresh_odds_failed')); }
    finally { submitting.current = false; setBusy(false); }
  };`);
 s=s.replace('  const handlePlaceBet = async () => {', "  const handlePlaceBet = async () => {\n    if (submitting.current) return;");
 s=s.replace("    setStakeError('');\n\n    try {\n      await placeBet", "    setStakeError('');\n    submitting.current = true; setBusy(true); setActionError('');\n    try {\n      await placeBet");
 s=s.replace("        alert(e.response?.data?.message || t('common.error'));\n      }\n    }\n  };", "        setActionError(e.response?.data?.message || t('common.error'));\n      }\n    } finally { submitting.current = false; setBusy(false); }\n  };");
 s=s.replace('  const handleBook = async () => {\n    try {', "  const handleBook = async () => {\n    if (submitting.current) return;\n    if (!Number.isFinite(Number(stake)) || Number(stake) < 1) { setStakeError(t('betslip.min_stake')); return; }\n    setStakeError(''); submitting.current = true; setBusy(true); setActionError('');\n    try {");
 s=s.replace("      alert(e.response?.data?.message || t('common.error'));\n    }\n  };", "      setActionError(e.response?.data?.message || t('common.error'));\n    } finally { submitting.current = false; setBusy(false); }\n  };");
 s=s.replace('    if (stakeNum < 1)', '    if (!Number.isFinite(stakeNum) || stakeNum < 1)');
 s=s.replace('onClick={() => setOddsChangedError(false)}', 'onClick={acceptOdds}\n                disabled={busy}');
 s=s.replace('onClick={handlePlaceBet}', 'onClick={handlePlaceBet}\n                  disabled={busy || oddsChangedError}');
 s=s.replace('onClick={handleBook}', 'onClick={handleBook}\n                disabled={busy || oddsChangedError}');
 s=s.replace('      {selections.length === 0 ? (', "      {actionError && <p role=\"alert\" className=\"p-3 text-sm text-rose-300\">{actionError}</p>}\n      {selections.length === 0 ? (");
 return s;
});
edit('src/i18n/al.ts', s=>s.replace("  betslip: {", "  betslip: {\n    refresh_odds_failed: 'Nuk u rifreskuan koeficientët. Një zgjedhje mund të jetë pezulluar; kontrolloje ose hiqe nga skedina.',"));
// Make betting controls available on short screens: scroll the whole mobile sheet.
edit('src/pages/SportsbookPage.tsx', s=>s.replace('w-full max-h-[85dvh] bg-secondary', 'w-full h-[85dvh] max-h-[85dvh] bg-secondary').replace('className="relative h-full animate-in', 'className="relative h-full pt-12 bg-secondary animate-in'));
console.log('Follow-up fixes applied');
