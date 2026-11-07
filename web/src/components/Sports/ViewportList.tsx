import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
export type WindowItem={key:string;estimate:number;matchId?:string;node:()=>ReactNode};
/** Variable-height windowing inside the existing sportsbook scroll container. */
export default function ViewportList({items,onVisible}:{items:WindowItem[];onVisible?:(ids:string[])=>void}){
 const root=useRef<HTMLDivElement>(null),sizes=useRef(new Map<string,number>()),[version,setVersion]=useState(0),[viewport,setViewport]=useState({top:0,height:900});
 const offsets=useMemo(()=>{const out=[0];for(const item of items)out.push(out[out.length-1]+(sizes.current.get(item.key)??item.estimate));return out;},[items,version]);
 useEffect(()=>{const el=root.current,parent=el?.closest('[data-sportsbook-scroll]');if(!el||!parent)return;let frame=0;const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const top=parent.getBoundingClientRect().top-el.getBoundingClientRect().top;setViewport(old=>old.top===top&&old.height===parent.clientHeight?old:{top,height:parent.clientHeight});});};measure();parent.addEventListener('scroll',measure,{passive:true});window.addEventListener('resize',measure);return()=>{parent.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);cancelAnimationFrame(frame);};},[]);
 let start=0,end=items.length;if(items.length>40){while(start<items.length&&offsets[start+1]<viewport.top-700)start++;end=start;while(end<items.length&&offsets[end]<viewport.top+viewport.height+900)end++;}
 const rendered=items.slice(start,end),ids=rendered.flatMap(i=>i.matchId?[i.matchId]:[]),idKey=ids.join(',');
 useEffect(()=>{onVisible?.(ids);},[idKey,onVisible]);
 useLayoutEffect(()=>{const el=root.current;if(!el)return;const observer=new ResizeObserver(entries=>{let changed=false;for(const entry of entries){const key=(entry.target as HTMLElement).dataset.windowKey;if(!key)continue;const height=entry.borderBoxSize?.[0]?.blockSize??entry.contentRect.height;if(height>0&&Math.abs((sizes.current.get(key)??0)-height)>1){sizes.current.set(key,height);changed=true;}}if(changed)setVersion(v=>v+1);});for(const child of el.querySelectorAll('[data-window-key]'))observer.observe(child);return()=>observer.disconnect();},[items,start,end]);
 return <div ref={root} data-windowed-list><div aria-hidden style={{height:offsets[start]}}/>{rendered.map(item=><div data-window-key={item.key} key={item.key} style={{display:"flow-root"}}>{item.node()}</div>)}<div aria-hidden style={{height:offsets[items.length]-offsets[end]}}/></div>;
}
