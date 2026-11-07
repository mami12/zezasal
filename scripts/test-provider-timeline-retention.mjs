import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {startZizoFeed} from '../server/zizobet-feed.mjs';
import {serializeMatch} from '../server/collector.mjs';

const teams=[{ID:1,Name:'Home',Sport:1},{ID:2,Name:'Away',Sport:1}];
const regions=[{ID:1,Name:'England'}],champs=[{ID:1,Name:'Premier League'}];
const game={ID:7,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,MatchStatusID:10,Score:'1:0',MatchTime:75,StartTime:'2026-11-05T12:00:00Z'};
const timeline=[{id:'g23',type:'score_change',team:'home',gt:23},{id:'y45',type:'yellow_card',team:'away',gt:'45+2'}];
let time=200000,detailReads=0,lastRow;const infos=[];
const request=async url=>{
 if(url.includes('getheader/teams'))return teams;
 if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
 if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
 if(url.includes('headerformobilenew'))return {Games:[game],Teams:teams,Regions:regions,Championats:champs};
 if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
 if(url.includes('live/gamenew/7')){detailReads++;return {Match:{...game,GameID:7,EventStatus:10},gmk:[],TimeLines:timeline};}
 throw Error('Unexpected isolated provider request: '+url);
};
const feed=startZizoFeed({autoStart:false,request,now:()=>time,connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
 onMatch:row=>{lastRow=row;},onInfo:info=>infos.push(info),onOdds:()=>{}});
try{
 await feed.tick();assert.equal(detailReads,0,'unopened matches use the board header only');await feed.focus(lastRow.match_id);
 assert.equal(detailReads,1);assert.deepEqual(lastRow.raw.eventTimeline.map(e=>e.minuteLabel),['23','45+2']);
 assert.deepEqual(infos.at(-1).events.map(e=>e.minuteLabel),['23','45+2']);
 assert.deepEqual(serializeMatch(lastRow,[]).events.map(e=>e.minuteLabel),['23','45+2'],'cold REST snapshot carries provider times');
 time+=1000;await feed.tick();
 assert.equal(detailReads,1,'the lightweight header does not require another detail fetch');
 assert.deepEqual(lastRow.raw.eventTimeline.map(e=>e.minuteLabel),['23','45+2'],'header-only updates retain the complete timeline');
 assert.equal(infos.at(-1).events[0].minute,23,'current 75-minute clock cannot relabel an earlier incident');
 console.log('PASS provider timeline retention: real 23/45+2 incident minutes survive lightweight catalog updates and cold REST snapshots');
}finally{feed.stop();await feed.drain();}
