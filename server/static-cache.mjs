/** Cache immutable build files and reusable media; always reload game boot code. */
export function staticCacheHeaders(res,file) {
  const path=String(file).replaceAll('\\','/');
  if (/\/assets\/[^/]+-[\w-]{8,}\.(?:js|css)$/.test(path) && !path.includes('/casino-original/')) {
    res.setHeader('Cache-Control','public, max-age=31536000, immutable');
  } else if (/\.(?:png|jpe?g|webp|avif|gif|svg|ogg|mp3|m4a|wav|webm|mp4|woff2?|ttf|atlas)$/i.test(path)) {
    res.setHeader('Cache-Control','public, max-age=3600');
  } else if (/\.(?:js|json)$/i.test(path)) {
    // Native casino script/manifest URLs are not content-hashed. Revalidate
    // every visit instead of caching stale code, but allow HTTP 304 ETags
    // so a repeat game launch does not download unchanged boot bundles.
    res.setHeader('Cache-Control','public, no-cache, max-age=0, must-revalidate');
  } else {
    // HTML shells always pick up the current deployed application.
    res.setHeader('Cache-Control',/\.html$/i.test(path)?'no-store, max-age=0':
      'no-cache, max-age=0, must-revalidate');
  }
}
