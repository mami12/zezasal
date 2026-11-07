import { useLanguage } from '../../context/LanguageContext';
import { Copy, X, Check } from 'lucide-react';
import { useState } from 'react';

export default function BookingModal({ code, onClose }: { code: string, onClose: () => void }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-secondary/95 p-6 sm:p-8 rounded-3xl max-w-sm w-full text-center border border-tertiary/90 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-text-secondary">{t("KUPONI I BASTIT")}</span>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-white hover:bg-tertiary transition">
            <X size={18} />
          </button>
        </div>

        <div>
          <h2 className="text-xl font-black text-white">{t('betslip.booking_code')}</h2>
          <p className="text-text-secondary text-xs mt-1">{t('betslip.present_code')}</p>
        </div>
        
        <div className="bg-primary/95 py-4 px-3 rounded-2xl border border-tertiary/80 text-3xl font-mono font-black text-accent-yellow tracking-widest shadow-inner select-all">
          {code}
        </div>

        <div className="space-y-2 pt-1">
          <button 
            onClick={handleCopy}
            className="w-full bg-gradient-to-r from-emerald-600 to-accent-green hover:brightness-105 active:scale-[0.99] text-primary font-black py-3 rounded-xl transition shadow-glow-green text-xs flex items-center justify-center gap-2"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? t('betslip.copied') : t('betslip.copy_code')}</span>
          </button>
          <button 
            onClick={onClose}
            className="w-full bg-primary/60 border border-tertiary/70 text-text-secondary hover:text-white hover:bg-tertiary font-bold py-2.5 rounded-xl transition text-xs"
          >
            {t('betslip.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
