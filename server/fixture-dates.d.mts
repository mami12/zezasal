export function isFixtureOnDay(start:string,filter:'today'|'tomorrow'|'dayAfterTomorrow',now?:Date):boolean;
export function filterFixtureRowsByDay<T>(rows:T[],day:unknown,now?:Date):T[];
