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
 *   ASSETS.voxelModels.canvasHeap     the wake spot: a crumpled heap of torn envelope canvas, 2.0 x 1.25 x 0.5 m, folds,
 *                                     ragged / burnt edges, spar, rope ends, straw, hollow where Wick lay (OB-026 rework)
 *   ASSETS.voxelModels.gondola        the Kestrel's wicker-and-brass basket, 2.2 x 0.9 x 1.1 m, tilted 8 deg onto a stone
 *                                     chock (rim, ribs, corner posts, rope loops, sandbags, name board; v1.14)
 *   ASSETS.voxelModels.strut          bent brass gondola strut on the rubble, 0.9 x 0.2 x 0.5 m
 *   ASSETS.voxelModels.envelopeHeap   the envelope below the summit breach: the collapsed red / ochre striped balloon as
 *                                     draped cloth (soft crown dome, slack folds, torn hem) + crown ring + mouth hoop +
 *                                     3 ropes toward the tower, 5.0 x 2.2 x 1.4 m (+1.0 m skirt; v1.14, v1.39 fabric rework)
 *   ASSETS.voxelModels.relay          the summit relay: brass tripod + bowl + cracked mirror + crystals (dead / wake / awake);
 *                                     the GLOW stays a billboard (US-022, a separate prop at relay.mounts.glow)
 *   ASSETS.voxelModels.burner         the Kestrel's copper burner on the stone ring: splayed iron legs, riveted brass
 *                                     mouth, coil band, front gauge, side handles, back valve + hose (OWN-REQ-008 part 1);
 *                                     the FIRE stays a billboard (ASSETS.models.burnerFlame, prop at burner.mounts.flame)
 *   ASSETS.voxelMaterials.*           + 27 new prop materials (v1 + v2 + remap + fallback), listed in `.batch2`
 *                                     (12 of batch 2 + 6 of the ART-OWN-002 rework: linen_light, linen, linen_dark,
 *                                     gore_red, gore_red_dark, canvas_burnt + 9 balloon-fabric keys of v1.39:
 *                                     balloon_light / balloon / balloon_dark, balloon_red_light / balloon_red /
 *                                     balloon_red_dark, tarp_light / tarp / tarp_dark; glyph set `fabricFace`)
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
    x: 'crystal_dead', X: 'crystal_lit', M: 'mirror_dark',                                                // relay
    P: 'linen_light', p: 'linen', q: 'linen_dark',                                                        // wake-spot tarp
    E: 'gore_red', e: 'gore_red_dark', z: 'canvas_burnt',                                                 // envelope (old)
    u: 'copper',                                                                                          // burner can (palette)
    // v1.39 balloon fabric (owner 2026-10-06 "the balloon should look like cloth"): own keys, soft `fabricFace` glyphs
    A: 'balloon_light', a: 'balloon', n: 'balloon_dark',                                                  // ochre gores
    F: 'balloon_red_light', f: 'balloon_red', h: 'balloon_red_dark',                                      // red gores
    S: 'tarp_light', s: 'tarp', t: 'tarp_dark',                                                           // wake-spot tarp
    Y: 'straw_light', y: 'straw',                                                                         // OB-026 straw (palette, US-078d)
    N: 'ember_core', G: 'ember_glow', J: 'flame_tip', O: 'flame_mid',                                    // OB-132b: burner fire
    K: 'cloth.canvas'                                                                                     // OB-098: the drape's own cloth material
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
    },
    // ---- ART-OWN-002 rework (v1.14): the wake-spot tarp is LINEN (near-white, cool), NOT the ochre envelope canvas;
    //      the envelope gets red gores alternating with the ochre ones + a burnt material for the tear.
    linen_light: {
      desc: 'VOXEL PROPS (wake spot). The spare linen tarp\'s lit crests: the crate lid edges, fold ridges, the rolled fold ' +
            'of the turned-back corner. Near-white and cool, so it never reads as the ochre envelope.',
      base: 'linenLight', albedo: 0.94, ramp: 'canvas', bg: { mode: 'darken', k: 0.18 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, f: { shade: 1.06, glyph: ')' }, s: { shade: 0.90, tint: 'linen', amount: 0.5 } },
                   ['aafa', 'asaa', 'faaa', 'aasf'])
    },
    linen: {
      desc: 'VOXEL PROPS (wake spot). The tarp\'s flat parts: the sheet on the floor, the crate lid, the folded flap. Pale ' +
            'warm-white with a faint weave.',
      base: 'linen', albedo: 0.86, ramp: 'canvas', bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, w: { shade: 0.92, tint: 'linenDark', amount: 0.25, glyph: '~' }, l: { shade: 1.06, tint: 'linenLight', amount: 0.5 } },
                   ['awal', 'laaw', 'waal', 'alwa'])
    },
    linen_dark: {
      desc: 'VOXEL PROPS (wake spot). The tarp in shadow: the fold valleys, the flanks of the drape down the crate sides. ' +
            'Dark cool grey-brown (value body for the pale crests).',
      base: 'linenDark', albedo: 0.66, ramp: 'canvas', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, f: { shade: 0.88, glyph: '(' } }, ['afaa', 'aaaf', 'faaa', 'aafa'])
    },
    gore_red: {
      desc: 'VOXEL PROPS (envelope). The faded red envelope gores that alternate with the ochre ones (12 around the bag), ' +
            'the stripe pattern that says "balloon" from the breach. Lit folds lighter, seams darker.',
      base: 'goreRed', albedo: 0.86, ramp: 'canvas', bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, l: { shade: 1.12, tint: 'goreRedLight', amount: 0.6, glyph: ')' },
                     s: { shade: 0.72, tint: 'goreRedDark', amount: 0.5, glyph: '~' } }, ['alas', 'aasa', 'laaa', 'saal'])
    },
    gore_red_dark: {
      desc: 'VOXEL PROPS (envelope). Red gores inside the collapse creases (the fold valleys across the bag).',
      base: 'goreRedDark', albedo: 0.62, ramp: 'canvas', bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, t: { shade: 0.70, tint: 'canvasScorch', amount: 0.6, glyph: '(' } }, ['ataa', 'aaat', 'taaa', 'aata'])
    },
    canvas_burnt: {
      desc: 'VOXEL PROPS (envelope). Burnt canvas: the ragged black rim of the tear on the east flank, the dark inside seen ' +
            'through it and through the mouth hoop, a few scorch blotches. Not emissive (the fire is long out).',
      base: 'canvasScorch', albedo: 0.50, ramp: 'ash', bg: { mode: 'darken', k: 0.10 }, textureFade: [4, 12],
      texture: tex({ a: { shade: 1.00 }, c: { shade: 0.70, tint: 'cinder', amount: 0.7, glyph: ',' }, e: { shade: 1.15, tint: 'emberDim', amount: 0.3, glyph: "'" } },
                   ['acae', 'caaa', 'aeac', 'aaca'])
    },
    // ---- v1.39 balloon fabric (owner 2026-10-06): the envelope heap + the wake-spot tarp get their own keys with the
    //      soft `fabricFace` glyph set and ramp `fabric` (no = % #), so the shared canvas_* / linen* / gore_red* users
    //      (walls, trees, objects, the gondola sandbags) keep their look. Same colours as before, fold light/dark ladder.
    balloon_light: fab('Lit fold crests of the ochre envelope gores.', 'canvasLight', 0.92, 0.18,
      { a: { shade: 1.00 }, f: { shade: 1.08, glyph: ')' }, s: { shade: 0.90, tint: 'canvas', amount: 0.5, glyph: '~' } }, ['aafa', 'asaa', 'faaa', 'aasf']),
    balloon: fab('The ochre gores between crest and valley.', 'canvas', 0.86, 0.16,
      { a: { shade: 1.00 }, w: { shade: 0.92, tint: 'canvasDark', amount: 0.3, glyph: '~' }, l: { shade: 1.06, tint: 'canvasLight', amount: 0.5, glyph: ')' } },
      ['awal', 'laaw', 'waal', 'alwa']),
    balloon_dark: fab('Ochre gores in the fold valleys, creases and the hem on the ground.', 'canvasDark', 0.66, 0.12,
      { a: { shade: 1.00 }, f: { shade: 0.88, glyph: '(' }, t: { shade: 0.70, tint: 'canvasScorch', amount: 0.5, glyph: "'" } }, ['afat', 'aaaf', 'faaa', 'atfa']),
    balloon_red_light: fab('Lit fold crests of the faded red gores.', 'goreRedLight', 0.90, 0.18,
      { a: { shade: 1.00 }, f: { shade: 1.06, glyph: ')' }, s: { shade: 0.88, tint: 'goreRed', amount: 0.5, glyph: '~' } }, ['aafa', 'asaa', 'faaa', 'aasf']),
    balloon_red: fab('The faded red gores that alternate with the ochre ones.', 'goreRed', 0.86, 0.16,
      { a: { shade: 1.00 }, l: { shade: 1.12, tint: 'goreRedLight', amount: 0.6, glyph: ')' }, s: { shade: 0.74, tint: 'goreRedDark', amount: 0.5, glyph: '~' } },
      ['alas', 'aasa', 'laaa', 'saal']),
    balloon_red_dark: fab('Red gores in the fold valleys and creases.', 'goreRedDark', 0.62, 0.12,
      { a: { shade: 1.00 }, t: { shade: 0.72, tint: 'canvasScorch', amount: 0.5, glyph: '(' } }, ['ataa', 'aaat', 'taaa', 'aata']),
    tarp_light: fab('The wake-spot linen tarp: lit crests, lid shoulders, the rolled fold.', 'linenLight', 0.94, 0.18,
      { a: { shade: 1.00 }, f: { shade: 1.06, glyph: ')' }, s: { shade: 0.90, tint: 'linen', amount: 0.5, glyph: '~' } }, ['aafa', 'asaa', 'faaa', 'aasf']),
    tarp: fab('The tarp\'s flat parts: sheet, lid, folded flap. Faint weave ~.', 'linen', 0.86, 0.16,
      { a: { shade: 1.00 }, w: { shade: 0.92, tint: 'linenDark', amount: 0.25, glyph: '~' }, l: { shade: 1.06, tint: 'linenLight', amount: 0.5 } },
      ['awal', 'laaw', 'waal', 'alwa']),
    tarp_dark: fab('The tarp in shadow: fold valleys, drape flanks, sewn panel seams.', 'linenDark', 0.66, 0.12,
      { a: { shade: 1.00 }, f: { shade: 0.88, glyph: '(' } }, ['afaa', 'aaaf', 'faaa', 'aafa'])
  };
  function fab(desc, base, albedo, k, key, rows) {
    return { desc: 'BALLOON FABRIC (v1.39). ' + desc, base: base, albedo: albedo, ramp: 'fabric', bg: { mode: 'darken', k: k },
             textureFade: [4, 12], texture: tex(key, rows) };
  }
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
    mirror_dark:   v2('mirror_dark',   222, 0.80, [['mirrorDark', 3], ['mirror', 1]], 'ironFace', 0.06),
    // ART-OWN-002 (v1.14): tarp grid ~ half a 6.25 cm voxel, envelope grid half a 20 cm voxel
    linen_light:   v2('linen_light',   223, 0.94, [['linenLight', 4], ['linen', 1]], 'canvasFace', 0.035),
    linen:         v2('linen',         224, 0.86, [['linen', 4], ['linenLight', 1]], 'canvasFace', 0.035),
    linen_dark:    v2('linen_dark',    225, 0.66, [['linenDark', 3], ['canvasDark', 1]], 'canvasFace', 0.035),
    gore_red:      v2('gore_red',      226, 0.86, [['goreRed', 3], ['goreRedLight', 1], ['goreRedDark', 1]], 'canvasFace', 0.1),
    gore_red_dark: v2('gore_red_dark', 227, 0.62, [['goreRedDark', 3], ['canvasScorch', 1]], 'canvasFace', 0.1),
    canvas_burnt:  v2('canvas_burnt',  228, 0.50, [['canvasScorch', 3], ['cinder', 2]], 'soot', 0.1),
    // v1.39 balloon fabric: tone grid ~1/3 of a 20 cm envelope voxel / ~1/2 of a 6.25 cm tarp voxel (a weave mottle)
    balloon_light:     v2('balloon_light',     901, 0.92, [['canvasLight', 4], ['canvas', 1]], 'fabricFace', 0.07),
    balloon:           v2('balloon',           902, 0.86, [['canvas', 4], ['canvasLight', 1], ['canvasDark', 1]], 'fabricFace', 0.07),
    balloon_dark:      v2('balloon_dark',      903, 0.66, [['canvasDark', 3], ['canvas', 1], ['canvasScorch', 1]], 'fabricFace', 0.07),
    balloon_red_light: v2('balloon_red_light', 904, 0.90, [['goreRedLight', 3], ['goreRed', 2]], 'fabricFace', 0.07),
    balloon_red:       v2('balloon_red',       905, 0.86, [['goreRed', 4], ['goreRedLight', 1], ['goreRedDark', 1]], 'fabricFace', 0.07),
    balloon_red_dark:  v2('balloon_red_dark',  906, 0.62, [['goreRedDark', 3], ['goreRed', 1], ['canvasScorch', 1]], 'fabricFace', 0.07),
    tarp_light:        v2('tarp_light',        907, 0.94, [['linenLight', 4], ['linen', 1]], 'fabricFace', 0.025),
    tarp:              v2('tarp',              908, 0.86, [['linen', 4], ['linenLight', 1]], 'fabricFace', 0.025),
    tarp_dark:         v2('tarp_dark',         909, 0.66, [['linenDark', 3], ['canvasDark', 1]], 'fabricFace', 0.025)
  };
  // castModels / preview only, before the merge: nearest existing material per key (NOT the intended look)
  var FALLBACK = { canvas_light: 'canvas', canvas_dark: 'canvas', patina: 'copper', rope: 'wood', block_light: 'rubble',
                   block_dark: 'rubble', granite_light: 'rock', granite_dark: 'rock', moss_cap: 'moss_top',
                   crystal_dead: 'iron', crystal_lit: 'iron', mirror_dark: 'iron',
                   linen_light: 'canvas', linen: 'canvas', linen_dark: 'canvas', gore_red: 'canvas', gore_red_dark: 'canvas',
                   canvas_burnt: 'ash',
                   balloon_light: 'canvas_light', balloon: 'canvas', balloon_dark: 'canvas_dark', balloon_red_light: 'gore_red',
                   balloon_red: 'gore_red', balloon_red_dark: 'gore_red_dark', tarp_light: 'linen_light', tarp: 'linen', tarp_dark: 'linen_dark' };
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
  // 4. CANVAS HEAP (the wake spot)  32 x 20 x 8 @ 0.0625 m = 2.0 x 1.25 x 0.5 m, two static parts (west / east halves).
  //    OB-026 rework (owner 2026-10-11: "unidentifiable dark striped slab"): a CRUMPLED HEAP OF TORN ENVELOPE CANVAS, the
  //    piece Wick was lying on. Light weathered cloth so it catches the morning sun shaft; no dark fill, no seam stripes:
  //      - outline: a torn panel, ragged per-voxel edge (frayed threads = tarp_light, the bright outline on the dark
  //        flagstones), irregular lobes, a V rip into the north edge, the east end torn into two tongues, a torn-off NW
  //        corner; one stretch of the ORIGINAL hem on the north side (rope boltrope + brass eyelets) says "envelope";
  //      - west: the canvas bunched into a crumpled pile up to 0.44 m (dome + 5 swirled folds), sliding off it 5 long
  //        rounded folds with real height (0.12..0.25 m) across the sheet and along both tongues;
  //      - the hollow where Wick lay (start pose): pressed flat, a crumple ring of folds round it (same limits as before:
  //        1 layer within 0.19 m, <= 0.19 m within 0.42 m);
  //      - a scorch mark with a burnt-through hole on the NE tongue (canvas_burnt rim + scorched balloon_dark ring), the
  //        torn east edges burnt, two dirt / water stains;
  //      - a broken wooden spar (2 x 2 voxels) poking up out of the pile to the north-west with a splintered end, a snapped
  //        stub on the floor by the south wall; 3 loose rope ends (one draped over the pile, two curling on the floor);
  //      - straw from the old pallet scattered round the edges and on the sheet.
  //    Top voxel: tarp_light on crests + torn edges, balloon_light (sand) on the flats, balloon (darker sand) in creases,
  //    on stains and as the fill under the top (the fold flanks read as shaded sand, not as a dark slab).
  //    BUDGET: the greedy mesh must stay <= 2000 triangles (engine/mesh/voxelMesh.test.js); `meshTris()` below counts it
  //    the same way at load and steps the paint detail down (CH_LEVELS) until it fits; the count is in readability.tris.
  //    --- superseded history (kept for reference) ---
  //    ART-OWN-002 rework (v1.14): a spare LINEN TARP (near-white, cool - never the ochre
  //    envelope colour) thrown over a small crate and pulled across the floor:
  //      - west: the crate under it (0.31 x 0.375 m, lid 0.375 m) = a clear box shape, lit lid edges, one wrinkle on the
  //        lid, the cloth falling down the crate sides in 9 radial folds and flaring out on the floor;
  //      - two tension folds running from the crate corners out to the long hems, a crumple ring round the hollow;
  //      - THE HOLLOW: flat (1 layer) within 0.19 m of the start pose, <= 3 layers (0.19 m) within 0.42 m;
  //      - east: the south-east corner turned back over itself (bare floor under the fold line, a triangular double flap
  //        with a rolled bright fold edge, its boltrope and the corner eyelet facing up);
  //      - the whole outline is a straight, slightly ragged HEM with a rope boltrope and brass eyelets every 0.375 m on
  //        the long edges; a small ochre repair patch (envelope cloth) on the east half.
  //    Top voxel: linen_light on crests / lid edges / the rolled fold, linen on flats, linen_dark in fold valleys, rope on
  //    the hem, brass_hot eyelets; everything under the top is linen_dark (the drape flanks read as shadow).
  //    v1.39 (owner 2026-10-06 "the balloon should look like cloth"): same footprint / grid / anchor / hollow, but softer:
  //      - materials tarp_light / tarp / tarp_dark (= the linen colours, soft `fabricFace` glyphs, no = %);
  //      - the crate lid's 4 corners drop one layer (cloth rounds a box's corners, no sharp arris);
  //      - the long hems SAG between the eyelets (scallops: 3 of every 6 columns pull in by one voxel), more ragged
  //        threads (22 %), a torn-off north-west corner;
  //      - two sewn panel SEAMS along the sheet (tarp_dark lines on the flats at y 4 and y 10);
  //      - the repair patch is real envelope cloth (balloon, ochre).
  // ===================================================================================================================
  function segDist(ax, ay, bx, by, px, py) {
    var dx = bx - ax, dy = by - ay, t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt(Math.pow(px - ax - t * dx, 2) + Math.pow(py - ay - t * dy, 2));
  }
  function inTri(a, b, c, px, py) {
    function s(p, q) { return (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0]); }
    var d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  // OB-026 (owner 2026-10-11): the crumpled torn envelope canvas. `lvl` = paint detail step (0 = full; see CH_LEVELS).
  function buildCanvasHeap(lvl) {
    var SX = 32, SY = 20, SZ = 8, G = new Grid(SX, SY, SZ), H = [], x, y, z, h, px, py, i;
    var SCX = 16, SCY = 13;                          // the start pose (= anchor) in voxel units
    var PILE = [7.5, 9.5, 6.3];                      // the crumpled bunch: centre x, y, radius (voxels)
    // long rounded folds [x0, y0, x1, y1, crest height (layers above the sheet), half width]
    var FOLDS = [[10, 4.6, 27, 3.4, 3.2, 1.8],       // the north hem rucked up into one long fold
                 [12, 15.6, 21, 17.4, 2.4, 1.5],     // south fold sliding off the pile
                 [21, 8.2, 28.5, 6.6, 2.6, 1.4],     // twisted NE tongue
                 [12.5, 8, 19, 10.2, 2.2, 1.2],      // a fold across the middle, toward the hollow
                 [22, 14.6, 29.5, 15.6, 2.0, 1.3]];  // SE tongue
    var BURN = [24.5, 6.2];                          // scorch centre (a burnt-through hole in it)
    var STAINS = [[11.5, 13.2, 2.4, 1.5], [26.5, 16.2, 1.9, 1.1], [19.5, 5.2, 1.6, 0.9]];
    function cloth(x, y) {
      var px = x + 0.5, py = y + 0.5, ex = (px - 15.5) / 14.2, ey = (py - 10.3) / 8.9;
      var r = Math.pow(ex * ex * ex * ex + ey * ey * ey * ey, 0.25), ang = Math.atan2(ey, ex);
      r += 0.08 * Math.sin(3 * ang + 1.0) + 0.05 * Math.sin(5 * ang + 2.5) +
           (lvl >= 5 ? 0 : 0.06) * (hash(x, y, 0, 51) - 0.5);                      // lobes + frayed edge
      if (r >= 1) return false;
      if (inTri([13, 0], [18, 0], [15.8, 4.6], px, py)) return false;              // V rip into the north edge
      if (inTri([31, 8.6], [31, 12.6], [23.2, 10.9], px, py)) return false;        // the east end torn into two tongues
      if (px + py < 6.5) return false;                                             // torn-off NW corner
      if (Math.hypot(px - BURN[0], py - BURN[1]) < 1.0) return false;              // the burn hole
      return true;
    }
    for (y = 0; y < SY; y++) {
      H.push([]);
      for (x = 0; x < SX; x++) {
        px = x + 0.5; py = y + 0.5; h = 0;
        if (cloth(x, y)) {
          h = 1;
          var dp = Math.hypot(px - PILE[0], py - PILE[1]) / PILE[2];
          if (dp < 1) {                                                            // the pile: dome + 5 swirled folds
            var ang = Math.atan2(py - PILE[1], px - PILE[0]);
            var dome = 6.0 * Math.pow(1 - dp * dp, 0.75);
            var crumple = (lvl >= 4 ? 0 : 1.1) * Math.cos(5 * ang + 3.2 * dp + 0.4) * Math.min(1, dp * 2.5);
            h = Math.max(h, Math.round(1 + dome + crumple));
          }
          for (i = 0; i < FOLDS.length; i++) {                                     // rounded fold profiles
            var f = FOLDS[i], d = segDist(f[0], f[1], f[2], f[3], px, py);
            if (d < f[5]) h = Math.max(h, Math.round(1 + f[4] * (1 - (d / f[5]) * (d / f[5]))));
          }
          var dc = Math.hypot(px - SCX, py - SCY);
          if (dc > 3.0 && dc < 4.4 && Math.cos(3 * Math.atan2(py - SCY, px - SCX) + 0.8) > -0.2) h = Math.max(h, 2);   // crumple ring
          if (dc < 6.8) h = Math.min(h, 3);                                        // <= 0.19 m within 0.42 m of the start pose
          if (dc < 3.0) h = 1;                                                     // the pressed hollow
          h = Math.min(h, SZ - 1);
        }
        H[y].push(h);
      }
    }
    function hAt(x, y) { return (x < 0 || y < 0 || x >= SX || y >= SY) ? 0 : H[y][x]; }
    for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      var n = H[y][x];
      if (!n) continue;
      px = x + 0.5; py = y + 0.5;
      var nb = [hAt(x - 1, y), hAt(x + 1, y), hAt(x, y - 1), hAt(x, y + 1)];
      var hmax = Math.max.apply(null, nb), hmin = Math.min.apply(null, nb), top;
      var dB = Math.hypot(px - BURN[0], py - BURN[1]);
      var burntEdge = dB < 1.8 || (px > 22.5 && py > 8 && py < 13.8);
      if (hmin === 0) {                                                            // the outline
        if (y <= 4 && x >= 18 && x <= 29 && hAt(x, y - 1) === 0) top = (x % 5 === 2) ? 'B' : 'r';   // original hem, tarnished eyelets
        else if (burntEdge) top = 'z';                                             // burnt torn edge
        else top = 'S';                                                            // frayed, sun-bleached threads
      } else if (dB < 1.8) top = 'z';                                              // scorch: burnt rim of the hole
      else if (dB < 2.7 && lvl < 3) top = 'n';                                     // scorched ring
      else if (n >= (lvl >= 1 ? 3 : 2) && n >= hmax && n > hmin && lvl < 3) top = 'S';   // lit crests
      else if (n <= hmax - 2 && lvl < 2) top = 'a';                                // creases
      else top = 'A';                                                              // weathered sand flats
      if (top === 'A' && lvl < 2) {
        for (i = 0; i < STAINS.length; i++) {
          var s = STAINS[i], ux = (px - s[0]) / s[2], uy = (py - s[1]) / s[3];
          if (ux * ux + uy * uy < 1) top = 'a';                                    // dirt / water stains
        }
      }
      for (z = 0; z < n - 1; z++) G.set(x, y, z, 'a');
      G.set(x, y, n - 1, top);
    }
    // a voxel on top of whatever is there (rope over the pile, straw on the sheet) or on the floor
    function onTop(x, y, c) { if (x >= 0 && y >= 0 && x < SX && y < SY && hAt(x, y) < SZ) G.set(x, y, hAt(x, y), c); }
    function onFloor(x, y, c) { if (x >= 0 && y >= 0 && x < SX && y < SY && !hAt(x, y)) G.set(x, y, 0, c); }
    function polyline(pts, fn, c) {
      var k, t, seen = {};
      for (k = 0; k + 1 < pts.length; k++) {
        var a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.ceil(L * 4);
        for (t = 0; t <= steps; t++) {
          var qx = Math.floor(a[0] + (b[0] - a[0]) * t / steps), qy = Math.floor(a[1] + (b[1] - a[1]) * t / steps);
          if (!seen[qx + ',' + qy]) { seen[qx + ',' + qy] = 1; fn(qx, qy, c); }
        }
      }
    }
    // the broken spar: a 2 x 2 voxel wooden batten from inside the pile up to the north-west, splintered end
    var SA = [9.0, 11.0, 2.0], SB = [1.8, 3.6, 7.4], t2;
    for (t2 = 0; t2 <= 48; t2++) {
      var u = t2 / 48, qx = SA[0] + (SB[0] - SA[0]) * u, qy = SA[1] + (SB[1] - SA[1]) * u, qz = Math.floor(SA[2] + (SB[2] - SA[2]) * u);
      var bx0 = Math.floor(qx - 0.5), by0 = Math.floor(qy - 0.5), ox, oy;
      for (ox = 0; ox < 2; ox++) for (oy = 0; oy < 2; oy++) {
        if (u > 0.9 && hash(bx0 + ox, by0 + oy, qz, 61) < 0.55) continue;        // splintered end
        if (G.get(bx0 + ox, by0 + oy, qz) === '.') G.set(bx0 + ox, by0 + oy, qz, 'w');
      }
    }
    G.set(1, 2, 7, G.get(1, 2, 7) === '.' ? 'w' : G.get(1, 2, 7));               // one long splinter
    // a snapped stub of the spar on the floor by the south wall (only where the floor is bare)
    polyline([[23.5, 19.2], [30.9, 18.4]], function (x, y) { onFloor(x, y, 'w'); onFloor(x, y - 1, 'w'); });
    // loose rope ends: one draped over the pile down to the floor, two curling out on the floor
    polyline([[13.0, 5.4], [9.5, 6.6], [6.5, 7.4], [4.0, 9.2], [0.6, 10.6]], onTop, 'r');
    polyline([[28.4, 6.4], [30.4, 5.0], [31.4, 2.6], [30.2, 0.4]], onFloor, 'r');
    polyline([[3.2, 15.4], [1.3, 16.5], [0.5, 18.2], [2.4, 19.5]], onFloor, 'r');
    // straw from the old pallet: tufts on the floor round the edges, a few stalks on the sheet (none near the hollow)
    if (lvl < 3) {
      [[0, 12, 'Y'], [0, 13, 'y'], [1, 13, 'Y'], [13, 19, 'Y'], [14, 19, 'y'], [15, 18, 'Y'], [22, 0, 'y'], [23, 0, 'Y'],
       [31, 15, 'Y'], [30, 16, 'y'], [31, 16, 'y'], [9, 0, 'Y'], [10, 1, 'y'], [5, 19, 'Y'], [6, 19, 'y']].forEach(function (p) { onFloor(p[0], p[1], p[2]); });
      [[22, 17, 'Y'], [23, 17, 'y'], [10, 15, 'Y'], [27, 12, 'Y']].forEach(function (p) {
        if (Math.hypot(p[0] + 0.5 - SCX, p[1] + 0.5 - SCY) > 6.8) onTop(p[0], p[1], p[2]);
      });
    }
    return G;
  }
  // greedy face count exactly like engine/mesh/voxelMesh.js (per part box, outside the box = empty, 2 tris per rect)
  function greedyCount(dA, dB, val) {
    var vis = [], n = 0, a, b, k;
    for (k = 0; k < dA * dB; k++) vis.push(0);
    for (b = 0; b < dB; b++) for (a = 0; a < dA; a++) {
      if (vis[b * dA + a]) continue;
      var m = val(a, b);
      if (m === 0) { vis[b * dA + a] = 1; continue; }
      var aE = a + 1, bE = b + 1, ai, bb, stop = false;
      while (aE < dA && !vis[b * dA + aE] && val(aE, b) === m) aE++;
      while (bE < dB && !stop) {
        for (ai = a; ai < aE; ai++) if (vis[bE * dA + ai] || val(ai, bE) !== m) { stop = true; break; }
        if (!stop) bE++;
      }
      for (bb = b; bb < bE; bb++) for (ai = a; ai < aE; ai++) vis[bb * dA + ai] = 1;
      n++;
    }
    return n;
  }
  function meshTris(G, boxes) {
    var tris = 0;
    boxes.forEach(function (B) {
      function m(x, y, z) {
        return (x < B[0] || y < B[1] || z < B[2] || x >= B[3] || y >= B[4] || z >= B[5]) ? 0 : (G.get(x, y, z) === '.' ? 0 : G.get(x, y, z));
      }
      var bx = B[3] - B[0], by = B[4] - B[1], bz = B[5] - B[2], L;
      function face(dA, dB, at, dx, dy, dz) {
        tris += 2 * greedyCount(dA, dB, function (a, b) {
          var p = at(a, b), v = m(p[0], p[1], p[2]);
          return v !== 0 && m(p[0] + dx, p[1] + dy, p[2] + dz) === 0 ? v : 0;
        });
      }
      for (L = 0; L < bx; L++) (function (X) {
        face(by, bz, function (a, b) { return [X, B[1] + a, B[2] + b]; }, -1, 0, 0);
        face(by, bz, function (a, b) { return [X, B[1] + a, B[2] + b]; }, 1, 0, 0);
      })(B[0] + L);
      for (L = 0; L < by; L++) (function (Y) {
        face(bx, bz, function (a, b) { return [B[0] + a, Y, B[2] + b]; }, 0, -1, 0);
        face(bx, bz, function (a, b) { return [B[0] + a, Y, B[2] + b]; }, 0, 1, 0);
      })(B[1] + L);
      for (L = 0; L < bz; L++) (function (Z) {
        face(bx, by, function (a, b) { return [B[0] + a, B[1] + b, Z]; }, 0, 0, 1);
        face(bx, by, function (a, b) { return [B[0] + a, B[1] + b, Z]; }, 0, 0, -1);
      })(B[2] + L);
    });
    return tris;
  }
  // CH_LEVELS: 0 full paint; 1 crests only on folds >= 3 layers; 2 + no crease / stain paint; 3 + no scorch ring, no
  // crests, no straw; 4 + smooth pile (no swirl folds); 5 + no per-voxel fray on the outline. The first level whose
  // mesh is <= CH_TRI_CAP is used (the voxelMesh.test.js cap is 2000).
  var CH_BOXES = [[0, 0, 0, 16, 20, 8], [16, 0, 0, 32, 20, 8]], CH_TRI_CAP = 1900, chLvl = 0, gCH, chTris;
  for (;;) {
    gCH = buildCanvasHeap(chLvl); chTris = meshTris(gCH, CH_BOXES);
    if (chTris <= CH_TRI_CAP || chLvl >= 5) break;
    chLvl++;
  }
  A.voxelModels.canvasHeap = {
    name: 'canvasHeap',
    desc: 'Voxel canvas heap (the wake spot, OB-026 rework): a crumpled heap of torn airship-envelope canvas. Light ' +
          'weathered sand / off-white cloth bunched into a pile at the west end (0.44 m, swirled folds) with 5 long rounded ' +
          'folds sliding across the sheet, ragged frayed edges, a V rip, the east end torn into two tongues, a stretch of ' +
          'the original hem with rope boltrope + brass eyelets, a scorch mark with a burnt-through hole and burnt torn ' +
          'edges, dirt stains, a broken wooden spar poking out of the pile (splintered), a snapped stub by the wall, 3 loose ' +
          'rope ends, straw from the old pallet, and the pressed hollow where Wick lay. Walk-over (no collision).',
    voxel: {
      version: 1, cellM: 0.0625, size: [32, 20, 8], anchor: [16, 13, 0], mats: matsOf(gCH), layers: gCH.layers(),
      parts: {
        west: { box: [0, 0, 0, 16, 20, 8], pivot: [8, 10, 0] },    // extent 44
        east: { box: [16, 0, 0, 32, 20, 8], pivot: [24, 10, 0] }   // extent 44
      },
      animations: { idle: idle1() }
    },
    placement: { level: 'tower', prop: 'pallet', x: 17.0, y: 9.5, z: 0.0, facing: 0, levelEdit: false,
                 note: 'world x 16.0..18.0, y 8.69..9.94 (south wall at y 10.0; north part over the walk-over floor cells ' +
                       '16..18,8); the start eye (17.0, 9.5, 0.3) is 0.24 m above the hollow' },
    readability: { tris: chTris, paintLevel: chLvl,
                   note: 'At 2.2 m standing: the bright frayed outline + sun-bleached crests on the dark flagstones, the ' +
                   'pile with the spar sticking out at the west end, the burn hole on the NE tongue. Mesh ' + chTris +
                   ' tris (paint level ' + chLvl + ', cap 2000).' }
  };

  // ===================================================================================================================
  // 5. GONDOLA  26 x 11 x 13 @ 0.085 m = 2.21 x 0.94 x 1.1 m. ART-OWN-002 rework (v1.14): a clean, rectangular balloon
  //    basket (the old rounded hull + leaning stays read as "bent"):
  //      - basket x 2..23 / y 1..9: iron_dark bottom plate (the ground contour), brass_dark bottom + top bands, WICKER
  //        (wood) walls with straight vertical brass RIBS (4 front, 6 back, 1 per end) and 4 brass_light corner POSTS that
  //        rise 2 voxels above the rim to brass_hot knobs;
  //      - the RIM: a brass_light padded rim one voxel proud all round (the bright top outline), brass_hot rivets over
  //        every rib;
  //      - ROPE LOOPS: small V festoons of rope under the rim lip (2 front over the name board, 5 back, 2 per end) and
  //        3 SANDBAGS (canvas) hanging on ropes (2 front, 1 back);
  //      - the name board on the FRONT (faces east at facing 90 = toward the wake spot): brass_light frame, wood, brass_hot
  //        letter dots; a verdigris dent near the bow; inside on the wood deck a rope coil, an iron tank, a sack.
  //    TILT: parts bow + stern (the two halves: box extent limit) share ONE pivot = the front bottom edge (y 1, z 1) and
  //    the same pose rot x +8, pos z -1 (clip idle): a rigid tilt, the back (west) edge raised 0.1 m onto a stone CHOCK
  //    (block_dark / block_light, its own unrotated part in layer z0). The outline stays one intact box; the lean shows
  //    from the ends and as more of the inside seen from the wake spot.
  //    PLACEMENT unchanged (anchor 21.5, 5.5, 0): posed hull x ~15.06..15.94, y ~7.0..8.96 (clear of the rubble cell 14,8,
  //    the canvas heap x >= 16, the coil billboard 15.3, 9.5 and the wake -> burner corridor; checked in the preview).
  // ===================================================================================================================
  function buildGondola() {
    var G = new Grid(26, 11, 13), x, y, z;
    var X0 = 2, X1 = 23, Y0 = 1, Y1 = 9;                                                   // wall ring, inclusive
    function ring(x, y) { return x >= X0 && x <= X1 && y >= Y0 && y <= Y1 && (x === X0 || x === X1 || y === Y0 || y === Y1); }
    function column(x, y, z0, z1, c) { for (var k = z0; k <= z1; k++) G.set(x, y, k, c); }
    function vee(x, y, alongY) {                                                           // a rope loop under the rim lip
      if (alongY) { G.set(x, y, 9, 'r'); G.set(x, y + 1, 8, 'r'); G.set(x, y + 2, 9, 'r'); }
      else { G.set(x, y, 9, 'r'); G.set(x + 1, y, 8, 'r'); G.set(x + 2, y, 9, 'r'); }
    }
    function sandbag(x, y, ropeX) { G.set(x, y, 5, 'k'); G.set(x + 1, y, 5, 'k'); G.set(x, y, 6, 'c'); G.set(x + 1, y, 6, 'c'); column(ropeX, y, 7, 9, 'r'); }
    // z0: the chock (two broken stones under the raised back edge)
    [[5, 8], [6, 8], [7, 8], [5, 9], [6, 9], [7, 9], [18, 8], [19, 8], [20, 8], [19, 9], [20, 9]].forEach(function (p) {
      G.set(p[0], p[1], 0, p[1] === 9 && hash(p[0], 9, 0, 42) < 0.5 ? 'T' : 'D');
    });
    // z1 bottom plate, z2 bottom band + deck, z3..8 wicker walls, z9 top band
    for (y = Y0; y <= Y1; y++) for (x = X0; x <= X1; x++) {
      G.set(x, y, 1, 'd');
      if (!ring(x, y)) { G.set(x, y, 2, 'w'); continue; }
      G.set(x, y, 2, 'b'); column(x, y, 3, 8, 'w'); G.set(x, y, 9, 'b');
    }
    // ribs (brass uprights, bottom band to top band)
    [5, 8, 17, 20].forEach(function (x) { column(x, Y0, 2, 9, 'B'); });
    [5, 8, 11, 14, 17, 20].forEach(function (x) { column(x, Y1, 2, 9, 'B'); });
    column(X0, 5, 2, 9, 'B'); column(X1, 5, 2, 9, 'B');
    // name board (front wall, x 9..16, z 5..7): frame, wood, letter dots
    for (x = 9; x <= 16; x++) for (z = 5; z <= 7; z++) {
      var fr = x === 9 || x === 16 || z === 5 || z === 7;
      G.set(x, Y0, z, fr ? 'R' : ([10, 12, 13, 15].indexOf(x) >= 0 ? 'H' : 'w'));
    }
    // verdigris dent (front, near the bow) + a spot on the back
    for (x = 6; x <= 7; x++) for (z = 3; z <= 4; z++) if (hash(x, Y0, z, 41) < 0.8) G.set(x, Y0, z, 'v');
    G.set(19, Y1, 4, 'v'); G.set(19, Y1, 3, 'v');
    // z10: the padded rim, wall top + one voxel proud all round (outer corners rounded), rivets over the ribs
    for (y = Y0 - 1; y <= Y1 + 1; y++) for (x = X0 - 1; x <= X1 + 1; x++) {
      var ox = x === X0 - 1 || x === X1 + 1, oy = y === Y0 - 1 || y === Y1 + 1;
      if (ox && oy) continue;
      if (ox || oy || ring(x, y)) G.set(x, y, 10, 'R');
    }
    [5, 8, 17, 20].forEach(function (x) { G.set(x, Y0 - 1, 10, 'H'); });
    [5, 8, 11, 14, 17, 20].forEach(function (x) { G.set(x, Y1 + 1, 10, 'H'); });
    G.set(X0 - 1, 5, 10, 'H'); G.set(X1 + 1, 5, 10, 'H');
    // corner posts z2..11 + knobs z12
    [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]].forEach(function (p) { column(p[0], p[1], 2, 11, 'R'); G.set(p[0], p[1], 12, 'H'); });
    // rope loops under the rim lip + sandbags
    [9, 14].forEach(function (x) { vee(x, Y0 - 1, false); });
    [3, 6, 9, 15, 18].forEach(function (x) { vee(x, Y1 + 1, false); });
    [2, 6].forEach(function (y) { vee(X0 - 1, y, true); vee(X1 + 1, y, true); });
    sandbag(3, Y0 - 1, 4); sandbag(21, Y0 - 1, 21); sandbag(12, Y1 + 1, 12);
    // inside on the deck: rope coil, iron tank with a hot cap, a sack
    [[18, 5], [19, 5], [20, 5], [18, 6], [20, 6], [18, 7], [19, 7], [20, 7]].forEach(function (p) { G.set(p[0], p[1], 3, 'r'); });
    G.box(11, 6, 3, 13, 8, 6, 'd'); G.set(11, 6, 6, 'H');
    G.box(5, 5, 3, 7, 7, 4, 'k'); G.set(5, 5, 4, 'k');
    return G;
  }
  var gG = buildGondola();
  // OWNER 2026-10-04 ("gondola, can you change it to cloth material?", v1.33): same voxels / shape / tilt, but the basket
  // now reads as a stitched CANVAS gondola in the Kestrel's envelope cloth instead of wicker + brass. Per-char material
  // override for this model only (the batch KEY table is shared, so it is not touched):
  //   w walls + deck      wood         -> canvas        (ochre envelope canvas, the body)
  //   R rim/frame/posts   brass_light  -> canvas_light  (padded canvas rim = the bright top edge, value ladder kept)
  //   b top/bottom bands  brass_dark   -> gore_red      (a red livery band like the envelope gores: "Kestrel cloth")
  //   B ribs              brass        -> rope          (rope load tapes sewn down the walls, read as seams)
  //   d bottom plate/tank iron_dark    -> canvas_dark   (dark wet canvas floor; the tank becomes a dark bundle)
  //   v dent spots        patina       -> canvas_burnt  (scorch marks from the crash)
  //   H knobs/rivets/letters brass_hot -> brass_hot     (KEPT: brass eyelets + the name letters, like the heap's eyelets)
  //   r rope, c/k sandbags, D/T chock: unchanged. All keys already merged (envelopeHeap / canvasHeap use them).
  var GONDOLA_CLOTH = { w: 'canvas', R: 'canvas_light', b: 'gore_red', B: 'rope', d: 'canvas_dark', v: 'canvas_burnt' };
  function gondolaMats(G) {
    var o = matsOf(G), k;
    // owner 2026-10-06: the cloth request meant the BALLOON fabric, not the basket - basket keeps its original materials.
    if (A.gondolaClothRecolour) for (k in GONDOLA_CLOTH) if (o[k]) o[k] = GONDOLA_CLOTH[k];
    return o;
  }
  function gondolaTilt() { return { rot: [8, 0, 0], pos: [0, 0, -1] }; }
  A.voxelModels.gondola = {
    name: 'gondola',
    desc: 'Voxel gondola (the Kestrel\'s basket, ART-OWN-002 rework; owner 2026-10-04: CLOTH materials, see GONDOLA_CLOTH - ' +
          'ochre canvas walls, padded canvas rim, red livery bands, rope seams, brass eyelets only). Shape: ' +
          'a rectangular basket with straight ribs, ' +
          'brass_light corner posts with hot knobs, a bright padded rim one voxel proud all round, rope loops under the ' +
          'rim, 3 sandbags, the name board facing the wake spot, a verdigris dent, a rope coil / tank / sack inside; the ' +
          'whole basket tilted 8 deg (rigid) with its back edge on a stone chock.',
    voxel: {
      version: 1, cellM: 0.085, size: [26, 11, 13], anchor: [21.5, 5.5, 0], mats: gondolaMats(gG), layers: gG.layers(),
      parts: {
        bow:   { box: [0, 0, 1, 13, 11, 13], pivot: [13, 1, 1] },       // extent 36; shared pivot = front bottom edge
        stern: { box: [13, 0, 1, 26, 11, 13], pivot: [13, 1, 1] },      // extent 36
        chock: { box: [0, 0, 0, 26, 11, 1], pivot: [13, 5.5, 0] }       // extent 38, never posed
      },
      animations: {
        idle: { durations: [1000], loop: true, interp: 'step', frames: [{ bow: gondolaTilt(), stern: gondolaTilt() }] }
      },
      mounts: { board: { at: [12.5, 1, 6], part: 'bow' } }
    },
    placement: { level: 'tower', prop: 'gondola', x: 15.4, y: 8.7, z: 0.0, facing: 90, levelEdit: false,
                 note: 'anchor 21.5 of 26 along the basket: stern at world y ~9.0 (rigging coil at 15.3, 9.5 stays outside)' },
    readability: { note: 'At 3 m: 160x60 ~26 rows tall. Bright rim + straight ribs + corner posts + rope loops + sandbags ' +
                   '= "a balloon basket" unprompted.' }
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
  //    the bag (up to 1.44 m) sits on the anchor plane; UNDER it, on the back side (local +y = WEST = downhill at
  //    facing 90), the cloth hangs up to 1.0 m below the anchor, so the heap still meets the hill path that drops west
  //    (cells x 1..3). On flat ground the skirt is under the terrain (never seen).
  //    ART-OWN-002 rework (v1.14): the old mound read as a rock. Now a HALF-DEFLATED BALLOON lying on its side, axis
  //    along local x (north -> south), seen from the breach ~4-8 m away and ~2 m above:
  //      - the bag: a rounded CROWN end (north, x 0), a full belly (x 7..12, 2.1 m wide, 1.44 m high), tapering to the
  //        THROAT (south, x 18); three collapse CREASES across the top (0.2 m deep dips at x 5, 10, 14.5);
  //      - GORES: 12 stripes around the axis alternating ochre canvas and faded red (gore_red), converging to the crown
  //        like the panels of a real envelope; lit crests canvas_light, crease valleys canvas_dark / gore_red_dark;
  //      - the CROWN RING at the north end: an iron load ring round a brass valve plate with a hot centre bolt;
  //      - the MOUTH at the south end: a brass hoop (hot bolts) round the open throat, dark inside (canvas_burnt);
  //      - a BURNT TEAR on the upper east flank (the side you see from the breach): a ragged hole showing the dark
  //        inside, a charred rim, a few scorch blotches elsewhere;
  //      - 3 ROPES (the suspension lines) from the mouth hoop, sagging to the ground and running east (local y 0) toward
  //        the tower, where the gondola is.
  // ===================================================================================================================
  // v1.39 (owner 2026-10-06 "the balloon should look like cloth"): rebuilt as DRAPED FABRIC instead of a stiff
  // ellipsoid shell. Same grid / cellM / anchor / parts / placement / footprint; new look:
  //   - a HEIGHTFIELD of cloth lying on the ground: the crown (north) still holds some air (a soft dome, 1.4 m), the rest
  //     has collapsed to ~0.6 m and sags toward its edges (cross-section (1 - u^2)^0.7, not a hard ellipse);
  //   - two LENGTHWISE FOLDS that drift across the bag (a twisting drape) + 3 collapse CREASES across the slack part;
  //   - every column top is shaded by its fold: crest (higher than its neighbours) -> *_light, valley / crease -> *_dark,
  //     in between the mid tone; the voxel on the ground is the dark contact hem;
  //   - 6 visible GORES (ochre `balloon*` / red `balloon_red*`) as stripes round the axis, so they run the length of the
  //     bag and squeeze together toward the crown like the panels of a real envelope (the seams = the colour edges);
  //   - a SAGGING, TORN HEM: the slack cloth spreads 1-2 voxels past the bag on the ground, scalloped, with gaps;
  //   - the BURNT TEAR moved onto the crown's upper east flank (the side the breach sees): a 2-voxel-deep pit with a
  //     canvas_burnt floor + charred rim; a few scorch blotches;
  //   - crown ring + valve plate (north end), brass mouth hoop round the open dark throat (south end), 3 rope lines east.
  function buildEnvelopeHeap() {
    var SX = 25, SY = 11, SZ = 13, G = new Grid(SX, SY, SZ), x, y, z;
    var ZB = 5, UC = 5.5, XH = 19, TEAR_S = 7.0, TEAR_U = -0.45, CREASES = [9.5, 12.5, 15.5];
    function groundZ(yy) { return ZB - Math.max(0, Math.min(5, yy - 3)); }        // the modelled hill (west = down), yy = row
    function rad(s) {                              // bag half-width along the axis (s = x + 0.5)
      if (s < 6) return 4.4 * Math.sqrt(Math.max(0, 1 - Math.pow((6 - s) / 6, 2)));   // crown cap
      if (s < 12) return 4.4;                                                         // belly
      if (s < 18.5) return 4.4 - 1.9 * (s - 12) / 6.5;                                // taper
      return 2.5;                                                                     // throat
    }
    function axisH(s) {                            // cloth height on the axis: air left in the crown, the rest slack
      return 3.6 + 3.4 * Math.exp(-Math.pow((s - 4.5) / 3.6, 2)) - (s > 14 ? 0.8 * (s - 14) / 5 : 0);
    }
    function crease(s) { var c = 0; CREASES.forEach(function (q) { c += 0.24 * Math.exp(-Math.pow(s - q, 2) / 1.1); }); return c; }
    // 1. the heightfield: T = top in voxels above ZB (body >= 1, hem 0, none -1)
    var T = [], KIND = [], TEAR = [], s, r, u, du;
    for (x = 0; x < SX; x++) { T.push([]); KIND.push([]); TEAR.push([]); for (y = 0; y < SY; y++) { T[x].push(-1); KIND[x].push(''); TEAR[x].push(''); } }
    for (x = 0; x <= XH; x++) {
      s = x + 0.5; r = rad(s);
      for (y = 0; y < SY; y++) {
        u = y + 0.5; du = (u - UC) / r;
        if (Math.abs(du) <= 1) {
          var ridge = 0.5 + 0.5 * Math.cos(6.0 * du + 0.45 * s);                  // 2 lengthwise folds, drifting
          var top = axisH(s) * Math.pow(1 - du * du, 0.7) * (0.84 + 0.16 * ridge) * (1 - crease(s));
          T[x][y] = Math.max(1, Math.round(top)); KIND[x][y] = 'body';
          var ts = Math.abs(s - TEAR_S) / (1.8 + 0.5 * (hash(y, 0, 0, 35) - 0.5)), tu = Math.abs(du - TEAR_U) / 0.3;
          if (ts < 1 && tu < 1 && T[x][y] >= 3) { T[x][y] -= 2; TEAR[x][y] = 'hole'; }   // the burnt tear: a pit
          else if (ts < 1.45 && tu < 1.5 && hash(x, y, 0, 36) < 0.7) TEAR[x][y] = 'rim';   // charred rim
        } else if (x < XH && Math.abs(u - UC) <= r + 1.3 + 0.7 * Math.sin(0.9 * s + 1.0) && hash(x, y, 2, 31) > 0.22) {
          T[x][y] = 0; KIND[x][y] = 'hem';                                        // slack hem on the ground: scallops + gaps
        }
      }
    }
    function TT(x, y) { return (x < 0 || y < 0 || x >= SX || y >= SY) ? -1 : T[x][y]; }
    // 2. fill the columns
    for (x = 0; x <= XH; x++) for (y = 0; y < SY; y++) {
      var tc = T[x][y], g0 = groundZ(y);
      if (tc < 0) continue;
      if (KIND[x][y] === 'hem') { G.set(x, y, g0, 'n'); continue; }
      s = x + 0.5; r = rad(s); du = (y + 0.5 - UC) / r;
      var hs = axisH(s), ztop = ZB + tc - 1, nb = 0, nn = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var q = TT(x + d[0], y + d[1]);
        if (q > 0 && KIND[x + d[0]][y + d[1]] === 'body') { nb += q; nn++; }
      });
      var mean = nn ? nb / nn : tc, cls = tc > mean + 0.3 ? 'L' : (tc < mean - 0.3 || crease(s) > 0.12) ? 'D' : 'M';
      for (z = g0; z <= ztop; z++) {
        var zz = z + 0.5 - ZB, Z = Math.max(0, zz) / hs, v = du * du + Z * Z;
        var gi = Math.min(5, Math.floor(Math.atan2(Z, du) / (Math.PI / 6)));    // 6 gores over the top half
        var red = gi % 2 === 1, c;
        if (z === ztop) c = cls === 'L' ? (red ? 'F' : 'A') : cls === 'D' ? (red ? 'h' : 'n') : (red ? 'f' : 'a');
        else if (z === g0) c = red ? 'h' : 'n';                                   // ground contact
        else c = red ? 'f' : 'a';
        if (z >= ztop - 1 && TEAR[x][y] === 'hole') c = 'z';                       // dark pit floor of the tear
        if (z === ztop && TEAR[x][y] === 'rim') c = 'z';                           // charred rim
        if (z === ztop && hash(x, y, z, 33) < 0.02) c = 'z';                       // scorch blotches
        if (x === 0) c = zz < 0 ? 'n' : (v > 0.45 ? 'd' : (v > 0.12 ? 'B' : 'H')); // crown ring + valve plate + bolt
        if (x === XH) {                                                            // mouth hoop, open inside
          if (v <= 0.5 && zz >= 0) continue;
          c = zz < 0 ? 'n' : (hash(x, y, z, 37) < 0.2 ? 'H' : 'B');
        }
        if (x === XH - 1 && v <= 0.5 && zz >= 0) c = 'z';                         // the dark throat seen through the hoop
        G.set(x, y, z, c);
      }
    }
    // 3. suspension lines from the hoop (x 20..24): [x0, y0, z0, x1, y1, z1, sideways sag]
    [[20.0, 3.0, 6.6, 24.6, 0.4, 5.5, 0.6], [20.0, 3.4, 7.2, 22.2, 0.3, 5.5, -0.5], [20.0, 5.5, 7.6, 23.8, 1.6, 5.5, 0.4]]
      .forEach(function (L) {
        for (var t = 0; t <= 1.0001; t += 1 / 48) {
          var px = L[0] + (L[3] - L[0]) * t, py = L[1] + (L[4] - L[1]) * t + L[6] * Math.sin(Math.PI * t);
          var pz = Math.max(groundZ(Math.floor(py)), L[2] + (L[5] - L[2]) * Math.min(1, t * 1.6));   // drops, then lies on the ground
          G.set(Math.floor(px), Math.floor(py), Math.floor(pz), 'r');
        }
      });
    return G;
  }
  var gE = buildEnvelopeHeap();
  A.voxelModels.envelopeHeap = {
    name: 'envelopeHeap',
    desc: 'Voxel envelope heap below the summit breach (v1.39 draped-fabric rework): the Kestrel\'s collapsed balloon as ' +
          'cloth lying on the ground - the crown still holds a soft dome of air, the rest is slack and sags to its edges, ' +
          'two lengthwise folds drift across it, three creases, fold crests lit / valleys dark, ochre and red gores running ' +
          'its length into an iron crown ring, a scalloped torn hem spread on the ground, a burnt tear on the crown\'s east ' +
          'flank, a brass mouth hoop with a dark throat at the south end, 3 suspension ropes running east toward the tower, ' +
          'and the cloth hanging down the hillside on the downhill (west) side. Soft fabricFace glyphs (balloon_* materials).',
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
    readability: { note: 'From the breach (~4.5 m, eye ~2.4 m above the heap base): 160x60 ~19 rows tall at the crown dome; ' +
                   'each gore stripe ~0.4-0.6 m = 5-8 cells (400x150: 12-18), so the ochre / red stripes running into the ' +
                   'crown ring + the hoop read as "balloon" and the slack folds + scalloped hem as "cloth".' }
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
  // 9. BURNER (OWN-REQ-008 part 1)  16 x 16 x 14 @ 0.05 m = 0.8 x 0.8 x 0.7 m on the 0.5 m stone ring (cell 18,6).
  //    The Kestrel's balloon burner, thrown clear in the crash and still burning. Blood / Build brazier read: a solid
  //    metal pot on legs with sprite fire in it. Bottom to top:
  //      z0      4 iron_dark foot pads at the corners (0.35 m out from the axis, inside the 1 m ring cell);
  //      z1..4   4 splayed iron_dark legs, meeting under the pot;
  //      z3..4   iron_dark bottom dish + brass_dark base band (the dark contour on the ring);
  //      z5..6   the COIL band: an iron_light / iron_dark helix one voxel proud of the can (reads as ")))" wound tube);
  //      z7..10  the copper can (palette `copper`: red-orange bands, verdigris joints) with a few patina spots;
  //              FRONT: a brass_light gauge bezel with mirror_dark glass and an iron_dark needle; SIDES: iron_light
  //              carry handles; BACK: brass_light valve wheel (brass_hot hub) with a dark fuel hose down onto the ring;
  //      z10     inside the mouth: the iron_dark grate with a few brass_hot glints (the flame billboard stands on it);
  //      z11..12 the brass_dark flared collar, hollow mouth 0.4 m across;
  //      z13     the bright brass_light rim with 12 brass_hot rivets = the brightest outline, cuts the flame base.
  //    FIRE: a billboard prop (ASSETS.models.burnerFlame, wreckage.js) at mounts.flame = the grate top; its ember row
  //    sits 0.1 m deep in the mouth (seen from above, hidden by the near rim from low eyes), the tongues rise 0.4 m
  //    over the rim. Light: lights.brazier (18.5, 6.5, 1.2) = mounts.light, unchanged.
  //    Front (gauge) faces SOUTH at the level facing 180 = toward the wake spot and the hint circle.
  // ===================================================================================================================
  function buildBurner() {
    var G = new Grid(16, 16, 14), x, y, z, t, CX = 8, CY = 8, TAU = 2 * Math.PI;
    function rr(x, y) { var dx = x + 0.5 - CX, dy = y + 0.5 - CY; return Math.sqrt(dx * dx + dy * dy); }
    function ang(x, y) { return Math.atan2(y + 0.5 - CY, x + 0.5 - CX); }
    // feet + splayed legs (dense samples so each leg stays one connected staircase)
    [[1, 1], [13, 1], [1, 13], [13, 13]].forEach(function (f) {
      G.box(f[0], f[1], 0, f[0] + 2, f[1] + 2, 1, 'd');
      var fx = f[0] + 1, fy = f[1] + 1;
      for (t = 0; t <= 1.0001; t += 1 / 24) {
        G.set(Math.floor(fx + (CX - fx) * 0.55 * t), Math.floor(fy + (CY - fy) * 0.55 * t), 1 + Math.min(3, Math.floor(t * 3.999)), 'd');
      }
    });
    for (z = 3; z < 14; z++) for (y = 0; y < 16; y++) for (x = 0; x < 16; x++) {
      var r = rr(x, y), a = ang(x, y), h = hash(x, y, z, 61), c = null;
      if (z === 3 && r <= 3.6) c = 'd';                                              // bottom dish
      else if (z === 4 && r <= 5.0) c = 'b';                                         // base band
      else if ((z === 5 || z === 6) && r <= 5.3) {                                   // coil band (helix)
        c = r <= 4.3 ? 'u' : ((Math.floor((a / TAU + 1) * 14) + z) % 2 === 0 ? 'i' : 'd');
      } else if (z >= 7 && z <= 9 && r <= 4.6) c = (r > 3.6 && h < 0.09) ? 'v' : 'u';   // copper can + patina
      else if (z === 10 && r <= 4.6) c = r <= 3.8 ? (h < 0.12 ? 'H' : 'd') : 'u';   // can top + grate in the mouth
      else if (z === 11 && r <= 5.2 && r > 3.8) c = 'b';                             // collar
      else if (z === 12 && r <= 5.8 && r > 4.0) c = 'b';                             // flare
      else if (z === 13 && r <= 5.9 && r > 4.0) {                                    // bright rim + 12 rivets
        var k = (a / TAU) * 12;
        c = Math.abs(k - Math.round(k)) < 0.16 ? 'H' : 'R';
      }
      if (c) G.set(x, y, z, c);
    }
    // front gauge (y 2, one voxel proud of the can face y 3): bezel, glass, needle
    [['.RR.', 10], ['RdMR', 9], ['RMMR', 8], ['.RR.', 7]].forEach(function (row) {
      for (var i = 0; i < 4; i++) if (row[0].charAt(i) !== '.') G.set(6 + i, 2, row[1], row[0].charAt(i));
    });
    // carry handles, west (x 1..2) and east (x 13..14), y 7..8, z 8..10
    [[2, 1], [13, 14]].forEach(function (s) {
      for (y = 7; y <= 8; y++) {
        G.set(s[0], y, 8, 'i'); G.set(s[0], y, 10, 'i');
        for (z = 8; z <= 10; z++) G.set(s[1], y, z, 'i');
      }
    });
    // back: pipe stub (y 13), valve wheel (y 14, brass_hot hub), fuel hose down the back onto the ring (y 15)
    G.set(7, 13, 7, 'i'); G.set(8, 13, 7, 'i');
    [['.RR.', 8], ['RHHR', 7], ['.RR.', 6]].forEach(function (row) {
      for (var i = 0; i < 4; i++) if (row[0].charAt(i) !== '.') G.set(6 + i, 14, row[1], row[0].charAt(i));
    });
    for (z = 1; z <= 6; z++) G.set(8, 15, z, 'd');
    G.set(8, 15, 0, 'd'); G.set(9, 15, 0, 'd'); G.set(10, 15, 0, 'i');             // hose lies on the ring, clamp end
    return G;
  }
  var gBu = buildBurner();
  A.voxelModels.burner = {
    name: 'burner',
    desc: 'Voxel Kestrel burner (OWN-REQ-008): a copper pot on four splayed iron legs, iron / steel coil band, brass gauge ' +
          'on the front, iron carry handles, a valve wheel and fuel hose at the back, a brass collar and a bright riveted ' +
          'rim round an open mouth with a dark grate. The fire is a separate billboard (burnerFlame) on mounts.flame.',
    voxel: {
      version: 1, cellM: 0.05, size: [16, 16, 14], anchor: [8, 8, 0], mats: matsOf(gBu), layers: gBu.layers(),
      parts: { body: { box: [0, 0, 0, 16, 16, 14], pivot: [8, 8, 0] } },               // extent 46
      animations: { burn: idle1() },                                                    // = the billboard anim name
      mounts: {
        flame:  { at: [8, 8, 11], part: 'body' },     // grate top, 0.55 m above the ring = world z 1.05 (burnerFlame base)
        light:  { at: [8, 8, 14], part: 'body' },     // lights.brazier origin (level z 1.2 = 0.5 + 0.7)
        prompt: { at: [8, 0, 10], part: 'body' }
      }
    },
    placement: { level: 'tower', prop: 'brazier', x: 18.5, y: 6.5, z: 0.5, facing: 180, levelEdit: false,
                 note: 'same prop, same model key `burner` (the voxel rides on models.burner); all voxels over the * ring cell' },
    flame: { prop: 'burnerFlame', model: 'burnerFlame', anim: 'burn', mount: 'flame', world: { x: 18.5, y: 6.5, z: 1.05 },
             note: 'level prop next to props.brazier; stays a billboard until particles (US-053)' },
    readability: { note: 'At 2.5 m, eye 1.1 m above the ring: 160x60 ~19 rows tall incl. legs; the bright rim + copper can + ' +
                   'dark legs read as "pot on legs", the fire above it as "burning".' }
  };

  // ===================================================================================================================
  // 9b. ROPE TETHER (OB-098, owner 2026-10-12 "strange-looking ropes above the gondola"): replaces the flat billboard
  //    ropes ropeA / ropeB. 4 x 16 x 28 @ 0.035 m = 0.14 x 0.56 x 0.98 m. Two hemp tethers TIED INTO THE HEM of the
  //    cloth `stairwell.drape` (plane x 14.05, intact hem y 7.2..7.8, hem z 5.4 - 1.9 = 3.5):
  //      part ropeA (y 0..8):  a gathered tuft of the drape canvas bound by a rope turn, then one rope (1 voxel =
  //                            3.5 cm) hanging ~0.8 m in a slow S, an overhand knot two thirds down, a frayed tip
  //                            (straw-pale fibres splaying out, every fibre voxel touches the strand).
  //      part ropeB (y 8..16): two smaller canvas wraps 0.17 m apart with a rope SAGGING between them (U, 0.28 m deep)
  //                            and a loose end off the south wrap, a stopper knot and a short tuft.
  //    Wraps = `cloth.canvas` (K, the drape's own material, so the knot reads as the cloth bunched up), bindings and
  //    rope = `rope` (r), fibres = `straw_light` / `straw` (Y / y). Anchor [0, 8, 28] = the cloth plane (x0 face),
  //    the middle of the tethers, the TOP of the grid: place z = hem + 0.1 m (the wraps overlap the hem by 0.1 m, so a
  //    hem that swings a little never shows a gap). Clip `sway` (= the billboard anim name): each part swings slowly
  //    about its own wrap (pivot at hem height), out of phase. No collider (visual only; bottom ~2.65 m, overhead).
  // ===================================================================================================================
  function strand(G, pts, ch) {                       // 6-connected polyline through integer points (one axis per step)
    var p = pts[0].slice(), i, q, a;
    G.set(p[0], p[1], p[2], ch);
    for (i = 1; i < pts.length; i++) {
      q = pts[i];
      while (p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2]) {
        // step the axis with the largest remaining distance (z first on ties: ropes fall)
        var d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        a = Math.abs(d[2]) >= Math.abs(d[1]) && Math.abs(d[2]) >= Math.abs(d[0]) ? 2 : (Math.abs(d[1]) >= Math.abs(d[0]) ? 1 : 0);
        p[a] += d[a] > 0 ? 1 : -1;
        if (!G.full(p[0], p[1], p[2]) || G.get(p[0], p[1], p[2]) === ch) G.set(p[0], p[1], p[2], ch);
      }
    }
  }
  function wrap(G, x0, x1, y0, y1, z0, z1, bindZ) {   // canvas bunched round the tie, corners rounded, one rope turn
    var x, y, z, edgeX, edgeY;
    for (z = z0; z < z1; z++) for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) {
      edgeX = x === x0 || x === x1 - 1; edgeY = y === y0 || y === y1 - 1;
      if ((z === z0 || z === z1 - 1) && edgeX && edgeY) continue;                  // rounded corners
      G.set(x, y, z, (z === bindZ && (edgeX || edgeY)) ? 'r' : 'K');               // the binding turn
    }
  }
  function buildRopeTether() {
    var G = new Grid(4, 16, 28);
    // ---- part ropeA: tuft + wrap + S rope + overhand knot + frayed tip
    G.set(0, 3, 27, 'K'); G.set(1, 3, 27, 'K'); G.set(0, 4, 27, 'K');               // the hem gathered up into the tie
    wrap(G, 0, 3, 2, 5, 22, 27, 24);
    strand(G, [[1, 3, 21], [1, 4, 17], [2, 4, 14]], 'r');                           // S-curve, drifting off the cloth
    G.box(1, 4, 11, 3, 6, 14, 'r'); G.set(1, 5, 13, '.'); G.set(2, 4, 11, '.');     // overhand knot (lumpy, not a cube)
    strand(G, [[2, 5, 10], [2, 5, 8], [1, 4, 5]], 'r');
    G.set(1, 4, 4, 'y'); G.set(1, 3, 4, 'y'); G.set(1, 5, 4, 'y'); G.set(2, 4, 4, 'y');   // fray starts (cross)
    G.set(1, 3, 3, 'Y'); G.set(1, 5, 3, 'Y'); G.set(2, 4, 3, 'Y');                  // fibres splay, each under a strand
    G.set(1, 3, 2, 'Y'); G.set(1, 5, 2, 'y'); G.set(1, 5, 1, 'Y');                  // one long fibre
    // ---- part ropeB: two wraps, a sagging rope between them, a loose end with a stopper knot
    G.set(0, 9, 27, 'K'); G.set(0, 14, 27, 'K');
    wrap(G, 0, 2, 8, 11, 23, 27, 24);
    wrap(G, 0, 2, 13, 16, 23, 27, 24);
    var sag = [], y, t;
    for (y = 9; y <= 14; y++) { t = (y - 11.5) / 2.5; sag.push([1, y, 22 - Math.round(8 * (1 - t * t))]); }
    strand(G, [[1, 9, 22]].concat(sag).concat([[1, 14, 22]]), 'r');
    strand(G, [[1, 14, 22], [2, 14, 22], [2, 15, 17], [2, 15, 12], [2, 14, 10]], 'r');   // the loose end (own column)
    G.box(1, 14, 8, 3, 16, 10, 'r'); G.set(1, 15, 8, '.');                          // stopper knot
    G.set(2, 14, 7, 'y'); G.set(2, 14, 6, 'Y'); G.set(2, 15, 7, 'Y');               // short tuft
    return G;
  }
  var gT = buildRopeTether();
  A.voxelModels.ropeTether = {
    name: 'ropeTether',
    desc: 'Voxel rope tethers tied into the hem of the stairwell drape (OB-098): canvas bunched in rope-bound wraps, one ' +
          'rope hanging in a slow S with an overhand knot and a frayed tip, one rope sagging between two wraps with a ' +
          'knotted loose end. Hemp rope 3.5 cm, wraps in the drape\'s cloth.canvas; sways slowly. Visual only.',
    voxel: {
      version: 1, cellM: 0.035, size: [4, 16, 28], anchor: [0, 8, 28], mats: matsOf(gT), layers: gT.layers(),
      parts: { ropeA: { box: [0, 0, 0, 4, 8, 28], pivot: [1.5, 3.5, 25] },          // extent 40
               ropeB: { box: [0, 8, 0, 4, 16, 28], pivot: [1.5, 11.5, 25] } },       // extent 40
      animations: {
        sway: { loop: true, durations: [1600, 1300, 1700, 1200], frames: [
          { ropeA: { rot: [0, 0, 0] },     ropeB: { rot: [0, 0, 0] } },
          { ropeA: { rot: [3, 1.5, 0] },   ropeB: { rot: [-2, -1, 0] } },
          { ropeA: { rot: [-2.5, 0.5, 0] }, ropeB: { rot: [2.5, 1.5, 0] } },
          { ropeA: { rot: [1, -0.5, 0] },  ropeB: { rot: [-1, 0.5, 0] } }
        ] }
      }
    },
    placement: { level: 'tower', prop: 'ropeTether', x: 14.05, y: 7.5, z: 3.6, facing: 0, levelEdit: true,
                 note: 'cloths stairwell.drape hem: plane x 14.05, intact hem y 7.2..7.8, z 3.5; z = hem + 0.1' },
    readability: { note: 'Seen from the hall floor (14,7) 2-4 m away, eye 1.6 m: 160x60 ~1-2 rows per 3.5 cm voxel; the ' +
                   'pale fray, the knots and the canvas wraps break the line so it reads as rope tied to the cloth.' }
  };
  // billboard host (the registry needs models.ropeTether; the game draws the voxel). Same sprite as rope variant 0.
  if (A.models && A.models.rope && A.models.rope.variants && !A.models.ropeTether) {
    var rb = A.models.rope.variants[0], ropeHost = {}, rk;
    for (rk in rb) ropeHost[rk] = rb[rk];
    ropeHost.name = 'ropeTether';
    ropeHost.desc = 'OB-098 rope tethers on the drape hem; billboard fallback = rope variant 0, the game draws the voxel.';
    A.models.ropeTether = ropeHost;
  }


  // ===================================================================================================================
  // 9c. OB-132b (owner rule "no sprites in the world"): the last two tower sprites as voxels.
  //    burnerFire  10 x 10 x 15 @ 0.05 m = 0.5 x 0.5 x 0.75 m (= the sprite's world box). Emissive: white ember_core bed,
  //                ember_glow body, flame_mid tongues, flame_tip points. 3 stacked parts (body static, mid + tip sway) so the
  //                `burn` clip flickers; embers + smoke emitters stay on the brazier entity. Level prop `burnerFire` unchanged.
  //    rigging     22 x 6 x 4 @ 0.04 m = 0.88 x 0.24 x 0.16 m: a fat rope coil (stacked loops) + a snapped stay trailing off.
  // ===================================================================================================================
  function buildBurnerFire() {
    var G = new Grid(10, 10, 15), x, y, z, dx, dy, r, rad;
    for (z = 0; z < 15; z++) for (y = 0; y < 10; y++) for (x = 0; x < 10; x++) {
      dx = x - 4.5; dy = y - 4.5; r = Math.sqrt(dx * dx + dy * dy);
      // radius shrinks with height, with a hash-ragged edge; 3 tongues lean off the main body
      rad = 4.3 - z * 0.27 + (hash(x, y, z, 7) - 0.5) * 1.1;
      if (z >= 9 && z < 14) {                                 // upper flame = 3 leaning tongues
        var t = Math.min(Math.sqrt(sq(x - 2.5) + sq(y - 4.5)), Math.sqrt(sq(x - 6.5) + sq(y - 3.5)), Math.sqrt(sq(x - 4.5) + sq(y - 6.5)));
        if (t > 1.5 - (z - 9) * 0.22) continue;
      } else if (z === 14) { if (!(x === 4 && y === 4)) continue; }
      else if (r > rad) continue;
      G.set(x, y, z, z < 2 ? (r < 2 ? 'N' : 'G') : z < 5 ? (r < 1.8 ? 'N' : 'G') : z < 9 ? (r < 1.6 ? 'G' : 'O') : z < 12 ? 'O' : 'J');
    }
    return G;
  }
  function sq(v) { return v * v; }
  var gBF = buildBurnerFire();
  A.voxelModels.burnerFire = {
    name: 'burnerFire',
    desc: 'OB-132b voxel burner fire: emissive white-yellow bed, orange body, leaning flame tongues with tips; the upper ' +
          'parts sway in the `burn` clip. Replaces the burnerFire billboard (same level prop, same anchor, z 1.05).',
    voxel: {
      version: 1, cellM: 0.05, size: [10, 10, 15], anchor: [5, 5, 0], mats: matsOf(gBF), layers: gBF.layers(),
      parts: {
        body: { box: [0, 0, 0, 10, 10, 5], pivot: [5, 5, 0] },
        mid:  { box: [0, 0, 5, 10, 10, 10], pivot: [5, 5, 5] },
        tip:  { box: [0, 0, 10, 10, 10, 15], pivot: [5, 5, 10] }
      },
      animations: { burn: { durations: [90, 80, 100, 80], loop: true, interp: 'linear', frames: [
        { mid: { rot: [2, 3, 0] },   tip: { rot: [4, 6, 10] } },
        { mid: { rot: [-3, 1, 0] },  tip: { rot: [-5, 3, -12] } },
        { mid: { rot: [1, -3, 0] },  tip: { rot: [6, -6, 8] } },
        { mid: { rot: [-2, -1, 0] }, tip: { rot: [-4, -2, -10] } }
      ] } },
      mounts: {}
    },
    readability: { note: 'Over the burner mouth: reads as a lit fire from the stair and the hall; glow comes from lights.brazier.' }
  };

  function buildRigging() {
    var G = new Grid(22, 6, 4), x, y, z, dx, dy, r;
    for (z = 0; z < 3; z++) for (y = 0; y < 6; y++) for (x = 0; x < 9; x++) {       // coil: 3 stacked loops, hollow centre
      dx = x - 4; dy = y - 2.5; r = Math.sqrt(dx * dx + dy * dy * 1.6);
      if (r <= 4.1 && r >= (z === 2 ? 1.8 : 1.2)) G.set(x, y, z, (x + y + z) % 5 === 0 ? 'y' : 'r');
    }
    for (x = 9; x < 22; x++) {                                                      // snapped stay trailing off to the right
      y = 3 + Math.round(Math.sin(x * 0.55)); G.set(x, y, 0, 'r');
      if (x < 15) G.set(x, y, 1, 'r');
    }
    G.set(21, 4, 0, 'y');
    return G;
  }
  var gRG = buildRigging();
  A.voxelModels.rigging = {
    name: 'rigging',
    desc: 'OB-132b voxel rope coil (stacked loops, hollow centre, straw-pale strands) with the snapped stay trailing across the flagstones.',
    voxel: {
      version: 1, cellM: 0.04, size: [22, 6, 4], anchor: [4.5, 2.5, 0], mats: matsOf(gRG), layers: gRG.layers(),
      parts: { coil: { box: [0, 0, 0, 22, 6, 4], pivot: [4.5, 2.5, 0] } },
      animations: { idle: idle1() }
    },
    placement: { level: 'tower', prop: 'rigging', x: 15.3, y: 9.5, z: 0, facing: 0, levelEdit: false }
  };

  // ===================================================================================================================
  // 10. ATTACH (15.3 item 1), per model: only when every material key OF THAT MODEL is merged into palette.materials and
  //    detailPass.materials (a missing v2 record would switch the GPU path off, 15.3 item 6). Rubble goes onto the
  //    variant sub-models (the registry exposes them as rubble#0..2, the same objects).
  // ===================================================================================================================
  var TARGETS = { boulder: ['boulder'], rubble0: ['rubble', 0], rubble1: ['rubble', 1], rubble2: ['rubble', 2],
                  canvasHeap: ['canvasHeap'], gondola: ['gondola'], strut: ['strut'], envelopeHeap: ['envelopeHeap'],
                  relay: ['relay'], burner: ['burner'], ropeTether: ['ropeTether'], burnerFire: ['burnerFire'], rigging: ['rigging'] };
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
