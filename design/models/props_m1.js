/* design/models/props_m1.js - S8-A-08 M1 props set (designer, v1.44): the props M1 still lacked.
 *
 *   waystoneSmall    road waystone, 1.25 m (a smaller marker on the pencil line, carved mark gone dark)
 *   waystoneLeaning  old waystone leaning 12 deg, 2.1 m, heaved sod, crack through its dark mark
 *   waystoneFallen   toppled waystone broken in two, its stub still standing, the mark half under moss
 *   lanternPost      old watch road lantern on a timber post, iron arm + hanging cage lamp, clips lit / unlit
 *   breachRubble     the heap of cut wall blocks + a snapped floor beam where the summit wall broke (2.2 x 1.6 m)
 *   swordPedestal    old watch stone pedestal (2 steps, die, bronze bands, slot) for the ruin-steel sword
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/chest.js:
 *   <script src="../design/models/props_m1.js">        (browser, game/index.html, after chest.js)
 *   import '../../../design/models/props_m1.js';        (Node tests: side-effect import; module.exports below)
 * Sets ASSETS.voxelModels.<key> = ASSETS.models.<key> (no billboards exist) and ASSETS.propsM1 (key list, groups,
 * budget, lantern clip map + light). Only ALREADY-MERGED materials (palette.materials AND detailPass.materials): no
 * palette.js / detail-pass.js edit. Format: design/README.md sections 7 + 18, architecture.md 15.1 (VoxelModelDef),
 * 37.10 (`colliders`, model default, prop-local metres from the anchor). Preview: design/preview/props-m1.html.
 *
 * Axes (15.1): x = east, y = SOUTH with y0 = the FRONT row (faces north at yaw 0), z = up. Anchor = footprint centre
 * at ground level; the waystones and the lantern post bury their bottom layers (anchor z > 0) so a slope never opens a
 * gap under the downhill side (same rule as the US-026a waystone).
 *
 * Budget (style guide 5.14, new): engine mesher LOD0 <= 2000 tris per model; each part box sx+sy+sz <= 48 (the DDA
 * step limit, like the waystone); <= 8 parts; <= 3 hue families. Checked live in the preview.
 * Generated rows: deterministic builders (integer hash, no Math.random), plain layers[z][y] strings at load time.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};

  // ===================================================================================================================
  // 0. HELPERS (same integer hash + grid as voxel_world.js)
  // ===================================================================================================================
  function hash(x, y, z, s) {
    var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) +
             Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }
  function Grid(sx, sy, sz) {
    this.sx = sx; this.sy = sy; this.sz = sz; this.a = [];
    for (var i = 0; i < sx * sy * sz; i++) this.a.push('.');
  }
  Grid.prototype.inb = function (x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; };
  Grid.prototype.get = function (x, y, z) { return this.inb(x, y, z) ? this.a[x + this.sx * (y + this.sy * z)] : '.'; };
  Grid.prototype.set = function (x, y, z, c) { if (this.inb(x, y, z)) this.a[x + this.sx * (y + this.sy * z)] = c; };
  Grid.prototype.full = function (x, y, z) { return this.get(x, y, z) !== '.'; };
  Grid.prototype.exposed = function (x, y, z) {
    return !this.full(x + 1, y, z) || !this.full(x - 1, y, z) || !this.full(x, y + 1, z) || !this.full(x, y - 1, z) ||
           !this.full(x, y, z + 1) || !this.full(x, y, z - 1);
  };
  Grid.prototype.each = function (fn) {
    for (var z = 0; z < this.sz; z++) for (var y = 0; y < this.sy; y++) for (var x = 0; x < this.sx; x++) {
      if (this.full(x, y, z)) fn(x, y, z, this.get(x, y, z));
    }
  };
  Grid.prototype.box = function (x0, y0, z0, x1, y1, z1, c) {      // half-open box fill
    for (var z = z0; z < z1; z++) for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) this.set(x, y, z, c);
  };
  Grid.prototype.top = function (x, y) {                            // highest solid z of a column, -1 = empty
    for (var z = this.sz - 1; z >= 0; z--) if (this.full(x, y, z)) return z;
    return -1;
  };
  Grid.prototype.layers = function () {
    var L = [], z, y, x, rows, row;
    for (z = 0; z < this.sz; z++) {
      rows = [];
      for (y = 0; y < this.sy; y++) { row = ''; for (x = 0; x < this.sx; x++) row += this.a[x + this.sx * (y + this.sy * z)]; rows.push(row); }
      L.push(rows);
    }
    return L;
  };
  function applyPaint(G, list) { for (var i = 0; i < list.length; i++) G.set(list[i][0], list[i][1], list[i][2], list[i][3]); }

  // one char per material; every key is already merged in palette.materials + detailPass.materials
  var KEY = {
    S: 'waystone_light',  // waystone lichen top rim, lichen specks, pebble tops
    s: 'waystone',        // waystone slate body
    k: 'waystone_dark',   // damp foot, buried base, the carved (dead) marks, cracks
    m: 'moss_cap',        // moss cushions (waystones, rubble, pedestal)
    T: 'block_light',     // rubble block tops, pedestal top slab face, lantern foot top
    D: 'block_dark',      // rubble block sides + chips, lantern foot, pedestal slot rim
    L: 'granite_light',   // pedestal die + slab sides, step tops
    g: 'granite_dark',    // pedestal step sides, damp die foot, die crack
    w: 'timber_old',      // lantern post, the snapped floor beam
    c: 'wood_cut',        // the beam's broken / sawn ends
    d: 'iron_dark',       // lantern shoe, cap, arm, brace, hook, cage frame
    i: 'iron_light',      // lantern arm top edge, hood rim, finials
    E: 'ember_glow',      // lit lantern panes (emissive 0.9)
    C: 'ember_core',      // the hot centre pane of each lit face (emissive 1.0)
    M: 'mirror_dark',     // the unlit lantern's dark glass
    z: 'bronze',          // pedestal bands + plaque
    Z: 'bronze_light'     // pedestal band corners, plaque corners, the top inlay ring
  };
  function matsOf(G) {
    var used = {}, o = {}, k;
    G.each(function (x, y, z, c) { used[c] = 1; });
    for (k in KEY) if (used[k]) o[k] = KEY[k];
    return o;
  }
  function idle1() { return { durations: [1000], loop: true, frames: [{}] }; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  // prop-local collider box (architecture.md 37.10) from a half-open voxel box, relative to the anchor
  function boxCol(b, anchor, cm) {
    return { type: 'box',
      c: [r3(((b[0] + b[3]) / 2 - anchor[0]) * cm), r3(((b[1] + b[4]) / 2 - anchor[1]) * cm), r3(((b[2] + b[5]) / 2 - anchor[2]) * cm)],
      half: [r3((b[3] - b[0]) / 2 * cm), r3((b[4] - b[1]) / 2 * cm), r3((b[5] - b[2]) / 2 * cm)] };
  }
  function world(size, g0, cm) { return { w: r3(size[0] * cm), d: r3(size[1] * cm), h: r3((size[2] - g0) * cm) }; }

  // waystone paint shared by the 3 variants: lichen / moss top rim, damp foot, moss up the -x flank, lichen specks
  function paintStone(G, G0, seed, mossTop, mossFlankQ, mossFlank0) {
    var paint = [];
    G.each(function (x, y, z, c) {
      if (c !== 's' || !G.exposed(x, y, z)) return;
      var q = z - G0, h = hash(x, y, z, seed), out = c;
      if (!G.full(x, y, z + 1)) out = hash(x >> 1, y >> 1, z, seed + 1) < mossTop ? 'm' : 'S';
      else if (q <= 0 || (q === 1 && h < 0.5)) out = 'k';
      else if (!G.full(x - 1, y, z) && q <= mossFlankQ && hash(x, y >> 1, z, seed + 2) < mossFlank0 - 0.05 * q) out = 'm';
      else if (q >= 4 && h < 0.06) out = 'S';
      if (out !== c) paint.push([x, y, z, out]);
    });
    applyPaint(G, paint);
  }
  function pebbles(G, G0, list) {   // half-sunk packing stones: dark sides, pale (or mossy) top
    var i, p;
    for (i = 0; i < list.length; i++) { p = list[i]; G.set(p[0], p[1], p[2] + G0, 'k'); }
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (p[2] < 0 || G.full(p[0], p[1], p[2] + G0 + 1)) continue;
      G.set(p[0], p[1], p[2] + G0, hash(p[0], p[1], 7, 3) < 0.35 ? 'm' : 'S');
    }
  }

  // ===================================================================================================================
  // 1. WAYSTONE VARIANTS (cellM 0.125 = the US-026a waystone's, so slate texture, lichen and moss match it).
  //    The end waystone keeps the ONLY aether mark (style guide 2: reserved hue). The variants' marks are the same sign
  //    cut into the stone but cold: waystone_dark grooves. Reads as "the same road, older stones, the signal is not in
  //    them". Option for the PO (not built): an `awake` remap waystone_dark -> waystone_mark on a chosen stone.
  // ===================================================================================================================
  var WS_CM = 0.125;

  // 1a. waystoneSmall: 8 x 6 x 12, 2 buried layers -> 1.0 x 0.5 x 1.25 m above the turf. Domed top, flat front.
  function buildWaystoneSmall() {
    var SX = 8, SY = 6, SZ = 12, G0 = 2, CX = 4, G = new Grid(SX, SY, SZ), x, y, z, q;
    function hw(q) { return 3.6 - 1.0 * Math.max(0, q) / 9; }
    function yBack(q) { return q < 4 ? 5 : 4; }                                    // exclusive; front plane y 1
    function topH(x) { var d = Math.abs(x + 0.5 - CX); return 9 - Math.round(d * d / 4); }
    for (z = 0; z < SZ; z++) {
      q = z - G0;
      for (y = 1; y < SY; y++) for (x = 0; x < SX; x++) {
        if (Math.abs(x + 0.5 - CX) >= hw(q) || y >= yBack(q) || q > topH(x)) continue;
        G.set(x, y, z, q < 0 ? 'k' : 's');
      }
    }
    paintStone(G, G0, 71, 0.40, 5, 0.62);
    // the mark (ring over a short stroke), cut dark into the front plane, rows top-first from q 7
    var MARK = ['.kk.', 'k..k', 'k..k', '.kk.', '.kk.'], r, cc;
    for (r = 0; r < MARK.length; r++) for (cc = 0; cc < 4; cc++) {
      if (MARK[r].charAt(cc) === 'k' && G.full(2 + cc, 1, G0 + 7 - r)) G.set(2 + cc, 1, G0 + 7 - r, 'k');
    }
    pebbles(G, G0, [[1, 0, 0], [2, 0, 0], [6, 0, 0], [6, 0, -1], [2, 5, 0], [5, 5, 0], [5, 5, -1]]);
    return { G: G, G0: G0 };
  }

  // 1b. waystoneLeaning: 12 x 8 x 19, 2 buried -> ~1.1 x 0.6 x 2.1 m, top shifted 3 voxels (0.375 m) east = ~12 deg.
  function buildWaystoneLeaning() {
    var SX = 12, SY = 8, SZ = 19, G0 = 2, G = new Grid(SX, SY, SZ), x, y, z, q;
    function shift(q) { return Math.floor(Math.max(0, q) * 0.19); }
    function cx(q) { return 4.5 + shift(q); }
    function hw(q) { var t = Math.max(0, q) / 16; return 4.0 - 1.3 * t + 0.2 * Math.sin(Math.PI * t); }
    function yBack(q) { return q < 3 ? 7 : q < 10 ? 6 : 5; }                       // exclusive; front plane y 2
    for (z = 0; z < SZ; z++) {
      q = z - G0;
      for (y = 2; y < SY; y++) for (x = 0; x < SX; x++) {
        var lx = x + 0.5 - cx(q);
        if (Math.abs(lx) >= hw(q) || y >= yBack(q) || q > (lx < 0 ? 16 : 15)) continue;
        G.set(x, y, z, q < 0 ? 'k' : 's');
      }
    }
    // chip off the front top (east of centre)
    for (x = 0; x < SX; x++) for (z = G0 + 14; z < SZ; z++) if (x + 0.5 - cx(z - G0) > 0.5) G.set(x, 2, z, '.');
    paintStone(G, G0, 81, 0.55, 12, 0.70);
    // the mark, sheared with the lean, worn (some grooves filled), rows top-first from q 13
    var MARK = ['.kkkk.', 'k....k', 'k.kk.k', 'k....k', '.kkkk.', '..kk..', '..kk..', '..kk..', 'kkkkkk'], r, cc, mx, mz;
    for (r = 0; r < MARK.length; r++) for (cc = 0; cc < 6; cc++) {
      mz = G0 + 13 - r; mx = Math.floor(cx(13 - r)) - 3 + cc;
      if (MARK[r].charAt(cc) !== 'k' || !G.full(mx, 2, mz)) continue;
      if (r < MARK.length - 1 && hash(mx, 2, mz, 83) < 0.18) continue;
      G.set(mx, 2, mz, 'k');
    }
    // a crack down the front face, from the high shoulder into the ring
    for (q = 12; q >= 7; q--) {
      mx = Math.round(cx(q) + 1.5 - (12 - q) * 0.5);
      if (G.full(mx, 2, G0 + q)) G.set(mx, 2, G0 + q, 'k');
    }
    // heaved sod on the west (uphill of the lean) side: a moss lip at the foot
    for (y = 2; y < 7; y++) if (!G.full(0, y, G0)) G.set(0, y, G0, 'm');
    pebbles(G, G0, [[10, 3, 0], [11, 3, 0], [10, 4, 0], [10, 3, 1], [2, 0, 0], [3, 1, 0], [6, 1, 0], [9, 7, 0], [3, 7, 0]]);
    return { G: G, G0: G0 };
  }

  // 1c. waystoneFallen: 22 x 10 x 7, 1 buried -> 2.75 x 1.25 x 0.75 m. Stub (west) + 2 lying halves, mark face UP.
  function buildWaystoneFallen() {
    var SX = 22, SY = 10, SZ = 7, G0 = 1, G = new Grid(SX, SY, SZ), x, y, z, q, h;
    // stub of the foot, still standing, broken top
    for (y = 2; y < 8; y++) for (x = 1; x < 6; x++) {
      h = 2 + Math.floor(hash(x, y, 0, 91) * 3);
      for (q = -1; q <= h; q++) G.set(x, y, q + G0, q < 0 ? 'k' : 's');
    }
    // piece A (the lower half, lying on its back): 7 long, 7 wide, 4 thick; rounded long edges; broken east end
    for (x = 7; x < 14; x++) for (y = 2; y < 9; y++) {
      h = (y === 2 || y === 8) ? 2 : 3;
      if (x === 13) h -= hash(x, y, 1, 92) < 0.6 ? 1 : 0;
      for (q = -1; q <= h; q++) G.set(x, y, q + G0, q < 0 ? 'k' : 's');
    }
    // piece B (the upper half): 7 long, 6 wide, tapering to the old rounded top at the east end; broken west end
    for (x = 15; x < 22; x++) for (y = 3; y < 9; y++) {
      if (x >= 20 && (y === 3 || y === 8)) continue;
      h = x < 19 ? 3 : 2;
      if (y === 3 || y === 8) h -= 1;
      if (x === 15) h -= hash(x, y, 1, 93) < 0.5 ? 1 : 0;
      for (q = -1; q <= h; q++) G.set(x, y, q + G0, q < 0 ? 'k' : 's');
    }
    // chips in the gaps
    [[14, 4, 0], [14, 6, 0], [6, 3, 0], [6, 6, 0]].forEach(function (p) { G.set(p[0], p[1], p[2] + G0, 's'); });
    paintStone(G, G0, 95, 0.32, 3, 0.60);
    // the mark on the up faces: ring + centre on piece B, the stroke on piece A (the crack runs through it);
    // a third of the grooves under moss ("half under moss", writer scrawl.waystone)
    for (x = 7; x < 22; x++) for (y = 2; y < 9; y++) {
      z = G.top(x, y); if (z < G0) continue;
      var d = Math.hypot(x + 0.5 - 18.5, y + 0.5 - 6), cut = false;
      if (x >= 15 && ((d >= 1.4 && d <= 2.4) || d < 0.8)) cut = true;
      if (x >= 9 && x <= 13 && (y === 5 || y === 6) && hash(x, y, z, 96) >= 0.25) cut = true;
      if (cut) G.set(x, y, z, hash(x, y, z, 97) < 0.33 ? 'm' : 'k');
    }
    return { G: G, G0: G0 };
  }

  function waystoneRecord(key, B, anchor, display, desc, colliders, readability, mounts) {
    var size = [B.G.sx, B.G.sy, B.G.sz];
    return {
      name: key, displayName: display, desc: desc,
      voxel: {
        version: 1, cellM: WS_CM, size: size, anchor: anchor, meshOnly: true,
        mats: matsOf(B.G), layers: B.G.layers(),
        parts: { stone: { box: [0, 0, 0, size[0], size[1], size[2]], pivot: anchor.slice() } },
        animations: { idle: idle1() },
        mounts: mounts
      },
      world: world(size, B.G0, WS_CM),
      colliders: colliders,
      group: 'waystone',
      placement: { z: 'ground', note: 'world prop (components.voxel, anim idle). Not placed: the content row picks spots along ' +
        'the pencil line (overworld_far recipe.path). Keep >= 4 m from the end waystone so the one teal mark stays unique.' },
      readability: { note: readability }
    };
  }

  var bWS = buildWaystoneSmall();
  A.voxelModels.waystoneSmall = waystoneRecord('waystoneSmall', bWS, [4, 3, bWS.G0], 'road waystone',
    'Small road waystone (S8-A-08): a 1.25 m slate marker with a domed lichen top, moss on its north flank, a damp ' +
    'foot with packing stones and the waystone sign (ring over a stroke) cut into its flat front, gone dark.',
    [{ type: 'box', c: [0, 0, 0.625], half: [0.45, 0.25, 0.625] }],
    'At 10 m (240x90): ~11 rows tall, the ring ~3 rows; the dark slate upright + pale cap read on grass.',
    { mark: { at: [4, 1, bWS.G0 + 6], part: 'stone' }, top: { at: [4, 3, bWS.G0 + 10], part: 'stone' },
      front: { at: [4, 0, bWS.G0], part: 'stone' } });

  var bWL = buildWaystoneLeaning();
  A.voxelModels.waystoneLeaning = waystoneRecord('waystoneLeaning', bWL, [4.5, 4.5, bWL.G0], 'leaning waystone',
    'Leaning waystone (S8-A-08): a 2.1 m slate stone tipped ~12 deg east, its west foot heaved out of the sod, moss ' +
    'heavy on the up-facing flank and the top, a crack running from the shoulder into its worn, dark-cut sign.',
    [{ type: 'box', c: [0, 0, 0.5], half: [0.44, 0.31, 0.5] },
     { type: 'box', c: [0.25, -0.125, 1.5625], half: [0.38, 0.25, 0.5625] }],
    'At 10 m (240x90): ~18 rows tall; the lean reads in silhouette at half size (style guide 5.8).',
    { mark: { at: [6, 2, bWL.G0 + 11.5], part: 'stone' }, top: { at: [6.5, 3.5, bWL.G0 + 17], part: 'stone' },
      front: { at: [4.5, 0, bWL.G0], part: 'stone' } });

  var bWF = buildWaystoneFallen();
  A.voxelModels.waystoneFallen = waystoneRecord('waystoneFallen', bWF, [11, 5.5, bWF.G0], 'fallen waystone',
    'Fallen waystone (S8-A-08): the stone toppled east and broke in two; its stub still stands in the turf. The sign ' +
    'faces the sky, the ring on the upper half, the stroke on the lower, the crack between them, a third under moss.',
    [{ type: 'box', c: [-0.9375, -0.0625, 0.3125], half: [0.3125, 0.375, 0.3125] },
     { type: 'box', c: [-0.0625, 0, 0.25], half: [0.4375, 0.4375, 0.25] },
     { type: 'box', c: [0.9375, 0.0625, 0.25], half: [0.4375, 0.375, 0.25] }],
    'Low (0.5-0.6 m): from 10 m it is a grey broken line in the grass; the ring reads from above (the breach, the slope).',
    { mark: { at: [18.5, 6, bWF.G0 + 4], part: 'stone' }, top: { at: [3, 5, bWF.G0 + 5], part: 'stone' },
      front: { at: [11, 0, bWF.G0], part: 'stone' } });

  // ===================================================================================================================
  // 2. LANTERN POST (cellM 0.06, 14 x 7 x 43, 2 buried layers -> 2.46 m): stone foot, iron shoe, timber post, iron
  //    cap + finial, iron arm east with a diagonal brace, a hook, a 5 x 5 cage lamp (hood, 3 x 3 panes per face,
  //    base, drip finial). 3 hue families: wood, grey (iron + stone foot), fire.
  //    LIT / UNLIT = a part swap (the lamp / relay hide trick, README 7): `lampLit` (glowing ember panes, hot centre
  //    pane) is the rest pose; `lampDark` (the same cage with dark glass) is stored SEALED inside the stone foot.
  //    Clip `unlit` moves lampLit 64 voxels down and lampDark +[8, 0, 28] onto lampLit's box. Voxels cannot glow
  //    through glass, so the panes themselves are the emissive surface.
  //    LIGHT: emissive voxels do not light the ground - ENGINE / CONTENT: a point light `lanternHang` (palette lights,
  //    0.9, r 3.0 m, lanternWarm) at mounts.light while lit (propsM1.lanternPost.light).
  // ===================================================================================================================
  var LP_CM = 0.06;
  function lampCage(G, x0, y0, z0, lit) {     // 5 x 5 x 5 block at (x0, y0, z0)
    var x, y, z, ex, ey;
    for (z = 0; z < 5; z++) for (y = 0; y < 5; y++) for (x = 0; x < 5; x++) {
      ex = x === 0 || x === 4; ey = y === 0 || y === 4;
      var c;
      if ((ex && ey) || ((z === 0 || z === 4) && (ex || ey))) c = 'd';                         // corner posts, frame rings
      else if (ex || ey) c = lit ? (z === 2 && (x === 2 || y === 2) ? 'C' : 'E') : 'M';        // panes
      else c = lit ? 'E' : 'd';                                                                  // inside (hidden)
      G.set(x0 + x, y0 + y, z0 + z, c);
    }
  }
  function buildLanternPost() {
    var SX = 14, SY = 7, SZ = 43, G0 = 2, G = new Grid(SX, SY, SZ), x, y, z;
    // stone foot 7 x 7 x 7 (z0..1 buried), dark sides, pale top. Top corners stay SOLID (no bevel): the z6 layer is
    // part of the dark lamp's sealing shell (preview check 'dark lamp sealed', incl. edge/corner shell cells).
    G.box(0, 0, 0, 7, 7, 7, 'D');
    for (y = 0; y < 7; y++) for (x = 0; x < 7; x++) G.set(x, y, 6, 'T');
    // the dark lamp, sealed in the foot (x1..5, y1..5, z1..5; shell solid all round)
    lampCage(G, 1, 1, 1, false);
    // post: iron shoe z7..8, timber z9..40, iron cap z41, finial z42
    G.box(2, 2, 7, 5, 5, 9, 'd');
    G.box(2, 2, 9, 5, 5, 41, 'w');
    G.box(2, 2, 41, 5, 5, 42, 'd');
    G.set(3, 3, 42, 'i');
    // arm east at z38..39 (bright top edge), curl at the end, diagonal brace, hook
    for (x = 5; x <= 12; x++) { G.set(x, 3, 38, 'd'); G.set(x, 3, 39, 'i'); }
    G.set(12, 3, 40, 'i');
    for (x = 0; x < 5; x++) G.set(5 + x, 3, 33 + x, 'd');
    G.set(11, 3, 37, 'd'); G.set(11, 3, 36, 'i');
    // lamp: hood z34..35, cage z29..33 (lit), base z28, drip cup z27, finial z26
    for (y = 1; y < 6; y++) for (x = 9; x < 14; x++) {
      var corner = (x === 9 || x === 13) && (y === 1 || y === 5), rim = x === 9 || x === 13 || y === 1 || y === 5;
      if (!corner) G.set(x, y, 34, rim ? 'i' : 'd');
      if (!corner) G.set(x, y, 28, 'd');
    }
    G.box(10, 2, 35, 13, 5, 36, 'd');
    lampCage(G, 9, 1, 29, true);
    G.box(10, 2, 27, 13, 5, 28, 'd');
    G.set(11, 3, 26, 'i');
    return { G: G, G0: G0 };
  }
  var bLP = buildLanternPost(), LP_SIZE = [14, 7, 43], LP_ANCHOR = [3.5, 3.5, 2];
  var LP_HIDE = [0, 0, -64], LP_SWAP = [8, 0, 28];
  A.voxelModels.lanternPost = {
    name: 'lanternPost', displayName: 'road lantern',
    desc: 'Lantern post (S8-A-08): an old watch road lantern. Squat stone foot, iron shoe, a weathered timber post with ' +
          'an iron cap, an iron arm with a diagonal brace, and a 5-voxel cage lamp on a hook: hood, frame, 3 x 3 ' +
          'glowing ember panes per face with a hot centre pane. Unlit = the same cage with dark glass.',
    voxel: {
      version: 1, cellM: LP_CM, size: LP_SIZE, anchor: LP_ANCHOR, meshOnly: true,
      mats: matsOf(bLP.G), layers: bLP.G.layers(),
      parts: {                                   // order matters: the first box owns a cell
        lampDark: { box: [1, 1, 1, 6, 6, 6],     pivot: [3.5, 3.5, 3.5] },                      // sealed in the foot
        lampLit:  { box: [9, 1, 29, 14, 6, 34],  pivot: [11.5, 3.5, 31.5] },                    // rest = lit
        postLow:  { box: [0, 0, 0, 7, 7, 24],    pivot: LP_ANCHOR.slice() },                    // extent 38
        postHigh: { box: [0, 0, 24, 14, 7, 43],  pivot: LP_ANCHOR.slice(), parent: 'postLow' } // extent 40
      },
      animations: {
        lit:   { durations: [1000], loop: true, frames: [{}] },
        unlit: { durations: [1000], loop: true, frames: [{ lampLit: { pos: LP_HIDE }, lampDark: { pos: LP_SWAP } }] }
      },
      mounts: {
        light: { at: [11.5, 3.5, 31.5], part: 'postHigh' },   // lamp centre (1.77 m up, 0.48 m east of the post)
        lamp:  { at: [11.5, 3.5, 26], part: 'postHigh' },     // under the drip finial
        hook:  { at: [11.5, 3.5, 37], part: 'postHigh' },
        top:   { at: [3.5, 3.5, 43], part: 'postHigh' },
        foot:  { at: [3.5, 0, 2], part: 'postLow' }
      }
    },
    world: world(LP_SIZE, bLP.G0, LP_CM),
    colliders: [
      { type: 'box', c: [0, 0, 0.15], half: [0.21, 0.21, 0.15] },        // stone foot (0.30 m: steppable)
      { type: 'prism', c: [0, 0, 1.38], r: 0.09, h: 2.16 },             // post
      { type: 'box', c: [0.48, 0, 1.74], half: [0.15, 0.15, 0.30] }     // lamp (head height)
    ],
    group: 'lanternPost',
    placement: { z: 'ground', note: 'world / level prop (components.voxel, anim lit | unlit) + one light entry at ' +
      'mounts.light (propsM1.lanternPost.light). Not placed: content picks spots (e.g. the tower door, the road bend). ' +
      'facing turns the arm; face it over the path so the pool lands on the road.' },
    readability: { note: 'At 10 m (240x90): post ~20 rows tall, lamp ~5 rows of warm glyphs; at night the panes are ' +
      'the brightest cells in view after the end waystone mark. Half-size test: post + arm + lamp still an inverted L.' }
  };

  // ===================================================================================================================
  // 3. BREACH RUBBLE (cellM 0.06, 36 x 26 x 15 -> 2.16 x 1.56 x 0.90 m, 4 static quadrant parts for the 48 limit).
  //    Cut wall blocks from the broken summit wall (block_light tops / block_dark sides = the tower rubble language,
  //    no wall stone tone), a tilted block leaning on the stack, a snapped floor beam (timber_old, wood_cut ends) on
  //    two flat floor slabs, chips, moss cushions on the shaded (south) side. 3 hue families: stone, wood, moss.
  //    The low front blocks step 0.18 / 0.36 / 0.42 m, so the heap can be climbed from the front (0.45 m step-up).
  // ===================================================================================================================
  var BR_CM = 0.06, BR_SIZE = [36, 26, 15], BR_ANCHOR = [18, 13, 0];
  var BR_BLOCKS = [                          // [x0, y0, z0, x1, y1, z1] half-open; `col` = gets a collider box
    { b: [2, 6, 0, 16, 13, 6],   col: true },   // B1 long block
    { b: [17, 4, 0, 27, 12, 7],  col: true },   // B2
    { b: [9, 7, 6, 21, 14, 11],  col: true },   // B3 stacked across B1 / B2
    { b: [4, 15, 0, 10, 20, 4],  col: true },   // B5
    { b: [20, 15, 0, 25, 21, 3], col: true },   // B6
    { b: [12, 0, 0, 18, 5, 3],   col: true },   // B7 low front step
    { b: [12, 14, 0, 21, 22, 8], col: true },   // B8 back block
    { b: [19, 21, 0, 32, 26, 2], col: false },  // B9 flat floor slab under the beam's high end (0.12 m)
    { b: [10, 20, 0, 19, 26, 1], col: false }   // B10 thin slab under the beam's middle (0.06 m)
  ];
  function buildBreachRubble() {
    var G = new Grid(BR_SIZE[0], BR_SIZE[1], BR_SIZE[2]), i, b, x, y, z, h;
    for (i = 0; i < BR_BLOCKS.length; i++) {
      b = BR_BLOCKS[i].b;
      G.box(b[0], b[1], b[2], b[3], b[4], b[5], 'D');
      // broken top corners (each corner column loses its top voxel by hash), one deeper bite on the big blocks
      [[b[0], b[1]], [b[3] - 1, b[1]], [b[0], b[4] - 1], [b[3] - 1, b[4] - 1]].forEach(function (p, j) {
        if (hash(p[0], p[1], i, 101 + j) < 0.55) G.set(p[0], p[1], b[5] - 1, '.');
      });
      if (b[5] - b[2] >= 5) for (x = b[0] + 1; x < b[0] + 3; x++) G.set(x, b[1], b[5] - 1, '.');
    }
    // B4: a block tilted against B2's east face (stepped top 10 -> 5)
    for (x = 27; x < 33; x++) G.box(x, 7, 0, x + 1, 15, 10 - (x - 27), 'D');
    // the snapped beam: 2 wide (y 23..24), 2 thick, rising along x on the two slabs, broken east end
    for (x = 1; x <= 30; x++) {
      var zb = x <= 10 ? 0 : x <= 18 ? 1 : 2;
      for (y = 23; y <= 24; y++) for (z = zb; z < zb + 2; z++) G.set(x, y, z, (x === 1 || x === 30) ? 'c' : 'w');
    }
    G.set(31, 23, 3, 'w'); G.set(32, 24, 3, 'c');                       // splinters
    // chips: scattered single / double voxels on empty ground
    for (i = 0; i < 18; i++) {
      x = Math.floor(hash(i, 1, 0, 111) * BR_SIZE[0]); y = Math.floor(hash(i, 2, 0, 112) * BR_SIZE[1]);
      if (G.full(x, y, 0) || G.full(x + 1, y, 0)) continue;
      G.set(x, y, 0, 'D');
      if (hash(i, 3, 0, 113) < 0.4) G.set(x + 1, y, 0, 'D');
    }
    // paint: top faces pale, moss cushions (2 x 2 patches) on the south half, sides dark
    var paint = [];
    G.each(function (x, y, z, c) {
      if (c !== 'D' || G.full(x, y, z + 1)) return;
      h = hash(x >> 1, y >> 1, z, 121);
      paint.push([x, y, z, (y >= 13 && h < 0.30) || (y < 13 && h < 0.06) ? 'm' : 'T']);
    });
    applyPaint(G, paint);
    return G;
  }
  var gBR = buildBreachRubble();
  A.voxelModels.breachRubble = {
    name: 'breachRubble', displayName: 'breach rubble',
    desc: 'Breach rubble (S8-A-08): the heap where the summit wall broke. Cut blocks with pale weathered tops and dark ' +
          'broken sides, one tilted against the stack, a snapped floor beam lying on two floor slabs, chips, moss ' +
          'cushions on the shaded side. 2.2 x 1.6 m, 0.9 m high, climbable from the front.',
    voxel: {
      version: 1, cellM: BR_CM, size: BR_SIZE, anchor: BR_ANCHOR, meshOnly: true,
      mats: matsOf(gBR), layers: gBR.layers(),
      parts: {                                   // static quadrants (extent 18 + 13 + 15 = 46 each)
        frontW: { box: [0, 0, 0, 18, 13, 15],   pivot: BR_ANCHOR.slice() },
        frontE: { box: [18, 0, 0, 36, 13, 15],  pivot: BR_ANCHOR.slice() },
        backW:  { box: [0, 13, 0, 18, 26, 15],  pivot: BR_ANCHOR.slice() },
        backE:  { box: [18, 13, 0, 36, 26, 15], pivot: BR_ANCHOR.slice() }
      },
      animations: { idle: idle1() },
      mounts: {
        top:  { at: [15, 10, 11], part: 'frontW' },    // the stacked block's top (dust / sparkle anchor)
        dust: { at: [18, 13, 1], part: 'frontW' }
      }
    },
    world: world(BR_SIZE, 0, BR_CM),
    colliders: BR_BLOCKS.filter(function (o) { return o.col; }).map(function (o) { return boxCol(o.b, BR_ANCHOR, BR_CM); })
      .concat([boxCol([27, 7, 0, 33, 15, 8], BR_ANCHOR, BR_CM)]),     // B4 tilted block (mid height)
    group: 'breachRubble',
    placement: { z: 'floor', note: 'level prop (components.voxel, anim idle). Not placed: the content row puts it at the ' +
      'summit breach (the beam end toward the gap) or below it on the slope. Keep a 1.0 m clear corridor to the breach.' },
    readability: { note: 'At 6 m (240x90): ~12 rows; pale block lids over dark sides separate each block; the beam is ' +
      'the one warm brown line.' }
  };

  // ===================================================================================================================
  // 4. SWORD PEDESTAL (cellM 0.05, 18 x 18 x 18 -> 0.9 x 0.9 x 0.9 m): base step (broken SE corner), second step,
  //    an 8 x 8 die with two proud bronze bands + a bronze plaque on its front, a 10 x 10 top slab with a bronze
  //    inlay ring and a 2 x 2 x 3 slot. Old-world metal = bronze, never brass (style guide 2). Moss on the steps,
  //    a crack in the die's east face. 3 hue families: stone, bronze, moss.
  //    The sword (models/sword.js, anchor = 4 voxels above its tip = 0.12 m) stands at mounts.sword: its tip sits
  //    0.12 m deep in the 0.15 m slot. Same facing as the pedestal (blade across x, the slot is square).
  // ===================================================================================================================
  var SP_CM = 0.05, SP_SIZE = [18, 18, 18], SP_ANCHOR = [9, 9, 0];
  function buildSwordPedestal() {
    var G = new Grid(SP_SIZE[0], SP_SIZE[1], SP_SIZE[2]), x, y, z, i;
    G.box(0, 0, 0, 18, 18, 3, 'g');            // base step
    for (z = 1; z < 3; z++) for (y = 15; y < 18; y++) for (x = 15; x < 18; x++) {
      if ((x - 15) + (y - 15) >= 1 + (z === 1 ? 1 : 0)) G.set(x, y, z, '.');   // broken SE corner (outside step 2)
    }
    G.box(2, 2, 3, 16, 16, 6, 'g');            // second step
    G.box(5, 5, 6, 13, 13, 16, 'L');           // die
    for (y = 5; y < 13; y++) for (x = 5; x < 13; x++) for (z = 6; z < 8; z++) G.set(x, y, z, 'g');   // damp die foot
    // proud bronze bands at z7 and z14 (ring x/y 4..13), bright corners
    [7, 14].forEach(function (bz) {
      for (y = 4; y < 14; y++) for (x = 4; x < 14; x++) {
        if (x !== 4 && x !== 13 && y !== 4 && y !== 13) continue;
        G.set(x, y, bz, ((x === 4 || x === 13) && (y === 4 || y === 13)) ? 'Z' : 'z');
      }
    });
    // plaque on the front face (y 4), z9..11
    var PLQ = ['ZzzZ', 'zzzz', 'ZzzZ'];
    for (i = 0; i < 3; i++) for (x = 0; x < 4; x++) G.set(7 + x, 4, 11 - i, PLQ[i].charAt(x));
    // top slab z16..17
    G.box(4, 4, 16, 14, 14, 18, 'L');
    // crack down the die's east face (x 12)
    [[12, 9, 13], [12, 9, 12], [12, 8, 11], [12, 8, 10], [12, 9, 9]].forEach(function (p) { G.set(p[0], p[1], p[2], 'g'); });
    // top faces: steps -> granite_light / moss, slab top -> pale block_light, inlay ring + dark slot rim
    var paint = [];
    G.each(function (x, y, z, c) {
      if (G.full(x, y, z + 1) || c === 'z' || c === 'Z') return;
      if (z === 17) {
        var m = Math.max(Math.abs(x + 0.5 - 9), Math.abs(y + 0.5 - 9));
        paint.push([x, y, z, m === 3.5 ? 'Z' : m <= 1.5 ? 'D' : 'T']);
      } else if (z <= 5) {
        var h = hash(x >> 1, y >> 1, z, 131);
        paint.push([x, y, z, h < (z <= 2 ? 0.34 : 0.18) ? 'm' : 'L']);
      }
    });
    applyPaint(G, paint);
    // moss creeping up the base step's north and west sides
    for (x = 0; x < 18; x++) if (hash(x >> 1, 0, 0, 133) < 0.3) G.set(x, 0, 0, 'm');
    for (y = 0; y < 18; y++) if (hash(0, y >> 1, 0, 134) < 0.3) G.set(0, y, 0, 'm');
    // the slot: x8..9, y8..9, z15..17 (bottom = the die at z14)
    G.box(8, 8, 15, 10, 10, 18, '.');
    return G;
  }
  var gSP = buildSwordPedestal();
  A.voxelModels.swordPedestal = {
    name: 'swordPedestal', displayName: 'sword pedestal',
    desc: 'Sword pedestal (S8-A-08): the old watch\'s stone pedestal. Two worn granite steps (moss, a broken corner), a ' +
          'pale die with two proud bronze bands and a small bronze plaque, a top slab with a bronze inlay ring round ' +
          'a dark slot where the ruin-steel sword stands.',
    voxel: {
      version: 1, cellM: SP_CM, size: SP_SIZE, anchor: SP_ANCHOR, meshOnly: true,
      mats: matsOf(gSP), layers: gSP.layers(),
      parts: {
        base: { box: [0, 0, 0, 18, 18, 6],  pivot: SP_ANCHOR.slice() },                     // extent 42
        die:  { box: [4, 4, 6, 14, 14, 18], pivot: SP_ANCHOR.slice(), parent: 'base' }      // extent 32
      },
      animations: { idle: idle1() },
      mounts: {
        sword:  { at: [9, 9, 18], part: 'die' },      // slab top at the slot centre = the sword prop's anchor point
        slot:   { at: [9, 9, 15], part: 'die' },      // slot bottom
        plaque: { at: [9, 4, 10], part: 'die' },      // front plaque (scrawl / decal anchor, e.g. STEEL FOR THE HUSH)
        prompt: { at: [9, 2, 20], part: 'die' },
        front:  { at: [9, 0, 0], part: 'base' }
      }
    },
    world: world(SP_SIZE, 0, SP_CM),
    colliders: [
      boxCol([0, 0, 0, 18, 18, 3], SP_ANCHOR, SP_CM),    // base step 0.15 m
      boxCol([2, 2, 3, 16, 16, 6], SP_ANCHOR, SP_CM),    // second step to 0.30 m (both steppable)
      boxCol([4, 4, 6, 14, 14, 18], SP_ANCHOR, SP_CM)    // die + slab to 0.90 m
    ],
    sword: { model: 'sword', mount: 'sword', facingOffsetDeg: 0, buriedM: 0.12, slotDepthM: 0.15,
             note: 'place the sword prop at the pedestal transform + mounts.sword (prop-local (0, 0, 0.90) m), same facing. ' +
                   'The sword pickup keeps its own interactable / glint / take flow (US-078).' },
    group: 'swordPedestal',
    placement: { z: 'floor', note: 'level / world prop (components.voxel, anim idle). Not placed: an option for the sword ' +
      'spot (today it is planted in the tower rubble heap, levelPatch.towerSword). Owner / PO pick.' },
    readability: { note: 'At 5 m (240x90): ~13 rows; the pale die + bronze bands frame the dark sword; the inlay ring ' +
      'reads from the stair above.' }
  };

  // ===================================================================================================================
  // 5. REGISTER + SUMMARY
  // ===================================================================================================================
  var KEYS = ['waystoneSmall', 'waystoneLeaning', 'waystoneFallen', 'lanternPost', 'breachRubble', 'swordPedestal'];
  KEYS.forEach(function (k) { A.models[k] = A.voxelModels[k]; });
  A.propsM1 = {
    version: 1,
    story: 'S8-A-08',
    keys: KEYS,
    groups: {
      waystone: ['waystoneSmall', 'waystoneLeaning', 'waystoneFallen'],
      lanternPost: ['lanternPost'],
      breachRubble: ['breachRubble'],
      swordPedestal: ['swordPedestal']
    },
    budget: { lod0Tris: 2000, partExtentSum: 48, parts: 8, hueFamilies: 3,
              note: 'style guide 5.14; LOD0 / LOD1 tris = engine/mesh/voxelMesh.js, shown in preview/props-m1.html' },
    lanternPost: {
      clipFor: { lit: 'lit', unlit: 'unlit' },
      light: { preset: 'lanternHang', mount: 'light', on: { lit: true, unlit: false },
               offsetM: [0.48, 0, 1.77],
               note: 'ENGINE / CONTENT: emissive panes do not light the ground; add a level/world light (preset ' +
                     'lanternHang) at the mount while the post is lit.' }
    },
    hueFamily: { waystone_light: 'stone', waystone: 'stone', waystone_dark: 'stone', block_light: 'stone',
                 block_dark: 'stone', granite_light: 'stone', granite_dark: 'stone', iron_dark: 'stone',
                 iron_light: 'stone', mirror_dark: 'stone', moss_cap: 'moss', timber_old: 'wood', wood_cut: 'wood',
                 ember_glow: 'fire', ember_core: 'fire', bronze: 'bronze', bronze_light: 'bronze' }
  };

  if (typeof module === 'object' && module && module.exports) {
    var out = { propsM1: A.propsM1 };
    KEYS.forEach(function (k) { out[k] = A.voxelModels[k]; });
    module.exports = out;
  }
})(typeof window !== 'undefined' ? window : globalThis);
