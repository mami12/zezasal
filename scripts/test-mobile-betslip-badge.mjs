import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the actual TS helper after erasing the type-only import.
const src = readFileSync(new URL('../web/src/utils/betslipMatchCount.ts', import.meta.url),'utf8');
const compiled = ts.transpileModule(src, {
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020},
}).outputText;
const { countBetslipMatches } = await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

assert.equal(countBetslipMatches([]),0,'Empty ticket shows 0');
assert.equal(countBetslipMatches([{matchId:'3999'}]),1,'First match shows 1');
assert.equal(countBetslipMatches([
  {matchId:'3999'},{matchId:'3999'},
]),1,'Two markets in the SAME match still show 1');
assert.equal(countBetslipMatches([
  {matchId:'3999'},{matchId:'3999'},{matchId:'4000'},
]),2,'Another match shows 2');
assert.equal(countBetslipMatches([
  {matchId:3999},{matchId:'3999'},{matchId:'4000'},
]),2,'Match id number/string changes do not duplicate matches');
console.log('Mobile betslip match counter passed');
