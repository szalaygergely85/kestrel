/*
 * ASCII Quest - US-016 far tower: the dark second beacon, 800 m WSW of the breach.
 * Format: design/README.md section 4 (sprite model) + section 4.1 (billboard entity fields). Sets ASSETS.models.farTower.
 *
 * This is the silhouette that used to live inline in design/levels/overworld_far.js (farTower.sprite), moved here so the
 * engine draws it through the ordinary sprite pass as a `billboard` world entity (architecture.md 14.4 item 7).
 * Look (overworld_far.md section 5): darker than every terrain color, unlit, not emissive, fog capped at 0.40.
 * The broken top has a notch where its cold bowl sits; the detail frame adds one dead window slit.
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

  var MIN = {
    glyphs: ['n n',
             '|#|',
             '|#|',
             '/#\\'],
    fg:     ['ttt',
             'ttt',
             'ttt',
             'ttt']
  };
  var DETAIL = {
    glyphs: [' n_n ',
             ' |#| ',
             ' |#| ',
             ' |:| ',
             ' |#| ',
             ' |#| ',
             ' /#\\ ',
             '/###\\'],
    fg:     [' ttt ',
             ' ttt ',
             ' ttt ',
             ' tkt ',
             ' ttt ',
             ' ttt ',
             ' ttt ',
             'ttttt']
  };

  A.models.farTower = {
    name: 'farTower',
    desc: 'The dark second beacon tower on the hill2 crown, 800 m WSW of the breach (world 713.8, 1232.1). Dead, cold, unlit.',
    size: { w: 5, h: 8 }, anchor: { x: 2, y: 7 }, world: { w: 14, h: 42 },
    directions: ['S'], billboard: true,
    keys: {
      t: { c: 'farTower' },                 // #1a1d26, the darkest value in the far view; never emissive
      k: { c: 'black' }                     // dead window slit
    },
    animations: {
      idle: { fps: 0, loop: true, frames: [{ S: DETAIL }] }
    },
    lods: {
      min: { size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, animations: {
        idle: { fps: 0, loop: true, frames: [{ S: MIN }] }
      } }
    },

    // Billboard entity defaults (README 4.1). world_m1.js repeats them on the entity; the entity wins if they differ.
    unlit: true,                            // light = 1, no N.L, no `n` rows
    fogModel: 'far', fogMax: 0.40,          // fogF = min(fogMax, util.fogFactor(dist, 'far')); color toward fogFarNear..fogFar
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
