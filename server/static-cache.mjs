/** Cache immutable build files and reusable media; always reload game boot code. */
export function staticCacheHeaders(res,file) {
  const path=String(file).replaceAll('\\','/');
  if (/\/assets\/[^/]+-[\w-]{8,}\.(?:js|css)$/.test(path) && !path.includes('/casino-original/')) {
    res.setHeader('Cache-Control','public, max-age=31536000, immutable');
  } else if (/\.(?:png|jpe?g|webp|avif|gif|svg|ogg|mp3|m4a|wav|webm|mp4|woff2?|ttf|atlas)$/i.test(path)) {
    res.setHeader('Cache-Control','public, max-age=3600');
  } else {
    res.setHeader('Cache-Control','no-cache, max-age=0, must-revalidate');
    if (/\.(?:html|js|json)$/i.test(path)) res.setHeader('Cache-Control','no-store, max-age=0');
  }
}
