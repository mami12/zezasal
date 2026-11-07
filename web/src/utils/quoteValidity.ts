import type {OddsDelta} from '../types';
type Quote={priceValidUntil?:number|null;quoteSuspended?:boolean};
type Leg=Quote&{outcomeId:string;quoteSnapshotAt?:number};
export const earliestQuoteDeadline=(values:(number|null|undefined)[]):number|null|undefined=>{
 if(values.includes(null))return null;
 const known=values.filter((value):value is number=>value!==undefined&&value!==null);
 return known.length?Math.min(...known):undefined;
};
export function latestQuoteDeadline(id:string,saved:Quote,at:number,deltas:Record<string,OddsDelta>){
 const delta=deltas[id];
 const quote=delta&&(delta.at??0)>=at&&delta.priceValidUntil!==undefined?delta:saved;
 return quote.quoteSuspended?null:quote.priceValidUntil;
}
export function selectionQuoteDeadline(selection:Quote&{outcomeId:string;quoteSnapshotAt?:number;builderLegs?:Leg[]},deltas:Record<string,OddsDelta>){
 if(selection.builderLegs?.length)return earliestQuoteDeadline(selection.builderLegs.map(leg=>latestQuoteDeadline(leg.outcomeId,leg,leg.quoteSnapshotAt??selection.quoteSnapshotAt??0,deltas)));
 return latestQuoteDeadline(selection.outcomeId,selection,selection.quoteSnapshotAt??0,deltas);
}
