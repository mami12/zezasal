import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadUiModule} from './fixtures/load-ui-module.mjs';
const {localizeApiError,userError}=loadUiModule(new URL('../web/src/utils/userError.ts',import.meta.url));
const {repairDisplayText}=loadUiModule(new URL('../web/src/utils/repairDisplayText.ts',import.meta.url));
const original=Object.assign(new Error('Request failed with status code 401'),{code:'ERR_BAD_REQUEST',response:{status:401,data:{message:'invalid username or password',code:'CREDENTIALS_INVALID',retryable:false}}});
const localized=localizeApiError(original,'al');
assert.equal(localized.message,'Emri i përdoruesit ose fjalëkalimi është i pasaktë.');
assert.equal(localized.response.data.message,localized.message);
assert.equal(localized.response.status,401);assert.equal(localized.code,original.code);
assert.equal(localized.response.data.code,'CREDENTIALS_INVALID');assert.equal(localized.response.data.retryable,false);
assert.equal(localized.serverResponse,original.response);
assert.equal(localized.serverMessage,'invalid username or password');
assert.equal(original.response.data.message,'invalid username or password','server response and diagnostics stay unchanged');
assert.equal(localizeApiError(original,'en'),original,'explicit English keeps the original display response');
assert.equal(userError('Shuma Ã«shtÃ« e pavlefshme.'),'Shuma është e pavlefshme.');
assert.equal(repairDisplayText('FranÃ§a · ShÃ«nojnÃ«'),'França · Shënojnë');
const al=loadUiModule(new URL('../web/src/i18n/al.ts',import.meta.url)).default;
function values(value){return typeof value==='string'?[value]:Object.values(value??{}).flatMap(values);}
for(const text of values(al))assert.equal(repairDisplayText(text),text,'Albanian dictionary is not double encoded: '+text);
function utf8(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory())utf8(path);
  else if(/\.(?:ts|tsx|css|mjs|json)$/.test(entry.name))new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path));
 }
}
utf8(fileURLToPath(new URL('../web/src/',import.meta.url)));
console.log('PASS Albanian API error display, preserved HTTP/business diagnostics, English choice, mojibake repair, dictionary text and strict UTF-8 frontend sources');
