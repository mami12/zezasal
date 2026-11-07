type Outcome={name?:string;code?:string;key?:string};
type Market={id?:string;name?:string;marketType?:string;period?:string|number;line?:unknown;specifier?:unknown;status?:string;outcomes?:Outcome[]};
export function getBoardTotalLine(market:Market|null|undefined):number|null;
export function findBoardOutcome<T extends Outcome>(market:{outcomes?:T[]}|null|undefined,aliases:string[]):T|null;
export function selectBoardMarkets<T extends Market>(markets:T[],visible:(market:T)=>boolean,suspended:(market:T)=>boolean,teams?:{homeTeam?:string;awayTeam?:string}):{primary:T|null;primaryType:'1X2'|'DC'|'BTTS';total:T|null;totalLine:number|null};
