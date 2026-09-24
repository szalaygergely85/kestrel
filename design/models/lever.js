/*
 * ASCII Quest - lever. US-011 (3x5), D-011 brass gear housing, ART-OWN-001 readability rework (11x12, half 7x6).
 *
 * ART-OWN-001 (owner walk test: "can't really see what it is"): the old 3x5 art was drawn 4-7x enlarged at the real
 * view distance (2-5 m), so every glyph became a block of repeats and the thin brass/wood read as wall texture.
 * Now: a BRASS PLATE housing (bright brassLight rim `o===o | |`, dark brassDark plate inside, brassHot hub gear) on a
 * wooden post and an iron foot, and a long iron handle with a big brass KNOB `@` that glints. Silhouette first: the
 * plate is the widest part, the knob sticks out above it; inner detail = only the hub gear.
 *
 * Pull: up, 3 in-betweens, down (5 frames, 0.4 s). The handle swings to the right and down around the hub (5,5).
 * The hub gear turns ONE STEP PER PULL FRAME  *  ->  +  ->  x  ->  *  ->  +  (one-way 3-state cycle = spin).
 *
 * BUG-OWN-003 / architecture.md 7.7: `fill` (solid plate behind every cell) + `outline` (1-cell dark rim, engine
 * support pending). Cells with glyph ' ' and a real key (plate interior `p`, post core `v`) are OPAQUE SPACES: solid
 * plates once the engine supports `fill`; until then they are holes (today's cutout rule).
 * Format: design/README.md section 4. Sets ASSETS.models.lever.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // rows -> char arrays, padded / cut to the width of the widest row (blank rows can never drift)
  function split(rows) {
    var w = rows.reduce(function (a, r) { return r.trim() ? Math.max(a, r.length) : a; }, 0);
    return rows.map(function (r) { while (r.length < w) r += ' '; return r.slice(0, w).split(''); });
  }
  function join(rows) { return rows.map(function (r) { return r.join(''); }); }
  // normals: first/last silhouette cell (by KEY, so opaque spaces count) -> l / r, `up` rows -> u, else f
  function autoN(g, k, up) {
    return g.map(function (row, r) {
      var o = '', first = -1, last = -1, c;
      for (c = 0; c < row.length; c++) if (k[r].charAt(c) !== ' ') { if (first < 0) first = c; last = c; }
      for (c = 0; c < row.length; c++) {
        o += k[r].charAt(c) === ' ' ? '.' : up.indexOf(r) >= 0 ? 'u' : c === first ? 'l' : c === last ? 'r' : 'f';
      }
      return o;
    });
  }

  // ---- full 11x12 base: plate rows 3-7 (hub at row 5, col 5), post rows 8-9, iron foot rows 10-11 ----
  //                    0123456789A
  var BASE_G = ['           ',
                '           ',
                '           ',
                '  o=====o  ',
                '  |     |  ',
                '  |     |  ',
                '  |     |  ',
                '  o=====o  ',
                '    | |    ',
                '    | |    ',
                '   /===\\   ',
                '  /_____\\  '];
  var BASE_K = ['           ',
                '           ',
                '           ',
                '  bRRRRRb  ',
                '  RpppppR  ',
                '  RpppppR  ',
                '  RpppppR  ',
                '  bRRRRRb  ',
                '    wvw    ',
                '    wvw    ',
                '   fffff   ',
                '  fFFFFFf  '];
  // half 7x6: plate rows 1-3 (hub row 2, col 3), post row 4, foot row 5
  var HALF_G = ['       ',
                ' o===o ',
                ' |   | ',
                ' o===o ',
                '  | |  ',
                ' /===\\ '];
  var HALF_K = ['       ',
                ' bRRRb ',
                ' RpppR ',
                ' bRRRb ',
                '  wvw  ',
                ' fffff '];

  // handle poses: cells [row, col, glyph] from the hub outward, knob [row, col]
  var POSE = {
    up:    { h: [[4, 5, '|'], [3, 5, '|'], [2, 5, '|'], [1, 5, '|']],     k: [0, 5] },
    p45:   { h: [[4, 6, '/'], [3, 7, '/'], [2, 8, '/'], [1, 9, '/']],     k: [0, 10] },
    horiz: { h: [[5, 6, '-'], [5, 7, '-'], [5, 8, '-'], [5, 9, '-']],     k: [5, 10] },
    d45:   { h: [[6, 6, '\\'], [7, 7, '\\'], [8, 8, '\\'], [9, 9, '\\']], k: [10, 10] },
    down:  { h: [[6, 5, '|'], [7, 5, '|'], [8, 5, '|'], [9, 5, '|']],     k: [10, 5] }
  };
  var POSE_H = {
    up:    { h: [[1, 3, '|']],                 k: [0, 3] },
    p45:   { h: [[1, 4, '/']],                 k: [0, 5] },
    horiz: { h: [[2, 4, '-'], [2, 5, '-']],    k: [2, 6] },
    d45:   { h: [[3, 4, '\\']],                k: [4, 5] },
    down:  { h: [[3, 3, '|'], [4, 3, '|']],    k: [5, 3] }
  };
  var HUB = { row: 5, col: 5 }, HUB_H = { row: 2, col: 3 };

  function build(bg, bk, hub, pose, gear, glint) {
    var G = split(bg), K = split(bk);
    G[hub.row][hub.col] = gear; K[hub.row][hub.col] = 'H';
    pose.h.forEach(function (c) { G[c[0]][c[1]] = c[2]; K[c[0]][c[1]] = 'I'; });
    G[pose.k[0]][pose.k[1]] = glint ? '*' : '@'; K[pose.k[0]][pose.k[1]] = glint ? 'W' : 'K';
    var g = join(G), k = join(K);
    return { S: { glyphs: g, fg: k, n: autoN(g, k, [3]) } };
  }
  function F(p, gear, glint)  { return build(BASE_G, BASE_K, HUB, POSE[p], gear, glint); }
  function H(p, gear, glint)  { return build(HALF_G, HALF_K, HUB_H, POSE_H[p], gear, glint); }

  // gear steps per pull frame: 0 '*', 1 '+', 2 'x', 3 '*', 4 '+'   (DOWN rests on step 4)
  var UP = F('up', '*'), UP_G = F('up', '*', true), P45 = F('p45', '+'), HORIZ = F('horiz', 'x'), D45 = F('d45', '*'), DOWN = F('down', '+');
  var hUP = H('up', '*'), hUPG = H('up', '*', true), h45 = H('p45', '+'), hMID = H('horiz', 'x'), hD45 = H('d45', '*'), hDOWN = H('down', '+');

  A.models.lever = {
    name: 'lever',
    desc: 'Iron lever in a brass plate housing (bright rim, dark plate, hub gear) on a wooden post, iron foot. Long iron ' +
          'handle with a brass knob that glints. The hub gear turns one step per pull frame. Pulled once (0.4 s), then stays down (US-014).',
    size: { w: 11, h: 12 }, anchor: { x: 5, y: 11 }, world: { w: 0.7, h: 1.1 },
    directions: ['S'], billboard: true,
    // BUG-OWN-003 (architecture.md 7.7, engine support pending): solid plates + 1-cell dark rim against the wall
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: {
      K: { c: 'brassHot' },                 // knob
      W: { c: 'white', e: true },           // knob glint (emissive: it pops even in shade)
      I: { c: 'ironLight' },                // handle
      R: { c: 'brassLight' }, b: { c: 'brass' }, H: { c: 'brassHot' },
      p: { c: 'brassDark' },                // plate interior (opaque space)
      w: { c: 'woodLight' }, v: { c: 'wood' },
      f: { c: 'ironLight' }, F: { c: 'iron' }
    },
    gear: { row: HUB.row, col: HUB.col, half: { row: HUB_H.row, col: HUB_H.col }, steps: ['*', '+', 'x', '*', '+'],
            note: 'hub glyph per pull frame (one step each); idle = step 0, down = step 4. `half` = the hub cell in lods.half' },
    animations: {
      idle: { loop: true, durations: [1600, 240], frames: [UP, UP_G] },     // up, unused: knob glint (every ~1.8 s: findable)
      pull: { fps: 12.5, loop: false, frames: [UP, P45, HORIZ, D45, DOWN] }, // 5 frames = 0.4 s, gear * + x * +
      down: { fps: 1, loop: true, frames: [DOWN] }
    },
    lods: {
      half: { size: { w: 7, h: 6 }, anchor: { x: 3, y: 5 }, animations: {
        idle: { loop: true, durations: [1600, 240], frames: [hUP, hUPG] },
        pull: { fps: 12.5, loop: false, frames: [hUP, h45, hMID, hD45, hDOWN] },
        down: { fps: 1, loop: true, frames: [hDOWN] }
      } }
    },
    readability: { note: 'ART-OWN-001: at 160x60 the lever is ~25 rows tall at 3 m (scale ~2), 12 rows at 6 m (scale 1); ' +
                   'the half LOD takes over past ~8.5 m (160x60) / ~12.7 m (240x90).' },
    interact: { prompt: '[E] Pull lever', radius: 1.8 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
