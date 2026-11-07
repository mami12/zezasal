/**
 * Shared, process-local LIVE risk snapshot. DB-backed persistence lives in
 * ledger/live-risk-store.mjs, keeping this policy usable in pure unit tests.
 * Each instance refreshes its snapshot; placement also reads the locked DB row.
 */
export const DEFAULT_LIVE_RISK_SETTINGS = Object.freeze({
  enabled: true,
  // Independent from LIVE risk rules: controls same-match builder combos
  // in both prematch and LIVE, never ordinary multi-match tickets.
  combosEnabled: true,
  leaderRules: [
    { minute: 60, goals: 3, maxOdds: 1.60 },
    { minute: 65, goals: 2, maxOdds: 1.40 },
    { minute: 70, goals: 2, maxOdds: 1.60 },
    { minute: 85, goals: 1, maxOdds: 1.10 },
  ],
  lowOddsRules: [
    { minute: 60, maxOdds: 1.05 },
    { minute: 70, maxOdds: 1.10 },
    { minute: 80, maxOdds: 1.20 },
  ],
  // Suspend ALL outcomes in matching markets, regardless of price.
  // From 90' close 1/X/2 for every score, including high-odds 1 and 2.
  marketClosureRules: [
    { minute: 90, market: '1X2', score: 'ANY' },
  ],
  limits: {
    maxLiveStake: 10000,
    maxLivePayout: 100000,
    maxMatchExposure: 500000,
  },
});

const clone = obj => JSON.parse(JSON.stringify(obj));
let currentSettings = clone(DEFAULT_LIVE_RISK_SETTINGS);
const listeners = new Set();

export function liveRiskSettings() { return currentSettings; }

export function subscribeLiveRiskSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reject malformed admin input. Amounts are LEK; null means that particular
 * monetary limit is OFF. Keep number and size caps to avoid impractical rules.
 */
export function validateLiveRiskSettings(value) {
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Konfigurim i pavlefshëm i riskut.');
  if (typeof value.enabled !== 'boolean') fail('Aktivizimi duhet të jetë Po ose Jo.');
  // Existing persisted JSON predates this switch and keeps its prior behavior.
  const combosEnabled = value.combosEnabled === undefined
    ? DEFAULT_LIVE_RISK_SETTINGS.combosEnabled : value.combosEnabled;
  if (typeof combosEnabled !== 'boolean') fail('Aktivizimi i combove duhet të jetë Po ose Jo.');
  const closureInput = value.marketClosureRules === undefined
    ? DEFAULT_LIVE_RISK_SETTINGS.marketClosureRules : value.marketClosureRules;
  if (!Array.isArray(value.leaderRules) || !Array.isArray(value.lowOddsRules) ||
      !Array.isArray(closureInput) ||
      value.leaderRules.length > 12 || value.lowOddsRules.length > 12 ||
      closureInput.length > 12) {
    fail('Maksimumi 12 rregulla për çdo kategori.');
  }
  const valueIn = (raw,min,max,label,integer=false) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max ||
        (integer && !Number.isInteger(raw))) fail(`${label} duhet të jetë ${min}–${max}.`);
    return raw;
  };
  const leaderRules = value.leaderRules.map((r,i) => {
    if (!r || typeof r !== 'object') fail('Rregull i pavlefshëm.');
    return {
      minute: valueIn(r.minute,0,120,`Minuta e skuadrës ${i+1}`,true),
      goals: valueIn(r.goals,1,20,`Avantazhi ${i+1}`,true),
      maxOdds: valueIn(r.maxOdds,1.01,100,`Koeficienti ${i+1}`),
    };
  });
  const lowOddsRules = value.lowOddsRules.map((r,i) => {
    if (!r || typeof r !== 'object') fail('Rregull i pavlefshëm.');
    return {
      minute: valueIn(r.minute,0,120,`Minuta e kuotës ${i+1}`,true),
      maxOdds: valueIn(r.maxOdds,1.01,100,`Koeficienti i kuotës ${i+1}`),
    };
  });
  const allowedMarkets = new Set(['1X2','DOUBLE_CHANCE','BTTS','TOTAL_GOALS','CORNERS','CARDS','ALL']);
  const allowedScores = new Set(['ANY','DRAW','LEADING']);
  const marketClosureRules = closureInput.map((r,i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail('Rregull i pavlefshëm për mbylljen e tregut.');
    if (!allowedMarkets.has(r.market)) fail(`Treg i panjohur në rregullin ${i+1}.`);
    if (!allowedScores.has(r.score)) fail(`Kusht rezultati i panjohur në rregullin ${i+1}.`);
    return {
      minute: valueIn(r.minute,0,120,`Minuta e mbylljes ${i+1}`,true),
      market: r.market,
      score: r.score,
    };
  });
  if (new Set(marketClosureRules.map(r => `${r.minute}:${r.market}:${r.score}`)).size !== marketClosureRules.length) {
    fail('Nuk lejohen rregulla identike për mbylljen e tregut.');
  }
  if (new Set(leaderRules.map(r => `${r.minute}:${r.goals}`)).size !== leaderRules.length ||
      new Set(lowOddsRules.map(r => r.minute)).size !== lowOddsRules.length) {
    fail('Nuk lejohen rregulla të përsëritura me të njëjtin kusht.');
  }
  if (!value.limits || typeof value.limits !== 'object') fail('Mungojnë kufijtë financiarë.');
  const caps = {};
  for (const field of ['maxLiveStake','maxLivePayout','maxMatchExposure']) {
    const raw = value.limits[field];
    caps[field] = raw === null ? null : valueIn(raw,100,1000000000,field);
  }
  if (caps.maxLivePayout !== null && caps.maxLiveStake !== null &&
      caps.maxLivePayout < caps.maxLiveStake) {
    fail('Pagesa maksimale nuk mund të jetë më e vogël se shuma maksimale.');
  }
  return { enabled:value.enabled, combosEnabled, leaderRules, lowOddsRules, marketClosureRules, limits:caps };
}

export function setLiveRiskSettings(value) {
  currentSettings = validateLiveRiskSettings(value);
  for (const listener of listeners) {
    try { listener(currentSettings); } catch (e) { console.error('[live risk] listener:',e.message); }
  }
  return currentSettings;
}
