import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {normalizeBuilder,builderCatalog} from '../server/ledger/bet-builder-contracts.mjs';
import {saveTemplate} from '../server/ledger/bet-builders.mjs';
const sql=new PGlite();await sql.exec(LEDGER_SQL);
try{
 const catalog=builderCatalog();assert.equal(catalog.length,4);assert.equal(catalog.flatMap(c=>c.options).length,22);
 const presets=catalog.flatMap(c=>c.presets||[]);assert.equal(presets.length,2);
 for(const [index,preset] of presets.entries()){
  assert.deepEqual(preset.legs,[{market:'1X2',outcome:index===0?'1':'2',line:''},{market:'BTTS',outcome:'No',line:''}]);
  const normalized=normalizeBuilder({legs:[...preset.legs].reverse(),name:'ignored',active:true});
  assert.equal(normalized.name,preset.label);assert.deepEqual(normalized.legs,preset.legs);
 }
 const first={market:'1X2',outcome:'1',line:''},second={market:'BTTS',outcome:'Yes',line:''};
 for(const legs of [[],[first],[first,second,{market:'TOTAL',outcome:'Over',line:'2.5'}]])assert.throws(()=>normalizeBuilder({legs}),/saktësisht 2/);
 assert.throws(()=>normalizeBuilder({legs:[first,{...first,outcome:'2'}]}),/ndryshme/);
 assert.throws(()=>normalizeBuilder({legs:[first,{market:'DC',outcome:'1X'}]}),/nuk mbështetet/);
 assert.throws(()=>normalizeBuilder({legs:[first,{market:'TOTAL',outcome:'Over',line:'2.7'}]}),/pavlefshme/);
 const executor=sql.query.bind(sql);
 const saved=await saveTemplate({name:'ignored manual title',legs:[second,first],active:true},{executor});
 assert.equal(saved.name,'1 + BTTS Yes');assert.equal(saved.legs.length,2);assert.equal(saved.active,true);
 const updated=await saveTemplate({id:saved.id,legs:[{market:'TOTAL',outcome:'under',line:'2,5'},{market:'DC',outcome:'X2'}],active:false},{executor});
 assert.equal(updated.name,'X2 + Under 2.5');assert.equal(updated.active,false);
 const rows=(await sql.query('select * from app_bet_builder_template')).rows;assert.equal(rows.length,1);assert.deepEqual(rows[0].legs,updated.legs);
 for(const preset of presets){
  const scoring=await saveTemplate({legs:preset.legs,active:true},{executor});
  const persisted=(await sql.query('select * from app_bet_builder_template where id=$1',[scoring.id])).rows[0];
  assert.equal(persisted.name,preset.label);assert.deepEqual(persisted.legs,preset.legs);assert.equal(persisted.active,true);
 }
 console.log('PASS two-button builder contracts: catalog, scoring presets, exact pair validation, automatic naming and SQL save/edit persistence');
}finally{await sql.close();}
