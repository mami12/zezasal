/** Traverse the authoritative match catalog once per server poll. Offset pages
 * can overlap during a live update, so preserve IDs and prefer the LIVE copy.
 */
export async function fetchMatchPages(requestPage, { pageSize = 1000, maxPages = Infinity } = {}) {
  const limit = Math.max(1, Math.min(2000, Number(pageSize) || 1000));
  const matches = new Map(); let received = 0, offset = 0;
  const live = item => String(item?.service ?? '').toUpperCase() === 'LIVE';
  for (let page = 0; page < maxPages; page++) {
    const response = await requestPage({ limit, offset });
    if (!Array.isArray(response?.items)) throw new Error('Upstream match page has no items array');
    const items = response.items; received += items.length; let added = 0;
    for (const item of items) {
      const id = String(item?.id ?? item?.matchId ?? '');
      if (!id) continue;
      const previous = matches.get(id);
      if (!previous) { matches.set(id, item); added++; }
      else if (live(item) && !live(previous)) matches.set(id, item);
    }
    if (response.hasMore === false || (items.length < limit && response.hasMore !== true)) return { items: [...matches.values()], received, complete: true };
    // An endpoint that ignores offset must not cause an infinite poll or an
    // empty board on boot. Keep its usable first page and flag incompleteness.
    if (!added) return { items: [...matches.values()], received, complete: false };
    offset += items.length;
  }
  return { items: [...matches.values()], received, complete: false };
}
