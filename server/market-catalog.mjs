const catalog=new Map(),disabled=new Set(),disabledCategories=new Set();
export const MARKET_CATEGORY_IDS=['totals','intervals','results','goals','corners','cards','fouls','shots','players','combos','other'];
export function marketFamily(m={}){
 let name=String(m.market_name??m.marketName??m.name??'').trim().replace(/^\*\s*/,'').split(/\s+(?:Â?·)\s+/)[0];
 if(!name)return null;
 try{const key=String(m.market_key??m.marketKey??m.key??m.extId??'');const encoded=key.match(/^zz\d+@([\w-]+)$/)?.[1];if(encoded){const bytes=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const params=JSON.parse(new TextDecoder().decode(bytes));if(params.pl)name=name.replaceAll(String(params.pl),'Player');}}catch{/* Unknown identity keeps its original name. */}
 name=name.replace(/\bHometeam\b/gi,'Home team').replace(/\bAwayteam\b/gi,'Away team');
 name=name.replace(/in minutes \d+-\d+/gi,'in minutes {window}').replace(/\(from \d+:\d+\)/gi,'(from {score})').replace(/\bgoal \d+\b/gi,'goal {number}').replace(/\bFull Time Result\b|^Match result$/gi,'1X2');
 const key=name.toLowerCase().replace(/\s+/g,' ');
 return {key,name};
}
export function marketCategories(name){
 const n=String(name).toLowerCase(),tags=[];
 for(const[tag,pattern]of Object.entries({totals:/total|over.?under/,intervals:/interval|minutes?|when will|time of/,corners:/corner/,cards:/card|booking/,fouls:/foul/,shots:/shot/,players:/player|scorer|\{pl\}|scoring type/,combos:/&|(?:^|[^\d])\+|bet builder|\b(?:and|both halves)\b/,results:/1x2|result|winner|double chance|correct score|draw no bet/,goals:/goal|score|clean sheet|to nil/}))if(pattern.test(n))tags.push(tag);
 return tags.length?tags:['other'];
}
export function observeMarket(m){const family=marketFamily(m);if(family&&!catalog.has(family.key))catalog.set(family.key,{...family,categories:marketCategories(family.name)});return family;}
const scopeBlocks=[];
const normScope=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
function scopeBlocked(f,match,rules=scopeBlocks){
 if(!match||!rules.length)return false;
 const category=normScope(match?.tournament?.category?.name??match?.category?.name??match?.category_name??match?.category_slug??match?.country);
 const leagueName=normScope(match?.tournament?.name??match?.tournament_name??match?.league);
 const full=normScope([category,leagueName].filter(Boolean).join(' '));
 const cats=marketCategories(f.name);
 for(const rule of rules){
  if(rule.country&&!(category.includes(rule.country)||full.includes(rule.country)))continue;
  if(rule.league&&!(leagueName.includes(rule.league)||full.includes(rule.league)))continue;
  const catHit=!rule.categories.length||rule.categories.some(c=>cats.includes(c));
  const famHit=!rule.families.length||rule.families.includes(f.key);
  if(catHit&&famHit)return true;
 }
 return false;
}
export function setScopeBlocks(rows){scopeBlocks.length=0;for(const r of rows??[]){const country=normScope(r?.country),league=normScope(r?.league);if(!country&&!league)continue;scopeBlocks.push({country,league,categories:(r?.categories??[]).map(normScope).filter(Boolean),families:(r?.families??[]).map(normScope).filter(Boolean)});}}
export const scopeBlockRows=()=>scopeBlocks.map(r=>({...r}));
export function marketScopeBlocked(m,match,rules){
 const family=marketFamily(m);if(!family)return false;
 return scopeBlocked(family,match,(rules??[]).map(r=>({country:normScope(r.country),league:normScope(r.league),categories:(r.categories??[]).map(normScope),families:(r.families??[]).map(normScope)})));
}
export function marketIsEnabled(m,match){const f=observeMarket(m);if(!f)return true;return !disabled.has(f.key)&&!marketCategories(f.name).some(c=>disabledCategories.has(c))&&!scopeBlocked(f,match);}
export function setCatalogRows(rows){disabled.clear();for(const r of rows){catalog.set(r.key,{key:r.key,name:r.name,sortOrder:Number(r.sort_order??r.sortOrder??1000000),categories:marketCategories(r.name)});if(r.enabled===false)disabled.add(r.key);}}
export const catalogRows=()=>[...catalog.values()].map(r=>{const blockedBy=r.categories.filter(c=>disabledCategories.has(c));return {...r,sortOrder:r.sortOrder??1000000,manualEnabled:!disabled.has(r.key),blockedBy,enabled:!disabled.has(r.key)&&!blockedBy.length};}).sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name)).map((r,i)=>({...r,position:i+1}));
export function setCategoryPolicies(rows){disabledCategories.clear();for(const r of rows??[])if(r.enabled===false&&MARKET_CATEGORY_IDS.includes(r.category))disabledCategories.add(r.category);}
export const categoryPolicies=()=>MARKET_CATEGORY_IDS.map(category=>({category,enabled:!disabledCategories.has(category)}));
export function marketRank(m){const f=marketFamily(m);return f?catalog.get(f.key)?.sortOrder??1000000:1000000;}
export const disabledMarkets=()=>[...disabled];
export function setDisabledMarkets(keys){disabled.clear();for(const key of keys??[])if(typeof key==='string')disabled.add(key);}

