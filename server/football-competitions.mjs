/** National senior pyramid aliases, indexed by provider category slug.
 * Each semicolon separates a tier; | separates aliases. Empty tiers are allowed.
 * Never infer a country's pyramid from another country's identically named league.
 */
const pyramids = {
  england:'Premier League;Championship;League One|League 1',
  italy:'Serie A;Serie B;Serie C|Lega Pro',
  germany:'Bundesliga|1 Bundesliga;2nd Bundesliga|2 Bundesliga;3 Liga|3rd Liga',
  spain:'LaLiga|La Liga|Primera Division;LaLiga2|La Liga 2|Segunda Division;Primera Federacion|Primera RFEF',
  france:'League 1|Ligue 1;League 2|Ligue 2;League 3|National|Championnat National',
  scotland:'Premiership;Championship;League One|League 1',
  portugal:'Primeira Liga|Liga Portugal;Segunda Liga|Liga Portugal 2;Liga 3',
  netherlands:'Eredivisie;Eerste Divisie;Tweede Divisie',
  belgium:'Jupiler Pro League|Pro League;Challenger Pro League|First Division B;National Division 1|Division 1 ACFF|Division 1 VV',
  austria:'Bundesliga;Liga 2|2 Liga;Regionalliga',
  switzerland:'Super League;Challenge League;Promotion League',
  turkey:'Super League|Super Lig;1 League|1 Lig;2 League|2 Lig',
  greece:'Super League|Super League 1;Super League 2;Gamma Ethniki|3rd League',
  denmark:'Superliga|Superligaen;1st Division|1 Division;2nd Division|2 Division',
  sweden:'Allsvenskan;Superettan;Division 1|Ettan',
  norway:'Eliteserien;OBOS Ligaen|1st Division|1 Division;2nd Division|2 Division|PostNord Ligaen',
  finland:'Veikkausliiga;Ykkosliiga;Ykkonen',
  iceland:'Urvalsdeild|Besta deild;1 deild|1st Division;2 deild|2nd Division',
  ireland:'Premier Division;First Division;',
  'northern-ireland':'Premiership;Championship;Premier Intermediate League',
  wales:'Cymru Premier|Premier League;Cymru North|Cymru South;Ardal League|Ardal Leagues',
  poland:'Ekstraklasa;Division 1|1 Liga;Division 2|2 Liga',
  czechia:'First League|1 Liga;FNL|National League|2 Liga;CFL|MSFL|3 Liga',
  slovakia:'Nike liga|Super Liga;2 Liga|Second League;3 Liga|Third League',
  hungary:'NB 1|NB I;NB 2|NB II;NB 3|NB III',
  romania:'SuperLiga|Liga 1;League 2|Liga 2;League 3|Liga 3',
  bulgaria:'Parva liga|First League;Vtora liga|Second League;Treta liga|Third League',
  croatia:'HNL|1 HNL;Prva NL|1 NL;Druga NL|2 NL',
  serbia:'Super Liga|Superliga;Prva Liga|First League;Srpska Liga|Serbian League',
  slovenia:'Prva liga|1 SNL;2 SNL|Second League;3 SNL|Third League',
  'bosnia-herzegovina':'Premier League;First League;Second League',
  montenegro:'First League;Second League;Third League',
  albania:'Superliga|Kategoria Superiore;First Division|Kategoria e Pare;Second Division|Kategoria e Dyte',
  kosovo:'Superliga|Super League;First League|Liga e Pare;Second League|Liga e Dyte',
  'north-macedonia':'First League;Second League;Third League',
  cyprus:'First division;Second Division;Third Division',
  malta:'Premier League;Challenge League;National Amateur League',
  luxembourg:'National Division;Division of Honour;1 Division',
  'faroe-islands':'Premier League|Betri deildin;1 deild;2 deild',
  estonia:'Meistriliiga|Premium Liiga;Esiliiga;Esiliiga B',
  latvia:'Virsliga;1 Liga|First League;2 Liga|Second League',
  lithuania:'A League|A Lyga;1 League|I Lyga;II Lyga|2 League',
  belarus:'Premier League;First League;Second League',
  ukraine:'Premier League;First League;Second League',
  russia:'Premier League;First League;Second League A|Second League Division A',
  moldova:'Super Liga|National Division;Liga 1|Division A;Liga 2|Division B',
  georgia:'Erovnuli Liga;Erovnuli Liga 2;Liga 3',
  armenia:'Premier League;First League;',
  azerbaijan:'Premier League;First Division|I Liga;Second Division|II Liga',
  kazakhstan:'Premier League;First Division|First League;Second Division|Second League',
  brazil:'Serie A;Serie B;Serie C',
  argentina:'Liga Profesional|Primera Division;Primera Nacional;Primera B|Primera B Metropolitana|Federal A|Torneo Federal A',
  chile:'Primera Division|Liga de Primera;Primera B;Segunda Division|Segunda Division Profesional',
  uruguay:'Primera Division;Segunda Division;Amateurs Primera Division|Primera Division Amateur',
  paraguay:'Primera Division|Division Profesional;Segunda Division|Division Intermedia;Primera B|Primera B Nacional',
  peru:'Primera Division|Liga 1;Segunda Division|Liga 2;Liga 3',
  ecuador:'LigaPro Primera A|Serie A;LigaPro Primera B|Serie B;Segunda Categoria',
  colombia:'Primera A;Primera B;',
  bolivia:'Division Profesional|Primera Division;Copa Simon Bolivar;',
  venezuela:'Primera Division;Segunda Division;',
  usa:'MLS|Major League Soccer;USL Championship;USL League One|MLS Next Pro',
  canada:'Premier League|Canadian Premier League|NSL|Northern Super League;;League1',
  mexico:'Liga MX;Liga de Expansion MX|Liga de Ascenso;Liga Premier',
  'costa-rica':'Primera Division;Segunda Division;LINAFA',
  guatemala:'Liga Nacional|National League;Primera Division;Segunda Division',
  honduras:'Liga Nacional|National League;Liga de Ascenso;',
  'el-salvador':'Primera Division;Segunda Division;Tercera Division',
  nicaragua:'Primera Division;Segunda Division;Tercera Division',
  panama:'Liga Panamena|LPF;Liga Prom;',
  jamaica:'Premier League;Championship;',
  haiti:'Ligue Haitienne|Ligue 1;Division 2;',
  'dominican-republic':'Liga Dominicana;Liga de Expansion;',
  japan:'J1 League;J2 League;J3 League',
  'republic-of-korea':'K League 1|K-League 1;K League 2|K-League 2;K3 League',
  china:'Super League;League One|China League 1;League Two|China League 2',
  australia:'A League|A League Men|A League Women;Australian Championship;',
  'new-zealand':'National League|Premiership;;',
  india:'Super League|Indian Super League;I League;I League 2|Second Division League',
  indonesia:'Liga 1|Super League;Liga 2|Championship;Liga 3|Liga Nusantara',
  thailand:'Thai League 1|Thai League;Thai League 2;Thai League 3',
  vietnam:'V League 1;V League 2;Second Division',
  malaysia:'Super League;A1 Semi Pro League;A2 Amateur League',
  singapore:'Premier League;Football League 1;Football League 2',
  philippines:'Football League|PFL;;',
  bangladesh:'Premier League;Championship League;',
  nepal:'A Division;B Division;C Division',
  'saudi-arabia':'Professional League|Pro League;First Division;Second Division',
  qatar:'Stars League;Second Division;',
  'united-arab-emirates':'Pro League|Professional League;Division 1|First Division;Division 2|Second Division',
  kuwait:'Premier League;Division 1|First Division;',
  bahrain:'Premier League;Second Division;',
  oman:'Professional League|Pro League;First Division;Second Division',
  iran:'Pro League|Persian Gulf Pro League;First League|Azadegan League;Second Division',
  iraq:'Stars League|Premier League;Premier Division League;1st Division|First Division',
  jordan:'Pro League|Professional League;Division 1|First Division;Division 2|Second Division',
  lebanon:'Premier League;Second Division;Third Division',
  israel:'Premier League;Liga Leumit|National League;Liga Alef',
  uzbekistan:'Super League;Pro League;First League',
  kyrgyzstan:'Premier Liga|Premier League;National League;',
  tajikistan:'Higher League;First League;Second League',
  turkmenistan:'Yokary Liga;First League;',
  egypt:'Premier League;Second Division A;Second Division B',
  morocco:'Botola Pro|Botola Pro 1;Botola 2;National Amateur',
  algeria:'Ligue 1;Ligue 2;Inter Regions',
  tunisia:'Ligue 1;Ligue 2;Ligue 3',
  libya:'Premier League;First Division;Second Division',
  'south-africa':'Premiership|Premier League;Championship|First Division;ABC Motsepe League',
  nigeria:'Premier League|NPFL;National League;Nationwide League One',
  ghana:'Premier League;Division One;Division Two',
  kenya:'Premier League;National Super League;Division One',
  tanzania:'Premier League;Championship;First League',
  uganda:'Premier League;Big League;Regional League',
  ethiopia:'Premier League;Higher League;First League',
  rwanda:'Premier League|National League;Second Division;',
  senegal:'Ligue 1;Ligue 2;National 1',
  'ivory-coast':'Ligue 1;Ligue 2;Division 3',
  cameroon:'Elite One;Elite Two;Regional League',
  zambia:'Super League;National Division One;Division One',
  zimbabwe:'Premier League;Division One;Division Two',
  angola:'Girabola;Gira Angola;',
  mozambique:'Mocambola;Division 2;',
  botswana:'Premier League;First Division;',
  namibia:'Premier League;First Division;Second Division',
  'sierra-leone':'Premier League;Division One;Division Two',
};

