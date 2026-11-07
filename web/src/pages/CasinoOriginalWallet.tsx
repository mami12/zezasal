import { useLanguage } from '../context/LanguageContext';
import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,Info,RefreshCw,X} from 'lucide-react';
import {apiClient} from '../api/client';
import {casinoPercent,casinoStakeLimits,casinoTermsKey,type CasinoGameSettings,type CasinoSettingsData,type CasinoGameId} from '../types/casino';
import {userError} from '../utils/userError';
import {useAuth} from '../context/AuthContext';
import {isUserActive,noteGameView} from '../utils/userActivity';


export type CasinoGame = CasinoGameId;

const original=(id:CasinoGame,title:string)=>({title,session:`/casino/original/${id}/session`,prefix:`/app/api/casino/original/${id}/launch`});
const GAMES: Record<CasinoGame, {title: string; session: string; play?: string; prefix: string; ct?: boolean}> = {
  'ice-fruits-6x3':original('ice-fruits-6x3','Ice Fruits 6 Reels'),
  'fortune-pyramid':original('fortune-pyramid','Fortune Pyramid'),
  'fortune-teller':original('fortune-teller','Fortune Teller'),
  'lucky-clover-x3':original('lucky-clover-x3','Lucky Clover X3'),
  'vikings-fun':original('vikings-fun',"Viking's Fun"),
  'fruit-queen':original('fruit-queen','Fruit Queen'),
  'seven-hot':original('seven-hot','Seven Hot'),
  sizzling: {
    title: 'Sizzling Hot Deluxe',
    session: '/casino/session',
    play: '/app/api/casino/sizzlinghotdeluxe/real/play',
    prefix: '/app/casino-original/sizzling/',
  },
  bookofra: {
    title: 'Book of Ra Deluxe',
    session: '/casino/bookofra/session',
    play: '/app/api/casino/bookofra/real/play',
    prefix: '/app/casino-original/bookofra/',
  },
  firejoker: {
    title: 'Fire Joker',
    session: '/casino/original/firejoker/session',
    prefix: '/app/api/casino/original/firejoker/',
    ct: true,
  },
};

function walletError(status:number,details:string):string {
  if(status===401)return 'Sesioni i lojës nuk u pranua (401). Kontrollo të dhënat e sesionit dhe hape nga e njëjta adresë.';
  if(status===403)return 'Serveri e refuzoi nisjen e lojës (403). Kontrollo aktivizimin e kazinosë.';
  if(status===404)return 'Shërbimi i lojës nuk u gjet (404). Kontrollo nëse serveri përdor versionin e fundit.';
  if(status>=500)return 'Shërbimi i lojës dha gabim '+status+'. Kontrollo lidhjen me databazën dhe regjistrin e gabimeve në server.';
  return 'API e lojës u përgjigj me '+status+': '+details.slice(0,180);
}

/**
 * The Pixi client is embedded only after its HttpOnly session cookie has been
 * verified through the exact same-origin real-wallet /play endpoint.
 * No demo fallback is possible: the game always plays for the player balance.
 */
