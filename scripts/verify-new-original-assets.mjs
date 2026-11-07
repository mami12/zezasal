import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let count=0;
for(const id of ['ice-fruits-6x3','fortune-pyramid']){
 const directory=resolve(root,'web/public/casino-original',id),manifest=JSON.parse(await readFile(directory+'/assets-manifest.json','utf8')),base=resolve(directory,manifest.root),present=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=resolve(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name!=='assets-manifest.json')present.push(relative(base,file).replaceAll('\\','/'));}}
 await walk(base);assert.deepEqual(present.sort(),manifest.assets.map(a=>a.path).sort(),id+' manifest covers every packaged resource');
 for(const asset of manifest.assets){
  assert.ok(!asset.path.startsWith('/')&&!asset.path.split('/').includes('..'));
  const buffer=await readFile(resolve(base,asset.path));assert.equal(buffer.length,asset.bytes);assert.equal(createHash('sha256').update(buffer).digest('hex'),asset.sha256,asset.path);assert.notEqual(buffer.subarray(0,11).toString(),'No Content:');count++;
 }
}
const ice=JSON.parse(await readFile(resolve(root,'web/public/casino-original/ice-fruits-6x3/assets-manifest.json'),'utf8'));
for(const asset of ice.assets.filter(a=>/\.(?:webp|png|jpe?g|mp3|woff2?|ttf|otf|json)$/i.test(a.path)))assert.equal(asset.sha256,asset.originalSha256,'Native artwork/audio/font/timeline changed: '+asset.path);
const entry=await readFile(resolve(root,'web/public/casino-original/ice-fruits-6x3/6megaice.html'),'utf8');assert.ok(!entry.includes('demo3389061'));assert.ok(!entry.includes('cloudflareinsights.com'));
console.log(`PASS ${count} original packaged resources, complete manifests, unchanged Ice Fruits graphics/audio/fonts/timelines and excluded captured sessions`);
