import {useId,useRef,useState} from 'react';
import {Info,X} from 'lucide-react';
import {useLanguage} from '../../context/LanguageContext';
import {marketHelp} from '../../utils/marketHelp';
import type {Market} from '../../types';
import './marketInfo.css';

export default function MarketInfoButton({market,title}:{market:Market;title:string}){
 const{lang}=useLanguage(),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 const[opened,setOpened]=useState(false),help=marketHelp(market,lang);
 const close=()=>{dialog.current?.close();setOpened(false);trigger.current?.focus();};
 return <>
  <button ref={trigger} type="button" className="market-info-trigger" data-market-info aria-haspopup="dialog" aria-expanded={opened} aria-label={(lang==='en'?'Explain market: ':'Shpjegimi i tregut: ')+title} onClick={e=>{e.stopPropagation();dialog.current?.showModal();setOpened(true);}}><Info size={15} aria-hidden/><span>Info</span></button>
  <dialog ref={dialog} className="market-info-dialog" aria-labelledby={id} onCancel={()=>setOpened(false)} onClose={()=>{setOpened(false);trigger.current?.focus();}} onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}}>
   <header><div><small>{lang==='en'?'How this market works':'Si funksionon ky treg'}</small><h2 id={id}>{title}</h2></div><button type="button" autoFocus onClick={close} aria-label={lang==='en'?'Close explanation':'Mbyll shpjegimin'}><X size={20}/></button></header>
   <div className="market-info-body"><p>{help.summary}</p>{help.details.length>0&&<ul>{help.details.map((detail,i)=><li key={i}>{detail}</li>)}</ul>}</div>
   <footer><button type="button" onClick={close}>{lang==='en'?'Understood':'E kuptova'}</button></footer>
  </dialog>
 </>;
}
