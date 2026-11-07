/** Missing provider facts are unknown, never an implicit 0-0 or minute zero. */
export function optionalFeedNumber(value:unknown):number|undefined {
 if((typeof value!=='number'&&typeof value!=='string')||(typeof value==='string'&&!value.trim()))return undefined;
 const number=Number(value);return Number.isFinite(number)&&number>=0?number:undefined;
}
