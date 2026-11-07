/** Immutable global reel profiles. Never select a profile using player identity. */
import {readFileSync} from 'node:fs';
import {RTP_PROFILES} from './rtp-profiles.mjs';
import {bookProfiles} from './bookofra-profiles.mjs';
const load=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const clover=load('./lucky-clover-data.json'),vikings=load('./vikings-data.json'),agt=load('./agt-data.json');
const firejoker=load('./firejoker-data.json');
const fortune=load('./fortune-teller-data.json');
const pyramid=load('./fortune-pyramid-data.json');
const ice=load('./ice-fruits-data.json');
const definitions=[
 ['ice-fruits-6x3','Ice Fruits 6 Reels',ice.reels,ice.rtp,ice.commit],
 ['fortune-pyramid','Fortune Pyramid',pyramid.reels,pyramid.defaultRtp,pyramid.commit],
 ['lucky-clover-x3','Lucky Clover X3',clover.reels,clover.defaultRtp,clover.commit],
 ['vikings-fun',"Viking’s Fun",vikings.reels,vikings.defaultRtp,clover.commit],
 ['fruit-queen','Fruit Queen',agt.games.fruitqueen.reels,agt.games.fruitqueen.rtp,agt.commit],
 ['seven-hot','Seven Hot',agt.games.sevenhot20.reels,agt.games.sevenhot20.rtp,agt.commit],
 ['firejoker','Fire Joker',firejoker.reels,firejoker.defaultRtp,firejoker.commit],
];
const games=new Map(definitions.map(([gameId,title,reels,defaultRtp,sourceCommit])=>{
 const profiles=Object.keys(reels).map(key=>Object.freeze({
  id:`SLOTOPOL_${gameId.replaceAll('-','_').toUpperCase()}_RTP_${key.replace('.','_')}_V1`,
  rtp:Number(key),theoreticalRtp:Number(key),label:`${Number(key)}%`,certified:false,
  source:'Slotopol',sourceCommit,
 })).sort((a,b)=>a.rtp-b.rtp);
 return [gameId,{gameId,title,profiles,defaultId:profiles.find(p=>p.rtp===Number(defaultRtp)).id}];
}));
games.set('sizzling',{gameId:'sizzling',title:'Sizzling Hot Deluxe',profiles:RTP_PROFILES.map(p=>({...p,rtp:p.theoreticalRtp})),defaultId:'SIZZLING_ORIGINAL_REELS_V2'});
games.set('fortune-teller',{gameId:'fortune-teller',title:'Fortune Teller',defaultId:`SLOTOPOL_FORTUNE_TELLER_${String(fortune.defaultRtp).replace('.','_')}_V1`,
 profiles:Object.keys(fortune.reels).map(key=>Object.freeze({id:`SLOTOPOL_FORTUNE_TELLER_${key.replace('.','_')}_V1`,rtp:Number(key),sourceRtp:Number(key),
  theoreticalRtp:fortune.returns[key].twentyLines.rtp,label:`${fortune.returns[key].twentyLines.rtp.toFixed(6)}% · 20 lines`,source:'Slotopol',sourceCommit:fortune.commit,certified:false})).sort((a,b)=>a.theoreticalRtp-b.theoreticalRtp)});
games.set('bookofra',{gameId:'bookofra',title:'Book of Ra Deluxe',get profiles(){return bookProfiles().map(p=>({...p,rtp:p.theoreticalRtp}));},get defaultId(){
 const profiles=bookProfiles(),original=profiles.find(p=>p.id==='BOOKOFRA_ORIGINAL_REELS_V2');
 return original.id;
}});
export function getGameProfiles(gameId){return games.get(gameId)?.profiles??[];}
export function getGameProfile(gameId,storedProfiles={}){
 const game=games.get(gameId);
 if(!game)throw Object.assign(new Error('Unknown casino game'),{status:400});
 const id=storedProfiles?.[gameId]??game.defaultId;
 const profile=game.profiles.find(p=>p.id===id);
 if(!profile)throw Object.assign(new Error(`Unsupported reel profile for ${gameId}`),{status:503,code:'UNSUPPORTED_MATH_PROFILE'});
 return profile;
}
export function getPaidGameProfile(gameId,storedProfiles={}){
 const profile=getGameProfile(gameId,storedProfiles);
 if(!Number.isFinite(profile.theoreticalRtp)||profile.theoreticalRtp<1||profile.theoreticalRtp>1000)throw Object.assign(new Error('Select a supported casino profile before starting a new paid round'),{status:503,code:'UNSUPPORTED_MATH_PROFILE'});
 return profile;
}
export function publicGameProfiles(storedProfiles={}){
 return [...games.values()].map(game=>{
  let active=null,error=null;try{active=getPaidGameProfile(game.gameId,storedProfiles);}catch(e){error=e.message;}
  return {gameId:game.gameId,title:game.title,profile:active?.id??null,theoreticalRtp:active?.theoreticalRtp??null,
   profiles:game.profiles.filter(profile=>profile.theoreticalRtp>=1&&profile.theoreticalRtp<=1000).map(({reels,baseRtp,bonusRtp,...profile})=>profile),
   configurationError:error,configurationWarning:null,
   scope:'All players; future paid rounds only'};
 });
}
export function validateGameProfile(gameId,id){
 const profile=getGameProfiles(gameId).find(p=>p.id===id&&p.theoreticalRtp>=1&&p.theoreticalRtp<=1000);
 if(!profile)throw Object.assign(new Error('Unsupported casino reel profile'),{status:400});
 return profile;
}