export default function CasinoOriginalWallet({game='sizzling'}:{game?:CasinoGame}){
  const { t } = useLanguage();
  const {user,refreshUser}=useAuth();
  const cfg=GAMES[game]??GAMES.sizzling;
  const frame=useRef<HTMLIFrameElement>(null);
  const [url,setUrl]=useState('');
  const [loading,setLoading]=useState(true);
  const [ready,setReady]=useState(false);
  const [progress,setProgress]=useState('');
  const [stalled,setStalled]=useState(false);
  const [error,setError]=useState('');
  const [terms,setTerms]=useState<{game:CasinoGameSettings;limits:CasinoSettingsData['stakeLimits']}|null>(null);
  const [awaitingTerms,setAwaitingTerms]=useState(false);
  const [termsChanged,setTermsChanged]=useState(false);
  const [pendingWin,setPendingWin]=useState(0);
  const [showInfo,setShowInfo]=useState(false);
  const infoDialog=useRef<HTMLElement>(null);
  const acceptedTerms=useRef('');
  useEffect(()=>{
    if(!showInfo)return;
    const previous=document.activeElement as HTMLElement;
    const before=document.body.style.overflow;document.body.style.overflow='hidden';
    const frame=requestAnimationFrame(()=>infoDialog.current?.querySelector<HTMLElement>('button')?.focus());
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape')setShowInfo(false);
      if(event.key==='Tab'){
        const elements=Array.from(infoDialog.current?.querySelectorAll<HTMLElement>('button,summary')||[]).filter(element=>element.getClientRects().length>0);
        if(event.shiftKey&&document.activeElement===elements[0]){event.preventDefault();elements[elements.length-1]?.focus();}
        else if(!event.shiftKey&&document.activeElement===elements[elements.length-1]){event.preventDefault();elements[0]?.focus();}
      }
    };
    document.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(frame);document.body.style.overflow=before;document.removeEventListener('keydown',key);previous?.focus();};
  },[showInfo]);
  const connect=async()=>{
    setLoading(true);setError('');setReady(false);setStalled(false);setProgress('');
    setUrl('');setPendingWin(0);setAwaitingTerms(false);setTermsChanged(false);setShowInfo(false);
    try{
      const settings=await apiClient.get<CasinoSettingsData>('/casino/status');
      const current=settings.data.games.find(item=>item.gameId===game);
      if(!current||!settings.data.stakeLimits)throw new Error('Kushtet e lojës nuk u verifikuan. Provo përsëri.');
      const currentTerms={game:current,limits:settings.data.stakeLimits};
      setTerms(currentTerms);
      const response=await apiClient.post<{ready:boolean;gameUrl:string;mathVersion?:string}>(cfg.session,{mathVersion:current.mathVersion});
      if(!response.data.ready||!response.data.gameUrl.startsWith(cfg.prefix))
        throw new Error('Sesioni i lojës nuk u krijua');
      if(cfg.play&&!cfg.ct){
        const payload=new FormData();
        payload.append('data',JSON.stringify({action:'init',request_id:'0',time_offset:0}));
        const test=await fetch(cfg.play,{
          method:'POST',credentials:'same-origin',body:payload,cache:'no-store',
        });
        if(!test.ok){
          const details=(await test.text()).slice(0,220);
          throw new Error(walletError(test.status,details));
        }
        const init=await test.json();
        if(!init?.init?.start_symbols||typeof init?.balance?.after!=='number')
          throw new Error('Serveri ktheu një përgjigje jo të plotë për nisjen e lojës.');
      }
      const gameUrl=new URL(response.data.gameUrl,window.location.origin);
      gameUrl.searchParams.set('wallet',String(Date.now()));
      setUrl(gameUrl.pathname+gameUrl.search);
    }catch(e:any){
      const text=e.response?.data?.message||e.message||'Lidhja me portofolin dështoi';
      setError(userError(text,'Lidhja me portofolin dështoi. Provo përsëri.'));
      setUrl('');
    }finally{setLoading(false);}
  };
  useEffect(()=>{noteGameView(game);void connect();},[game]);
  useEffect(()=>{
    if(!url||!terms)return;
    let disposed=false;
    const check=async()=>{
      try{
        const response=await apiClient.get<CasinoSettingsData>('/casino/status');
        const current=response.data.games.find(item=>item.gameId===game);
        if(!disposed&&current)setTermsChanged(casinoTermsKey(current,response.data.stakeLimits)!==casinoTermsKey(terms.game,terms.limits));
      }catch{/* A network failure does not interrupt an accepted round or bonus. */}
    };
    // Only refresh the disclosed terms while the player is actually here; a
    // hidden or idle tab makes no request at all.
    const timer=window.setInterval(()=>{if(isUserActive())void check();},30000);
    return()=>{disposed=true;window.clearInterval(timer);};
  },[url,game,terms]);
  useEffect(()=>{
    if(!url||ready)return;
    const check=()=>{
      try{
        const doc=frame.current?.contentDocument;
        if(!doc)return;
        const nestedFrame=doc.querySelector<HTMLIFrameElement>('#game-frame');
        const gameDoc=nestedFrame?.contentDocument??doc;
        const loader=gameDoc.getElementById('preloaderContainer');
        const canvas=gameDoc.getElementById('slotCanvas') as HTMLCanvasElement|null;
        if(gameDoc.getElementById('gameContainer')||(!loader&&canvas&&canvas.width>0)){setReady(true);setStalled(false);return;}
        const message=gameDoc.getElementById('preloaderText')?.textContent;
        if(message)setProgress(message.trim());
      }catch{/* cross-origin frames cannot be inspected */}
    };
    const poll=window.setInterval(check,750);
    const timeout=window.setTimeout(()=>setStalled(value=>ready?value:true),60000);
    return()=>{window.clearInterval(poll);window.clearTimeout(timeout);};
  },[url,ready]);
  useEffect(()=>{
    if(!url)return;
    let disposed=false,inFlight=false,dirty=false;
    const refresh=async()=>{
      if(disposed)return;
      if(inFlight){dirty=true;return;}
      inFlight=true;
      try{if(typeof refreshUser==='function')await refreshUser();}finally{inFlight=false;if(dirty){dirty=false;void refresh();}}
    };
    const changed=(event:MessageEvent)=>{
      if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow)return;
      if(event.data?.type==='casino:wallet-updated')void refresh();
      if(event.data?.type==='casino:pending'&&Number.isFinite(event.data.amount)&&event.data.amount>=0)setPendingWin(event.data.amount);
    };
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('message',changed);
    window.addEventListener('focus',visible);
    document.addEventListener('visibilitychange',visible);
    void refresh();
    return()=>{disposed=true;window.removeEventListener('message',changed);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[url,game,refreshUser]);
  const gameInfo=null;
  if(loading)return <div role="status" className="flex min-h-56 items-center justify-center bg-black p-8 text-center text-amber-200">{t("Po verifikohet lidhja me bilancin e llogarisë...")}</div>;
  if(error||!url)return <div className="flex min-h-56 flex-col items-center justify-center gap-4 bg-black p-8 text-center">
    <AlertTriangle className="text-amber-300" size={30}/>
    <p role="alert" className="max-w-xl text-sm text-rose-200">{error||'Loja nuk është e disponueshme'}</p>
    <button onClick={()=>void connect()} className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-400 px-4 font-bold text-black"><RefreshCw size={16}/>{t("Rilidhu me bilancin")}</button>
  </div>;
  return <div className="casino-session-layout">
    {terms&&<div className="casino-session-terms flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-white/10 bg-slate-950 px-2 py-1 text-center text-[11px] text-slate-300" aria-label={t("Kushtet aktive të lojës")}>
      <span>{t("Basti:") + " "}{casinoStakeLimits(terms.limits)}</span>
      {user&&<span className="font-semibold text-white" aria-label={t("Bilanci i llogarisë")}>{t("Bilanci:") + " "}{Number(user.balance).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} {" " + t("lekë")}</span>}
      {pendingWin>0&&<span className="text-amber-200">{t("Fitim në pritje:") + " "}{pendingWin.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})} {" " + t("lekë · Arkëtoje në lojë për ta kaluar në bilanc")}</span>}
    </div>}
    <div className="casino-session-stage">
    <div className="casino-wallet-surface relative">
      <iframe ref={frame} title={cfg.title+' · bilanci i llogarisë'}
        src={url} className="casino-wallet-frame block h-full min-h-0 w-full border-0"
        allow="autoplay; fullscreen; screen-wake-lock" allowFullScreen
        onLoad={()=>{if(!cfg.play&&!cfg.ct)setReady(true);}}/>
      {stalled&&!ready&&<div role="alert"
        className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/95 p-5 text-center text-white">
        <AlertTriangle className="text-amber-300" size={32}/>
        <p className="text-base font-bold">{cfg.title} {" " + t("nuk përfundoi ngarkimin") + " "}{progress&&'('+progress+')'}</p>
        <p className="max-w-md text-sm text-slate-300">{t("Sesioni i portofolit u verifikua, por klienti i lojës nuk përfundoi. Kontrollo nëse disa skedarë janë bllokuar ose janë ruajtur nga një ngarkim i mëparshëm.")}</p>
        <button onClick={()=>void connect()} className="flex min-h-11 items-center gap-2 rounded-lg bg-amber-400 px-4 font-bold text-black"><RefreshCw size={16}/>{t("Rifresko lojën")}</button>
      </div>}
    </div>
    </div>
  </div>;
}
