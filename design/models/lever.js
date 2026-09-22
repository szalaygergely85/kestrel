/*
 * ASCII Quest - US-011 lever (3x5): up, 3 in-betweens, down (5 frames). The handle swings to the right
 * and down around the pivot '#'. The brass knob glints while the lever is up and unused.
 * Format: design/README.md section 4. Sets ASSETS.models.lever.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var N = ['.f.', '.f.', 'lfr', '.f.', 'lfr'];
  function F(g, c) { return { S: { glyphs: g, fg: c, n: N } }; }

  var UP    = F([' o ', ' | ', '=#=', ' H ', '/_\\'], [' o ', ' w ', 'iIi', ' h ', 'sSs']);
  var UP_G  = F([' * ', ' | ', '=#=', ' H ', '/_\\'], [' W ', ' w ', 'iIi', ' h ', 'sSs']);
  var P45   = F(['  o', ' / ', '=#=', ' H ', '/_\\'], ['  o', ' w ', 'iIi', ' h ', 'sSs']);
  var HORIZ = F(['   ', '   ', '=#o', ' H ', '/_\\'], ['   ', '   ', 'iIo', ' h ', 'sSs']);
  var D45   = F(['   ', '   ', '=#=', ' H\\', '/_o'], ['   ', '   ', 'iIi', ' hw', 'sSo']);
  var DOWN  = F(['   ', '   ', '=#=', ' | ', '/o\\'], ['   ', '   ', 'iIi', ' w ', 'sos']);

  function H(g, c) { return { S: { glyphs: g, fg: c } }; }
  var hUP = H([' o ', '=#=', '/_\\'], [' o ', 'iIi', 'sSs']), hUPG = H([' * ', '=#=', '/_\\'], [' W ', 'iIi', 'sSs']);
  var hMID = H(['   ', '=#o', '/_\\'], ['   ', 'iIo', 'sSs']), hDOWN = H(['   ', '=#=', '/o\\'], ['   ', 'iIi', 'sos']);

  A.models.lever = {
    name: 'lever',
    desc: 'Iron lever on a wooden post, stone foot. Pulled once (0.4 s), then stays down (US-014).',
    size: { w: 3, h: 5 }, anchor: { x: 1, y: 4 }, world: { w: 0.35, h: 1.0 },
    directions: ['S'], billboard: true,
    keys: {
      o: { c: 'brassLight' }, W: { c: 'white', e: true },
      w: { c: 'wood' }, h: { c: 'woodDark' },
      i: { c: 'iron' }, I: { c: 'ironLight' },
      s: { c: 'stoneMid' }, S: { c: 'stoneDark' }
    },
    animations: {
      idle: { loop: true, durations: [2400, 220], frames: [UP, UP_G] },     // up, unused: glint
      pull: { fps: 12.5, loop: false, frames: [UP, P45, HORIZ, D45, DOWN] }, // 5 frames = 0.4 s
      down: { fps: 1, loop: true, frames: [DOWN] }
    },
    lods: {
      half: { size: { w: 3, h: 3 }, anchor: { x: 1, y: 2 }, animations: {
        idle: { loop: true, durations: [2400, 220], frames: [hUP, hUPG] },
        pull: { fps: 12.5, loop: false, frames: [hUP, hUP, hMID, hDOWN, hDOWN] },
        down: { fps: 1, loop: true, frames: [hDOWN] }
      } }
    },
    interact: { prompt: '[E] Pull lever', radius: 1.8 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
