import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url), cache = new Map();
/** Compile the real UI modules and their relative dictionaries for Node tests. */
export function loadUiModule(url) {
  if (cache.has(url.href)) return cache.get(url.href).exports;
  const module = { exports: {} }; cache.set(url.href, module);
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const localRequire = id => id.startsWith('.') ? loadUiModule(new URL(/\.(?:ts|tsx|js)$/.test(id) ? id : id + '.ts', url)) : require(id);
  new Function('exports', 'require', 'module', compiled)(module.exports, localRequire, module);
  return module.exports;
}
