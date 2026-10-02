/*
 * Kestrel - water looks (US-055a2c (b); docs/architecture.md 32.2 look table, 35.3 composite, 35.4 flow).
 * Owner: Designer. Format: design/README.md section "Water looks". Consumer: engine/render/waterLook.js
 * (`packWaterLook` / `resolveWaterLooks`), bound once at load, never per frame.
 *
 * LOADING (classic script, no dependency; game/index.html right after palette.js / detail-pass.js):
 *   <script src="../design/water-looks.js"></script>
 *   main.js: gpuPipeline.setWaterLooks(window.ASSETS.waterLooks);
 *            fb.waterLooks = resolveWaterLooks(window.ASSETS.waterLooks);   // JS twin, same table
 *
 * WHAT THIS FILE SETS
 *   ASSETS.waterLooks.<name>   one look per name a level water region uses (`look: 'pond'`; no `look` = 'water').
 *                              Unknown names fall back to the engine default (DEFAULT_WATER_LOOK).
 *   Fields read by the engine NOW (055a2b packer; each one is merged over the engine default):
 *     ramp        1..8 glyphs, ASCII 33..126 (no space). Hash-picked per 0.5 m cell, so a repeated glyph = more weight.
 *     shallow     [r,g,b] 0..255, colour where the water path is thin (a -> 0).
 *     deep        [r,g,b] 0..255, colour at a = 1 (path >= opaqueAt).
 *     opaqueAt    metres of water path at which the water is opaque (> 0). Small = murky.
 *     seeThrough  0..1: below this alpha the FLOOR glyph stays, tinted toward the water colour.
 *     glint       [r,g,b] 0..255, sun sparkle (mixed 50 % into fg).
 *     waveHz      >= 0, glyph re-roll rate (0 = frozen ripples).
 *     bgK         0..1, bg = water rgb * bgK (lower = more glyph contrast).
 *   Fields for LATER stories (35.3 waves / 143b2 foam / 141a flow). The 055a2b packer ignores them (it only copies the
 *   keys above), so they are safe now and ready when those stories read them; names follow 35.3 / 35.4 exactly:
 *     bands, glintCos, foamRamp, foamDepth, crestK, foamFar, streak, streakLen, streakW, streakK.
 *
 * COLOUR RULES (style-guide 1 + "Water" section)
 *   - Water is a muted BLUE-GREEN (sea glass -> dark slate), lit by the sun term. Never `mana` (saturated cold blue,
 *     #4c84f2: the MP bar only), never `woad` (grey-violet cloth), never `aether` teal (#2fe0c6: magic only).
 *     The test: green ~= blue in every water colour, and saturation stays well under aether's.
 *   - Colours are RGB (the engine look takes RGB, not palette keys); no palette keys were added.
 *   - Read at 240x90: the opaque body is mostly `~` with `-` / `=` breakers; the shallow rim shows the floor through.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  A.waterLooks = {
    // The default look: lakes, the flooded court, any region without a `look`. Clear-ish blue-green, slow swell.
    water: {
      ramp: '~~-~=~-',            // ~ dominant (4/7), - breakers, rare = crest
      shallow: [92, 150, 158],    // #5c969e sea glass
      deep: [22, 54, 80],         // #163650 dark slate blue-green (darker + greener than woadDark #262f52)
      opaqueAt: 1.5, seeThrough: 0.35,
      glint: [228, 240, 238],     // warm-neutral white (not aetherCore #e6fff9)
      waveHz: 1.5, bgK: 0.5,
      // later (35.3 / 143b2 / 141a):
      bands: '-~=~', glintCos: 0.985, foamRamp: '*o.', foamDepth: 0.3, crestK: 0.6, foamFar: 40,
      streak: '-', streakLen: 1.0, streakW: 0.35, streakK: 0.7,
    },
    // Small still ponds: greener, shallower-looking, slow; lets the bed show through a bit longer.
    pond: {
      ramp: '~-~.~-',
      shallow: [98, 142, 116],    // #628e74 reed green
      deep: [26, 58, 48],         // #1a3a30 deep pond green
      opaqueAt: 1.0, seeThrough: 0.4,
      glint: [222, 236, 214],
      waveHz: 0.8, bgK: 0.5,
      bands: '-~.~', glintCos: 0.99, foamRamp: 'o.,', foamDepth: 0.25, crestK: 0.7, foamFar: 30,
      streak: '-', streakLen: 0.8, streakW: 0.3, streakK: 0.8,
    },
    // Flooded cellars / bog: brown-green, opaque within half a metre, barely moves.
    murky: {
      ramp: '~-,~-',
      shallow: [112, 112, 76],    // #70704c silt
      deep: [40, 42, 28],         // #282a1c bog
      opaqueAt: 0.5, seeThrough: 0.5,
      glint: [204, 202, 170],     // dull, never white
      waveHz: 0.5, bgK: 0.55,
      bands: '-~,', glintCos: 0.995, foamRamp: 'o,.', foamDepth: 0.2, crestK: 0.8, foamFar: 25,
      streak: '-', streakLen: 0.8, streakW: 0.4, streakK: 0.85,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