export const normalizeCompetition = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Explicit virtual/video-game football markers, independent of league depth.
 * FIFA is also the real governing body: never ban a real World Cup simply
 * because its official name contains FIFA. Team age/gender suffixes are real.
 */
export function isSyntheticFootballMatch(match={}) {
  const tournament=match.tournament??{},category=tournament.category??match.category??{},raw=match.raw??{};
  if(match.isEsport===true||match.is_esport===true||match.isSimulated===true||match.is_simulated===true||match.isVirtual===true||match.is_real===false||raw.isEsport===true||raw.isSimulated===true||raw.isVirtual===true)return true;
  const competition=normalizeCompetition(match.tournament_name??match.tournamentName??tournament.name??'');
  const region=normalizeCompetition([match.category_slug??match.categorySlug??category.slug,match.category_name??match.categoryName??category.name].filter(Boolean).join(' '));
  const text=[competition,region].join(' ');
  if(/\b(?:e\s?soccer(?:battle)?|e\s?football(?:battle)?|e\s?sports?(?:battle)?|cyber\w*|virtual|simulat(?:ed|ion)|srl|replays?|ereplays?|ehighlights|video games?|computer games?|vsport|volta|fantasy|short football|h2h gg)\b/.test(text))return true;
  if(/\bfifa\s+e\s?(?:world|nations|club)\s+cup\b/.test(text))return true;
  const realFifa=/\bfifa(?:\s+\d{2}(?:\d{2})?)?\s+(?:(?:club|women s|womens|u\s?\d{2})\s+)?world cup\b|\bfifa(?:\s+\d{2}(?:\d{2})?)?\s+(?:world cup\s+)?(?:qualifiers?|qualifications?)\b/.test(competition);
  if(/\b(?:ea sports fc|ea fc)(?:\s*\d{2})?\b/.test(text)||(!realFifa&&/\bfifa\s*(?:1\d|2\d)\b/.test(text)))return true;
  if(!realFifa&&(/^(?:fifa|electronic(?: leagues?|sports?)?|e leagues?)(?:\s|$)/.test(region)||/^fifa$/.test(competition)))return true;
  const teams=[match.home??match.homeTeam,match.away??match.awayTeam].filter(Boolean).join(' ');
  if(/\((?:v|sim|srl|virtual|replay|replays)\)/i.test(teams))return true;
  return /\b2\s*x\s*(?:[1-9]|1[0-5])\s*(?:min(?:ute)?s?)?\b/i.test([competition,teams].join(' '));
}
const tierNames = new Map(Object.entries(pyramids).map(([country, tiers]) => [country,
  tiers.split(';').slice(0,3).map(tier => tier.split('|').filter(Boolean).map(normalizeCompetition))]));
