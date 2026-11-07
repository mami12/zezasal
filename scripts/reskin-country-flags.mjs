/** Apply only the flag presentation to the existing Vave frontend variants.
 * The live reskin is read-only; outputRoot is the prepared transfer directory.
 */
import fs from 'node:fs';
import path from 'node:path';

const variants=[
 ['web/src/components/Sports/MatchList.tsx','vave-match-board'],
 ['web/src/components/Sports/MatchDetail.tsx','vave-match-detail'],
 ['web/src/components/Layout/SportsSidebar.tsx','vave-sports-sidebar'],
];
function importFlag(source,sidebar){
 if(/import\s+CountryFlag\s+from/.test(source))return source;
 const anchor=sidebar?"import { isMainFootballCompetition } from '../../utils/sportsbookFilters';":"import OddsButton from './OddsButton';";
 if(!source.includes(anchor))throw Error('Unrecognized reskin flag import location');
 return source.replace(anchor,anchor+`\nimport CountryFlag from '${sidebar?'../Sports/CountryFlag':'./CountryFlag'}';`);
}
function patchFlags(file,source){
 const sidebar=file.endsWith('SportsSidebar.tsx');
 source=importFlag(source,sidebar);
 if(sidebar){
  source=source.replace("name: string; tournaments?: Tournament[]","name: string; countryCode?: string; tournaments?: Tournament[]");
  source=source.replace("countryFlags[tour.category] ?? '🏆'",'<CountryFlag country={tour.category}/>');
  source=source.replace('<span className="vave-country-flag" aria-hidden="true">{countryFlags[category.name] ?? \'🌍\'}</span>','<CountryFlag country={category.name} countryCode={category.countryCode}/>');
  if(!/countryFlags\[/.test(source))source=source.replace(/^const countryFlags:[^\r\n]+\r?\n/m,'');
  if(!source.includes('<CountryFlag country={category.name}'))throw Error('Unrecognized reskin country row');
 }else if(file.endsWith('MatchList.tsx')){
  if(!source.includes('<CountryFlag country={fixtures[0]')){
   const anchor='<h3 title={league}>';
   if(!source.includes(anchor))throw Error('Unrecognized reskin competition header');
   source=source.replace(anchor,'<CountryFlag country={fixtures[0]?.tournament?.category?.name} countryCode={fixtures[0]?.tournament?.category?.countryCode}/>\n                '+anchor);
  }
 }else if(!source.includes('<CountryFlag country={live.tournament')){
  const anchor='<ArrowLeft size={15} className="shrink-0" />';
  if(!source.includes(anchor))throw Error('Unrecognized reskin match breadcrumb');
  source=source.replace(anchor,anchor+'\n            <CountryFlag country={live.tournament?.category?.name} countryCode={live.tournament?.category?.countryCode}/>');
 }
 return source;
}

export function applyReskinCountryFlags(reskinRoot,outputRoot){
 const origin=path.resolve(reskinRoot),output=path.resolve(outputRoot);
 if(origin===output)throw Error('Prepare reskin flag variants outside the live reskin folder');
 const written=[];
 for(const [relative,marker] of variants){
  const source=fs.readFileSync(path.join(origin,relative),'utf8');
  if(!source.includes(marker))throw Error('Expected the existing Vave frontend: '+relative);
  const destination=path.resolve(output,relative);
  if(!destination.startsWith(output+path.sep))throw Error('Unexpected reskin flag output path');
  // Reuse an already prepared Vave variant, preserving any functional patches
  // applied earlier. A generic blue copy is replaced by the actual Vave source.
  const prepared=fs.existsSync(destination)?fs.readFileSync(destination,'utf8'):'';
  const input=prepared.includes(marker)?prepared:source;
  const result=patchFlags(relative,input);
  if(!result.includes(marker))throw Error('Reskin layout was lost: '+relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,result);written.push(relative);
 }
 return written;
}
