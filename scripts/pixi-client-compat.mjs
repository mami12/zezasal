/** Keep the archived Pixi clients within a bounded backing-canvas workload. */
export function pixiRenderPixelRatio(width, height, nativeRatio, touch, requestedRatio) {
  var cssWidth = Number(width), cssHeight = Number(height);
  var native = Number(nativeRatio), requested = Number(requestedRatio);
  if (!isFinite(cssWidth) || cssWidth <= 0) cssWidth = 1;
  if (!isFinite(cssHeight) || cssHeight <= 0) cssHeight = 1;
  if (!isFinite(native) || native <= 0) native = 1;
  var budget = touch ? 1280 * 720 : 1920 * 1080;
  var maximum = Math.min(native, touch ? 1.5 : native,
    Math.sqrt(budget / (cssWidth * cssHeight)));
  var minimum = Math.min(1, maximum);
  if (!isFinite(requested) || requested <= 0) requested = maximum;
  return Math.max(minimum, Math.min(maximum, requested));
}

const marker = '/* faqja-pixi-render-budget-v1 */';

// Read dimensions inside the game iframe, including the shell's landscape size.
// The browser's devicePixelRatio and the original design geometry stay intact.
export const pixiRenderRatioRuntimeSource = `${marker}
function __faqjaPixiRenderRatio(requestedRatio) {
  var root = document.documentElement;
  var width = Math.min(window.innerWidth, root.clientWidth) || window.innerWidth || 1;
  var height = Math.min(window.innerHeight, root.clientHeight) || window.innerHeight || 1;
  var touch = "ontouchstart" in window ||
    !!(window.navigator && window.navigator.maxTouchPoints > 0) ||
    !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  return (${pixiRenderPixelRatio.toString()})(width, height,
    window.devicePixelRatio, touch, requestedRatio);
}
`;

const resizeOriginal = 'var n=e||c2d.env.screenParams.pixelRatio||window.devicePixelRatio,i=document.querySelector(".canvas-box")';
const resizeBounded = 'var n=__faqjaPixiRenderRatio(e||c2d.env.screenParams.pixelRatio),i=document.querySelector(".canvas-box")';
const adaptiveOriginal = 'var e=c2d.env.screenParams.pixelRatio,t=window.devicePixelRatio,n=Math.max(window.devicePixelRatio/2,1),i=this.handleCanvasSize';
const adaptiveBounded = 'var e=c2d.env.screenParams.pixelRatio,t=__faqjaPixiRenderRatio(),n=Math.min(1,t),i=this.handleCanvasSize';

function replaceExactlyOnce(source, needle, replacement, label) {
  if (source.split(needle).length !== 2) {
    throw new Error('Unsupported pinned Pixi client: expected exactly one ' + label);
  }
  return source.replace(needle, replacement);
}

/** Applied after copying the pinned c2d bundle; mismatches must fail the build. */
export function applyPixiClientCompat(source) {
  if (typeof source !== 'string') throw new TypeError('Pixi client source must be a string');
  if (source.includes(marker)) throw new Error('Pixi client compatibility patch already applied');
  var patched = replaceExactlyOnce(source, resizeOriginal, resizeBounded, 'canvas resize handler');
  patched = replaceExactlyOnce(patched, adaptiveOriginal, adaptiveBounded, 'adaptive pixel-ratio bounds');
  return pixiRenderRatioRuntimeSource + patched;
}
