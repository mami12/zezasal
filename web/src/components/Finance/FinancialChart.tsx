import { useLanguage } from '../../context/LanguageContext';
interface FinancialChartItem {
  label: string;
  value: number;
  color: string;
}

interface Props {
  title: string;
  description: string;
  items: FinancialChartItem[];
}

export default function FinancialChart({ title, description, items }: Props) {
  const { t } = useLanguage();
  const maxValue = Math.max(...items.map((item) => Math.abs(item.value)), 1);

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#111c2d] via-[#0f1728] to-[#0b1220] p-5 shadow-2xl shadow-slate-950/20 sm:p-6">
      <div className="mb-5">
        <h3 className="text-lg font-black text-white">{t(title)}</h3>
        <p className="mt-1 text-xs text-slate-400">{t(description)}</p>
      </div>
      <div className="space-y-4">
        {items.map((item) => {
          const width = (Math.abs(item.value) / maxValue) * 100;
          const negative = item.value < 0;
          return (
            <div key={item.label} className="grid grid-cols-[minmax(92px,1fr)_2fr_auto] items-center gap-3">
              <span className="truncate text-xs font-semibold text-slate-300" title={t(item.label)}>{t(item.label)}</span>
              <div
                className="relative h-3 overflow-hidden rounded-full bg-slate-800/90"
                role="img"
                aria-label={`${t(item.label)}: ${item.value.toFixed(2)} ${t('Lëk')}`}
              >
                <div
                  className={`absolute top-0 h-full rounded-full ${item.color} transition-[width,left] duration-500`}
                  style={{ width: `${width}%`, left: negative ? `${100 - width}%` : '0%' }}
                />
              </div>
              <span className={`min-w-[92px] text-right font-mono text-xs font-black tabular-nums ${negative ? 'text-rose-300' : 'text-slate-100'}`}>
                {item.value > 0 ? '+' : ''}{item.value.toFixed(2)} {" " + t("Lëk")}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
