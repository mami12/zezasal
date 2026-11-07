import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import al from '../i18n/al';
import en from '../i18n/en';
import { englishInterfaceText } from '../i18n/interfaceText';
import { repairDisplayText } from '../utils/repairDisplayText';

export type Lang = 'al' | 'en';
export type Translator = ((key: string) => string) & { lang?: Lang };

interface LanguageContextType {
  lang: Lang;
  setLanguage: (l: Lang) => void;
  t: Translator;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'al', setLanguage: () => {},
  t: Object.assign((key: string) => repairDisplayText(dictionaryValue(al, key) ?? key), { lang: 'al' as const }),
});

const validLanguage = (value: unknown): Lang => value === 'en' ? 'en' : 'al';
const storedLanguage = (): Lang => {
  try { return validLanguage(localStorage.getItem('lang')); } catch { return 'al'; }
};
function dictionaryValue(dictionary: Record<string, unknown>, key: string): string | undefined {
  // Provider market names contain dots ("Corners. Total"). They are flat keys
  // inside the markets section, rather than additional nested dictionaries.
  const separator = key.indexOf('.');
  if (separator >= 0) {
    const section = dictionary[key.slice(0, separator)];
    const flat = section && typeof section === 'object'
      ? (section as Record<string, unknown>)[key.slice(separator + 1)] : undefined;
    if (typeof flat === 'string') return flat;
  }
  let value: unknown = dictionary;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [lang, setLang] = useState<Lang>(storedLanguage);
  useEffect(() => {
    try { localStorage.setItem('lang', lang); } catch { /* Language remains usable when storage is unavailable. */ }
    document.documentElement.lang = lang === 'en' ? 'en' : 'sq';
  }, [lang]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === 'lang' || event.key === null) setLang(validLanguage(event.newValue)); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const t = useMemo<Translator>(() => Object.assign((key: string) => repairDisplayText(dictionaryValue(lang === 'en' ? en : al, key)
    ?? (lang === 'en' ? englishInterfaceText[key] : undefined) ?? key), {lang}), [lang]);
  const setLanguage = (next: Lang) => { if (next === 'al' || next === 'en') setLang(next); };

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
