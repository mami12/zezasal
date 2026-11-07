export type CasinoGameId = 'ice-fruits-6x3' | 'fortune-pyramid' | 'sizzling' | 'bookofra' | 'lucky-clover-x3' | 'vikings-fun' | 'fruit-queen' | 'seven-hot' | 'firejoker' | 'fortune-teller';

export type CasinoControls = {
  mode: 'original' | 'custom';
  rtp: number;
  hitFrequency: number;
};

export type CasinoGameSettings = {
  gameId: CasinoGameId;
  title: string;
  profile: string | null;
  theoreticalRtp: number | null;
  profiles: {id: string; label: string; theoreticalRtp: number}[];
  configurationError: string | null;
  configurationWarning: string | null;
  controls: CasinoControls;
  supportsCustomMath?: boolean;
  mathVersion: string | null;
  effectiveRtp: number;
  effectiveHitFrequency: number | null;
  customLimits?: {minWinMultiplier: number; maxWinMultiplier: number};
  controlLimits?: {rtp:{min:number;max:number};hitFrequency:{min:number;max:number}};
  maxPayoutMultiplier?: number;
  hidden?: boolean;
};

export type CasinoSettingsData = {
  managerId?: string | null;
  casinoCommission?: number;
  enabled: boolean;
  games: CasinoGameSettings[];
  warning: string | null;
  stakeLimits: {min: number; max: number; currency: string};
  hiddenGames?: string[];
};

export const casinoPercent = (value: number | null | undefined) => value == null ? 'Nuk është e publikuar' : `${Number(value.toFixed(3))}%`;
export const casinoStakeLimits = (limits: CasinoSettingsData['stakeLimits']) => `${limits.min.toFixed(2)}–${limits.max.toLocaleString('en-US')} lekë`;

/** A saved setting must be realizable by the native paytable. */
export const CASINO_CONTROLS_UNRESTRICTED = false;

export const casinoControlLimits = (game: CasinoGameSettings) => game.controlLimits ?? {
  rtp:{min:0,max:1000},hitFrequency:{min:0,max:100},
};

/** Feasible percentages across every supported stake and line count. These
 * bounds describe the draft only; nothing is silently saved or adjusted. */
export function casinoHitCompatibility(game: CasinoGameSettings, rtp: number){
  const limits=casinoControlLimits(game),bounds=game.customLimits;
  const ceil=(value:number)=>Math.ceil((value-1e-9)*100)/100;
  const floor=(value:number)=>Math.floor((value+1e-9)*100)/100;
  if(!bounds||!Number.isFinite(rtp)||rtp<0)return null;
  const minHit=rtp===0?0:Math.max(.01,ceil(rtp/bounds.maxWinMultiplier));
  const maxHit=rtp===0?0:Math.min(limits.hitFrequency.max,floor(rtp/bounds.minWinMultiplier));
  return {
    minHit,maxHit,available:minHit<=maxHit,
    /** True when the pair sits outside the catalog payout bounds. Advisory only:
     * with CASINO_CONTROLS_UNRESTRICTED the operator may still save it. */
    advisory:minHit>maxHit,
    minRtpForFullHit:ceil(bounds.minWinMultiplier*100),
    maxRtpForFullHit:Math.min(limits.rtp.max,floor(bounds.maxWinMultiplier*100)),
  };
}

/** The acknowledgement expires whenever the disclosed economic terms change. */
export const casinoTermsKey = (game: CasinoGameSettings, limits: CasinoSettingsData['stakeLimits']) =>
  JSON.stringify([game.gameId, game.mathVersion, game.controls.mode, game.effectiveRtp, game.effectiveHitFrequency, limits.min, limits.max, limits.currency]);
