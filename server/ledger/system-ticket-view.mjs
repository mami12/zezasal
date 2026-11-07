/** Logical System tickets are views over independently settled financial columns. */
const sumMoney = values => values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100;
export const systemTicketId = batchId => `SYS-${batchId}`;
export const parseSystemTicketId = value => /^SYS-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(value ?? ''))?.[1]?.toLowerCase() ?? null;

export function aggregateSystemStatus(statuses) {
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.every(status => status === 'REVERTED')) return 'REVERTED';
  if (statuses.every(status => status === 'VOID')) return 'VOID';
  if (statuses.every(status => ['VOID', 'REVERTED', 'CANCELLED'].includes(status))) return 'CANCELLED';
  if (statuses.includes('WON')) return 'WON';
  return 'LOST';
}

/** SQL equivalent used before filtering/pagination, so partially settled batches stay active. */
export const SYSTEM_STATUS_SQL = `case
  when bool_or(c.status = 'PENDING') then 'PENDING'
  when bool_and(c.status = 'REVERTED') then 'REVERTED'
  when bool_and(c.status = 'VOID') then 'VOID'
  when bool_and(c.status in ('VOID','REVERTED','CANCELLED')) then 'CANCELLED'
  when bool_or(c.status = 'WON') then 'WON'
  else 'LOST' end`;

export function aggregateSystemTicket(batch, columns) {
  if (!batch?.id || !Array.isArray(columns) || !columns.length || columns.some(column => !column || column.system)) {
    throw new Error('System ticket columns are incomplete.');
  }
  if (batch.ticket_ids && (columns.length !== batch.ticket_ids.length ||
      columns.some((column, index) => column.id !== batch.ticket_ids[index]))) {
    throw new Error('System ticket columns do not match their batch.');
  }
  if (columns.some(column => column.userId !== batch.user_id)) throw new Error('System ticket ownership mismatch.');
  const id = systemTicketId(batch.id), matches = new Map();
  for (const column of columns) {
    for (const line of column.lines) {
      if (!matches.has(line.matchId)) matches.set(line.matchId, new Map());
      const selections = matches.get(line.matchId), previous = selections.get(line.outcomeId);
      if (!previous) selections.set(line.outcomeId, { ...line, ticketId: id });
      else if (previous.status !== line.status) {
        // Transitional grading can update copies of a source selection separately.
        previous.status = previous.status === 'PENDING' || line.status === 'PENDING' ? 'PENDING'
          : previous.status === 'LOST' || line.status === 'LOST' ? 'LOST' : line.status;
      }
    }
  }
  const status = aggregateSystemStatus(columns.map(column => column.status));
  const uniqueLines = [...matches.values()].flatMap(selections => [...selections.values()]);
  const order = new Map((batch.selection_order??[]).map((id,index)=>[id,index]));
  uniqueLines.sort((a,b)=>(order.get(a.outcomeId)??Number.MAX_SAFE_INTEGER)-(order.get(b.outcomeId)??Number.MAX_SAFE_INTEGER));
  const orderedMatches = new Map();
  for(const line of uniqueLines){
    if(!orderedMatches.has(line.matchId))orderedMatches.set(line.matchId,[]);
    orderedMatches.get(line.matchId).push(line);
  }
  const pending = columns.filter(column => column.status === 'PENDING');
  const paidOut = sumMoney(columns.filter(column => ['WON', 'VOID'].includes(column.status)).map(column => column.actualPayout ?? column.potentialPayout));
  const refunded = sumMoney(columns.filter(column => column.status === 'REVERTED').map(column => column.stake));
  const possible = sumMoney(columns.map(column => column.status === 'PENDING' ? column.potentialPayout
    : ['WON', 'VOID'].includes(column.status) ? column.potentialPayout : column.status === 'REVERTED' ? column.stake : 0));
  return {
    id, userId: batch.user_id, bookingCode: null, ticketType: 'SYSTEM', systemType: 'AUTO',
    stake: sumMoney(columns.map(column => column.stake)), totalOdds: 0,
    potentialPayout: sumMoney(columns.map(column => column.potentialPayout)), potentialPayoutIsEstimated: columns.some(column=>column.potentialPayoutIsEstimated), remainingPotentialPayout: possible, actualPayout: sumMoney([paidOut, refunded]), status,
    placedAt: batch.created_at ?? columns[0].placedAt,
    settledAt: pending.length ? null : columns.reduce((latest, column) =>
      column.settledAt && (!latest || new Date(column.settledAt) > new Date(latest)) ? column.settledAt : latest, null),
    user: columns[0].user ?? null,
    lines: [...orderedMatches.values()].flat(),
    system: {
      batchId: batch.id, columnCount: columns.length, columns,
      minColumnPayout: Math.min(...columns.map(column => column.potentialPayout)),
      maxColumnPayout: Math.max(...columns.map(column => column.potentialPayout)),
      paidOut, refunded, pendingColumns: pending.length,
    },
  };
}
