const TRANSACTION_LABELS: Record<string,string> = {
  DEPOSIT:'Depozitim', WITHDRAWAL:'Tërheqje', ADJUSTMENT:'Rregullim bilanci',
  BET_PLACED:'Bast i vendosur', BET_WON:'Bast fitues', BET_REFUND:'Rimbursim basti', TICKET_REVERT:'Anulim bilete',
  CASINO_SPIN:'Rrotullim kazinoje', CASINO_WIN:'Fitim kazinoje', CASINO_MANAGER_NET:'Diferencë kazinoje e menaxherit',
  MANAGER_PLAYER_FUNDING:'Fonde dhënë lojtarit', MANAGER_PLAYER_RETURN:'Fonde të kthyera nga lojtari',
  AGENT_MANAGER_FUNDING:'Fonde dhënë menaxherit',AGENT_MANAGER_RETURN:'Fonde të kthyera nga menaxheri',
  MANAGER_COMMISSION_DEBIT:'Komision i zbritur', MANAGER_COMMISSION_REFUND:'Komision i kthyer',
  MANAGER_PAYOUT_DEDUCTION:'Pagesë fitimi', MANAGER_LOST_COLLECTED:'Fonde nga bast humbës',
  PLAYER_DELETE_TRANSFER_OUT:'Kalimi i bilancit pas fshirjes', PLAYER_DELETE_TRANSFER_IN:'Bilanc nga lojtar i fshirë',
};
export const transactionLabel=(type:string):string=>TRANSACTION_LABELS[type]??'Lëvizje financiare';

/** Old ledger descriptions stay intact; translate only known system phrasing. */
export function transactionDescription(description:string|null|undefined,type:string,lang:'al'|'en'='al'):string {
  if(!description)return transactionLabel(type);
  if(lang==='en')return description
    .replace(/^Kalimi i bilancit pas fshirjes te /,'Balance transferred after deletion to ')
    .replace(/^Bilanc nga lojtari i fshirë /,'Balance from deleted player ');
  return description.replace(/^Casino stake · /,'Bast kazinoje · ')
    .replace(/ · spin$/,' · rrotullim')
    .replace(/ · payout(?= |$)/,' · pagesë fitimi')
    .replace(/ · stake(?= |$)/,' · bast');
}

export const auditTargetLabel=(target:string):string=>({user:'Përdorues',match:'Ndeshje',market:'Treg',outcome:'Zgjedhje',ticket:'Biletë',settings:'Cilësime',system:'Sistem',casino:'Kazino'}[target]??'Objekt');
export function auditActionLabel(action:string):string {
  if(action==='FINANCIAL_RESET')return 'Zerim i plotë financiar';
  if(action==='UPDATE LIVE_RISK')return 'Ndryshim i rregullave të rrezikut';
  const [method,path='']=action.split(' ');
  if(path.includes('/casino/controls'))return 'Ndryshim i cilësimeve të lojës';
  if(path.includes('/casino/profile'))return 'Ndryshim i profilit të lojës';
  if(path.includes('/casino/settings'))return 'Aktivizim ose çaktivizim i kazinosë';
  if(path.includes('commission'))return 'Ndryshim i komisioneve';
  if(/\/users\/.+\/deposit$/.test(path))return 'Depozitim për përdoruesin';
  if(/\/users\/.+\/withdraw$/.test(path))return 'Tërheqje për përdoruesin';
  if(/\/users\/.+\/status$/.test(path))return 'Ndryshim i gjendjes së llogarisë';
  if(path.includes('/users'))return method==='POST'?'Krijim përdoruesi':method==='DELETE'?'Fshirje përdoruesi':'Ndryshim përdoruesi';
  if(path.includes('/tickets/'))return 'Anulim bilete';
  if(/\/matches\/.+\/settle$/.test(path))return 'Vendosje rezultati dhe llogaritje fitimesh';
  if(path.includes('/settlement'))return 'Llogaritje e biletave';
  if(path.includes('/outcomes/')&&path.endsWith('/odds'))return 'Ndryshim koeficienti';
  if(path.endsWith('/odds-adjust'))return 'Ndryshim i koeficientëve të tregut';
  if(path.endsWith('/suspend'))return 'Pezullim ose rihapje';
  if(path.includes('/bet-builders'))return method==='DELETE'?'Fshirje kombinimi ndeshjeje':'Ruajtje kombinimi ndeshjeje';
  return 'Ndryshim administrativ';
}
