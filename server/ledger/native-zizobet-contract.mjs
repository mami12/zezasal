import {resolveMarketTitle} from '../zizobet/normalize.mjs';

// Provider identifiers and quoted parameters, not browser translations, define
// dynamic Zizobet contracts. Ordinary static titles retain their existing rules.
const dynamic=/\[[^\]]+\]|\{[^}]+\}|\brace to x\b/i;
const unsupported=message=>Object.assign(new Error(message),{
  status:400,code:'MARKET_EVIDENCE_UNSUPPORTED'
});
const equalParams=(a,b)=>{
  const aa=Object.keys(a),bb=Object.keys(b);
  return aa.length===bb.length&&aa.every(key=>
    Object.prototype.hasOwnProperty.call(b,key)&&
    JSON.stringify(a[key])===JSON.stringify(b[key]));
};

export function nativeZizobetContractRow(row){
  if(!row||String(row.provider_id??'').toUpperCase()!=='ZIZOBET')return row;
  const raw=String(row.native_market_name??'').trim();
  if(!raw||!dynamic.test(raw))return row;
  const key=String(row.market_key??'').match(/^zz(\d+)@([A-Za-z0-9_-]{1,8192})$/);
  if(!key||(row.native_market_id!=null&&String(Number(row.native_market_id))!==key[1]))
    throw unsupported('Identifikuesi origjinal i tregut Zizobet nuk përputhet me kuotën.');
  let params;
  try{params=JSON.parse(Buffer.from(key[2],'base64url').toString('utf8'));}
  catch{throw unsupported('Parametrat origjinalë të tregut Zizobet janë të pavlefshëm.');}
  if(!params||typeof params!=='object'||Array.isArray(params))
    throw unsupported('Parametrat origjinalë të tregut Zizobet mungojnë.');
  const declared=row.native_parameters;
  if(declared!=null&&(!declared||typeof declared!=='object'||Array.isArray(declared)||
      !equalParams(params,declared)))
    throw unsupported('Parametrat e tregut nuk përputhen me ofertën origjinale Zizobet.');
  const quote={...params};
  if(row.line!=null&&String(row.line).trim()!=='')quote.h=row.line;
  // The full-game feed uses a special score placeholder for the remaining
  // match. Its native contract is the score at purchase, never an FT score.
  const template=Number(key[1])===18639?'Correct score [{score}]':raw;
  const canonical=resolveMarketTitle(template,quote);
  if(!canonical||/\[[^\]]+\]|\{[^}]+\}|\brace to x\b/i.test(canonical))
    throw unsupported('Mungon parametri i saktë i tregut Zizobet.');
  return {...row,market_name:canonical};
}
