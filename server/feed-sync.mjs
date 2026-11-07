/** Live API state must never come from a browser/CDN cache. Static assets keep
 * their separate cache policy. These headers also override CDN default caching. */
export function freshFeed(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  next();
}

/** The browser consumes facts from matches:live, not a second full odds catalog.
 * Market prices arrive through REST + odds:update; retain the real market count. */
export const liveBoardFacts = (matches) => matches.map(({ markets: _markets, ...facts }) => facts);

export function freshSocketHeaders(headers) {
  headers['Cache-Control'] = 'no-store, max-age=0';
  headers['CDN-Cache-Control'] = 'no-store';
  headers['Cloudflare-CDN-Cache-Control'] = 'no-store';
}
