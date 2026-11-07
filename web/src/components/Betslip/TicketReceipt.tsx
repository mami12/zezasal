import { Printer, X } from 'lucide-react';
import { Ticket } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { formatTicketSelection, formatMarketSelectionLabel, translateTicketType } from '../../utils/sportsbookLabels';
import { formatOdds } from '../../utils/formatOdds';

const CODE39: Record<string, string> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
  '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
  '8': '100100100', '9': '001100100', A: '100001001', B: '001001001',
  C: '101001000', D: '000011001', E: '100011000', F: '001011000',
  G: '000001101', H: '100001100', I: '001001100', J: '000011100',
  K: '100000011', L: '001000011', M: '101000010', N: '000010011',
  O: '100010010', P: '001010010', Q: '000000111', R: '100000110',
  S: '001000110', T: '000010110', U: '110000001', V: '011000001',
  W: '111000000', X: '010010001', Y: '110010000', Z: '011010000',
  '-': '010000101', '.': '110000100', ' ': '011000100', '$': '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};

function Code39Barcode({ value }: { value: string }) {
  const encoded = `*${value.toUpperCase()}*`;
  const rects: Array<{ x: number; width: number }> = [];
  let x = 0;

  for (const [index, character] of [...encoded].entries()) {
    const pattern = CODE39[character];
    if (!pattern) continue;
    for (let element = 0; element < pattern.length; element++) {
      const width = pattern[element] === '1' ? 3 : 1;
      if (element % 2 === 0) rects.push({ x, width });
      x += width;
    }
    if (index < encoded.length - 1) x += 1;
  }

  return (
    <svg
      aria-label={`Barkod ${value}`}
      className="mx-auto block h-14 w-full max-w-[68mm]"
      viewBox={`0 0 ${x} 48`}
      role="img"
    >
      {rects.map((bar, index) => (
        <rect key={index} x={bar.x} y="0" width={bar.width} height="48" fill="#000" />
      ))}
    </svg>
  );
}

interface Props {
  ticket: Ticket;
  onClose: () => void;
}

export default function TicketReceipt({ ticket, onClose }: Props) {
  const { t } = useLanguage();
  const barcodeValue = ticket.system ? `SYS-${ticket.system.batchId.replace(/-/g,'').slice(0,12)}`.toUpperCase()
    : ticket.id.replace(/-/g, '').slice(0, 10).toUpperCase();
  const system = ticket.system;
  const stakes = system?.columns.map(column => column.stake) ?? [];
  const minStake = Math.min(...stakes), maxStake = Math.max(...stakes);

  return (
    <div className="ticket-print-overlay fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-6">
      <section className="ticket-print-panel w-full max-w-md rounded-2xl bg-white p-5 text-black shadow-2xl">
        <div className="ticket-print-actions mb-3 flex justify-end gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white"
          >
            <Printer size={16} /> {" " + t("Printo biletën")}</button>
          <button onClick={onClose} aria-label={t("Mbyll")} className="rounded-lg border border-black/20 p-2">
            <X size={16} />
          </button>
        </div>

        <div className="border-b-2 border-dashed border-black/40 pb-3 text-center">
          <h2 className="text-lg font-black uppercase tracking-widest">{t("BILETË BASTI")}</h2>
          <p className="mt-1 text-xs">ID: {ticket.id.toUpperCase()}</p>
          <p className="text-xs">{new Date(ticket.placedAt).toLocaleString('sq-AL')}</p>
          {system && (
            <div className="mt-2 space-y-0.5 text-xs">
              <p className="font-bold">{t("Sistem ·") + " "}{system.columnCount} {" " + t("kolona")}</p>
              <p>{t("Një biletë me të gjitha zgjedhjet. Një zgjedhje për ndeshje në çdo kolonë.")}</p>
            </div>
          )}
        </div>

        <div className="space-y-3 py-3">
          {ticket.lines.map((line, index) => (
            <article key={line.id || `${line.matchId}-${index}`} className="border-b border-dashed border-black/30 pb-2 text-xs">
              <div className="font-bold">{line.matchName}</div>
              <div className="mt-0.5">
                {formatMarketSelectionLabel(line.marketName, line.marketLine, t)}: <strong>{formatTicketSelection(line.outcomeName, line.marketName, line.matchName, t, line.outcomeCode, line.marketLine)}</strong>
              </div>
              <div className="mt-0.5 flex justify-between">
                <span>{t("Kuota")}</span><strong>{formatOdds(line.oddsAtPlacement)}</strong>
              </div>
            </article>
          ))}
        </div>

        <div className="space-y-1 border-y-2 border-dashed border-black/40 py-3 text-sm">
          <div className="flex justify-between"><span>{t("Lloji i biletës")}</span><strong>{translateTicketType(ticket.ticketType, t)}</strong></div>
          <div className="flex justify-between"><span>{system ? 'Shuma totale' : 'Shuma e luajtur'}</span><strong>{ticket.stake.toFixed(2)} {" " + t("Lëk")}</strong></div>
          {system ? <>
            <div className="flex justify-between"><span>{t("Shuma për kolonë")}</span><strong>{minStake.toFixed(2)}{minStake !== maxStake ? `–${maxStake.toFixed(2)}` : ''} {" " + t("Lëk")}</strong></div>
            <div className="flex justify-between"><span>{t("Pagesa minimale për kolonë fituese")}</span><strong>{system.minColumnPayout.toFixed(2)} {" " + t("Lëk")}</strong></div>
            <div className="flex justify-between"><span>{t("Pagesa maksimale për kolonë fituese")}</span><strong>{system.maxColumnPayout.toFixed(2)} {" " + t("Lëk")}</strong></div>
            <div className="flex justify-between text-base"><span>{ticket.status === 'PENDING' ? 'Pagesa nëse fitojnë të gjitha kolonat' : 'Pagesa e kthyer'}</span><strong>{(ticket.status === 'PENDING' ? ticket.potentialPayout : ticket.actualPayout ?? 0).toFixed(2)} {" " + t("Lëk")}</strong></div>
            <p className="pt-1 text-[10px]">{t("Pagesa llogaritet nga kolonat fituese. Pagesa minimale është 0 nëse humbin të gjitha kolonat.")}</p>
          </> : <>
            <div className="flex justify-between"><span>{t("Koeficienti total")}</span><strong>{formatOdds(ticket.totalOdds)}</strong></div>
            <div className="flex justify-between text-base"><span>{t("Fitimi i mundshëm")}</span><strong>{ticket.potentialPayout.toFixed(2)} {" " + t("Lëk")}</strong></div>
          </>}
        </div>

        <div className="pt-4 text-center">
          <Code39Barcode value={barcodeValue} />
          <p className="mt-1 font-mono text-xs tracking-[0.25em]">{barcodeValue}</p>
          <p className="mt-2 text-[10px]">{t("Ruajeni biletën për verifikim.")}</p>
        </div>
      </section>
    </div>
  );
}
