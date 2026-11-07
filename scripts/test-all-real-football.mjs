import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {startZizoFeed} from '../server/zizobet-feed.mjs';
import {selectPublishedMatches} from '../server/board-settings.mjs';
const count=3500,rows=new Map();
const header={EN:{Sports:{1:{Regions:{9:{ID:9,Name:'Japan',Champs:{8:{ID:8,Name:'Unknown regional women U19 league',GameSmallItems:Object.fromEntries(Array.from({length:count},(_,i)=>[i+1,{ID:i+1,t1:1,t2:2,st:'2026-12-20T12:00:00Z'}]))}}}}}}}};
const request=async url=>{
 if(url.includes('getheader/teams'))return [{ID:1,Name:'Home',Sport:1},{ID:2,Name:'Away',Sport:1}];
 if(url.includes('getlivemarkets'))return {};
 if(url.includes('getprematchmarketsbysport'))return [];
 if(url.includes('headerformobilenew'))return {Games:[]};
 if(url.includes('sport/getheader/en'))return header;
 throw Error('No price snapshot in this fixture');
};
const feed=startZizoFeed({autoStart:false,request,connectMqtt:()=>({stop(){},pause(){},resume(){},setLiveIds(){}}),onMatch:row=>rows.set(row.match_id,row),onInfo(){},onOdds(){}});
try{await feed.tick();assert.equal(rows.size,count);assert.equal(selectPublishedMatches([...rows.values()],{prematchLimit:0}).rows.length,count);for(const row of rows.values()){assert.equal(row.tournament_name,'Unknown regional women U19 league');assert.equal(row.category_name,'Japan');}console.log('PASS 3500 real future unpriced youth/women/regional prematches retained; nested provider country/league preserved; no publication cap');}finally{feed.stop();await feed.drain();}
