import{useState}from'react';
import{ChevronDown,ChevronUp}from'lucide-react';
import{useLiveFeed,useLivePatch}from'../../api/liveFeed';
import{useLanguage}from'../../context/LanguageContext';
import{translateMatchEventText}from'../../utils/sportsbookLabels';
import type{Match}from'../../types';
interface Props{matchId:string;homeTeam:string;awayTeam:string;eventsOnly?:boolean;snapshot?:Match}
/** Captured zshop presentation; every counter/event is an observed provider fact. */
export default function PitchTracker({matchId,homeTeam,awayTeam,eventsOnly=false,snapshot}:Props){
 const{t,lang}=useLanguage(),patch=useLivePatch(matchId),{matchEvents}=useLiveFeed(),[open,setOpen]=useState(true);
 const label=(key:string)=>key==='shotsOnTarget'?(lang==='en'?'Shots on target':'Goditjet në portë'):t(key);
 const counters=[['shotsOnTarget',patch?.shotsOnTarget??snapshot?.shotsOnTarget],['Faulle',patch?.fouls??snapshot?.fouls],['tracker.corners',patch?.corners??snapshot?.corners],['tracker.cards',patch?.cards??snapshot?.cards]].filter(([,v])=>v!=null) as [string,{home:number;away:number}][];
 const seen=new Set<string>(),events=[...(matchEvents??[])].reverse().filter(e=>{if(e.matchId!==String(matchId))return false;const key=e.id??[e.minuteLabel??e.minute,e.type,e.team,e.text].join('|');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
 if((eventsOnly||!counters.length)&&!events.length)return null;
 return <section className="zshop-tracker" aria-label={t('Statistikat gjatë lojës')}><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}><span className="flex items-center gap-2"><img width="23" height="13" src={import.meta.env.BASE_URL+'zshop/match-field.svg'} alt=""/>{lang==='en'?'Match tracker':'Ecuria e ndeshjes'}</span>{open?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>{open&&<>{!eventsOnly&&counters.length>0&&<div className="zshop-tracker-stats">{counters.map(([name,values])=><div className="zshop-tracker-stat" key={name} title={`${homeTeam} / ${awayTeam}`}><span>{label(name)}</span><strong>{values.home} - {values.away}</strong></div>)}</div>}{events.length>0&&<div className="zshop-tracker-events">{events.map((event,i)=><div key={i}><time>{event.minuteLabel??event.minute}′</time><span>{translateMatchEventText(event.text,homeTeam,awayTeam,lang)}</span></div>)}</div>}</>}</section>;
}
