/*
 * ASCII Quest - US-011 lever (3x5), D-011 reskin: the iron lever sits in a BRASS GEAR HOUSING `{ }` with one hub
 * gear in the middle. Up, 3 in-betweens, down (5 frames). The handle swings to the right and down around the hub.
 * The hub gear turns ONE STEP PER PULL FRAME through the cycle  *  ->  +  ->  x  -> (repeat)  (8 spokes, 4 spokes,
 * 4 spokes turned 45 deg): a one-way 3-state cycle reads as a spin, like a text spinner. The hub colour alternates
 * brassHot / brassLight so the step also shows as a glint. The brass knob glints while the lever is up and unused.
 * Machine accent (D-011): brass only on the housing, hub and knob; the post stays wood, the foot stone, the handle iron.
 * Format: design/README.md section 4. Sets ASSETS.models.lever.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var N = ['.f.', '.f.', 'lfr', '.f.', 'lfr'];
  function F(g, c) { return { S: { glyphs: g, fg: c, n: N } }; }

  // gear steps per pull frame: 0 '*', 1 '+', 2 'x', 3 '*', 4 '+'   (DOWN rests on step 4)
  var UP    = F([' o ', ' | ', '{*}', ' H ', '/_\\'], [' o ', ' I ', 'bHb', ' h ', 'sSs']);
  var UP_G  = F([' * ', ' | ', '{*}', ' H ', '/_\\'], [' W ', ' I ', 'bHb', ' h ', 'sSs']);
  var P45   = F(['  o', ' / ', '{+}', ' H ', '/_\\'], ['  o', ' I ', 'bBb', ' h ', 'sSs']);
  var HORIZ = F(['   ', '   ', '{xo', ' H ', '/_\\'], ['   ', '   ', 'bHo', ' h ', 'sSs']);
  var D45   = F(['   ', '   ', '{*}', ' H\\', '/_o'], ['   ', '   ', 'bBb', ' hI', 'sSo']);
  var DOWN  = F(['   ', '   ', '{+}', ' | ', '/o\\'], ['   ', '   ', 'bHb', ' I ', 'sos']);

  // half LOD 3x3: knob / housing + hub / foot. Same gear steps, same frame count.
  function H(g, c) { return { S: { glyphs: g, fg: c } }; }
  var hUP   = H([' o ', '{*}', '/_\\'], [' o ', 'bHb', 'sSs']);
  var hUPG  = H([' * ', '{*}', '/_\\'], [' W ', 'bHb', 'sSs']);
  var h45   = H(['  o', '{+}', '/_\\'], ['  o', 'bBb', 'sSs']);
  var hMID  = H(['   ', '{xo', '/_\\'], ['   ', 'bHo', 'sSs']);
  var hD45  = H(['   ', '{*}', '/_o'], ['   ', 'bBb', 'sSo']);
  var hDOWN = H(['   ', '{+}', '/o\\'], ['   ', 'bHb', 'sos']);

  A.models.lever = {
    name: 'lever',
    desc: 'Iron lever in a brass gear housing on a wooden post, stone foot. The hub gear turns one step per pull frame. ' +
          'Pulled once (0.4 s), then stays down (US-014).',
    size: { w: 3, h: 5 }, anchor: { x: 1, y: 4 }, world: { w: 0.35, h: 1.0 },
    directions: ['S'], billboard: true,
    keys: {
      o: { c: 'brassLight' }, W: { c: 'white', e: true },
      b: { c: 'brass' }, B: { c: 'brassLight' }, H: { c: 'brassHot' },
      h: { c: 'woodDark' },
      I: { c: 'ironLight' },
      s: { c: 'stoneMid' }, S: { c: 'stoneDark' }
    },
    gear: { row: 2, col: 1, steps: ['*', '+', 'x', '*', '+'], note: 'hub glyph per pull frame (one step each); idle = step 0, down = step 4' },
    animations: {
      idle: { loop: true, durations: [2400, 220], frames: [UP, UP_G] },     // up, unused: knob glint
      pull: { fps: 12.5, loop: false, frames: [UP, P45, HORIZ, D45, DOWN] }, // 5 frames = 0.4 s, gear * + x * +
      down: { fps: 1, loop: true, frames: [DOWN] }
    },
    lods: {
      half: { size: { w: 3, h: 3 }, anchor: { x: 1, y: 2 }, animations: {
        idle: { loop: true, durations: [2400, 220], frames: [hUP, hUPG] },
        pull: { fps: 12.5, loop: false, frames: [hUP, h45, hMID, hD45, hDOWN] },
        down: { fps: 1, loop: true, frames: [hDOWN] }
      } }
    },
    interact: { prompt: '[E] Pull lever', radius: 1.8 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
