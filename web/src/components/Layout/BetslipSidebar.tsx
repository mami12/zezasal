import Betslip from '../Betslip/Betslip';

/**
 * The betslip frame. On a wide screen it is the fixed rail on the right (w-80); on a phone the
 * board renders it as a bottom sheet instead, so the frame is the caller's choice - the
 * betslip itself is the same component either way.
 */
export default function BetslipSidebar({ className = '' }: { className?: string }) {
  return (
    <div className={`zshop-slip-frame bg-secondary flex flex-col ${className || 'w-80 border-l border-tertiary h-full'}`}>
      <Betslip />
    </div>
  );
}
