// POST-STACK-01c (docs/architecture.md 38.73): post-effect look data. Plain data, numbers only; game/js/look/postConfig.js resolves it.
// A preset / scene only switches an effect ON or OFF; parameters live in `base` and are shared, so a preset never changes how an effect looks.
// Outdoor presets ship with mist OFF (the palette far fog already fogs terrain: mist on top would be double fog); owner may flip scenes.outdoor.mist.
// Colours are 0..1 rgb. Bloom is not listed here: it is the EMIS glow pass (GLOW_LEVELS), switched by the preset's `bloom` flag.
(function (root) {
  const POST_LOOK = {
  base: {
    grade: { lift: [0.01, 0.005, 0.0], gamma: [1.0, 1.0, 1.02], gain: [1.04, 1.0, 0.95], sat: 1.06 }, // gentle warm finish on top of the biome grade
    vignette: { k: 0.28, r0: 0.55, r1: 1.15, rgb: [0.02, 0.02, 0.03] },
    mist: { rgb: [0.55, 0.58, 0.64], density: 0.035, start: 4, heightK: 0 },
    // VISQA-11: mist underground (keepTerrain sites: crypt, cellar, caves, den). rgb = the level ambient (dark), set by postConfig.
    mistUnder: { density: 0.06, start: 3, heightK: 0 },
  },
  presets: {
    low:    { bloom: false, grade: false, vignette: true, mist: true },
    medium: { bloom: false, grade: true,  vignette: true, mist: true },
    high:   { bloom: true,  grade: true,  vignette: true, mist: true },
    ultra:  { bloom: true,  grade: true,  vignette: true, mist: true },
  },
  // scene flags AND-ed with the preset flags (a missing flag = on)
  scenes: {
    outdoor:  { mist: false },
    interior: { mist: true },
    underground: { mist: true }, // VISQA-11: buried keepTerrain level; mist = base.mistUnder in the level ambient colour, not the pale tower dust
    underwater: { mist: false }, // SCENE-INTERIOR-2: water tint/fog is the atmos job; no extra mist
  },
  };
  root.POST_LOOK = POST_LOOK;
  if (typeof module !== 'undefined' && module.exports) module.exports = POST_LOOK;
})(typeof window !== 'undefined' ? window : globalThis);
