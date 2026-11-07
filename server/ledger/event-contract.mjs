// Parse the original provider contract, never a translated presentation label.
export function eventContract(line={}){
 let original=String(line.market_name??line.name??''),player=original.split(' · ')[1]?.trim();
 let name=original.split(' · ')[0].toLowerCase().replace(/\s+/g,' ').trim();
 // Explicit five-minute corner YES/NO contracts are event totals over a
 // frozen clock window. A generic "next five minutes" has no trustworthy
 // starting minute and must remain unsupported, not be guessed from FT stats.
 const legacyCorner=name.match(/^(\d+) minutes?\s*[-:]\s*(?:will there be (?:a )?)?corners?\s+from (\d+):00 to (\d+) min(?:ute)?s?$/);
 if(legacyCorner){
  const width=Number(legacyCorner[1]),from=Number(legacyCorner[2]),to=Number(legacyCorner[3]);
  if(width!==to-from||width<1||to>90)return {valid:false};
  name='total corners from '+from+':00 to '+to+' min';
 }
 name=name.replace(/^(?:will there be (?:a |any )?|will (?:there )?be (?:a |any )?)corners?(?=\s+(?:in|during|between|from|before|after|within|by|until|at)\b)/,'total corners');
 name=name.replace(/^corners?(?=\s+(?:in|during|between|from|before|after|within|by|until|at)\b)/,'total corners');
 try{const pl=JSON.parse(Buffer.from(String(line.market_key??line.key??'').split('@')[1],'base64url').toString()).pl;if(typeof pl==='string'&&pl.trim()){player??=pl;name=name.replace(pl.toLowerCase(),'player');}}catch{}
 let half=null;name=name.replace(/^(1st|first|2nd|second) half\s*[-:.]\s*/,(s,h)=>{half=/1st|first/.test(h)?1:2;return '';});
 const timing=name.match(/^when will goal (\d+) be scored(?: \((\d+)-minute intervals\))?$/);
 if(timing)return {name,player,half,timing:Number(timing[1]),valid:Number(timing[1])>0};
 let window=null;
 const clockRange=name.match(/ from (\d+):00 to (\d+) min(?:ute)?s?$/);
 if(clockRange){window={from:Number(clockRange[1])+1,to:Number(clockRange[2])};name=name.slice(0,clockRange.index);}
 const range=name.match(/ (?:in|during|between) (?:the )?(?:minutes? )?(\d+)\s*[-–]\s*(\d+)(?: minutes?)?(?: \((\d+)-minute interval\))?$/);
 if(range){window={from:Number(range[1]),to:Number(range[2])};if(range[3]&&Number(range[3])!==window.to-window.from+1)return {valid:false};name=name.slice(0,range.index);}
 else {
  const bound=name.match(/ (before|after|within|by|until|at|in|during) (?:the )?(?:(\d+)(?:st|nd|rd|th)? minutes?|minutes? (\d+))$/);
  if(bound){const n=Number(bound[2]??bound[3]),op=bound[1];window={from:op==='after'?n+1:/at|^in$|during/.test(op)?n:0,to:op==='before'?n-1:op==='after'?90:n};if(n<1||n>90)return {valid:false};name=name.slice(0,bound.index);}
 }
 if(window&&(window.from<0||window.to>90||window.to<window.from))return {valid:false};
 let mode=null,amount=null;
 name=name.replace(/^player (?:to score )?(\d+) or more goals?$/,(s,n)=>{mode='atLeast';amount=Number(n);return 'player to score';});
 name=name.replace(/^player (?:to score )?(?:exactly|exact) (\d+)(?: goals?)?$/,(s,n)=>{mode='exact';amount=Number(n);return 'player to score';});
 name=name.replace(/^player (?:to score )?(\d+) goals? exactly$/,(s,n)=>{mode='exact';amount=Number(n);return 'player to score';});
 name=name.replace(/^player (?:to score )?(\d+)\+(?: goals?)?$/,(s,n)=>{mode='atLeast';amount=Number(n);return 'player to score';});
 name=name.replace(/^player (?:to score (?:a )?)?hat[ -]?trick$/,(s)=>{mode='atLeast';amount=3;return 'player to score';});
 if(/^(?:player )?(?:exact goals|exact number of goals|exactly goals)$/.test(name)){mode='exactSelection';name=name.startsWith('player')?'player to score':'total goals';}
 const method=/header|headed|with (?:a |the )?head/.test(name)?'header':/left[ -]foot/.test(name)?'leftFoot':/right[ -]foot/.test(name)?'rightFoot':/own goal/.test(name)?'own':/penalty.*goal|goal.*penalty|player to score (?:a )?penalty/.test(name)?'penalty':null;
 const playerMethod=/^player to score (?:a (?:header|headed goal|penalty)|with (?:the |a )?(?:head|left[ -]foot|right[ -]foot))$/.test(name);
 const seq = Number(line.snapshot_target_sequence ?? line.line);
 if (/^(?:next goal|next team to score|goli i radh[eë]s)$/i.test(name) && Number.isFinite(seq) && seq > 0) {
  name = `who scores goal ${seq}`;
 }
 const valid=playerMethod||/^(?:total (?:goals|corners|cards)(?: (?:home|away) team)?|(?:home|away) team total (?:goals|corners|cards)|total (?:home|away) team|who scores most goals|who takes most corners|who receives most cards|who scores goal \d+|first goal|last goal|next goal|next team to score|goli i radh[eë]s|own goals?|(?:headed|header|penalty) goals?|player(?: to assist| to score(?: a goal)?)|(?:first|last|anytime) (?:goalscorer|goal scorer))$/.test(name);
 return {valid:valid&&(amount==null||(Number.isInteger(amount)&&amount>=0&&amount<=100&&(mode!=='atLeast'||amount>0))),name,player,half,window,mode,amount,method};
}
export function eventInWindow(event,contract){
 if(contract.half){const first=/^(?:H1|FIRST_HALF|1st half)$/i.test(event.phase??''),second=/^(?:H2|SECOND_HALF|2nd half)$/i.test(event.phase??'');if(contract.half===1?(second||(!first&&event.minute>45)):(first||(!second&&event.minute<=45)))return false;}
 return !contract.window||(event.minute>=contract.window.from&&event.minute<=contract.window.to);
}
export function eventSelectionSupported(line={}){
 const c=eventContract(line);if(!c.valid)return false;
 const label=line.outcome_name??line.outcomeName;if(label==null)return true;
 const text=String(label).trim(),key=String(line.outcome_key??line.outcomeKey??'');
 if(c.timing){
  if(/^(?:no goal|none|no more goals)$/i.test(text)||key==='none')return true;
  const r=text.match(/^(\d+)\s*[-–]\s*(\d+)(?:\s*(?:minutes?|min))?$/i)??key.match(/^(\d+)-(\d+)$/);
  return !!r&&Number(r[1])>=0&&Number(r[2])<=90&&Number(r[1])<=Number(r[2]);
 }
 if(c.mode==='exactSelection')return /^\d+$/.test(text)&&Number(text)<=100;
 return true;
}
