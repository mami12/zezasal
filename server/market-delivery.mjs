import {isSameGameComboLine} from './ledger/combo-policy.mjs';
import {marketIsEnabled} from './market-catalog.mjs';
import {isExcludedOfferMarket} from './market-policy.mjs';
export const CATEGORIES=['all','Popular','Goals','Mixed','Corners','Cards','Halves','Players','Other'];
export function deliveryCategory(m={}){
 const n=String(m.name??'').toLowerCase(),type=String(m.marketType??'').toLowerCase();
 if(isSameGameComboLine({name:n})||/\b(?:outcome|double chance)\s+(?:and|&|\+)\s+(?:both|total)/i.test(n)||/will win (?:and|&) score exact/i.test(n))return 'Mixed';
 if(type==='corners'||/\bcorners?\b|corner kicks?/.test(n))return 'Corners';
 if(type==='cards'||/\bcards?\b|\bbookings?\b|disciplin/.test(n))return 'Cards';
 if(/\bplayers?\b|goalscorer|scorer|to be booked|player shots?/.test(n))return 'Players';
 if(/\b(?:result|winner|1x2)\b.*\b(?:total|goals|btts|both teams)\b|\b(?:total|goals|btts)\b.*\b(?:both teams|btts)\b/.test(n))return 'Mixed';
 if(/halftime\s*\/?\s*fulltime|half\s*time\s*\/\s*full\s*time|ht\s*\/\s*ft|\b(?:1st|2nd|first|second)\s+half\b|\bperiod\b/.test(n)||[1,2].includes(Number(m.period??0)))return 'Halves';
 if(/\b(?:1x2|match result|full time result|winner|double chance|draw no bet|moneyline|qualify|result)\b/.test(n)||type==='1x2')return 'Popular';
 if(type==='over_under'||/\bgoals?\b|\btotal\b|over\s*\/?\s*under|both teams|btts|correct score|odd\s*\/\s*even/.test(n))return 'Goals';
 return 'Other';
}
export const offeredMarket=(m,match)=>!isExcludedOfferMarket(m)&&marketIsEnabled(m,match);
export function detailProjection(match,category='all',page){
 const markets=(match.markets??[]).filter(m=>offeredMarket(m,match)),sets=Object.fromEntries(CATEGORIES.map(c=>[c,new Set()]));
 for(const m of markets){const key=[m.extId??m.key,m.name,m.period??0].join('|');sets.all.add(key);sets[deliveryCategory(m)].add(key);}
 let selected=category==='all'?markets:markets.filter(m=>deliveryCategory(m)===category);
 if(page?.search){
  const needle=page.search.toLocaleLowerCase();
  selected=selected.filter(m=>[m.name,m.line,...(m.outcomes??[]).map(o=>o.name)].some(value=>
    String(value??'').toLocaleLowerCase().includes(needle)));
 }
 const total=selected.length,offset=page?Math.min(total,Math.max(0,page.offset||0)):0;
 const limit=page?Math.max(1,page.limit||40):total;
 return {...match,marketCategories:Object.fromEntries(Object.entries(sets).map(([k,s])=>[k,s.size])),
  markets:page?selected.slice(offset,offset+limit):selected,marketCount:markets.length,
  ...(page?{marketPagination:{total,offset,nextOffset:Math.min(total,offset+limit),hasMore:offset+limit<total}}:{})};
}
const numeric=v=>/^\d{1,16}$/.test(String(v??''))?String(v):null;
export function normalizeScope(value){
 const boardIds=[...new Set((Array.isArray(value?.boardIds)?value.boardIds:[]).map(numeric).filter(Boolean))].slice(0,160);
 const detailId=numeric(value?.detail?.id),category=CATEGORIES.includes(value?.detail?.category)?value.detail.category:'Popular';
 const selectionIds=[...new Set((Array.isArray(value?.selectionIds)?value.selectionIds:[]).filter(v=>typeof v==='string'&&v.length<2048&&numeric(v.split('|')[0])))].slice(0,200);
 return {boardIds,detail:detailId?{id:detailId,category}:null,selectionIds};
}
export async function setSocketScope(socket,value){
 const scope=normalizeScope(value);socket.data.feedScope=scope;
 const desired=new Set(['feed:scoped',...scope.boardIds.map(id=>'feed:board:'+id),...(scope.detail?['feed:detail:'+scope.detail.id+':'+scope.detail.category]:[]),...[...new Set(scope.selectionIds.map(id=>id.split('|')[0]))].map(id=>'feed:slip:'+id)]);
 for(const room of [...socket.rooms])if(room.startsWith('feed:')&&!desired.has(room))await socket.leave(room);
 for(const room of desired)if(!socket.rooms.has(room))await socket.join(room);
 return scope;
}
export function emitScopedOdds(io,payload,boardKeys=new Set()){
 // Never broadcast all markets for all fixtures to every connected visitor.
 // Board viewers get only board rows; detail and betslip viewers get their
 // individually scoped market/selection updates below.
 const rooms=io.sockets.adapter.rooms;
 const boardRoom='feed:board:'+payload.matchId;
 const slipRoom='feed:slip:'+payload.matchId;
 const neededCategories=CATEGORIES.filter(category=>
   (rooms.get('feed:detail:'+payload.matchId+':'+category)?.size??0)>0);
 // Avoid any filtering or packet construction for a match without listeners.
 if(!rooms.get(boardRoom)?.size&&!rooms.get(slipRoom)?.size&&!neededCategories.length)return;
 const markets=(payload.markets??[]).filter(m=>offeredMarket(m,payload));
 if(rooms.get(boardRoom)?.size){
  const board=markets.filter(m=>boardKeys.has(m.key+'|'+(m.line??'')));
  if(board.length)io.to(boardRoom).emit('odds:update',{...payload,markets:board});
 }
 for(const category of neededCategories){
  const selected=category==='all'?markets:markets.filter(m=>deliveryCategory(m)===category);
  if(selected.length)io.to('feed:detail:'+payload.matchId+':'+category).emit('odds:update',{...payload,markets:selected});
 }
 for(const socketId of rooms.get(slipRoom)??[]){const socket=io.sockets.sockets.get(socketId),ids=new Set(socket?.data.feedScope?.selectionIds??[]);const selected=markets.map(m=>({...m,outcomes:(m.outcomes??[]).filter(o=>ids.has(`${payload.matchId}|${m.key}|${m.line??''}|${o.key}`))})).filter(m=>m.outcomes.length);if(selected.length)socket.emit('odds:update',{...payload,markets:selected});}
}
