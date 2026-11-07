import { useLanguage } from '../../context/LanguageContext';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { apiClient } from '../../api/client';

interface Rates {
  single: number;
  double: number;
  multi: number;
  casino: number;
}

export default function CommissionRates() {
  const { t } = useLanguage();
  const [rates, setRates] = useState<Rates>({ single: 3, double: 5, multi: 7, casino: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get('/admin/commission-rates')
      .then((response) => setRates(response.data))
      .catch((error) => {
        console.error(error);
        alert('Nuk u lexuan normat e komisionit.');
      })
      .finally(() => setLoading(false));
  }, []);

  const setRate = (tier: keyof Rates, value: string) => {
    setRates((current) => ({ ...current, [tier]: value === '' ? 0 : Number(value) }));
  };

  const [saveSuccess, setSaveSuccess] = useState(false);

  const adjustRate = (tier: keyof Rates, delta: number) => {
    setRates((current) => {
      const next = Math.max(0, Math.min(100, Number((current[tier] + delta).toFixed(2))));
      return { ...current, [tier]: next };
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (Object.values(rates).some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      alert('Çdo komision duhet të jetë nga 0% deri në 100%.');
      return;
    }
    setSaving(true);
    setSaveSuccess(false);
    try {
      const response = await apiClient.patch('/admin/commission-rates', rates);
      setRates(response.data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error: any) {
      alert(error.response?.data?.message || 'Ruajtja e komisioneve dështoi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-5 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-white">{t("Komisionet e menaxherëve")}</h3>
          <p className="mt-0.5 text-xs text-text-secondary">{t("Përqindjet llogariten mbi shumën e luajtur, veçmas për sport dhe slot machine. Janë vetëm raport për llogaritje manuale: bilanci nuk ndryshon. Ndryshimet vlejnë për bastet e reja.")}</p>
        </div>
        {saveSuccess && (
          <span className="self-start sm:self-auto text-xs px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30 animate-pulse">
            {t("Normat u ruajtën me sukses!")}</span>
        )}
      </div>
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {([
          ['single', 'Sport: Teke (1 zgjedhje)'],
          ['double', 'Sport: Dyshe (2 zgjedhje)'],
          ['multi', 'Sport: Shumëfishe (3+)'],
          ['casino', 'Slot machine'],
        ] as const).map(([tier, label]) => (
          <div key={tier} className="flex-1 bg-primary/60 p-2.5 sm:p-3 rounded-xl border border-tertiary/70">
            <span className="block text-[11px] sm:text-xs font-semibold text-text-secondary mb-1.5">
              {t(label)}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => adjustRate(tier, -0.5)}
                disabled={loading || saving || rates[tier] <= 0}
                className="w-7 h-8 flex items-center justify-center rounded-lg bg-tertiary hover:bg-tertiary/80 text-text-secondary hover:text-white font-bold text-sm disabled:opacity-30 active:scale-95 transition"
                title="-0.5%"
              >
                -
              </button>
              <div className="flex-1 flex items-center rounded-lg border border-tertiary bg-secondary px-2.5 py-1">
                <input
                  aria-label={label}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={loading ? '' : rates[tier]}
                  onChange={(event) => setRate(tier, event.target.value)}
                  disabled={loading || saving}
                  className="w-full bg-transparent py-1 text-sm sm:text-base font-black text-white outline-none tabular-nums text-center"
                />
                <span className="text-accent-yellow font-bold text-xs">%</span>
              </div>
              <button
                type="button"
                onClick={() => adjustRate(tier, 0.5)}
                disabled={loading || saving || rates[tier] >= 100}
                className="w-7 h-8 flex items-center justify-center rounded-lg bg-tertiary hover:bg-tertiary/80 text-text-secondary hover:text-white font-bold text-sm disabled:opacity-30 active:scale-95 transition"
                title="+0.5%"
              >
                +
              </button>
            </div>
          </div>
        ))}
        <button
          type="submit"
          disabled={loading || saving}
          className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-accent-green hover:bg-emerald-600 px-5 py-3 text-sm font-black text-primary active:scale-95 disabled:opacity-50 transition shadow-md shadow-accent-green/20"
        >
          <Save size={16} /> {saving ? 'Duke ruajtur…' : 'Ruaj normat'}
        </button>
      </form>
    </section>
  );
}
