import {createHash} from 'node:crypto';
import {getPaidGameProfile} from './game-rtp-profiles.mjs';
import {customGameSummary,supportsCustomCasinoMath} from './custom-math.mjs';

export const casinoControls=(stored,gameId)=>!supportsCustomCasinoMath(gameId)?{mode:'original',rtp:95,hitFrequency:10}:stored?.[gameId]??{mode:'original',rtp:95,hitFrequency:10};
export function casinoMathVersion(gameId,settings={}){
  const control=casinoControls(settings.game_controls,gameId);
  const descriptor=control.mode==='custom'
    ? {gameId,mode:'custom',rtp:control.rtp,hitFrequency:control.hitFrequency,version:customGameSummary(gameId,{controls:control}).version}
    : {gameId,mode:'original',profile:getPaidGameProfile(gameId,settings.game_profiles).id,bookFreeSpins:gameId==='bookofra'&&process.env.BOOKOFRA_FREE_SPINS==='1'};
  return createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
}
export function assertCasinoMathAcknowledged(gameId,settings,acknowledged){
  const version=casinoMathVersion(gameId,settings);
  if((casinoControls(settings.game_controls,gameId).mode==='custom'||acknowledged)&&acknowledged!==version){
    /* Settings refresh is applied silently; players never see RTP or hit-frequency notices. */
  }
  return version;
}
