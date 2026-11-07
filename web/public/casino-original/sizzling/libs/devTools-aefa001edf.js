
window.devTools = {};

window.devTools.updateFavicon = function () {
};

var whichMap = {
  48: 0.1,
  49: 1,
  50: 2,
  51: 3,
  52: 4,
  53: 5,
  54: 6,
  55: 7,
  56: 8,
  57: 9,
};

document.addEventListener('keydown', function (e) {

  if (!e.altKey) return;

  var max                = 10;
  var min                = 0.1;
  var slowStep           = 0.1;
  var fastStep           = 1;
  var fastSlowBreakpoint = 1;

  var keyId    = +e.key;
  var whichKey = whichMap[e.which];

  if (e.key === 'ArrowUp' && c2d.timescale < max) {
    c2d.timescale += (c2d.timescale >= fastSlowBreakpoint) ? fastStep : slowStep;
    c2d.timescale = Math.round(c2d.timescale * 10) / 10;
  } else if (e.key === 'ArrowDown' && c2d.timescale > min) {
    c2d.timescale -= (c2d.timescale > fastSlowBreakpoint) ? fastStep : slowStep;
    c2d.timescale = Math.round(c2d.timescale * 10) / 10;
  } else if (keyId > 0 && keyId < 11) {
    c2d.timescale = keyId;
  } else if (whichKey) {
    c2d.timescale = whichKey;
  }
});
