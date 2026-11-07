import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {get} from 'node:http';
import {staticCacheHeaders} from '../server/static-cache.mjs';
const root=await mkdtemp(path.join(tmpdir(),'faqja-static-cache-'));
const files={'index.html':'entry','assets/index-aBcD1234.js':'bundle','casino-original/bookofra/libs/assembler.js':'boot',
  'casino-original/bookofra/manifest.json':'{}','casino-original/bookofra/image.png':'image','casino-original/bookofra/music.ogg':'0123456789'};
let server;
try {
  for(const [name,body] of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),body);}
  const app=express();app.use(express.static(root,{setHeaders:staticCacheHeaders}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const name of ['index.html','casino-original/bookofra/libs/assembler.js','casino-original/bookofra/manifest.json']) {
    const response=await fetch(`${base}/${name}`);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
  }
  const bundle=await fetch(`${base}/assets/index-aBcD1234.js`);assert.equal(bundle.headers.get('cache-control'),'public, max-age=31536000, immutable');
  const media=await fetch(`${base}/casino-original/bookofra/image.png`);assert.equal(media.headers.get('cache-control'),'public, max-age=3600');
  // Node fetch adds Cache-Control:no-cache to conditional requests. Use an
  // ordinary HTTP request to test the browser's actual If-None-Match contract.
  const cached=await new Promise((resolve,reject)=>get(`${base}/casino-original/bookofra/image.png`,{headers:{'If-None-Match':media.headers.get('etag')}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));}).on('error',reject));assert.equal(cached,304);
  const ranged=await fetch(`${base}/casino-original/bookofra/music.ogg`,{headers:{Range:'bytes=2-5'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),'2345');
  let windowsHeader;staticCacheHeaders({setHeader:(key,value)=>windowsHeader=value},'C:\\faqja\\casino-original\\sizzling\\libs\\assembler.js');assert.equal(windowsHeader,'no-store, max-age=0');
  console.log('PASS static delivery: cached media, immutable bundles, fresh Windows/Linux game boots, unchanged ETags and audio range requests');
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(root,{recursive:true,force:true});
}
