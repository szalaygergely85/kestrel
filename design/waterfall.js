// US-142a2: placeable content numbers; existing palette colours, no new materials.
(function (root) {
  const A = root.ASSETS = root.ASSETS || {};
  const base = { burst: 0, dir: [0, 0, 1], wind: 0, emissive: false, emissiveFog: 0, killBelow: null };
  A.waterfall = {
    preset: { id: 'waterfall', lip: [6, 7, 12, 7], z: 8, out: 1.5, outDeg: 180, drop: 8, look: 'waterfall' },
    look: { fallRamp: "|:'", fallSpeed: 10, highlight: [196, 220, 239], sheetAlpha: 0.75 },
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
        box: [0.65, 0.3, 0.04], accelZ: -4.9, drag: 0.5, maxLive: 48, glyphs: "*+:'.", colors: ['white', 'riverLight', 'skyHorizon', 'riverLight', 'river'], sizeM: 0.07 },
      waterfallMist: { ...base, rate: 16, life: [1.2, 2], speed: [0.15, 0.4], spreadDeg: 65,
        box: [1.2, 0.5, 0.08], accelZ: 0.18, drag: 0.8, maxLive: 32, glyphs: ":'.", colors: ['riverLight', 'river', 'ironDark'], sizeM: 0.12 },
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
