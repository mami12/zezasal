import { useLanguage } from '../../context/LanguageContext';
import {useEffect,useState} from 'react';
import {Check,Plus,Save,Trash2,Pencil,RotateCcw,X} from 'lucide-react';
import {apiClient} from '../../api/client';

type Leg={market:string;outcome:string;line:string};
type Option=Leg&{label:string};
type Preset={id:string;label:string;legs:Leg[]};
type Category={market:string;title:string;options:Option[];presets?:Preset[]};
type Template={id:string;name:string;legs:Leg[];active:boolean};
const initial=():Template=>({id:'',name:'',legs:[],active:true});
const key=(leg:Leg)=>[leg.market,leg.outcome,leg.line].join(':');
const label=(leg:Leg)=>leg.market==='BTTS'?'Shënojnë të dy ekipet: '+(leg.outcome.toLowerCase()==='yes'?'Po':'Jo'):
 leg.market==='TOTAL'?(leg.outcome.toLowerCase()==='over'?'Lart':'Poshtë')+(leg.line?' '+leg.line:''):
 leg.market==='DC'?'Dy shanse: '+leg.outcome:leg.outcome;
const categoryTitle=(market:string)=>({ '1X2':'Rezultati (1X2)', DC:'Dy shanse', BTTS:'Shënojnë të dy ekipet', TOTAL:'Golat Lart/Poshtë' }[market]??'Treg tjetër');
const order=['1X2','DC','BTTS','TOTAL'];
const pairs=['1X2+BTTS','1X2+TOTAL','BTTS+TOTAL','DC+TOTAL'];

