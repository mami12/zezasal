import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {applyReskinCountryFlags} from './reskin-country-flags.mjs';
const reskin='D:\\cassino\\lojra\\lojrafaqja\\faqja-main\\faqja-main';
const parent=path.resolve('tmp');fs.mkdirSync(parent,{recursive:true});const temp=fs.mkdtempSync(path.join(parent,'reskin-flags-'));
const files=['web/src/components/Sports/MatchList.tsx','web/src/components/Sports/MatchDetail.tsx','web/src/components/Layout/SportsSidebar.tsx'];
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=files.map(file=>hash(path.join(reskin,file)));
try{
 // The exporter starts with generic blue files; the helper must retain the
 // actual Vave wrappers and change only the new flag presentation.
 for(const file of files){const to=path.join(temp,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(file,to);}
 assert.deepEqual(applyReskinCountryFlags(reskin,temp),files);
 const result=files.map(file=>fs.readFileSync(path.join(temp,file),'utf8'));
 assert.ok(result[0].includes('vave-match-board')&&result[0].includes('<CountryFlag country={fixtures[0]'));
 assert.ok(result[1].includes('vave-match-detail')&&result[1].includes('<CountryFlag country={live.tournament'));
 assert.ok(result[2].includes('vave-sports-sidebar')&&result[2].includes('<CountryFlag country={category.name}'));
 assert.ok(result[2].includes('tournamentLogo(tour.name,tour.category)'),'existing league logos are preserved');
 assert.equal(result[2].includes('countryFlags['),false,'emoji country guesses removed');
 for(const [index,source] of result.entries()){
  const compiled=ts.transpileModule(source,{fileName:files[index],reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
  assert.deepEqual((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
 }
 const detail=path.join(temp,files[1]);fs.appendFileSync(detail,'\n// previously prepared functional feature\n');
 applyReskinCountryFlags(reskin,temp);
 assert.ok(fs.readFileSync(detail,'utf8').includes('// previously prepared functional feature'),'other prepared functional changes survive');
 const once=files.map(file=>hash(path.join(temp,file)));applyReskinCountryFlags(reskin,temp);assert.deepEqual(files.map(file=>hash(path.join(temp,file))),once,'idempotent flags patch');
 assert.deepEqual(files.map(file=>hash(path.join(reskin,file))),before,'live reskin was read-only');
 assert.throws(()=>applyReskinCountryFlags(reskin,reskin),/outside the live/);
 console.log('PASS reskin flag helper: Vave layout/league logos retained, local country flags, existing prepared features preserved, TS syntax, idempotency and live source unchanged');
}finally{assert.ok(path.resolve(temp).startsWith(parent+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
