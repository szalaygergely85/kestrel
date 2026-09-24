/*
 * Kestrel - US-016 far tower = THE SIGNAL TOWER (D-011 addendum), 800 m WSW of the breach.
 * Format: design/README.md section 4 (sprite model) + section 4.1 (billboard entity fields). Sets ASSETS.models.farTower.
 *
 * The silhouette that used to live inline in design/levels/overworld_far.js (farTower.sprite), drawn by the engine through
 * the ordinary sprite pass as a `billboard` world entity (architecture.md 14.4 item 7).
 * Body (overworld_far.md section 5): darker than every terrain color, unlit, NOT emissive, fog capped at 0.40.
 * D-011 addendum: a small STATIC aether-teal light sits in the notch of the broken crown (where the bowl is), 1 cell in the
 * `min` frame (1-2 cells on screen at 240x90 after the minCells clamp, never smaller than 1 cell). The light cells are
 * emissive (ignore lighting) but take far fog capped at their key's `fogMax` (0.20), so they stay clearly teal.
 * The SOS pulse (D-013 timing, same as title.signal) is a later P2 story; in M1 the light is steady. US-022 (waking our relay)
 * does not change it.
 *
 * Two frames, chosen by projected height (rows), never animated:
 *   detail 5x8  = the base model (size / anchor / animations.idle), used when the projection is >= detailRows (12) rows
 *   min    3x4  = lods.min, used otherwise, AND the hard minimum: the sprite is never drawn smaller than 3x4 cells.
 * At 800 m on 160x60 the true size is about 2x3 cells, so the player sees `min` clamped to 3x4; at 320x120 about 4x6 -> still `min`.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // `*` in the crown notch = the signal light (L). Body keys t stay farTower.
  var MIN = {
    glyphs: ['n*n',
             '|#|',
             '|#|',
             '/#\\'],
    fg:     ['tLt',
             'ttt',
             'ttt',
             'ttt']
  };
  // detail: a faint glint (G) one cell above the light, the light (L) in the notch, one dead window slit (k).
  var DETAIL = {
    glyphs: ["  '  ",
             ' n*n ',
             ' |#| ',
             ' |:| ',
             ' |#| ',
             ' |#| ',
             ' /#\\ ',
             '/###\\'],
    fg:     ['  G  ',
             ' tLt ',
             ' ttt ',
             ' tkt ',
             ' ttt ',
             ' ttt ',
             ' ttt ',
             'ttttt']
  };

  A.models.farTower = {
    name: 'farTower',
    displayName: 'the signal tower',
    desc: 'The signal tower on the hill2 crown, 800 m WSW of the breach (world 713.8, 1232.1): a dark, dead-looking body with one ' +
          'small steady aether-teal light in the notch of its broken crown. The end of the pencil line on the chart.',
    size: { w: 5, h: 8 }, anchor: { x: 2, y: 7 }, world: { w: 14, h: 42 },
    directions: ['S'], billboard: true,
    keys: {
      t: { c: 'farTower' },                               // #1a1d26, the darkest value in the far view; never emissive
      k: { c: 'black' },                                  // dead window slit
      // D-011 addendum: the signal light. e = emissive; fogMax = per-key fog cap for emissive cells (engine note, README 4.1)
      L: { c: 'aether', e: true, fogMax: 0.20 },          // THE teal (colorRamps.aether index 2)
      G: { c: 'aetherMid', e: true, fogMax: 0.20 }        // detail-only glint above it (index 1): the light "carries" a little
    },
    animations: {
      idle: { fps: 0, loop: true, frames: [{ S: DETAIL }] }
    },
    lods: {
      min: { size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, animations: {
        idle: { fps: 0, loop: true, frames: [{ S: MIN }] }
      } }
    },

    // The signal light as data (for tests / the P2 pulse story). Cells are in each frame's own coordinates.
    signalLight: {
      keys: ['L', 'G'], colorRamp: 'aether', rampIndex: { L: 2, G: 1 },
      cells: { min: [{ x: 1, y: 0 }], detail: [{ x: 2, y: 1 }, { x: 2, y: 0 }] },
      steady: true, pulse: 'P2 story: SOS 3 short / 3 long / 3 short (title.signal.ms timing); not M1',
      unchangedBy: 'US-022 (waking our relay changes neither the signal tower nor Ferrum in M1)'
    },

    // Billboard entity defaults (README 4.1). world_m1.js repeats them on the entity; the entity wins if they differ.
    unlit: true,                            // light = 1, no N.L, no `n` rows
    fogModel: 'far', fogMax: 0.40,          // body: fogF = min(fogMax, util.fogFactor(dist, 'far')); color toward fogFarNear..fogFar
    minCells: { w: 3, h: 4 },               // clamp after LOD: never smaller than the `min` frame
    detailRows: 12,                         // projected rows >= 12 -> base (detail) frame, else lods.min
    noUpscaleCap: true,                     // the 3*rows/60 cap does not apply: the world size (14 x 42 m) is the truth

    // Convenience aliases for the engine / tests: the same two frames by name.
    frames: {
      min:    { size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, glyphs: MIN.glyphs, fg: MIN.fg },
      detail: { size: { w: 5, h: 8 }, anchor: { x: 2, y: 7 }, glyphs: DETAIL.glyphs, fg: DETAIL.fg }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
