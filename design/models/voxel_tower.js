/*
 * Kestrel - VOXEL PROPS, batch 2 (US-056, D-019, ART-OWN-001): the remaining solid tower props as real 3D voxel models.
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + 15.3 item 4 (mounts) + 15.3 item 6 (content contract);
 * batch 1 (lever, lantern, the 5 brass / iron materials) is design/models/voxel_props.js.
 * Preview: design/preview/voxel-props.html (engine oracle: packVoxelModel + computeVoxelPose + marchVoxelRay).
 *
 * LOAD ORDER: after voxel_props.js (that file assigns ASSETS.voxelMaterials; this one ADDS to it) and after the billboard
 * model files (boulder.js, rubble.js, wreckage.js, relay.js), because attachTower() puts `.voxel` onto those models.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.boulder        mossy granite boulder, r 0.6 m                      16x16x16 @ 0.075 m
 *   ASSETS.voxelModels.rubble0..2     fallen cut blocks + pebbles (= models.rubble.variants[0..2], level `variant`)
 *   ASSETS.voxelModels.canvasHeap     the wake spot: crumpled envelope canvas, 2.0 x 0.9 x 0.31 m (hollow where Wick lay)
 *   ASSETS.voxelModels.gondola        the Kestrel's brass basket, 2.2 x 0.9 x 1.1 m (rail, posts, name board, stays)
 *   ASSETS.voxelModels.strut          bent brass gondola strut on the rubble, 0.9 x 0.2 x 0.5 m
 *   ASSETS.voxelModels.envelopeHeap   the envelope snagged below the summit breach, 5.0 x 2.2 x 1.6 m (+1.0 m downhill skirt)
 *   ASSETS.voxelModels.relay          the summit relay: brass tripod + bowl + cracked mirror + crystals (dead / wake / awake);
 *                                     the GLOW stays a billboard (US-022, a separate prop at relay.mounts.glow)
 *   ASSETS.voxelMaterials.*           + 12 new prop materials (v1 + v2 + remap + fallback), listed in `.batch2`
 *   ASSETS.voxelModels.attachTower()  puts `.voxel` onto the billboard models (per model, only when every one of ITS
 *                                     material keys is in palette.materials AND detailPass.materials). Called at load.
 *
 * AXES (15.1): x = east (x0 west), y = SOUTH with y0 = the FRONT row (faces north at yaw 0), z = up. Yaw = level `facing`.
 * At facing 90 the front faces EAST and local +x runs SOUTH (the gondola, strut, envelope heap and relay use that).
 *
 * The layer rows are GENERATED at load time by the small deterministic builders below (integer hash, no Math.random),
 * so the data is plain strings like batch 1 and the preview's JSON dump shows exactly what the engine gets.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};

  // ===================================================================================================================
  // 0. BUILD HELPERS
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
  Grid.prototype.box = function (x0, y0, z0, x1, y1, z1, c) {       // half-open, like part boxes
    for (var z = z0; z < z1; z++) for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) this.set(x, y, z, c);
  };
  Grid.prototype.exposed = function (x, y, z) {
    return !this.full(x + 1, y, z) || !this.full(x - 1, y, z) || !this.full(x, y + 1, z) || !this.full(x, y - 1, z) ||
           !this.full(x, y, z + 1) || !this.full(x, y, z - 1);
  };
  Grid.prototype.each = function (fn) {
    for (var z = 0; z < this.sz; z++) for (var y = 0; y < this.sy; y++) for (var x = 0; x < this.sx; x++) {
      if (this.full(x, y, z)) fn(x, y, z, this.get(x, y, z));
    }
  };
  // exposed-top voxels of a stone body become the lit rim material (ART-OWN-001 "bright top edge, dark body")
  Grid.prototype.topRim = function (body, rim) {
    var self = this, list = [];
    this.each(function (x, y, z, c) { if (c === body && !self.full(x, y, z + 1)) list.push([x, y, z]); });
    list.forEach(function (p) { self.set(p[0], p[1], p[2], rim); });
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
  Grid.prototype.count = function () { var n = 0; this.each(function () { n++; }); return n; };
  Grid.prototype.bounds = function (pred) {
    var b = [1e9, 1e9, 1e9, -1, -1, -1];
    this.each(function (x, y, z, c) {
      if (pred && !pred(c)) return;
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.min(b[2], z);
      b[3] = Math.max(b[3], x + 1); b[4] = Math.max(b[4], y + 1); b[5] = Math.max(b[5], z + 1);
    });
    return b;
  };

  // voxel char -> material key (one table for the whole batch; each model's `mats` holds only the chars it uses)
  var KEY = {
    R: 'brass_light', H: 'brass_hot', b: 'brass_dark', B: 'brass', i: 'iron_light', d: 'iron_dark',    // batch 1 + palette
    C: 'canvas_light', c: 'canvas', k: 'canvas_dark', r: 'rope', w: 'wood', v: 'patina',                 // wreck
    T: 'block_light', D: 'block_dark', L: 'granite_light', g: 'granite_dark', m: 'moss_cap',              // stone props
    x: 'crystal_dead', X: 'crystal_lit', M: 'mirror_dark'                                                 // relay
  };
  function matsOf(G) {
    var used = {}, o = {}, k;
    G.each(function (x, y, z, c) { used[c] = 1; });
    for (k in used) o[k] = KEY[k];
    return o;
  }
  function idle1() { return { durations: [1000], loop: true, frames: [{}] }; }

  // ===================================================================================================================
  // 1. MATERIALS (batch 2; merge like batch 1: v1 -> palette.materials after the batch-1 keys, v2 -> detailPass.materials,
  //    remap k -> k). Existing keys reused as they are: canvas, wood, brass (+ batch 1 brass_* / iron_*).
  //    Value ladder vs the tower stone (stoneMid luma ~128, stoneLight ~172, flagstone ~115): every prop has a rim
  //    ABOVE stoneLight or a body BELOW 0.8 x stoneMid, rim / body >= 1.5, and no tone is a wall / floor stone tone
  //    (stoneMid / Cool / Warm / Deep / Light, mortar, flagstone, rubble). The preview checks all three.
  // ===================================================================================================================
  function tex(key, rows) { return { w: rows[0].length, h: rows.length, scale: [16, 16], key: key, rows: rows }; }
  var V1 = {
    canvas_light: {
      desc: 'VOXEL PROPS (wreck). Bright crests of crumpled envelope canvas: fold tops, the high ridge of a heap. Pale ochre, ' +
            'the brightest thing on the floor after the sun patch.',
      base: 'canvasLight', albedo: 0.92, ramp: 'canvas', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, f: { shade: 1.10, glyph: ')' }, s: { shade: 0.88, tint: 'canvas', amount: 0.5 } },
                   ['aafa', 'asaa', 'faaa', 'aasf'])
    },
    canvas_dark: {
      desc: 'VOXEL PROPS (wreck). Canvas in the fold shadows, the flanks of the folds, the hem on the floor and the scorched ' +
            'ends (canvasScorch tone). The heap\'s dark body and ground contour.',
      base: 'canvasDark', albedo: 0.66, ramp: 'canvas', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, t: { shade: 0.62, tint: 'canvasScorch', amount: 0.75 }, f: { shade: 0.90, glyph: '(' } },
                   ['atfa', 'aaat', 'fata', 'taaa'])
    },
    patina: {
      desc: 'VOXEL PROPS (machine). Verdigris on brass: the gondola dent, the strut kink, spots on the relay bowl. Teal-green, ' +
            'so a bend or dent reads as damage and not as a hole.',
      base: 'verdigris', albedo: 0.80, ramp: 'copper', spec: 0.20, bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, l: { shade: 1.15, tint: 'verdigrisLight', amount: 0.6, glyph: '%' },
                     d: { shade: 0.78, tint: 'verdigrisDark', amount: 0.6 } }, ['alad', 'daal', 'lada', 'adla'])
    },
    rope: {
      desc: 'VOXEL PROPS (wreck). Rope: the snapped stays on the gondola rail, the rope bands over the canvas heaps. ' +
            'Twist = alternating light ) / dark ( texels.',
      base: 'rope', albedo: 0.85, ramp: 'canvas', bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
      texture: tex({ l: { shade: 1.15, tint: 'ropeLight', amount: 0.6, glyph: ')' }, d: { shade: 0.75, tint: 'ropeDark', amount: 0.6, glyph: '(' } },
                   ['ld', 'dl'])
    },
    block_light: {
      desc: 'VOXEL PROPS (rubble). Weathered top faces and top edges of fallen cut blocks: pale, lime-washed by the rain. ' +
            'Much lighter than any wall stone, so a block on the rubble floor has a bright lid.',
      base: 'pencil', albedo: 0.92, ramp: 'stone', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, h: { shade: 1.08, tint: 'ashLight', amount: 0.4 }, x: { shade: 0.80, glyph: ',' } },
                   ['aaha', 'haax', 'axah', 'aaaa'])
    },
    block_dark: {
      desc: 'VOXEL PROPS (rubble). The broken sides of the fallen blocks and the pebbles\' shadow sides: dark, so the block ' +
            'separates from the mid-value rubble floor and the wall behind it.',
      base: 'stoneDark', albedo: 0.62, ramp: 'stone', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, c: { shade: 0.70, tint: 'ashDark', amount: 0.5 }, x: { shade: 0.55, glyph: ',' } },
                   ['aaca', 'caaa', 'aaxa', 'acaa'])
    },
    granite_light: {
      desc: 'VOXEL PROPS (boulder). The upper band of the boulder under its moss cap: cool pale granite with bright ' +
            'specks. Neutral / cool, never the warm wall beige.',
      base: 'ashLight', albedo: 0.90, ramp: 'rubble', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, s: { shade: 1.12, tint: 'steam', amount: 0.3 }, d: { shade: 0.85, tint: 'rock', amount: 0.5 } },
                   ['asad', 'daas', 'asda', 'sada'])
    },
    granite_dark: {
      desc: 'VOXEL PROPS (boulder). The boulder\'s lower half and the crack: dark neutral granite with pale lichen specks. ' +
            'The dark body under the bright rim.',
      base: 'ashDark', albedo: 0.62, ramp: 'rubble', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, d: { shade: 0.72, tint: 'ironDark', amount: 0.6 }, l: { shade: 1.25, tint: 'ash', amount: 0.5, glyph: "'" } },
                   ['adaa', 'aaad', 'alaa', 'daal'])
    },
    moss_cap: {
      desc: 'VOXEL PROPS (boulder, rubble). A thick moss cushion on the top of a stone prop, brighter and yellower than the ' +
            'wall moss (moss_top is the wall-top material), so the boulder\'s cap reads first.',
      base: 'mossLight', albedo: 0.88, ramp: 'foliage', bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, d: { shade: 0.75, tint: 'mossDark', amount: 0.7, glyph: '"' }, l: { shade: 1.10, tint: 'moss', amount: 0.4 } },
                   ['adal', 'laad', 'adla', 'dala'])
    },
    crystal_dead: {
      desc: 'VOXEL PROPS (relay). The dead aether crystals: grey with a teal memory, glassy (spec 0.5). Not emissive: the ' +
            'relay is asleep until US-022.',
      base: 'aetherDead', albedo: 0.78, ramp: 'iron', spec: 0.50, bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, g: { shade: 1.20, tint: 'aetherDim', amount: 0.5 } }, ['agaa', 'aaag', 'gaaa', 'aaga'])
    },
    crystal_lit: {
      desc: 'VOXEL PROPS (relay). The awake crystals (relay clips wake / awake): aether teal with white-hot cores, emissive ' +
            '0.85 so they glow in shade. The halo / sparkles stay a billboard (US-022).',
      base: 'aether', albedo: 1.00, ramp: 'aether', spec: 0.40, emissive: 0.85, bg: { mode: 'darken', k: 0.22 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, c: { shade: 1.20, tint: 'aetherCore', amount: 0.6 }, m: { shade: 0.85, tint: 'aetherMid', amount: 0.5 } },
                   ['acam', 'maac', 'acma', 'caam'])
    },
    mirror_dark: {
      desc: 'VOXEL PROPS (relay). The cracked relay mirror: dull blue-grey glass with bright streaks (spec 0.85), inside a ' +
            'brass_light frame. The crack itself is iron_dark voxels.',
      base: 'mirrorDark', albedo: 0.80, ramp: 'iron', spec: 0.85, bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, s: { shade: 1.30, tint: 'mirror', amount: 0.6 } }, ['saaa', 'asaa', 'aasa', 'aaas'])
    }
  };
  // v2: the tone grid is about half a voxel of the model that uses the material (tones change inside a near voxel face);
  // lines: false (the edge pass draws the voxel steps, 15.2 item 5).
  function v2(key, seed, albedo, tones, set, g, extra) {
    var o = { v1: key, seed: seed, desc: V1[key].desc, albedo: albedo, bgK: V1[key].bg.k, detail: 32, jitter: 0.06,
              tones: tones, grid: { u: g, v: g, stagger: 0, lines: false },
              face: { set: set, mid: set, far: set }, lod: { mid: 12, far: 25, dither: 3 } }, k;
    for (k in extra || {}) o[k] = extra[k];
    return o;
  }
  var V2 = {
    canvas_light:  v2('canvas_light',  211, 0.92, [['canvasLight', 4], ['canvas', 1]], 'canvasFace', 0.035),
    canvas_dark:   v2('canvas_dark',   212, 0.66, [['canvasDark', 2], ['canvasScorch', 2]], 'canvasFace', 0.035),
    patina:        v2('patina',        213, 0.80, [['verdigris', 3], ['verdigrisLight', 1], ['verdigrisDark', 1]], 'verdigris', 0.03),
    rope:          v2('rope',          214, 0.85, [['rope', 3], ['ropeLight', 2], ['ropeDark', 1]], 'canvasFace', 0.04),
    block_light:   v2('block_light',   215, 0.92, [['pencil', 3], ['ashLight', 1]], 'rubbleFace', 0.025),
    block_dark:    v2('block_dark',    216, 0.62, [['stoneDark', 3], ['ashDark', 1]], 'rubbleFace', 0.025),
    granite_light: v2('granite_light', 217, 0.90, [['ashLight', 3], ['steamDim', 2]], 'rockFace', 0.04),
    granite_dark:  v2('granite_dark',  218, 0.62, [['ashDark', 3], ['ironDark', 1]], 'rockFace', 0.04),
    moss_cap:      v2('moss_cap',      219, 0.88, [['mossLight', 3], ['moss', 2]], 'mossTop', 0.04),
    crystal_dead:  v2('crystal_dead',  220, 0.78, [['aetherDead', 3], ['mirrorDark', 1]], 'ironFace', 0.06),
    crystal_lit:   v2('crystal_lit',   221, 1.00, [['aether', 3], ['aetherLight', 2], ['aetherCore', 1]], 'ironFace', 0.06, { emissive: 0.85 }),
    mirror_dark:   v2('mirror_dark',   222, 0.80, [['mirrorDark', 3], ['mirror', 1]], 'ironFace', 0.06)
  };
  // castModels / preview only, before the merge: nearest existing material per key (NOT the intended look)
  var FALLBACK = { canvas_light: 'canvas', canvas_dark: 'canvas', patina: 'copper', rope: 'wood', block_light: 'rubble',
                   block_dark: 'rubble', granite_light: 'rock', granite_dark: 'rock', moss_cap: 'moss_top',
                   crystal_dead: 'iron', crystal_lit: 'iron', mirror_dark: 'iron' };
  var VM = A.voxelMaterials = A.voxelMaterials ||
    { status: 'PROPOSED', v1: {}, v2: {}, remap: {}, edges: { modelRim: 0.55 }, fallback: {} };
  VM.v1 = VM.v1 || {}; VM.v2 = VM.v2 || {}; VM.remap = VM.remap || {}; VM.fallback = VM.fallback || {};
  VM.batch2 = [];
  Object.keys(V1).forEach(function (k) {
    VM.v1[k] = V1[k]; VM.v2[k] = V2[k]; VM.remap[k] = k; VM.fallback[k] = FALLBACK[k]; VM.batch2.push(k);
  });

  // ===================================================================================================================
  // 2. BOULDER  16 x 16 x 16 @ 0.075 m = the 0.6 m radius of the US-013 roller. One part `rock`, pivot = sphere centre.
  //    Round, slightly lumpy granite (3 low lobes); a bright yellow-green MOSS CAP on top that spills further down the
  //    front / north side in drips; a pale granite_light band under it (the lit rim); a dark granite_dark lower half (the
  //    dark body, sits in its own shadow); one dark carved crack on the east flank; a few lichen specks.
  //    Clips: `roll` = 8 identical rest frames (so any sprite-style frame index 0..7 the roller writes is valid and the
  //    boulder never turns by itself: D-019 item 5 "no roll"); `rollTurn` = OPTIONAL real roll, 8 step frames, rot x
  //    0..315 deg in 45 deg steps (0.471 m per frame = models.boulder.roll.metersPerFrame; positive = top moves to the
  //    front). Only used if the PO / manager want the roll back (the roller would set frame = rollFrame(dist)).
  // ===================================================================================================================
  function buildBoulder() {
    var N = 16, G = new Grid(N, N, N), x, y, z;
    for (z = 0; z < N; z++) for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      var px = x + 0.5 - 8, py = y + 0.5 - 8, pz = z + 0.5 - 8, r = Math.sqrt(px * px + py * py + pz * pz);
      var az = Math.atan2(py, px), el = r > 0 ? Math.asin(pz / r) : 0;
      var R = 7.55 + 0.35 * Math.sin(3 * az + 0.7) * Math.cos(el) + 0.25 * Math.sin(2 * el + az + 1.3);
      if (r <= R || (z === 0 && px * px + py * py <= 2.5)) G.set(x, y, z, 'g');   // + a flat contact patch
    }
    var paint = [];
    G.each(function (x, y, z) {
      if (!G.exposed(x, y, z)) return;
      var px = x + 0.5 - 8, py = y + 0.5 - 8, pz = z + 0.5 - 8, r = Math.sqrt(px * px + py * py + pz * pz) || 1;
      var nz = pz / r, hxy = Math.sqrt(px * px + py * py) || 1, north = Math.max(0, -py / hxy), h = hash(x, y, z, 7);
      var c;
      if (nz > 0.58 - 0.30 * north + 0.18 * (h - 0.5)) c = 'm';                          // moss cap, lower on the north
      else if (nz > 0.05 + 0.20 * (h - 0.5)) c = 'L';                                   // lit granite band
      else c = 'g';                                                                     // dark lower half
      if (c !== 'm' && north > 0.7 && nz > -0.25 && hash(x, y, 0, 11) < 0.35) c = 'm';  // moss drips (whole columns)
      if (c === 'g' && h < 0.06) c = 'L';                                               // lichen specks
      if (c === 'L' && h > 0.94) c = 'g';
      paint.push([x, y, z, c]);
    });
    paint.forEach(function (p) { G.set(p[0], p[1], p[2], p[3]); });
    // the crack: a groove on the east flank, carved AFTER painting so its floor is the unpainted dark granite
    var carve = [];
    G.each(function (x, y, z) {
      if (!G.exposed(x, y, z)) return;
      var px = x + 0.5 - 8, py = y + 0.5 - 8, pz = z + 0.5 - 8, r = Math.sqrt(px * px + py * py + pz * pz) || 1, nz = pz / r;
      var az = Math.atan2(py, px);
      if (nz > -0.55 && nz < 0.45 && Math.abs(az - (0.35 + 0.30 * nz)) < 0.085) carve.push([x, y, z]);
    });
    carve.forEach(function (p) { G.set(p[0], p[1], p[2], '.'); });
    return G;
  }
  var gB = buildBoulder();
  var ROLL_STATIC = [], ROLL_TURN = [], ROT = [0, 45, 90, 135, 180, -135, -90, -45], DUR8 = [];
  ROT.forEach(function (d) {
    ROLL_STATIC.push({}); ROLL_TURN.push({ rock: { rot: [d, 0, 0] } }); DUR8.push(1000);
  });
  A.voxelModels.boulder = {
    name: 'boulder',
    desc: 'Voxel boulder (US-013 roller, r 0.6 m): lumpy granite ball, bright moss cap spilling down the north side, pale ' +
          'granite band under it, dark lower half, one carved crack on the east flank, lichen specks.',
    voxel: {
      version: 1, cellM: 0.075, size: [16, 16, 16], anchor: [8, 8, 0],
      mats: matsOf(gB), layers: gB.layers(),
      parts: { rock: { box: [0, 0, 0, 16, 16, 16], pivot: [8, 8, 8] } },          // extent 48 (the limit, exactly)
      animations: {
        roll: { durations: DUR8.slice(), loop: true, interp: 'step', frames: ROLL_STATIC },
        rollTurn: { durations: DUR8.slice(), loop: true, interp: 'step', frames: ROLL_TURN }
      },
      mounts: { top: { at: [8, 8, 16], part: 'rock' } }
    },
    placement: { level: 'tower', prop: 'boulder', x: 15.55, y: 3.5, z: 0.0, facing: 0, levelEdit: false,
                 note: 'dynamic prop: transform z = feet = sphere bottom; yawDeg = heading from the roller (15.3 item 1)' },
    readability: { note: 'At 3 m: 160x60 ~28 rows tall (1.7 rows / voxel). Moss cap + round silhouette = "boulder" unprompted.' }
  };

  // ===================================================================================================================
  // 3. RUBBLE  3 variants @ 0.05 m (the level picks one with props[].variant = models.rubble.variants[n]).
  //    Cut blocks and pebbles: exposed TOP voxels = block_light (bright lid + a 5 cm light band on every top edge from
  //    the side), everything else block_dark (dark broken sides), the odd moss_cap patch. Chipped top edges.
  //    rubble1 leaves a 0.25 m GAP at local x -0.25..0 between its two blocks: the strut (14.4, 8.2) lies in it when
  //    rubble1 is the rubble2 prop at (14.5, 8.5) - checked in the preview.
  // ===================================================================================================================
  function chipTop(G, s, p) {       // knock out a share p of the top-edge voxels (weathered edges)
    var cut = [];
    G.each(function (x, y, z) {
      if (G.full(x, y, z + 1)) return;
      var edge = !G.full(x + 1, y, z) || !G.full(x - 1, y, z) || !G.full(x, y + 1, z) || !G.full(x, y - 1, z);
      if (edge && z > 0 && hash(x, y, z, s) < p) cut.push([x, y, z]);
    });
    cut.forEach(function (q) { G.set(q[0], q[1], q[2], '.'); });
  }
  function pebbles(G, list) { list.forEach(function (p) { G.set(p[0], p[1], p[2], 'D'); }); }
  function buildRubble0() {          // 18 x 12 x 7 = 0.9 x 0.6 x 0.35 m: one low block + pebbles
    var G = new Grid(18, 12, 7);
    G.box(2, 2, 0, 14, 10, 6, 'D');                                   // block 0.6 x 0.4 x 0.3 m
    G.box(11, 2, 4, 14, 6, 6, '.'); G.box(12, 2, 3, 14, 4, 4, '.');   // broken NE corner (stepped)
    chipTop(G, 31, 0.18);
    G.box(6, 5, 6, 8, 6, 7, 'D');                                     // a loose chip lying on the top
    pebbles(G, [[15, 8, 0], [16, 8, 0], [15, 9, 0], [15, 8, 1], [16, 3, 0], [1, 9, 0], [0, 9, 0], [6, 11, 0]]);
    G.topRim('D', 'T');
    return G;
  }
  function buildRubble1() {          // 21 x 14 x 12 = 1.05 x 0.7 x 0.6 m: a big block + a leaning slab + pebbles, moss
    // local x -0.55..+0.50: at rubble4 (16.5, 2.5) the east edge stops at x 17.0, where the 0.9 m heap cell z begins
    var G = new Grid(21, 14, 12), x;
    G.box(11, 2, 0, 21, 13, 10, 'D');                                 // big block 0.5 x 0.55 x 0.5 m (local x 0..0.5)
    G.box(18, 2, 7, 21, 7, 10, '.'); G.box(19, 2, 5, 21, 5, 7, '.');  // broken corner
    for (x = 1; x < 6; x++) G.box(x, 4, 0, x + 1, 11, 3 + ((x - 1) >> 1), 'D');   // leaning slab (local x -0.5..-0.25)
    chipTop(G, 32, 0.15);
    G.box(13, 3, 10, 16, 6, 11, 'D'); G.set(14, 4, 11, 'D');          // a loose chunk on the big block
    pebbles(G, [[1, 12, 0], [2, 12, 0], [1, 2, 0], [2, 1, 0], [20, 13, 0]]);   // none in the strut gap x 6..10, none at x 0
    G.topRim('D', 'T');
    var moss = [];
    G.each(function (x, y, z, c) {
      if (c === 'T' && x >= 12 && x < 17 && y >= 8 && y < 13 && hash(x, y, z, 33) < 0.8) moss.push([x, y, z]);
      if (c === 'D' && y === 12 && x >= 12 && x < 16 && z >= 7 && hash(x, y, z, 34) < 0.5) moss.push([x, y, z]);   // spill
    });
    moss.forEach(function (p) { G.set(p[0], p[1], p[2], 'm'); });
    return G;
  }
  function buildRubble2() {          // 12 x 10 x 6 = 0.6 x 0.5 x 0.3 m: a small broken chunk (sloped break) + pebbles
    var G = new Grid(12, 10, 6), x, y;
    for (x = 2; x < 8; x++) for (y = 2; y < 8; y++) {
      G.box(x, y, 0, x + 1, y + 1, 6 - ((x - 2) >> 1) - ((y === 2 || y === 7) ? 1 : 0), 'D');
    }
    chipTop(G, 35, 0.12);
    pebbles(G, [[9, 3, 0], [10, 7, 0], [9, 7, 0], [9, 6, 0], [1, 8, 0], [10, 2, 0]]);
    G.topRim('D', 'T');
    var moss = [];
    G.each(function (x, y, z, c) { if (c === 'T' && z >= 3 && hash(x, y, z, 36) < 0.25) moss.push([x, y, z]); });
    moss.forEach(function (p) { G.set(p[0], p[1], p[2], 'm'); });
    return G;
  }
  function rubbleModel(n, G, anchor, desc, props) {
    var s = [G.sx, G.sy, G.sz];
    return {
      name: 'rubble' + n,
      desc: desc,
      voxel: {
        version: 1, cellM: 0.05, size: s, anchor: anchor, mats: matsOf(G), layers: G.layers(),
        parts: { stones: { box: [0, 0, 0, s[0], s[1], s[2]], pivot: [anchor[0], anchor[1], 0] } },
        animations: { idle: idle1() }
      },
      placement: { level: 'tower', model: 'rubble', variant: n, props: props, levelEdit: false },
      readability: { note: 'At 2 m, eye 1.3 m above the heap: 160x60 ~' + Math.round(s[2] * 0.05 * 69.5 / 2) + ' rows tall.' }
    };
  }
  var gR0 = buildRubble0(), gR1 = buildRubble1(), gR2 = buildRubble2();
  A.voxelModels.rubble0 = rubbleModel(0, gR0, [9, 6, 0],
    'Voxel rubble 0: one low cut block (0.6 x 0.4 x 0.3 m) with a broken stepped corner, chipped edges, a loose chip on ' +
    'top and a few pebbles. Bright lid, dark sides.', ['rubble1', 'rubble5']);
  A.voxelModels.rubble1 = rubbleModel(1, gR1, [11, 7, 0],
    'Voxel rubble 1: a big block (0.55 m cube-ish, broken corner, moss patch spilling over the south edge, a loose chunk ' +
    'on top) and a leaning slab, with a gap between them (the strut lies there at 14.4, 8.2).', ['rubble2', 'rubble4']);
  A.voxelModels.rubble2 = rubbleModel(2, gR2, [6, 5, 0],
    'Voxel rubble 2: a small chunk with a sloped break (0.3 m high end), a little moss, pebbles.', ['rubble3']);

  // ===================================================================================================================
  // 4. CANVAS HEAP (the wake spot)  32 x 14 x 5 @ 0.0625 m = 2.0 x 0.875 x 0.31 m, two static parts (west / east
  //    halves: the box extent limit). A heightfield of crumpled envelope: a tall fold on the west (the billboard's high
  //    fold), a second fold on the east, a crumple along the north edge, a flat tattered hem, scorched ends, a rope band
  //    with a brass eyelet. Top voxel of a column = canvas_light on crests / canvas elsewhere; everything under the top
  //    = canvas_dark (the fold flanks read as shadow). THE HOLLOW: around the anchor (= the start pose 17.0, 9.5, eye
  //    0.3 m) the canvas is at most 0.125 m high, so the lying camera is never inside or behind a fold.
  // ===================================================================================================================
  function buildCanvasHeap() {
    var SX = 32, SY = 14, G = new Grid(SX, SY, 5), H = [], x, y, z;
    for (y = 0; y < SY; y++) {
      H.push([]);
      for (x = 0; x < SX; x++) {
        var ex = (x + 0.5 - 16) / 16, ey = (y + 0.5 - 7) / 7, e = ex * ex + ey * ey;
        var edge = 1 - 0.22 * hash(x, y, 0, 21) - 0.10 * Math.sin(x * 0.9 + y * 0.7);
        if (e > edge) { H[y].push(0); continue; }
        var h = 1;
        h += 4.4 * Math.exp(-Math.pow(x - 7 - 1.4 * Math.sin(y * 0.55), 2) / 5) * (1 - 0.6 * ey * ey);   // tall fold, peak 5 layers
        h += 2.0 * Math.exp(-Math.pow(x - 25 + (y - 7) * 0.5, 2) / 3.5);
        if (x > 10 && x < 28) h += 1.0 * Math.exp(-Math.pow(y - 2.5, 2) / 2);
        h += 0.6 * (hash(x >> 1, y >> 1, 1, 22) - 0.5);
        if (e > edge - 0.18) h = Math.min(h, 1.4);                                 // flat hem
        var bx = (x + 0.5 - 16) / 4.5, by = (y + 0.5 - 7) / 4, bb = bx * bx + by * by;
        if (bb < 1) h = Math.min(h, 1.6 + 0.8 * bb);                               // the hollow (<= 2 voxels)
        var dc = Math.sqrt(Math.pow(x + 0.5 - 16, 2) + Math.pow(y + 0.5 - 7, 2));
        if (dc < 6.8) h = Math.min(h, 3.4);                                        // <= 3 voxels (0.19 m) within 0.42 m of the start pose
        H[y].push(Math.max(1, Math.min(5, Math.round(h))));
      }
    }
    function hAt(x, y) { return (x < 0 || y < 0 || x >= SX || y >= SY) ? 0 : H[y][x]; }
    for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      var n = H[y][x];
      if (!n) continue;
      var crest = n >= 3 && n >= hAt(x - 1, y) && n >= hAt(x + 1, y) && n >= hAt(x, y - 1) && n >= hAt(x, y + 1);
      var hem = hAt(x - 1, y) === 0 || hAt(x + 1, y) === 0 || hAt(x, y - 1) === 0 || hAt(x, y + 1) === 0;
      var top = n >= 4 || crest ? 'C' : (hem ? 'k' : 'c');
      if (Math.abs(x + 0.5 - 16) > 12.5 && hash(x, y, 3, 23) < 0.55) top = 'k';   // scorched ends
      if (x === 22) top = 'r';                                                    // rope band
      if (x === 22 && y === 7) top = 'H';                                         // brass eyelet
      for (z = 0; z < n - 1; z++) G.set(x, y, z, 'k');
      G.set(x, y, n - 1, top);
    }
    return G;
  }
  var gCH = buildCanvasHeap();
  A.voxelModels.canvasHeap = {
    name: 'canvasHeap',
    desc: 'Voxel canvas heap (the wake spot): crumpled pale-ochre envelope, a tall fold west, a second fold east, a crumple ' +
          'along the north edge, bright crests over dark fold flanks, tattered dark hem, scorched ends, a rope band with a ' +
          'brass eyelet, and a shallow hollow in the middle where Wick lay. Walk-over (no collision).',
    voxel: {
      version: 1, cellM: 0.0625, size: [32, 14, 5], anchor: [16, 7, 0], mats: matsOf(gCH), layers: gCH.layers(),
      parts: {
        west: { box: [0, 0, 0, 16, 14, 5], pivot: [8, 7, 0] },     // extent 35
        east: { box: [16, 0, 0, 32, 14, 5], pivot: [24, 7, 0] }    // extent 35
      },
      animations: { idle: idle1() }
    },
    placement: { level: 'tower', prop: 'pallet', x: 17.0, y: 9.5, z: 0.0, facing: 0, levelEdit: false,
                 note: 'world x 16.0..18.0, y 9.06..9.94 (south wall at y 10.0); the start eye (17.0, 9.5, 0.3) is 0.18 m above the hollow' },
    readability: { note: 'At 2.2 m standing: 160x60 ~10 rows tall, ~26 cols wide; the crests and the dark hem outline it.' }
  };

  // ===================================================================================================================
  // 5. GONDOLA  26 x 11 x 13 @ 0.085 m = 2.21 x 0.94 x 1.1 m, two static parts (bow / stern halves: extent limit).
  //    The Kestrel's basket, crashed upright: iron_dark keel (the ground contour), brass_dark hull (the dark body) with
  //    rounded ends, a brass belt with brass_hot rivets, a wood name board with brass_hot "lettering" dots in a
  //    brass_light frame on the FRONT side (faces east at facing 90 = toward the wake spot), a verdigris dent, a wood
  //    deck inside, brass_light posts and rail (the bright rim), brass_hot knobs, and 5 snapped rope stays.
  //    PLACEMENT: facing 90 puts the keel north-south (local +x = south). The anchor is NOT the hull centre: the stern
  //    ends at y ~9.0 so the rigging coil billboard (15.3, 9.5) lies just behind the stern instead of inside the hull;
  //    the hull spans y ~6.9..9.0 and x 15.02..15.78 (clear of the rubble cell 14,8, the canvas heap x >= 16 and the
  //    wake -> burner corridor, all checked in the preview).
  // ===================================================================================================================
  function inHull(x, y, x0, x1, y0, y1, cut) {        // inclusive rounded rectangle, corners cut by `cut`
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    return Math.min(x - x0, x1 - x) + Math.min(y - y0, y1 - y) >= cut;
  }
  function buildGondola() {
    var G = new Grid(26, 11, 13), x, y, z;
    for (y = 0; y < 11; y++) for (x = 0; x < 26; x++) {
      if (inHull(x, y, 5, 20, 4, 6, 0)) G.set(x, y, 0, 'd');                                         // keel
      if (inHull(x, y, 3, 22, 3, 7, 1)) G.set(x, y, 1, 'b');                                         // bottom
      if (inHull(x, y, 2, 23, 2, 8, 2)) G.set(x, y, 2, inHull(x, y, 3, 22, 3, 7, 2) ? 'w' : 'b');    // bilge ring + deck
      var ring = inHull(x, y, 1, 24, 1, 9, 2) && !inHull(x, y, 2, 23, 2, 8, 2);
      if (!ring) continue;
      var longSide = y === 1 || y === 9;
      for (z = 3; z < 8; z++) G.set(x, y, z, z <= 5 ? 'b' : 'B');                                    // hull walls
      if (longSide && x % 3 === 0) G.set(x, y, 6, 'H');                                              // belt rivets
      var post = longSide ? (x % 4 === 1) : (y === 3 || y === 5 || y === 7);
      if (post) G.set(x, y, 8, 'R');                                                                 // rail posts
      G.set(x, y, 9, 'R');                                                                           // rail
    }
    // name board on the front side (y 1): wood with brass_hot letter dots, brass_light frame
    for (x = 9; x <= 16; x++) {
      var frame = x === 9 || x === 16;
      G.set(x, 1, 5, frame ? 'R' : 'w');
      G.set(x, 1, 6, frame ? 'R' : ([10, 12, 13, 15].indexOf(x) >= 0 ? 'H' : 'w'));
    }
    // verdigris dent (front, near the bow) and a spot at the stern (back side)
    for (x = 3; x <= 6; x++) for (z = 3; z <= 4; z++) if (hash(x, 1, z, 41) < 0.75) G.set(x, 1, z, 'v');
    G.set(19, 9, 4, 'v'); G.set(20, 9, 4, 'v'); G.set(20, 9, 3, 'v');
    // rail knobs
    [[2, 2], [2, 8], [23, 2], [23, 8], [13, 1], [13, 9]].forEach(function (p) { G.set(p[0], p[1], 9, 'H'); });
    // snapped stays (rope), leaning in from the rail corners, one taller at mid front
    [[[2, 2, 10], [3, 3, 11]], [[2, 8, 10], [3, 7, 11]], [[23, 2, 10], [22, 3, 11]],
     [[23, 8, 10], [22, 7, 11], [21, 6, 12]], [[12, 1, 10], [12, 2, 11], [12, 3, 12]]].forEach(function (s) {
      s.forEach(function (p) { G.set(p[0], p[1], p[2], 'r'); });
    });
    return G;
  }
  var gG = buildGondola();
  A.voxelModels.gondola = {
    name: 'gondola',
    desc: 'Voxel gondola (the Kestrel\'s basket): dark riveted brass hull with rounded ends on an iron keel, brass belt, ' +
          'bright brass rail on posts (you see the wood deck inside), brass_hot knobs, the name board (wood, brass letter ' +
          'dots) facing the wake spot, a verdigris dent, snapped rope stays at the corners.',
    voxel: {
      version: 1, cellM: 0.085, size: [26, 11, 13], anchor: [21.5, 5.5, 0], mats: matsOf(gG), layers: gG.layers(),
      parts: {
        bow:   { box: [0, 0, 0, 13, 11, 13], pivot: [6.5, 5.5, 0] },     // extent 37
        stern: { box: [13, 0, 0, 26, 11, 13], pivot: [19.5, 5.5, 0] }    // extent 37
      },
      animations: { idle: idle1() },
      mounts: { board: { at: [12.5, 1, 6], part: 'bow' } }
    },
    placement: { level: 'tower', prop: 'gondola', x: 15.4, y: 8.7, z: 0.0, facing: 90, levelEdit: false,
                 note: 'anchor 21.5 of 26 along the keel: stern at world y ~9.0 (rigging coil at 15.3, 9.5 stays outside)' },
    readability: { note: 'At 3 m: 160x60 ~26 rows tall. Rail + posts + rounded hull + stays = "a basket / boat" unprompted.' }
  };

  // ===================================================================================================================
  // 6. STRUT  18 x 4 x 10 @ 0.05 m = 0.9 x 0.2 x 0.5 m. A square brass tube (2 x 2 voxels): the lower arm lies on the
  //    rubble (brass_light top, brass_dark underside), a mounting flange with brass_hot bolts at the low end, a verdigris
  //    kink, the upper arm bent up at ~55 deg to a jagged brass_hot broken end. At facing 90 the bar runs north-south,
  //    world y 8.05..8.95, x 14.3..14.5, on the rubble cell R (14,8) - in the gap of the rubble1 variant placed there.
  // ===================================================================================================================
  function buildStrut() {
    var G = new Grid(18, 4, 10), x, z;
    G.box(0, 1, 0, 12, 3, 1, 'b'); G.box(0, 1, 1, 12, 3, 2, 'R');          // lower arm
    G.box(0, 0, 0, 1, 4, 4, 'b'); G.box(0, 0, 3, 1, 4, 4, 'R');            // flange
    G.set(0, 0, 2, 'H'); G.set(0, 3, 2, 'H'); G.set(6, 1, 1, 'H');         // bolts + a rivet
    G.box(11, 1, 0, 13, 3, 3, 'v');                                        // the kink
    var cols = { 12: [1, 3], 13: [2, 5], 14: [4, 7], 15: [5, 8], 16: [7, 10] };   // upper arm, [z0, z1) per column
    for (x = 12; x <= 16; x++) for (z = cols[x][0]; z < cols[x][1]; z++) {
      G.box(x, 1, z, x + 1, 3, z + 1, z === cols[x][1] - 1 ? 'R' : (x <= 13 ? 'v' : 'b'));
    }
    G.set(17, 1, 8, 'H'); G.set(17, 2, 9, 'H'); G.set(16, 1, 9, 'H');      // jagged broken end
    return G;
  }
  var gS = buildStrut();
  A.voxelModels.strut = {
    name: 'strut',
    desc: 'Voxel bent strut: a square brass tube from the gondola frame lying on the rubble, bright top / dark underside, ' +
          'bolted flange at the low end, verdigris kink, the upper arm bent up to a jagged bright broken end.',
    voxel: {
      version: 1, cellM: 0.05, size: [18, 4, 10], anchor: [3, 2, 0], mats: matsOf(gS), layers: gS.layers(),
      parts: { bar: { box: [0, 0, 0, 18, 4, 10], pivot: [3, 2, 0] } },            // extent 32
      animations: { idle: idle1() }
    },
    placement: { level: 'tower', prop: 'strut', x: 14.4, y: 8.2, z: 0.6, facing: 90, levelEdit: false },
    readability: { note: 'At 1.8 m from the floor next to the heap: 160x60 ~19 rows tall (1.9 rows / voxel).' }
  };

  // ===================================================================================================================
  // 7. ENVELOPE HEAP  25 x 11 x 13 @ 0.2 m = 5.0 x 2.2 x 2.6 m, two static parts (extent limit). Anchor z = 5 voxels:
  //    the mound (up to 1.6 m) sits on the anchor plane; UNDER it, on the back side (local +y = WEST = downhill at
  //    facing 90), a canvas skirt hangs up to 1.0 m below the anchor, so the heap still meets the hill path that drops
  //    west (cells x 1..3). On flat ground the skirt is under the terrain (never seen). Seen from the summit breach,
  //    ~4-8 m away and ~2 m above: big gores (ridges every ~0.8 m), two rope bands with brass eyelets, bright crests,
  //    dark fold flanks, scorched blotches, dark hem.
  // ===================================================================================================================
  function buildEnvelopeHeap() {
    var SX = 25, SY = 11, G = new Grid(SX, SY, 13), x, y, z, H = [];
    for (y = 0; y < SY; y++) {
      H.push([]);
      for (x = 0; x < SX; x++) {
        var ex = (x + 0.5 - 12.5) / 12.5, ey = (y + 0.5 - 5.5) / 5.5, e = ex * ex + ey * ey;
        var edge = 1 - 0.20 * hash(x, y, 0, 31) - 0.08 * Math.sin(x * 1.1 + y * 0.6);
        if (e > edge) { H[y].push(0); continue; }
        var h = 8.2 * Math.pow(Math.max(0, 1 - e / edge), 0.65) + 0.7 * Math.cos((x + 0.3 * y) * 1.55);
        if (x === 7 || x === 17) h -= 0.9;                                          // rope bands pull it in
        h += 0.5 * (hash(x, y, 2, 32) - 0.5);
        H[y].push(Math.max(1, Math.min(8, Math.round(h))));
      }
    }
    for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      var n = H[y][x];
      if (!n) continue;
      var zb = 5 - Math.max(0, Math.min(5, y - 3));                                 // skirt: y <= 3 none .. y >= 8 to z 0
      var ztop = 5 + n - 1;
      var crest = Math.cos((x + 0.3 * y) * 1.55) > 0.3 && n >= 3;
      var top = crest ? 'C' : 'c';
      if (hash(x, y, 4, 33) < 0.07) top = 'k';                                       // scorched blotch
      if (x === 7 || x === 17) top = (y === 5 ? 'H' : 'r');                         // rope bands + eyelets
      for (z = zb; z < ztop; z++) {
        var c;
        if (z >= ztop - 2) c = 'k';                                                  // fold flanks under the top
        else if (z < 5) c = (x % 4 === 0 || z === zb) ? 'k' : 'c';                   // skirt: gore seams + dark hem
        else c = 'k';
        G.set(x, y, z, c);
      }
      G.set(x, y, ztop, top);
    }
    return G;
  }
  var gE = buildEnvelopeHeap();
  A.voxelModels.envelopeHeap = {
    name: 'envelopeHeap',
    desc: 'Voxel envelope heap below the summit breach: the Kestrel\'s collapsed envelope as a 5 m mound of big canvas gores, ' +
          'two rope bands with brass eyelets, bright crests, dark fold flanks and hem, scorched blotches, a skirt hanging ' +
          'down the hillside on the downhill (west) side.',
    voxel: {
      version: 1, cellM: 0.2, size: [25, 11, 13], anchor: [12.5, 5.5, 5], mats: matsOf(gE), layers: gE.layers(),
      parts: {
        west: { box: [0, 0, 0, 13, 11, 13], pivot: [6.5, 5.5, 5] },    // extent 37
        east: { box: [13, 0, 0, 25, 11, 13], pivot: [19, 5.5, 5] }     // extent 36
      },
      animations: { idle: idle1() }
    },
    placement: { level: 'tower', prop: 'envelopeHeap', x: 3.0, y: 6.5, z: 'ground', facing: 90, levelEdit: false,
                 note: 'world y 4.0..9.0, x 1.9..4.1; the skirt covers up to 1.0 m of downhill drop (owner walk-check: look ' +
                       'from the breach; if the terrain there drops more, raise anchor z by 1-2 voxels, not a level edit)' },
    readability: { note: 'From the breach (~4.5 m, eye ~2.4 m above the heap base): 160x60 ~25 rows tall.' }
  };

  // ===================================================================================================================
  // 8. RELAY  18 x 14 x 14 @ 0.12 m = 2.16 x 1.68 x 1.68 m on the 2 x 2 m plinth. The GLOW / halo / sparkles stay a
  //    billboard (US-022: a separate prop at mounts.glow). Parts (first part wins, so the crystal parts come first):
  //      crystalDead  the crystal cluster in place (crystal_dead bodies, iron_light tips)
  //      crystalLit   the SAME cluster in crystal_lit (emissive), stored beside it (6 voxels -x, 2 up) at rest
  //      mount        root: brass tripod (iron feet), iron stem, brass gear hub, brass bowl (bright rim + hot rivets,
  //                   verdigris spots), the cracked mirror behind (brass_light frame, mirror_dark face, iron_dark crack,
  //                   brass_dark back plate) on a back post.
  //    Clips (interp 'step', so nothing slides): dead = crystalLit 20 voxels (2.4 m) down, inside the walkway / plinth
  //    columns (hidden); wake = 8 x 125 ms, dead for 2 keys then awake (event `glowOn` at key 2 = relay.wakeLightFrame);
  //    awake = crystalDead hidden, crystalLit moved +6 x / -2 z onto the dead cluster's place. Front faces east (the
  //    summit doorway) at facing 90; the mirror is at the back (west).
  // ===================================================================================================================
  function buildRelay() {
    var G = new Grid(18, 14, 14), x, y, z, t;
    var CX = 9, CY = 6;                                                     // bowl axis (voxel-centre coordinates)
    function rxy(x, y) { var dx = x + 0.5 - CX, dy = y + 0.5 - CY; return Math.sqrt(dx * dx + dy * dy); }
    // tripod: 3 legs from the feet up to the hub (a dense sample so the staircase stays connected)
    [[3.5, 1.5], [14.5, 1.5], [9.5, 11.5]].forEach(function (f) {
      for (t = 0; t <= 1.0001; t += 1 / 24) {
        var px = f[0] + (CX - f[0]) * t, py = f[1] + (CY - f[1]) * t, pz = Math.min(3, Math.floor(t * 3.999));
        G.set(Math.floor(px), Math.floor(py), pz, 'b');
      }
      G.set(Math.floor(f[0]), Math.floor(f[1]), 0, 'd');                   // iron foot pad
    });
    G.box(8, 5, 3, 10, 7, 5, 'd');                                          // stem
    for (y = 0; y < 14; y++) for (x = 0; x < 18; x++) {
      var r = rxy(x, y);
      if (r > 1.2 && r <= 2.3) G.set(x, y, 3, (x + y) % 2 ? 'R' : 'H');   // gear hub ring, teeth
      if (r <= 3.0) G.set(x, y, 4, 'b');                                     // bowl bottom
      if (r <= 4.6) G.set(x, y, 5, 'b');                                     // bowl floor
      if (r > 4.0 && r <= 5.4) G.set(x, y, 6, hash(x, y, 6, 51) < 0.2 ? 'v' : 'b');   // bowl wall, verdigris spots
      if (r > 4.6 && r <= 6.0) {                                             // bright rim, 12 hot rivets
        var ang = Math.atan2(y + 0.5 - CY, x + 0.5 - CX) / (2 * Math.PI) * 12;
        G.set(x, y, 7, Math.abs(ang - Math.round(ang)) < 0.14 ? 'H' : 'R');
      }
    }
    // mirror at the back: face y 12, back plate y 13, disc in the x-z plane around (9, 9)
    for (z = 0; z < 14; z++) for (x = 0; x < 18; x++) {
      var dx = x + 0.5 - 9, dz = z + 0.5 - 9, rm = Math.sqrt(dx * dx + dz * dz);
      if (rm <= 4.9) { G.set(x, 13, z, 'b'); G.set(x, 12, z, rm <= 3.7 ? 'M' : 'R'); }
    }
    [[10, 11], [10, 10], [9, 9], [9, 8], [8, 7], [11, 9], [12, 8]].forEach(function (p) { G.set(p[0], 12, p[1], 'd'); });   // crack
    G.set(8, 12, 13, 'H'); G.set(9, 12, 13, 'H');                           // finial on the frame top
    G.box(8, 13, 0, 10, 14, 5, 'b');                                        // back post down to the plinth
    // crystals (dead) in place: box x 6..12, y 3..9, z 6..12 (clear of the bowl wall r > 4.0 at z 6)
    var CRY = [
      [8, 5, 6, 'x'], [9, 5, 6, 'x'], [8, 6, 6, 'x'], [9, 6, 6, 'x'], [8, 5, 7, 'x'], [9, 5, 7, 'x'], [8, 6, 7, 'x'], [9, 6, 7, 'x'],
      [8, 5, 8, 'x'], [9, 5, 8, 'x'], [8, 6, 8, 'x'], [9, 6, 8, 'x'], [8, 5, 9, 'i'], [9, 5, 9, 'x'], [8, 6, 9, 'x'], [9, 6, 9, 'i'],
      [9, 5, 10, 'i'], [8, 6, 10, 'i'], [9, 5, 11, 'i'],                                        // centre crystal, tip z 11
      [7, 4, 6, 'x'], [7, 4, 7, 'x'], [6, 3, 8, 'x'], [6, 3, 9, 'i'],                           // front-left, leaning out
      [10, 4, 6, 'x'], [10, 4, 7, 'x'], [11, 3, 8, 'i'],                                        // front-right
      [7, 7, 6, 'x'], [7, 7, 7, 'x'], [6, 8, 8, 'x'], [6, 8, 9, 'i'],                           // back-left
      [10, 7, 6, 'x'], [11, 8, 7, 'x'], [11, 8, 8, 'i'],                                        // back-right
      [8, 3, 6, 'x'], [8, 3, 7, 'i']                                                            // small front crystal
    ];
    CRY.forEach(function (p) { G.set(p[0], p[1], p[2], p[3]); G.set(p[0] - 6, p[1], p[2] + 2, 'X'); });  // + lit copy
    return G;
  }
  var gRe = buildRelay();
  var RELAY_HIDE = 20;   // voxels = 2.4 m: from plinth top 6.6 the hidden cluster ends below the walkway floor 6.0
  function relayDead() { return { crystalLit: { pos: [0, 0, -RELAY_HIDE] } }; }
  function relayAwake() { return { crystalDead: { pos: [0, 0, -RELAY_HIDE] }, crystalLit: { pos: [6, 0, -2] } }; }
  var WAKE = [relayDead(), relayDead()];
  while (WAKE.length < 8) WAKE.push(relayAwake());
  A.voxelModels.relay = {
    name: 'relay',
    desc: 'Voxel relay on the summit plinth: brass tripod with iron feet, gear hub, a wide brass bowl with a bright riveted ' +
          'rim and verdigris spots, a cluster of 6 aether crystals (grey when dead, emissive teal when awake), a cracked ' +
          'round mirror in a bright brass frame behind it. The glow is a separate billboard (US-022).',
    voxel: {
      version: 1, cellM: 0.12, size: [18, 14, 14], anchor: [9, 7, 0], mats: matsOf(gRe), layers: gRe.layers(),
      parts: {
        crystalDead: { box: [6, 3, 6, 12, 9, 12], pivot: [9, 6, 6] },     // extent 18
        crystalLit:  { box: [0, 3, 8, 6, 9, 14], pivot: [3, 6, 8] },      // extent 18 (storage beside the cluster)
        mount:       { box: [0, 0, 0, 18, 14, 14], pivot: [9, 7, 0] }     // extent 46
      },
      animations: {
        dead:  { durations: [1000], loop: true, interp: 'step', frames: [relayDead()] },
        wake:  { durations: [125, 125, 125, 125, 125, 125, 125, 125], loop: false, interp: 'step', events: { glowOn: 2 }, frames: WAKE },
        awake: { durations: [1000], loop: true, interp: 'step', frames: [relayAwake()] }
      },
      mounts: {
        glow:   { at: [9, 6, 9.5], part: 'mount' },     // centre crystal body, 1.14 m above the plinth (billboard 1.125)
        light:  { at: [9, 6, 9.5], part: 'mount' },     // lights.beacon / relay origin (level z 7.7 = 6.6 + 1.1)
        prompt: { at: [9, 0, 8], part: 'mount' }
      }
    },
    placement: { level: 'tower', prop: 'beaconBowl', x: 9.0, y: 7.0, z: 6.6, facing: 90, levelEdit: false,
                 note: 'model relay, variant dead (anim name). All voxels inside the O plinth cells (8..10, 6..8)' },
    readability: { note: 'At 2.4 m on the walkway (eye 1.0 m above the plinth top): 160x60 ~49 rows tall (3.5 rows / voxel: ' +
                   'chunky by the 4096-cell grid limit; the v2 tone grid 6 cm breaks up the big faces).' }
  };

  // ===================================================================================================================
  // 9. ATTACH (15.3 item 1), per model: only when every material key OF THAT MODEL is merged into palette.materials and
  //    detailPass.materials (a missing v2 record would switch the GPU path off, 15.3 item 6). Rubble goes onto the
  //    variant sub-models (the registry exposes them as rubble#0..2, the same objects).
  // ===================================================================================================================
  var TARGETS = { boulder: ['boulder'], rubble0: ['rubble', 0], rubble1: ['rubble', 1], rubble2: ['rubble', 2],
                  canvasHeap: ['canvasHeap'], gondola: ['gondola'], strut: ['strut'], envelopeHeap: ['envelopeHeap'],
                  relay: ['relay'] };
  A.voxelModels.batch2 = Object.keys(TARGETS);
  A.voxelModels.attachTower = function attachTower() {
    var P = A.palette, DP = A.detailPass, M = A.models, done = [], n, t, def, vox, k, ok;
    if (!P || !DP || !M) return done;
    for (n in TARGETS) {
      t = TARGETS[n]; def = M[t[0]];
      if (def && t.length > 1) def = def.variants && def.variants[t[1]];
      if (!def || def.voxel) continue;
      vox = A.voxelModels[n].voxel; ok = true;
      for (k in vox.mats) if (!P.materials[vox.mats[k]] || !DP.materials[vox.mats[k]]) ok = false;
      if (ok) { def.voxel = vox; done.push(n); }
    }
    return done;
  };
  A.voxelModels.attachTower();
})(typeof window !== 'undefined' ? window : globalThis);
