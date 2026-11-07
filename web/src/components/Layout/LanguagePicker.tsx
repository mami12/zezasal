import { useLanguage } from '../../context/LanguageContext';

export default function LanguagePicker() {
  const {lang, setLanguage, t} = useLanguage();
  return <select data-language-picker aria-label={t('languages.choose')} value={lang}
    onChange={event => setLanguage(event.target.value === 'en' ? 'en' : 'al')}
    className="h-9 w-[86px] shrink-0 rounded-xl border border-[#62417d] bg-[#241339] px-1 text-base text-purple-100 outline-none transition focus:border-purple-400 sm:w-[98px] sm:px-2 sm:text-sm">
    <option value="al" className="bg-[#241339] text-white">Shqip</option>
    <option value="en" className="bg-[#241339] text-white">English</option>
  </select>;
}
