import {stakeToCents} from './betslipColumns';
/** The reference links total/column inputs. Preserve our exact-cent contract. */
export function totalFromColumnStake(value:string,columns:number):string|null{
 const cents=stakeToCents(value);
 if(cents==null||!Number.isSafeInteger(columns)||columns<1||columns>24)return null;
 const total=cents*columns;
 return Number.isSafeInteger(total)?(total/100).toFixed(2):null;
}
