import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {COUNTRY_FLAGS,countryFlagFile} from '../web/src/utils/countryFlags.mjs';
const folder=new URL('../web/public/country-flags/',import.meta.url);
const source=JSON.parse(readFileSync(new URL('SOURCE.json',folder),'utf8').replace(/^\uFEFF/,''));
assert.equal(COUNTRY_FLAGS.length,100);assert.equal(source.assets.length,100);
assert.equal(new Set(COUNTRY_FLAGS.map(item=>item.code)).size,100);
assert.equal(new Set(COUNTRY_FLAGS.map(item=>item.file)).size,100);
for(const {code,file} of COUNTRY_FLAGS){
 assert.equal(countryFlagFile(null,code),file);
 assert.equal(countryFlagFile(code),file);
 const bytes=readFileSync(new URL(file,folder)),text=bytes.toString('utf8');
 assert.match(text,/<svg\b/);assert.doesNotMatch(text,/<script\b|<foreignObject\b|<!DOCTYPE|\bon\w+\s*=/i);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),source.assets.find(asset=>asset.file===file).sha256,'original captured bytes preserved');
}
for(const [name,file] of [['England','england.svg'],['Angli','england.svg'],['Skocia','scotland.svg'],['Uellsi','wales.svg'],['Czechia','czech-republic.svg'],['North Macedonia','republic-of-macedonia.svg'],['Poloni','republic-of-poland.svg'],['Türkiye','turkey.svg'],['SHBA','united-states-of-america.svg'],['Korea Republic','south-korea.svg'],['Chinese Taipei','taiwan.svg'],['El Salvador','salvador.svg'],['Uzbekistan','uzbekistn.svg'],['Zvicër','switzerland.svg'],['Brazil','brazil.svg']])assert.equal(countryFlagFile(name),file,name);
for(const name of ['International','International Club Friendlies','World Cup','Europe','UEFA Champions League','FIFA World Cup','Ndërkombëtare','Unknown category','UK','United Kingdom','Albania','Northern Ireland'])assert.equal(countryFlagFile(name),null,name);
assert.equal(countryFlagFile('England','DE'),'england.svg','recognized country name beats conflicting provider code');
assert.equal(countryFlagFile('International Clubs','US'),null,'international category is never painted as a national team');
assert.equal(countryFlagFile('../../england.svg'),null,'provider input is never a file path');
assert.equal(readdirSync(fileURLToPath(folder)).filter(name=>name.endsWith('.svg')).length,100);
console.log('PASS100originalSVGs/provenance hashes, ISO + Shqip/English aliases, home nations, unknown/international fallback and safe file lookup');
