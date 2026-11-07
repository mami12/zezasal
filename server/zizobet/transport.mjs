import zlib from 'node:zlib';import crypto from 'node:crypto';import WebSocket from 'ws';
export const CACHE='https://wss-eu-uk1.ws-amazon.com/api/cache/get?key=';
export const META='https://analytics-sp.googleserv.tech/api/';
export function decode(value){
 for(let n=0;n<6;n++){
  if(typeof value!=='string')return value;
  if(value.startsWith('H4sI'))value=zlib.gunzipSync(Buffer.from(value,'base64'),{maxOutputLength:32000000}).toString();
  else if(!/^[\s]*[\[{"ntf\d-]/.test(value))value=Buffer.from(value,'base64').toString();
  try{value=JSON.parse(value);}catch{const decoded=Buffer.from(value,'base64').toString();if(decoded===value)throw Error('Unknown public cache encoding');value=decoded;}
 }throw Error('Public cache nesting exceeded');
}
export async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{accept:'application/json',origin:'https://zizobet.com'}});if(r.status===204)return null;if(!r.ok)throw Error('Zizobet HTTP '+r.status);return decode(await r.text());}
const str=s=>{const b=Buffer.from(s),h=Buffer.alloc(2);h.writeUInt16BE(b.length);return Buffer.concat([h,b]);};
export function packet(type,body){let length=body.length,bytes=[];do{let b=length%128;length=Math.floor(length/128);if(length)b|=128;bytes.push(b);}while(length);return Buffer.concat([Buffer.from([type,...bytes]),body]);}
/** Only known public sports cache topics. Never profiles, balances or wildcard subscriptions. */
export function startMqtt({onInvalidate,onStatus,WebSocketImpl=WebSocket}={}){
 let ws,stopped=false,paused=false,retry,timer,pong=Date.now(),sequence=0,connected=false,buffer=Buffer.alloc(0);let topics=new Set(['live/headerformobilenew/en','prematch/header','prematch/games','prematch/markets']),subscribed=new Set();
 const state={connected:false,transport:'MQTT/WSS',connections:0,publications:0,lastError:null};
 let publicationStatusAt=0;
 const status=patch=>{Object.assign(state,patch);onStatus?.({...state});};
 function sync(){if(!connected)return;const add=[...topics].filter(t=>!subscribed.has(t)),remove=[...subscribed].filter(t=>!topics.has(t));for(const[a,type]of[[add,130],[remove,162]])for(let i=0;i<a.length;i+=50){const ids=Buffer.alloc(2);ids.writeUInt16BE(sequence=sequence%65535+1);ws.send(packet(type,Buffer.concat([ids,...a.slice(i,i+50).flatMap(t=>type===130?[str(t),Buffer.from([0])]:[str(t)])])));}subscribed=new Set(topics);}
 function connect(){if(stopped||paused)return;buffer=Buffer.alloc(0);subscribed.clear();connected=false;
  ws=new WebSocketImpl('wss://wss-eu-uk1.ws-amazon.com/mqtt',['mqtt'],{headers:{origin:'https://zizobet.com'},handshakeTimeout:10000});
  ws.on('open',()=>{if(stopped||paused)return ws.close();ws.send(packet(16,Buffer.concat([str('MQTT'),Buffer.from([4,2,0,20]),str('football-'+crypto.randomBytes(10).toString('hex'))])));});
  ws.on('message',part=>{try{
   buffer=Buffer.concat([buffer,Buffer.from(part)]);if(buffer.length>1000000)throw Error('MQTT frame limit');
   while(buffer.length>=2){let p=1,m=1,length=0,b;do{if(p>=buffer.length)return;b=buffer[p++];length+=(b&127)*m;m*=128;if(p>5)throw Error('Invalid MQTT length');}while(b&128);if(buffer.length<p+length)return;
    const frame=buffer.subarray(0,p+length),type=frame[0]>>4;buffer=buffer.subarray(p+length);pong=Date.now();
    if(type===2){if(frame[p+1]!==0)throw Error('Anonymous MQTT connection refused');connected=true;status({connected:true,lastError:null,connections:state.connections+1});sync();for(const topic of topics)onInvalidate?.(topic);}
    if(type===9&&frame.subarray(p+2).includes(128))throw Error('Public MQTT subscription refused');
    if(type===3){const n=frame.readUInt16BE(p);p+=2;const topic=frame.subarray(p,p+n).toString();p+=n;const qos=(frame[0]>>1)&3;if(qos)p+=2;if(!topics.has(topic))continue;
     // Publications contain an invalidation URL. Fetch our own allowlisted
     // key, never a URL supplied by an arbitrary MQTT payload.
     state.publications++;if(Date.now()-publicationStatusAt>=3000){publicationStatusAt=Date.now();status({});}onInvalidate?.(topic);if(qos===1)ws.send(packet(64,frame.subarray(p-2,p)));
    }
   }
  }catch(e){status({lastError:e.message});ws.close();}});
  ws.on('error',()=>status({lastError:'MQTT connection error'}));
    ws.on('close',()=>{connected=false;status({connected:false});if(!stopped&&!paused)retry=setTimeout(connect,3000);});
 }
 const armHeartbeat=()=>{clearInterval(timer);timer=setInterval(()=>{if(connected){if(Date.now()-pong>45000)ws.terminate();else ws.send(Buffer.from([192,0]));}},15000);};
 connect();armHeartbeat();
 return{state,setLiveIds(ids){topics=new Set(['live/headerformobilenew/en','prematch/header','prematch/games','prematch/markets',...ids.map(id=>'live/gamenew/'+Number(id))]);sync();},pause(){if(paused||stopped)return false;paused=true;clearTimeout(retry);clearInterval(timer);connected=false;ws?.terminate();return true;},resume(){if(!paused||stopped)return false;paused=false;pong=Date.now();connect();armHeartbeat();return true;},stop(){stopped=true;clearTimeout(retry);clearInterval(timer);ws?.terminate();}};
}
