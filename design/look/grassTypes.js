// GRASS-VARIETY-01 (owner 2026-10-17: "2-3 different type of grass"): the grass carpet TYPES of the open meadows. Plain script (like biomeLook.js):
// sets globalThis.GRASS_TYPES; design/levels/overworld_far.js spreads `types` into recipe.carpet.variants over the same hand-placed meadow areas.
// The engine (engine/world/carpet.js, inPatch) picks one type per 2 m class cell from world-space value noise: a type owns the noise band
// [patch.lo, patch.hi) of ONE shared field (scaleM = patch size in metres, same salt for all), so the bands are disjoint and neighbouring patches
// differ. Measured over a 200 m square: ~30 % clover, ~40 % meadow, ~30 % seed-head (tests: engine/world/grassTypes.test.js).
// Per type: heightM, density, bladeW, glyphs {base, mid, tip, leanL, leanR}, ramp = palette keys base -> mid -> tip (palette.js bladeSeed*, bladeClover*).
(function () {
  var PATCH = { scaleM: 16, salt: 7919 };
  var types = [
    // low clover / trefoil tufts with small flowers: dense, wide leaves, hardly sways; tip glyph '*' = the flower heads (pale pink-white ramp tip)
    { name: 'clover', ground: ['grass', 'flowers'], density: 0.9, heightM: [0.05, 0.14], groundTint: 0.4, bladeW: 0.09, swayGain: 0.5, tuft: { p: 0.12, mul: 1.3 },
      ramp: ['bladeCloverBase', 'bladeClover', 'bladeCloverTip'], glyphs: { base: ',', mid: '"', tip: '*', leanL: '\\', leanR: '/' },
      patch: { scaleM: PATCH.scaleM, lo: 0, hi: 0.38, salt: PATCH.salt } },
    // short green meadow: the original type (unchanged look)
    { name: 'meadow', ground: ['grass', 'flowers'], density: 0.75, heightM: [0.15, 0.4], groundTint: 0.35, ramp: ['bladeMeadowBase', 'bladeMeadow', 'bladeMeadowTip'],
      patch: { scaleM: PATCH.scaleM, lo: 0.38, hi: 0.64, salt: PATCH.salt } },
    // tall seed-head grass: thin stems, pale seed spikes on top (tip '!'), sways more
    { name: 'seedgrass', ground: ['grass', 'flowers'], density: 0.6, heightM: [0.5, 0.95], groundTint: 0.3, bladeW: 0.045, swayGain: 1.3, tuft: { p: 0.08, mul: 1.4 },
      ramp: ['bladeSeedBase', 'bladeSeed', 'bladeSeedTip'], glyphs: { base: '|', mid: '|', tip: '!', leanL: '\\', leanR: '/' },
      patch: { scaleM: PATCH.scaleM, lo: 0.64, hi: 1.0001, salt: PATCH.salt } }
  ];
  (typeof globalThis !== 'undefined' ? globalThis : window).GRASS_TYPES = { version: 1, types: types };
})();
