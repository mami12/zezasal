// Package only original artwork/audio; recorded launch tickets and remote transports are excluded.
import {readFile,mkdir,copyFile,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'fortuntelle/cdn.playngonetwork.com/9.4.1-fortuneteller.238/resources/games/videoslot/fortuneteller');
const output=join(root,'web/public/casino-original/fortune-teller/assets');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
try{await access(join(source,'game_bundle.json'));}catch{
 for(const name of ['manifest.json','symbols.png','cards.png','logo.png','background.jpg','sounds.mp3'])await access(join(output,name));
 for(const name of ['logo.png','background.jpg'])await access(join(root,'web/public/casino-assets/fortune-teller',name));
 console.log('Fortune Teller uses its verified packaged original assets');await import('./sync-fortune-teller-native.mjs');process.exit(0);
}
await mkdir(output,{recursive:true});
const game=await json(join(source,'game_bundle.json')),config=await json(join(source,'config_desktop.json'));
const skin=game.bundle.find(bundle=>bundle.name==='main').data.tex.skin_texture0;
const bonus=game.bundle.find(bundle=>bundle.name==='bonus').data.tex.bonus_texture1;
const logo=config.bundle.find(bundle=>bundle.name==='logo').data.tex.logo_texture0;
const files={'symbols.png':'skin/skin_texture0_level1.png','cards.png':'bonus/bonus_texture1_level1.png','logo.png':'logo/logo_texture0_level1.png',
 'background.jpg':'background/background_texture0_level1.jpg','sounds.mp3':'sounds/sounds_desktop.mp3'};
for(const [name,path]of Object.entries(files))await copyFile(join(source,path),join(output,name));
const sprite=(atlas,frame,image)=>{
 const entry=atlas.frames[frame];if(!entry||entry.rotated)throw Error('Unsupported Fortune Teller frame '+frame);
 return {image,...entry.frame,atlasWidth:atlas.meta.size.w,atlasHeight:atlas.meta.size.h};
};
const frames=['T0OD.png','T0RG.png','T0SB.png','T0AE.png','T0TD.png','T0QD.png','T0GC.png','T0DC.png','T0CC.png','T0BC.png','T0AC.png','T0ZB.png'];
const manifest={sourceVersion:'9.4.1-fortuneteller.238',symbols:frames.map(frame=>sprite(skin,frame,'symbols.png')),
 cards:['T1DC.png','T1FC.png','T1EC.png','T1GC.png'].map(frame=>sprite(bonus,frame,'cards.png')),cardBack:sprite(bonus,'T1MB.png','cards.png'),
 logo:sprite(logo,'T0PC.png','logo.png'),sounds:(await json(join(source,'sounds/sounds_desktop.json'))).sounds};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const card=join(root,'web/public/casino-assets/fortune-teller');await mkdir(card,{recursive:true});
for(const name of ['logo.png','background.jpg'])await copyFile(join(output,name),join(card,name));
console.log('PASS Fortune Teller: 12 original symbols, four Tarot faces, logo, background and sound sprite packaged without captured sessions');
await import('./sync-fortune-teller-native.mjs');
