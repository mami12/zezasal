import {useLanguage} from '../../context/LanguageContext';
import './shotsOnTarget.css';
type Pair={home:number|null;away:number|null};
type Interval={label:string;from:number;to:number;home:number;away:number};
export function shotComparison(values?:Pair|null){
 const valid=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=0?v:null;
 const home=valid(values?.home),away=valid(values?.away),total=home!=null&&away!=null?home+away:0;
 return {home,away,homeShare:total&&home!=null?home/total*100:0,awayShare:total&&away!=null?away/total*100:0};
}
function StatRow({label,field,values}:{label:string;field:'shots-on-target'|'fouls';values?:Pair|null}){
 const stats=shotComparison(values),total=stats.home!=null&&stats.away!=null?stats.home+stats.away:null;
 return <div className="zs-stat-row" data-stat={field}>
  <strong className="zs-stat-home">{stats.home??'—'}</strong>
  <div className="zs-stat-center"><span>{label}</span><div className="zs-stat-bar" role="img" aria-label={`${label}: ${stats.home??'—'} - ${stats.away??'—'}`}>
   {total!==null&&total>0&&<><i className="zs-stat-home-bar" style={{width:stats.homeShare+'%'}}/><i className="zs-stat-away-bar" style={{width:stats.awayShare+'%'}}/></>}
  </div></div>
  <strong className="zs-stat-away">{stats.away??'—'}</strong>
 </div>;
}
export default function ShotsOnTargetComparison({values,fouls,intervals,homeTeam,awayTeam}:{values?:Pair|null;fouls?:Pair|null;intervals?:Interval[]|null;homeTeam:string;awayTeam:string}){
 const {lang}=useLanguage(),english=lang==='en';
 return <section className="zs-match-stats" aria-label={english?'Match statistics':'Statistikat e ndeshjes'}>
  <div className="zs-match-stats-heading"><span>{homeTeam}</span><strong>{english?'MATCH STATS':'STATISTIKAT'}</strong><span>{awayTeam}</span></div>
  <StatRow field="shots-on-target" label={english?'Shots on target':'Goditje në portë'} values={values}/>
  <StatRow field="fouls" label={english?'Fouls':'Faulle'} values={fouls}/>
  {intervals?.length?<div className="zs-intervals" data-stat="goal-intervals">
   <div className="zs-intervals-heading"><strong>{english?'Goals by 15-minute interval':'Golat sipas intervalit 15-minutësh'}</strong><span>{english?'HOME':'VENDAS'} · {english?'AWAY':'MIKËT'}</span></div>
   <div className="zs-interval-grid">{intervals.map(interval=>{
    const total=interval.home+interval.away,homeShare=total?interval.home/total*100:0;
    return <div className="zs-interval-cell" key={interval.label}>
     <span className="zs-interval-label">{interval.label}</span>
     <span className="zs-interval-values"><b>{interval.home}</b><i>–</i><b>{interval.away}</b></span>
     <span className="zs-interval-bar" role="img" aria-label={`${interval.label}: ${interval.home} - ${interval.away}`}>
      {total>0&&<><i className="zs-stat-home-bar" style={{width:homeShare+'%'}}/><i className="zs-stat-away-bar" style={{width:(100-homeShare)+'%'}}/></>}
     </span>
    </div>;
   })}</div>
  </div>:null}
 </section>;
}
