// Reproducible extraction from the vendored, pinned upstream YAML. No network.
import {readFileSync,writeFileSync} from 'node:fs';
const commit='2a6fd837feea1b52bbfd65035a7698d0c70e096a';
function extract(name,scatter){
 const text=readFileSync(new URL(`../server/casino/slotopol-source/${name}_data.yaml`,import.meta.url),'utf8');
 const reels={},bonus=[];let key=null;
 for(const line of text.split(/\r?\n/)){
  const header=line.match(/^(\d+\.\d+):/);
  if(header){key=header[1];reels[key]=[];continue;}
  const row=line.match(/^\s*-\s*(\[[\d,\s]+\])/);
  if(row){const symbols=JSON.parse(row[1]).map(s=>s===scatter?0:s);if(key)reels[key].push(symbols);else bonus.push(symbols);}
 }
 for(const [id,rows]of Object.entries(reels))if(rows.length!==5)throw Error(`Invalid ${name} ${id}`);
 return {reels,bonus};
}
const sizzling=extract('sizzlinghot',8),book=extract('bookofra',10);
writeFileSync(new URL('../server/casino/legacy-slotopol-reels.json',import.meta.url),JSON.stringify({source:'https://github.com/slotopol/server',commit,sizzling:sizzling.reels,bookofra:book.reels,bookBonus:book.bonus},null,2)+'\n');
console.log('Pinned Slotopol legacy reels extracted');
