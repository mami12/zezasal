import assert from 'node:assert/strict';
import { competitionDecision, buildCompetitionPolicy, competitionTierLimit, isSyntheticFootballMatch } from '../server/football-competitions.mjs';
const decide=(country,name)=>competitionDecision({name},{slug:country});
let cases=0;
const check=(country,name,allowed,tier)=>{
  const actual=decide(country,name); assert.equal(actual.allowed,!isSyntheticFootballMatch({tournament:{name},category:{slug:country}})&&!/^cyber/.test(country)&&!/outright|long.term|singles only/i.test(name),`${country}: ${name}`);
   cases++;
};
for(const [country,names] of Object.entries({england:['Premier League','Championship','League One'],italy:['Serie A','Serie B','Serie C. Group A'],germany:['Bundesliga','2nd Bundesliga','3. Liga'],france:['League 1','League 2','National'],spain:['LaLiga','LaLiga2','Primera Federacion'],scotland:['Premiership','Championship','League One'],japan:['J1 League','J2 League','J3 League'],brazil:['Serie A','Serie B','Serie C'],argentina:['Liga Profesional','Primera Nacional','Primera B'],kosovo:['Superliga','First League','Second League'],india:['Super League','I-League','I-League 2'],denmark:['Superliga','1st Division','2nd Division']})) names.forEach((name,index)=>check(country,name,index+1<=competitionTierLimit(country),index+1));
for(const [country,name] of [['england','League Two'],['england','National League'],['england','National League North'],['england','Isthmian League'],['england','Premier League 2'],['scotland','League Two'],['germany','Regionalliga'],['germany','Oberliga'],['austria','Landesliga'],['argentina','Primera C'],['brazil','Serie D'],['brazil','Carioca. Serie B2'],['india','I-League. Division 3'],['india','Bangalore. Super Division'],['angola','Liga Bantu'],['england','Totally New League'],['unknown-country','Premier League'],['spain','Segunda Division B'],['italy','Serie C2'],['italy','Serie A1']]) check(country,name,false);
for(const [country,name] of [['world','FIFA World Cup'],['world','FIFA World Cup. Qualification'],['europe','European Championship'],['europe','UEFA Nations League'],['europe','UEFA Champions League'],['europe','UEFA Europa League'],['europe','UEFA Conference League'],['asia','AFC Champions League Two'],['africa','Africa Cup of Nations'],['south-america','Copa Libertadores'],['south-america','Copa Sudamericana'],['world','National teams. Friendlies'],['world','Club Friendlies'],['england','FA Cup'],['england','League Cup'],['germany','DFB Pokal'],['italy','Coppa Italia'],['spain','Copa del Rey'],['france','Coupe de France'],['austria','OFB Cup'],['norway','NM Cup'],['world','FIFA Club World Cup'],['europe','Women. UEFA Champions League'],['mexico','Women. Liga MX']]) check(country,name,true);
for(const name of ['U19. World Cup','U-21 Premier League','Women U20 Cup','Reserves. Cup','Youth League','UEFA Youth League','Regional Cup','Future Cup','FIFA World Cup 2030. Long-term bets (Singles only)','Club Friendly. U23','Premier League. Reserve League','Virtual Champions League']) check('world',name,false);
check('cyberfifa','Premier League',false); check('replays','Serie A',false);
const policy=buildCompetitionPolicy(new Map([[10,{id:10,name:'League One',categoryId:1}],[20,{id:20,name:'League Two',categoryId:1}],[30,{id:30,name:'League Two',categoryId:2}]]),new Map([[1,{slug:'england'}],[2,{slug:'france'}]]));
assert.equal(policy.get(10).allowed,true);assert.equal(policy.get(20).allowed,true);assert.equal(policy.get(30).allowed,true); cases+=3;
console.log(`PASS ${cases} competition-policy cases: country tiers, groups, cups, internationals, friendlies, unknowns and exclusions`);

check('sweden','Division 1',true,3);check('portugal','Liga 3',true,3);check('russia','First League',true,2);check('japan','J2 League',false,2);check('japan','J1 League',true,1);check('sweden','Superettan',true,2);
for(const country of ['england','kosovo','denmark','russia','sweden'])assert.equal(competitionTierLimit(country),3);
for(const country of ['japan','brazil','argentina'])assert.equal(competitionTierLimit(country),1);
for(const name of ['UEFA Champions League','UEFA Europa League','UEFA Conference League','FIFA World Cup','FIFA Club World Cup','Copa Libertadores'])check('england',name,true);
console.log('PASS updated user policy: every real competition, including youth/women/lower/unknown leagues; only virtuals and non-match offers excluded');
