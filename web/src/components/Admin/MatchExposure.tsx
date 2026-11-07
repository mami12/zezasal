import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { translateMarketName, translateOutcomeName } from '../../utils/sportsbookLabels';

const money = (n: number) => Number(n || 0).toLocaleString('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lekë';
const fields: Record<string, string> = { corners: 'Kornera', fouls: 'Faulle', shots: 'Goditje', shotsOnTarget: 'Goditje në portë', yellow: 'Kartonë të verdhë', red: 'Kartonë të kuq', cards: 'Kartonë gjithsej' };
const input = 'bg-primary border border-tertiary rounded-lg p-2 text-sm text-white w-full';
const panel = 'bg-secondary rounded-xl border border-tertiary p-4 space-y-3';

export default function MatchExposure() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>({ totals: {}, matches: [] });
  const [reviews, setReviews] = useState<any[]>([]);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [matchId, setMatchId] = useState(''), [selection, setSelection] = useState('');
  const [scope, setScope] = useState('market'), [ticketId, setTicketId] = useState('');
  const [status, setStatus] = useState('PENDING'), [reason, setReason] = useState(''), [source, setSource] = useState('');
  async function load() {
    try {
      const [exposure, review] = await Promise.all([apiClient.get('/admin/match-exposure'), apiClient.get('/admin/statistics-review')]);
      setData(exposure.data); setReviews(review.data.reviews); setError('');
    } catch (e: any) { setError(e.response?.data?.message || 'Nuk u ngarkua monitorimi financiar.'); }
  }
  useEffect(() => { void load(); const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer); }, []);
  const match = data.matches.find((item: any) => String(item.matchId) === matchId);
  const review = reviews.find(item => String(item.match_id) === matchId)?.payload;
  const selections = (match?.markets || []).flatMap((market: any) => market.outcomes.map((outcome: any) => ({ market, outcome, id: JSON.stringify([market.marketKey, market.line ?? '', outcome.key]) })));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(''); setError('');
    try {
      const selected = selections.find((item: any) => item.id === selection);
      if (scope === 'market' && !selected) throw new Error('Zgjidh përzgjedhjen e tregut.');
      const target = scope === 'ticket' ? { ticketId: ticketId.trim() } : { matchId, marketKey: selected.market.marketKey, line: selected.market.line ?? '', outcomeKey: selected.outcome.key };
      const result = await apiClient.post('/admin/manual-settlement', { ...target, status, reason, source });
      setMessage('Vendimi u regjistrua për ' + result.data.changed.length + ' bileta.'); await load();
    } catch (e: any) { setError(e.response?.data?.message || e.message || 'Vendimi nuk u ruajt.'); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-7xl p-3 sm:p-6 space-y-5">
    {error && <p role="alert" className="text-red-400">{error}</p>}{message && <p role="status" className="text-accent-green">{message}</p>}
    <div className={panel}>
      <div className="flex flex-wrap justify-between gap-3"><p>{data.totals.tickets || 0} bileta · {money(data.totals.stake)} gjithsej</p><button onClick={load} className="text-accent-green">Rifresko</button></div>
      <label className="block">Ndeshja<select aria-label="Ndeshja e monitoruar" value={matchId} onChange={e => { setMatchId(e.target.value); setSelection(''); }} className={input}><option value="">Zgjidh ndeshjen</option>{data.matches.map((item: any) => <option key={item.matchId} value={item.matchId}>{item.name} ({item.tickets} bileta)</option>)}</select></label>
      <p className="text-sm text-text-secondary">Në ekran të ngushtë, lëviz tabelat anash për të parë të gjitha kolonat. Shuma e ndarë shpërndan bastin e kombinuar mes ndeshjeve dhe përzgjedhjeve. Pagesat varen nga fitimi i përzgjedhjeve të tjera. Pagesa dhe netoja në çdo rresht i përkasin vetëm asaj përzgjedhjeje; tregjet e tjera mund të fitojnë njëkohësisht. Mos i mblidh pagesat e rezultateve që përjashtojnë njëri-tjetrin.</p>
    </div>
    {match && <><div className={panel}>
      <h2 className="font-bold">{match.name}</h2><p>{match.uniqueUsers} përdorues · {match.tickets} bileta · Baste të lidhura: {money(match.linkedStake)} · Shuma e ndarë: {money(match.allocatedStake)}</p>
      <div className="overflow-auto"><table className="w-full min-w-[620px] text-sm text-left [&_th]:p-2 [&_td]:p-2"><thead><tr><th>Përdoruesi</th><th>Bileta</th><th>Baste të lidhura</th><th>Shuma e ndarë</th></tr></thead><tbody>{match.users.map((user: any) => <tr key={user.id} className="border-t border-tertiary"><td className="py-2">{user.username}</td><td>{user.tickets}</td><td>{money(user.linkedStake)}</td><td>{money(user.allocatedStake)}</td></tr>)}</tbody></table></div>
      {match.markets.map((market: any) => <div key={market.id} className="space-y-2"><h3 className="font-bold">{translateMarketName(market.name, t)} {market.line}</h3><div className="overflow-auto"><table className="w-full min-w-[620px] text-sm text-left [&_th]:p-2 [&_td]:p-2"><thead><tr><th>Rezultati</th><th>Përdorues / bileta</th><th>Shuma e ndarë</th><th>Koeficientët</th><th>Pagesa e kushtëzuar</th><th>Neto e kushtëzuar</th></tr></thead><tbody>{market.outcomes.map((outcome: any) => <tr key={outcome.key} className="border-t border-tertiary"><td className="py-2">{translateOutcomeName(outcome.name, t, market.name, match.name, outcome.key)}</td><td><details><summary>{outcome.users} / {outcome.tickets}</summary>{outcome.members.map((user: any) => <p key={user.id}>{user.username}: {money(user.linkedStake)} · {user.tickets} bileta · {user.odds.join(', ')}</p>)}</details></td><td>{money(outcome.allocatedStake)}</td><td>{outcome.odds.join(', ')}</td><td>{money(outcome.maxConditionalPayout)}</td><td>{money(outcome.netAtRisk)}</td></tr>)}</tbody></table></div></div>)}
    </div><div className={panel}><h2 className="font-bold">Verifikimi i statistikave përfundimtare</h2>
      {!review ? <p className="text-text-secondary">Nuk ka ende kontroll përfundimtar të regjistruar.</p> : <><p>{review.status === 'MANUAL_REVIEW' ? 'Në pritje të verifikimit manual' : 'Burimet përfundimtare janë krahasuar'} · {new Date(review.checkedAt).toLocaleString('sq-AL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
        {(review.sources || []).map((item: any) => <div key={item.provider}><strong>{item.provider}</strong><p className="text-sm">{Object.entries(item.values || {}).filter(([key, value]: any) => fields[key] && value?.home != null && value?.away != null).map(([key, value]: any) => `${fields[key]}: ${value.home}–${value.away}`).join(' · ') || 'Pa statistika të plota'}</p></div>)}
        {Object.keys(review.conflicts || {}).length > 0 && <p className="text-red-400">Mospërputhje: {Object.keys(review.conflicts).map(key => fields[key] || key).join(', ')}</p>}
        {Object.keys(review.unavailable || {}).length > 0 && <p className="text-text-secondary text-sm">Burime pa të dhëna përfundimtare: {Object.keys(review.unavailable).join(', ')}</p>}</>}
    </div></>}
    <form onSubmit={submit} className={panel}><h2 className="font-bold">Vendim manual i administratorit</h2>
      <p className="text-sm text-text-secondary">Vendimi ruhet me administratorin, kohën, arsyen dhe burimin. Për tregun zgjidhet rezultati konkret. Për biletën vendimi zbatohet te të gjitha përzgjedhjet e saj. Bilanci korrigjohet vetëm me diferencën e pagesës.</p>
      <label className="block">Niveli<select aria-label="Niveli i vendimit" value={scope} onChange={e => setScope(e.target.value)} className={input}><option value="market">Përzgjedhje tregu</option><option value="ticket">Biletë individuale</option></select></label>
      {scope === 'ticket' ? <label className="block">Identifikuesi i plotë i biletës<input aria-label="Identifikuesi i biletës" required value={ticketId} onChange={e => setTicketId(e.target.value)} className={input}/></label> : <label className="block">Përzgjedhja<select required aria-label="Përzgjedhja për verifikim" value={selection} onChange={e => setSelection(e.target.value)} className={input}><option value="">Zgjidh tregun dhe rezultatin</option>{selections.map((item: any) => <option key={item.id} value={item.id}>{translateMarketName(item.market.name, t)} {item.market.line} · {translateOutcomeName(item.outcome.name, t, item.market.name, match?.name, item.outcome.key)}</option>)}</select></label>}
      <label className="block">Gjendja<select aria-label="Gjendja e vendimit" value={status} onChange={e => setStatus(e.target.value)} className={input}><option value="PENDING">Në pritje</option><option value="WON">Fituese</option><option value="LOST">Humbëse</option></select></label>
      <label className="block">Arsyeja<textarea aria-label="Arsyeja e vendimit" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} className={input}/></label>
      <label className="block">Burimi i verifikimit<input aria-label="Burimi i verifikimit" required maxLength={500} value={source} onChange={e => setSource(e.target.value)} className={input}/></label>
      <button disabled={busy} className="bg-accent-green text-primary font-bold rounded-lg px-4 py-2 disabled:opacity-50">{busy ? 'Duke ruajtur…' : 'Ruaj vendimin manual'}</button>
    </form>
  </div>;
}
