/* design/models/marker_props_voxel.js - QFIX-S1 (NEEDS DESIGNER, OB-155a/b/d/e "visible posts / stone at notePost, knot,
 * pierStone"): two small static voxel props that replace the stand-ins (Prop_WoodenFence_Single board, Rock_Medium_1)
 * at the quest anchors notePost / knot / pierStone.
 *
 *   markerPost     1.60 m weathered oak post (octagonal 16 cm section, end-grain top), a small two-plank board
 *                  (0.56 x 0.32 m) nailed to its front at 1.04-1.36 m with faded black lettering, a pinned linen note with
 *                  a curled corner, a rope lashing under the board, packing stones round the foot.
 *   standingStone  1.40 m rough field stone: a tapering, slightly leaning slab (0.75 x 0.45 m at the foot) with a
 *                  rounded slanted top, uneven faces, pale weathered top + lichen spots, dark pits, a damp mossy foot
 *                  (moss up the back flank), two half-sunk packing stones. One buried row (anchor z 1) so it never
 *                  floats on a slope. Rock grey, NOT the waystone's dark slate (a waystone reads as "relay").
 *
 * Same format and loading as design/models/pickups_voxel.js (classic script, VoxelModelDef = architecture.md 15.1,
 * design/README.md sections 7 + 16): one part `body`, static `idle` clip, meshOnly, only ALREADY-MERGED materials
 * (palette.materials + detailPass.materials; no palette.js / detail-pass.js edit). Axes x = east, y = SOUTH (y0 = the
 * FRONT row; the board / lettering face -y), z = up. Anchor = footprint centre (post centre for markerPost), bottom.
 * Registers ASSETS.voxelModels[id] and ASSETS.models[id] (same record) + ASSETS.markerProps = { ids, validate() }.
 * Preview: design/preview/npcs-givers.html (section 2).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};

  var MAT = {
    t: 'timber_old', w: 'wood', W: 'wood_cut', x: 'dye_walnut', X: 'dye_walnut_dark', d: 'iron_dark', i: 'iron_light',
    r: 'rope', n: 'linen', N: 'linen_dark',
    s: 'rock_soft', K: 'rock', L: 'waystone_light', D: 'waystone_dark'
  };

  function hash3(x, y, z) {   // deterministic 0..99, no Math.random (same as chest.js / pickups_voxel.js)
    var h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }
  function grid(sx, sy, sz) {
    var g = [], x, y, z, L, r;
    for (z = 0; z < sz; z++) { L = []; for (y = 0; y < sy; y++) { r = []; for (x = 0; x < sx; x++) r.push('.'); L.push(r); } g.push(L); }
    var G = { sx: sx, sy: sy, sz: sz };
    G.set = function (x, y, z, c) { if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return; g[z][y][x] = c || '.'; };
    G.get = function (x, y, z) { return (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) ? '.' : g[z][y][x]; };
    G.full = function (x, y, z) { return G.get(x, y, z) !== '.'; };
    G.exposed = function (x, y, z) {
      return !G.full(x + 1, y, z) || !G.full(x - 1, y, z) || !G.full(x, y + 1, z) || !G.full(x, y - 1, z) || !G.full(x, y, z + 1);
    };
    G.layers = function () { return g.map(function (L) { return L.map(function (r) { return r.join(''); }); }); };
    return G;
  }

  // ================================ markerPost  16 x 10 x 40 @ 0.04 m ================================
  var POST = { x0: 6, x1: 9, y0: 4, y1: 7 };          // 4 x 4 cells, corners cut = octagonal 16 cm post
  function inPost(x, y) {
    if (x < POST.x0 || x > POST.x1 || y < POST.y0 || y > POST.y1) return false;
    return !((x === POST.x0 || x === POST.x1) && (y === POST.y0 || y === POST.y1));
  }
  var LETTERS = {                                    // board front (y 3), x 2..8; faded paint, 2 lines
    32: 'X.X.XX.',
    31: 'XXX.X.X',
    28: 'XX.X.XX',
    27: 'X..XX.X'
  };
  function mMarkerPost() {
    var SX = 16, SY = 10, SZ = 40, G = grid(SX, SY, SZ), x, y, z;
    // the post: weathered oak, grain constant along each column, a long drying crack on the front, damp dark foot
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (!inPost(x, y)) continue;
      if (z === SZ - 1 && !(x >= 7 && x <= 8 && y >= 5 && y <= 6)) continue;     // bevelled top: 2 x 2 end-grain cap
      var c = hash3(x, y, 5) < 45 ? 'w' : 't';
      if (hash3(x, y, z) < 7) c = c === 'w' ? 't' : 'w';
      if (z >= SZ - 2 && !G.full(x, y, z + 1)) c = 'W';                            // pale cut end grain
      if (x === 8 && y === POST.y0 && z >= 5 && z <= 19) c = 'X';                  // drying crack
      if (z <= 2 && hash3(x, y, z + 40) < 55) c = 'x';                             // damp foot
      G.set(x, y, z, c);
    }
    for (z = SZ - 2; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) if (G.full(x, y, z) && !G.full(x, y, z + 1)) G.set(x, y, z, 'W');
    // rope lashing (2 turns) under the board
    for (z = 23; z <= 24; z++) for (y = POST.y0 - 1; y <= POST.y1 + 1; y++) for (x = POST.x0 - 1; x <= POST.x1 + 1; x++) {
      if (inPost(x, y)) continue;
      var ox = x < POST.x0 || x > POST.x1, oy = y < POST.y0 || y > POST.y1;
      if (ox && oy) continue;                                                      // round the corners
      G.set(x, y, z, 'r');
    }
    G.set(POST.x1 + 1, POST.y0 + 1, 22, 'r');                                       // the knot's loose end
    G.set(POST.x1 + 1, POST.y0 + 1, 21, 'r');
    // the board: 2 planks (seam row z 29), 14 x 8 cells at y 3, chipped corners, nails, lettering
    for (z = 26; z <= 33; z++) for (x = 1; x <= 14; x++) {
      if ((x === 1 && z === 26) || (x === 14 && z === 33)) continue;             // chipped corners
      var b = hash3(x, 3, z) < 18 ? 't' : 'w';
      if (z === 29) b = 't';                                                       // the gap between the planks
      var row = LETTERS[z];
      if (row && x >= 2 && x <= 8 && row.charAt(x - 2) === 'X') b = 'X';
      G.set(x, 3, z, b);
    }
    [[2, 32], [2, 27], [13, 27], [9, 32]].forEach(function (p) { G.set(p[0], 3, p[1], 'd'); });
    // the pinned note (linen, writing lines, one curled corner, iron nail) proud of the board
    for (z = 27; z <= 32; z++) for (x = 10; x <= 13; x++) {
      if (x === 13 && z === 27) continue;                                          // curled corner
      var nc = (z === 30 || z === 28) && x <= 12 ? 'N' : 'n';
      G.set(x, 2, z, nc);
    }
    G.set(11, 2, 32, 'i');
    // packing stones round the foot (half sunk)
    for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      var r = Math.sqrt(Math.pow(x + 0.5 - 8, 2) + Math.pow(y + 0.5 - 6, 2));
      if (inPost(x, y) || r < 2.2 || r > 4.3) continue;
      var h = hash3(x, y, 3);
      if (h < 62) G.set(x, y, 0, h < 20 ? 'K' : 's');
      if (h < 26 && r < 3.6) G.set(x, y, 1, h < 9 ? 'L' : 's');
    }
    return G;
  }

  // ================================ standingStone  16 x 12 x 29 @ 0.05 m ================================
  var G0 = 1;   // one buried row; anchor z = 1 = the ground plane
  function mStandingStone() {
    var SX = 16, SY = 12, SZ = 29, G = grid(SX, SY, SZ), x, y, z;
    var H = SZ - G0 - 1;                                   // 27 rows above ground (0 .. 27) = 1.40 m
    for (z = 0; z < SZ; z++) {
      var zz = z - G0, t = Math.max(0, zz) / H;
      var hw = 6.0 * (1 - 0.30 * t) + 0.45 * Math.sin(Math.PI * t), hd = 3.9 * (1 - 0.28 * t);
      var cx = 8 + 0.9 * t, cy = 6 - 0.35 * t;
      if (zz < 0) { hw *= 1.08; hd *= 1.08; }
      for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
        var X = x + 0.5, Y = y + 0.5;
        var u = (X - (cx - hw)) / (2 * hw);                                          // 0 = west edge, 1 = east edge
        var top = H - 2.6 * Math.max(0, Math.min(1, u)) - 1.2 * Math.pow(Math.abs(Y - cy) / hd, 2);
        if (zz > top) continue;
        var rr = top - zz < 4 ? Math.sqrt(Math.max(0, (top - zz) / 4)) : 1;          // rounded top shoulders
        var n = (hash3(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 3)) - 50) / 50 * 0.12;
        var e = Math.pow(Math.abs(X - cx) / (hw * (0.45 + 0.55 * rr)), 2.4) + Math.pow(Math.abs(Y - cy) / (hd * (0.5 + 0.5 * rr)), 2.4);
        if (e > 1 + n) continue;
        G.set(x, y, z, zz < 0 ? 'K' : 's');
      }
    }
    // paint the exposed skin: pale top + lichen, damp mossy foot, moss up the back (+y) flank, dark pits
    var paint = [];
    for (z = G0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (G.get(x, y, z) !== 's' || !G.exposed(x, y, z)) continue;
      var q = z - G0, h = hash3(x, y, z), out = 's';
      if (!G.full(x, y, z + 1)) out = h < 72 ? 'L' : 's';                                      // weathered top
      else if (q <= 1 || (q === 2 && h < 45)) out = 'D';                                         // damp foot, ragged
      else if (!G.full(x, y + 1, z) && q <= 11 && hash3(x, y, z + 7) < 66 - 5 * q) out = 'D';    // moss on the back flank
      else if (q >= 7 && h < 6) out = 'L';                                                       // lichen spots
      else if (h >= 6 && h < 15) out = 'K';                                                      // pits, cracks
      if (out !== 's') paint.push([x, y, z, out]);
    }
    paint.forEach(function (p) { G.set(p[0], p[1], p[2], p[3]); });
    // two packing stones, half sunk, + a pebble
    [[1, 6, 1, 'K'], [2, 6, 1, 'K'], [1, 7, 1, 'K'], [1, 6, 2, 'L'], [13, 3, 1, 'K'], [14, 3, 1, 'K'], [14, 4, 1, 'K'], [14, 3, 2, 's'],
     [6, 0, 1, 'K']].forEach(function (p) { if (!G.full(p[0], p[1], p[2])) G.set(p[0], p[1], p[2], p[3]); });
    return G;
  }

  // ================================ records ================================
  function record(id, G, cellM, anchor, desc, collider) {
    var layers = G.layers(), mats = {}, z, y, j, ch;
    for (z = 0; z < layers.length; z++) for (y = 0; y < layers[z].length; y++) for (j = 0; j < layers[z][y].length; j++) {
      ch = layers[z][y].charAt(j);
      if (ch !== '.') mats[ch] = MAT[ch];
    }
    var sx = G.sx, sy = G.sy, sz = G.sz;
    return {
      name: id, desc: desc,
      voxel: {
        version: 1, cellM: cellM, size: [sx, sy, sz], anchor: anchor, meshOnly: true,
        mats: mats, layers: layers,
        parts: { body: { box: [0, 0, 0, sx, sy, sz], pivot: anchor.slice() } },
        animations: { idle: { durations: [1000], loop: true, frames: [{}] } },
        mounts: { prompt: { at: [anchor[0], anchor[1], sz + 2], part: 'body' } }
      },
      colliders: [collider],
      world: { w: +(sx * cellM).toFixed(3), d: +(sy * cellM).toFixed(3), h: +((sz - anchor[2]) * cellM).toFixed(3) }
    };
  }
  var DEFS = [
    ['markerPost', mMarkerPost, 0.04, [8, 6, 0],
     'Marker post (1.60 m): weathered oak post, octagonal, end-grain top, drying crack; small two-plank board (0.56 x 0.32 m) ' +
     'at 1.04-1.36 m with faded black lettering and 4 nails, a pinned linen note with a curled corner, rope lashing, packing stones.',
     { type: 'prism', c: [0, 0, 0.8], r: 0.12, h: 1.6 }],
    ['standingStone', mStandingStone, 0.05, [8, 6, G0],
     'Standing stone (1.40 m): rough grey field stone, tapering and leaning a little, rounded slanted top, pale weathered top ' +
     'with lichen, dark pits, damp mossy foot, moss up the back, two half-sunk packing stones. One buried row.',
     { type: 'prism', c: [0, 0, 0.7], r: 0.36, h: 1.4 }]
  ];
  var ids = [];
  DEFS.forEach(function (D) {
    var rec = record(D[0], D[1](), D[2], D[3], D[4], D[5]);
    A.voxelModels[D[0]] = rec; A.models[D[0]] = rec; ids.push(D[0]);
  });

  function validate() {
    var errs = [], P = A.palette && A.palette.materials, k, id, v, z, y;
    for (k = 0; k < ids.length; k++) {
      id = ids[k]; v = A.voxelModels[id].voxel;
      if (v.layers.length !== v.size[2]) errs.push(id + ': layers ' + v.layers.length + ' != sz ' + v.size[2]);
      for (z = 0; z < v.layers.length; z++) {
        if (v.layers[z].length !== v.size[1]) errs.push(id + ': z' + z + ' rows ' + v.layers[z].length);
        for (y = 0; y < v.layers[z].length; y++) if (v.layers[z][y].length !== v.size[0]) errs.push(id + ': z' + z + ' y' + y + ' len');
      }
      for (var ch in v.mats) {
        if (!v.mats[ch]) errs.push(id + ': char "' + ch + '" has no material');
        else if (P && !P[v.mats[ch]]) errs.push(id + ': material "' + v.mats[ch] + '" not in palette.materials');
      }
    }
    return errs;
  }

  A.markerProps = {
    note: 'QFIX-S1 anchor props: markerPost replaces the Prop_WoodenFence_Single board at notePost (and any post anchor), ' +
          'standingStone replaces Rock_Medium_1 at knot / pierStone. Static; entity yaw turns them (front = -y).',
    ids: ids, replaces: { markerPost: 'Prop_WoodenFence_Single (notePost)', standingStone: 'Rock_Medium_1 (knot, pierStone)' },
    validate: validate
  };
  if (typeof module === 'object' && module && module.exports) module.exports = A.markerProps;
})(typeof window !== 'undefined' ? window : globalThis);
