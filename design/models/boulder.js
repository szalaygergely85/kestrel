/*
 * ASCII Quest - US-011 boulder (5x4), mossy stone, 8 rotation frames.
 * The silhouette never changes (readability); the surface texture scrolls one column per frame.
 * Frame index INCREASES while the boulder rolls toward the viewer's LEFT (texture moves left);
 * step it backwards for rolls to the right. One frame = 1/8 turn = 2*pi*0.6/8 = 0.47 m rolled.
 * Format: design/README.md section 4. Sets ASSETS.models.boulder.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // 8-long looping surface strips (glyph + color key), two rows
  var P1G = '#%o#&%#@', P1C = 'sSmsdsMS';
  var P2G = '%#&@#o%#', P2C = 'dsMSsmsd';
  var TOPC = 'sSmsSdsS';                 // rim color strip (a moss patch rolls over the top)
  var N = [' uuu ', 'lfffr', 'lfffr', ' ddd '];

  function strip(s, k, n) { var o = '', i; for (i = 0; i < n; i++) o += s.charAt((k + i) % s.length); return o; }
  var frames = [], half = [], k;
  for (k = 0; k < 8; k++) {
    frames.push({ S: {
      glyphs: [' .-. ', '(' + strip(P1G, k, 3) + ')', '(' + strip(P2G, k, 3) + ')', " `-' "],
      fg:     [' ' + strip(TOPC, k, 3) + ' ', 'd' + strip(P1C, k, 3) + 'd', 'd' + strip(P2C, k, 3) + 'd', ' ddd '],
      n: N
    } });
    half.push({ S: { glyphs: ['(' + P1G.charAt(k) + ')', "`-'"], fg: ['d' + P1C.charAt(k) + 'd', 'ddd'] } });
  }

  A.models.boulder = {
    name: 'boulder',
    desc: 'Round mossy boulder, radius 0.6 m. Rolls (US-013); sprite frame follows distance rolled.',
    size: { w: 5, h: 4 }, anchor: { x: 2, y: 3 }, world: { w: 1.2, h: 1.2 },
    directions: ['S'], billboard: true,
    keys: { s: { c: 'stoneMid' }, S: { c: 'stoneLight' }, d: { c: 'stoneDark' }, m: { c: 'moss' }, M: { c: 'mossDark' } },
    roll: { framesPerTurn: 8, metersPerFrame: 0.471, forward: 'left' },
    animations: { roll: { fps: 0, loop: true, frames: frames, note: 'fps 0 = driven by distance rolled, not time' } },
    lods: { half: { size: { w: 3, h: 2 }, anchor: { x: 1, y: 1 }, animations: { roll: { fps: 0, loop: true, frames: half } } } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
