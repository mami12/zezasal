const calendar = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" });
const parts = (date) => Object.fromEntries(calendar.formatToParts(date).map((p) => [p.type, p.value]));
function isFixtureOnDay(start, dateFilter, now = /* @__PURE__ */ new Date()) {
  const kickoff = new Date(start);
  if (!Number.isFinite(kickoff.getTime())) return false;
  const today = parts(now), offset = dateFilter === "tomorrow" ? 1 : dateFilter === "dayAfterTomorrow" ? 2 : 0;
  const target = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + offset));
  const match = parts(kickoff);
  return Number(match.year) === target.getUTCFullYear() && Number(match.month) === target.getUTCMonth() + 1 && Number(match.day) === target.getUTCDate();
}
export {
  isFixtureOnDay
};
/** Day choices constrain upcoming fixtures, never a match still in play after
 * midnight. The client cannot restore a live row removed by the API. */
export function filterFixtureRowsByDay(rows,day,now=new Date()){
 if(!['today','tomorrow','dayAfterTomorrow'].includes(day))return rows;
 return rows.filter(row=>row.live===true||String(row.service??row.status??'').toUpperCase()==='LIVE'||isFixtureOnDay(row.start_at,day,now));
}
