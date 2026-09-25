/*
 * Kestrel - VOXEL PROPS, batch 3: WORLD props (things that stand on the terrain, not inside a structure).
 * First model: the WAYSTONE (US-026a end marker, architecture.md 23.2 / 23.5; PO rulings in docs/backlog.md ### US-026a).
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + 15.3 item 6 (content contract), same record shape as
 * design/models/voxel_props.js (batch 1) and design/models/voxel_tower.js (batch 2).
 * Preview: design/preview/voxel-props.html (show: waystone; engine oracle + terrain / sightline / end-camera checks).
 *
 * LOAD ORDER: after palette.js, detail-pass.js and voxel_props.js (that file creates ASSETS.voxelMaterials; this one ADDS
 * to it). No billboard model is needed: the waystone exists only as a voxel model, so this file sets
 * ASSETS.models.waystone itself (the registry key World.load / VoxelPool look up for components.voxel.model 'waystone').
 * game/index.html needs ONE new tag right after voxel_tower.js:   <script src="../design/models/voxel_world.js"></script>
 * (and the same line in any Node / tool loader that mirrors the index.html list, e.g. tools/export-content.mjs).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.waystone   an old standing stone by the road below the tower, 14x10x24 @ 0.125 m (1.75 x 1.25 x
 *                                 3.0 m grid; 2.625 m above the ground + a 0.25 m buried foot), one emissive teal mark
 *   ASSETS.models.waystone        = the same record (attached only when its materials are merged, like attachTower)
 *   ASSETS.voxelMaterials.*       + 4 materials (v1 + v2 + remap + fallback), listed in `.batch3`; ALREADY MERGED into
 *                                 palette.js + detail-pass.js by the designer (appended last, no id moves)
 *   ASSETS.worldPatch.world_m1    the exact world-file additions for US-026a-content (PC-B copies them into
 *                                 content/worlds/world_m1.world.json): endMarker entity + the `end` trigger numbers.
 *                                 No runtime applier (same rule as levelPatch).
 *
 * AXES (15.1): x = east (x0 west), y = SOUTH with y0 = the FRONT row (faces north at yaw 0), z = up. The entity's yawDeg
 * turns the front to that compass bearing: at yawDeg 75 the front (the mark) faces ENE = the breach, local +x points SSE,
 * the back faces WSW (the road on, the signal tower) and local -x (the mossy side) faces NNW.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  A.models = A.models || {};

  // ===================================================================================================================
  // 0. BUILD HELPERS (same deterministic integer hash + grid as voxel_tower.js; no Math.random)
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
  Grid.prototype.layers = function () {
    var L = [], z, y, x, rows, row;
    for (z = 0; z < this.sz; z++) {
      rows = [];
      for (y = 0; y < this.sy; y++) { row = ''; for (x = 0; x < this.sx; x++) row += this.a[x + this.sx * (y + this.sy * z)]; rows.push(row); }
      L.push(rows);
    }
    return L;
  };

  var KEY = { S: 'waystone_light', s: 'waystone', k: 'waystone_dark', A: 'waystone_mark', m: 'moss_cap' };
  function matsOf(G) {
    var used = {}, o = {}, k;
    G.each(function (x, y, z, c) { used[c] = 1; });
    for (k in used) o[k] = KEY[k];
    return o;
  }
  function idle1() { return { durations: [1000], loop: true, frames: [{}] }; }

  // ===================================================================================================================
  // 1. MATERIALS (batch 3). Merged by the designer (v1.16): v1 -> palette.materials after canvas_burnt, v2 ->
  //    detailPass.materials after canvas_burnt + remap k -> k + the new glyph set `rune`. moss_cap (batch 2) reused.
  //    Value ladder (checked in the preview): rim waystone_light ABOVE stoneLight, body waystone well BELOW 0.8 x
  //    stoneMid, rim / body ~2.1; no tower wall / floor tone. On the grass (grass luma ~153) the dark body is the
  //    silhouette, the pale lichen top the rim, the teal mark the one bright colour.
  // ===================================================================================================================
  function tex(key, rows) { return { w: rows[0].length, h: rows.length, scale: [16, 16], key: key, rows: rows }; }
  var V1 = {
    waystone_light: {
      desc: 'VOXEL PROPS (world, US-026a waystone). The standing stone\'s weathered top and upper edges and a few lichen ' +
            'patches: rain-bleached pale grey with yellow lichen. The bright rim over the dark slate body.',
      base: 'wayStoneLight', albedo: 0.90, ramp: 'stone', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, l: { shade: 1.10, tint: 'lichen', amount: 0.6, glyph: "'" }, d: { shade: 0.85, tint: 'wayStone', amount: 0.4 } },
                   ['alad', 'daal', 'alda', 'ldaa'])
    },
    waystone: {
      desc: 'VOXEL PROPS (world, US-026a waystone). The old stone\'s faces and flanks: cool blue-grey slate, darker than ' +
            'any tower stone, so it stands out as a dark upright on the bright grass. Pale lichen specks, dark pits.',
      base: 'wayStone', albedo: 0.72, ramp: 'stone', bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, c: { shade: 0.78, tint: 'wayStoneDark', amount: 0.5, glyph: ':' }, l: { shade: 1.20, tint: 'lichen', amount: 0.5, glyph: "'" } },
                   ['aaca', 'caaa', 'alaa', 'aaac'])
    },
    waystone_dark: {
      desc: 'VOXEL PROPS (world, US-026a waystone). The damp foot where the stone meets the turf, the buried base, the ' +
            'packing stones\' sides and the dark cut edges round the carved mark (Blood-style contrast frame).',
      base: 'wayStoneDark', albedo: 0.58, ramp: 'stone', bg: { mode: 'darken', k: 0.10 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, m: { shade: 0.90, tint: 'mossDark', amount: 0.6, glyph: ',' } },
                   ['amaa', 'aaam', 'maaa', 'aama'])
    },
    waystone_mark: {
      desc: 'VOXEL PROPS (world, US-026a waystone). The carved relay sign on the front face (a ring with a centre point over ' +
            'a stroke and a foot bar): faint aether teal in the cut, emissive 0.60 (below the awake relay crystals 0.85), ' +
            'so it reads as a teal mark from the breach and glows on the shadow side. Static (1 frame).',
      base: 'aether', albedo: 1.00, ramp: 'aether', spec: 0.20, emissive: 0.60, bg: { mode: 'darken', k: 0.22 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, c: { shade: 1.15, tint: 'aetherLight', amount: 0.5 }, m: { shade: 0.85, tint: 'aetherMid', amount: 0.5 } },
                   ['acam', 'maac', 'acma', 'caam'])
    }
  };
  // v2: tone grid ~ half a 0.125 m voxel; lines: false (the edge pass draws the voxel steps, 15.2 item 5).
  function v2(key, seed, albedo, tones, set, g, extra) {
    var o = { v1: key, seed: seed, desc: V1[key].desc, albedo: albedo, bgK: V1[key].bg.k, detail: 32, jitter: 0.06,
              tones: tones, grid: { u: g, v: g, stagger: 0, lines: false },
              face: { set: set, mid: set, far: set }, lod: { mid: 12, far: 25, dither: 3 } }, k;
    for (k in extra || {}) o[k] = extra[k];
    return o;
  }
  var V2 = {
    waystone_light: v2('waystone_light', 229, 0.90, [['wayStoneLight', 3], ['lichen', 1]], 'rockFace', 0.06),
    waystone:       v2('waystone',       230, 0.72, [['wayStone', 3], ['wayStoneDark', 1]], 'rockFace', 0.06),
    waystone_dark:  v2('waystone_dark',  231, 0.58, [['wayStoneDark', 3], ['mossDark', 1]], 'rockFace', 0.06),
    waystone_mark:  v2('waystone_mark',  232, 1.00, [['aether', 3], ['aetherMid', 2], ['aetherLight', 1]], 'rune', 0.06, { emissive: 0.60 })
  };
  var FALLBACK = { waystone_light: 'rock', waystone: 'rock', waystone_dark: 'rock', waystone_mark: 'crystal_lit' };
  var VM = A.voxelMaterials = A.voxelMaterials ||
    { status: 'PROPOSED', v1: {}, v2: {}, remap: {}, edges: { modelRim: 0.55 }, fallback: {} };
  VM.v1 = VM.v1 || {}; VM.v2 = VM.v2 || {}; VM.remap = VM.remap || {}; VM.fallback = VM.fallback || {};
  VM.batch3 = [];
  Object.keys(V1).forEach(function (k) {
    VM.v1[k] = V1[k]; VM.v2[k] = V2[k]; VM.remap[k] = k; VM.fallback[k] = FALLBACK[k]; VM.batch3.push(k);
  });

  // ===================================================================================================================
  // 2. WAYSTONE  14 x 10 x 24 @ 0.125 m. Layers z0..1 = the buried foot (anchor z = 2 = the ground plane), so the stone
  //    never shows a gap on the downhill side (slope <= 7.4 deg in the band: <= 0.12 m drop across the footprint).
  //    Blood-style chunky menhir:
  //      - a tapering slab: 10 voxels (1.25 m) wide and 7 deep at the foot, a slight belly, 8 wide from 1.4 m, 6 wide
  //        at the top; the front face is ONE flat plane (local y 2) so the mark sits on it; the back leans in (depth
  //        7 -> 6 -> 5 -> 4 voxels up the stone);
  //      - a slanted broken top: the west (local -x) shoulder is high (2.625 m), the east one lower (2.25 m), a chip
  //        knocked out of the front top-east corner and one out of the back top;
  //      - the dark damp foot (ragged line), moss up the NNW (local -x) flank and on the low shoulder, lichen patches;
  //      - 4 small packing-stone clusters half sunk in the turf round the foot;
  //      - THE MARK on the front face, 6 x 13 voxels (0.75 x 1.63 m), centre 1.75 m above the ground (eye height):
  //        a ring with a centre point (the relay's light) over a stroke (the road) ending on a foot bar (the ground),
  //        all framed by a 1-voxel dark cut edge. Flush with the face, so it reads from every front angle.
  // ===================================================================================================================
  var MARK = [                      // front face, row 0 = the TOP (zz 16) ... row 12 = zz 4; col 0 = local x 4
    '.AAAA.',
    'A....A',
    'A.AA.A',
    'A.AA.A',
    'A....A',
    '.AAAA.',
    '..AA..',
    '..AA..',
    '..AA..',
    '..AA..',
    '..AA..',
    '..AA..',
    'AAAAAA'
  ];
  var G0 = 2, MARK_TOP = 16, MARK_X0 = 4, FRONT_Y = 2;
  function buildWaystone() {
    var SX = 14, SY = 10, SZ = 24, G = new Grid(SX, SY, SZ), x, y, z, zz, CX = 7;
    function hw(q) { var t = Math.max(0, q) / 21; return 5.0 - 1.8 * Math.pow(t, 1.3) + 0.25 * Math.sin(Math.PI * t); }
    function yFront(q) { return q < 3 ? 1 : FRONT_Y; }                 // a 1-voxel wider foot at the front
    function yBack(q) { return q < 3 ? 9 : q < 10 ? 8 : q < 17 ? 7 : 6; }   // exclusive; the back leans in
    function topH(px) { return Math.round(21 - 4 * (px - 3) / 7); }     // highest zz per column: west shoulder high
    // body
    for (z = 0; z < SZ; z++) {
      zz = z - G0;
      for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
        if (Math.abs(x + 0.5 - CX) >= hw(zz)) continue;
        if (y < yFront(zz) || y >= yBack(zz) || zz > topH(x)) continue;
        G.set(x, y, z, zz < 0 ? 'k' : 's');
      }
    }
    // broken top: a chip off the front top-east corner, one off the back top
    for (x = 9; x <= 10; x++) for (zz = 16; zz <= 18; zz++) G.set(x, FRONT_Y, zz + G0, '.');
    G.set(4, 5, 20 + G0, '.'); G.set(5, 5, 20 + G0, '.'); G.set(4, 5, 19 + G0, '.');
    // paint the exposed body: top rim, damp foot, moss on the NNW flank + low shoulder, lichen patches
    var paint = [];
    G.each(function (x, y, z, c) {
      if (c !== 's' || !G.exposed(x, y, z)) return;
      var q = z - G0, h = hash(x, y, z, 61), out = c;
      if (!G.full(x, y, z + 1)) out = (x <= 4 && q <= 19 && h < 0.6) ? 'm' : 'S';               // top rim / moss cushion
      else if (q <= 1 || (q === 2 && h < 0.5)) out = 'k';                                        // damp foot, ragged
      else if (!G.full(x - 1, y, z) && q <= 7 && hash(x, y, z, 62) < 0.62 - 0.07 * q) out = 'm'; // moss up the -x flank
      else if (q >= 6 && h < 0.07) out = 'S';                                                    // lichen patches
      if (out !== c) paint.push([x, y, z, out]);
    });
    paint.forEach(function (p) { G.set(p[0], p[1], p[2], p[3]); });
    // the mark (flush on the front plane) + its dark cut edge (4-neighbours in the face plane)
    var r, cc, marks = {};
    for (r = 0; r < MARK.length; r++) for (cc = 0; cc < MARK[r].length; cc++) {
      if (MARK[r].charAt(cc) !== 'A') continue;
      x = MARK_X0 + cc; z = G0 + MARK_TOP - r;
      G.set(x, FRONT_Y, z, 'A'); marks[x + ',' + z] = 1;
    }
    var edge = [];
    Object.keys(marks).forEach(function (k) {
      var p = k.split(',').map(Number);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = p[0] + d[0], nz = p[1] + d[1];
        if (!marks[nx + ',' + nz] && G.full(nx, FRONT_Y, nz)) edge.push([nx, nz]);
      });
    });
    edge.forEach(function (e) { G.set(e[0], FRONT_Y, e[1], 'k'); });
    // packing stones round the foot, half sunk (zz -1..1); the top voxel of each is the pale rim (moss on the NNW one)
    var PEB = [[0, 3, 0], [1, 3, 0], [1, 4, 0], [0, 4, -1], [1, 3, 1],               // -x (NNW) cluster
               [12, 5, 0], [13, 5, 0], [12, 6, 0], [12, 5, 1], [13, 6, 0],          // +x (SSE) cluster
               [5, 0, 0], [6, 0, 0], [9, 0, 0],                                    // front, in the grass
               [8, 9, 0], [9, 9, 0], [3, 9, 0]];                                   // back (zz -1 = buried root)
    PEB.forEach(function (p) { G.set(p[0], p[1], p[2] + G0, 'k'); });
    PEB.forEach(function (p) {
      if (p[2] < 0 || G.full(p[0], p[1], p[2] + G0 + 1)) return;
      G.set(p[0], p[1], p[2] + G0, p[0] <= 1 ? 'm' : 'S');
    });
    return G;
  }
  var gW = buildWaystone();
  A.voxelModels.waystone = {
    name: 'waystone',
    desc: 'Voxel waystone (US-026a end marker): an old standing stone by the road below the tower. A chunky tapering slate ' +
          'menhir, 2.6 m tall, dark blue-grey with a pale lichen top rim, a slanted broken top, moss up its north flank, a ' +
          'damp dark foot with packing stones, and one faint aether-teal carved sign on the front face: a ring with a centre ' +
          'point over a stroke and a foot bar (the relay light over the road), framed by a dark cut edge.',
    voxel: {
      version: 1, cellM: 0.125, size: [14, 10, 24], anchor: [7, 5, G0], mats: matsOf(gW), layers: gW.layers(),
      parts: { stone: { box: [0, 0, 0, 14, 10, 24], pivot: [7, 5, G0] } },           // extent 48 (the limit, exactly)
      animations: { idle: idle1() },
      mounts: {
        mark:  { at: [7, FRONT_Y, G0 + 14], part: 'stone' },   // centre of the ring on the front face, 1.75 m above the ground
        top:   { at: [5, 4, G0 + 21], part: 'stone' },         // the high shoulder (2.625 m)
        front: { at: [7, 0, G0], part: 'stone' }               // ground point in front of the face (end-camera reference)
      }
    },
    placement: {
      world: 'world_m1', entity: 'endMarker', x: 1428, y: 1040, z: 'ground', yawDeg: 75, levelEdit: false,
      note: 'architect-probed spot (23 probe: terrain 0.53 m, grass, 60 m from the breach eye, 70 m from the tower centre); ' +
            '8.9 m south of the old road (overworld_far recipe.path), on the line breach -> signal tower (bearing 255.6 vs ' +
            '254.9): from the breach the stone stands right under the far teal light. yawDeg 75 = the front + mark face the ' +
            'breach (bearing stone -> breach 75.6).'
    },
    end: {
      trigger: { shape: 'circle', x: 1428, y: 1040, r: 2.5 },
      walkTo: { x: 1429.86, y: 1038.33 },
      lookAt: 'farTower', pitchTo: 0,
      note: 'walkTo is 2.5 m from the stone at bearing 53 (NE, the breach / arrival side, 22 deg off the face normal), NOT ' +
            'behind it: end.js walks at most 1 m toward walkTo, and the player arrives from the breach (enters r 2.5 at ' +
            'bearing ~75, 0.95 m from walkTo). Facing farTower (254.9) from there the stone fills the left third of the view ' +
            '(centre 21.7 deg left, face-on, the mark at eye height) and the signal tower stands clear in the middle. A ' +
            'walkTo on the far-tower side would put the 2.6 m stone right in front of the tower light.'
    },
    readability: {
      note: 'Ring (6 voxels = 0.75 m) at 240x90: 20 m -> 3.9 rows x 5.9 cols; 60 m (the breach) -> 1.3 rows x 1.9 cols = a ' +
            'teal point under the signal tower. Whole stone 2.625 m: 20 m -> 13.7 rows, breach -> 4.5 rows (a dark upright on ' +
            'the grass). End camera (2.5 m): the stone fills the left third, each voxel ~5 rows.'
    }
  };

  // ===================================================================================================================
  // 3. WORLD PATCH for US-026a-content (PC-B, row 30g). Copy into content/worlds/world_m1.world.json exactly
  //    (architecture.md 23.2 shape). `bounds` and the two hint triggers are the architect's 23.2 values, repeated here so
  //    the file has one complete list; only endMarker + the `end` trigger numbers are the designer's.
  // ===================================================================================================================
  A.worldPatch = A.worldPatch || {};
  A.worldPatch.world_m1 = {
    story: 'US-026a', target: 'content/worlds/world_m1.world.json', op: 'append', applier: 'none (hand copy, like levelPatch)',
    bounds: { shape: 'circle', x: 1496.5, y: 1024.5, r: 96 },
    entities: { append: [
      { id: 'endMarker', type: 'prop', x: 1428, y: 1040, z: 'ground', yawDeg: 75,
        components: { voxel: { model: 'waystone', anim: 'idle', loop: true } } }
    ] },
    triggers: { append: [
      { id: 'end', shape: 'circle', x: 1428, y: 1040, r: 2.5, once: true, trigger: 'quest.end',
        walkTo: { x: 1429.86, y: 1038.33 }, lookAt: 'farTower', pitchTo: 0 },
      { id: 'hintStone', shape: 'terrain', once: true, trigger: 'hint.show', hint: 'stone' },
      { id: 'boundsEdge', shape: 'bounds', once: true, trigger: 'hint.show', hint: 'boundsEdge' }
    ] },
    note: 'the model key is waystone (ASSETS.models.waystone, this file). Hint texts stone / boundsEdge go into ' +
          'uiStyle.storyHints (23.2; writer may reword). The tower level loses triggers[id=end] and the trigger:end tags on X/Y.'
  };

  // ===================================================================================================================
  // 4. ATTACH: ASSETS.models.waystone only when every material key of the model is in palette.materials AND
  //    detailPass.materials (a missing v2 record would switch the GPU path off, 15.3 item 6). Merged in v1.16, so it
  //    attaches at load; the guard stays for pages that load this file without detail-pass.js.
  // ===================================================================================================================
  A.voxelModels.batch3 = ['waystone'];
  A.voxelModels.attachWorld = function attachWorld() {
    var P = A.palette, DP = A.detailPass, done = [], k, ok, vox;
    if (!P || !DP) return done;
    if (A.models.waystone) return done;
    vox = A.voxelModels.waystone.voxel; ok = true;
    for (k in vox.mats) if (!P.materials[vox.mats[k]] || !DP.materials[vox.mats[k]]) ok = false;
    if (ok) { A.models.waystone = A.voxelModels.waystone; done.push('waystone'); }
    return done;
  };
  A.voxelModels.attachWorld();
})(typeof window !== 'undefined' ? window : globalThis);
