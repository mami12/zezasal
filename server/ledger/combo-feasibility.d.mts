export interface ComboLeg { market: string; outcome: string; line?: string }
export function canComboStillWin(legs: ComboLeg[], home: number, away: number): boolean;
export function comboOutcomeLegs(match: any, market: any): ComboLeg[] | null;
export function isImpossibleLiveCombination(match: any, market: any): boolean;
