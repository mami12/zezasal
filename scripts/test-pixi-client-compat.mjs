import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyPixiClientCompat, pixiRenderPixelRatio,
  pixiRenderRatioRuntimeSource } from './pixi-client-compat.mjs';

const games = [
  ['Sizzling Hot', '../web/public/casino-original/sizzling/scripts/c2d-3c891074da.js'],
  ['Book of Ra', '../web/public/casino-original/bookofra/scripts/c2d-6242421041.js'],
];
const sizes = [
  { name: 'phone portrait', width: 390, height: 844, touch: true },
  { name: 'phone landscape', width: 844, height: 390, touch: true },
  { name: 'tablet', width: 1280, height: 800, touch: true },
  { name: 'desktop', width: 1920, height: 1080, touch: false },
  { name: 'small desktop', width: 960, height: 540, touch: false },
  { name: 'large desktop', width: 3840, height: 2160, touch: false },
];
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `${label}: ${actual} != ${expected}`);

function withoutCompat(source) {
  return source.slice(pixiRenderRatioRuntimeSource.length)
    .replace('var n=__faqjaPixiRenderRatio(e||c2d.env.screenParams.pixelRatio)',
      'var n=e||c2d.env.screenParams.pixelRatio||window.devicePixelRatio')
    .replace('t=__faqjaPixiRenderRatio(),n=Math.min(1,t)',
      't=window.devicePixelRatio,n=Math.max(window.devicePixelRatio/2,1)');
}
function originalSource(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  if (!source.startsWith(pixiRenderRatioRuntimeSource)) return source;
  const original = withoutCompat(source);
  assert.equal(applyPixiClientCompat(original), source, 'Current synchronized client matches compatibility patch');
  return original;
}

// Run the actual pinned resize/adaptive methods, rather than a second copy of
// their behavior. Other parts of the original client need no DOM/GPU in this test.
function methods(source) {
  const resizeMarker = '{key:"handleCanvasSize",value:';
  const resizeAt = source.indexOf(resizeMarker);
  assert.ok(resizeAt > 0, 'Original canvas resize method is present');
  const updateAt = source.lastIndexOf('{key:"update",value:', resizeAt);
  const end = source.indexOf('},{key:"fps",get:', resizeAt);
  assert.ok(updateAt > 0 && end > resizeAt, 'Original adaptive resize methods are present');
  return {
    update: source.slice(updateAt + '{key:"update",value:'.length, resizeAt - 2),
    resize: source.slice(resizeAt + resizeMarker.length, end),
  };
}

