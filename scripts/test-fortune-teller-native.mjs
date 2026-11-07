import {fortuneFixture} from './fixtures/fortune-teller-env.mjs';
import assert from 'node:assert/strict';
import {decodeFortuneNative,FORTUNE_NATIVE_SYMBOLS} from '../server/casino/fortune-teller-native.mjs';
import {fortuneCardsWin} from '../server/casino/fortune-teller-engine.mjs';
import {readFileSync} from 'node:fs';
const f=await fortuneFixture(),id='fortune-teller';
try{
 assert.deepEqual(FORTUNE_NATIVE_SYMBOLS,[9,11,10,8,7,6,5,4,3,2,1,0]);
 const client=readFileSync(new URL('../web/public/casino-original/fortune-teller/provider-original/9.4.1-fortuneteller.238/games/fortuneteller/fortuneteller_desktop.bundle.js',import.meta.url),'utf8');
 const match=client.match(/_payoutNames = (\[[^\]]+\]), this\._payouts = (\[[^\]]+\])/);assert.ok(match,'original Tarot table exists');
 const names=JSON.parse(match[1]),pays=JSON.parse(match[2]);
 for(let a=1;a<=4;a++)for(let b=1;b<=4;b++)for(let c=1;c<=4;c++){
  const cards=[a,b,c],native=cards.map(card=>4-card),counts=[0,1,2,3].map(type=>native.filter(card=>card===type).length),n=Math.max(...counts);
  const key=n===1?'_any_3':counts.indexOf(n)+'_'+n;assert.equal(pays[names.indexOf(key)],fortuneCardsWin(cards),'every mapped native Tarot payout matches Slotopol');
 }
 const token=(await f.store.launch(f.user,id)).sessionId;let seq=3;
 const decode=(body,sequence=seq++)=>decodeFortuneNative('d='+sequence+'\r\nwallet\r\n'+body+'\r\n');
 const act=async command=>(await f.store.act(f.user,id,token,[command]))[0];
 assert.match((await act(decode('104 196 0'))).native_packet,/104 1/);
 f.scenario();const request=decode('1 1 20 100'),[first,retry]=await Promise.all([act(request),act(request)]);
 assert.deepEqual(first,retry);assert.equal(await f.balance(),9980);assert.equal(await f.count(),1);
 assert.match(first.native_packet,/2 2 6 3\r\n2 2 6 1\r\n2 2 6 0/,'Tarot card indices match the native payout table');
 assert.doesNotMatch(first.native_packet,/\r\n3 /,'spin-end must wait for the original bonus input acknowledgements');
 for(let selection=0;selection<3;selection++){
  const command=decode('2 4 0 '+selection),a=await act(command),b=await act(command);assert.deepEqual(a,b);
  if(selection<2)assert.doesNotMatch(a.native_packet,/\r\n3 /);else assert.match(a.native_packet,/\r\n3 0 5 500 0 1/);
 }
 f.restart();const collect=decode('6');await act(collect);await act(collect);assert.equal(await f.balance(),9985);
 f.scenario('free');const free=await act(decode('1 1 20 100'));assert.equal(free.result.length,16);assert.match(free.native_packet,/ 15 1\r\n/);
 const subgame=await act(decode('7 0'));assert.match(subgame.native_packet,/2 0 0 10/);
 await assert.rejects(act(decode('7 1')),/Tarot/);
 for(let i=0;i<3;i++)await act(decode('2 4 0 '+i));
 for(let i=1;i<=15;i++)await act(decode('7 '+i));
 const before=await f.balance(),pending=free.result.at(-1).total_win/100;await act(decode('6'));assert.equal(await f.balance(),before+pending);
 for(const [lines,denom]of [[1,2000],[4,500],[13,200],[20,100]]){
  f.scenario('normal');const before=await f.balance(),result=await act(decode(`1 1 ${lines} ${denom}`));
  assert.equal(result.status.status,'ok');assert.equal(await f.balance(),before-lines*denom/100);await act(decode('6'));
 }
 await assert.rejects(act(decode('1 1 1 100')),/20 and 5000/);
 for(const text of ['1 1 20 100\r\n1 1 20 100','1 0 20 100','2 4 -1','1 1 21 100']){
  if(text.startsWith('2'))await assert.rejects(act(decode(text)));else assert.throws(()=>decode(text));
 }
 assert.equal(fortuneCardsWin([1,1,1]),1000);assert.equal(fortuneCardsWin([4,4,4]),20);
 const total=Number((await f.sql.query('select coalesce(sum(amount),0) as n from app_transaction where user_id=$1',[f.user])).rows[0].n);
 assert.equal(Math.round((await f.balance())*100),1000000+Math.round(total*100));
 console.log('PASS Fortune Teller original packets: native symbols/cards, deferred spin end, durable retries/collect, full free chain, 1–20 lines, exact stake units, invalid packets and ledger reconciliation');
}finally{await f.close();}
