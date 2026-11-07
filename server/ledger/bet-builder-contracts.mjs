const OUTCOMES={'1X2':['1','X','2'],DC:['1X','12','X2'],BTTS:['Yes','No'],TOTAL:['Over','Under']};
const LINES=['0.5','1.5','2.5','3.5','4.5','5.5','6.5'];
const SCORING_PRESETS=[
 {id:'home-scores-only',label:'Vendasit shënojnë · Mysafirët nuk shënojnë',legs:[{market:'1X2',outcome:'1',line:''},{market:'BTTS',outcome:'No',line:''}]},
 {id:'away-scores-only',label:'Vendasit nuk shënojnë · Mysafirët shënojnë',legs:[{market:'1X2',outcome:'2',line:''},{market:'BTTS',outcome:'No',line:''}]},
];
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function builderCatalog(){
 return [
  {market:'1X2',title:'Rezultati final · 1X2'},
  {market:'DC',title:'Shansi i dyfishtë'},
  {market:'BTTS',title:'Të dyja ekipet shënojnë',presets:SCORING_PRESETS},
  {market:'TOTAL',title:'Totali i golave'},
 ].map(group=>({...group,options:(group.market==='TOTAL'?LINES:['']).flatMap(line=>OUTCOMES[group.market].map(outcome=>({market:group.market,outcome,line,label:group.market==='BTTS'?(outcome==='Yes'?'Po':'Jo'):outcome+(line?' '+line:'')})))}));
}
export function builderName(legs){
 const preset=SCORING_PRESETS.find(p=>legs.length===p.legs.length&&p.legs.every(expected=>legs.some(l=>l.market===expected.market&&l.outcome===expected.outcome&&!l.line)));
 if(preset)return preset.label;
 return legs.map(l=>l.market==='BTTS'?'BTTS '+l.outcome:l.outcome+(l.line?' '+l.line:'')).join(' + ');
}
export function normalizeBuilder({id,name,legs,active}={}){
 if(!Array.isArray(legs)||legs.length!==2)fail('Zgjidh saktësisht 2 tregje.');
 const cleaned=legs.map(leg=>{
  const market=String(leg?.market||'').toUpperCase(),outcome=OUTCOMES[market]?.find(x=>x.toLowerCase()===String(leg?.outcome||'').trim().toLowerCase());
  const line=market==='TOTAL'?String(leg?.line||'').replace(',','.'):'';
  if(!outcome||(market==='TOTAL'&&!LINES.includes(line)))fail('Market ose zgjedhje e pavlefshme.');
  return {market,outcome,line};
 });
 if(cleaned[0].market===cleaned[1].market)fail('Zgjidh dy tregje të ndryshme.');
 const pair=cleaned.map(l=>l.market).sort().join('+');
 if(!['1X2+BTTS','1X2+TOTAL','BTTS+TOTAL','DC+TOTAL'].includes(pair))fail('Ky çift tregjesh nuk mbështetet nga kuotimi Bet Builder.');
 if(id!=null&&!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(String(id)))fail('ID e pavlefshme.');
 // Canonical order gives every pair a stable automatic name.
 const order=['1X2','DC','BTTS','TOTAL'];cleaned.sort((a,b)=>order.indexOf(a.market)-order.indexOf(b.market));
 return {id:id??null,name:builderName(cleaned),legs:cleaned,active:active===true};
}