function harness(source, size, nativeRatio) {
  const canvas = {};
  for (const dimension of ['width', 'height']) {
    let value = 0;
    Object.defineProperty(canvas, dimension, {
      get: () => value,
      set: (next) => { value = Math.floor(next); },
    });
  }
  const box = { style: {} }, events = [];
  const window = { innerWidth: size.width, innerHeight: size.height,
    devicePixelRatio: nativeRatio, navigator: { maxTouchPoints: size.touch ? 5 : 0 },
    matchMedia: () => ({ matches: size.touch }) };
  const document = {
    documentElement: { clientWidth: size.width, clientHeight: size.height },
    querySelector: (selector) => { assert.equal(selector, '.canvas-box'); return box; },
    getElementById: (id) => { assert.equal(id, 'slotCanvas'); return canvas; },
    dispatchEvent: (event) => events.push(event),
  };
  canvas.parentElement = {};
  canvas.getBoundingClientRect = () => ({ left: 17, top: 23,
    width: Math.min(window.innerWidth, document.documentElement.clientWidth),
    height: Math.min(window.innerHeight, document.documentElement.clientHeight) });
  const c2d = {
    designMinSize: { width: 1540, height: 1080 }, designSize: { width: 1920, height: 1080 },
    innerScale: 1, documentEvents: { SCREEN_WAS_RESIZED: 'resized' },
    env: { isDesktop: true, device: { ios: () => false }, screenParams: {} },
  };
  const sandbox = vm.createContext({ window, navigator: window.navigator, document, c2d,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  vm.runInContext(pixiRenderRatioRuntimeSource, sandbox);
  const extracted = methods(source);
  const resize = vm.runInContext('(' + extracted.resize + ')', sandbox);
  const update = vm.runInContext('(' + extracted.update + ')', sandbox);
  const state = {
    _renderer: { resize: () => {} },
    _gameViewport: { scale: { set(value) { this.value = value; } }, position: {} },
    _currentFilterStrength: 10, _MAX_FPS_FILTER_STRENGTH: 500,
    _ACCELERATION_FPS_FILTER: 1, _delayBeforeNextSwitch: 0,
    _MIN_BORDER: 19, _MAX_BORDER: 41, fps: 60,
  };
  let resizeCount = 0;
  state.handleCanvasSize = (ratio) => { resizeCount++; return resize.call(state, ratio); };
  return { canvas, box, events, window, document, c2d, state, update,
    resize: state.handleCanvasSize, resizeCount: () => resizeCount,
    runtimeRatio: (requested) => sandbox.__faqjaPixiRenderRatio(requested), sandbox };
}

const pixiSource = readFileSync(new URL(
  '../web/public/casino-original/sizzling/libs/pixi-e5441a5223.min.js', import.meta.url), 'utf8');
const mapMatch = pixiSource.match(/mapPositionToPoint=(function\(t,e,r\)\{[\s\S]*?\}),e\.prototype\.processInteractive=/);
assert.ok(mapMatch, 'Pinned Pixi pointer mapping method is present');
function checkPointerCoordinates(context) {
  const mapPositionToPoint = vm.runInContext('(' + mapMatch[1] + ')', context.sandbox);
  const viewport = context.state._gameViewport, params = context.c2d.env.screenParams;
  const rect = context.canvas.getBoundingClientRect();
  // The original controls use canvas pixels and the viewport transform. A
  // lower backing ratio must still map each visible button to that same point.
  for (const [x, y] of [[625, 1025], [784, 1025], [960, 1025], [1570, 1025]]) {
    const clientX = rect.left + (viewport.position.x + x * params.canvasScaleCoef) / params.pixelRatio;
    const clientY = rect.top + (viewport.position.y + y * params.canvasScaleCoef) / params.pixelRatio;
    const mapped = {};
    mapPositionToPoint.call({ interactionDOMElement: context.canvas, resolution: 1 },
      mapped, clientX, clientY);
    const actualX = (mapped.x - viewport.position.x) / params.canvasScaleCoef;
    const actualY = (mapped.y - viewport.position.y) / params.canvasScaleCoef;
    // Canvas integer rounding is below3 original HD pixels, much smaller than
    // a button; never a displaced hit target at a different design coordinate.
    assert.ok(Math.abs(actualX - x) < 3 && Math.abs(actualY - y) < 3,
      `Original button pointer coordinates remain aligned: ${x},${y} -> ${actualX},${actualY}`);
  }
}

let cases = 0;
for (const [game, file] of games) {
  const original = originalSource(file);
  const patched = applyPixiClientCompat(original);
  assert.throws(() => applyPixiClientCompat(patched), /already applied/);
  assert.throws(() => applyPixiClientCompat(original.replace(
    'var n=e||c2d.env.screenParams.pixelRatio||window.devicePixelRatio', 'var n=changed')),
  /expected exactly one canvas resize handler/);
  assert.throws(() => applyPixiClientCompat(original + original), /expected exactly one/);
  assert.throws(() => applyPixiClientCompat(original.replace(
    'n=Math.max(window.devicePixelRatio/2,1)', 'n=changed')),
  /expected exactly one adaptive pixel-ratio bounds/);

  // Only sizing/bounds change: original animation, input, audio and game code
  // after reversing these two guarded substitutions must match byte for byte.
  assert.equal(withoutCompat(patched), original);

  for (const size of sizes) for (const nativeRatio of [1, 2, 3]) {
    const context = harness(patched, size, nativeRatio);
    const expected = pixiRenderPixelRatio(size.width, size.height, nativeRatio, size.touch);
    const budget = size.touch ? 1280 * 720 : 1920 * 1080;
    near(context.runtimeRatio(), expected, `${game} ${size.name} runtime ratio`);
    context.resize();
    near(context.c2d.env.screenParams.pixelRatio, expected, 'Initial recorded pixel ratio');
    assert.ok(context.canvas.width * context.canvas.height <= budget, 'Backing-pixel budget');
    assert.ok(expected <= nativeRatio && (!size.touch || expected <= 1.5), 'Native/touch cap');
    assert.equal(context.window.devicePixelRatio, nativeRatio, 'Browser DPR is untouched');
    near(context.state._gameViewport.scale.value,
      context.c2d.env.screenParams.canvasScaleCoef, 'Geometry and canvas share one scale');
    checkPointerCoordinates(context);

    // Adaptive down/up requests may overshoot by 0.5; the resize method must
    // clamp them to the same floor and cap used at initialization.
    const minimum = Math.min(1, expected);
    context.state.fps = 10;
    for (let step = 0; step < 8; step++) {
      context.state._delayBeforeNextSwitch = 0;
      context.update.call(context.state);
    }
    near(context.c2d.env.screenParams.pixelRatio, minimum, 'Adaptive minimum');
    const floorCount = context.resizeCount();
    context.state._delayBeforeNextSwitch = 0;
    context.update.call(context.state);
    assert.equal(context.resizeCount(), floorCount, 'No repeated resizing at minimum');
    context.state.fps = 60;
    for (let step = 0; step < 8; step++) {
      context.state._delayBeforeNextSwitch = 0;
      context.update.call(context.state);
    }
    near(context.c2d.env.screenParams.pixelRatio, expected, 'Adaptive maximum');
    checkPointerCoordinates(context);
    const capCount = context.resizeCount();
    context.state._delayBeforeNextSwitch = 0;
    context.update.call(context.state);
    assert.equal(context.resizeCount(), capCount, 'No repeated resizing above maximum');
    context.resize(nativeRatio * 10);
    near(context.c2d.env.screenParams.pixelRatio, expected, 'Explicit high-ratio request is bounded');

    // Simulate an iframe resize while retaining the old screenParams value.
    context.window.innerWidth = context.document.documentElement.clientWidth = 1080;
    context.window.innerHeight = context.document.documentElement.clientHeight = 1920;
    context.resize();
    const resized = pixiRenderPixelRatio(1080, 1920, nativeRatio, size.touch, expected);
    near(context.c2d.env.screenParams.pixelRatio, resized, 'Viewport resize ratio');
    assert.ok(context.canvas.width * context.canvas.height <= budget, 'Resize backing-pixel budget');
    checkPointerCoordinates(context);
    cases++;
  }
  console.log('PASS ' + game + ': actual pinned resize and adaptive methods');
}

// Independent coarse-pointer and touch-event detection, plus an iframe whose
// document bounds are smaller than innerWidth/innerHeight.
const original = originalSource(games[0][1]);
const detection = harness(applyPixiClientCompat(original), sizes[4], 3);
detection.window.navigator.maxTouchPoints = 0;
detection.window.matchMedia = () => ({ matches: true });
near(detection.runtimeRatio(), pixiRenderPixelRatio(960, 540, 3, true), 'Coarse pointer cap');
detection.window.matchMedia = () => ({ matches: false });
detection.window.ontouchstart = null;
near(detection.runtimeRatio(), pixiRenderPixelRatio(960, 540, 3, true), 'Touch-event cap');
delete detection.window.ontouchstart;
detection.document.documentElement.clientWidth = 390;
detection.document.documentElement.clientHeight = 844;
near(detection.runtimeRatio(), pixiRenderPixelRatio(390, 540, 3, false), 'Inner document viewport bounds');
near(pixiRenderPixelRatio(0, NaN, 0, true, Infinity), 1, 'Invalid dimensions/DPR fallback');
assert.throws(() => applyPixiClientCompat(null), /must be a string/);
console.log(`PASS ${cases} DPR/viewport cases, resize budgets, adaptive bounds, original Pixi pointer mapping and strict patch guards`);
