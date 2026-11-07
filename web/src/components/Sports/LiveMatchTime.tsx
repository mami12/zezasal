import { useEffect, useRef, useState } from 'react';

/** Only the clock text ticks; changing seconds must not redraw every odd on the board. */
export default function LiveMatchTime({ minute=0, second=0, period, seconds=false }: {
  minute?:number; second?:number; period?:string|null; seconds?:boolean;
}) {
  const anchor=useRef({minute,second,at:Date.now()});
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{anchor.current={minute,second,at:Date.now()};setNow(Date.now());},[minute,second,period]);
  useEffect(()=> {
    if (/^(?:HT|FT|Break Time|Half Time|Ended)$/i.test(period??'')) return;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[period]);
  const total=Math.max(0,anchor.current.minute*60+anchor.current.second+Math.floor((now-anchor.current.at)/1000));
  return <>{Math.floor(total/60)}{seconds?':'+String(total%60).padStart(2,'0'):''}′</>;
}
