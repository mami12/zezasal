import { useLanguage } from '../../context/LanguageContext';
import { useEffect, useRef, useState } from 'react';
import { Dices, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { apiClient } from '../../api/client';
import {casinoPercent as percent, casinoStakeLimits, casinoControlLimits, casinoHitCompatibility, CASINO_CONTROLS_UNRESTRICTED, type CasinoSettingsData as Settings, type CasinoGameSettings} from '../../types/casino';
import {userError} from '../../utils/userError';

type Totals={casinoStake:number;casinoPayout:number;casinoSpins:number};
type Draft={mode:'original'|'custom';rtp:string;hitFrequency:string};
const toDraft=(game:CasinoGameSettings):Draft=>({mode:game.controls?.mode??'original',rtp:String(game.controls?.rtp??game.effectiveRtp??game.theoreticalRtp??95),hitFrequency:String(game.controls?.hitFrequency??10)});
const draftError=(draft:Draft,game:CasinoGameSettings,en=false)=>{
 if(draft.mode!=='custom')return '';
 const tr=(sq:string,english:string)=>en?english:sq;
 const rtp=Number(draft.rtp),hit=Number(draft.hitFrequency),limits=casinoControlLimits(game);
 if(draft.rtp.trim()===''||draft.hitFrequency.trim()===''||!Number.isFinite(rtp)||!Number.isFinite(hit)||rtp<0||rtp>limits.rtp.max||hit<0||hit>limits.hitFrequency.max)return tr(`RTP duhet të jetë nga 0% deri në ${limits.rtp.max}%; shpeshtësia nga 0% deri në ${limits.hitFrequency.max}%.`,`RTP must be between 0% and ${limits.rtp.max}%; hit frequency between 0% and ${limits.hitFrequency.max}%.`);
 if([rtp,hit].some(value=>Math.abs(value*100-Math.round(value*100))>1e-7))return tr('Përdor deri në dy shifra pas presjes për përqindjet.','Use up to two decimal places for percentages.');
 if((rtp===0)!==(hit===0))return tr('Për RTP 0% vendos edhe shpeshtësinë e fitimit 0%. Për RTP mbi 0%, shpeshtësia e fitimit duhet të jetë mbi 0%.','For 0% RTP, set hit frequency to 0% too. Above 0% RTP, hit frequency must also be above 0%.');
 const bounds=game.customLimits,compatibility=casinoHitCompatibility(game,rtp);
 if(!CASINO_CONTROLS_UNRESTRICTED&&rtp>0&&bounds&&compatibility&&(rtp/hit<bounds.minWinMultiplier||rtp/hit>bounds.maxWinMultiplier)){
  if(!compatibility.available)return tr('Ky RTP është tepër i ulët për një shpeshtësi të vlefshme me dy shifra pas presjes. Rrite RTP-në ose përdor 0% / 0%.','This RTP is too low for a valid hit frequency with two decimal places. Increase RTP or use 0% / 0%.');
  if(hit===100&&rtp<compatibility.minRtpForFullHit)return tr(`Me shpeshtësi 100%, kjo lojë kërkon RTP të paktën ${compatibility.minRtpForFullHit}%. Rrite RTP-në ose ul shpeshtësinë.`,`At 100% hit frequency, this game needs at least ${compatibility.minRtpForFullHit}% RTP. Increase RTP or lower hit frequency.`);
  return tr(`Për RTP ${rtp}%, shpeshtësia e vlefshme është ${compatibility.minHit}%–${compatibility.maxHit}%.`,`For ${rtp}% RTP, valid hit frequency is ${compatibility.minHit}%–${compatibility.maxHit}%.`);
 }
 return '';
};

export default function CasinoSettings(){
  const { t,lang } = useLanguage();
 const en=lang==='en',tr=(sq:string,english:string)=>en?english:sq;
 const [managerId,setManagerId]=useState(''),[managers,setManagers]=useState<{id:string;username:string;role?:string}[]>([]),[commission,setCommission]=useState('0');
 const [data,setData]=useState<Settings|null>(null),[totals,setTotals]=useState<Totals|null>(null);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [selected,setSelected]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const loadSequence=useRef(0);
 const load=async()=>{
  const sequence=++loadSequence.current;
  setBusy(true);setError('');
  try{
   const [settings,finance]=await Promise.all([apiClient.get<Settings>('/admin/casino/settings',{params:managerId?{managerId}:undefined}),apiClient.get<{totals:Totals}>('/admin/casino/finance')]);
   if(sequence!==loadSequence.current)return;
   setData(settings.data);setCommission(String(settings.data.casinoCommission??0));setTotals(finance.data.totals);
   setSelected(Object.fromEntries(settings.data.games.map(game=>[game.gameId,game.profile??game.profiles[0]?.id??''])));
   setDrafts(Object.fromEntries(settings.data.games.map(game=>[game.gameId,toDraft(game)])));
  }catch(e:any){if(sequence===loadSequence.current)setError(userError(e.response?.data?.message||e.message,'Nuk u ngarkuan cilësimet.'));}finally{if(sequence===loadSequence.current)setBusy(false);}
 };
 useEffect(()=>{void apiClient.get('/admin/casino/managers').then(r=>setManagers(r.data)).catch(()=>{});},[]);
 useEffect(()=>{setData(null);void load();},[managerId]);
 const save=async(gameId:string)=>{
  const draft=drafts[gameId];
  if(!draft)return;
  const previous=data?.games.find(item=>item.gameId===gameId);
  if(!previous)return;
  const invalid=draftError(draft,previous,en);
  if(invalid){setError(invalid);return;}
  setBusy(true);setError('');
  try{
   if(draft.mode==='original'&&selected[gameId]!==previous?.profile){
    const profileResponse=await apiClient.patch<Settings>('/admin/casino/profile',{gameId,profile:selected[gameId],...(managerId?{managerId}:{})});
    setData(profileResponse.data);
   }
   if(draft.mode==='original'&&!previous.supportsCustomMath)return;
   const response=await apiClient.patch<Settings>('/admin/casino/controls',{gameId,mode:draft.mode,rtp:Number(draft.rtp),hitFrequency:Number(draft.hitFrequency),...(managerId?{managerId}:{})});
   setData(response.data);
   const game=response.data.games.find(item=>item.gameId===gameId);
   if(game){
    if(game.profile)setSelected(previous=>({...previous,[gameId]:game.profile!}));
    setDrafts(previous=>({...previous,[gameId]:toDraft(game)}));
   }
  }catch(e:any){setError(userError(e.response?.data?.message||e.message,'Profili nuk u ruajt.'));}finally{setBusy(false);}
 };
 const change=async()=>{
  if(!data)return;setBusy(true);setError('');
  try{const response=await apiClient.patch<Settings>('/admin/casino/settings',{enabled:!data.enabled});setData(response.data);}
  catch(e:any){setError(userError(e.response?.data?.message||e.message,'Ndryshimi nuk u ruajt.'));}finally{setBusy(false);}
 };

 const toggleGameVisibility = async (gameId: string, hidden: boolean) => {
  setBusy(true); setError('');
  try {
   const response = await apiClient.patch<Settings>('/admin/casino/toggle-game', { gameId, hidden });
   setData(response.data);
  } catch (e: any) {
   setError(userError(e.response?.data?.message || e.message, 'Ndryshimi i dukshmërisë së lojës nuk u ruajt.'));
  } finally {
   setBusy(false);
  }
 };
 return <section className="mx-auto max-w-5xl space-y-4 px-3 pb-10 pt-5 sm:px-6">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-xl font-black text-white">{t("Cilësimet e Kazinosë")}</h2><p className="mt-1 text-sm text-text-secondary">{t("Profilet e lojërave dhe portofoli i përbashkët.")}</p></div>
   <button onClick={()=>void load()} disabled={busy} className="flex min-h-11 items-center gap-2 rounded-lg border border-tertiary bg-secondary px-3 py-2 text-sm font-semibold text-white"><RefreshCw size={16}/>{t("Rifresko")}</button>
  </div>
  <div className="rounded-xl border border-tertiary bg-secondary p-4 space-y-3"><label className="block text-sm text-white">Cilësimet për — agjenti ka përparësi<select aria-label="Menaxheri ose agjenti i kazinosë" disabled={busy} value={managerId} onChange={e=>setManagerId(e.target.value)} className="mt-2 w-full rounded-lg border border-tertiary bg-primary p-3"><option value="">Globale — të gjithë menaxherët</option>{managers.map(manager=><option key={manager.id} value={manager.id}>{manager.username} ({manager.role==='AGENT'?'Agjent':'Menaxher'})</option>)}</select></label><label className="block text-sm text-white">Komisioni kazino / Apex (%)<input aria-label="Komisioni i kazinosë" type="number" min="0" max="100" step="0.01" value={commission} onChange={e=>setCommission(e.target.value)} className="mt-2 w-full rounded-lg border border-tertiary bg-primary p-3"/></label><button disabled={busy||!data||commission.trim()===''||!Number.isFinite(Number(commission))||Number(commission)<0||Number(commission)>100} className="rounded-lg bg-accent-green px-4 py-2 font-bold text-primary disabled:opacity-50" onClick={async()=>{setBusy(true);setError('');try{const r=await apiClient.patch<Settings>('/admin/casino/commission',{commission:Number(commission),...(managerId?{managerId}:{})});setData(r.data);setCommission(String(r.data.casinoCommission));}catch(e:any){setError(userError(e,'Komisioni nuk u ruajt.'));}finally{setBusy(false);}}}>Ruaj komisionin</button><p className="text-xs text-text-secondary">Komisioni regjistrohet mbi bastin e raundit, si raport për shlyerje manuale. Bilancet nuk ndryshohen nga ky cilësim.</p></div>
  {error&&<p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-rose-200">{error}</p>}
  {data?.warning&&<p className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">{data.warning}</p>}
  <div className="rounded-xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h3 className="font-bold text-white">{t("Lejo lojërat me bilancin e përdoruesit")}</h3><p className="mt-1 text-xs text-text-secondary">{t("I njëjti bilanc si te bastet sportive.")}</p></div>
    <button type="button" disabled={!data||busy||!!managerId} onClick={()=>void change()} className={'min-h-11 rounded-lg px-5 py-2 font-bold disabled:opacity-50 '+(data?.enabled?'bg-rose-500 text-white':'bg-emerald-500 text-slate-950')}>{data?.enabled?'Çaktivizo':'Aktivizo'}</button>
   </div>
   <p className="mt-4 text-sm text-text-secondary">Profili zbatohet te të gjithë lojtarët e nivelit të zgjedhur, nga raundi tjetër me pagesë. Cilësimi i agjentit ka përparësi ndaj menaxherit; më pas trashëgohen cilësimet globale. Bonusët dhe fitimet ekzistuese ruajnë kushtet e tyre.</p>
   <p className="mt-2 text-sm text-text-secondary">{t("RTP është kthimi mesatar afatgjatë. Shpeshtësia e fitimit është përqindja e rrotullimeve me pagesë që kthejnë një shumë mbi zero, duke përfshirë bonusin e atij rrotullimi, përpara dyfishimit opsional të fitimit. Edhe një kthim më i vogël se basti llogaritet si rrotullim që paguan.")}</p>
   <p className="mt-2 text-sm text-text-secondary">{tr('RTP mund të jetë mbi 100%: p.sh. 200% do të thotë kthim mesatar 200 lekë për çdo 100 lekë të luajtura. Shpeshtësia 100% do të thotë pagesë mbi zero në çdo raund; nuk garanton fitim mbi bastin çdo herë.','RTP can exceed 100%: for example, 200% means an average return of 200 ALL per 100 ALL wagered. A 100% hit frequency means every round pays more than zero; it does not guarantee a profit on every round.')}</p>
   <p className="mt-2 text-sm text-text-secondary">{t("Modaliteti origjinal përdor profilin e motorit. Modaliteti i personalizuar zbaton vetëm çifte RTP dhe shpeshtësie që realizohen nga tabela reale e pagesave. Shpeshtësia është probabilitet dhe nuk mund të kalojë 100%.")}</p>
   {data?.stakeLimits&&<p className="mt-3 font-semibold text-white">{t("Basti për të gjitha lojërat:") + " "}{casinoStakeLimits(data.stakeLimits)}.</p>}
   
  </div>

  {/* Quick Visibility Management Section */}
  <div className="rounded-2xl border border-purple-500/20 bg-secondary/95 p-4 shadow-lg sm:p-5">
   <div className="mb-3">
    <h3 className="flex items-center gap-2 text-base font-bold text-white">
     <Eye size={18} className="text-purple-300" />
     <span>{t("Aktivizimi dhe Fshehja e Lojërave të Kazinosë")}</span>
    </h3>
    <p className="mt-1 text-xs text-text-secondary">
     {t("Kliko mbi çdo lojë për ta shfaqur ose fshehur menjëherë nga kazinoja e lojtarëve.")}
    </p>
   </div>
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
    {(data?.games??[]).map(game => {
     const isHidden = Boolean(game.hidden || data?.hiddenGames?.includes(game.gameId));
     return (
      <button
       key={game.gameId}
       type="button"
       disabled={busy}
       onClick={() => void toggleGameVisibility(game.gameId, !isHidden)}
       className={`flex flex-col items-center justify-between gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
        isHidden
         ? 'border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
         : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
       }`}
      >
       <span className="truncate text-xs font-bold text-white w-full">{game.title}</span>
       <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${
        isHidden ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
       }`}>
        {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
        <span>{isHidden ? 'E Fshehur' : 'Aktive'}</span>
       </span>
      </button>
     );
    })}
   </div>
  </div>

  <div className="grid gap-4 md:grid-cols-2">
   {(data?.games??[]).map(game=>{
    const id=selected[game.gameId]??'',index=game.profiles.findIndex(profile=>profile.id===id);
    const choice=game.profiles[index],supported=index>=0;
    const draft=drafts[game.gameId]??toDraft(game),invalid=draftError(draft,game,en),limits=casinoControlLimits(game),compatibility=casinoHitCompatibility(game,Number(draft.rtp));
    const original=toDraft(game),changed=draft.mode!==original.mode||draft.rtp!==original.rtp||draft.hitFrequency!==original.hitFrequency||(draft.mode==='original'&&id!==game.profile);
    const edit=(patch:Partial<Draft>)=>setDrafts(previous=>({...previous,[game.gameId]:{...draft,...patch}}));
    const isHidden = Boolean(game.hidden || data?.hiddenGames?.includes(game.gameId));
    return <article key={game.gameId} className="space-y-4 rounded-xl border border-tertiary bg-secondary p-4 sm:p-5">
     <div className="flex flex-wrap items-center justify-between gap-2 border-b border-tertiary/60 pb-3">
      <div className="min-w-0">
       <h3 className="flex items-center gap-2 font-bold text-white truncate"><Dices size={19} className="text-amber-300 shrink-0"/>{game.title}</h3>
       <p className="mt-0.5 text-xs text-text-secondary">{t("Aktive:") + " "}{game.controls?.mode==='custom'?'E personalizuar':'Origjinale'}</p>
      </div>
      <button
       type="button"
       disabled={busy}
       onClick={() => void toggleGameVisibility(game.gameId, !isHidden)}
       className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-all ${
        isHidden
         ? 'border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
         : 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
       }`}
      >
       {isHidden ? (
        <>
         <EyeOff size={13} />
         <span>{t("E fshehur (Shfaq)")}</span>
        </>
       ) : (
        <>
         <Eye size={13} />
         <span>{t("Aktive (Fshih)")}</span>
        </>
       )}
      </button>
     </div>
     {(game.configurationError||game.configurationWarning)&&<p role="alert" className="text-sm text-amber-200">{userError(game.configurationError||game.configurationWarning,'Konfigurimi i lojës duhet kontrolluar. Zgjidh një profil të mbështetur. Ruaj cilësimet për të vazhduar.')}</p>}
     <label className="block space-y-1 text-sm text-white"><span>{t("Modaliteti për këtë lojë")}</span>
      <select aria-label={`${game.title}: modaliteti`} value={draft.mode} disabled={busy} onChange={event=>edit({mode:event.target.value as Draft['mode']})} className="block min-h-11 w-full rounded-lg border border-tertiary bg-primary px-3">
      <option value="original">{t("Origjinal · profilet e motorit")}</option><option value="custom" disabled={!game.supportsCustomMath}>{t("I personalizuar · RTP dhe shpeshtësia e fitimit")}</option>
      </select>
     </label>
     {draft.mode==='custom'?<div className="space-y-4">
      {([{key:'rtp',label:'RTP'},{key:'hitFrequency',label:t("Shpeshtësia e fitimit")}] as const).map(control=><label key={control.key} className="block space-y-2 text-sm text-white"><span>{control.label} {" " + t("e re (%)")}</span>
       <div className="flex items-center gap-3"><input type="range" aria-label={`${game.title}: ${control.label} rrëshqitës`} min={0} max={limits[control.key].max} step={0.01} value={Number(draft[control.key])||0} disabled={busy} onChange={event=>edit({[control.key]:event.target.value})} className="min-w-0 flex-1 accent-amber-400"/>
        <input type="number" aria-label={`${game.title}: ${control.label}`} min={0} max={limits[control.key].max} step={0.01} value={draft[control.key]} disabled={busy} onChange={event=>edit({[control.key]:event.target.value})} className="min-h-11 w-24 rounded-lg border border-tertiary bg-primary px-2 text-white"/>
       </div><span className="flex justify-between text-xs text-text-secondary"><span>0%</span><span>{limits[control.key].max}%</span></span>
      </label>)}
      {Number(draft.rtp)===0&&Number(draft.hitFrequency)===0&&<p className="rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-200">{t("Me 0% rrotullimet e reja me pagesë nuk japin asnjë fitim. Bonusët e pranuar më parë ruajnë kushtet e tyre.")}</p>}
      {invalid&&<p role="alert" className="text-sm text-rose-200">{invalid}</p>}
      {!invalid&&CASINO_CONTROLS_UNRESTRICTED&&compatibility?.advisory&&<p role="status" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">{tr(`Ky çift RTP / shpeshtësi është jashtë kufijve natyrorë të kësaj loje (${compatibility.minHit}%–${compatibility.maxHit}% për RTP ${Number(draft.rtp)}%). Ruajtja lejohet; motori do ta përafrojë me bandën më të afërt të pagesave.`,`This RTP / hit-frequency pair sits outside the game's natural bounds (${compatibility.minHit}%–${compatibility.maxHit}% for RTP ${Number(draft.rtp)}%). Saving is allowed; the engine will approximate it with the nearest reachable payout band.`)}</p>}
      
      {game.customLimits&&<p className="text-xs text-text-secondary">{t("Kthimi mesatar për një rrotullim që paguan duhet të jetë brenda") + " "}{game.customLimits.minWinMultiplier}×–{game.customLimits.maxWinMultiplier}{t("× basti. Serveri kontrollon nëse çifti RTP / shpeshtësia e fitimit realizohet nga loja.")}</p>}
     </div>:<>
     <label className="block space-y-2 text-sm text-white"><span>{t("Zgjedhja e re:") + " "}{choice?percent(choice.theoreticalRtp):t("Zgjidh një profil të mbështetur")}</span>
      <input type="range" min={0} max={Math.max(0,game.profiles.length-1)} step={1} value={Math.max(0,index)} disabled={busy||game.profiles.length<2}
       aria-label={`${game.title}: profilet e RTP-së`} className="w-full accent-amber-400" onChange={event=>setSelected(previous=>({...previous,[game.gameId]:game.profiles[Number(event.target.value)].id}))}/>
      <span className="flex justify-between text-xs text-text-secondary"><span>{t("Më ulët") + " "}{percent(game.profiles[0]?.theoreticalRtp??null)}</span><span>{t("Më lart") + " "}{percent(game.profiles[game.profiles.length-1]?.theoreticalRtp??null)}</span></span>
     </label>
     <label className="block space-y-1 text-xs text-text-secondary"><span>{t("Profilet e mbështetura")}</span>
      <select value={id} disabled={busy} onChange={event=>setSelected(previous=>({...previous,[game.gameId]:event.target.value}))} className="block min-h-11 w-full rounded-lg border border-tertiary bg-primary px-3 text-white">
       {!supported&&<option value={id} disabled>{t("Zgjidh një profil të mbështetur")}</option>}
       {game.profiles.map(profile=><option key={profile.id} value={profile.id}>{percent(profile.theoreticalRtp)}</option>)}
      </select>
     </label>
     </>}
     <button type="button" disabled={busy||!changed||Boolean(invalid)||(draft.mode==='original'&&!supported)} onClick={()=>void save(game.gameId)} className="min-h-11 w-full rounded-lg bg-amber-400 px-4 font-bold text-slate-950 disabled:opacity-40">{t("Ruaj cilësimet për këtë lojë")}</button>
    </article>;
   })}
  </div>
 </section>;
}
