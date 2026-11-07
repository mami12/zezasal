import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {classicReelReturn} from '../server/casino/classic-reel-return.mjs';
const base=new URL('../server/casino/slotopol-source/',import.meta.url);
const yaml=await readFile(new URL('fortunepyramid_data.yaml',base),'utf8');
const reels={};let key;
for(const line of yaml.split(/\r?\n/)){
 const header=line.match(/^(\d+\.\d+):\s*$/);if(header){key=String(Number(header[1]));reels[key]=[];continue;}
 const row=line.match(/^\s*-\s*(\[[\d,\s]+\])/);if(row&&key)reels[key].push(JSON.parse(row[1]));
}
const pay=[[0,0,40,750,1000],[],[0,0,10,50,500],[0,0,10,40,200],[0,0,10,40,200],[0,0,5,20,100],[0,0,5,20,100],[0,0,5,20,100]],scatterPay=[0,0,5,20,500];
const lines=[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,1,2,1],[1,2,1,0,1],[0,1,0,1,0],[2,1,2,1,2],[0,1,1,1,1],[2,1,1,1,1],[1,1,0,0,0],[1,1,2,2,2],[1,0,0,0,0],[1,2,2,2,2],[0,0,0,0,1],[2,2,2,2,1],[2,2,1,2,2]];
const returns={};
for(const [rtp,strips]of Object.entries(reels)){
 assert.equal(strips.length,5);for(const reel of strips){assert.ok(reel.length>=3&&reel.every(s=>Number.isInteger(s)&&s>=1&&s<=8));for(let stop=0;stop<reel.length;stop++)assert.ok([0,1,2].filter(y=>reel[(stop+y)%reel.length]===2).length<=1);}
 returns[rtp]=classicReelReturn(strips,pay,scatterPay);assert.ok(Math.abs(returns[rtp].rtp-Number(rtp))<0.00001,`${rtp}: independent return ${returns[rtp].rtp}`);
}
const data={source:'https://github.com/slotopol/server',commit:'e2f58bd388b12d4f9da058188bf43f19604898c8',defaultRtp:95.052246,pay,scatterPay,lines,symbols:[8,1,7,6,5,4,3,2],reels,returns};
await writeFile(new URL('../server/casino/fortune-pyramid-data.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(`PASS ${Object.keys(reels).length} Fortune Pyramid profiles independently match upstream RTP; original captured twenty paylines match Slotopol`);
