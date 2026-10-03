/*
 * Kestrel - water looks (US-055a2c (b); docs/architecture.md 32.2 look table, 35.3 composite, 35.4 flow, 36.1 look fix).
 * Owner: Designer. Format: design/README.md section 10 "Water looks". Consumer: engine/render/waterLook.js
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
 *     ramp        1..8 glyphs, ASCII 33..126 (no space). Hash-picked per lattice cell, so a repeated glyph = more weight.
 *     shallow     [r,g,b] 0..255, colour where the water is thin (path a -> 0; after 36.1c: column depth -> 0).
 *     deep        [r,g,b] 0..255, colour at a = 1 (after 36.1c: column depth >= tintDepth).
 *     opaqueAt    metres of water path at which the water is opaque (> 0). Small = murky.
 *     seeThrough  0..1: below this alpha the FLOOR glyph stays, tinted toward the water colour.
 *     glint       [r,g,b] 0..255, sun sparkle (mixed 50 % into fg; after 36.1b fg ONLY, bg never glints).
 *     waveHz      >= 0, glyph re-roll rate (0 = frozen ripples; after 36.1b staggered per cell, not the whole sheet).
 *     bgK         0..1, bg = water rgb * bgK (lower = more glyph contrast).
 *   36.1 fields - ENGINE-PENDING (today's packer ignores them; names / defaults exactly as architecture.md 36.1):
 *     36.1b  cellM      > 0 m, lattice cell size of the rotated brick lattice (engine default 0.25; was a fixed 0.5).
 *     36.1b  glintP     0..1, probability a cell glints (engine default 0.04; was a fixed 0.1).
 *     36.1b  drift      m/s, the lattice slides this fast (engine default 0.12) -> ripples move instead of flickering.
 *     36.1c  tintDepth  > 0 m of WATER COLUMN (surface - bed under the cell) at which the colour reaches `deep`
 *                       (engine default 1.2). Gives the shore-light / middle-dark depth read.
 *     36.1c  shoreW     > 0 m, width of the shore band measured from the region edge (engine default 0.6).
 *     36.1c  rim        [r,g,b] 0..255, fg colour AT the edge of the shore band (engine default [200,220,215]);
 *                       mixed toward the water fg across the band.
 *     36.1c  foamRamp   1..3 glyphs, ASCII 33..126, edge -> inner order (index 0 = right at the edge). Live in 36.1c.
 *     36.1c  foamDepth  > 0 m: column depth below which the shore band also shows (shallow shelves). Live in 36.1c.
 *     36.1c  foamFar    > 0 m view distance beyond which the shore band is skipped. Live in 36.1c.
 *   Fields for LATER stories (35.3 waves / 143b2 crest foam / 141a flow already live): bands, glintCos, crestK
 *   (35.3 / 143b2, ignored today); streak, streakLen, streakW, streakK (141a, live).
 *
 * 36.1a LOOK NOTES (owner walk-test 2026-10-03: "pond doesn't look good", "mud is the same" = a flat teal sheet
 * with grey blocks, no shore, no depth):
 *   - The grey blocks are an ENGINE bug (glint mixed into bg + 0.5 m axis lattice), fixed by 36.1b, not by colours.
 *   - Flat sheet: shallow vs deep now differ by ~3x in value in every look (was ~2.5x and the path alpha saturated),
 *     so once 36.1c tints by column the shore reads light and the middle dark. bgK lowered a little for glyph contrast.
 *   - Each look has its own HUE FAMILY so they never read the same: water = sea-glass blue-green, pond = reed / algae
 *     green (green > blue), murky = brown silt (red > green > blue, nearly no blue). Murky is opaque fast, barely
 *     drifts and has a dark mud rim, not a white one.
 *
 * COLOUR RULES (style-guide 1 + "Water" section)
 *   - Water is muted (sea glass -> dark slate). Never `mana` (saturated cold blue, #4c84f2: the MP bar only), never
 *     `woad` (grey-violet cloth), never `aether` teal (#2fe0c6: magic only). Saturation stays well under aether's.
 *   - Colours are RGB (the engine look takes RGB, not palette keys); no palette keys were added.
 *   - Read at 240x90: the opaque body is mostly `~` with `-` / `=` breakers; the shallow rim shows the floor through,
 *     the shore band is a 1-3 cell line of foam / scum glyphs in the rim colour.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  A.waterLooks = {
    // The default look: lakes, the flooded court, any region without a `look`. Clear-ish blue-green, slow swell.
    water: {
      ramp: '~~-~=~-',            // ~ dominant (4/7), - breakers, rare = crest
      shallow: [108, 164, 164],   // #6ca4a4 sea glass (lighter: the shore must read light)
      deep: [18, 46, 70],         // #122e46 dark slate blue-green
      opaqueAt: 1.5, seeThrough: 0.35,
      glint: [228, 240, 238],     // warm-neutral white (not aetherCore #e6fff9)
      waveHz: 1.5, bgK: 0.45,
      // 36.1 (engine-pending, 36.1b / 36.1c):
      cellM: 0.25, glintP: 0.04, drift: 0.12, tintDepth: 1.2, shoreW: 0.6,
      rim: [200, 220, 215],       // #c8dcd7 pale froth
      foamRamp: '*o.', foamDepth: 0.3, foamFar: 40,
      // later (35.3 / 143b2) + 141a flow (live):
      bands: '-~=~', glintCos: 0.985, crestK: 0.6,
      streak: '-', streakLen: 1.0, streakW: 0.35, streakK: 0.7,
    },
    // Small still ponds: reed / algae green, shallow bowl, slow drift; scum + reed line at the shore.
    pond: {
      ramp: '~-~.~-',
      shallow: [122, 152, 100],   // #7a9864 sunlit reed / algae green over a shallow bed
      deep: [18, 44, 34],         // #122c22 deep pond green, near black
      opaqueAt: 1.0, seeThrough: 0.4,
      glint: [222, 236, 214],
      waveHz: 0.8, bgK: 0.42,
      cellM: 0.22,                // a bit finer than the lake: small water, small ripples
      glintP: 0.03, drift: 0.05, tintDepth: 0.8, shoreW: 0.5,
      rim: [184, 198, 150],       // #b8c696 pale reed / pollen scum (not white froth)
      foamRamp: 'o:.', foamDepth: 0.25, foamFar: 30,
      bands: '-~.~', glintCos: 0.99, crestK: 0.7,
      streak: '-', streakLen: 0.8, streakW: 0.3, streakK: 0.8,
    },
    // Flooded cellars / bog: brown silt, opaque within half a metre, barely moves, dark mud at the edge.
    murky: {
      ramp: '~-,~.-',
      shallow: [124, 104, 66],    // #7c6842 stirred silt (clearly brown, not grey-green)
      deep: [40, 32, 20],         // #282014 bog mud
      opaqueAt: 0.5, seeThrough: 0.5,
      glint: [196, 186, 150],     // dull, never white
      waveHz: 0.4, bgK: 0.5,
      cellM: 0.25, glintP: 0.02, drift: 0.03, tintDepth: 0.5, shoreW: 0.4,
      rim: [92, 74, 48],          // #5c4a30 wet mud line (DARKER than the shallow water: mud, not froth)
      foamRamp: ';,.', foamDepth: 0.2, foamFar: 25,
      bands: '-~,', glintCos: 0.995, crestK: 0.8,
      streak: '-', streakLen: 0.8, streakW: 0.4, streakK: 0.85,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
