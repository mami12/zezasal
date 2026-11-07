import { useLanguage } from '../../context/LanguageContext';
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, RefreshCw, Search, Wallet, Dices, Trophy } from 'lucide-react';
import { apiClient } from '../../api/client';
import {transactionLabel,transactionDescription} from '../../utils/accountLabels';

type PlayerFinance = {
  id:string;username:string;balance:number;sportTurnover:number;sportPending:number;
  sportStake:number;sportPayout:number;sportNet:number;sportCount:number;
  casinoStake:number;casinoPayout:number;casinoNet:number;casinoSpins:number;net:number;
};
type Transaction = {id:string;amount:number;type:string;description:string|null;balanceAfter:number;createdAt:string};
type CasinoRound={id:string;gameId:string;gameVersion:string;stake:number;payout:number;balanceAfter:number;net:number;createdAt:string};
type Report = {players:PlayerFinance[];totals:Omit<PlayerFinance,'id'|'username'|'balance'>;transactions:Transaction[];rounds:CasinoRound[];truncated:boolean};
type Filter = 'all'|'sport'|'casino';
function SummaryCard({title,value,caption}:{title:string;value:number;caption?:string}){
  const { t, lang } = useLanguage();
  const formattedValue = Number(value||0).toLocaleString(lang==='en'?'en-GB':'sq-AL',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+t('Lëk');
  return <div className="rounded-xl border border-tertiary bg-secondary p-3 sm:p-4">
    <div className="text-xs font-medium text-text-secondary">{t(title)}</div>
    <div className={'mt-2 break-words text-lg sm:text-xl font-black tabular-nums '+(value<0?'text-rose-400':'text-white')}>{value>0&&title.includes('Neto')?'+':''}{formattedValue}</div>
    {caption&&<div className="mt-1 text-[11px] text-text-secondary">{t(caption)}</div>}
  </div>;
}
export default function CasinoFinanceCenter({role,initialUserId}:{role:'admin'|'manager';initialUserId?:string}){
  const { t, lang } = useLanguage();
  const locale = lang==='en'?'en-GB':'sq-AL';
  const fmt=(value:number)=>Number(value||0).toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2})+' '+t('Lëk');
  const stamp=(text:string)=>new Date(text).toLocaleString(locale);
  const [report,setReport]=useState<Report|null>(null);
  const [detail,setDetail]=useState<Transaction[]>([]);
  const [rounds,setRounds]=useState<CasinoRound[]>([]);
  const [selected,setSelected]=useState(initialUserId||'');
  const [category,setCategory]=useState<Filter>('all');
  const [from,setFrom]=useState(''),[to,setTo]=useState('');
  const [search,setSearch]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const endpoint='/'+role+'/casino/finance';
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    try{
      const result=await apiClient.get<Report>(endpoint,{params:{from:from||undefined,to:to||undefined}});
      setReport(result.data);
    }catch(e:any){setError(e.response?.data?.message||'Nuk u ngarkua raporti financiar');}
    finally{setBusy(false);}
  },[endpoint,from,to]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(initialUserId)setSelected(initialUserId);},[initialUserId]);
  useEffect(()=>{
    if(!selected){setDetail([]);setRounds([]);return;}
    let cancelled=false;
    void apiClient.get<Report>(endpoint,{params:{userId:selected,from:from||undefined,to:to||undefined}})
      .then(res=>{if(!cancelled){setDetail(res.data.transactions);setRounds(res.data.rounds||[]);}})
      .catch(()=>{if(!cancelled){setDetail([]);setRounds([]);}});
    return()=>{cancelled=true;};
  },[endpoint,selected,from,to]);
  const visible=(report?.players||[]).filter(p=>p.username.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const player=report?.players.find(p=>p.id===selected);
  const numbers=player||report?.totals;
  const stake=category==='sport'?numbers?.sportStake:category==='casino'?numbers?.casinoStake:(numbers?.sportStake||0)+(numbers?.casinoStake||0);
  const payout=category==='sport'?numbers?.sportPayout:category==='casino'?numbers?.casinoPayout:(numbers?.sportPayout||0)+(numbers?.casinoPayout||0);
  const net=Number((Number(payout||0)-Number(stake||0)).toFixed(2));
  const txFiltered=detail.filter(tx=>category==='all'||
    (category==='casino'?tx.type.startsWith('CASINO_'):
      tx.type.startsWith('BET_')||tx.type.startsWith('TICKET_')));
  const cards=[
    ['Fonde të luajtura',Number(stake||0),'Vetëm bastet e përfunduara'],
    ['Pagesa fituese',Number(payout||0),'Shumat e kthyera nga fitoret'],
    ['Neto i lojtarit',net,'Pozitiv = lojtari ka fituar'],
    ['Neto i operatorit',-net,'Pozitiv = diferencë për operatorin'],
  ] as const;
  return <section className="mx-auto max-w-7xl space-y-4 px-3 pb-10 pt-5 sm:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-black text-white">{t("Financat · Sport & Kazino")}</h2>
        <p className="mt-1 text-xs text-text-secondary">{t("Një bilanc i përbashkët. Raportet e aktivitetit ndahen sipas produktit.")}</p>
      </div>
      <button type="button" onClick={()=>void load()} disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-tertiary bg-secondary px-3 py-2.5 text-sm text-white disabled:opacity-50">
        <RefreshCw size={15} className={busy?'animate-spin':''}/> {" " + t("Rifresko")}</button>
    </div>
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-tertiary bg-secondary p-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="space-y-1 text-xs text-text-secondary"><span>{t("Nga data")}</span><input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="block w-full rounded-lg border border-tertiary bg-primary p-2.5 text-white"/></label>
      <label className="space-y-1 text-xs text-text-secondary"><span>{t("Deri më")}</span><input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)} className="block w-full rounded-lg border border-tertiary bg-primary p-2.5 text-white"/></label>
      <label className="space-y-1 text-xs text-text-secondary"><span>{t("Kërko përdorues")}</span><span className="relative block"><Search className="absolute left-3 top-3" size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={t("Emri i lojtarit")} className="w-full rounded-lg border border-tertiary bg-primary p-2.5 pl-10 text-white"/></span></label>
      <label className="space-y-1 text-xs text-text-secondary"><span>{t("Llogaria")}</span><select value={selected} onChange={e=>setSelected(e.target.value)} className="block w-full rounded-lg border border-tertiary bg-primary p-2.5 text-white"><option value="">{t("Të gjithë përdoruesit")}</option>{visible.map(p=><option key={p.id} value={p.id}>{p.username}</option>)}</select></label>
    </div>
    <div role="group" aria-label={t("Filtro aktivitetin")} className="flex flex-wrap gap-2">
      {([['all',t("Të gjitha"),Wallet],['sport',t("Sport"),Trophy],['casino',t("Kazino"),Dices]] as const).map(([id,label,Icon])=>
        <button key={id} type="button" onClick={()=>setCategory(id)} aria-pressed={category===id}
          className={'flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold '+(category===id?'border-emerald-400 bg-emerald-500/15 text-emerald-300':'border-tertiary bg-secondary text-text-secondary')}>
          <Icon size={16}/>{label}
        </button>)}
    </div>
    {error&&<p role="alert" className="rounded-lg border border-rose-500/40 p-3 text-rose-300">{t(error)}</p>}
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 sm:gap-3">
      {cards.map(([title,value,caption])=><SummaryCard key={title} title={title} value={value} caption={caption}/>)}
    </div>
    {player&&<div className="flex flex-wrap gap-4 rounded-lg border border-tertiary bg-secondary p-3 text-sm text-text-secondary">
      <span>{t("Lojtari:") + " "}<strong className="text-white">{player.username}</strong></span>
      <span>{t("Bilanci aktual:") + " "}<strong className="text-amber-300">{fmt(player.balance)}</strong></span>
      <span>{t("Baste në pritje:") + " "}<strong className="text-white">{fmt(player.sportPending)}</strong></span>
      <span>{t("Rrotullime:") + " "}<strong className="text-white">{player.casinoSpins}</strong></span>
      <span>{t("RTP i vëzhguar:") + " "}<strong className="text-white">{player.casinoStake>0?(100*player.casinoPayout/player.casinoStake).toFixed(2)+'%':t('Pa të dhëna')}</strong></span>
    </div>}
    <div className="overflow-hidden rounded-xl border border-tertiary bg-secondary">
      <div className="border-b border-tertiary p-4 font-bold text-white">{t("Përdoruesit (")}{visible.length})</div>
      <div className="grid gap-2 p-3 md:hidden">
        {visible.map(p=><article key={p.id} className="rounded-xl border border-tertiary bg-primary p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><h4 className="break-words font-bold text-white">{p.username}</h4>
              <p className="mt-1 text-xs text-text-secondary">{t("Bilanci:") + " "}{fmt(p.balance)}</p></div>
            <button type="button" onClick={()=>setSelected(p.id)}
              className="min-h-11 shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-300">{t("Detaje")}</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-secondary p-2"><p className="text-text-secondary">{t("Sport")}</p><b className={p.sportNet>=0?'text-emerald-300':'text-rose-300'}>{fmt(p.sportNet)}</b></div>
            <div className="rounded-lg bg-secondary p-2"><p className="text-text-secondary">{t("Kazino")}</p><b className={p.casinoNet>=0?'text-emerald-300':'text-rose-300'}>{fmt(p.casinoNet)}</b></div>
            <div className="rounded-lg bg-secondary p-2"><p className="text-text-secondary">Total</p><b className="text-white">{fmt(p.net)}</b></div>
          </div>
        </article>)}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[660px] text-left text-sm">
          <thead className="bg-primary text-xs text-text-secondary"><tr>
            <th className="p-3">{t("Lojtari")}</th><th className="p-3 text-right">{t("Sport Neto")}</th>
            <th className="p-3 text-right">{t("Kazino Neto")}</th><th className="p-3 text-right">{t("Neto Total")}</th><th className="p-3">{t("Detaje")}</th>
          </tr></thead>
          <tbody className="divide-y divide-tertiary">{visible.map(p=><tr key={p.id} className={selected===p.id?'bg-emerald-500/10':'hover:bg-primary/60'}>
            <td className="p-3 font-semibold text-white">{p.username}</td>
            <td className={'p-3 text-right tabular-nums '+(p.sportNet>=0?'text-emerald-300':'text-rose-300')}>{fmt(p.sportNet)}</td>
            <td className={'p-3 text-right tabular-nums '+(p.casinoNet>=0?'text-emerald-300':'text-rose-300')}>{fmt(p.casinoNet)}</td>
            <td className="p-3 text-right font-bold text-white">{fmt(p.net)}</td>
            <td className="p-3"><button onClick={()=>setSelected(p.id)} className="rounded-lg bg-primary px-3 py-2 font-bold text-emerald-300">{t("Hap financat")}</button></td>
          </tr>)}</tbody>
        </table>
        {!visible.length&&<p className="p-6 text-center text-text-secondary">{t("Nuk ka përdorues për këto filtra.")}</p>}
      </div>
    </div>
    {player&&<div className="overflow-hidden rounded-xl border border-tertiary bg-secondary">
      <div className="border-b border-tertiary p-4"><h3 className="font-bold text-white">{t("Transaksionet ·") + " "}{player.username}</h3><p className="text-xs text-text-secondary">{t("Depozitat dhe transfertat shfaqen në “Të gjitha”, por nuk përfshihen në neton e lojërave.")}</p></div>
      <div className="divide-y divide-tertiary">{txFiltered.length?txFiltered.map(tx=><div key={tx.id} className="grid grid-cols-[1fr_auto] gap-3 p-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="min-w-0"><p className="break-words text-sm font-semibold text-white">{tx.description ? transactionDescription(tx.description,tx.type,lang) : t(transactionLabel(tx.type))}</p><p className="text-xs text-text-secondary">{stamp(tx.createdAt)} · {t(transactionLabel(tx.type))}</p></div>
        <p className="hidden self-center text-xs text-text-secondary sm:block">{t("Bilanci pas:") + " "}{fmt(tx.balanceAfter)}</p>
        <div className={'flex items-center gap-1 self-center font-bold tabular-nums '+(tx.amount>=0?'text-emerald-300':'text-rose-300')}>
          {tx.amount>=0?<ArrowUpRight size={15}/>:<ArrowDownRight size={15}/>}
          {fmt(tx.amount)}
        </div>
      </div>):<p className="p-5 text-sm text-text-secondary">{t("Nuk ka transaksione për kategorinë e zgjedhur.")}</p>}</div>
      {detail.length>=300&&<p className="p-3 text-xs text-amber-300">{t("Po shfaqen 300 transaksionet më të fundit për intervalin.")}</p>}
    </div>}
    {player&&category!=='sport'&&<div className="overflow-hidden rounded-xl border border-tertiary bg-secondary">
      <div className="border-b border-tertiary p-4">
        <h3 className="font-bold text-white">{t("Historia e lojërave të kazinosë ·") + " "}{player.username}</h3>
        <p className="text-xs text-text-secondary">{t("Çdo raund lidhet me një pagesë dhe një bilanc në databazë.")}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-primary text-xs text-text-secondary">
            <tr><th className="p-3 text-left">{t("Koha / Loja")}</th><th className="p-3 text-right">{t("Basti")}</th>
            <th className="p-3 text-right">{t("Fitimi")}</th><th className="p-3 text-right">{t("Diferenca")}</th>
            <th className="p-3 text-right">{t("Bilanci pas")}</th></tr>
          </thead>
          <tbody className="divide-y divide-tertiary">{rounds.map(r=><tr key={r.id}>
            <td className="p-3"><div className="font-semibold text-white">{r.gameId}</div>
              <div className="text-xs text-text-secondary">{stamp(r.createdAt)}</div></td>
            <td className="p-3 text-right text-white">{fmt(r.stake)}</td>
            <td className="p-3 text-right text-white">{fmt(r.payout)}</td>
            <td className={'p-3 text-right font-semibold '+(r.net>=0?'text-emerald-300':'text-rose-300')}>{fmt(r.net)}</td>
            <td className="p-3 text-right text-text-secondary">{fmt(r.balanceAfter)}</td>
          </tr>)}</tbody>
        </table>
        {!rounds.length&&<p className="p-5 text-sm text-text-secondary">{t("Nuk ka raunde kazinoje për këtë periudhë.")}</p>}
      </div>
      {rounds.length>=300&&<p className="p-3 text-xs text-amber-300">{t("Po shfaqen 300 raundet më të fundit.")}</p>}
    </div>}
    {report?.truncated&&<p className="text-xs text-amber-300">{t("Raporti ka kufi 2000 përdorues. Përdor filtër më të ngushtë për eksport të plotë.")}</p>}
  </section>;
}
