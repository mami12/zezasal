// Preserve the supplied renderer, timelines, UI entities, fonts and audio as a unit.
import {readFile,writeFile,mkdir,cp,access,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url)),version='9.4.1-fortuneteller.238';
const source=join(root,'fortuntelle/cdn.playngonetwork.com',version),dest=join(root,'web/public/casino-original/fortune-teller/provider-original',version);
try{await access(source);}catch{await import('./verify-fortune-teller-assets.mjs');console.log('Fortune Teller native client uses its verified packaged assets');process.exit(0);}
await mkdir(dest,{recursive:true});await cp(source,dest,{recursive:true,force:true});
const bundle='games/fortuneteller/fortuneteller_desktop.bundle.js',original=await readFile(join(source,bundle),'utf8');
// The saved/beautified capture split these JavaScript operators. Restore syntax only.
let code=original.replace('(t = t || {}).random ? ? t.rng ? .() ? ?','(t = t || {}).random ?? t.rng?.() ??');
const marker='FTViewFactory: () => XB,';
if(!code.includes(marker))throw Error('Unsupported Fortune Teller native bundle');
code=code.replace(marker,marker+`
            walletRuntime: () => () => ({game:ab.instance,bet:Vd.findComponent(hp),round:Vd.findComponent(pb),packetHandler:Vd.findComponent(pv),bonus:()=>Vd.findComponent(tD),freespin:()=>Vd.findComponent(uO),
                onRoundEnd:fn=>ab.instance.dispatcher.addEventListener(lb.ROUNDEND,fn),
                onPacket:fn=>ab.instance.dispatcher.addEventListener(lv.SERVERPACKET,fn),
                onClientPacket:fn=>ab.instance.dispatcher.addEventListener(lv.CLIENTPACKET,fn),
                resize:()=>{fd.resizeHandler();fd.getInstance().getSceneManager().render(true);},
                help:()=>ab.instance.dispatcher.dispatch(new wf(wf.SHOW_PAYTABLE)),
                collect:()=>ab.instance.dispatcher.dispatch(new LS(LS.LOGIC_OUT,new aT(6,[]))) }),`);
new Script(code);await writeFile(join(dest,bundle),code);
// The capture contains WOFF. Its broken TTF fallback is unnecessary.
const font='resources/common/fonts/MAGDA.css',css=await readFile(join(dest,font),'utf8');
await writeFile(join(dest,font),css.replace(/,\s*url\('MAGDA\.ttf'\) format\('truetype'\)/,''));
const language='resources/lang/en_GB/locale.json',locale=JSON.parse(await readFile(join(dest,language),'utf8'));
locale.texts.IDS_TOTALBET='X LINE BET';await writeFile(join(dest,language),JSON.stringify(locale));
const sha=value=>createHash('sha256').update(value).digest('hex');
async function list(dir,prefix=''){
 const files=[];for(const entry of await readdir(dir,{withFileTypes:true}))if(entry.isDirectory())files.push(...await list(join(dir,entry.name),prefix+entry.name+'/'));else if(entry.isFile())files.push(prefix+entry.name);return files;
}
const files=[];for(const path of (await list(source)).sort())files.push({path,sourceSha256:sha(await readFile(join(source,path))),packagedSha256:sha(await readFile(join(dest,path)))});
await writeFile(join(dest,'provenance.json'),JSON.stringify({version,source:'User-supplied fortuntelle capture',bundle,sourceSha256:sha(original),packagedSha256:sha(code),files,changes:['Restore capture-damaged ?? and ?. operators','Expose existing wallet state, events and resize/redraw to the local adapter','Use the captured WOFF font without its absent TTF fallback','Label Tarot multipliers X LINE BET to match Slotopol awards'],originalRenderingAndControls:true},null,2)+'\n');
console.log('PASS complete original Fortune Teller renderer, animations, UI, fonts and sounds packaged');
await import('./verify-fortune-teller-assets.mjs');
