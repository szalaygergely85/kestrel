/*
 * Kestrel - FOREST TREES (ME-06c4, architecture.md 37.2 "Designer needs"): the real walkable forest's trees.
 * 3 species x 2 sizes = 6 voxel models, 8.4 - 13.3 m tall, built at load from the StickyBizcuit pack trees in
 * design/models/sb_objects.js (licensed, see THIRD_PARTY_NOTICES.md "StickyBizcuit voxel asset pack"):
 *
 *   species  source      voxels (trimmed)  small                 large
 *   oak      treeBig     32 x 32 x 45      forestOakSmall  0.20  forestOakLarge  0.27 m/voxel
 *   birch    treeBirch   32 x 32 x 35      forestBirchSmall 0.25 forestBirchLarge 0.32
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
 *      OAK + BIRCH (`canopyBlock: 2`, tri budget 37.2 item 8, v1.29) use blockCanopy() instead: the canopy is
 *      rebuilt from 2x2x2 voxel blocks (>= 3/8 canopy), block-level speck/notch clean-up, enclosed pockets filled,
 *      branches above the trunk as 2x2x2 bark blocks. Trunk bark below trunkHVox is never touched. Pine keeps the
 *      per-voxel pass above (already inside the bars).
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
      leafSplitZ: 24, leafBelow: 'd', leafAbove: 'l', canopyBlock: 2, bark: 'b',
      blockFill: 0.625, branchMass: true, minBranch: 3, rootClean: true,  // oak sweep 2026-10-04: LOD0 2198 / LOD1 1184 (canopyBlock 4 = ~1730/586 fallback, blockier)
      mats: { b: 'timber_old', d: 'leaf_dark', l: 'leaf', r: 'gore_red' },
      anchor: [16, 15.5, 0], trunkRVox: 3.5, trunkHVox: 17,
      raw: true, sizes: { Small: 0.15, Large: 0.18 }   // owner 2026-10-04: imported voxels as-is, only scaled a little (blocked canopy rejected)
    },
    birch: {
      src: 'treeBirch', label: 'Birch (white bark, light crown)',
      map: { '!': 'w', '"': 'k', '#': 'L', '$': 'L', '%': 'L' },
      leafSplitZ: 24, leafBelow: 'l', leafAbove: 'y', canopyBlock: 2, bark: 'w',
      mats: { w: 'linen', k: 'iron_dark', l: 'leaf', y: 'leaf_light' },
      anchor: [15, 16.5, 0], trunkRVox: 2.6, trunkHVox: 18,
      raw: true, sizes: { Small: 0.15, Large: 0.18 }
    },
    pine: {
      src: 'treePine', label: 'Pine (tall cone, needle skirts)',
      map: { '!': 'b', '"': 'b', '#': 'b', '$': 'L', '%': 'L', '&': 'L' },
      leafSplitZ: 24, leafBelow: 'd', leafAbove: 'l',
      mats: { b: 'timber_old', d: 'leaf_dark', l: 'leaf' },
      anchor: [16, 16, 0], trunkRVox: 2.25, trunkHVox: 10,
      raw: true, sizes: { Small: 0.15, Large: 0.18 }
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
    function isLeaf(ch) { return ch !== '.' && LEAF_MATS[sp.mats[ch]] === 1; }
    if (sp.canopyBlock) return blockCanopy(spKey, sp, grid, sx, sy, szIn, srcCount, isLeaf);
    // Clean-up pass (read `grid`, write `out`).
    function at(g, xx, yy, zz) {
      if (xx < 0 || yy < 0 || zz < 0 || xx >= sx || yy >= sy || zz >= szIn) return '.';
      return g[xx + sx * (yy + sy * zz)];
    }
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
    return finishLayers(out, sx, sy, szIn, { srcVoxels: srcCount, dropped: dropped, filled: filled });
  }

  // Strings + top trim of a dense char grid.
  function finishLayers(out, sx, sy, szIn, stats) {
    var x, y, z, c;
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
    return { layers: layers, sx: sx, sy: sy, sz: top + 1, stats: stats };
  }

  // CANOPY BLOCKING (oak, birch; tri budget 37.2 item 8). The canopy is rebuilt on a coarse grid of B x B x B voxel
  // blocks, aligned to model-grid multiples of B (so the engine's even-grid LOD1 downsample merges whole blocks):
  //   1. per block: canopy block when >= `blockFill` (default 3/8) of its in-range cells are canopy (`branchMass`:
  //      for blocks fully above the trunk, bark counts as canopy mass too, so branches inside a crown clump vanish
  //      into it); else it keeps only its bark. Bark-only blocks fully above the trunk (z0 >= trunkHVox) with
  //      >= `minBranch` (default 2) bark cells become one solid bark block (chunky branches); with `branchMass`,
  //      fewer bark cells there = a speck, dropped. Bark below trunkHVox is NEVER changed by blocking: trunk shape /
  //      trunkR / trunkH stay as measured (`rootClean` only trims stray z0-1 root specks outside the trunk).
  //      Clean-up with `branchMass` also drops bark blocks with <= 1 solid block-neighbour.
  //   2. block clean-up (read the step-1 grid): drop canopy blocks with <= 1 solid block-neighbour, fill empty blocks
  //      with >= 4 canopy block-neighbours (notches, pin holes).
  //   3. cavity fill: empty blocks not reachable from the grid boundary through empty blocks become canopy
  //      (enclosed pockets only add hidden tris).
  //   4. write back: a canopy block sets every cell that is not trunk bark (bark with z < trunkHVox) to the leaf
  //      material of its height band (leafSplitZ must be a multiple of B, so one block = one material).
  // ROOT CLEAN (oak `rootClean`): the sb oak's z0-1 root flare is a scatter of single bark voxels (each ~5 quads at
  // LOD0 and a full 2x2x2 block at LOD1). Two passes, each read from the previous grid: on layers z < 2 (below the
  // layers trunkR is measured on), a bark voxel farther than trunkRVox + 1 from the anchor with <= 1 solid
  // face-neighbour is dropped. Connected roots stay; the trunk and its collider are unchanged.
  function cleanRoots(sp, grid, sx, sy, szIn, isLeaf) {
    var N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], pass, x, y, z, k, i, c;
    var rMin = sp.trunkRVox + 1, ax = sp.anchor[0], ay = sp.anchor[1];
    for (pass = 0; pass < 2; pass++) {
      var out = grid.slice();
      for (z = 0; z < Math.min(2, szIn); z++) for (y = 0; y < sy; y++) for (x = 0; x < sx; x++) {
        i = x + sx * (y + sy * z); c = grid[i];
        if (c === '.' || isLeaf(c) || Math.hypot(x + 0.5 - ax, y + 0.5 - ay) <= rMin) continue;
        var solid = 0;
        for (k = 0; k < 6; k++) {
          var xx = x + N[k][0], yy = y + N[k][1], zz = z + N[k][2];
          if (xx < 0 || yy < 0 || zz < 0 || xx >= sx || yy >= sy || zz >= szIn) continue;
          if (grid[xx + sx * (yy + sy * zz)] !== '.') solid++;
        }
        if (solid <= 1) out[i] = '.';
      }
      grid = out;
    }
    return grid;
  }

  function blockCanopy(spKey, sp, grid, sx, sy, szIn, srcCount, isLeaf) {
    var B = sp.canopyBlock;
    if (sp.leafSplitZ % B !== 0) throw new Error('forest_trees.js: ' + spKey + ' leafSplitZ ' + sp.leafSplitZ + ' not a multiple of canopyBlock ' + B);
    var nbx = Math.ceil(sx / B), nby = Math.ceil(sy / B), nbz = Math.ceil(szIn / B);
    var NB = nbx * nby * nbz, blk = new Uint8Array(NB), barkCh = new Array(NB);  // 0 empty, 1 canopy, 2 bark, 3 bark block
    var bx, by, bz, x, y, z, i, c, b;
    var fill = sp.blockFill || 3 / 8, minBranch = sp.minBranch || 2;
    if (sp.rootClean) grid = cleanRoots(sp, grid, sx, sy, szIn, isLeaf);
    for (bz = 0; bz < nbz; bz++) for (by = 0; by < nby; by++) for (bx = 0; bx < nbx; bx++) {
      var n = 0, leafN = 0, barkN = 0, ch = null;
      for (z = bz * B; z < Math.min(szIn, bz * B + B); z++) for (y = by * B; y < Math.min(sy, by * B + B); y++)
        for (x = bx * B; x < Math.min(sx, bx * B + B); x++) {
          c = grid[x + sx * (y + sy * z)]; n++;
          if (c === '.') continue;
          if (isLeaf(c)) leafN++; else { barkN++; if (ch === null) ch = c; }
        }
      b = bx + nbx * (by + nby * bz);
      barkCh[b] = ch;
      var above = bz * B >= sp.trunkHVox;                 // block fully above the trunk collider
      var mass = leafN + (above && sp.branchMass ? barkN : 0);
      if (leafN > 0 && mass >= fill * n) blk[b] = 1;
      else if (above && barkN >= minBranch) { blk[b] = 3; barkCh[b] = sp.bark; }
      else if (above && sp.branchMass) blk[b] = 0;        // stray branch speck above the trunk: dropped
      else if (barkN > 0) blk[b] = 2;
    }
    // 2. clean-up
    var snap = blk.slice(), dropped = 0, filled = 0, cavities = 0;
    var D = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    function bAt(g, xx, yy, zz) {
      if (xx < 0 || yy < 0 || zz < 0 || xx >= nbx || yy >= nby || zz >= nbz) return 0;
      return g[xx + nbx * (yy + nby * zz)];
    }
    for (bz = 0; bz < nbz; bz++) for (by = 0; by < nby; by++) for (bx = 0; bx < nbx; bx++) {
      b = bx + nbx * (by + nby * bz);
      var solid = 0, can = 0, k, v;
      for (k = 0; k < 6; k++) { v = bAt(snap, bx + D[k][0], by + D[k][1], bz + D[k][2]); if (v) solid++; if (v === 1) can++; }
      if (snap[b] === 1 && solid <= 1) { blk[b] = barkCh[b] !== null && !(sp.branchMass && bz * B >= sp.trunkHVox) ? 2 : 0; dropped++; }
      else if (snap[b] === 3 && solid <= 1 && sp.branchMass) { blk[b] = 0; dropped++; }
      else if (snap[b] === 0 && can >= 4) { blk[b] = 1; filled++; }
    }
    // 3. cavity fill (flood the empty blocks from the boundary)
    var seen = new Uint8Array(NB), stack = [];
    for (bz = 0; bz < nbz; bz++) for (by = 0; by < nby; by++) for (bx = 0; bx < nbx; bx++) {
      if (bx && by && bz && bx < nbx - 1 && by < nby - 1 && bz < nbz - 1) continue;
      b = bx + nbx * (by + nby * bz);
      if (blk[b] === 0 && !seen[b]) { seen[b] = 1; stack.push(b); }
    }
    while (stack.length) {
      b = stack.pop();
      bx = b % nbx; by = ((b - bx) / nbx) % nby; bz = (b - bx - nbx * by) / (nbx * nby);
      for (var q = 0; q < 6; q++) {
        var ax = bx + D[q][0], ay = by + D[q][1], az = bz + D[q][2];
        if (ax < 0 || ay < 0 || az < 0 || ax >= nbx || ay >= nby || az >= nbz) continue;
        var nb = ax + nbx * (ay + nby * az);
        if (!seen[nb] && blk[nb] === 0) { seen[nb] = 1; stack.push(nb); }
      }
    }
    for (b = 0; b < NB; b++) if (blk[b] === 0 && !seen[b]) { blk[b] = 1; cavities++; }
    // 4. write back
    var out = new Array(sx * sy * szIn);
    for (z = 0; z < szIn; z++) for (y = 0; y < sy; y++) for (x = 0; x < sx; x++) {
      i = x + sx * (y + sy * z);
      c = grid[i];
      b = Math.floor(x / B) + nbx * (Math.floor(y / B) + nby * Math.floor(z / B));
      var trunkBark = c !== '.' && !isLeaf(c) && z < sp.trunkHVox;
      if (trunkBark) { out[i] = c; continue; }
      if (blk[b] === 1) out[i] = z < sp.leafSplitZ ? sp.leafBelow : sp.leafAbove;
      else if (blk[b] === 3) out[i] = barkCh[b];
      else if (blk[b] === 2) out[i] = (c !== '.' && !isLeaf(c)) ? c : '.';
      else out[i] = '.';
    }
    return finishLayers(out, sx, sy, szIn,
      { srcVoxels: srcCount, canopyBlock: B, dropped: dropped, filled: filled + cavities, cavities: cavities });
  }

  // RAW (owner 2026-10-04): the imported StickyBizcuit tree exactly as authored - its own layers and materials, no
  // remap, no clean-up, no canopy blocking; only cellM (scale) differs per size.
  function rawLayers(sp) {
    var src = VM[sp.src];
    if (!src || !src.voxel || !src.voxel.layers) throw new Error('forest_trees.js: ASSETS.voxelModels.' + sp.src + ' missing - load design/models/sb_objects.js first');
    var sv = src.voxel;
    return { layers: sv.layers, sx: sv.size[0], sy: sv.size[1], sz: sv.size[2], mats: sv.mats, stats: { raw: true } };
  }

  var keys = [], variants = {};
  Object.keys(SPECIES).forEach(function (spKey) {
    var sp = SPECIES[spKey], L = sp.raw ? rawLayers(sp) : buildLayers(spKey, sp);
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
          mats: L.mats || sp.mats,
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
