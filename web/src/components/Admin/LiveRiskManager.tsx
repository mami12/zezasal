import { useLanguage } from '../../context/LanguageContext';
import { useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { AlertTriangle, RotateCcw, Save, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import {userError} from '../../utils/userError';

type LeaderRule = { minute: number; goals: number; maxOdds: number };
type LowOddsRule = { minute: number; maxOdds: number };
type MarketCategory = '1X2' | 'DOUBLE_CHANCE' | 'BTTS' | 'TOTAL_GOALS' | 'CORNERS' | 'CARDS' | 'ALL';
type ScoreCondition = 'ANY' | 'DRAW' | 'LEADING';
type MarketClosureRule = { minute: number; market: MarketCategory; score: ScoreCondition };
type LimitKey = 'maxLiveStake' | 'maxLivePayout' | 'maxMatchExposure';
type RiskSettings = {
  enabled: boolean;
  combosEnabled: boolean;
  leaderRules: LeaderRule[];
  lowOddsRules: LowOddsRule[];
  marketClosureRules: MarketClosureRule[];
  limits: Record<LimitKey, number | null>;
};

const clone = (value: RiskSettings): RiskSettings => JSON.parse(JSON.stringify(value));
const marketChoices: { value: MarketCategory; label: string }[] = [
  {value:'1X2',label:'Rezultati final (1 X 2)'},
  {value:'DOUBLE_CHANCE',label:'Shansi i dyfishtë'},
  {value:'BTTS',label:'Shënojnë të dyja ekipet'},
  {value:'TOTAL_GOALS',label:'Totali i golave'},
  {value:'CORNERS',label:'Këndet'},
  {value:'CARDS',label:'Kartonët'},
  {value:'ALL',label:'Të gjitha tregjet'},
];
const scoreChoices: { value: ScoreCondition; label: string }[] = [
  {value:'ANY',label:'Pavarësisht rezultatit'},
  {value:'DRAW',label:'Vetëm kur është barazim'},
  {value:'LEADING',label:'Vetëm kur një ekip kryeson'},
];
const moneyFields: { key: LimitKey; label: string; detail: string }[] = [
  { key:'maxLiveStake',label:'Shuma maksimale drejtpërdrejt',detail:'Gjithsej për kërkesë, edhe kur ka shumë kolona' },
  { key:'maxLivePayout',label:'Pagesa maksimale drejtpërdrejt',detail:'Shuma e pagesave të mundshme të kolonave drejtpërdrejt' },
  { key:'maxMatchExposure',label:'Ekspozimi maksimal për ndeshje',detail:'Shuma konservative e pagesave të mundshme të biletave në pritje për të njëjtën ndeshje' },
];

export default function LiveRiskManager() {
  const { t } = useLanguage();
  const [value,setValue] = useState<RiskSettings | null>(null);
  const [defaults,setDefaults] = useState<RiskSettings | null>(null);
  const [saving,setSaving] = useState(false);
  const [loading,setLoading] = useState(true);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const { data } = await apiClient.get<{ settings: RiskSettings; defaults: RiskSettings }>('/admin/live-risk');
      setValue(clone(data.settings)); setDefaults(clone(data.defaults));
    } catch(e: any) { setError(userError(e.response?.data?.message ?? e.message,'Nuk u lexuan parametrat e rrezikut.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const editLeader = (i: number, patch: Partial<LeaderRule>) =>
    setValue(old => old && ({...old,leaderRules:old.leaderRules.map((r,j)=>i===j?{...r,...patch}:r)}));
  const editOdds = (i: number, patch: Partial<LowOddsRule>) =>
    setValue(old => old && ({...old,lowOddsRules:old.lowOddsRules.map((r,j)=>i===j?{...r,...patch}:r)}));
  const editClosure = (i: number, patch: Partial<MarketClosureRule>) =>
    setValue(old => old && ({...old,marketClosureRules:old.marketClosureRules.map((r,j)=>i===j?{...r,...patch}:r)}));
  const inputClasses = 'w-full min-w-0 rounded border border-tertiary bg-primary px-2 py-2 text-sm font-semibold text-white outline-none focus:border-accent-green';
  const save = async () => {
    if (!value || saving) return;
    setSaving(true);setError('');setMessage('');
    try {
      const {data} = await apiClient.put<{ settings: RiskSettings }>('/admin/live-risk',{settings:value});
      setValue(clone(data.settings));
      setMessage('Parametrat u ruajtën në databazë dhe zbatohen nga serveri.');
    } catch(e: any){setError(userError(e.response?.data?.message ?? e.message,'Ruajtja dështoi.'));}
    finally{setSaving(false);}
  };

  if (loading) return <div className="px-6 py-10 text-text-secondary">{t("Duke ngarkuar menaxhimin e rrezikut...")}</div>;
  if (!value) return (
    <div className="m-6 space-y-3 text-sm text-rose-300">{error}
      <button className="block rounded bg-secondary px-4 py-2 text-white" onClick={()=>void load()}>{t("Riprovo")}</button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-3 py-5 sm:px-6">
      <div className="rounded-xl border border-tertiary bg-secondary p-4 text-sm text-text-secondary">
        <div className="flex items-center gap-2 font-bold text-white"><ShieldAlert size={20} className="text-accent-green"/> {" " + t("Menaxhimi i rrezikut të basteve drejtpërdrejt")}</div>
        <p className="mt-2">{t("Rregullat e kuotave bllokojnë zgjedhje individuale. Rregullat e mbylljes së tregut bllokojnë të gjitha zgjedhjet e atij tregu, edhe kur koeficienti është i lartë. Në faqe shfaqet dryni dhe serveri nuk e pranon bastin.")}</p>
        <p className="mt-1">{t("Koeficientët nuk tregojnë siguri absolute. Mund t'i ndryshosh pragjet, por këto rregulla nuk garantojnë fitim ose mbrojtje të plotë.")}</p>
      </div>
      {error && <div role="alert" className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}
      {message && <div role="status" className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</div>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tertiary bg-secondary p-4">
        <div>
          <h3 className="font-bold text-white">{t("Menaxhimi i rrezikut")}</h3>
          <p className="text-xs text-text-secondary">{t("Aktivizimi i përgjithshëm i rregullave automatike dhe kufijve financiarë")}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded bg-primary px-3 py-2 text-sm text-white">
          <input type="checkbox" checked={value.enabled} onChange={e=>setValue({...value,enabled:e.target.checked})}/>
          {value.enabled ? 'Aktiv' : 'Joaktiv'}
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-tertiary bg-secondary p-4">
        <div>
          <h3 className="font-bold text-white">{t("Kombinime ndeshjeje")}</h3>
          <p className="mt-1 text-xs text-text-secondary">{t("Aktivizo ose çaktivizo kombinimet me dy zgjedhje brenda së njëjtës ndeshje, para ndeshjes dhe drejtpërdrejt.")}</p>
          <p className="mt-1 text-xs text-text-secondary">{t("Ky opsion ruhet veçmas nga aktivizimi i rrezikut drejtpërdrejt. Biletat me disa ndeshje dhe kolonat e sistemit nuk preken.")}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded bg-primary px-3 py-2 text-sm text-white">
          <input type="checkbox" aria-label={t("Aktivizo ose çaktivizo kombinimet e ndeshjeve")} checked={value.combosEnabled}
            onChange={e=>setValue({...value,combosEnabled:e.target.checked})}/>
          {value.combosEnabled ? 'Kombinimet janë aktive' : 'Kombinimet janë joaktive'}
        </label>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-tertiary bg-secondary p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-white">{t("1X2: skuadra që kryeson")}</h3>
              <p className="mt-1 text-xs text-text-secondary">{t("Blloko vetëm 1 ose 2 kur plotësohen të gjitha kushtet e rreshtit.")}</p>
            </div>
            <button type="button" title={t("Shto rregull")} disabled={value.leaderRules.length >= 12}
              className="rounded bg-primary p-2 text-accent-green disabled:opacity-40"
              onClick={()=>setValue({...value,leaderRules:[...value.leaderRules,{minute:70,goals:2,maxOdds:1.6}]})}><Plus size={18}/></button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_1fr_30px] gap-2 text-[11px] text-text-secondary">
            <span>{t("Minuta ≥")}</span><span>{t("Avantazhi ≥")}</span><span>{t("Kuota ≤")}</span><span/>
          </div>
          {value.leaderRules.map((rule,i)=>(
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_30px] items-center gap-2">
              <input className={inputClasses} type="number" min={0} max={120} step={1}
                aria-label={`Minuta e rregullit ${i+1}`} value={rule.minute}
                onChange={e=>editLeader(i,{minute:Number(e.target.value)})}/>
              <input className={inputClasses} type="number" min={1} max={20} step={1}
                aria-label={`Avantazhi në gola ${i+1}`} value={rule.goals}
                onChange={e=>editLeader(i,{goals:Number(e.target.value)})}/>
              <input className={inputClasses} type="number" min={1.01} max={100} step={0.01}
                aria-label={`Koeficienti ${i+1}`} value={rule.maxOdds}
                onChange={e=>editLeader(i,{maxOdds:Number(e.target.value)})}/>
              <button type="button" aria-label={`Hiq rregullin ${i+1}`}
                className="text-rose-300 hover:text-rose-100"
                onClick={()=>setValue({...value,leaderRules:value.leaderRules.filter((_,j)=>j!==i)})}><Trash2 size={16}/></button>
            </div>
          ))}
        </section>

        <section className="space-y-3 rounded-xl border border-tertiary bg-secondary p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-white">{t("Të gjitha tregjet: koeficientë të ulët")}</h3>
              <p className="mt-1 text-xs text-text-secondary">{t("Zbatohet edhe për barazimin (X), golat, kartonët, këndet dhe zgjedhjet e kombinuara.")}</p>
            </div>
            <button type="button" title={t("Shto rregull")} disabled={value.lowOddsRules.length >= 12}
              className="rounded bg-primary p-2 text-accent-green disabled:opacity-40"
              onClick={()=>setValue({...value,lowOddsRules:[...value.lowOddsRules,{minute:80,maxOdds:1.2}]})}><Plus size={18}/></button>
          </div>
          <div className="grid grid-cols-[1fr_1fr_30px] gap-2 text-[11px] text-text-secondary">
            <span>{t("Minuta ≥")}</span><span>{t("Kuota ≤")}</span><span/>
          </div>
          {value.lowOddsRules.map((rule,i)=>(
            <div key={i} className="grid grid-cols-[1fr_1fr_30px] items-center gap-2">
              <input className={inputClasses} type="number" min={0} max={120} step={1}
                aria-label={`Minuta e kuotave ${i+1}`} value={rule.minute}
                onChange={e=>editOdds(i,{minute:Number(e.target.value)})}/>
              <input className={inputClasses} type="number" min={1.01} max={100} step={0.01}
                aria-label={`Koeficienti i ulët ${i+1}`} value={rule.maxOdds}
                onChange={e=>editOdds(i,{maxOdds:Number(e.target.value)})}/>
              <button type="button" aria-label={`Hiq pragun ${i+1}`}
                className="text-rose-300 hover:text-rose-100"
                onClick={()=>setValue({...value,lowOddsRules:value.lowOddsRules.filter((_,j)=>j!==i)})}><Trash2 size={16}/></button>
            </div>
          ))}
        </section>
      </div>

      <section className="space-y-4 rounded-xl border border-tertiary bg-secondary p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-white">{t("Mbyllja automatike e një tregu të plotë")}</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {t("Mbyll të gjitha kuotat e tregut të zgjedhur sapo arrihet minuta dhe kushti i rezultatit. Nuk ka rëndësi nëse kuota është 1.05 apo 11.00.")}</p>
            <p className="mt-1 text-xs text-text-secondary">
              {t("Shembull: në minutën 90, rezultati 1-1, mbyllen bashkë 1, X dhe 2. Nëse zgjedh «Pavarësisht rezultatit», tregu mbetet i mbyllur edhe nëse shënohet gol më vonë.")}</p>
          </div>
          <button type="button" disabled={value.marketClosureRules.length >= 12}
            className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 text-xs font-bold text-accent-green disabled:opacity-40"
            onClick={()=>setValue({...value,marketClosureRules:[...value.marketClosureRules,{minute:90,market:'1X2',score:'ANY'}]})}>
            <Plus size={16}/> {" " + t("Shto rregull")}</button>
        </div>
        {value.marketClosureRules.length === 0 && (
          <p className="rounded border border-tertiary bg-primary p-3 text-xs text-text-secondary">
            {t("Nuk ka rregulla automatike për mbylljen e tregjeve.")}</p>
        )}
        <div className="space-y-2">
          {value.marketClosureRules.map((rule,i)=>(
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-tertiary bg-primary/70 p-3 sm:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)_32px] sm:items-end">
              <label className="space-y-1">
                <span className="block text-[11px] text-text-secondary">{t("Nga minuta")}</span>
                <input className={inputClasses} type="number" min={0} max={120} step={1}
                  aria-label={`Minuta e mbylljes ${i+1}`} value={rule.minute}
                  onChange={e=>editClosure(i,{minute:Number(e.target.value)})}/>
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-text-secondary">{t("Tregu që mbyllet")}</span>
                <select className={inputClasses} value={rule.market}
                  onChange={e=>editClosure(i,{market:e.target.value as MarketCategory})}>
                  {marketChoices.map(choice=><option key={choice.value} value={choice.value}>{t(choice.label)}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-text-secondary">{t("Kushti i rezultatit")}</span>
                <select className={inputClasses} value={rule.score}
                  onChange={e=>editClosure(i,{score:e.target.value as ScoreCondition})}>
                  {scoreChoices.map(choice=><option key={choice.value} value={choice.value}>{t(choice.label)}</option>)}
                </select>
              </label>
              <button type="button" aria-label={`Hiq rregullin e mbylljes ${i+1}`}
                className="flex h-10 items-center justify-center rounded text-rose-300 hover:bg-rose-500/10 hover:text-white"
                onClick={()=>setValue({...value,marketClosureRules:value.marketClosureRules.filter((_,j)=>j!==i)})}>
                <Trash2 size={18}/>
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-secondary">
          {t("Për të mbyllur vetëm një treg të një ndeshjeje të caktuar, përdor «Ndeshjet dhe kuotat» në administrim. Këto rregulla zbatohen automatikisht për të gjitha ndeshjet drejtpërdrejt.")}</p>
      </section>

      <section className="space-y-3 rounded-xl border border-tertiary bg-secondary p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-accent-yellow"/>
          <h3 className="font-bold text-white">{t("Kufijtë financiarë për bastet drejtpërdrejt (Lek)")}</h3>
        </div>
        <p className="text-xs text-text-secondary">{t("Vlera bosh e çaktivizon vetëm atë kufi. Ekspozimi llogaritet me shumën bruto të të gjitha pagesave të mundshme të skedinave në pritje për çdo ndeshje, prandaj është kufi konservativ.")}</p>
        <div className="grid gap-4 md:grid-cols-3">
          {moneyFields.map(field=>(
            <label key={field.key} className="space-y-1">
              <span className="block text-sm font-bold text-white">{t(field.label)}</span>
              <span className="block min-h-[30px] text-xs text-text-secondary">{t(field.detail)}</span>
              <input className={inputClasses} type="number" step="100" min="100"
                placeholder={t("Pa kufi")} value={value.limits[field.key] ?? ''}
                onChange={e=>setValue({...value,limits:{
                  ...value.limits,[field.key]:e.target.value === '' ? null : Number(e.target.value),
                }})}/>
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" disabled={!defaults || saving} onClick={()=>defaults && setValue(clone(defaults))}
          className="inline-flex items-center gap-2 rounded border border-tertiary bg-secondary px-4 py-2 text-xs font-bold text-text-secondary hover:text-white">
          <RotateCcw size={15}/> {" " + t("Kthe parametrat fillestarë (pa ruajtur)")}</button>
        <button type="button" disabled={saving} onClick={save}
          className="inline-flex items-center gap-2 rounded bg-accent-green px-6 py-3 text-sm font-black text-primary disabled:opacity-50">
          <Save size={17}/> {saving ? 'Duke ruajtur...' : 'Ruaj parametrat'}
        </button>
      </div>
    </div>
  );
}
