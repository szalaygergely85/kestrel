/*
 * Kestrel - FOREST TREES (ME-06c4, architecture.md 37.2 "Designer needs"): the real walkable forest's trees.
 * 3 species x 2 sizes = 6 voxel models, 8.4 - 13.3 m tall, built at load from the StickyBizcuit pack trees in
 * design/models/sb_objects.js (licensed, see THIRD_PARTY_NOTICES.md "StickyBizcuit voxel asset pack"):
 *
 *   species  source      voxels (trimmed)  small                 large
 *   oak      treeBig     32 x 32 x 45      forestOakSmall  0.20  forestOakLarge  0.27 m/voxel
 *   birch    treeBirch   32 x 32 x 35      forestBirchSmall 0.24 forestBirchLarge 0.32
 *   pine     treePine    32 x 32 x 37      forestPineSmall 0.26  forestPineLarge 0.36
 *
 * SAME VOXELS, bigger cellM (37.2: no per-instance scale). What this file changes vs the sb source:
 *   1. Materials: the sb canopies were mapped to `grass` (turf look). Here every canopy char collapses into the new
 *      leaf materials (palette.js + detail-pass.js `leaf`, `leaf_dark`, `leaf_light`), split by HEIGHT BAND
 *      (`leafSplitZ`): a darker lower crown / lighter upper crown, i.e. a lit roof over a shaded forest floor.
 *      Bark chars collapse to one char per bark material. Fewer local materials = longer greedy quads = fewer tris.
 *   2. Canopy clean-up (`clean`): canopy voxels with <= 1 solid face-neighbour (floating specks, 5-6 quads each) are
 *      dropped, and empty cells with >= 5 canopy face-neighbours are filled (pin holes). One pass, read from the
 *      un-cleaned grid, so the result is order-independent. Silhouette unchanged at walking distance.
 *   3. Empty top layers trimmed (size z = top voxel + 1).
 *   4. Anchor = the measured TRUNK CENTRE (the sb trunks are off the grid centre by 0.5-1 voxel), so the engine's
 *      8-sided trunk prism (37.2 item 5), centred on the placement point, sits on the visible trunk.
 *
 * TRUNK NUMBERS (37.2 items 4/5/7; copied as literals into design/levels/overworld_far.js recipe.forest.trees):
 *   trunkR = trunkRVox * cellM, rounded UP to 0.01 m (the prism's INSCRIBED radius; the engine uses circumradius
 *            trunkR / cos 22.5 deg). trunkRVox measured on layers z2..trunkHVox (z0-1 = flat root flare, walk-over).
 *   trunkH = trunkHVox * cellM: ground to the lowest canopy voxel next to the trunk (oak 17, birch 18); pine = 10
 *            (its lowest needle skirt is at voxel 8 = 2.1 m, the trunk continues inside the skirt; 10 keeps the
 *            prism taller than the player).
 *   preview/forest.html recomputes these from the voxels and checks the level config against them.
 *
 * meshOnly (ME-22): all six are > 32 per axis -> mesh renderer only, never in the DDA atlas (voxelPacks.test.js
 * 256-row budget unaffected). Static, one part 'body', no clips (the sb sway frames are not imported).
 *
 * LOAD ORDER: classic script AFTER palette.js, detail-pass.js and models/sb_objects.js:
 *   <script src="../design/models/forest_trees.js"></script>
 *   import '../../../design/models/sb_objects.js'; import '../../../design/models/forest_trees.js';   (Node)
 * Throws naming the missing source model if sb_objects.js was not loaded first.
 * Exposes: ASSETS.voxelModels.<key> (the 6 models), ASSETS.models.<key> (attach guard as sb_objects.js),
 *          ASSETS.forestTrees = { keys, species, variants: { <key>: {species, size, cellM, heightM, trunkR, trunkH,
 *          trunkRVox, trunkHVox, canopyBaseM, srcVoxels, cleanStats} } } for previews / tests.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  var VM = A.voxelModels;

  // map: source char -> new char. 'L' = canopy (resolved by height band: z < leafSplitZ -> leafBelow else leafAbove).
  // Every non-'.' char of the source MUST be in the map (throws otherwise: a re-import can't silently drop voxels).
  var SPECIES = {
    oak: {
      src: 'treeBig', label: 'Oak (broadleaf, wide crown)',
      map: { '!': 'b', '"': 'b', '#': 'b', '$': 'b', '%': 'b', '&': 'b', '\'': 'b', '(': 'b', ',': 'b', '-': 'b',
             ')': 'L', '*': 'L', '+': 'L', '/': 'r' },
      leafSplitZ: 25, leafBelow: 'd', leafAbove: 'l',
      mats: { b: 'timber_old', d: 'leaf_dark', l: 'leaf', r: 'gore_red' },
      anchor: [16, 15.5, 0], trunkRVox: 3.5, trunkHVox: 17,
      sizes: { Small: 0.20, Large: 0.27 }
    },
    birch: {
      src: 'treeBirch', label: 'Birch (white bark, light crown)',
      map: { '!': 'w', '"': 'k', '#': 'L', '$': 'L', '%': 'L' },
      leafSplitZ: 24, leafBelow: 'l', leafAbove: 'y',
      mats: { w: 'linen', k: 'iron_dark', l: 'leaf', y: 'leaf_light' },
      anchor: [15, 16.5, 0], trunkRVox: 2.6, trunkHVox: 18,
      sizes: { Small: 0.24, Large: 0.32 }
    },
    pine: {
      src: 'treePine', label: 'Pine (tall cone, needle skirts)',
      map: { '!': 'b', '"': 'b', '#': 'b', '$': 'L', '%': 'L', '&': 'L' },
      leafSplitZ: 24, leafBelow: 'd', leafAbove: 'l',
      mats: { b: 'timber_old', d: 'leaf_dark', l: 'leaf' },
      anchor: [16, 16, 0], trunkRVox: 2.25, trunkHVox: 10,
      sizes: { Small: 0.26, Large: 0.36 }
    }
  };
  var LEAF_MATS = { leaf: 1, leaf_dark: 1, leaf_light: 1 };

  function ceil2(v) { return Math.ceil(v * 100 - 1e-6) / 100; }
  function round2(v) { return Math.round(v * 100) / 100; }

  // Builds the shared (both sizes) layers of one species. Returns { layers, sx, sy, sz, stats }.
  function buildLayers(spKey, sp) {
    var src = VM[sp.src];
    if (!src || !src.voxel || !src.voxel.layers) {
      throw new Error('forest_trees.js: ASSETS.voxelModels.' + sp.src + ' missing (species ' + spKey +
        ') - load design/models/sb_objects.js before forest_trees.js');
    }
    var sv = src.voxel, sx = sv.size[0], sy = sv.size[1], szIn = sv.size[2];
    var grid = new Array(sx * sy * szIn), x, y, z, i, c, m;
    var srcCount = 0;
    for (z = 0; z < szIn; z++) {
      for (y = 0; y < sy; y++) {
        var row = sv.layers[z][y];
        for (x = 0; x < sx; x++) {
          c = row.charAt(x);
          i = x + sx * (y + sy * z);
          if (c === '.' || c === ' ' || c === '') { grid[i] = '.'; continue; }
          m = sp.map[c];
          if (m === undefined) throw new Error('forest_trees.js: ' + spKey + ' (' + sp.src + ') char "' + c + '" at ' + x + ',' + y + ',' + z + ' not in map');
          if (m === 'L') m = z < sp.leafSplitZ ? sp.leafBelow : sp.leafAbove;
          grid[i] = m; srcCount++;
        }
      }
    }
    // Clean-up pass (read `grid`, write `out`).
    function at(g, xx, yy, zz) {
      if (xx < 0 || yy < 0 || zz < 0 || xx >= sx || yy >= sy || zz >= szIn) return '.';
      return g[xx + sx * (yy + sy * zz)];
    }
    function isLeaf(ch) { return ch !== '.' && LEAF_MATS[sp.mats[ch]] === 1; }
    var out = grid.slice(), dropped = 0, filled = 0;
    var N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (z = 0; z < szIn; z++) for (y = 0; y < sy; y++) for (x = 0; x < sx; x++) {
      i = x + sx * (y + sy * z);
      c = grid[i];
      var solid = 0, leafN = 0, k, n;
      for (k = 0; k < 6; k++) {
        n = at(grid, x + N[k][0], y + N[k][1], z + N[k][2]);
        if (n !== '.') { solid++; if (isLeaf(n)) leafN++; }
      }
      if (c !== '.' && isLeaf(c) && solid <= 1) { out[i] = '.'; dropped++; }
      else if (c === '.' && leafN >= 5) { out[i] = z < sp.leafSplitZ ? sp.leafBelow : sp.leafAbove; filled++; }
    }
    // Strings + top trim.
    var layers = [], top = -1;
    for (z = 0; z < szIn; z++) {
      var rows = new Array(sy), any = false;
      for (y = 0; y < sy; y++) {
        var s = '';
        for (x = 0; x < sx; x++) { c = out[x + sx * (y + sy * z)]; if (c !== '.') any = true; s += c; }
        rows[y] = s;
      }
      layers.push(rows);
      if (any) top = z;
    }
    layers.length = top + 1;
    return { layers: layers, sx: sx, sy: sy, sz: top + 1,
      stats: { srcVoxels: srcCount, dropped: dropped, filled: filled } };
  }

  var keys = [], variants = {};
  Object.keys(SPECIES).forEach(function (spKey) {
    var sp = SPECIES[spKey], L = buildLayers(spKey, sp);
    Object.keys(sp.sizes).forEach(function (sizeKey) {
      var cellM = sp.sizes[sizeKey];
      var key = 'forest' + spKey.charAt(0).toUpperCase() + spKey.slice(1) + sizeKey;
      var info = {
        species: spKey, size: sizeKey.toLowerCase(), src: sp.src, cellM: cellM,
        heightM: round2(L.sz * cellM), trunkRVox: sp.trunkRVox, trunkHVox: sp.trunkHVox,
        trunkR: ceil2(sp.trunkRVox * cellM), trunkH: round2(sp.trunkHVox * cellM),
        canopyBaseM: round2(sp.trunkHVox * cellM), cleanStats: L.stats
      };
      VM[key] = {
        name: key,
        desc: 'FOREST TREE (ME-06c4): ' + sp.label + ', ' + info.size + '. ' + sp.src + ' voxels (sb_objects.js, StickyBizcuit) at ' +
          cellM + ' m/voxel = ' + info.heightM + ' m tall; leaf materials by height band, canopy specks cleaned, anchor on the trunk ' +
          'centre. Trunk collider (level config): trunkR ' + info.trunkR + ' m, trunkH ' + info.trunkH + ' m.',
        forest: info,
        voxel: {
          version: 1,
          meshOnly: true,
          cellM: cellM,
          size: [L.sx, L.sy, L.sz],
          anchor: sp.anchor.slice(),
          mats: sp.mats,
          layers: L.layers,
          parts: { body: { box: [0, 0, 0, L.sx, L.sy, L.sz], pivot: sp.anchor.slice() } }
        }
      };
      keys.push(key);
      variants[key] = info;
    });
  });

  A.forestTrees = { version: 1, keys: keys, species: SPECIES, variants: variants };

  // ATTACH (same guard as sb_objects.js): list in ASSETS.models once every material key is known.
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
