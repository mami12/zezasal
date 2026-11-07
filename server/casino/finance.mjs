import express from 'express';
import { query } from '../db.mjs';
import { requireAuth } from '../ledger/auth.mjs';
import { isLedgerReady } from '../ledger/store.mjs';

export const casinoFinanceRouter = express.Router();
const bad = (status, message) => Object.assign(new Error(message), {status});
const safe = handler => (req,res) => Promise.resolve(handler(req,res)).catch(error => {
  if (!error.status || error.status >= 500) console.error('[casino finance]', error);
  res.status(error.status || 500).json({message: error.status ? error.message : 'Finance report unavailable'});
});
const access = [
  requireAuth,
  (req,res,next) => isLedgerReady() ? next() : res.status(503).json({message:'Ledger unavailable'}),
  (req,res,next) => ['ADMIN','MANAGER'].includes(req.user.role) ? next() : res.status(403).json({message:'Staff only'}),
];
const money = x => Number(Number(x).toFixed(2));
function date(value, isEnd) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(Date.parse(value))) throw bad(400, 'Invalid date');
  return value + (isEnd ? 'T23:59:59.999Z' : 'T00:00:00.000Z');
}
// Aggregate ticket settlements, not quoted potential payouts. The payout is
// read from the actual posted BET_WON transaction so voided legs are correct.
const playerSQL = [
  'select u.id,u.username,u.balance,',
  'coalesce(s.turnover,0) as "sportTurnover",coalesce(s.pending,0) as "sportPending",',
  'coalesce(s.stake,0) as "sportStake",coalesce(s.payout,0) as "sportPayout",coalesce(s.cnt,0) as "sportCount",',
  'coalesce(c.stake,0) as "casinoStake",(coalesce(c.payout,0)+coalesce(g.adjustment,0)) as "casinoPayout",coalesce(c.cnt,0) as "casinoSpins"',
  'from app_user u',
  'left join lateral (',
  'select coalesce(sum(t.stake),0) as turnover,',
  "coalesce(sum(t.stake) filter(where t.status='PENDING'),0) as pending,",
  "coalesce(sum(t.stake) filter(where t.status in ('WON','LOST')),0) as stake,",
  "coalesce(sum(w.paid) filter(where t.status='WON'),0) as payout,",
  "count(*) filter(where t.status in ('WON','LOST')) as cnt",
  'from app_ticket t',
  "left join lateral (select coalesce(sum(tx.amount),0) as paid from app_transaction tx",
  "where tx.user_id=u.id and tx.reference_id=t.id and tx.type='BET_WON') w on true",
  'where t.user_id=u.id',
  "and (($3::timestamptz is null and $4::timestamptz is null) or",
  "(t.status='PENDING' and ($3::timestamptz is null or t.placed_at >= $3)",
  "and ($4::timestamptz is null or t.placed_at <= $4)) or",
  "(t.status<>'PENDING' and ($3::timestamptz is null or t.settled_at >= $3)",
  'and ($4::timestamptz is null or t.settled_at <= $4)))',
  ') s on true',
  'left join lateral (select coalesce(sum(c.stake),0) as stake,',
  'coalesce(sum(c.payout),0) as payout,count(*) as cnt',
  'from app_casino_round c where c.user_id=u.id',
  'and ($3::timestamptz is null or c.created_at >= $3)',
  'and ($4::timestamptz is null or c.created_at <= $4)) c on true',
  'left join lateral (select coalesce(sum(tx.amount),0) as adjustment',
  'from app_transaction tx where tx.user_id=u.id',
  "and tx.type in ('CASINO_GAMBLE_WIN','CASINO_GAMBLE_LOSS')",
  'and ($3::timestamptz is null or tx.created_at >= $3)',
  'and ($4::timestamptz is null or tx.created_at <= $4)) g on true',
  "where u.role='PLAYER' and ($1::uuid is null or u.manager_id=$1)",
  'and ($2::uuid is null or u.id=$2)',
  'order by u.username limit 2000',
].join(' ');
export async function generateCasinoFinanceReport({managerId=null,userId=null,from=null,to=null}) {
  const since=date(from,false),until=date(to,true);
  if(since && until && since > until) throw bad(400,'Date range is reversed');
  if(userId && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId)) throw bad(400,'Invalid user ID');
  const {rows}=await query(playerSQL,[managerId,userId,since,until]);
  const players=rows.map(r=>{
    const sportStake=Number(r.sportStake),sportPayout=Number(r.sportPayout),
      casinoStake=Number(r.casinoStake),casinoPayout=Number(r.casinoPayout);
    return {id:r.id,username:r.username,balance:Number(r.balance),
      sportTurnover:Number(r.sportTurnover),sportPending:Number(r.sportPending),
      sportStake,sportPayout,sportNet:money(sportPayout-sportStake),sportCount:Number(r.sportCount),
      casinoStake,casinoPayout,casinoNet:money(casinoPayout-casinoStake),
      casinoSpins:Number(r.casinoSpins),net:money(sportPayout+casinoPayout-sportStake-casinoStake)};
  });
  const keys=['sportTurnover','sportPending','sportStake','sportPayout','sportNet','sportCount',
    'casinoStake','casinoPayout','casinoNet','casinoSpins','net'];
  const totals=Object.fromEntries(keys.map(key=>[key,money(players.reduce((sum,p)=>sum+p[key],0))]));
  let transactions=[];
  let rounds=[];
  // A manager cannot obtain another manager's history: scope is established above.
  if(userId && players.length){
    const tx=await query([
      'select id,amount,type,description,reference_id as "referenceId",',
      'balance_after as "balanceAfter",created_at as "createdAt" from app_transaction',
      'where user_id=$1 and ($2::timestamptz is null or created_at >= $2)',
      'and ($3::timestamptz is null or created_at <= $3)',
      'order by created_at desc limit 300',
    ].join(' '),[userId,since,until]);
    transactions=tx.rows.map(r=>({...r,amount:Number(r.amount),balanceAfter:Number(r.balanceAfter)}));
    const gameRows=await query(
      'select id,game_id as "gameId",game_version as "gameVersion",stake,payout,balance_after as "balanceAfter",created_at as "createdAt" from app_casino_round where user_id=$1 and ($2::timestamptz is null or created_at >= $2) and ($3::timestamptz is null or created_at <= $3) order by created_at desc limit 300',
      [userId,since,until]);
    rounds=gameRows.rows.map(r=>({...r,stake:Number(r.stake),payout:Number(r.payout),
      balanceAfter:Number(r.balanceAfter),net:money(Number(r.payout)-Number(r.stake))}));
  }
  return {players,totals,transactions,rounds,truncated:players.length===2000};
}
async function report(req,res){
  if(req.user.role==='MANAGER' && req.path.startsWith('/admin/')) throw bad(403,'Administrator only');
  if(req.user.role==='ADMIN' && req.path.startsWith('/manager/')) throw bad(403,'Manager only');
  const result=await generateCasinoFinanceReport({
    managerId:req.user.role==='MANAGER'?req.user.id:null,
    userId:req.query.userId?String(req.query.userId):null,from:req.query.from,to:req.query.to});
  res.set('Cache-Control','no-store');
  res.json(result);
}
casinoFinanceRouter.get('/admin/casino/finance',...access,safe(report));
casinoFinanceRouter.get('/manager/casino/finance',...access,safe(report));
