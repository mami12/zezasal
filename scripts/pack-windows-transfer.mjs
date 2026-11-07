/** Source-only USB bundle: built-in Node, PowerShell ZIP and tar verification. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readdir,rename,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=join(root,'transfers','faqja-windows-'+stamp);
const archive=join(output,'faqja-windows.partial.zip');
const completeArchive=join(output,'faqja-windows.zip');
const trees=['server','scripts','docs','web/src','web/public','web/tests','.xgrok'];
const rootFiles=new Set(['package.json','package-lock.json','start.bat','stop.bat','restore-db.bat',
 'backup-db.bat','migrate-db-local.bat','market-map.json','market-map.example.json',
 'railway.json','.gitignore','.gitattributes','.env.example','.env.windows.example','.env.local-db.example']);
const excluded=['node_modules','web/node_modules','npm-cache','web/dist','data','.env',
 '.runtime','backups','tmp','test-artifacts','fortuntelle','assets-source',
 'www.playngo.com','faqja-main','.git','transfers','logs and loose temporary files'];
const files=[];

function safePath(path){
 assert.ok(path&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').includes('..'),'relative bundle path');
 assert.ok(!path.split('/').some(part=>part==='node_modules'||part==='.env'),'private/dependency path excluded: '+path);
 if(path.split('/').some(part=>part.startsWith('.env')))
  assert.ok(rootFiles.has(path)&&path.endsWith('.example'),'only explicit environment templates may be exported');
}
async function collect(directory){
 let entries;try{entries=await readdir(join(root,directory),{withFileTypes:true});}
 catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const entry of entries){
  const path=directory+'/'+entry.name;
  assert.ok(!entry.isSymbolicLink(),'symlinks need explicit review: '+path);
  if(entry.isDirectory())await collect(path);
  else if(entry.isFile()){safePath(path);files.push(path);}
 }
}
async function hashFile(path,aggregate){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(join(root,path))){bytes+=chunk.length;hash.update(chunk);aggregate?.update(chunk);}
 return {path,bytes,sha256:hash.digest('hex')};
}
function tar(args,{input,onData}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn('tar',args,{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let errorText='';const chunks=[];
  child.stdout.on('data',chunk=>onData?onData(chunk):chunks.push(chunk));
  child.stderr.on('data',chunk=>{errorText+=chunk.toString();});
  child.on('error',reject);
  child.stdin.on('error',()=>{});
  child.on('close',code=>code===0?resolve(Buffer.concat(chunks).toString('utf8')):reject(Error('tar failed: '+errorText.trim())));
  child.stdin.end(input);
 });
}
function writeWindowsZip(){
 // Windows tar's stdin file lists can misread non-ASCII asset names. .NET reads
 // the UTF-8 JSON manifest and writes UTF-8 ZIP entries through wide Windows APIs.
 const command=`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
$manifest=ConvertFrom-Json ([IO.File]::ReadAllText($env:FAQJA_TRANSFER_MANIFEST))
$root=[IO.Path]::GetFullPath($env:FAQJA_TRANSFER_ROOT).TrimEnd([char]'\\')+'\\'
$stream=[IO.File]::Open($env:FAQJA_TRANSFER_ZIP,[IO.FileMode]::CreateNew)
try {
 $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false,[Text.Encoding]::UTF8)
 try {
  foreach($file in $manifest.files){
   $source=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$file.path))
   if(-not $source.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'Asset path outside the project'}
   $entry=$zip.CreateEntry($file.path,[IO.Compression.CompressionLevel]::Optimal)
   $inputStream=[IO.File]::OpenRead($source)
   try {$outputStream=$entry.Open();try{$inputStream.CopyTo($outputStream)}finally{$outputStream.Dispose()}}
   finally{$inputStream.Dispose()}
  }
 } finally {$zip.Dispose()}
} finally {$stream.Dispose()}
`;
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{
   cwd:root,windowsHide:true,stdio:['ignore','ignore','pipe'],
   env:{...process.env,FAQJA_TRANSFER_ROOT:root,FAQJA_TRANSFER_MANIFEST:join(output,'TRANSFER-MANIFEST.json'),FAQJA_TRANSFER_ZIP:archive},
  });
  let errorText='';child.stderr.on('data',chunk=>{errorText+=chunk.toString();});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('ZIP creation failed: '+errorText.trim())));
 });
}
function readWindowsZipNames(){
 const command=`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$stream=[IO.File]::OpenRead($env:FAQJA_TRANSFER_ZIP)
try {
 $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Read)
 try {[Console]::Write((ConvertTo-Json -InputObject @($zip.Entries | ForEach-Object {$_.FullName}) -Compress))}
 finally {$zip.Dispose()}
} finally {$stream.Dispose()}
`;
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{
   cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,FAQJA_TRANSFER_ZIP:archive},
  });
  const chunks=[];let errorText='';child.stdout.on('data',chunk=>chunks.push(chunk));
  child.stderr.on('data',chunk=>{errorText+=chunk.toString();});child.on('error',reject);
  child.on('close',code=>{
   if(code!==0){reject(Error('ZIP listing failed: '+errorText.trim()));return;}
   try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}
  });
 });
}

for(const entry of await readdir(root,{withFileTypes:true})){
 if(entry.isFile()&&(rootFiles.has(entry.name)||entry.name.endsWith('.md'))){safePath(entry.name);files.push(entry.name);}
}
// Keep build configuration and the frontend lockfile, without copied dependencies/dist.
for(const entry of await readdir(join(root,'web'),{withFileTypes:true})){
 if(entry.isFile()&&(/\.(?:json|[cm]?js|ts|html)$/.test(entry.name)||entry.name==='.gitignore')){
  const path='web/'+entry.name;safePath(path);files.push(path);
 }
}
for(const tree of trees)await collect(tree);
files.sort();assert.equal(files.length,new Set(files).size,'unique export paths');
for(const required of ['package-lock.json','start.bat','USB-TRANSFER.md','server/index.mjs',
 'scripts/windows-server.mjs','web/index.html','web/src/main.tsx',
 'web/public/casino-original/fortune-teller/index.html',
 'web/public/casino-original/fortune-teller/provider-original/9.4.1-fortuneteller.238/provenance.json'])
 assert.ok(files.includes(required),'required transfer file: '+required);

console.log('Hashing '+files.length+' source and asset files...');
const records=[];for(const path of files)records.push(await hashFile(path));
const sourceBytes=records.reduce((sum,file)=>sum+file.bytes,0);
const manifest={createdAt:new Date().toISOString(),format:'faqja-windows-source-v1',
 installation:'Online first start: start.bat installs dependencies and builds web/dist.',
 privateData:'Retain the SERVER .env and data/. Laptop test data is not included.',
 fileCount:records.length,sourceBytes,excluded,files:records};
const manifestText=JSON.stringify(manifest,null,2)+'\n';
await mkdir(output,{recursive:true});
await writeFile(join(output,'TRANSFER-MANIFEST.json'),manifestText,{flag:'wx'});
console.log('Creating USB ZIP ('+(sourceBytes/1e6).toFixed(1)+' MB before compression)...');
await writeWindowsZip();

const archived=await readWindowsZipNames();
assert.deepEqual(archived,files,'ZIP contains exactly the approved files');
// Decode every entry through tar, checking CRCs and the complete byte stream.
// No private inputs or extracted copies are written to another folder.
const expected=createHash('sha256');
for(const file of records){const current=await hashFile(file.path,expected);assert.deepEqual(current,file,'source remained unchanged: '+file.path);}
const actual=createHash('sha256');
await tar(['-xOf',archive],{onData:chunk=>actual.update(chunk)});
assert.equal(actual.digest('hex'),expected.digest('hex'),'all ZIP contents match the source and manifest');
const archiveHash=createHash('sha256');for await(const chunk of createReadStream(archive))archiveHash.update(chunk);
const archiveBytes=(await stat(archive)).size;
await rename(archive,completeArchive);
const result={archive:completeArchive,archiveBytes,sourceBytes,fileCount:records.length,sha256:archiveHash.digest('hex'),verified:true};
await writeFile(join(output,'VERIFIED.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
