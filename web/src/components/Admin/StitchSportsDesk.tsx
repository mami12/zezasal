import { useEffect, useState, type ReactNode } from 'react';
import { apiClient } from '../../api/client';
import ManualReviewQueue from './ManualReviewQueue';
import './stitchSportsDesk.css';

type Review = { lineId: string; matchId: string; marketKey: string; marketLine: string; matchName: string; marketName: string; outcomeName: string; notificationActive: boolean; reason: string };
type LivePreview = {
 line_id:string; match_name:string; market_name:string; outcome_name:string;
 proposed_status:'WON'|'LOST'|'VOID'; timelineCheck:'AGREES'|'DIFFERS'|'INSUFFICIENT';
 payload?:{contract?:{kind:string;event:string;from?:number;to?:number};frame?:{source?:string;clock?:number;events?:Array<{id:string;type:string;minute:number;team:string}>}};
};
const statusName = {WON:'Fituese',LOST:'Humbëse',VOID:'E pavlefshme'};
const eventName:Record<string,string> = {goal:'Gol',corner:'Korner',card:'Karton',foul:'Faull'};
type DeskSection = { id: string; title: string; panel: () => ReactNode };
type Overview = {
 database: 'ready';
 accounts: { player: number; manager: number; agent: number; admin: number };
 tickets: { total: number; pending: number; won: number; lost: number; void: number; openStake: number; settledStake: number; paidOut: number; netBeforeCommission: number };
 matches: { live: number; prematch: number };
 transactions: { sport: number; total: number };
};
const formatNumber = new Intl.NumberFormat('sq-AL');
const formatMoney = new Intl.NumberFormat('sq-AL', {style:'currency',currency:'ALL',maximumFractionDigits:2});
const pauseReasons = new Set(['MISSING_EVENT_TIMELINE','MISSING_MARKET_STATISTICS','CONFLICTING_API_STATISTICS']);
const marketIdFor = (item:Review) => [item.matchId,item.marketKey,item.marketLine??''].join('|');
const explanations: Record<string,string> = {
 MISSING_EVENT_TIMELINE: 'Na mungon lista që tregon kur ndodhën golat ose kornerat. Pa atë listë s’e dimë si del ky bast.',
 CONFLICTING_API_STATISTICS: 'Dy burime japin numra të ndryshëm. Duhet të kontrollojmë cili është i saktë.',
 MISSING_MARKET_STATISTICS: 'Na mungon numri që kërkon ky bast, për shembull sa goditje pati në portë.',
 MISSING_FINAL_RESULT: 'Mungon rezultati përfundimtar i konfirmuar.',
 VOID_NEEDS_CONFIRMATION: 'Anulimi kërkon kontroll.',
};

