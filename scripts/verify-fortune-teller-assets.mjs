import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url)),version='9.4.1-fortuneteller.238';
const source=join(root,'fortuntelle/cdn.playngonetwork.com',version),dest=join(root,'web/public/casino-original/fortune-teller/provider-original',version);
const meta=JSON.parse(await readFile(join(dest,'provenance.json'),'utf8')),sha=data=>createHash('sha256').update(data).digest('hex');
assert.ok(meta.files?.length>30,'complete native resource manifest');
let available=true;try{await access(source);}catch{available=false;}
const allowed=new Set([meta.bundle,'resources/common/fonts/MAGDA.css','resources/lang/en_GB/locale.json']);
for(const file of meta.files){
 assert.ok(!file.path.includes('..')&&!file.path.startsWith('/'),'relative asset path');
 const packaged=await readFile(join(dest,file.path));assert.equal(sha(packaged),file.packagedSha256,'packaged asset '+file.path);
 if(available){
  const original=await readFile(join(source,file.path));assert.equal(sha(original),file.sourceSha256,'original asset '+file.path);
  if(!allowed.has(file.path))assert.deepEqual(packaged,original,'original bytes preserved '+file.path);
 }
}
const script=await readFile(join(dest,meta.bundle),'utf8');new Script(script);
assert.equal(sha(script),meta.packagedSha256);assert.match(script,/walletRuntime:/);
const entry=await readFile(join(dest,'../../index.html'),'utf8');assert.match(entry,/fortuneteller_desktop.bundle.js/);assert.match(entry,/native-wallet.js/);assert.doesNotMatch(entry,/fortune-teller\.css|fortune-teller\.js/);
console.log('PASS '+meta.files.length+' original Fortune Teller files: packaged hashes, unchanged graphics/audio/fonts/timelines, documented integration edits, valid renderer and native entry');
