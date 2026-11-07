import {repairDisplayText} from './repairDisplayText';
/** Translate display copy without changing the API error or its diagnostic data. */
export function userError(value: unknown, fallback = 'Kërkesa nuk u përfundua. Provo përsëri.'): string {
  const message = repairDisplayText(typeof value === 'string' ? value.trim() : value instanceof Error ? value.message.trim() : '');
  if (!message) return fallback;
  const exact: Record<string, string> = {
    'invalid username or password': 'Emri i përdoruesit ose fjalëkalimi është i pasaktë.',
    'Invalid username or password': 'Emri i përdoruesit ose fjalëkalimi është i pasaktë.',
    'not authenticated': 'Duhet të identifikohesh për të vazhduar.',
    'account no longer exists': 'Kjo llogari nuk është më e disponueshme.',
    'account is banned': 'Kjo llogari është e bllokuar.',
    'User not found': 'Përdoruesi nuk u gjet.',
    'Username already exists': 'Ky emër përdoruesi është përdorur tashmë.',
    'Forbidden': 'Nuk ke leje për këtë veprim.',
    'Unauthorized': 'Duhet të identifikohesh për të vazhduar.',
    'Unsupported casino game': 'Kjo lojë kazinoje nuk mbështetet.',
    'Unknown casino game': 'Loja e kazinosë nuk u gjet.',
    'Unsupported casino line count': 'Numri i linjave nuk mbështetet për këtë lojë.',
    'Unsupported casino reel profile': 'Profili i zgjedhur nuk mbështetet për këtë lojë.',
    'Select original or custom casino math': 'Zgjidh modalitetin origjinal ose të personalizuar të lojës.',
    'RTP and hit frequency are required': 'RTP dhe shpeshtësia e fitimit janë të detyrueshme.',
    'RTP and hit frequency must both be zero, or both be greater than zero': 'RTP dhe shpeshtësia e fitimit duhet të jenë të dyja zero ose të dyja mbi zero.',
    'Custom round selection requires custom mode': 'Për këtë rrotullim duhet të aktivizohet modaliteti i personalizuar.',
    'Requested custom profile is unavailable at this stake': 'Profili i personalizuar nuk është i disponueshëm me këtë bast.',
    'Select a supported global game profile': 'Zgjidh një profil të mbështetur për të gjithë përdoruesit e lojës.',
    'Select a supported casino profile before starting a new paid round': 'Zgjidh një profil të mbështetur të kazinosë përpara një rrotullimi të ri me pagesë.',
    'Select global game controls': 'Zgjidh cilësimet e lojës për të gjithë përdoruesit.',
    'Casino settings unavailable': 'Cilësimet e kazinosë nuk janë të disponueshme. Provo përsëri.',
    'Casino service unavailable': 'Shërbimi i kazinosë nuk është i disponueshëm. Provo përsëri.',
    'Ledger database unavailable': 'Lidhja me databazën e bilanceve nuk është e disponueshme. Provo përsëri.',
    'Administrator only': 'Ky veprim lejohet vetëm për administratorin.',
    'enabled must be boolean': 'Zgjidh nëse lojërat duhet të jenë aktive ose joaktive.',
    'Casino settings changed. Reopen the game and review RTP and hit frequency before a new paid spin.': 'Cilësimet e kazinosë ndryshuan. Rihap lojën dhe kontrollo RTP dhe shpeshtësinë e fitimit përpara një rrotullimi të ri me pagesë.',
    'Network Error': 'Lidhja me serverin dështoi. Kontrollo internetin dhe provo përsëri.',
    'Failed to fetch': 'Lidhja me serverin dështoi. Kontrollo internetin dhe provo përsëri.',
  };
  if (exact[message]) return exact[message];
  if (/^Casino stake must be between (?:20|20\.00) and 5000(?:\.00| ALL)?$/.test(message)) return 'Basti i kazinosë duhet të jetë nga 20 deri në 5000 lekë.';
  const percentage = message.match(/^(RTP|Hit frequency) must be a number from 0 to (100|1000) with at most two decimal places$/);
  if (percentage) return `${percentage[1] === 'RTP' ? 'RTP' : 'Shpeshtësia e fitimit'} duhet të jetë nga 0 deri në ${percentage[2]}, me deri në dy shifra pas presjes.`;
  const incompatible = message.match(/^Incompatible RTP and hit frequency\. RTP \/ hit frequency must be between ([\d.]+) and ([\d.]+) for every supported stake and line count$/);
  if (incompatible) return `RTP dhe shpeshtësia e fitimit nuk përputhen. Raporti mes tyre duhet të jetë nga ${incompatible[1]} deri në ${incompatible[2]} për çdo bast dhe numër linjash të mbështetur.`;
  if (/^Unsupported reel profile for /.test(message)) return 'Profili i zgjedhur nuk mbështetet për këtë lojë.';
  if (/^timeout of \d+ms exceeded$/.test(message)) return 'Serveri nuk u përgjigj në kohë. Provo përsëri.';
  // Existing Albanian messages carry useful, specific reasons. Unknown diagnostic
  // text stays in the original error object and is not presented as English UI.
  if (/[ëç]/i.test(message) || /\b(?:nuk|gabim|provo|duhet|eshte|zgjedh|ruajt|llogaria|loja|basti|bilanci|perdoruesi|shuma|ju|kjo|ky|vetem|pritje|anuluar|pavlefshme)\b/i.test(message)) return message;
  return fallback;
}

/** Localized error view. Keep the original response available for diagnostics. */
export function localizeApiError(error:any,lang:'al'|'en'='al') {
  if(lang==='en'||!error||typeof error!=='object')return error;
  const response=error.response,data=response?.data;
  const original=typeof data?.message==='string'?data.message:typeof data?.error_txt==='string'?data.error_txt:error.message;
  const fallback=response?.status===403?'Nuk ke leje për këtë veprim.':response?.status===404?'Të dhënat e kërkuara nuk u gjetën.':response?.status>=500?'Serveri nuk e përfundoi kërkesën. Provo përsëri.':'Kërkesa nuk u përfundua. Provo përsëri.';
  const message=userError(original,fallback);
  const localized=Object.assign(Object.create(Object.getPrototypeOf(error)),error,{message,serverMessage:original,serverResponse:response});
  if(data&&typeof data==='object'&&!Array.isArray(data))localized.response={...response,data:{...data,message,...(typeof data.error_txt==='string'?{error_txt:message}:{})}};
  return localized;
}
