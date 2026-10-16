// NIGHT-HAZE-01: far overworld fog colours for dusk and night (day = palette fogFarNear/fogFar, unchanged).
// Plain data; engine/render/fogHour.js blends day/dusk/night with the same schedule rule as blendLook (the sky).
// Night far ~ skyNightHorizon (#1f2c4a) slightly darker, so the horizon band never outshines the starry sky.
(function (root) {
  'use strict';
  var FOG_HOUR = {
    dusk:  { near: '#7a6a7c', far: '#d89870' },
    dawn:  { near: '#8a7080', far: '#e8a888' },
    night: { near: '#0d1426', far: '#1b2742' },
  };
  root.FOG_HOUR = FOG_HOUR;
  if (typeof module !== 'undefined' && module.exports) module.exports = FOG_HOUR;
})(typeof window !== 'undefined' ? window : globalThis);
