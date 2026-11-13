import {useState} from 'react';
import {ChevronDown,ChevronUp,CircleDot,Flag,Activity,Target} from 'lucide-react';
import {useLiveFeed,useLivePatch} from '../../api/liveFeed';
import {useLanguage} from '../../context/LanguageContext';
import type {Match,MatchEvent} from '../../types';
import {retainEventPlayerNames} from '../../utils/eventPlayers';

interface Props{matchId:string;homeTeam:string;awayTeam:string;eventsOnly?:boolean;snapshot?:Match}
type Pair={home:number;away:number};
const pair=(value:Pair|null|undefined):value is Pair=>
  !!value&&['home','away'].every(side=>Number.isFinite(value[side as keyof Pair])&&value[side as keyof Pair]>=0);

function eventIdentity(event:MatchEvent){
  return event.id??[event.type,event.team,event.minute,event.minuteLabel,event.player].join('|');
}

export default function PitchTracker({matchId,homeTeam,awayTeam,eventsOnly=false,snapshot}:Props){
  const {lang}=useLanguage(),patch=useLivePatch(matchId),{matchEvents}=useLiveFeed();
  const [open,setOpen]=useState(true),english=lang==='en';
  const getStat=(key:'shots'|'shotsOnTarget'|'fouls'|'corners'|'cards'|'yellowCards'|'redCards')=>
    patch?.[key]??snapshot?.[key]??null;
  const hasColors=pair(getStat('yellowCards'))||pair(getStat('redCards'));
  const rows=[
    {key:'shots',label:english?'Shots':'Goditje'},
    {key:'shotsOnTarget',label:english?'Shots on target':'Goditje në portë'},
    {key:'fouls',label:english?'Fouls':'Faulle'},
    {key:'corners',label:english?'Corners':'Kornera'},
    {key:'yellowCards',label:english?'Yellow cards':'Kartonë të verdhë'},
    {key:'redCards',label:english?'Red cards':'Kartonë të kuq'},
    ...(!hasColors?[{key:'cards',label:english?'Cards (total)':'Kartonë gjithsej'}]:[]),
  ].map(row=>({label:row.label,key:row.key,value:getStat(row.key as 'shots'|'shotsOnTarget'|'fouls'|'corners'|'cards'|'yellowCards'|'redCards')}))
   .filter((row):row is {label:string;key:string;value:Pair}=>pair(row.value));

  const archived=(snapshot?.events??[]).filter(event=>event.matchId===String(matchId));
  const pushed=(matchEvents??[]).filter(event=>event.matchId===String(matchId));
  // The primary event list remains authoritative for event existence.
  // Supplementary providers may add a named actor, never invent a missing
  // original goal/foul/card. Names inherit only for the same incident ID.
  const official=retainEventPlayerNames(pushed.length?pushed:archived,archived);
  const unique=(items:MatchEvent[])=>{
    const seen=new Set<string>();
    return items.filter(event=>{
      const id=eventIdentity(event);
      if(seen.has(id))return false;
      seen.add(id);return true;
    }).sort((a,b)=>b.minute-a.minute||String(b.minuteLabel??'').localeCompare(String(a.minuteLabel??'')));
  };
  const mainEvents=unique(official);
  const supplementary=unique((snapshot?.supplementalEvents??[])
    .filter(event=>event.matchId===String(matchId)&&Number.isFinite(event.minute)));
  if((eventsOnly||!rows.length)&&!mainEvents.length&&!supplementary.length)return null;

  const eventLabel=(event:MatchEvent)=>{
    const type=String(event.type??'').toLowerCase();
    const text=String(event.text??'').toLowerCase();
    if(type==='goal')return english?'Goal':'Gol';
    if(type==='corner')return english?'Corner':'Korner';
    if(type==='yellow_card'||type==='card'&&/yellow|verd/.test(text))
      return english?'Yellow card':'Karton i verdhë';
    if(type==='red_card'||type==='card'&&/red|kuq/.test(text))
      return english?'Red card':'Karton i kuq';
    if(type==='card')return english?'Card (colour unknown)':'Karton (ngjyra e panjohur)';
    if(type==='foul')return english?'Foul':'Faull';
    if(type==='shot'&&event.onTarget===true||/shot on target/.test(text))
      return english?'Shot on target':'Goditje në portë';
    if(type==='shot')return english?'Shot':'Goditje';
    return event.text||event.type;
  };
  const eventIcon=(event:MatchEvent)=>{
    const type=String(event.type??'').toLowerCase(),text=String(event.text??'').toLowerCase();
    if(type==='yellow_card'||type==='card'&&/yellow|verd/.test(text))
      return <span className="h-4 w-2.5 rounded-[2px] border border-yellow-300 bg-yellow-400" aria-hidden="true"/>;
    if(type==='red_card'||type==='card'&&/red|kuq/.test(text))
      return <span className="h-4 w-2.5 rounded-[2px] border border-red-300 bg-red-500" aria-hidden="true"/>;
    if(type==='goal')return <CircleDot size={16} className="text-emerald-300"/>;
    if(type==='corner')return <Flag size={15} className="text-slate-300"/>;
    if(type==='shot')return <Target size={15} className="text-slate-300"/>;
    return <Activity size={15} className="text-slate-400"/>;
  };
  const eventRows=(items:MatchEvent[],supplemental:boolean)=>items.map(event=>{
    const team=event.team==='home'?homeTeam:awayTeam;
    return <article key={(supplemental?'extra:':'main:')+eventIdentity(event)}
      className="grid grid-cols-[2.8rem_1.25rem_minmax(0,1fr)] items-start gap-2 border-b border-slate-700/50 px-3 py-2.5 last:border-b-0 sm:px-4">
      <time className="pt-0.5 text-right font-mono text-xs font-semibold tabular-nums text-slate-300">
        {event.minuteLabel??event.minute}′
      </time>
      <span className="flex h-5 items-center justify-center">{eventIcon(event)}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-slate-100">{eventLabel(event)}</span>
          {event.player?.trim()&&<span className="break-words text-xs font-medium text-white">{event.player.trim()}</span>}
        </div>
        <p className="mt-0.5 break-words text-[11px] text-slate-400">
          {team}{supplemental&&event.source?' · '+event.source:''}
        </p>
      </div>
    </article>;
  });

  return <section data-testid="match-tracker" className="mt-3 overflow-hidden rounded-lg border border-slate-700/80 bg-[#121b28] text-slate-100"
    aria-label={english?'Live match statistics':'Statistikat e ndeshjes'}>
    <button type="button" onClick={()=>setOpen(value=>!value)} aria-expanded={open}
      className="flex min-h-11 w-full items-center justify-between gap-3 bg-[#1b2736] px-3 py-2.5 text-left text-sm font-semibold sm:px-4">
      <span>{english?'Match statistics and events':'Statistika dhe ngjarje'}</span>
      {open?<ChevronUp size={17}/>:<ChevronDown size={17}/>}
    </button>
    {open&&<>
      {!eventsOnly&&rows.length>0&&<div className="px-3 pb-3 pt-3 sm:px-4">
        <div className="mb-2 grid grid-cols-[3rem_minmax(0,1fr)_3rem] gap-2 text-[11px] font-medium text-slate-400">
          <span className="truncate text-center" title={homeTeam}>{homeTeam}</span>
          <span className="text-center">{english?'Statistics':'Statistikat'}</span>
          <span className="truncate text-center" title={awayTeam}>{awayTeam}</span>
        </div>
        <div className="divide-y divide-slate-700/50 rounded-md border border-slate-700/60">
          {rows.map(({key,label,value})=><div key={key} data-stat-key={key} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2 px-2 py-2">
            <strong className="text-center font-mono text-sm font-semibold tabular-nums">{value.home}</strong>
            <span className="text-center text-xs text-slate-300">{label}</span>
            <strong className="text-center font-mono text-sm font-semibold tabular-nums">{value.away}</strong>
          </div>)}
        </div>
      </div>}
      {mainEvents.length>0&&<div className="border-t border-slate-700/70">
        <div className="bg-[#192332] px-3 py-2 text-xs font-semibold text-slate-300 sm:px-4">
          {english?'Match events':'Ngjarjet e ndeshjes'}
        </div>
        <div className="zshop-tracker-events" role="region" tabIndex={0} aria-label={english?'Main match event history':'Historiku i ngjarjeve'}>
          {eventRows(mainEvents,false)}
        </div>
      </div>}
      {supplementary.length>0&&<div className="border-t border-slate-700/70">
        <div className="bg-[#192332] px-3 py-2 text-xs font-semibold text-slate-300 sm:px-4">
          {english?'Supplemental verified incidents':'Ngjarje të verifikuara nga API shtesë'}
        </div>
        <div className="zshop-tracker-events" role="region" tabIndex={0} aria-label={english?'Supplemental provider event history':'Historiku nga API-të shtesë'}>
          {eventRows(supplementary,true)}
        </div>
      </div>}
    </>}
  </section>;
}
