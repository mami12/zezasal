import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// CT selects different assets by user agent, not by viewport width alone.
// Check both the Android sprites and the iOS Lottie alternative to WebM.
let checked=0;
for(const [id,game] of [['lucky-clover-x3','LuckyCloverX3'],['vikings-fun','VikingsFun']]){
 const root=fileURLToPath(new URL(`../web/public/casino-original/${id}/vendor/`,import.meta.url));
 const packaged=new Set(JSON.parse(fs.readFileSync(path.join(root,'../assets-manifest.json'),'utf8')).assets.map(a=>a.path));
 function resource(rel){
  rel=path.posix.normalize(rel);
  assert(!rel.startsWith('../'),rel);
  assert(packaged.has(rel),`${id}: missing manifest entry ${rel}`);
  const data=fs.readFileSync(path.join(root,rel));
  assert(data.length>0,`${id}: empty ${rel}`);checked++;
  return data.toString('utf8');
 }
 const gameConfig=JSON.parse(resource(`html-interface-stable/1024/games/${game}/${game}.conf`));
 const videoConfig=JSON.parse(resource('html-interface-stable/VideoAPI/videoAssets6.json'));
 for(const animation of Object.values({...videoConfig,...gameConfig.videoAnims})){
  for(const key of ['webmSrc','jsonSrc','lottieSrc'])if(animation[key]){
   const rel=path.posix.normalize('html-20200413-stable/Game/'+animation[key]);
   const content=resource(rel);
   if(key==='lottieSrc')for(const asset of JSON.parse(content).assets||[]){
    if(asset.p&&!asset.p.startsWith('data:'))resource(path.posix.join(path.posix.dirname(rel),asset.u||'',asset.p));
   }
  }
 }
 for(const name of ['BIG_WIN','MEGA_WIN','5_of_a_KIND',...(id==='vikings-fun'?['FREE_GAMES']:[])])resource(`html-interface-stable/1024/attractions/new/${name}_small.webp`);
 for(const entries of Object.values(gameConfig))if(Array.isArray(entries))for(const asset of entries){
  if(asset?.name&&/\.(png|webp)$/.test(asset.name))resource('html-interface-stable/1024/attractions/'+asset.name.replace(/\.(png|webp)$/,'_small.$1'));
 }
 const css=resource('html-20200413-stable/css/fullscreen.css');
 for(const match of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g))resource(path.posix.join('html-20200413-stable/css',match[1]));
 for(const name of ['swipe-hand.svg','swipe-hand-click.svg'])resource('html-20200413-stable/interface/1024/'+name);
}
const agtRoot=fileURLToPath(new URL('../web/public/casino-original/agt/',import.meta.url));
const agtManifest=new Set(JSON.parse(fs.readFileSync(path.join(agtRoot,'assets-manifest.json'),'utf8')).assets.map(a=>a.path));
for(const theme of ['lightgreen2','maroon']){
 for(const name of ['main','main_vert']){
  const rel=`images/themes/${theme}/buttons/mobile/${name}`;
  for(const ext of ['json','webp']){
   assert(agtManifest.has(rel+'.'+ext),rel+'.'+ext);
   assert(fs.statSync(path.join(agtRoot,rel+'.'+ext)).size>0);checked++;
  }
  assert(Object.keys(JSON.parse(fs.readFileSync(path.join(agtRoot,rel+'.json'),'utf8')).frames).length>0);
 }
 const top=`images/themes/${theme}/buttons/top/mobile.webp`;
 assert(agtManifest.has(top));assert(fs.statSync(path.join(agtRoot,top)).size>0);checked++;
}
for(const rel of ['css/digital-dismay.regular.otf','css/13309.otf','images/common/ui/sound_big.webp','images/games/sevenhot20/ui/menubg.webp']){
 assert(agtManifest.has(rel));assert(fs.statSync(path.join(agtRoot,rel)).size>0);checked++;
}
console.log(`PASS ${checked} mobile/fullscreen and WebM/Lottie resource references`);
