/** Country identities only; provider category IDs are never treated as ISO codes.
 * The SVGs are the original files retained in the local Fito24 capture.
 */
export const COUNTRY_FLAGS=Object.freeze([
 ['GB-ENG','england'],['IT','italy'],['ES','spain'],['DE','germany'],['FR','france'],['NL','netherlands'],['PT','portugal'],['GB-SCT','scotland'],
 ['AT','austria'],['BE','belgium'],['CH','switzerland'],['DK','denmark'],['SE','sweden'],['NO','norway'],['FI','finland'],['IE','ireland'],['IS','iceland'],
 ['TR','turkey'],['RU','russia'],['PL','republic-of-poland'],['CZ','czech-republic'],['RO','romania'],['GR','greece'],['UA','ukraine'],['HR','croatia'],
 ['HU','hungary'],['SK','slovakia'],['SI','slovenia'],['IL','israel'],['BG','bulgaria'],['RS','serbia'],['GB-WLS','wales'],['CY','cyprus'],['BY','belarus'],
 ['EE','estonia'],['LV','latvia'],['LT','lithuania'],['MD','moldova'],['GE','georgia'],['AZ','azerbaijan'],['AM','armenia'],['UZ','uzbekistn'],['KZ','kazakhstan'],
 ['BA','bosnia-and-herzegovina'],['MK','republic-of-macedonia'],['MT','malta'],['LU','luxembourg'],['SM','san-marino'],['AD','andorra'],
 ['AR','argentina'],['BR','brazil'],['MX','mexico'],['US','united-states-of-america'],['CL','chile'],['CO','colombia'],['PE','peru'],['EC','ecuador'],
 ['UY','uruguay'],['PY','paraguay'],['VE','venezuela'],['BO','bolivia'],['CR','costa-rica'],['CA','canada'],['PA','panama'],['SV','salvador'],['GT','guatemala'],['HN','honduras'],
 ['AU','australia'],['JP','japan'],['KR','south-korea'],['CN','china'],['SA','saudi-arabia'],['TH','thailand'],['SG','singapore'],['IN','india'],
 ['AE','united-arab-emirates'],['QA','qatar'],['KW','kuwait'],['BH','bahrain'],['OM','oman'],['ID','indonesia'],['VN','vietnam'],['JO','jordan'],['HK','hong-kong'],
 ['TW','taiwan'],['NZ','new-zealand'],['ZA','south-africa'],['DZ','algeria'],['MA','morocco'],['CM','cameroon'],['SN','senegal'],['AO','angola'],['UG','uganda'],
 ['IQ','iraq'],['LB','lebanon'],['MM','myanmar'],['MR','mauritania'],['MW','malawi'],['DO','dominican-republic'],['BF','burkina-faso'],
].map(([code,file])=>Object.freeze({code,file:`${file}.svg`})));

const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const byCode=new Map(COUNTRY_FLAGS.map(entry=>[entry.code,entry.file]));
const names=new Map();
for(const {code,file} of COUNTRY_FLAGS){
 names.set(normalize(file.slice(0,-4)),file);
 if(code.length===2)for(const locale of ['en','sq']){
  try{const label=new Intl.DisplayNames([locale],{type:'region'}).of(code);if(label)names.set(normalize(label),file);}catch{/* Filename and explicit aliases still work on older browsers. */}
 }
}
const aliases={
 'GB-ENG':['England','Angli','Anglia','ENG'], 'GB-SCT':['Scotland','Skoci','Skocia','SCO'], 'GB-WLS':['Wales','Uells','Uellsi','WAL'],
 US:['USA','U.S.A.','United States','United States of America','SHBA','Shtetet e Bashkuara','Shtetet e Bashkuara te Amerikes'],
 CZ:['Czechia','Czech Republic','Republika Ceke','Ceki','Cekia'], MK:['North Macedonia','Macedonia','FYROM','Maqedoni','Maqedonia','Maqedonia e Veriut'],
 IE:['Republic of Ireland','Ireland Republic','Irlande','Irlanda'], KR:['South Korea','Korea Republic','Republic of Korea','Korea, Republic of','Koreja e Jugut'],
 TR:['Turkey','Turkiye','Türkiye','Turqi','Turqia'], SV:['El Salvador','Salvador'], BA:['Bosnia Herzegovina','Bosnia and Herzegovina','Bosnje Hercegovine','Bosnja dhe Hercegovina'],
 NL:['Holland','Netherlands','The Netherlands','Holande','Holanda'], TW:['Chinese Taipei','Taiwan'], VN:['Viet Nam','Vietnam'], UZ:['Uzbekistan','Uzbekistn'],
 PL:['Poland','Republic of Poland','Poloni','Polonia'], HK:['Hong Kong','Hong Kong China','Hong Kong, China'], AE:['UAE','United Arab Emirates','Emiratet e Bashkuara Arabe'],
};
for(const [code,values] of Object.entries(aliases))for(const value of values)names.set(normalize(value),byCode.get(code));

const international=/^(international|internacional|nderkombetar|world|bote|boterore|europe|europa|asia|africa|afrika|americas|southamerica|northamerica|centralamerica|oceania|uefa|fifa|conmebol|concacaf|caf|afc|ofc)/;

/** Return only a known captured asset. Unknown/international categories use a
 * neutral globe in CountryFlag, rather than a guessed national flag.
 */
export function countryFlagFile(country,countryCode){
 const name=normalize(country);
 if(international.test(name))return null;
 const known=names.get(name);
 if(known)return known;
 const code=String(countryCode||(/^[a-z]{2}(?:-(?:eng|sct|wls))?$/i.test(String(country).trim())?country:'')||'').trim().toUpperCase();
 return byCode.get(code)||null;
}
