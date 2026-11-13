/**
 * Minimal secure-context compatibility for historical browser bundles.
 *
 * A local HTTP deployment may serve a previously built web/dist/index.html
 * and JS asset after a Git pull. In that bundle crypto.randomUUID() still
 * throws on a non-secure LAN origin. This is injected synchronously BEFORE
 * the existing app entrypoint, without rebuilding the immutable assets.
 *
 * Do not use Math.random for payment/idempotency identifiers.
 */
export const UUID_COMPAT_MARKER='data-uuid-compat="v2"';
export const UUID_COMPAT_SCRIPT=`<script ${UUID_COMPAT_MARKER}>
(function () {
  var cryptoApi=window.crypto;
  if (!cryptoApi || typeof cryptoApi.randomUUID === 'function' ||
      typeof cryptoApi.getRandomValues !== 'function') return;
  var generate=function () {
    var bytes=cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;
    bytes[8]=(bytes[8]&63)|128;
    var hex=Array.prototype.map.call(bytes,function (value) {
      return value.toString(16).padStart(2,'0');
    }).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  };
  try {
    Object.defineProperty(cryptoApi,'randomUUID',{
      configurable:true, writable:true, value:generate
    });
  } catch (error) {
    // Some WebViews do not allow defineProperty on native Crypto objects.
    try { cryptoApi.randomUUID=generate; } catch (_ignored) {}
  }
})();
</script>`;
/** Insert once, before any classic/module script, for both root and deep links. */
export function withBrowserUuidCompat(html){
 const input=String(html??'');
 if(input.includes(UUID_COMPAT_MARKER))return input;
 if(/<\/head\s*>/i.test(input))
  return input.replace(/<\/head\s*>/i,UUID_COMPAT_SCRIPT+'\n</head>');
 return UUID_COMPAT_SCRIPT+'\n'+input;
}
