/** Package the supplied original AGT client, keeping captured sessions private. */
import {readFile,writeFile,mkdir,readdir,copyFile,access} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'game-sources/icefruit6x3/demo.agtsoftware.org/games/agt');
const target=resolve(root,'web/public/casino-original/ice-fruits-6x3');
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
try{await access(source);}catch{await access(target+'/assets-manifest.json');console.log('Ice Fruits uses packaged original client');process.exit(0);}
const assets=[];
async function walk(directory){for(const entry of await readdir(directory,{withFileTypes:true})){
 const file=resolve(directory,entry.name);if(entry.isDirectory()){await walk(file);continue;}
 const path=relative(source,file).replaceAll('\\','/');
 if(!/\.(?:js|css|json|webp|png|jpe?g|svg|mp3|ogg|woff2?|ttf|otf)$/i.test(path))continue;
 let original=await readFile(file);let recovered=false;if(original.subarray(0,11).toString()==='No Content:'){
  try{original=await readFile(resolve(root,'web/public/casino-original/agt',path));recovered=true;}catch{continue;}
  if(original.subarray(0,11).toString()==='No Content:')continue;
 }
 let output=original;const edits=recovered?['Recovered same original AGT shared resource from existing packaged client']:[];
 if(path==='jsmin/6megaice.js'){
  const text=original.toString('utf8');if(!text.includes('"/dinit.php"'))throw Error('Original API endpoint not found');
  output=Buffer.from(text.replaceAll('"/dinit.php"','"/app/api/casino/agt/dinit.php"').replace(/\?\s+\./g,'?.').replace(/\?\s+\?/g,'??').replace('this.ws_connected || $.ajax({','(!model.jpenable || this.ws_connected) || $.ajax({').replace('connectWS() {','connectWS() { if(!model.jpenable)return;'));edits.push('Same-origin wallet transport endpoint','Rejoined optional chaining tokens split by captured-source formatter');
 }
 await mkdir(dirname(target+'/'+path),{recursive:true});await writeFile(target+'/'+path,output);
 assets.push({path,bytes:output.length,sha256:digest(output),originalSha256:digest(original),edits});
}}
await walk(source);
let html=await readFile(source+'/6megaice.html','utf8');
html=html.replace(/<script\b[^>]*src="https:\/\/static.cloudflareinsights.com[\s\S]*?<\/script>/gi,'')
 .replace(/LS15\.syMtvvgLJj\s*=\s*'[^']*'/g,"LS15.syMtvvgLJj = 'local-wallet'")
 .replace('href="/theme/interactive1/img/favicon.png"','href="images/common/ui/logobig.webp"')
 .replace('src="/js/agtunique.js','src="js/agtunique.js').replace(/window\.jp_wss_url\s*=\s*'[^']*'/g,"window.jp_wss_url = ''").replace(/window\.history_domain\s*=\s*'[^']*'/g,"window.history_domain = ''");
await writeFile(target+'/6megaice.html',html);
const extra=resolve(source,'../../js/agtunique.js');await mkdir(target+'/js',{recursive:true});await copyFile(extra,target+'/js/agtunique.js');
const unique=await readFile(extra);assets.push({path:'js/agtunique.js',bytes:unique.length,sha256:digest(unique),originalSha256:digest(unique),edits:[]});
const entry=await readFile(target+'/6megaice.html');assets.push({path:'6megaice.html',bytes:entry.length,sha256:digest(entry),originalSha256:digest(await readFile(source+'/6megaice.html')),edits:['Removed captured session identity and analytics','Relative original helper/favicon paths']});
await writeFile(target+'/assets-manifest.json',JSON.stringify({game:'ice-fruits-6x3',source:'Supplied game-sources/icefruit6x3 folder',root:'.',assets:assets.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
const art=resolve(root,'web/public/casino-assets/ice-fruits-6x3');await mkdir(art,{recursive:true});
await copyFile(source+'/images/games/6megaice/ui/top.webp',art+'/top.webp');
await copyFile(source+'/images/games/6megaice/ui/emptyback.jpg',art+'/emptyback.jpg');
console.log(`PASS ${assets.length} original Ice Fruits resources packaged: renderer, symbol animations, sounds, fonts and native controls`);
