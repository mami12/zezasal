/** Read-only verification of continuous VPS operation; never creates users or wagers. */
const base=process.env.LOCAL_URL||'http://localhost:3000';
for(let pass=0;pass<2;pass++){
 const response=await fetch(new URL('/health',base),{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Health endpoint did not respond successfully.');
 const state=await response.json();
 if(state.feedMode!=='live'||state.idle?.enabled!==false||state.collector?.paused===true||state.pusher?.paused===true)throw Error('Server is not running in always-on mode.');
 console.log('PASS feed live, automatic sleep disabled, collector and pusher not paused');
 if(!pass)await new Promise(resolve=>setTimeout(resolve,5000));
}
