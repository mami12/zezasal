import { useLanguage } from '../../context/LanguageContext';
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowLeft,Maximize2,Minimize2,RotateCw} from 'lucide-react';
import {createCasinoDisplayController} from './casinoDisplay';

type LandscapeOrientation=ScreenOrientation&{lock?:(value:'landscape')=>Promise<void>};
type FsDocument=Document&{
 webkitFullscreenElement?:Element|null;
 webkitExitFullscreen?:()=>Promise<void>|void;
 msFullscreenElement?:Element|null;
 msExitFullscreen?:()=>Promise<void>|void;
};
type FsElement=HTMLElement&{
 webkitRequestFullscreen?:()=>Promise<void>|void;
 webkitRequestFullScreen?:()=>Promise<void>|void;
 msRequestFullscreen?:()=>Promise<void>|void;
};

/** The real fullscreen element, including the WebKit / MS prefixed variants. */
const currentFullscreenElement=()=>{
 const doc=document as FsDocument;
 return document.fullscreenElement??doc.webkitFullscreenElement??doc.msFullscreenElement??null;
};
const requestNativeFullscreen=()=>{
 const element=document.documentElement as FsElement;
 const request=element.requestFullscreen??element.webkitRequestFullscreen??element.webkitRequestFullScreen??element.msRequestFullscreen;
 return request?request.call(element):undefined;
};
const exitNativeFullscreen=()=>{
 const doc=document as FsDocument;
 const exit=doc.exitFullscreen??doc.webkitExitFullscreen??doc.msExitFullscreen;
 return exit?exit.call(doc):undefined;
};
const canUseNativeFullscreen=()=>{
 const element=document.documentElement as FsElement;
 return Boolean(element.requestFullscreen??element.webkitRequestFullscreen??element.webkitRequestFullScreen??element.msRequestFullscreen);
};

const display=createCasinoDisplayController({
 isFullscreen:()=>Boolean(currentFullscreenElement()),
 isLandscape:()=>screen.orientation?.type?screen.orientation.type.startsWith('landscape'):window.innerWidth>window.innerHeight,
 requestFullscreen:requestNativeFullscreen,
 lockLandscape:()=>(screen.orientation as LandscapeOrientation)?.lock?.('landscape'),
 unlock:()=>screen.orientation?.unlock?.(),
 exitFullscreen:exitNativeFullscreen,
});
export const requestCasinoLandscape=display.request;
export const releaseCasinoLandscape=display.release;

export default function CasinoFullscreen({children,title,onExit}:{children:ReactNode;title:string;onExit:()=>void}){
 const { t } = useLanguage();
 const [portrait,setPortrait]=useState(()=>window.innerHeight>window.innerWidth);
 const [native,setNative]=useState(()=>Boolean(currentFullscreenElement()));
 const [supported]=useState(canUseNativeFullscreen);
 const [closing,setClosing]=useState(false),[error,setError]=useState('');
 const [dismissRotate,setDismissRotate]=useState(false);
 const [touch]=useState(()=>typeof window!=='undefined'&&window.matchMedia?window.matchMedia('(pointer: coarse)').matches:false);
 const exiting=useRef(false);

 const exit=()=>{
  if(exiting.current)return;exiting.current=true;setClosing(true);setError('');
  try{onExit();}catch(e:any){setError(e?.message||'Loja nuk u mbyll. Provo përsëri.');exiting.current=false;setClosing(false);}
 };
 // The label always follows the real browser state, never an intention flag, so
 // the first click does what it says even when the automatic request was
 // rejected because the browser required a user gesture.
 const toggleFullscreen=()=>{
  if(currentFullscreenElement())void releaseCasinoLandscape({keepSession:true});
  else void requestCasinoLandscape({retry:true});
 };
 useEffect(()=>{
  const update=()=>setPortrait(window.innerHeight>window.innerWidth);
  const nativeChange=()=>{
   setNative(Boolean(currentFullscreenElement()));
   // Provider documents do not receive the parent's fullscreenchange event.
   // Notify the active frame even when its rounded viewport size is unchanged.
   const frame=document.querySelector('.casino-game-content iframe') as HTMLIFrameElement|null;
   frame?.contentWindow?.postMessage({type:'casino:viewport-changed'},window.location.origin);
  };
  window.addEventListener('resize',update);
  window.addEventListener('orientationchange',update);
  screen.orientation?.addEventListener?.('change',update);
  document.addEventListener('fullscreenchange',nativeChange);
  document.addEventListener('webkitfullscreenchange' as any,nativeChange);
  document.addEventListener('MSFullscreenChange' as any,nativeChange);
  void requestCasinoLandscape();
  return()=>{
   window.removeEventListener('resize',update);
   window.removeEventListener('orientationchange',update);
   screen.orientation?.removeEventListener?.('change',update);
   document.removeEventListener('fullscreenchange',nativeChange);
   document.removeEventListener('webkitfullscreenchange' as any,nativeChange);
   document.removeEventListener('MSFullscreenChange' as any,nativeChange);
   void releaseCasinoLandscape();
  };
 },[]);
 // The stage is always a full-bleed overlay, so leaving native fullscreen (Esc,
 // gesture, orientation change) never drops the game into a broken small box.
 useEffect(()=>{
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return()=>{document.body.style.overflow=overflow;};
 },[]);
 useEffect(()=>{
  const message=(event:MessageEvent)=>{
   if(event.origin!==window.location.origin)return;
   const frame=document.querySelector('.casino-game-content iframe') as HTMLIFrameElement|null;
   if(!frame||event.source!==frame.contentWindow)return;
   if(event.data?.type==='casino:fullscreen')void requestCasinoLandscape({retry:true});
   if(event.data?.type==='casino:exit')exit();
  };
  window.addEventListener('message',message);return()=>window.removeEventListener('message',message);
 });
 return <div className="casino-game-root">
   {portrait&&touch&&!dismissRotate?<div className="casino-rotate-hint" role="status">
    <RotateCw size={28}/>
    <p>{t("Rrotullo telefonin horizontalisht për ekran më të gjerë.")}</p>
    <button type="button" onClick={()=>setDismissRotate(true)} className="casino-rotate-hint-btn">{t("Vazhdo gjithsesi")}</button>
   </div>:null}
  <div className={'casino-game-stage'+(portrait&&(!touch||dismissRotate)?' casino-game-rotated':'')}>
   <div className="casino-game-toolbar flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-white/20 bg-slate-950 px-2 pt-[env(safe-area-inset-top)] text-white">
    <button type="button" onClick={exit} disabled={closing} aria-label={t("Kthehu te kazinoja")}
     className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-bold hover:bg-white/10 disabled:opacity-60"><ArrowLeft size={18}/>{closing?'Duke mbyllur…':'Kthehu'}</button>
    <span aria-live="polite" className="min-w-0 flex-1 truncate text-center text-sm font-bold">{error||title}</span>
    {supported?<button type="button" onClick={toggleFullscreen} aria-label={native?'Dil nga ekrani i plotë':'Ekran i plotë horizontal'} className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg px-2 text-xs hover:bg-white/10">
     {native?<Minimize2 size={18}/>:<Maximize2 size={18}/>}<span>{native?'Dil nga ekrani i plotë':'Ekran i plotë'}</span>
    </button>:<span className="w-2 shrink-0"/>}
   </div>
   <div className="casino-game-content relative min-h-0 flex-1">{children}</div>
  </div>
 </div>;
}
