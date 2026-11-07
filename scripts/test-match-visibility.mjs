import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {pool} from '../server/db.mjs';
import * as overrides from '../server/ledger/overrides.mjs';
import * as store from '../server/match-store.mjs';
import {publishedBoard} from '../server/ledger/board-settings-store.mjs';
const db=new PGlite();await db.exec(LEDGER_SQL);const previous=pool.query;pool.query=(...args)=>db.query(...args);
try{
 store.clear();store.upsert([1,2].map(id=>({match_id:id,sport_id:18,home:'Home',away:'Away',service:id===1?'LIVE':'PREMATCH',status:'scheduled',active:true,tournament_name:'Unknown league',category_slug:'japan'})));
 assert.equal((await publishedBoard()).rows.length,2);
 const events=[];const unsubscribe=overrides.onVisibilityChange(e=>events.push(e));
 for(const id of [1,2]){await overrides.setMatchHidden(id,true);assert.ok(!(await publishedBoard()).rows.some(r=>r.match_id===id));await overrides.refresh(true);assert.equal(overrides.matchOverride(id).hidden,true);await overrides.setMatchHidden(id,false);assert.ok((await publishedBoard()).rows.some(r=>r.match_id===id));}
 assert.equal(events.length,4);unsubscribe();assert.equal(store.getMatches({catalog:true}).length,2,'visibility never deletes provider fixtures');
 console.log('PASS explicit admin match hide/show: LIVE/PREMATCH, SQL persistence/reload, notification, real feed rows preserved');
}finally{pool.query=previous;store.clear();await db.close();await pool.end();}
