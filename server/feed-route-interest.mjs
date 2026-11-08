/** Only pages actively using the sports board need a large live-odds socket.
 * Authentication and a route transition control the subscription lifecycle.
 * Casino and login remain independent of sportsbook feed traffic.
 */
export function shouldConnectSportsFeed(pathname,isAuthenticated){
 if(isAuthenticated!==true)return false;
 const route=String(pathname??'').replace(/\/+$/,'')||'/';
 return route==='/'||/^\/(?:match\/\d+|my-bets|admin|manager|agent)$/.test(route);
}
