import {readFile,writeFile,mkdir,readdir,copyFile,access} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'game-sources/fortune pyramid/cdn2.ctrgs.com'),target=resolve(root,'web/public/casino-original/fortune-pyramid/vendor');
const shared=resolve(root,'web/public/casino-original/lucky-clover-x3/vendor'),assets=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
try{await access(source);}catch{await access(resolve(target,'../assets-manifest.json'));console.log('Fortune Pyramid uses packaged original client');process.exit(0);}
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
 const file=resolve(dir,e.name);if(e.isDirectory()){await walk(file);continue;}
 const path=relative(source,file).replaceAll('\\','/');let data=await readFile(file),edits=[];
 if(data.subarray(0,11).toString()==='No Content:'){
  try{data=await readFile(resolve(shared,path));edits.push('Identical original shared CT client recovered from existing package');}catch{continue;}
  if(data.subarray(0,11).toString()==='No Content:')continue;
 }
 if(path==='html-20200413-stable/rgs/preloader34.obf.js'){data=await readFile(resolve(shared,path));edits.push('Recovered byte-identical current original CDN loader; captured formatting caused its decoder to hang');}
 if(path==='html-20200413-stable/system/casino_settings1.min.js'){data=Buffer.from(data.toString('utf8').replace(/(\b(?:secureToken|icasino|icasino_account)\s*=\s*getParameterByName\("[^"]*"\)\s*\|\|\s*)"[^"]*"/g,(_,prefix)=>prefix+'"local-wallet"'));edits.push('Removed captured demo session fallbacks; wallet authorization remains server-side');}
 await mkdir(dirname(target+'/'+path),{recursive:true});await writeFile(target+'/'+path,data);
 assets.push({path,bytes:data.length,sha256:hash(data),edits});
}}
await walk(source);
const present=new Set(assets.map(a=>a.path));
async function sharedMissing(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 const file=resolve(dir,entry.name);if(entry.isDirectory()){await sharedMissing(file);continue;}
 const path=relative(shared,file).replaceAll('\\','/');if(path.includes('LuckyClover')||present.has(path))continue;
 const data=await readFile(file);if(data.subarray(0,11).toString()==='No Content:')continue;
 await mkdir(dirname(target+'/'+path),{recursive:true});await writeFile(target+'/'+path,data);
 assets.push({path,bytes:data.length,sha256:hash(data),edits:['Original shared CT resource absent from supplied capture, recovered unchanged from existing package']});present.add(path);
}}
await sharedMissing(shared);
// These original game-specific sounds were absent from the supplied capture.
const audioHashes={
  "main_attract.mp3": "a76ba0a188dab3a8c1bf049d9ddb42b20a6d8674d59d72c5057addde8f8bdf94",
  "sym_06.mp3": "e004a4d2b192ff4df9a0ae7e74fba1145b659486f92b770873df88eeabab6ff5",
  "sym_07.mp3": "9bdf3887291e5fbb12ad59eee650d856414fb124706f39f214a49d19023ac0a6",
  "Scatter.mp3": "15eaae3a157082d47ce184fb88864ec9ae0c32bd3fdbc52db5deee734d0d0625",
  "sym_03.mp3": "95e0d077ed8943eb5c4a51c195e042d1650da98fbac470a7d71b4c9b90e97559",
  "Wild.mp3": "8b75f9fcf8da8e18acc41d3e279c1bc744fc6fb9ef440bca71ebbfae151bd82b",
  "main_autospin.mp3": "1ac411b2d5f25f64b0122705ce3e7eba99370567205795483dcc2553bcb190c2",
  "sym_02.mp3": "74e5a66b87c8349bbebe68452800a52709a225f11069165fdd76eae9f4cf9d56",
  "sym_04.mp3": "05a8011541d2d517ca99f2dae73bcef5c59c1f4abf2b47ff551e2e71b5ebcca5",
  "sym_05.mp3": "c911b4aac79828a8c278b53285ab13df91c3d576bdff1ebb73306021ee6b5191"
};
for(const [name,expected]of Object.entries(audioHashes)){
 const path='html-interface-stable/1024/games/FortunePyramid/game/main/audio/'+name;
 if(present.has(path)){if(assets.find(a=>a.path===path).sha256!==expected)throw Error('Unexpected Fortune Pyramid sound: '+name);continue;}
 const file=resolve(target,path),data=await readFile(resolve(root,'.runtime/new-games-audit/pyramid-audio',name)).catch(()=>readFile(file));
 if(hash(data)!==expected)throw Error('Original Fortune Pyramid sound hash mismatch: '+name);
 await mkdir(dirname(file),{recursive:true});await writeFile(file,data);
 assets.push({path,bytes:data.length,sha256:expected,source:'https://cdn2.ctrgs.com/'+path,edits:['Original game-specific MP3 recovered from provider CDN']});
}
await writeFile(resolve(target,'../assets-manifest.json'),JSON.stringify({game:'fortune-pyramid',source:'Supplied game-sources/fortune pyramid folder',root:'vendor',assets:assets.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
const art=resolve(root,'web/public/casino-assets/fortune-pyramid');await mkdir(art,{recursive:true});
for(const [name,from]of [['top_name.webp','html-interface-stable/1024/games/FortunePyramid/game/main/top_name.webp'],['background.webp','html-interface-stable/1024/games/FortunePyramid/game/main/background.webp']])await copyFile(resolve(source,from),art+'/'+name);
console.log(`PASS ${assets.length} original Fortune Pyramid client resources packaged without captured server sessions`);
