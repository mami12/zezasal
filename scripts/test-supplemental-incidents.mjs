import assert from 'node:assert/strict';
import {fotMobIncidents,backupIncidents,storeSupplementalIncidents,SUPPLEMENTAL_INCIDENT_SQL}
 from '../server/stats-providers/supplemental-incidents.mjs';
import {enrichPrimaryActors} from '../server/stats-providers/primary-actor-enrichment.mjs';

const details={header:{teams:[{id:10},{id:20}]},content:{
 matchFacts:{events:{events:[
  {eventId:1,type:'Goal',isHome:true,time:'23',player:{id:101,name:'Scorer One'}},
  {eventId:2,type:'Card',isHome:false,time:'45+2',player:{name:'Player Booked'},card:'Yellow'},
  {eventId:3,type:'Foul',isHome:true,time:'64',player:{name:'Foul Player'}}
 ]}},
 shotmap:{shots:[
  {id:31,teamId:10,playerId:101,playerName:'Scorer One',min:23,isOnTarget:true,eventType:'Goal'},
  {id:32,teamId:20,playerName:'Shooter',min:75,minAdded:null,isOnTarget:false,eventType:'Miss'},
  {id:33,teamId:10,playerName:'Unknown minute',isOnTarget:true}
 ]}
}};
const incidents=fotMobIncidents(details);
assert.equal(incidents.length,6);
assert.deepEqual(incidents.map(x=>x.kind),['goal','card','foul','shot','shot','shot']);
assert.equal(incidents[1].minute,45);
assert.equal(incidents[1].addedMinute,2);
assert.equal(incidents[1].playerName,'Player Booked');
assert.equal(incidents[3].onTarget,true);
assert.equal(incidents[4].minute,75);
assert.equal(incidents[5].minute,null,'Missing event time stays unknown');
const backup=backupIncidents({events:[{id:'a',type:'goal',team:'home',minute:23,player:'Other Scorer'}],
 cardEvents:[{id:'b',type:'card',team:'away',minute:30,playerName:'Player B'}]});
assert.deepEqual(backup.map(x=>x.kind),['goal','card']);

const calls=[];
const execute=async(sql,args)=>{calls.push({sql,args});return {rowCount:1};};
assert.match(SUPPLEMENTAL_INCIDENT_SQL,/primary key\(match_id,provider,provider_event_id,kind\)/);
assert.deepEqual(await storeSupplementalIncidents(8000000000001,'fotmob',555,incidents,{execute,payload:details}),
 {stored:6});
assert.equal(calls.length,2);
assert.match(calls[0].sql,/app_supplemental_match_incident/);
assert.deepEqual(JSON.parse(calls[0].args[3]).map(x=>x.player_name).slice(0,3),
 ['Scorer One','Player Booked','Foul Player']);
assert.match(calls[1].sql,/app_supplemental_match_snapshot/);
assert.equal((await storeSupplementalIncidents(11,'unknown',55,incidents,{execute})).stored,0);

const primary=(overrides={})=>({
 provider_event_id:'zz1',kind:'goal',team:'home',minute:23,own_goal:false,
 player_name:null,aiscore_verified:false,fotmob_verified:false,
 supplemental_verified:false,...overrides
});
calls.length=0;
assert.equal((await enrichPrimaryActors(123,'apifootball',[primary()],[
 {kind:'goal',team:'home',minute:23,playerName:'Scorer One'}
],{execute})).updated,1);
assert.equal(calls[0].args[3],'Scorer One');
assert.match(calls[0].sql,/own_goal=false/);
for(const facts of [
 [primary({own_goal:null})],
 [primary({own_goal:true})],
 [primary({player_name:'Contradiction'})],
 [primary(),primary({provider_event_id:'zz2'})]
]){
 calls.length=0;
 const result=await enrichPrimaryActors(123,'apifootball',facts,
 [{kind:'goal',team:'home',minute:23,playerName:'Scorer One'}],{execute});
 assert.equal(result.updated,0);
 assert.equal(calls.length,0);
}
calls.length=0;
assert.equal((await enrichPrimaryActors(123,'goalapi',[primary({kind:'card',own_goal:null,card_color:'red'})],
 [{kind:'card',team:'home',minute:23,playerName:'Booked',cardColor:'yellow'}],{execute})).updated,0);
assert.equal((await enrichPrimaryActors(123,'goalapi',[primary({kind:'card',own_goal:null,card_color:'red'})],
 [{kind:'card',team:'home',minute:23,playerName:'Booked',cardColor:'red'}],{execute})).updated,1);
console.log('PASS source-labelled actor, foul, card and FotMob shot archives; ambiguous identities rejected');
