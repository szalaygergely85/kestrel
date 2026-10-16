// US-142a2: placeable content numbers; existing palette colours, no new materials.
(function (root) {
  const A = root.ASSETS = root.ASSETS || {};
  const base = { burst: 0, dir: [0, 0, 1], wind: 0, emissive: false, emissiveFog: 0, killBelow: null };
  A.waterfall = {
    preset: { id: 'waterfall', lip: [6, 7, 12, 7], z: 8, out: 1.5, outDeg: 180, drop: 8, look: 'waterfall' },
    // OB-045: white water (TEASER-QA-03: blue-white: the near-white sheet over brown rock read beige). The sheet colour is the look's `shallow` (was the engine default sea-glass blue -> a dark slate wall).
    look: { fallRamp: "|:'", fallSpeed: 10, highlight: [250, 252, 255], sheetAlpha: 0.75,
            shallow: [214, 232, 244], deep: [150, 182, 198], bgK: 0.85 }, // bgK high: thin fall glyphs, the bg carries the white
    // View z is feet height; the normal game camera adds standing eye height.
    views: {
      front: { x: 9, y: 23, z: 0.15, yawDeg: 0, pitchDeg: 7 },
      back: { x: 9, y: 5.5, z: 0.15, yawDeg: 180, pitchDeg: 0 },
    },
    ripple: { periodTicks: 42, lifeTicks: 90, points: 32, startRadius: 0.18, speed: 1.6, height: 0.025 },
    presets: {
      waterfallLip: { ...base, rate: 12, life: [0.35, 0.65], speed: [0.3, 0.6], spreadDeg: 40,
        box: [0, 0, 0.03], accelZ: -2, drag: 0.6, maxLive: 12, glyphs: ":'.", colors: ['riverLight', 'skyHorizon', 'river'], sizeM: 0.06 },
      waterfallSpray: { ...base, rate: 48, life: [0.45, 0.9], speed: [1.5, 2.8], spreadDeg: 65,
        box: [0.65, 0.3, 0.04], accelZ: -4.9, drag: 0.5, maxLive: 48, glyphs: "*+:'.", colors: ['white', 'riverLight', 'skyHorizon', 'riverLight', 'river'], sizeM: 0.07, bgMix: 0.35 },
      // OB-045: a pale mist bank over the plunge pool (was 1 m wide, 0.12 m dots in river/ironDark: invisible in front of the sheet).
      waterfallMist: { ...base, rate: 16, life: [1.2, 2], speed: [0.4, 1.0], spreadDeg: 80,
        box: [2.5, 1.5, 0.2], accelZ: 0.18, drag: 0.8, maxLive: 32, glyphs: '*+:', colors: ['white', 'skyHorizon', 'cloudLit'], sizeM: 0.5, sizeEndM: 1.4, bgMix: 0.45 },
      waterfallRipple: { ...base, rate: 0, life: [1.5, 1.5], speed: [0, 0], spreadDeg: 0,
        box: [0, 0, 0], accelZ: 0, drag: 0, maxLive: 96, glyphs: "o:'.", colors: ['white', 'riverLight', 'river', 'ironDark'], sizeM: 0.06 },
    },
    toEmitterDef(key, rgb) {
      const p = this.presets[key];
      if (!p) throw new Error(`Unknown waterfall emitter ${key}`);
      return { ...p, colors: p.colors.map((k) => {
        if (!rgb[k]) throw new Error(`Waterfall ${key}: missing colour ${k}`);
        return rgb[k];
      }) };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
