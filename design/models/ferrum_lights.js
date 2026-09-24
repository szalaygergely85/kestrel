/*
 * Kestrel - US-016 D-011 addendum: FERRUM'S LIGHTS on the far eastern horizon (behind the player at the breach).
 * Format: design/README.md section 4 (sprite model) + section 4.3 (horizon billboard). Sets ASSETS.models.ferrumLights.
 *
 * Ferrum, the walled machine city Wick escaped from, is ~9 km east, beyond the terrain far limit. It is NOT terrain and NOT a
 * point light: it is a horizon billboard placed by angle (world_m1.js entity `ferrumLights`, type 'horizon', bearing +
 * elevation + angular size), drawn only over sky cells (never over structure or terrain), after the terrain pass.
 * Look: a low band of warm amber emissive pinpoints ( . ' * ) over a faint wall-and-tiers silhouette. Bottom row = the Wall
 * (crenels, a few dim wall lamps), then the Low Wards roofs (n), the upper tier halls ([ ]), and the Crown on top: spires ^,
 * the skyworks mast | and the hottest lamps * ("the lamps that never gutter", story.md 1). Lights get denser and hotter
 * toward the top: the Crown is where the light is.
 * Colours: silhouette `ferrumSil` (unlit; the entity's fixed fog 0.55 turns it into a pale blue-grey hint on the horizon);
 * lights `cityLightDim` / `cityLight` / `cityLightHot` (palette.colorRamps.cityLight), emissive, fog capped per key.
 *
 * Tiers (angular size is fixed by the entity; the engine picks the tier by projected rows, same rule as README 4):
 *   full 36x4 = base (designed for 240x90: ~36 x 4 cells for 13.2 x 2.2 deg; nearest-upsampled at 320x120)
 *   half 18x2 = lods.half (160x60: scale < 0.75)
 * Static in M1 (no twinkle): D-011 says waking the relay changes neither the signal tower nor Ferrum.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // glyph rows (top = the Crown). Every row is exactly the model width; the preview checks it.
  var FULL = [
    "              ' ^ *|*  ^ '          ",
    "          _.-=[*]=-'=[#*]=-.'-_     ",
    "    _.=n'n=.=n*n=':'=n.n=*=n'n=._   ",
    "_=:=_=_=.=_=_=:=_=_=.=_=_=:=_=_=.=_="
  ];
  var HALF = [
    "       '^*|*^'    ",
    "_=.=n'n=*=n.n=:=_="
  ];
  // light glyph -> key by row band (lights hotter toward the top); every other glyph = silhouette 's'
  var FULL_LIGHT = [
    { "'": 'l', '*': 'h', '.': 'l' },      // Crown
    { "'": 'l', '*': 'h', '.': 'l' },      // upper tier
    { "'": 'd', '*': 'l', '.': 'd' },      // Low Wards
    { "'": 'd', '*': 'd', '.': 'd' }       // the Wall
  ];
  var HALF_LIGHT = [
    { "'": 'l', '*': 'h', '.': 'l' },
    { "'": 'l', '*': 'l', '.': 'd' }
  ];
  function paint(rows, map) {
    return rows.map(function (r, y) {
      return r.replace(/[^ ]/g, function (ch) { return map[y][ch] || 's'; });
    });
  }

  A.models.ferrumLights = {
    name: 'ferrumLights',
    displayName: 'Ferrum',
    desc: 'Ferrum on the eastern horizon: warm amber pinpoints over a faint wall-and-tiers silhouette, the Crown lamps brightest on top.',
    size: { w: 36, h: 4 }, anchor: { x: 18, y: 3 },   // anchor = bottom-centre cell; sits at (bearingDeg, elevDeg) of the entity
    directions: ['S'], billboard: true, horizon: true,
    keys: {
      s: { c: 'ferrumSil' },                              // silhouette: unlit (light = 1), takes the entity's fixed fog
      d: { c: 'cityLightDim', e: true, fogMax: 0.25 },    // Wall + Low Wards lamps
      l: { c: 'cityLight',    e: true, fogMax: 0.25 },    // upper tier windows
      h: { c: 'cityLightHot', e: true, fogMax: 0.20 }     // the Crown's lamps
    },
    animations: {
      idle: { fps: 0, loop: true, frames: [{ S: { glyphs: FULL, fg: paint(FULL, FULL_LIGHT) } }] }
    },
    lods: {
      half: { size: { w: 18, h: 2 }, anchor: { x: 9, y: 1 }, animations: {
        idle: { fps: 0, loop: true, frames: [{ S: { glyphs: HALF, fg: paint(HALF, HALF_LIGHT) } }] }
      } }
    },
    unlit: true,
    lightGlyphs: ". ' *",                                 // the only glyphs that carry light keys (checked)
    tiers: { 0: 'the Crown (spires ^, skyworks mast |, hottest lamps *)', 1: 'upper tier halls [ ]', 2: 'Low Wards roofs n', 3: 'the Wall (crenels = _, wall lamps .)' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
