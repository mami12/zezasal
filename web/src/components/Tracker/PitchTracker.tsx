import{useState}from'react';
import{ChevronDown,ChevronUp}from'lucide-react';
import{useLiveFeed,useLivePatch}from'../../api/liveFeed';
import{useLanguage}from'../../context/LanguageContext';
import{translateMatchEventText}from'../../utils/sportsbookLabels';
import type{Match}from'../../types';
import {retainEventPlayerNames} from '../../utils/eventPlayers';
interface Props{matchId:string;homeTeam:string;awayTeam:string;eventsOnly?:boolean;snapshot?:Match}
/** Captured zshop presentation; every counter/event is an observed provider fact. */
export default function PitchTracker({matchId,homeTeam,awayTeam,eventsOnly=false,snapshot}:Props){
 const{t,lang}=useLanguage(),patch=useLivePatch(matchId),{matchEvents}=useLiveFeed(),[open,setOpen]=useState(true);
 const label=(key:string)=>key==='shotsOnTarget'?(lang==='en'?'Shots on target':'Goditjet në portë'):t(key);
 const counters=[['shotsOnTarget',patch?.shotsOnTarget??snapshot?.shotsOnTarget],['Faulle',patch?.fouls??snapshot?.fouls],['tracker.corners',patch?.corners??snapshot?.corners],['tracker.cards',patch?.cards??snapshot?.cards]].filter(([,v])=>v!=null) as [string,{home:number;away:number}][];
 // The REST match-detail snapshot can contain an AiScore-confirmed scorer
 // even when the newest Zizobet socket event carries no player identity.
 // Merge display metadata only for the SAME primary event id/team/minute;
 // removed or corrected goals are never revived from a stale snapshot.
 const archived=(snapshot?.events??[]).filter(e=>e.matchId===String(matchId));
 const liveEvents=(matchEvents??[]).filter(e=>e.matchId===String(matchId));
 const latest=liveEvents.length?liveEvents:archived;
 // Keep the confirmed actor for every type of incident: goals, corners,
 // yellow/red cards and fouls. A later unnamed socket header must not erase
 // the label received for the exact same event via REST or an earlier push.
 const named=retainEventPlayerNames(latest,archived);
 const seen=new Set<string>(),events=[...named].reverse().filter(e=>{
   const key=e.id??[e.minuteLabel??e.minute,e.type,e.team,e.text].join('|');
   if(seen.has(key))return false;seen.add(key);return true;
 });
 if((eventsOnly||!counters.length)&&!events.length)return null;
 return <section className="zshop-tracker" aria-label={t('Statistikat gjatë lojës')}><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}><span className="flex items-center gap-2"><img width="23" height="13" src={import.meta.env.BASE_URL+'zshop/match-field.svg'} alt=""/>{lang==='en'?'Match tracker':'Ecuria e ndeshjes'}</span>{open?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>{open&&<>{!eventsOnly&&counters.length>0&&<div className="zshop-tracker-stats">{counters.map(([name,values])=><div className="zshop-tracker-stat" key={name} title={`${homeTeam} / ${awayTeam}`}><span>{label(name)}</span><strong>{values.home} - {values.away}</strong></div>)}</div>}{events.length>0&&<div className="zshop-tracker-events" role="region" tabIndex={0} aria-label={lang==='en'?'Match event history':'Historiku i ngjarjeve'}>{events.map((event,i)=><div key={i}><time>{event.minuteLabel??event.minute}′</time><span>{translateMatchEventText(event.text,homeTeam,awayTeam,lang)}{event.player&&!String(event.text).toLowerCase().includes(event.player.toLowerCase()) ? ' · '+event.player : ''}</span></div>)}</div>}</>}</section>;
}
