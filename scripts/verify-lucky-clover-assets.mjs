import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../web/public/casino-original/lucky-clover-x3/',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets-manifest.json'),'utf8'));
for(const item of manifest.assets){const data=fs.readFileSync(path.join(root,'vendor',item.path));assert.equal(data.length,item.bytes,item.path);assert.equal(createHash('sha256').update(data).digest('hex'),item.sha256,item.path);}
const entry=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(entry,/vendor\/html-20200413-stable\/LuckyCloverX3\/app.html/);assert.match(entry,/locale=en-GB/);assert.doesNotMatch(entry,/game.js|style.css|AudioContext/);
const intf=JSON.parse(fs.readFileSync(path.join(root,'vendor/html-interface-stable/1024/interface13.json'),'utf8'));
for(const key of ['signX2','signTake','sign12'])assert.ok(intf.interface_images[key],key);
for(const file of ['html-interface-stable/1024/games/LuckyCloverX3/game/audio/main_attract.wav.mp3','html-interface-stable/1024/games/LuckyCloverX3/game/audio/main_autospin.wav.mp3','html-interface-stable/1024/games/LuckyCloverX3/videos/x3/x3.webm'])assert.ok(fs.statSync(path.join(root,'vendor',file)).size>1000);
console.log(`PASS original client, English entry, ${manifest.assets.length} asset hashes, x2/take/half buttons, real audio and video`);
