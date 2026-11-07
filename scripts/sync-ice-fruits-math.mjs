/** Offline reproducible source port, with the user-selected original-client paylines. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {classicReelReturn} from '../server/casino/classic-reel-return.mjs';
const output=new URL('../server/casino/ice-fruits-data.json',import.meta.url),data=JSON.parse(await readFile(output,'utf8'));
const source=new URL('../server/casino/slotopol-source/',import.meta.url);
const yaml=await readFile(new URL('icefruits6x3_data.yaml',source),'utf8'),rule=await readFile(new URL('icefruits6x3_rule.go',source),'utf8');
const table=rule.match(/var LinePay\s*=\s*[^\{]+\{([\s\S]*?)\r?\n\}/)[1];
data.pay=[...table.matchAll(/\{([^{}]*)\}/g)].map(m=>m[1].trim()?m[1].split(',').map(Number):[]);
data.scatterPay=JSON.parse('['+rule.match(/var ScatPay\s*=\s*[^\{]+\{([^}]*)\}/)[1]+']');
data.reels={};let key;
for(const line of yaml.split(/\r?\n/)){
 const header=line.match(/^(\d+\.\d+):\s*$/);if(header){key=String(Number(header[1]));data.reels[key]=[];continue;}
 const row=line.match(/^\s*-\s*(\[[\d,\s]+\])/);if(row&&key)data.reels[key].push(JSON.parse(row[1]));
}
const metadata=JSON.parse(await readFile(new URL('../server/casino/agt-metadata/6megaice.json',import.meta.url),'utf8'));
data.lines=metadata.start.lines.map(matrix=>Array.from({length:6},(_,x)=>matrix.findIndex(row=>row[x]===1)));
assert.equal(data.lines.length,20);assert.ok(data.lines.every(line=>line.every(y=>y>=0&&y<3)));
for(let s=1;s<=8;s++)assert.deepEqual(metadata.restore.pay_table[data.symbols[s-1]].slice(1),s===2?data.scatterPay:data.pay[s-1]);
data.returns={};
for(const [rtp,reels]of Object.entries(data.reels)){
 assert.equal(reels.length,6);for(const reel of reels){assert.ok(reel.length>=3&&reel.every(s=>Number.isInteger(s)&&s>=1&&s<=8));for(let stop=0;stop<reel.length;stop++)assert.ok([0,1,2].filter(y=>reel[(stop+y)%reel.length]===2).length<=1);}
 data.returns[rtp]=classicReelReturn(reels,data.pay,data.scatterPay);assert.ok(Math.abs(data.returns[rtp].rtp-Number(rtp))<.00001);
}
await writeFile(output,JSON.stringify(data,null,2)+'\n');
console.log(`PASS ${Object.keys(data.reels).length} Ice Fruits source reel profiles, independently verified RTP, original-client twenty paylines and eight native symbol/paytable mappings`);
