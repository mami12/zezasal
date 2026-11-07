import ShotsOnTargetComparison from './ShotsOnTargetComparison';
import {ArrowLeft,Star,X,Bell,BellRing} from 'lucide-react';
import{useNavigate}from'react-router-dom';
import type{Match}from'../../types';
import{useLanguage}from'../../context/LanguageContext';
import{useFavorites}from'../../context/FavoritesContext';
import CountryFlag from'../Sports/CountryFlag';
export default function ZshopScoreboard({match}:{match:Match}){
 const {lang,t}=useLanguage(),navigate=useNavigate(),{isFavorite,toggleFavorite,isAlertEnabled,toggleAlert}=useFavorites();
 const live=match.status==='LIVE',finished=match.status==='ENDED',date=new Date(match.startTime);
 const periods:Record<string,string>=lang==='en'?{'1H':'1st half','2H':'2nd half',HT:'Half-time',FT:'Finished'}:{'1H':'Pjesa e parë','2H':'Pjesa e dytë',HT:'Pushim',FT:'Përfunduar','First Half':'Pjesa e parë','Second Half':'Pjesa e dytë','Extra Time':'Zgjatje'};
 const phase=match.period?periods[match.period]??match.period:'';
 const minute=live?`${match.currentMinute??'—'}′${phase?' · '+phase:''}`:date.toLocaleString(lang==='en'?'en-GB':'sq-AL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 return <section className="zshop-scoreboard" aria-label={t('Rezultati dhe statistikat e ndeshjes')}>
  <div className="zshop-scoreboard-title"><button type="button" onClick={()=>navigate('/')} aria-label={t('Kthehu te lista e ndeshjeve')}><ArrowLeft size={15}/><CountryFlag country={match.tournament?.category?.name} countryCode={match.tournament?.category?.countryCode}/><span>{[match.tournament?.category?.name,match.tournament?.name].filter(Boolean).join(' / ')}</span></button><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={()=>toggleFavorite(String(match.id))} aria-label={isFavorite(String(match.id))?t('Hiq nga të preferuarat'):t('Shto te të preferuarat')} aria-pressed={isFavorite(String(match.id))}><Star size={16} fill={isFavorite(String(match.id))?'#d29500':'none'}/></button><button type="button" onClick={()=>toggleAlert(String(match.id))} aria-label={isAlertEnabled(String(match.id))?t('Çaktivizo njoftimet'):t('Aktivizo njoftimet')} aria-pressed={isAlertEnabled(String(match.id))}>{isAlertEnabled(String(match.id))?<BellRing size={16}/>:<Bell size={16}/>}</button><button type="button" onClick={()=>navigate('/')} aria-label={t('Mbyll ndeshjen')}><X size={18}/></button></div></div>
    <div className="zshop-scoreboard-picture is-prematch" style={{backgroundImage:`url("${import.meta.env.BASE_URL}zshop/sport-prematch.png")`}}>
   <div className="zshop-score-table"><div><strong>{finished?(lang==='en'?'FULL TIME':'PËRFUNDUAR'):live?(lang==='en'?'LIVE':'NË LOJË'):(lang==='en'?'PREMATCH':'PARA FILLIMIT')}</strong><span title={t('Gola')}>⚽</span><span title={t('Kartonë gjithsej')}>🟨</span><span title={lang==='en'?'Corners':'Goditje këndore'}>⚑</span></div>
    {([{team:match.homeTeam,goals:match.homeScore,cards:match.cards?.home,corners:match.corners?.home},{team:match.awayTeam,goals:match.awayScore,cards:match.cards?.away,corners:match.corners?.away}]).map((row,i)=><div key={i}><strong title={row.team}>{row.team}</strong><span className="zs-score">{live||finished?row.goals??'—':'—'}</span><span>{row.cards??'—'}</span><span>{row.corners??'—'}</span></div>)}
   </div>
  </div>{(live||finished||match.shotsOnTarget||match.fouls||match.goalIntervals)&&<ShotsOnTargetComparison values={match.shotsOnTarget} fouls={match.fouls} intervals={match.goalIntervals} homeTeam={match.homeTeam} awayTeam={match.awayTeam}/>}<div className={`zshop-detail-info ${live?'is-live':''}`}><img src={import.meta.env.BASE_URL+'zshop/match-field.svg'} width="23" height="13" alt=""/><span>{minute}</span></div>
 </section>;
}
