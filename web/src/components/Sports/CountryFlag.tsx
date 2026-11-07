import {useState} from 'react';
import {Globe2} from 'lucide-react';
import {countryFlagFile} from '../../utils/countryFlags.mjs';
import { repairDisplayText } from '../../utils/repairDisplayText';

/** Fixed-size local flags do not shift labels or depend on an external host. */
export default function CountryFlag({country,countryCode,size=16}:{country?:string|null;countryCode?:string|null;size?:number}){
 const file=countryFlagFile(country,countryCode);
 const src=file?`${import.meta.env.BASE_URL}country-flags/${file}`:null;
 const [failed,setFailed]=useState<string|null>(null);
 const label=repairDisplayText(country?.trim()||countryCode?.trim()||'International');
 if(!src||failed===src)return <span role="img" aria-label={label} title={label} data-country-flag="fallback" className="inline-flex shrink-0 items-center justify-center text-slate-400" style={{width:size,height:size}}><Globe2 size={size} aria-hidden="true"/></span>;
 return <img data-country-flag={file} src={src} alt={label} title={label} width={size} height={size} loading="lazy" decoding="async" className="inline-block shrink-0 rounded-full object-contain" onError={()=>setFailed(src)}/>;
}
