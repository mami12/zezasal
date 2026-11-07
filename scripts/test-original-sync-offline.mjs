/** The transferred original desktop clients must build without downloading again. */
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncOriginalSizzling} from './sync-original-sizzling.mjs';
import {syncOriginalBookofra} from './sync-original-bookofra.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratchRoot=join(root,'tmp');await mkdir(scratchRoot,{recursive:true});
const scratch=await mkdtemp(join(scratchRoot,'original-sync-offline-'));
const games=[['sizzling',syncOriginalSizzling],['bookofra',syncOriginalBookofra]];
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
let requests=0;
const offline=async()=>{requests++;throw new DOMException('Simulated offline timeout','TimeoutError');};
try {
  for(const [game,sync]of games) {
    const source=join(root,'web/public/casino-original',game);
    const original=await readFile(join(source,'manifest.json'));
    const result=await sync({rootDir:root,fetcher:offline,log:()=>{}});
    assert.equal(result.cached,true,game+': existing packaged desktop client is reusable');
    assert.equal(result.sourceSha,'507f7fdb7aee883f0d78cef0b02d6c4358462c69',game+': source remains pinned');
    assert.equal(digest(await readFile(join(source,'manifest.json'))),digest(original),game+': cached validation does not modify assets');
    assert.equal(requests,0,game+': no remote request for a valid packaged client');
  }
  console.log('PASS existing Sizzling and Book of Ra packaged assets validate with network disabled');
  for(const [game,sync]of games) {
    const base=join(scratch,game),copy=join(base,'web/public/casino-original',game);
    await cp(join(root,'web/public/casino-original',game),copy,{recursive:true});
    // A broken core JSON must not be silently accepted as an offline cache.
    await writeFile(join(copy,'manifest.json'),'{broken');
    await assert.rejects(sync({rootDir:base,fetcher:offline,log:()=>{}}),error=>
      /missing or incomplete/i.test(error.message)&&/working (?:computer|laptop)/i.test(error.message),
      game+': damaged client reports a useful repair path when download fails');
    await cp(join(root,'web/public/casino-original',game,'manifest.json'),join(copy,'manifest.json'));
    await rm(join(copy,'head.html'));
    await assert.rejects(sync({rootDir:base,fetcher:offline,log:()=>{}}),error=>
      /missing or incomplete/i.test(error.message)&&/head\.html/i.test(error.message),
      game+': missing assembler dependency cannot pass cache validation');
    if(game==='sizzling') {
      await cp(join(root,'web/public/casino-original',game,'head.html'),join(copy,'head.html'));
      const image=join(copy,'images/logo-0328a8ad8c.png'),contents=await readFile(image);
      contents[contents.length-1]^=1;await writeFile(image,contents);
      await assert.rejects(sync({rootDir:base,fetcher:offline,log:()=>{}}),error=>
        /checksum differs/i.test(error.message),
        'Sizzling: a damaged media byte cannot pass validation merely because its header is valid');
    }
  }
  assert.equal(requests,5,'only invalid caches attempted a pinned download');
  console.log('PASS damaged/missing desktop assets reject the cache and explain download failures; real source assets untouched');
} finally {
  // Only the test directory created above, under this repository's tmp folder.
  assert.equal(dirname(resolve(scratch)),resolve(scratchRoot),'cleanup stays within the test workspace');
  await rm(scratch,{recursive:true,force:true});
}