const excluded = /\b(?:u\s?\d{2}|under\s?\d{2}|youth|junior|reserves?|reserve league|academy|professional development|premier league 2|future cup|long term|outrights?|singles only|cyber|virtual|esports?battle|replays?|ehighlights|highlights|simulated|short football|fantasy|volta|penalty shootout)\b/;
const syntheticCategory = /^(?:cyber|ereplay|replay|virtual|crypto|computer|vsport|express|special|short-football)/;
const regions = new Set(['world','international','international-clubs','international-youth','europe','asia','africa','south-america','north-america','central-america','north-and-central-america','oceania','concacaf','conmebol','uefa','afc','caf']);
const majorThree=new Set(['england','italy','france','spain','germany','portugal']);
const europeTwo=new Set(['scotland','portugal','netherlands','belgium','austria','switzerland','turkey','greece','denmark','sweden','norway','finland','iceland','ireland','northern-ireland','wales','poland','czechia','slovakia','hungary','romania','bulgaria','croatia','serbia','slovenia','bosnia-herzegovina','montenegro','albania','kosovo','north-macedonia','cyprus','malta','luxembourg','faroe-islands','estonia','latvia','lithuania','belarus','ukraine','moldova','georgia','armenia','azerbaijan']);
export const isEuropeanFootballCountry=country=>majorThree.has(String(country).toLowerCase())||europeTwo.has(String(country).toLowerCase())||String(country).toLowerCase()==='russia';
export const competitionTierLimit=country=>isEuropeanFootballCountry(country)?3:1;

export function competitionDecision(tournament, category = {}) {
  const country=String(category.slug??tournament.category?.slug??tournament.categorySlug??'').toLowerCase();
  const name=normalizeCompetition(tournament.name);
  if(isSyntheticFootballMatch({tournament,category})||tournament.isEsport||syntheticCategory.test(country))return {allowed:false,reason:'synthetic',country};
  if(/\b(?:outrights?|long term|singles only)\b/.test(name))return {allowed:false,reason:'not-a-match',country};
  const tiers=tierNames.get(country)??[];const index=tiers.findIndex(aliases=>aliases.some(alias=>name===alias||name.startsWith(alias+' group ')));
  return {allowed:true,reason:'all-real-football',country,tier:index<0?null:index+1};
}

/** Compile decisions once per catalog refresh, keyed by provider tournament ID. */
export function buildCompetitionPolicy(tournaments, categories) {
  return new Map([...tournaments].map(([id,t]) => [id,competitionDecision(t,categories.get(t.categoryId) ?? {slug:t.categorySlug})]));
}
