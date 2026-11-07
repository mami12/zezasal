import assert from 'node:assert/strict';
import {
  chargeManagerCommission,
  managerCommission,
  managerCommissionPercent,
  refundManagerCommission,
} from '../server/ledger/manager-finance.mjs';

const managerId = 'manager-1';
const transactions = [];
const reportRows = new Map();
let balance = 1000;
let configuredRates = { single: 3, double: 5, multi: 7 };
const client = {
  async query(sql, values = []) {
    if (sql.includes('from app_commission_config')) {
      return { rows: [configuredRates] };
    }
    if (sql.startsWith('select amount from app_manager_commission')) {
      return { rows: reportRows.has(values[0]) ? [{ amount: reportRows.get(values[0]).amount }] : [] };
    }
    if (sql.startsWith('select -sum(amount)')) {
      const historical = transactions.filter(tx => tx.referenceId === values[0]);
      return { rows: [{ amount: historical.length ? historical.reduce((sum, tx) => sum - tx.amount, 0) : null }] };
    }
    if (sql.startsWith('insert into app_manager_commission')) {
      if (reportRows.has(values[1])) return { rows: [] };
      const record = { managerId: values[0], ticketId: values[1], stake: values[2], selectionCount: values[3], ratePct: values[4], amount: values[5] };
      reportRows.set(record.ticketId,record);
      return { rows: [{ amount: record.amount }] };
    }
    if (sql.includes("type in ('MANAGER_COMMISSION_DEBIT', 'MANAGER_COMMISSION_REFUND')")) {
      return {
        rows: transactions
          .filter((transaction) => transaction.userId === values[0] && transaction.referenceId === values[1])
          .map(({ type, amount }) => ({ type, amount })),
      };
    }
    if (sql.startsWith('select balance from app_user')) return { rows: [{ balance }] };
    if (sql.startsWith('update app_user set balance')) {
      balance = values[1];
      return { rows: [] };
    }
    if (sql.startsWith('insert into app_transaction')) {
      const type = sql.includes("'MANAGER_COMMISSION_DEBIT'") ? 'MANAGER_COMMISSION_DEBIT' : 'MANAGER_COMMISSION_REFUND';
      transactions.push({ userId: values[0], amount: values[1], referenceId: values[2], type });
      return { rows: [] };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  },
};

assert.equal(managerCommissionPercent(1), 3);
assert.equal(managerCommissionPercent(2), 5);
assert.equal(managerCommissionPercent(3), 7);
assert.equal(managerCommissionPercent(8), 7);
assert.equal(managerCommission(150, 1), 4.5);
assert.equal(managerCommission(25.10, 2), 1.26, 'fractional system stake rounds an exact half-cent up');
assert.equal(managerCommission(33.34, 2), 1.67);
assert.equal(managerCommission(33.33, 2), 1.67);
assert.equal(managerCommission(2, 1, { single: 0.25 }), 0.01, 'configured fractional percentage keeps decimal accuracy');
assert.equal(managerCommission(100, 1, { single: 0 }), 0);
assert.equal(managerCommission(100, 1, { single: 4, double: 6, multi: 8 }), 4);
assert.equal(managerCommissionPercent(2, { single: 4, double: 6, multi: 8 }), 6);

assert.equal(await chargeManagerCommission(client, { managerId, ticketId: 'single', username: 'p', stake: 100, selectionCount: 1 }), 3);
assert.equal(balance, 1000, 'reporting a commission never debits the manager');
assert.equal(await chargeManagerCommission(client, { managerId, ticketId: 'single', username: 'p', stake: 100, selectionCount: 1 }), 3);
assert.equal(reportRows.size, 1, 'the same ticket is reported only once');
assert.deepEqual(reportRows.get('single'), { managerId, ticketId:'single', stake:100, selectionCount:1, ratePct:3, amount:3 });
assert.equal(transactions.length, 0, 'a report is not a financial ledger movement');

assert.equal(await chargeManagerCommission(client, { managerId, ticketId: 'double', username: 'p', stake: 100, selectionCount: 2 }), 5);
assert.equal(await chargeManagerCommission(client, { managerId, ticketId: 'multi', username: 'p', stake: 100, selectionCount: 3 }), 7);
assert.equal(balance, 1000);
assert.deepEqual([...reportRows.values()].map(row=>row.amount), [3,5,7]);

assert.equal(await refundManagerCommission(client, { managerId, ticketId: 'single', username: 'p' }), 0, 'report-only commission never creates a wallet refund');
assert.equal(balance, 1000);
assert.equal(await refundManagerCommission(client, { managerId, ticketId: 'single', username: 'p' }), 0);
assert.equal(balance, 1000);

configuredRates = { single: 4, double: 6, multi: 8 };
assert.equal(await chargeManagerCommission(client, { managerId, ticketId: 'config-change', username: 'p', stake: 100, selectionCount: 1 }), 4);
assert.equal(reportRows.get('config-change').ratePct,4,'new tickets freeze the configured rate');
assert.equal(await chargeManagerCommission(client, {managerId,ticketId:'single',stake:100,selectionCount:1}),3,'new settings never rewrite old commission terms');
assert.equal(balance,1000);
assert.equal(await chargeManagerCommission(client,{managerId:null,ticketId:'unmanaged',stake:100,selectionCount:1}),0);
assert.equal(reportRows.has('unmanaged'),false);

// A historical debit really did move funds. It is neither silently rewritten
// nor charged again; cancelling that old ticket refunds the exact old amount.
balance=997;transactions.push({userId:managerId,amount:-3,referenceId:'legacy',type:'MANAGER_COMMISSION_DEBIT'});
assert.equal(await chargeManagerCommission(client,{managerId,ticketId:'legacy',stake:100,selectionCount:1}),3);
assert.equal(reportRows.has('legacy'),false);assert.equal(balance,997);
assert.equal(await refundManagerCommission(client,{managerId,ticketId:'legacy',username:'p'}),3);
assert.equal(balance,1000);assert.equal(await refundManagerCommission(client,{managerId,ticketId:'legacy',username:'p'}),0);
assert.equal(balance,1000,'legacy refund is idempotent');

console.log('Manager finance checks passed: exact rounding, frozen report-only commissions, no wallet movement, and legacy refunds');
