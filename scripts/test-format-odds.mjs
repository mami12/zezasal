import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url), ts = require('typescript');
const source = readFileSync(new URL('../web/src/utils/formatOdds.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('exports', 'require', 'module', compiled)(module.exports, require, module);
const { formatOdds } = module.exports;
for (const [value, expected] of [
  [1, '1.00'], [3, '3.00'], [75.9, '75.90'], [3.96, '3.96'], [3.9601, '3.96'],
  [8.189, '8.19'], [4.31 * 1.9, '8.19'], [2.1000, '2.10'],
  [2.1001, '2.10'], [2.1010, '2.10'], [15.18, '15.18'], [0, '0.00'],
  [12.123456, '12.12'], [22.243492358, '22.24'], [1.005, '1.01'], [1.00499,'1.00'],
  [1e-7,'0.00'], [null, '—'], [undefined, '—'], [NaN, '—'], [Infinity, '—'],
]) assert.equal(formatOdds(value), expected, String(value));
assert.notEqual(formatOdds(3.96), formatOdds(3.97), 'a new two-decimal quote remains visibly different');
console.log('PASS odds formatter: exactly two decimals, requested22.24 example, precise half-up boundaries and invalid quotes');
