/** Isolated regressions for the user's protected requirements; never live accounts. */
import {spawn} from 'node:child_process';
const core=[
 'test-football-competitions','test-all-real-football','test-match-visibility','test-board-settings','test-board-settings-api','test-match-pages',
 'test-admin-market-hiding','test-market-visibility-socket','test-display-copy','test-sportsbook-labels',
 'test-new-original-games','test-manager-casino-settings','test-zizo-board-demand','test-board-speed','test-custom-casino-math','test-casino-rtp-extended','test-casino-profile-admin','test-original-wallet-profiles',
 'test-stats-rotation','test-info-statistics','test-protected-finance','test-protected-event-minutes',
 'test-provider-timeline-retention','test-match-sync','test-protected-ticket-quote','test-user-removal',
 'test-settlement-results','test-statistic-markets'
];
const browsers=['test-new-original-games-browser','test-manager-casino-browser','test-board-markets-browser','test-market-exposure-browser','test-match-sync-browser','test-language-browser','test-user-directory-browser','test-ticket-payout-presentation','test-fortune-teller-layout'];
const names=process.argv.includes('--browser')?browsers:process.argv.includes('--simulation')?['test-casino-protected-simulation']:core;
for(const name of names){
 console.log('\nChecking '+name);
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/'+name+'.mjs'],{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('close',resolve);});
 if(code!==0)process.exit(code??1);
}
console.log('\nPASS protected requirements '+(process.argv.includes('--browser')?'browser':process.argv.includes('--simulation')?'simulation':'core')+' suite');
