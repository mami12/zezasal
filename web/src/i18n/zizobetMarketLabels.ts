/** Display labels only. Provider IDs, prices and settlement text stay intact. */
const labels: Record<string,string> = {
 'result':'Rezultati (1X2)', 'match result':'Rezultati i plotë (1X2)',
 'total':'Totali i golave', 'total goals':'Totali i golave',
 'goal/no goal':'Shënojnë të dyja skuadrat',
 'odd/even':'Tek / Çift', 'exact goals':'Numri i saktë i golave',
 'who wins the rest of the match?':'Kush fiton pjesën e mbetur të ndeshjes?',
 'who wins the rest of the match':'Kush fiton pjesën e mbetur të ndeshjes?',
 'matchbet and both teams to score':'Rezultati (1X2) + Shënojnë të dyja skuadrat',
 'total corners':'Totali i goditjeve këndore', 'total cards':'Totali i kartonëve',
 'total fouls':'Totali i faulleve', 'total shots':'Totali i goditjeve',
 'total shots on target':'Totali i goditjeve në portë',
 'first goalscorer':'Shënuesi i golit të parë', 'last goalscorer':'Shënuesi i golit të fundit',
 'anytime goalscorer':'Lojtari shënon gjatë ndeshjes',
 'first goal interval':'Intervali i shënimit të golit të parë',
 'next goal':'Goli i radhës', 'first goal':'Goli i parë', 'last goal':'Goli i fundit',
 'total home team':'Totali i golave të vendasve',
 'total away team':'Totali i golave të udhëtuesve',
 'goals home team':'Golat e vendasve', 'goals away team':'Golat e udhëtuesve',
 'both teams to score':'Shënojnë të dyja skuadrat',
 'both teams not to score':'Të paktën njëra skuadër nuk shënon',
 'neither team to score':'Asnjëra skuadër nuk shënon',
 'double chance':'Dopio shans', 'draw no bet':'Në barazim, basti kthehet',
 'correct score':'Rezultati i saktë', 'multigoals':'Intervali i golave',
 'multiscores':'Grup rezultatesh të sakta', 'winning margin':'Diferenca e golave',
 'which team to score':'Cila skuadër shënon',
 'odd/even goals':'Golat tek / çift',
 'highest scoring half':'Pjesa me më shumë gola',
 'home team highest scoring half':'Pjesa me më shumë gola të vendasve',
 'away team highest scoring half':'Pjesa me më shumë gola të udhëtuesve',
 'clean sheet home team':'Vendasit nuk pësojnë gol',
 'clean sheet away team':'Udhëtuesit nuk pësojnë gol',
 'home team clean sheet':'Vendasit nuk pësojnë gol',
 'away team clean sheet':'Udhëtuesit nuk pësojnë gol',
 'home team total':'Totali i golave të vendasve',
 'away team total':'Totali i golave të udhëtuesve',
 'home team total goals':'Totali i golave të vendasve',
 'away team total goals':'Totali i golave të udhëtuesve',
 'home team odd/even':'Golat e vendasve tek / çift',
 'away team odd/even':'Golat e udhëtuesve tek / çift',
 'multigoals home team':'Intervali i golave të vendasve',
 'multigoals away team':'Intervali i golave të udhëtuesve',
 'home team wins to nil':'Vendasit fitojnë pa pësuar gol',
 'away team wins to nil':'Udhëtuesit fitojnë pa pësuar gol',
 'home team wins both halves':'Vendasit fitojnë të dyja pjesët',
 'away team wins both halves':'Udhëtuesit fitojnë të dyja pjesët',
 'home team wins any of the halves':'Vendasit fitojnë të paktën njërën pjesë',
 'away team wins any of the halves':'Udhëtuesit fitojnë të paktën njërën pjesë',
 'home team to score in both halves':'Vendasit shënojnë në të dyja pjesët',
 'away team to score in both halves':'Udhëtuesit shënojnë në të dyja pjesët',
 'double chance & both teams to score':'Dopio shans + Shënojnë të dyja skuadrat',
 'double chance & total goals':'Dopio shans + Totali i golave',
 'result & both teams to score':'Rezultati (1X2) + Shënojnë të dyja skuadrat',
 'match result & both teams to score':'Rezultati (1X2) + Shënojnë të dyja skuadrat',
 'match result + total goals':'Rezultati (1X2) + Totali i golave',
 'result & total':'Rezultati (1X2) + Totali i golave',
 'total & both teams to score':'Totali i golave + Shënojnë të dyja skuadrat',
 'halftime/fulltime':'Pjesa e parë / Përfundimi',
 'halftime/fulltime correct score':'Rezultati i saktë: pjesa e parë / përfundimi',
 'halftime/fulltime & exact goals':'Pjesa e parë / Përfundimi + Numri i saktë i golave',
 'halftime/fulltime & total goals':'Pjesa e parë / Përfundimi + Totali i golave',
 'halftime/fulltime & 1st half total goals':'Pjesa e parë / Përfundimi + Totali i golave në pjesën e parë',
 'first goal & match result':'Goli i parë + Rezultati i plotë',
 'first team to score':'Skuadra që shënon e para',
 '1st / 2nd half both teams to score':'Shënojnë të dyja skuadrat: pjesa e parë / pjesa e dytë',
 'double chance & 1st half both teams score':'Dopio shans + Shënojnë të dyja skuadrat në pjesën e parë',
 'double chance & 2nd half both teams score':'Dopio shans + Shënojnë të dyja skuadrat në pjesën e dytë',
 'result (1x2)':'Rezultati (1X2)', 'full time result':'Rezultati i plotë (1X2)',
 '1st half':'Pjesa e parë', 'first half':'Pjesa e parë',
 '2nd half':'Pjesa e dytë', 'second half':'Pjesa e dytë',
 'handicap':'Handikap', 'asian handicap':'Handikap aziatik',
 'corner handicap':'Handikapi i goditjeve këndore',
 'corner handicap (1x2)':'Handikapi i goditjeve këndore (1X2)',
 'cards handicap':'Handikapi i kartonëve',
 'total corners (over-exactly-under)':'Totali i goditjeve këndore (Lart / Saktësisht / Poshtë)',
 'match result and total goals':'Rezultati (1X2) + Totali i golave',
 'match result and both teams to score':'Rezultati (1X2) + Shënojnë të dyja skuadrat',
 'match result & total':'Rezultati (1X2) + Totali i golave',
 'match result + total':'Rezultati (1X2) + Totali i golave',
 'result & total goals':'Rezultati (1X2) + Totali i golave',
 'winner & total':'Fituesi + Totali i golave',
 'matchbet and 1st goal':'Rezultati (1X2) + Skuadra që shënon golin e parë',
 'most corners':'Skuadra me më shumë goditje këndore',
 'most cards':'Skuadra me më shumë kartonë',
 'who scores most goals':'Cila skuadër shënon më shumë gola',
 'who takes most corners':'Cila skuadër fiton më shumë goditje këndore',
 'who receives most cards':'Cila skuadër merr më shumë kartonë',
 'corner result':'Rezultati sipas goditjeve këndore',
 'card result':'Rezultati sipas kartonëve',
 'corner range':'Intervali i numrit të goditjeve këndore',
 'home team corner range':'Intervali i goditjeve këndore të vendasve',
 'away team corner range':'Intervali i goditjeve këndore të udhëtuesve',
 'home team total corners':'Totali i goditjeve këndore të vendasve',
 'away team total corners':'Totali i goditjeve këndore të udhëtuesve',
 'home team exact corners':'Numri i saktë i goditjeve këndore të vendasve',
 'away team exact corners':'Numri i saktë i goditjeve këndore të udhëtuesve',
 'exact corners':'Numri i saktë i goditjeve këndore',
 'corners odd/even':'Goditjet këndore tek / çift',
 'home team total cards':'Totali i kartonëve të vendasve',
 'away team total cards':'Totali i kartonëve të udhëtuesve',
 'exact cards':'Numri i saktë i kartonëve',
 'total card points':'Totali i pikëve nga kartonët',
 'card point range':'Intervali i pikëve nga kartonët',
 'cards point range':'Intervali i pikëve nga kartonët',
 'red card':'Karton i kuq',
 'home team red card':'Vendasit marrin karton të kuq',
 'away team red card':'Udhëtuesit marrin karton të kuq',
 'next corner':'Goditja këndore e radhës', 'last corner':'Goditja këndore e fundit',
 'next card':'Kartoni i radhës', 'no corner':'Pa goditje këndore', 'no card':'Pa karton',
 'last team to score':'Skuadra që shënon e fundit',
 'home team to score':'Vendasit shënojnë', 'away team to score':'Udhëtuesit shënojnë',
 'home team no goal':'Vendasit nuk shënojnë', 'away team no goal':'Udhëtuesit nuk shënojnë',
 'home team exact goals':'Numri i saktë i golave të vendasve',
 'away team exact goals':'Numri i saktë i golave të udhëtuesve',
 'home team total range':'Intervali i golave të vendasve',
 'away team total range':'Intervali i golave të udhëtuesve',
 'home team goal range':'Intervali i golave të vendasve',
 'away team goal range':'Intervali i golave të udhëtuesve',
 'home team win to nil':'Vendasit fitojnë pa pësuar gol',
 'away team win to nil':'Udhëtuesit fitojnë pa pësuar gol',
 'clean sheet':'Skuadra nuk pëson gol',
 'total in range':'Intervali i golave',
 'home team total shots':'Totali i goditjeve të vendasve',
 'away team total shots':'Totali i goditjeve të udhëtuesve',
 'home team shots on target':'Goditjet në portë të vendasve',
 'away team shots on target':'Goditjet në portë të udhëtuesve',
 'shots on target total':'Totali i goditjeve në portë',
 'total offsides':'Totali i pozicioneve jashtë loje',
 'total penalties':'Totali i penalltive',
 'player to score':'Lojtari shënon gol', 'player to score a goal':'Lojtari shënon gol',
 'player to assist':'Lojtari jep asist', 'player to score or assist':'Lojtari shënon gol ose jep asist',
 'player to score a header':'Lojtari shënon me kokë',
 'player to score a headed goal':'Lojtari shënon me kokë',
 'player to score with head':'Lojtari shënon me kokë',
 'player to score with left foot':'Lojtari shënon me këmbën e majtë',
 'player to score with right foot':'Lojtari shënon me këmbën e djathtë',
 'player to score a penalty':'Lojtari shënon nga penalltia',
 'player to score a free kick':'Lojtari shënon nga goditja e dënimit',
 'player to be carded':'Lojtari merr karton',
 'player exact goals':'Numri i saktë i golave të lojtarit',
 'player exact number of goals':'Numri i saktë i golave të lojtarit',
 'header goals':'Gola me kokë', 'headed goals':'Gola me kokë',
 'penalty goals':'Gola nga penalltitë', 'own goal':'Autogol', 'own goals':'Autogola',
 'winning method':'Mënyra e fitores',
 'method of victory':'Mënyra e fitores',
 'to qualify':'Kualifikohet',
 'who will qualify':'Kush kualifikohet?',
 'who will qualify?':'Kush kualifikohet?',
 'penalty shootout winner':'Fituesi pas penalltive',
 'overtime winner':'Fituesi në kohën shtesë',
 'extra time result':'Rezultati në kohën shtesë',
 'match winner':'Fituesi i ndeshjes (1X2)',
 'winner (2-way)':'Fituesi i ndeshjes',
 'winner (3-way)':'Fituesi i ndeshjes (1X2)',
 'first card':'Kartoni i parë',
 'first corner':'Goditja këndore e parë',
 'first carded team':'Skuadra që merr kartonin e parë',
 'team with most corners':'Skuadra me më shumë goditje këndore',
 'team with most cards':'Skuadra me më shumë kartonë',
 'team to score 1st goal':'Skuadra që shënon golin e parë',
 'team to score last goal':'Skuadra që shënon golin e fundit',
 'both teams to score in 1st half':'Shënojnë të dyja skuadrat në pjesën e parë',
 'both teams to score in 2nd half':'Shënojnë të dyja skuadrat në pjesën e dytë',
 'both teams to score in both halves':'Shënojnë të dyja skuadrat në të dyja pjesët',
 'total corners 1st half':'Totali i goditjeve këndore në pjesën e parë',
 'total corners 2nd half':'Totali i goditjeve këndore në pjesën e dytë',
 'total cards 1st half':'Totali i kartonëve në pjesën e parë',
 'total cards 2nd half':'Totali i kartonëve në pjesën e dytë',
 'asian total':'Totali aziatik',
 'asian total goals':'Totali aziatik i golave',
 'booking points':'Pikët e kartonëve',
 'total booking points':'Totali i pikëve të kartonëve',
 'which team wins race to x corners':'Skuadra që arrin e para goditjet këndore',
 'which team wins race to x corners?':'Skuadra që arrin e para goditjet këndore',
 'which team wins the race to x corners':'Skuadra që arrin e para goditjet këndore',
 'which team wins the race to x corners?':'Skuadra që arrin e para goditjet këndore',
 'race to x corners':'Skuadra që arrin e para goditjet këndore',
 'race to x corners?':'Skuadra që arrin e para goditjet këndore',
 'race to x goals':'Skuadra që arrin e para golat',
 'race to x goals?':'Skuadra që arrin e para golat',
 'player to score 2 or more':'Lojtari shënon 2 ose më shumë gola',
 'player to score 2+ goals':'Lojtari shënon 2 ose më shumë gola',
 'player to score a hat-trick':'Lojtari shënon hat-trick (3+ gola)',
 'player to score 3 or more':'Lojtari shënon 3 ose më shumë gola',
 'player to score 3+ goals':'Lojtari shënon 3 ose më shumë gola',
 'player shots on target':'Goditjet në portë nga lojtari',
 'player total shots':'Totali i goditjeve nga lojtari',
 'player total passes':'Totali i pasimeve nga lojtari',
 'player total tackles':'Totali i ndërhyrjeve nga lojtari',
 'player to receive a yellow card':'Lojtari merr karton të verdhë',
 'player to receive a red card':'Lojtari merr karton të kuq',
 'no goal':'Pa gol', 'any other score':'Çdo rezultat tjetër',
};
const teamSuffix=(team:string)=>/^home/i.test(team)?' të vendasve':' të udhëtuesve';
const actionSubjects:Record<string,string>={
 'total':'Totali i golave','total goal':'Totali i golave','total goals':'Totali i golave',
 'total corners':'Totali i goditjeve këndore','total cards':'Totali i kartonëve',
 'total offsides':'Totali i pozicioneve jashtë loje','total penalties':'Totali i penalltive',
 'card result':'Rezultati sipas kartonëve','corner result':'Rezultati sipas goditjeve këndore',
 'odd/even corners':'Goditjet këndore tek / çift','1st corner':'Goditja këndore e parë',
 'red card':'Karton i kuq',
};
export function translateZizobetMarketLabel(raw:string):string|null {
 const normalized=raw.trim().replace(/^\*\s*/,'').replace(/\bHometeam\b/gi,'Home team').replace(/\bAwayteam\b/gi,'Away team').replace(/\s+/g,' ');
 if(!normalized)return null;
 if(/^(?:Next Goal|Next Corner|Next Card)\s+\d+(?:st|nd|rd|th)$/i.test(normalized))return raw;
 // The provider appends the player after this separator. It is an identity,
 // not prose: translate only the contract and preserve its spelling verbatim.
 const split=normalized.indexOf(' · ');
 if(split>=0){const translated=translateZizobetMarketLabel(normalized.slice(0,split));return translated?translated+normalized.slice(split):null;}
 const exact=labels[normalized.toLowerCase()];if(exact)return exact;
 const period=normalized.match(/^(1st|first|2nd|second) half\s*[-–:.]\s*(.+)$/i);
 if(period){const label=translateZizobetMarketLabel(period[2]);if(label)return (/^(?:1st|first)$/i.test(period[1])?'Pjesa e parë: ':'Pjesa e dytë: ')+label;}
 // A trailing half is a contract scope, never an optional display detail.
 const halfScope=normalized.match(/^(.+?) (?:in|during) (?:the )?(1st|first|2nd|second) half$/i);
 if(halfScope){const label=translateZizobetMarketLabel(halfScope[1]);if(label)return label+(/^(?:1st|first)$/i.test(halfScope[2])?' në pjesën e parë':' në pjesën e dytë');}
 const halvesScope=normalized.match(/^(.+?) in (?:the )?(both|each|either) halves?$/i);
 if(halvesScope){const label=translateZizobetMarketLabel(halvesScope[1]);if(label)return label+(halvesScope[2].toLowerCase()==='both'?' në të dyja pjesët':halvesScope[2].toLowerCase()==='each'?' në secilën pjesë':' në të paktën njërën pjesë');}
 // Negation must be recognized before the named-player action rule. Otherwise
 // "Player not" would be mistaken for a player's name followed by "to score".
 const negative=normalized.match(/^(.+?) (?:not to score|will not score|does not score)(?: (?:a )?goal)?$/i);
 if(negative){
  const subject=negative[1].trim();
  if(/^both teams?$/i.test(subject))return 'Të paktën njëra skuadër nuk shënon';
  const label=/^home team$/i.test(subject)?'Skuadra vendase':/^away team$/i.test(subject)?'Skuadra udhëtuese':/^player$/i.test(subject)?'Lojtari':subject;
  return label+' nuk shënon gol';
 }
 const extra=normalized.match(/^(?:extra\s*time|overtime)\s*[-–:]\s*(.+)$/i);
 if(extra){const label=translateZizobetMarketLabel(extra[1]);if(label)return 'Në zgjatje: '+label;}
 const shootout=normalized.match(/^Penalty shootout\s*[-–:]\s*(.+)$/i);
 if(shootout){const label=translateZizobetMarketLabel(shootout[1]);if(label)return 'Gjuajtjet e penalltive: '+label;}
 const included=normalized.match(/^(.+?)\s*\((incl\.?|inc\.?)\s*(extra time|overtime|OT\s*&\s*Pen\.?)\)$/i);
 if(included){const label=translateZizobetMarketLabel(included[1]);if(label)return label+(/pen/i.test(included[3])?' (përfshirë zgjatjet dhe penalltitë)':' (përfshirë zgjatjet)');}
 const regular=normalized.match(/^(.+?) \(regular time\)$/i);
 if(regular){const label=translateZizobetMarketLabel(regular[1]);if(label)return label+' (koha e rregullt)';}
 const dcCombo=normalized.match(/^Double chance(?:\s*\(1X\s*-\s*12\s*-\s*X2\))?\s*(?:and|[+&])\s*(Totals?|Total Goals|Both teams to score)$/i);
 if(dcCombo)return 'Dopio shans + '+(/^both/i.test(dcCombo[1])?'Shënojnë të dyja skuadrat':'Totali i golave');
 const combo=normalized.match(/^(.+?)\s+(?:and|[+&])\s+(.+)$/i);
 if(combo){const first=translateZizobetMarketLabel(combo[1]),second=translateZizobetMarketLabel(combo[2]);if(first&&second)return first+' + '+second;}
 const window=normalized.match(/^(Who scores most goals|Who takes most corners|Who receives most cards|Total goals|Total corners|Total cards|Who scores goal (\d+)) in minutes (\d+)-(\d+)(?: \((\d+)-minute interval\))?$/i);
 if(window){
  const subject=/^Who scores most/i.test(window[1])?'Cila skuadër shënon më shumë gola':/^Who takes/i.test(window[1])?'Cila skuadër fiton më shumë goditje këndore':/^Who receives/i.test(window[1])?'Cila skuadër merr më shumë kartonë':/^Who scores goal/i.test(window[1])?'Cila skuadër shënon golin nr. '+window[2]:translateZizobetMarketLabel(window[1]);
  return subject+' · minutat '+window[3]+'–'+window[4]+(window[5]?' (interval '+window[5]+' min)':'');
 }
 const anyWindow=normalized.match(/^(.+?) in minutes (\d+)-(\d+)(?: \((\d+)-minute interval\))?$/i);
 if(anyWindow){const subject=translateZizobetMarketLabel(anyWindow[1]);if(subject)return subject+' · minutat '+anyWindow[2]+'–'+anyWindow[3]+(anyWindow[4]?' (interval '+anyWindow[4]+' min)':'');}
 const legacyWindow=normalized.match(/^(\d+) minutes? - (.+?) from (\d+)(?::00)?\s*(?:-|to)\s*(\d+)(?::00)?(?: min(?:utes?)?)?$/i);
 if(legacyWindow){const subject=actionSubjects[legacyWindow[2].toLowerCase()]??translateZizobetMarketLabel(legacyWindow[2]);if(subject)return subject+' · nga '+legacyWindow[3]+':00 deri në minutën '+legacyWindow[4]+' (interval '+legacyWindow[1]+' min)';}
 const absoluteWindow=normalized.match(/^(Match result|Total goals) (\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}) min\.?$/i);
 if(absoluteWindow)return translateZizobetMarketLabel(absoluteWindow[1])+' · '+absoluteWindow[2]+'–'+absoluteWindow[3];
 const rest=normalized.match(/^Correct score (?:rest of (?:the )?match|rest of (?:the )?half)\s*(?:\(from )?(\d+:\d+)\)?$/i);
 if(rest)return 'Rezultati i saktë i pjesës së mbetur (nga '+rest[1]+')';
 const goalTime=normalized.match(/^When will goal (\d+) be scored(?: \((\d+)-minute intervals\))?$/i);
 if(goalTime)return 'Kur shënohet goli nr. '+goalTime[1]+(goalTime[2]?' · intervale nga '+goalTime[2]+' minuta':'');
 const nextTime=normalized.match(/^When will next goal be scored(?: in (\d+) minutes interval)?(?:\s+(\d+))?$/i);
 if(nextTime)return 'Kur shënohet goli '+(nextTime[2]?'nr. '+nextTime[2]:'i radhës')+(nextTime[1]?' · intervale nga '+nextTime[1]+' minuta':'');
 const nth=normalized.match(/^(Next goal|Next corner|Next card|Next goal scorer|Who scores goal)\s+(\d+)$/i);
 if(nth){const n=nth[2];return /^Next corner/i.test(nth[1])?'Goditja këndore nr. '+n:/^Next card/i.test(nth[1])?'Kartoni nr. '+n:/scorer/i.test(nth[1])?'Shënuesi i golit nr. '+n:'Cila skuadër shënon golin nr. '+n;}
 const scoring=normalized.match(/^(?:№\s*)?(\d+)\s+(?:goal )?scoring type$/i);
 if(scoring)return 'Mënyra e shënimit të golit nr. '+scoring[1];
 const ordinalGoal=normalized.match(/^Who will score the (\d+)(?:st|nd|rd|th) goal$/i);
 if(ordinalGoal)return 'Kush shënon golin nr. '+ordinalGoal[1]+'?';
 const cornerNumber=normalized.match(/^Who takes the (\d+)(?:st|nd|rd|th)? corner$/i);
 if(cornerNumber)return 'Cila skuadër fiton goditjen këndore nr. '+cornerNumber[1];
 const race=normalized.match(/^(?:Which team wins (?:the )?race to|Race to)\s+(\d+|x)\s+(corners?|goals?)\??$/i);
 if(race){
  const isCorners=/corner/i.test(race[2]);
  const isX=/^x$/i.test(race[1]);
  const num=race[1];
  if(isCorners){
   return isX?'Skuadra që arrin e para goditjet këndore':`Skuadra që arrin e para ${num} goditje këndore`;
  }
  return isX?'Skuadra që arrin e para golat':`Skuadra që arrin e para ${num} gola`;
 }
 const count=normalized.match(/^(?:(Home team|Away team) )?exact goals (\d+)(\+)?$/i);
 if(count)return count[3]?'Numri i golave'+(count[1]?teamSuffix(count[1]):'')+' ('+count[2]+' ose më shumë)':'Saktësisht '+count[2]+(count[2]==='1'?' gol':' gola')+(count[1]?teamSuffix(count[1]):'');
 const range=normalized.match(/^Number of Goals (\d+\+)$/i);if(range)return 'Numri i golave ('+range[1].slice(0,-1)+' ose më shumë)';
 const interval=normalized.match(/^First goal interval (\d+) min$/i);if(interval)return 'Koha e golit të parë (intervale nga '+interval[1]+' minuta)';
 const both=normalized.match(/^Both half goals (over|under) (\d+(?:\.\d+)?)$/i);if(both)return 'Totali i golave në secilën pjesë: '+(/^over/i.test(both[1])?'Lart ':'Poshtë ')+both[2];
 const playerPlus=normalized.match(/^Player (?:to score )?(\d+)\+(?: goals?)?$/i);
 if(playerPlus)return 'Lojtari shënon '+playerPlus[1]+' ose më shumë gola';
 const playerExact=normalized.match(/^Player (?:to score )?(?:exactly|exact) (\d+)(?: goals?)?$/i);
 if(playerExact)return 'Lojtari shënon saktësisht '+playerExact[1]+(playerExact[1]==='1'?' gol':' gola');
 const timeBound=normalized.match(/^(.+?) (before|after|within|by|until|at|in|during) (?:the )?(?:(\d+)(?:st|nd|rd|th)? minutes?|minutes? (\d+))$/i);
 if(timeBound){const subject=translateZizobetMarketLabel(timeBound[1]);if(subject){const n=timeBound[3]??timeBound[4],op=timeBound[2].toLowerCase();return subject+(op==='before'?' para minutës ':op==='after'?' pas minutës ':['within','by','until'].includes(op)?' deri në minutën ':' në minutën ')+n;}}
 const actionWindow=normalized.match(/^(.+?) from (\d+):00 to (\d+) min(?:utes?)?$/i);
 if(actionWindow){const subject=translateZizobetMarketLabel(actionWindow[1]);if(subject)return subject+' · nga '+actionWindow[2]+':00 deri në minutën '+actionWindow[3];}
 // These named-player phrases have an anchored, known action. The name itself
 // is copied exactly, so e.g. a surname containing "Card" cannot be translated.
 const named=normalized.match(/^(.+?) (shots on target from outside of the box|shots on target|total shots on goal|total shots|total passes|total tackles|shots|assists|fouls won|fouls conceded|to score or assist|to score|to be yellow carded)$/i);
 if(named){const action:Record<string,string>={'shots on target from outside of the box':'Goditjet në portë nga jashtë zonës','shots on target':'Goditjet në portë','total shots on goal':'Totali i goditjeve në portë','total shots':'Totali i goditjeve','total passes':'Totali i pasimeve','total tackles':'Totali i ndërhyrjeve','shots':'Goditjet','assists':'Asistet','fouls won':'Faullet e fituara','fouls conceded':'Faullet e shkaktuara','to score or assist':'Shënon gol ose jep asist','to score':'Shënon gol','to be yellow carded':'Merr karton të verdhë'};if(!/[{}\[\]]/.test(named[1])&&!/\b(?:not|never|neither|no)\b/i.test(named[1]))return named[1]+' · '+action[named[2].toLowerCase()];}
 const up=normalized.match(/^Full Time (\d+)UP(?: \(early payout\))?$/i);if(up)return 'Rezultati i plotë: pagesë e parakohshme me avantazh '+up[1]+' gola';
 return null;
}
