/** Keep the adapter before provider scripts, including assembler-backed heads. */
export function originalClientShell(html,base,settings={}){
 const opening=/<head\b[^>]*>/i;
 if(!opening.test(html))throw new Error('Original game has no HTML head');
 const head=`<base href="${base}"><script>window.casinoWalletConfig=${JSON.stringify(settings).replaceAll('<','\\u003c')};</script><script src="/app/casino-original/wallet-bridge.js"></script>`;
 return html.replace(opening,tag=>tag+head);
}
