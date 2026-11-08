/** Sportsbook websocket subscription policy; never connect on casino/login. */
export function shouldConnectSportsFeed(pathname:string|null|undefined,isAuthenticated:boolean):boolean;
