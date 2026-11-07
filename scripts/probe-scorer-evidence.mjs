/** Read-only, bounded diagnostic for one user-supplied provider match. No DB. */
import WebSocket from 'ws';
import {mkdirSync,writeFileSync} from 'node:fs';
const matchId=Number(process.argv[2]);if(!Number.isSafeInteger(matchId)||matchId<=0)throw Error('Provide the verified provider match ID');
const partner=process.env.PARTNER_ID??'d3edfa27-7cac-4f77-9e6e-4e2fa2d1ab5f',lang='en-001';
const report={at:new Date().toISOString(),matchId,rest:[],socket:{opened:false,frames:0,messageTypes:{},dataKeys:[],evidencePaths:[],scorerMarkets:[],errors:[]}};
const gateway='https://api-gateway.gw-lucky-bet.com';
for(const [path,body] of [['matches/get-many',{matchIds:[matchId],limit:20,offset:0}],['matches/get-one',{id:matchId}]]){
 try{const r=await fetch(`${gateway}/${path}?l=${lang}&p=${encodeURIComponent(partner)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const j=await r.json().catch(()=>null),data=j?.result;const items=data?.items??(data?[data]:[]);const target=items.find(x=>Number(x.id??x.matchId)===matchId);report.rest.push({path,status:r.status,resultKeys:data?Object.keys(data):[],target:target?{id:target.id??target.matchId,keys:Object.keys(target),service:target.service,scoreBoardKeys:Object.keys(target.scoreBoard??{})}:null});}catch(e){report.rest.push({path,error:e.cause?.code||e.name});}
}
const evidence=new Set(),keys=new Set();
function inspect(value,path='',depth=0){if(!value||typeof value!=='object'||depth>9)return;for(const [k,v]of Object.entries(value)){if(/player|scorer|incident|timeline|goal.?event|settle|won|lost|payout|participants/i.test(k))evidence.add(path+'.'+k);if(Array.isArray(v)){for(const item of v.slice(0,40))inspect(item,path+'.'+k+'[]',depth+1);}else inspect(v,path+'.'+k,depth+1);}}
await new Promise(resolve=>{
 const socket=new WebSocket(`${gateway.replace('https:','wss:')}/push-server-v2/?Language=${lang}&externalPartnerId=${encodeURIComponent(partner)}&EIO=4&transport=websocket`,{headers:{origin:'https://bitgames6205.com'},handshakeTimeout:12000});
 const finish=()=>{clearTimeout(timer);socket.terminate();resolve();};
 const timer=setTimeout(finish,22000);
 socket.on('open',()=>{report.socket.opened=true;});
 socket.on('error',e=>{report.socket.errors.push(e.code||e.name);finish();});
 socket.on('message',buffer=>{
  const text=buffer.toString();report.socket.frames++;
  if(text==='2'){socket.send('3');return;}
  if(text.startsWith('0{')){socket.send('40');return;}
  if(text.startsWith('40')){for(const type of ['subscribe-match-info','subscribe-match-odds'])socket.send('42'+JSON.stringify(['subscribe',{messageType:type,data:{matchIds:[matchId],...(type.endsWith('odds')?{isBaseOddsGroups:false}:{})}}]));return;}
  if(!text.startsWith('42'))return;
  try{const packet=JSON.parse(text.slice(2)),message=packet[1];if(!message?.messageType)return;report.socket.messageTypes[message.messageType]=(report.socket.messageTypes[message.messageType]||0)+1;const data=message.data??{};if(data.matchId!=null&&Number(data.matchId)!==matchId)return;Object.keys(data).forEach(k=>keys.add(k));inspect(data,'data');for(const group of data.oddsGroups??[]){const name=String(group.name??group.marketName??'');if(String(group.id)==='16176'||/scorer|player.*score/i.test(name)){report.socket.scorerMarkets.push({id:group.id,name,keys:Object.keys(group),outcomes:group.outcomes,subgames:group.subgames});}}}catch{}
 });
});
report.socket.dataKeys=[...keys];report.socket.evidencePaths=[...evidence];
mkdirSync('outputs',{recursive:true});writeFileSync(`outputs/scorer-evidence-${matchId}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
