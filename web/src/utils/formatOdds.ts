/** Player-facing odds always use two decimals, rounded half-up. */
export function formatOdds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const decimal=String(Math.abs(value)).match(/^(\d+)(?:\.(\d+))?$/);
  if(!decimal)return value.toFixed(2);
  const fraction=decimal[2]??'';
  let cents=BigInt(decimal[1])*100n+BigInt(fraction.slice(0,2).padEnd(2,'0'));
  if(fraction.length>2&&fraction[2]>='5')cents++;
  return `${value<0?'-':''}${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
}
