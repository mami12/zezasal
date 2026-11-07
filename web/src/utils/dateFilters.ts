export function toDateRange(from: string, to: string) {
  const start = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
  const end = to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined;
  return { from: start, to: end };
}
