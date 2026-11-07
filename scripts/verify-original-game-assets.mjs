import assert from 'node:assert/strict';import {readFileSync,existsSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';
import path from 'node:path';import {fileURLToPath} from 'node:url';
let checked=0;
for(const id of ['agt','vikings-fun']){
 const folder=new URL('../web/public/casino-original/'+id+'/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('assets-manifest.json',folder),'utf8'));
 const root=path.join(fileURLToPath(folder),manifest.root),present=[];
 function walk(base,prefix=''){for(const entry of readdirSync(base,{withFileTypes:true})){if(entry.isDirectory())walk(path.join(base,entry.name),prefix+entry.name+'/');else if(entry.name!=='assets-manifest.json')present.push(prefix+entry.name);}}
 walk(root);assert.deepEqual(present.sort(),manifest.assets.map(a=>a.path).sort(),id+' manifest must cover every packaged resource');
 for(const asset of manifest.assets){
  assert(!asset.path.includes('..'));const b=readFileSync(path.join(root,asset.path));
  assert.equal(b.length,asset.bytes,asset.path);assert.equal(createHash('sha256').update(b).digest('hex'),asset.sha256,asset.path);assert(!b.subarray(0,11).equals(Buffer.from('No Content:')));checked++;
 }
}
for(const id of ['fruitqueen','sevenhot20']){
 const root=new URL('../web/public/casino-original/agt/',import.meta.url),js=readFileSync(new URL('jsmin/'+id+'.js',root),'utf8');
 assert(js.includes('/app/api/casino/agt/dinit.php'));assert(!js.includes('"/dinit.php"'));
 for(const file of ['mainSounds','shortSounds','winSounds','gambleSounds','lineChangeSounds'])assert(readFileSync(new URL('audio/'+id+'/sfx/'+file+'.mp3',root)).length>1000);
 for(let i=0;i<8;i++)assert(existsSync(new URL('images/games/'+id+'/animations/icons/sprite_'+i+'.json',root)));
 const metadata=JSON.parse(readFileSync(new URL('../server/casino/agt-metadata/'+id+'.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(metadata.start.langs),['en']);assert(!('user_id' in metadata.start));
}
console.log(`PASS ${checked} original resource hashes, English-only metadata, original audio and all symbol animations`);
