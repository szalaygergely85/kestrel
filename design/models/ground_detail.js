/*
 * Kestrel - GROUND DETAIL (ENV-01d, architecture.md 37.4 "Missing -> designer"; owner D-038 "alive world").
 * The small things the 37.4 scatter puts on the terrain around the player: rocks, tall grass tufts, flowers,
 * ferns, toadstools, fallen logs, stumps, bushes, pebbles. Chunky Build/Blood-style voxel props, meshOnly,
 * static, one part 'body', no clips. Built at load from compact data (heightfields, crossed blade sheets,
 * explicit boxes) so every shape stays readable as data.
 *
 *   key           group     size (m, w x d x h)   cellM  LOD0 cap  collider (recipe.detail literal)       est. LOD0 tris
 *   rockSmallA    rock      0.50 x 0.40 x 0.30    0.10   400       -                                      ~70
 *   rockSmallB    rock      0.55 x 0.44 x 0.33    0.11   400       -                                      ~70
 *   rockMedA      rock      1.12 x 0.96 x 0.80    0.16   400       prism r 0.44 h 0.76                    ~175
 *   rockMedB      rock      1.40 x 1.20 x 0.80    0.20   400       prism r 0.55 h 0.75                    ~210
 *   rockLargeA    rock      2.24 x 1.92 x 1.60    0.32   400       prism r 0.88 h 1.52                    ~175 (same voxels as MedA)
 *   rockLargeB    rock      2.80 x 2.40 x 1.60    0.40   400       prism r 1.10 h 1.50                    ~210 (same voxels as MedB)
 *   pebbles       pebble    0.54 x 0.54 x 0.12    0.06   150      -                                      ~95
 *   tuftMeadow    tuft      0.49 x 0.49 x 0.56    0.07   150       -                                      ~120
 *   tuftLush      tuft      0.42 x 0.42 x 0.42    0.06   150       -                                      ~115
 *   tuftShort     tuft      0.30 x 0.30 x 0.30    0.06   150       -                                      ~70
 *   flowersYellow flower    0.42 x 0.42 x 0.48    0.06   150       -                                      ~115
 *   flowersWhite  flower    (same shape, white petals)               150                                       ~115
 *   flowersPink   flower    (same shape, pink petals)                150                                       ~115
 *   mushrooms     mushroom  0.35 x 0.35 x 0.30    0.05   150      -                                      ~105
 *   fern          bush      1.28 x 1.28 x 0.43    0.085  400       -                                      ~290
 *   bushRound     bush      0.96 x 0.84 x 0.72    0.12   400       -                                      ~280
 *   stumpCut      stump     0.99 x 0.99 x 0.66    0.11   400       prism r 0.33 h 0.55                    ~150
 *   logShort      log       2.00 x 0.56 x 0.56    0.08   600       box hx 0.96 hy 0.24 h 0.52             ~190
 *   logLong       log       2.97 x 0.77 x 0.77    0.11   600       box hx 1.43 hy 0.33 h 0.72             ~190 (same build, L 27)
 *   (log depth = the round section; the branch stub adds one voxel on +y)
 *   (caps = 37.4 item 7: tufts/flowers 150, bushes/rocks/stumps 400, logs 600. The "est." column is a hand count of
 *    greedy quads; preview/ground-detail.html prints the exact LOD0 / LOD1 from the engine mesher and FAILs over a cap.)
 *
 * SIZE VARIETY = variants at another cellM (37.4 item 6, no per-instance scale): rockLargeA/B are rockMedA/B's voxels
 * at 2x cellM; logLong is the logShort build at a longer length and 0.11 m voxels.
 *
 * COLOUR LANGUAGE (readability against the terrain types, style-guide colour rules):
 *   grass ground (grass*, mid yellow-green)  -> rocks pale cool granite tops + dark granite feet (value contrast),
 *                                               tufts darker leaf-green blades with DRY straw tips (meadow) or fresh
 *                                               leaf_light tips (lush), flowers = warm specks (yellow / white / pink,
 *                                               never danger red), bush = leaf greens (deeper + bluer than turf).
 *   forest ground (forestDark / forest)      -> fern + tufts in leaf / leaf_light (lighter than the floor), toadstools
 *                                               orange-brown caps on pale stems, logs/stumps silver-grey timber with a
 *                                               pale sawn/broken end and a moss strip.
 *   rock ground (stone greys)                -> mossy-capped boulders (moss_cap), warm lime-washed block stone
 *                                               (rockSmallB) so the stones separate from the grey ground by hue.
 *
 * COLLIDER NUMBERS (37.4 item 4; literal copies in design/levels/overworld_far.js recipe.detail):
 *   prism r = rVox x cellM (inscribed radius of the engine 8-gon, circumradius r / cos 22.5), measured like the
 *   forest trunks: preview/ground-detail.html checks that >= 85 % of the voxel centres of layers z >= 1 within the
 *   circumradius are solid (no invisible wall) and that the solid core reaches r. h = hVox x cellM (the standing
 *   top; prism spans z - 0.5 .. z + h with z = ground - sinkM, closed top fan so the player can stand on it).
 *   box hx = (L/2 - 0.5) x cellM, hy = 3 x cellM (7-voxel round section inset half a voxel), h = 6.5 x cellM.
 *
 * NEW MATERIALS (appended; v1 palette.js, v2 + remap detail-pass.js, same key): petal_yellow, petal_white,
 * petal_pink, mushroom_cap, wood_cut. Re-used: granite_light, granite_dark, moss_cap, block_light, block_dark,
 * leaf, leaf_dark, leaf_light, straw_light, linen, timber_old.
 *
 * LOAD ORDER: classic script after palette.js and detail-pass.js (no model dependency):
 *   <script src="../design/models/ground_detail.js"></script>
 *   import '../../../design/models/ground_detail.js';   (Node, side-effect import)
 * Exposes: ASSETS.voxelModels.<key>, ASSETS.models.<key> (attach guard as forest_trees.js: only when every material
 *          is known to palette.materials + detailPass.materials), ASSETS.groundDetail = { version, keys, groups,
 *          caps, mats, variants: { <key>: {group, label, cellM, size, widthM, depthM, heightM, capTris, estTris,
 *          collider, rVox, hVox} } } for previews / tests. sinkM / shadow / weights live in the level config only.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  var VM = A.voxelModels;

  // One char per material, shared by every model here (a model's `mats` lists only the chars it uses, in this order).
  var MATS = [
    ['d', 'granite_dark'], ['l', 'granite_light'], ['m', 'moss_cap'], ['k', 'block_dark'], ['p', 'block_light'],
    ['f', 'leaf'], ['s', 'leaf_dark'], ['e', 'leaf_light'], ['t', 'straw_light'],
    ['Y', 'petal_yellow'], ['W', 'petal_white'], ['P', 'petal_pink'],
    ['c', 'mushroom_cap'], ['w', 'linen'], ['b', 'timber_old'], ['o', 'wood_cut']
  ];
  var CAPS = { tuft: 150, flower: 150, mushroom: 150, pebble: 150, rock: 400, bush: 400, stump: 400, log: 600 };

  function round2(v) { return Math.round(v * 100) / 100; }

  // ---------------------------------------------------------------------------------------------------------------
  // dense char grid helpers (x east, y south = row, z up; '.' = empty)
  function grid(sx, sy, sz) {
    var g = { sx: sx, sy: sy, sz: sz, c: new Array(sx * sy * sz) };
    for (var i = 0; i < g.c.length; i++) g.c[i] = '.';
    return g;
  }
  function put(g, x, y, z, ch) {
    if (x < 0 || y < 0 || z < 0 || x >= g.sx || y >= g.sy || z >= g.sz) {
      throw new Error('ground_detail.js: voxel ' + x + ',' + y + ',' + z + ' outside ' + g.sx + 'x' + g.sy + 'x' + g.sz);
    }
    g.c[x + g.sx * (y + g.sy * z)] = ch;
  }
  function box(g, x0, y0, z0, x1, y1, z1, ch) {      // half-open [x0, x1) etc.
    for (var z = z0; z < z1; z++) for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) put(g, x, y, z, ch);
  }
  // rows[y] = one base-36 height per x; band(z, h, x, y) -> material char of voxel z of a column of height h.
  function heightfield(rows, band) {
    var sy = rows.length, sx = rows[0].length, sz = 0, x, y, z, h;
    for (y = 0; y < sy; y++) {
      if (rows[y].length !== sx) throw new Error('ground_detail.js: heightfield row ' + y + ' length ' + rows[y].length + ' != ' + sx);
      for (x = 0; x < sx; x++) sz = Math.max(sz, parseInt(rows[y].charAt(x), 36));
    }
    var g = grid(sx, sy, sz);
    for (y = 0; y < sy; y++) for (x = 0; x < sx; x++) {
      h = parseInt(rows[y].charAt(x), 36);
      for (z = 0; z < h; z++) put(g, x, y, z, band(z, h, x, y));
    }
    return g;
  }
  // Crossed blade sheets (the voxel twin of crossed-quad grass): one 1-voxel sheet along x through the centre row,
  // one along y through the centre column, jagged tops. Bands by ABSOLUTE z (not per blade) so the greedy mesher
  // merges the blade bodies across neighbouring blades (tri cap 150).
  function tuft(xs, ys, band) {
    var n = xs.length, c = (n - 1) / 2, sz = 0, i, z;
    if (ys.length !== n || xs[c] !== ys[c]) throw new Error('ground_detail.js: tuft sheets must be the same odd length with the same centre height');
    for (i = 0; i < n; i++) sz = Math.max(sz, xs[i], ys[i]);
    var g = grid(n, n, sz);
    for (i = 0; i < n; i++) {
      for (z = 0; z < xs[i]; z++) put(g, i, c, z, band(z));
      for (z = 0; z < ys[i]; z++) put(g, c, i, z, band(z));
    }
    return g;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // ROCKS. Heightfields; Build-style terraces. Bands by z: dark foot, pale lit body, optional moss cushion.
  var ROCK_SMALL_A = ['12210', '23321', '13332', '01210'];
  var ROCK_SMALL_B = ['01221', '12332', '12321', '01110'];
  var ROCK_A = [                 // rounded boulder, peak a little north-west of centre
    '0122210',
    '1344321',
    '2455432',
    '2355441',
    '1233321',
    '0112100'
  ];
  var ROCK_B = [                 // broad split slab, moss cushion on every column top of height >= 3
    '1223320',
    '2334431',
    '2334442',
    '1333432',
    '0223321',
    '0011210'
  ];
  function bandSmallGranite(z) { return z < 1 ? 'd' : 'l'; }
  function bandSmallBlock(z) { return z < 1 ? 'k' : 'p'; }
  function bandRockA(z) { return z < 2 ? 'd' : 'l'; }
  function bandRockB(z, h) { return z < 1 ? 'd' : (h >= 3 && z === h - 1 ? 'm' : 'l'); }

  // PEBBLES: 7 loose stones on a 0.6 m patch, pale and dark granite mixed (boxes [x0,y0,z0,x1,y1,z1,ch]).
  function pebbles() {
    var g = grid(10, 10, 2);
    [[1, 1, 0, 3, 3, 1, 'l'], [4, 0, 0, 7, 2, 1, 'd'], [5, 0, 1, 6, 2, 2, 'd'], [7, 3, 0, 9, 5, 1, 'l'],
     [2, 5, 0, 5, 8, 1, 'l'], [3, 6, 1, 5, 8, 2, 'l'], [6, 7, 0, 8, 9, 1, 'd'], [0, 8, 0, 1, 9, 1, 'l'], [8, 0, 0, 9, 1, 1, 'l']]
      .forEach(function (b) { box(g, b[0], b[1], b[2], b[3], b[4], b[5], b[6]); });
    return g;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // TUFTS (crossed sheets; xs = blade heights along x on the centre row, ys = along y on the centre column)
  function tuftMeadow() { return tuft([2, 5, 5, 8, 6, 6, 3], [3, 6, 7, 8, 4, 7, 2], function (z) { return z < 5 ? 'f' : 't'; }); }
  function tuftLush()   { return tuft([2, 4, 4, 7, 5, 5, 3], [3, 5, 6, 7, 4, 4, 2], function (z) { return z < 4 ? 's' : 'e'; }); }
  function tuftShort()  { return tuft([2, 4, 5, 3, 2],       [3, 3, 5, 4, 2],       function (z) { return z < 3 ? 'f' : 'e'; }); }

  // FLOWERS: 4 blooms (2x2 head on a 1-voxel stem under the head's north-west cell) + 1 bud, stems leaf_dark.
  function flowers(petal) {
    var g = grid(8, 8, 8);
    [[1, 1, 6], [5, 2, 8], [2, 5, 5], [6, 6, 7]].forEach(function (f) {
      box(g, f[0], f[1], 0, f[0] + 1, f[1] + 1, f[2] - 1, 's');
      box(g, f[0], f[1], f[2] - 1, f[0] + 2, f[1] + 2, f[2], petal);
    });
    box(g, 4, 4, 0, 5, 5, 3, 's'); put(g, 4, 4, 3, petal);           // bud
    return g;
  }

  // MUSHROOMS: one big bolete-ish toadstool (2x2 stem, 4x4 cap + 2x2 dome, 2 flush pale spots), a medium (3x3 cap)
  // and a small one (2x2 cap). Caps mushroom_cap, stems + spots linen.
  function mushrooms() {
    var g = grid(9, 9, 6);
    box(g, 2, 3, 0, 4, 5, 4, 'w'); box(g, 1, 2, 4, 5, 6, 5, 'c'); box(g, 2, 3, 5, 4, 5, 6, 'c');
    put(g, 4, 3, 4, 'w'); put(g, 2, 4, 5, 'w');
    box(g, 6, 6, 0, 7, 7, 3, 'w'); box(g, 5, 5, 3, 8, 8, 4, 'c');
    box(g, 6, 1, 0, 7, 2, 2, 'w'); box(g, 6, 1, 2, 8, 3, 3, 'c');
    return g;
  }

  // FERN: 4 arching fronds (+x long, +y short, -x long, -y short) from a dark crown, leaflets either side on the
  // middle of each frond, light tips. prof[d] = height (voxel z) of the frond at distance d from the crown.
  function fern() {
    var n = 15, c = 7, g = grid(n, n, 5), prof = [0, 1, 2, 3, 4, 4, 3, 2];
    box(g, c, c, 0, c + 1, c + 1, 3, 's');
    [[1, 0, 7], [0, 1, 6], [-1, 0, 7], [0, -1, 6]].forEach(function (fr) {
      var dx = fr[0], dy = fr[1], len = fr[2];
      for (var d = 1; d <= len; d++) {
        var wmax = d >= 2 && d <= 5 ? 1 : 0, ch = d <= 5 ? 'f' : 'e';
        for (var w = -wmax; w <= wmax; w++) put(g, c + dx * d - dy * w, c + dy * d + dx * w, prof[d], ch);
      }
    });
    return g;
  }

  // BUSH: a round leafy mound (heightfield), dark under-leaves, leaf body, light top.
  var BUSH = [
    '01232100',
    '13455320',
    '24566531',
    '34666642',
    '23566541',
    '12445431',
    '00233210'
  ];
  function bandBush(z) { return z < 2 ? 's' : (z < 5 ? 'f' : 'e'); }

  // STUMP: 7x7 round trunk section (r^2 <= 10.5), 5 voxels tall, sawn top (wood_cut inside r^2 <= 5), 4 root stubs,
  // a 4-voxel splinter crown on the north-east rim.
  function stump() {
    var g = grid(9, 9, 6), c = 4, z, dx, dy;
    for (z = 0; z < 5; z++) for (dy = -3; dy <= 3; dy++) for (dx = -3; dx <= 3; dx++) {
      var r2 = dx * dx + dy * dy;
      if (r2 <= 10.5) put(g, c + dx, c + dy, z, z === 4 && r2 <= 5 ? 'o' : 'b');
    }
    put(g, 0, 3, 0, 'b'); put(g, 8, 5, 0, 'b'); put(g, 5, 0, 0, 'b'); put(g, 3, 8, 0, 'b');
    put(g, 4, 1, 5, 'b'); put(g, 5, 1, 5, 'b'); put(g, 5, 2, 5, 'b'); put(g, 6, 2, 5, 'b');
    return g;
  }

  // LOG: fallen trunk along x, 7x7 round section (dy^2 + dz^2 <= 10.5) centred on y 4.5 / z 3.5. x0 = sawn end
  // (wood_cut ring) with a 2-deep rotten hollow; x L-2..L-1 = broken end (wood_cut, last slice keeps only
  // dy + dz >= 0 = a diagonal break); a moss strip on the top row; a broken branch stub on the +y side.
  function log(L) {
    var g = grid(L, 9, 7), x, dy, dz, mossA = Math.round(L * 0.3), mossB = Math.round(L * 0.62), stubX = Math.round(L * 0.7);
    for (x = 0; x < L; x++) for (dz = -3; dz <= 3; dz++) for (dy = -3; dy <= 3; dy++) {
      var r2 = dy * dy + dz * dz;
      if (r2 > 10.5) continue;
      if (x < 2 && r2 <= 2) continue;                       // hollow
      if (x === L - 1 && dy + dz < 0) continue;            // diagonal break
      var ch = (x === 0 || x >= L - 2) ? 'o' : 'b';
      if (dz === 3 && x >= mossA && x < mossB) ch = 'm';
      put(g, x, 4 + dy, 3 + dz, ch);
    }
    put(g, stubX, 8, 3, 'b'); put(g, stubX, 8, 4, 'b');
    return g;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // model table. rVox/hVox: collider measures (see header); est = hand-counted LOD0 tris (preview prints the exact).
  var DEFS = [
    { key: 'rockSmallA', group: 'rock', label: 'Small granite stone', cellM: 0.10, build: function () { return heightfield(ROCK_SMALL_A, bandSmallGranite); }, est: 70 },
    { key: 'rockSmallB', group: 'rock', label: 'Small lime-washed block stone (warm)', cellM: 0.11, build: function () { return heightfield(ROCK_SMALL_B, bandSmallBlock); }, est: 70 },
    { key: 'rockMedA', group: 'rock', label: 'Granite boulder, knee high', cellM: 0.16, build: function () { return heightfield(ROCK_A, bandRockA); }, est: 175, collider: 'prism', rVox: 2.75, hVox: 4.75 },
    { key: 'rockMedB', group: 'rock', label: 'Split slab with moss cushion', cellM: 0.20, build: function () { return heightfield(ROCK_B, bandRockB); }, est: 210, collider: 'prism', rVox: 2.75, hVox: 3.75 },
    { key: 'rockLargeA', group: 'rock', label: 'Granite boulder, chest high (rockMedA voxels x2)', cellM: 0.32, build: function () { return heightfield(ROCK_A, bandRockA); }, est: 175, collider: 'prism', rVox: 2.75, hVox: 4.75 },
    { key: 'rockLargeB', group: 'rock', label: 'Mossy slab boulder (rockMedB voxels x2)', cellM: 0.40, build: function () { return heightfield(ROCK_B, bandRockB); }, est: 210, collider: 'prism', rVox: 2.75, hVox: 3.75 },
    { key: 'pebbles', group: 'pebble', label: 'Pebble cluster', cellM: 0.06, build: pebbles, est: 95 },
    { key: 'tuftMeadow', group: 'tuft', label: 'Tall meadow grass, dry seed tips', cellM: 0.07, build: tuftMeadow, est: 120 },
    { key: 'tuftLush', group: 'tuft', label: 'Lush grass, fresh tips', cellM: 0.06, build: tuftLush, est: 115 },
    { key: 'tuftShort', group: 'tuft', label: 'Short grass clump', cellM: 0.06, build: tuftShort, est: 70 },
    { key: 'flowersYellow', group: 'flower', label: 'Buttercups (yellow)', cellM: 0.06, build: function () { return flowers('Y'); }, est: 115 },
    { key: 'flowersWhite', group: 'flower', label: 'Daisies (white)', cellM: 0.06, build: function () { return flowers('W'); }, est: 115 },
    { key: 'flowersPink', group: 'flower', label: 'Campions (pink)', cellM: 0.06, build: function () { return flowers('P'); }, est: 115 },
    { key: 'mushrooms', group: 'mushroom', label: 'Toadstool cluster', cellM: 0.05, build: mushrooms, est: 105 },
    { key: 'fern', group: 'bush', label: 'Fern', cellM: 0.085, build: fern, est: 290 },
    { key: 'bushRound', group: 'bush', label: 'Round leafy bush', cellM: 0.12, build: function () { return heightfield(BUSH, bandBush); }, est: 280 },
    { key: 'stumpCut', group: 'stump', label: 'Sawn stump with roots', cellM: 0.11, build: stump, est: 150, collider: 'prism', rVox: 3, hVox: 5 },
    { key: 'logShort', group: 'log', label: 'Fallen log, 2 m', cellM: 0.08, build: function () { return log(25); }, est: 190, collider: 'box', L: 25, anchor: [12.5, 4.5, 0] },
    { key: 'logLong', group: 'log', label: 'Fallen log, 3 m, thick', cellM: 0.11, build: function () { return log(27); }, est: 190, collider: 'box', L: 27, anchor: [13.5, 4.5, 0] }
  ];

  function finish(def, g) {
    var used = {}, i, x, y, z, ch, top = -1, x0 = g.sx, y0 = g.sy, x1 = -1, y1 = -1;
    for (z = 0; z < g.sz; z++) for (y = 0; y < g.sy; y++) for (x = 0; x < g.sx; x++) {
      ch = g.c[x + g.sx * (y + g.sy * z)];
      if (ch === '.') continue;
      used[ch] = 1; top = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    var sz = top + 1, layers = [];
    for (z = 0; z < sz; z++) {
      var rows = [];
      for (y = 0; y < g.sy; y++) { var s = ''; for (x = 0; x < g.sx; x++) s += g.c[x + g.sx * (y + g.sy * z)]; rows.push(s); }
      layers.push(rows);
    }
    var mats = {};
    for (i = 0; i < MATS.length; i++) if (used[MATS[i][0]]) mats[MATS[i][0]] = MATS[i][1];
    for (ch in used) if (!mats[ch]) throw new Error('ground_detail.js: ' + def.key + ' uses unknown voxel char "' + ch + '"');
    // anchor = centre of the footprint bbox, ground level; logs override it with the trunk-box centre (the branch
    // stub on +y would pull the bbox centre off the trunk, and the engine centres the box collider on the anchor).
    var anchor = def.anchor ? def.anchor.slice() : [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, 0];
    return { layers: layers, sx: g.sx, sy: g.sy, sz: sz, mats: mats, anchor: anchor,
      footW: x1 - x0 + 1, footD: y1 - y0 + 1 };
  }

  var keys = [], variants = {}, groups = {};
  DEFS.forEach(function (def) {
    var F = finish(def, def.build()), cm = def.cellM;
    var info = {
      group: def.group, label: def.label, cellM: cm, size: [F.sx, F.sy, F.sz],
      widthM: round2(F.footW * cm), depthM: round2(F.footD * cm), heightM: round2(F.sz * cm),
      capTris: CAPS[def.group], estTris: def.est, collider: null, rVox: def.rVox || 0, hVox: def.hVox || 0
    };
    if (def.collider === 'prism') info.collider = { prism: { r: round2(def.rVox * cm), h: round2(def.hVox * cm) } };
    else if (def.collider === 'box') info.collider = { box: { hx: round2((def.L / 2 - 0.5) * cm), hy: round2(3 * cm), h: round2(6.5 * cm) } };
    VM[def.key] = {
      name: def.key,
      desc: 'GROUND DETAIL (ENV-01d): ' + def.label + '. ' + F.sx + 'x' + F.sy + 'x' + F.sz + ' @ ' + cm + ' m = ' +
        info.widthM + ' x ' + info.depthM + ' x ' + info.heightM + ' m. Scatter prop (architecture.md 37.4), meshOnly, static.' +
        (info.collider ? ' Collider ' + JSON.stringify(info.collider) + '.' : ' No collider.'),
      groundDetail: info,
      voxel: {
        version: 1,
        meshOnly: true,
        cellM: cm,
        size: [F.sx, F.sy, F.sz],
        anchor: F.anchor,
        mats: F.mats,
        layers: F.layers,
        parts: { body: { box: [0, 0, 0, F.sx, F.sy, F.sz], pivot: F.anchor.slice() } }
      }
    };
    keys.push(def.key);
    variants[def.key] = info;
    (groups[def.group] = groups[def.group] || []).push(def.key);
  });

  A.groundDetail = { version: 1, keys: keys, groups: groups, caps: CAPS, variants: variants, mats: MATS };

  // ATTACH (same guard as forest_trees.js / sb_objects.js): list in ASSETS.models once every material key is known.
  if (A.palette && A.detailPass) {
    A.models = A.models || {};
    keys.forEach(function (k) {
      var m = VM[k], ok = true, i;
      if (!m || A.models[k]) return;
      for (i in m.voxel.mats) if (!A.palette.materials[m.voxel.mats[i]] || !A.detailPass.materials[m.voxel.mats[i]]) ok = false;
      if (ok) A.models[k] = m;
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
