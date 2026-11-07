// Offline extraction of the pinned MIT-licensed Slotopol sources.
import {readFileSync,writeFileSync} from 'node:fs';
const file=new URL('../server/casino/fortune-teller-data.json',import.meta.url);
const text=readFileSync(new URL('../server/casino/slotopol-source/fortuneteller_data.yaml',import.meta.url),'utf8');
const reels={};let key;
for(const line of text.split(/\r?\n/)){
 const header=line.match(/^(\d+\.\d+):\s*$/);
 if(header){key=String(Number(header[1]));reels[key]=[];continue;}
 const row=line.match(/^\s*-\s*(\[[\d,\s]+\])\s*$/);
 if(row&&key)reels[key].push(JSON.parse(row[1]));
}
for(const [key,strips]of Object.entries(reels)){
 if(strips.length!==5||strips.some(reel=>reel.length<3||reel.some(symbol=>!Number.isInteger(symbol)||symbol<1||symbol>12)))throw Error('Invalid Fortune Teller reels '+key);
 for(const reel of strips)for(let stop=0;stop<reel.length;stop++)for(const symbol of [2,3]){
  if([0,1,2].filter(row=>reel[(stop+row)%reel.length]===symbol).length>1)throw Error('Unsupported scatter count '+key);
 }
}
const data={source:'https://github.com/slotopol/server',commit:'20c55c7deeb9d147c1812763c8a0626c3a3d1e08',defaultRtp:94.735834,lines:20,reels};
writeFileSync(file,JSON.stringify(data,null,2)+'\n');
const {fortuneTellerReturn}=await import('../server/casino/fortune-teller-return.mjs');
data.returns=Object.fromEntries(Object.entries(reels).map(([key,reels])=>[key,{oneLine:fortuneTellerReturn(reels,1),twentyLines:fortuneTellerReturn(reels,20)}]));
for(const[key,result]of Object.entries(data.returns))if(Math.abs(result.oneLine.rtp-Number(key))>0.00001)throw Error('Slotopol RTP mismatch '+key+': '+result.oneLine.rtp);
writeFileSync(file,JSON.stringify(data,null,2)+'\n');
console.log('PASS extracted '+Object.keys(reels).length+' pinned Fortune Teller reel sets; independent stop probabilities match every upstream one-line RTP; 20-line returns recorded');