export default function BetBuilderManager(){
  const { t } = useLanguage();
 const [templates,setTemplates]=useState<Template[]>([]),[catalog,setCatalog]=useState<Category[]>([]);
 const [draft,setDraft]=useState<Template>(initial),[category,setCategory]=useState('1X2');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [allEnabled,setAllEnabled]=useState<boolean|null>(null);
 const toggleAll=async(enabled:boolean)=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{const {data}=await apiClient.patch<{settings:{combosEnabled:boolean}}>('/admin/bet-builders/enabled',{enabled});setAllEnabled(data.settings.combosEnabled);await refresh();setNotice(enabled?'Të gjitha kombinimet janë aktivizuar.':'Të gjitha kombinimet janë çaktivizuar.');}
  catch(e:any){setError(e.response?.data?.message||'Nuk u ndryshua gjendja e kombinimeve.');}finally{setBusy(false);}
 };
 const refresh=async()=>{
  const [saved,options]=await Promise.all([apiClient.get<Template[]>('/admin/bet-builders'),apiClient.get<Category[]>('/admin/bet-builders/catalog')]);
  setTemplates(saved.data);setCatalog(options.data);
 };
 useEffect(()=>{void refresh().catch(e=>setError(e.response?.data?.message||'Nuk u ngarkuan tregjet.'));},[]);
 useEffect(()=>{void apiClient.get<{settings:{combosEnabled:boolean}}>('/admin/live-risk').then(({data})=>setAllEnabled(data.settings.combosEnabled)).catch(()=>setError('Nuk u lexua gjendja e kombinimeve.'));},[]);
 const sorted=[...draft.legs].sort((a,b)=>order.indexOf(a.market)-order.indexOf(b.market));
 const presets=catalog.flatMap(item=>item.presets||[]);
 const matchesPreset=(preset:Preset)=>draft.legs.length===preset.legs.length&&preset.legs.every(leg=>draft.legs.some(l=>key(l)===key(leg)));
 const name=presets.find(matchesPreset)?.label||sorted.map(label).join(' + '),complete=sorted.length===2;
 const choosePreset=(preset:Preset)=>{
  setError('');setNotice('');setCategory('BTTS');
  setDraft(value=>({...value,legs:preset.legs.map(leg=>({...leg}))}));
 };
 const compatible=(option:Leg)=>{
  const other=draft.legs.find(l=>l.market!==option.market);
  return !other||pairs.includes([other.market,option.market].sort().join('+'));
 };
 const choose=(option:Option)=>{
  setError('');setNotice('');
  const leg={market:option.market,outcome:option.outcome,line:option.line};
  setDraft(value=>{
   if(value.legs.some(l=>key(l)===key(leg)))return {...value,legs:value.legs.filter(l=>key(l)!==key(leg))};
   const remaining=value.legs.filter(l=>l.market!==leg.market);
   if(remaining.length>=2)return value;
   return {...value,legs:[...remaining,leg]};
  });
 };
 const reset=()=>{setDraft(initial());setError('');setNotice('');};
 const save=async()=>{
  if(!complete||busy)return;setBusy(true);setError('');setNotice('');
  try{await apiClient.post('/admin/bet-builders',{id:draft.id||null,legs:sorted,active:draft.active});await refresh();setDraft(initial());setNotice('Kombinimi i ndeshjes u ruajt.');}
  catch(e:any){setError(e.response?.data?.message||'Ruajtja dështoi.');}finally{setBusy(false);}
 };
 const remove=async(id:string)=>{
  if(!window.confirm('Ta fshijmë këtë kombinim? Biletat e vjetra ruhen.'))return;
  setBusy(true);setError('');try{await apiClient.delete('/admin/bet-builders/'+id);await refresh();if(draft.id===id)setDraft(initial());}
  catch(e:any){setError(e.response?.data?.message||'Fshirja dështoi.');}finally{setBusy(false);}
 };
 const edit=(item:Template)=>{
  setNotice('');setError(item.legs.length!==2?'Zgjidh saktësisht 2 tregje për këtë kombinim.':'');
  setDraft({...item,legs:item.legs.length===2?item.legs.map(l=>({...l})):[]});
 };
 return <div className="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-6">
  <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tertiary bg-secondary p-4">
   <div><h2 className="font-bold text-white">{t('Të gjitha kombinimet')}</h2><p role="status" className="mt-1 text-sm text-text-secondary">{allEnabled===null?t('Duke ngarkuar...'):allEnabled?t('Kombinimet janë aktive'):t('Kombinimet janë joaktive')}</p></div>
   <div className="flex flex-wrap gap-2">
    <button type="button" disabled={busy||allEnabled===null||allEnabled} onClick={()=>void toggleAll(true)} className="min-h-11 rounded-lg bg-emerald-500 px-4 py-2 font-bold text-slate-950 disabled:opacity-40">{t('Aktivizo të gjitha')}</button>
    <button type="button" disabled={busy||allEnabled===null||!allEnabled} onClick={()=>void toggleAll(false)} className="min-h-11 rounded-lg bg-rose-600 px-4 py-2 font-bold text-white disabled:opacity-40">{t('Çaktivizo të gjitha')}</button>
   </div>
  </section>
  <div className="rounded-xl border border-tertiary bg-secondary p-4 text-sm text-text-secondary">
   {t("Zgjidh një kategori, kliko saktësisht 2 zgjedhje nga dy tregje të ndryshme dhe shtyp Ruaj. Emri krijohet automatikisht.")}<p className="mt-2">{t("Kombinimet standarde krijohen automatikisht. Aktivizimi dhe çaktivizimi gjenden te Menaxhimi i rrezikut. Çdo kombinim shfaqet vetëm kur të dyja zgjedhjet janë aktive; koeficienti është prodhimi i tyre.")}</p>
  </div>
  {error&&<div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
  {notice&&<div role="status" className="rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-300">{notice}</div>}
  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
   <section className="space-y-4 rounded-xl border border-tertiary bg-secondary p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-white">{draft.id?'Modifiko kombinimin e ndeshjes':'Kombinim i ri ndeshjeje'}</h2><button type="button" onClick={reset} disabled={busy} className="flex min-h-11 items-center gap-1 px-2 text-xs text-text-secondary"><RotateCcw size={16}/>{t("Pastro")}</button></div>
    {presets.length>0&&<div className="space-y-2 rounded-lg border border-tertiary bg-primary p-3">
     <h3 className="text-sm font-bold text-white">{t("Shënon vetëm njëri ekip")}</h3>
     <p className="text-xs text-text-secondary">{t("Vendasit janë ekipi i parë në ndeshje, mysafirët ekipi i dytë. Secili buton zgjedh të dy tregjet; 0–0 nuk fiton.")}</p>
     <div role="group" aria-label={t("Kombinime të shpejta për golat")} className="grid gap-2 sm:grid-cols-2">
      {presets.map(preset=><button key={preset.id} type="button" disabled={busy} aria-pressed={matchesPreset(preset)} onClick={()=>choosePreset(preset)} className={'flex min-h-14 items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-bold disabled:opacity-30 '+(matchesPreset(preset)?'border-accent-green bg-accent-green/20 text-accent-green':'border-tertiary bg-secondary text-white hover:border-accent-green')}>
       {matchesPreset(preset)&&<Check size={16} className="shrink-0"/>}<span>{preset.label}</span>
      </button>)}
     </div>
    </div>}
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("Kategoritë e tregjeve")}>
     {catalog.map(item=><button key={item.market} type="button" aria-pressed={category===item.market} onClick={()=>setCategory(item.market)} className={'min-h-11 rounded-lg border px-3 py-2 text-xs font-bold '+(category===item.market?'border-accent-green bg-accent-green text-primary':'border-tertiary bg-primary text-white')}>{categoryTitle(item.market)}</button>)}
    </div>
    <div role="group" aria-label={t("Zgjedhjet e tregut")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
     {(catalog.find(c=>c.market===category)?.options||[]).map(option=>{
      const selected=draft.legs.some(l=>key(l)===key(option));
      const full=complete&&!draft.legs.some(l=>l.market===option.market);
      return <button key={key(option)} type="button" aria-pressed={selected} disabled={busy||(!selected&&(full||!compatible(option)))} onClick={()=>choose(option)} className={'flex min-h-14 items-center justify-center gap-2 rounded-lg border px-3 py-3 font-bold disabled:opacity-30 '+(selected?'border-accent-green bg-accent-green/20 text-accent-green':'border-tertiary bg-primary text-white hover:border-accent-green')}>
       {selected&&<Check size={16}/>}<span>{label(option)}</span>
      </button>;
     })}
    </div>
    <div className="rounded-lg border border-tertiary bg-primary p-3">
     <p className="mb-3 text-sm font-bold text-white">{t("Zgjedhur:") + " "}{draft.legs.length}/2</p>
     <div className="flex min-h-11 flex-wrap gap-2">{sorted.map(leg=><button key={key(leg)} type="button" disabled={busy} aria-label={'Hiq '+label(leg)} onClick={()=>setDraft({...draft,legs:draft.legs.filter(l=>key(l)!==key(leg))})} className="flex items-center gap-2 rounded-lg bg-accent-green/15 px-3 py-2 text-sm text-accent-green">{label(leg)}<X size={14}/></button>)}
      {!draft.legs.length&&<span className="text-sm text-text-secondary">{t("Kliko zgjedhjen e parë.")}</span>}
     </div>
     <p className="mt-3 break-words text-sm text-white" aria-live="polite">{name||'Emri do të plotësohet automatikisht.'}</p>
    </div>
    <label className="flex min-h-11 items-center gap-2 text-sm text-white"><input type="checkbox" disabled={busy} checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>{t("Aktiv në ndeshjet e përshtatshme")}</label>
    <button type="button" onClick={()=>void save()} disabled={busy||!complete} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent-green px-4 py-3 font-bold text-primary disabled:opacity-40"><Save size={17}/>{busy?'Duke ruajtur…':'Ruaj kombinimin e ndeshjes'}</button>
   </section>
   <section className="space-y-3 rounded-xl border border-tertiary bg-secondary p-4">
    <div className="flex items-center justify-between"><h2 className="font-bold text-white">{t("Kombinimet e ruajtura")}</h2><button type="button" disabled={busy} onClick={reset} className="flex min-h-11 items-center gap-1 rounded px-3 text-sm font-bold text-accent-green"><Plus size={15}/>{t("I ri")}</button></div>
    {!templates.length&&<p className="text-sm text-text-secondary">{t("Nuk ka kombinime të ruajtura.")}</p>}
    {templates.map(item=><div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-tertiary bg-primary p-3">
     <div><div className="font-bold text-white">{item.legs.map(label).join(' + ')}</div><div className={'mt-2 text-xs '+(item.active?'text-emerald-300':'text-text-secondary')}>{item.active?'Aktiv':'Joaktiv'}</div></div>
     <div className="flex"><button type="button" disabled={busy} aria-label={'Modifiko '+item.legs.map(label).join(' + ')} onClick={()=>edit(item)} className="min-h-11 min-w-11 text-accent-yellow"><Pencil size={17}/></button><button type="button" disabled={busy} aria-label={'Fshi '+item.legs.map(label).join(' + ')} onClick={()=>void remove(item.id)} className="min-h-11 min-w-11 text-rose-300"><Trash2 size={17}/></button></div>
    </div>)}
   </section>
  </div>
 </div>;
}