export default function StitchSportsDesk({sections}:{sections:DeskSection[]}) {
 const [items,setItems]=useState<Review[]>([]);
 const [error,setError]=useState(false);
 const [livePreviews,setLivePreviews]=useState<LivePreview[]>([]);
 const [previewError,setPreviewError]=useState(false);
 const [overview,setOverview]=useState<Overview|null>(null);
 const [overviewError,setOverviewError]=useState(false);
 const [checking,setChecking]=useState(true);
 const [refreshKey,setRefreshKey]=useState(0);
 const [updatedAt,setUpdatedAt]=useState<Date|null>(null);
 const [active,setActive]=useState('');
 const [pause,setPause]=useState<Review|null>(null);
 const [actionBusy,setActionBusy]=useState(false);
 const [actionMessage,setActionMessage]=useState('');
 const [review,setReview]=useState<string|null>(null);
 useEffect(()=>{
  let mounted=true;
  let inFlight=false;
  async function refresh(){
   if(inFlight)return;
   inFlight=true;
   setChecking(true);
   try {
    const [noticesResult,overviewResult,previewResult]=await Promise.allSettled([
     apiClient.get('/admin/settlement-review-queue',{params:{limit:100}}),
     apiClient.get<Overview>('/admin/stitch-overview'),
     apiClient.get<{previews:LivePreview[]}>('/admin/live-event-test'),
    ]);
    if(!mounted)return;
    setError(noticesResult.status==='rejected');
    if(noticesResult.status==='fulfilled'){
     const {data}=noticesResult.value;
     setItems(Array.isArray(data.items)?data.items:[]);
    }
    setPreviewError(previewResult.status==='rejected');
    if(previewResult.status==='fulfilled')setLivePreviews(Array.isArray(previewResult.value.data.previews)?previewResult.value.data.previews:[]);
    setOverviewError(overviewResult.status==='rejected');
    if(overviewResult.status==='fulfilled'){
     setOverview(overviewResult.value.data);
     setUpdatedAt(new Date());
    }
   }finally{
    inFlight=false;
    if(mounted)setChecking(false);
   }
  }
  void refresh();
  const timer=window.setInterval(()=>void refresh(),15000);
  return ()=>{mounted=false;window.clearInterval(timer);};
 },[refreshKey]);
 async function approvePause(item:Review){
  if(actionBusy)return;
  setActionBusy(true);
  setActionMessage('');
  try{
   const [fixture,queue]=await Promise.all([
    apiClient.get('/admin/matches/'+encodeURIComponent(item.matchId)),
    apiClient.get('/admin/settlement-review-queue',{params:{limit:100}}),
   ]);
   const current=(Array.isArray(queue.data.items)?queue.data.items:[]).find((row:Review)=>row.lineId===item.lineId);
   const marketId=marketIdFor(item);
   const match=fixture.data.item;
   const market=Array.isArray(match?.markets)?match.markets.find((row:{id:string;status:string})=>row.id===marketId):null;
   if(!current||!pauseReasons.has(current.reason)||marketIdFor(current)!==marketId||String(match?.id)!==item.matchId||market?.status!=='ACTIVE'){
    setPause(null);
    setActionMessage('Gjendja ka ndryshuar. Kontrolloje tregun përsëri para se ta pezullosh.');
    setRefreshKey(key=>key+1);
    return;
   }
   const result=await apiClient.patch('/admin/markets/'+encodeURIComponent(marketId)+'/suspend',{status:'SUSPENDED'});
   if(result.data?.suspended!==true)throw new Error('Pezullimi nuk u konfirmua');
   setPause(null);
   setActionMessage('Tregu u pezullua për baste të reja. Bileta e pranuar më parë mbetet për kontroll.');
   setReview(item.lineId);
   setActive('');
   setRefreshKey(key=>key+1);
  }catch{
   setActionMessage('Pezullimi nuk u konfirmua. Rifresko gjendjen dhe provo përsëri.');
  }finally{setActionBusy(false);}
 }
 const notices=items.filter(item=>item.notificationActive);
 const olderReviews=items.length-notices.length;
 const mascotState=checking?'checking':error||overviewError||previewError||items.length||livePreviews.length?'alert':'idle';
 const section=sections.find(item=>item.id===active);
 return <section className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6" aria-labelledby="stitch-heading">
  <header className="flex items-center gap-4 rounded-xl border border-tertiary bg-secondary p-4">
   <svg viewBox="0 0 120 100" className="h-20 w-24 shrink-0 overflow-visible" role="img" aria-label="Maskota blu e Stitch">
    <g className="stitch-mascot" data-state={mascotState}>
     <g className="stitch-ear">
      <path d="M39 43Q8 8 4 26Q1 54 35 63Z" fill="#5488dc" stroke="#1e3976" strokeWidth="3"/>
      <path d="M30 51Q12 27 10 32Q12 48 30 55" fill="#d799cd"/>
     </g>
     <g className="stitch-ear stitch-ear-right">
      <path d="M81 43Q112 8 116 26Q119 54 85 63Z" fill="#5488dc" stroke="#1e3976" strokeWidth="3"/>
      <path d="M90 51Q108 27 110 32Q108 48 90 55" fill="#d799cd"/>
     </g>
     <ellipse cx="60" cy="59" rx="35" ry="28" fill="#5488dc" stroke="#1e3976" strokeWidth="3"/>
     <g className="stitch-eyes"><ellipse cx="44" cy="55" rx="11" ry="13" fill="#a7d7ff"/><ellipse cx="76" cy="55" rx="11" ry="13" fill="#a7d7ff"/>
     <circle cx="45" cy="56" r="6" fill="#172b54"/><circle cx="75" cy="56" r="6" fill="#172b54"/></g>
     <ellipse cx="60" cy="66" rx="9" ry="6" fill="#263d79"/><path d="M50 75Q60 83 70 75" fill="none" stroke="#263d79" strokeWidth="3" strokeLinecap="round"/>
    </g>
   </svg>
   <div className="min-w-0 flex-1">
    <h2 id="stitch-heading" className="text-lg font-bold">Stitch · Sportbastet</h2>
    <p className="text-sm">{checking?'Duke kontrolluar…':error||overviewError||previewError?'Disa të dhëna nuk u rifreskuan.':items.length||livePreviews.length?'Ka përzgjedhje për kontroll.':'Kontrolli i fundit përfundoi.'}</p>
    <button type="button" disabled={checking} onClick={()=>setRefreshKey(key=>key+1)} className="mt-2 min-h-11 rounded-lg border border-tertiary px-3 disabled:opacity-50">Rifresko</button>
   </div>
  </header>
  {overviewError&&<p role="alert">Përmbledhja nuk u rifreskua. Të dhënat e fundit mund të jenë të vjetruara.</p>}
  {overview&&<section aria-label="Përmbledhja e sportbasteve" className="space-y-2">
   <div className="flex flex-wrap items-baseline justify-between gap-2">
    <h3 className="font-bold">Përmbledhja e sportbasteve</h3>
    {updatedAt&&<span className="text-xs">Përditësuar {updatedAt.toLocaleTimeString('sq-AL')}</span>}
   </div>
   <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
    <div className="rounded-xl border border-tertiary bg-secondary p-3">
     <dt className="font-semibold">Llogaritë e regjistruara</dt>
     <dd>{formatNumber.format(overview.accounts.player)} lojtarë · {formatNumber.format(overview.accounts.manager)} menaxherë</dd>
     <dd>{formatNumber.format(overview.accounts.agent)} agjentë · {formatNumber.format(overview.accounts.admin)} administratorë</dd>
    </div>
    <div className="rounded-xl border border-tertiary bg-secondary p-3">
     <dt className="font-semibold">Biletat sportive</dt>
     <dd>{formatNumber.format(overview.tickets.pending)} në pritje · {formatNumber.format(overview.tickets.total)} gjithsej</dd>
     <dd>{formatNumber.format(overview.tickets.won)} fituese · {formatNumber.format(overview.tickets.lost)} humbëse · {formatNumber.format(overview.tickets.void)} të pavlefshme</dd>
    </div>
    <div className="rounded-xl border border-tertiary bg-secondary p-3">
     <dt className="font-semibold">Shlyerjet sportive</dt>
     <dd>{formatMoney.format(overview.tickets.openStake)} në pritje</dd>
     <dd>{formatMoney.format(overview.tickets.settledStake)} të shlyera · {formatMoney.format(overview.tickets.paidOut)} të paguara</dd>
     <dd>{formatMoney.format(overview.tickets.netBeforeCommission)} neto para komisioneve</dd>
    </div>
    <div className="rounded-xl border border-tertiary bg-secondary p-3">
     <dt className="font-semibold">Ndeshjet në burim</dt>
     <dd>{formatNumber.format(overview.matches.live)} live · {formatNumber.format(overview.matches.prematch)} para fillimit</dd>
    </div>
    <div className="rounded-xl border border-tertiary bg-secondary p-3">
     <dt className="font-semibold">Transaksione sportive</dt>
     <dd>{formatNumber.format(overview.transactions.sport)} të regjistruara</dd>
    </div>
    <div className="rounded-xl border border-tertiary bg-secondary p-3">
     <dt className="font-semibold">Databaza</dt><dd>{overviewError?'Gjendja aktuale e pakonfirmuar':'Lidhja e verifikuar'}</dd>
    </div>
   </dl>
  </section>}
  {actionMessage&&<p role="status">{actionMessage}</p>}
  {pause&&<section aria-label="Miratimi i pezullimit" className="space-y-2 rounded-xl border border-tertiary bg-secondary p-3">
   <h3 className="font-bold">Ta ndalim këtë treg për baste të reja?</h3>
   <p>{pause.matchName} · {pause.marketName} {pause.marketLine}</p>
   <p className="text-sm">Bastet e vendosura mbeten në listë. Duhet ende t’i kontrollojmë.</p>
   <div className="flex flex-wrap gap-2">
    <button type="button" disabled={actionBusy} className="min-h-11 rounded-lg border border-tertiary px-4" onClick={()=>void approvePause(pause)}>Po, pezullo tregun</button>
    <button type="button" disabled={actionBusy} className="min-h-11 rounded-lg border border-tertiary px-4" onClick={()=>setPause(null)}>Jo, lëre tregun</button>
   </div>
  </section>}
  {error&&<p role="alert">Njoftimet nuk u rifreskuan. Prova tjetër bëhet automatikisht.</p>}
  <section className="space-y-2" aria-label="Kontrollet live nga serveri">
   <h3 className="font-bold">Çfarë gjeti serveri ({livePreviews.length})</h3>
   <p className="text-sm">Serveri kontrollon bastet live edhe kur ti s’je në panel. Këtu sheh rezultatin e propozuar dhe provën që ka përdorur.</p>
   {previewError&&<p role="alert">Kontrollet live nuk u rifreskuan. Të dhënat e fundit mund të jenë të vjetruara.</p>}
   {!checking&&!previewError&&!livePreviews.length&&<p className="text-sm">Ende s’ka përzgjedhje live me rezultat të propozuar.</p>}
   {livePreviews.map(item=>{
    const contract=item.payload?.contract,frame=item.payload?.frame;
    const interval=contract?.kind==='window'&&typeof contract.from==='number'&&typeof contract.to==='number'
     ?[contract.from,contract.to] as const:null;
    const events=(frame?.events??[]).filter(event=>event.type===contract?.event&&(!interval||(event.minute>=interval[0]&&event.minute<=interval[1])));
    const reviewable=items.some(row=>row.lineId===item.line_id);
    return <article key={item.line_id} className="space-y-2 rounded-xl border border-tertiary bg-secondary p-3">
     <h4 className="font-semibold">{item.match_name}</h4>
     <p className="text-sm">{item.market_name} · {item.outcome_name}</p>
     {interval&&<p className="text-sm">Minutat që kontrollova · {formatNumber.format(interval[0])} deri në {formatNumber.format(interval[1])}</p>}
     <p className="text-sm">Serveri propozon <strong>{statusName[item.proposed_status]}</strong>.</p>
     <p className="text-sm">{item.timelineCheck==='AGREES'
      ? 'E kontrollova përsëri me listën e ngjarjeve. Më doli i njëjti rezultat.'
      : item.timelineCheck==='DIFFERS'
       ? 'Lista e ngjarjeve jep rezultat tjetër. Duhet ta shikojmë me dorë.'
       : 'Lista e ngjarjeve nuk mjafton për një kontroll të dytë.'}</p>
     {events.length>0&&<ul className="list-disc pl-5 text-sm">{events.slice(0,12).map(event=><li key={event.id}>
      {eventName[event.type]??event.type}, minuta {formatNumber.format(event.minute)} · {event.team==='home'?'Skuadra vendase':event.team==='away'?'Skuadra mike':'Skuadra e panjohur'}
     </li>)}</ul>}
     {events.length>12&&<p className="text-xs">Po shfaqen 12 nga {events.length} ngjarje.</p>}
     {frame?.source&&<p className="text-xs">Burimi · {frame.source}</p>}
     {reviewable&&<button type="button" className="min-h-11 rounded-lg border border-tertiary px-4" onClick={()=>{setActive('');setReview(item.line_id);}}>Hap për verifikim</button>}
    </article>;
   })}
  </section>
  <section className="space-y-2" aria-label="Njoftime për verifikim">
   <h3 className="font-bold">Për verifikim ({notices.length})</h3>
   {olderReviews>0&&<p className="text-sm">{olderReviews} përzgjedhje nga lista mbeten të hapura edhe pse njoftimi ka skaduar.</p>}
   {!checking&&!error&&!notices.length&&<p className="text-sm">S’ka njoftime aktive në listën e ngarkuar.</p>}
   {notices.map(item=><article key={item.lineId} className="space-y-2 rounded-xl border border-tertiary bg-secondary p-3">
    <h4 className="font-semibold">{item.matchName}</h4>
    <p className="text-sm">{item.marketName} · {item.outcomeName}</p>
    <p className="text-sm">{explanations[item.reason]??'Përzgjedhja kërkon verifikim manual.'}</p>
    <p className="text-sm">Sugjerimi im: kontrollo provën dhe burimin para se të vendosësh për këtë përzgjedhje.</p>
    <button type="button" className="min-h-11 rounded-lg border border-tertiary px-4" onClick={()=>{setActive('');setReview(item.lineId);}}>Kontrollo përzgjedhjen</button>
    {item.matchId&&item.marketKey&&pauseReasons.has(item.reason)&&<button type="button" disabled={actionBusy} className="ml-2 min-h-11 rounded-lg border border-tertiary px-4" onClick={()=>{setActionMessage('');setPause(item);}}>Pezullo këtë treg</button>}
   </article>)}
  </section>
  <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Kontrollet e sportbasteve">
   {sections.map(item=><button key={item.id} type="button" aria-pressed={active===item.id} className="min-h-11 rounded-lg border border-tertiary bg-secondary px-4 text-left" onClick={()=>{setReview(null);setActive(item.id);}}>{item.title}</button>)}
  </nav>
  {review&&<ManualReviewQueue key={review} onlyLineId={review} onSaved={()=>setRefreshKey(key=>key+1)}/>}
  {section&&<div key={section.id}>{section.panel()}</div>}
 </section>;
}
