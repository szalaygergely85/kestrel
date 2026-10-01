/*
 * Kestrel - THE RUIN-STEEL SWORD (US-078): world pickup + first-person view model.
 * Owner: Designer. Format: architecture.md 15.1 (VoxelModelDef) + README section 7 (voxel props) + README 7.4 (NEW:
 * view models). Preview: design/preview/sword.html (engine oracle: packVoxelModel + computeVoxelPose + marchVoxelRay).
 *
 * Canon (GDD 3): "sword (ruin steel)", found in a ruin - here inside the Hollow Watchtower. Fantasy steel, NOT a
 * machine: old pitted steel, a dark fuller, nicked edges, a worn dark-leather grip, a small down-curved BRONZE
 * crossguard and a round bronze pommel. No brass / copper / verdigris / aether colour anywhere (style-guide colour
 * language: those are machine / magic only). The relay-keeper's blade, planted point-down in the rubble heap by the
 * west wall like a grave marker (writer may refine the story beat).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.sword       { name, desc, voxel, placement, readability }  the world pickup (planted, leaning)
 *   ASSETS.voxelModels.swordHeld   { name, desc, voxel }                          the same blade, tip UP, pivot = grip
 *   ASSETS.viewModels.sword        view-model clips (idle sway, swingLR, swingRL), chain rules, trail, sparks (README 7.4)
 *   ASSETS.swordKit                PROPOSED colours + materials (v1 palette format, v2 detail-pass format, remap) and
 *                                  the merge note. NOT merged into palette.js / detail-pass.js yet (shared hot files:
 *                                  the main session merges, see README 7.4 "Merge step").
 *   ASSETS.levelPatch.towerSword   the tower placement as data (prop + interactable + scrawl + state flag), hand-copied
 *                                  into content/levels/tower.level.json by the US-078 content step (no runtime applier).
 *   ASSETS.voxelModels.attachSword() registers ASSETS.models.sword (no billboard exists, like the waystone) only when
 *                                  every sword material is in BOTH palette.materials and detailPass.materials.
 *
 * AXES (15.1): x = east (x0 = west), y = SOUTH with y0 = the model's FRONT row (faces north at yaw 0), z = up.
 * cellM 0.03 m: 9 x 3 x 32 voxels = 0.27 x 0.09 x 0.96 m (one-handed arming sword: blade 0.69 m, grip 0.12 m).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  A.viewModels = A.viewModels || {};
  A.levelPatch = A.levelPatch || {};

  var SX = 9, SY = 3, SZ = 32, CELL = 0.03;

  // ===================================================================================================================
  // 1. PROPOSED COLOURS + MATERIALS (merge step: README 7.4)
  //    Value ladder vs the tower stone (stoneMid #8a7f6e luma ~128, stoneLight #b8ab94 ~172): the steel edge `mirror`
  //    (~205) sits ABOVE stoneLight, the fuller ironDark (~55) far below stoneMid, so the blade reads as a bright double
  //    line with a dark spine on the ivy wall. Bronze is brown-ochre (hue ~28 deg, sat ~0.45), clearly apart from machine
  //    brass (brassLight hue 45 deg, much brighter/yellower) and copper (hue 21, saturated orange).
  // ===================================================================================================================
  var COLORS = {
    bronzeLight: '#c49a6c',   // worn bronze high points (guard top, pommel cap): pale ochre-brown, never yellow
    bronze:      '#866044',   // old bronze body (guard, ferrule, pommel)
    bronzeDark:  '#4a3424'    // tarnish in the bronze (texture tint / v2 tone only)
  };
  var V1 = {
    steel_edge: {
      desc: 'SWORD (US-078). The two honed edges and the tip of the ruin-steel blade: pale cool steel (mirror), high spec, ' +
            'so the edges catch the sun patch / lamp first and frame the dark fuller. A few duller nicks in the texture.',
      base: 'mirror', albedo: 0.95, ramp: 'iron', spec: 0.75,
      bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [33, 33], key: {
        a: { shade: 1.00 }, h: { shade: 1.12, tint: 'white', amount: 0.30 }, n: { shade: 0.80, tint: 'iron', amount: 0.50 }
      }, rows: ['ahaa', 'aaan', 'aaha', 'naaa'] }
    },
    steel_old: {
      desc: 'SWORD (US-078). The blade flats + ricasso: old grey steel with rust pits and grey wear (ironLight). Lower spec ' +
            'than the edge, so the flat reads as "worn", the edge as "still sharp".',
      base: 'ironLight', albedo: 0.85, ramp: 'iron', spec: 0.45,
      bg: { mode: 'darken', k: 0.15 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [33, 33], key: {
        a: { shade: 1.00 }, p: { shade: 0.78, tint: 'rust', amount: 0.45, glyph: '.' }, g: { shade: 0.90, tint: 'ash', amount: 0.40 }
      }, rows: ['aapa', 'gaaa', 'aaga', 'paag'] }
    },
    bronze_light: {
      desc: 'SWORD (US-078). Bronze high points: the crossguard top + the down-curved quillon tips, the pommel cap. Old ' +
            'fantasy bronze (pale ochre-brown), NOT machine brass: no rivets, no `o` plate glyphs.',
      base: 'bronzeLight', albedo: 0.92, ramp: 'iron', spec: 0.45,
      bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [33, 33], key: {
        a: { shade: 1.00 }, t: { shade: 0.82, tint: 'bronzeDark', amount: 0.45 }
      }, rows: ['aata', 'aaaa', 'taaa', 'aaat'] }
    },
    bronze: {
      desc: 'SWORD (US-078). Old bronze body: the guard underside, the ferrule ring, the pommel. Tarnished brown, a step ' +
            'below bronze_light so the guard has a lit top and a dark underside (Blood-style rim / body).',
      base: 'bronze', albedo: 0.78, ramp: 'iron', spec: 0.30,
      bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [33, 33], key: {
        a: { shade: 1.00 }, t: { shade: 0.75, tint: 'bronzeDark', amount: 0.60 }
      }, rows: ['ataa', 'aaaa', 'aata', 'taaa'] }
    },
    leather: {
      desc: 'SWORD (US-078). The worn dark-leather grip wrap: woodDark with a diagonal wrap seam `/` (ropeDark) and a few ' +
            'hand-polished spots (rope). Matte (spec 0.08).',
      base: 'woodDark', albedo: 0.75, ramp: 'wood', spec: 0.08,
      bg: { mode: 'darken', k: 0.12 }, textureFade: [3, 10],
      texture: { w: 4, h: 4, scale: [33, 33], key: {
        a: { shade: 1.00 }, w: { shade: 0.70, tint: 'ropeDark', amount: 0.60, glyph: '/' }, s: { shade: 1.20, tint: 'rope', amount: 0.40 }
      }, rows: ['waaa', 'awas', 'aawa', 'saaw'] }
    },
    steel_glint: {
      desc: 'SWORD (US-078). The pickup\'s "take me" glint: a white-hot bar that slides down the blade front in 3 steps ' +
            '(70 ms each) every 2.4 s (clip idle). Emissive 0.90, cool white (mirror tint, not brass). Never on a static voxel.',
      base: 'white', albedo: 1.00, ramp: 'iron', spec: 0.90, emissive: 0.90,
      bg: { mode: 'darken', k: 0.25 }, textureFade: [4, 12],
      texture: { w: 2, h: 2, scale: [33, 33], key: {
        a: { shade: 1.00, glyph: '*' }, h: { shade: 1.00, tint: 'mirror', amount: 0.40, glyph: '+' }
      }, rows: ['ah', 'ha'] }
    }
  };
  // v2 (detail-pass.js materials format): tone grid 1.5 cm = half a voxel, lines: false (the edge pass draws the steps).
  function v2(v1, seed, albedo, tones, set, extra) {
    var o = { v1: v1, seed: seed, desc: V1[v1].desc, albedo: albedo, bgK: V1[v1].bg.k, detail: 66, jitter: 0.05,
              tones: tones, grid: { u: 0.015, v: 0.015, stagger: 0, lines: false },
              face: { set: set, mid: set, far: set }, lod: { mid: 12, far: 25, dither: 3 } }, k;
    for (k in extra || {}) o[k] = extra[k];
    return o;
  }
  var V2 = {
    steel_edge:   v2('steel_edge',   401, 0.95, [['mirror', 3], ['white', 1]], 'ironFace'),
    steel_old:    v2('steel_old',    402, 0.85, [['ironLight', 5], ['ashLight', 2], ['rust', 1]], 'ironFace'),
    bronze_light: v2('bronze_light', 403, 0.92, [['bronzeLight', 3], ['bronze', 1]], 'copperFace'),
    bronze:       v2('bronze',       404, 0.78, [['bronze', 3], ['bronzeDark', 1]], 'copperFace'),
    leather:      v2('leather',      405, 0.75, [['woodDark', 3], ['ropeDark', 2], ['rope', 1]], 'canvasFace'),
    steel_glint:  v2('steel_glint',  406, 1.00, [['white', 3], ['mirror', 2]], 'glint', { emissive: 0.90 })
  };
  A.swordKit = {
    status: 'PROPOSED - colours + v1 + v2 not merged yet (README 7.4 merge step); the preview injects them locally',
    colors: COLORS,
    v1: V1, v2: V2,
    remap: { steel_edge: 'steel_edge', steel_old: 'steel_old', bronze_light: 'bronze_light', bronze: 'bronze',
             leather: 'leather', steel_glint: 'steel_glint' },
    // reused, already merged: iron_dark (the fuller, voxel_props.js batch 1)
    reused: ['iron_dark'],
    // oracle / preview only, before the merge: nearest existing material per key (NOT the intended look)
    fallback: { steel_edge: 'iron_light', steel_old: 'iron_light', bronze_light: 'wood', bronze: 'wood', leather: 'wood',
                steel_glint: 'brass_glint' },
    // colour-language guard (checked in the preview): no base / tone / tint of the sword may start with these
    forbiddenColorPrefixes: ['brass', 'copper', 'verdigris', 'aether', 'heroGreen', 'danger']
  };

  var MATS = { S: 'steel_edge', s: 'steel_old', d: 'iron_dark', Z: 'bronze_light', z: 'bronze', l: 'leather', W: 'steel_glint' };

  // ===================================================================================================================
  // 2. GEOMETRY (pickup orientation: TIP DOWN at z0, pommel cap at z31). Built from a cell map so rows always line up.
  //    Blade = the y1 row only (1 voxel = 3 cm thick), 3 voxels wide: bright edges x3 / x5, dark fuller x4 (z6..20).
  //      z0-1 tip (x4), z2-5 point bevel, z6-20 edges + fuller with two edge nicks (z10 x5, z16 x3 = silhouette chips)
  //      and three dull edge voxels (z8 x3, z13 x3, z18 x5), z21-22 dull ricasso.
  //    Guard z22-24: 9 wide (0.27 m), thick in the middle (y0..2 at x2..6), quillon tips curved DOWN (z22 x0 / x8),
  //      lit top z24 (bronze_light), dark underside z23 (bronze).
  //    Grip z25-29: bronze ferrule z25, leather z26-28 (x4, y1), pommel neck z29, round pommel z30, cap z31.
  //    Glint storage: the 3 cells x3..5 / y1 / z23 INSIDE the guard (all 6 neighbours of each cell are guard / blade /
  //    glint voxels, so it is sealed and never seen at rest; the lamp trick, README 7 v1.14).
  // ===================================================================================================================
  function emptyGrid() {
    var g = [], z, y;
    for (z = 0; z < SZ; z++) { g.push([]); for (y = 0; y < SY; y++) g[z].push('.........'.split('')); }
    return g;
  }
  function put(g, x, y, z, ch) { g[z][y][x] = ch; }
  function span(g, x0, x1, y, z, ch) { for (var x = x0; x <= x1; x++) g[z][y][x] = ch; }
  function toLayers(g) { return g.map(function (L) { return L.map(function (r) { return r.join(''); }); }); }

  function buildPickupGrid(withGlint) {
    var g = emptyGrid(), z;
    // blade (y1)
    put(g, 4, 1, 0, 'S'); put(g, 4, 1, 1, 'S');
    for (z = 2; z <= 5; z++) { put(g, 3, 1, z, 'S'); put(g, 4, 1, z, 's'); put(g, 5, 1, z, 'S'); }
    for (z = 6; z <= 20; z++) { put(g, 3, 1, z, 'S'); put(g, 4, 1, z, 'd'); put(g, 5, 1, z, 'S'); }
    put(g, 5, 1, 10, '.'); put(g, 3, 1, 16, '.');                       // nicks
    put(g, 3, 1, 8, 's'); put(g, 3, 1, 13, 's'); put(g, 5, 1, 18, 's');  // dull spots on the edge
    for (z = 21; z <= 22; z++) span(g, 3, 5, 1, z, 's');                 // ricasso
    // guard
    put(g, 0, 1, 22, 'Z'); put(g, 8, 1, 22, 'Z');                        // down-curved quillon tips
    span(g, 0, 8, 1, 23, 'z'); span(g, 2, 6, 0, 23, 'z'); span(g, 2, 6, 2, 23, 'z');
    put(g, 0, 1, 23, 'Z'); put(g, 8, 1, 23, 'Z');                        // tip ends stay light all the way
    span(g, 1, 7, 1, 24, 'Z'); span(g, 3, 5, 0, 24, 'Z'); span(g, 3, 5, 2, 24, 'Z');
    if (withGlint) span(g, 3, 5, 1, 23, 'W');                            // sealed glint storage
    // grip
    span(g, 3, 5, 1, 25, 'z'); put(g, 4, 0, 25, 'z'); put(g, 4, 2, 25, 'z');   // ferrule
    for (z = 26; z <= 28; z++) put(g, 4, 1, z, 'l');                         // leather
    span(g, 3, 5, 1, 29, 'z'); put(g, 4, 0, 29, 'z'); put(g, 4, 2, 29, 'z');   // pommel neck
    span(g, 3, 5, 0, 30, 'z'); span(g, 3, 5, 1, 30, 'z'); span(g, 3, 5, 2, 30, 'z');   // pommel
    span(g, 3, 5, 1, 31, 'Z'); put(g, 4, 0, 31, 'Z'); put(g, 4, 2, 31, 'Z');   // cap
    return g;
  }
  var PICKUP_LAYERS = toLayers(buildPickupGrid(true));
  // held: same blade, TIP UP (z reversed), no glint storage (the cells are plain guard bronze)
  var HELD_LAYERS = toLayers(buildPickupGrid(false)).slice().reverse();

  // ===================================================================================================================
  // 3. PICKUP: planted point-down 4 voxels (12 cm) into the heap top, leaning 8 deg back and 10 deg sideways.
  //    Parts: glint (listed FIRST so it owns its 3 sealed cells) and sword. Both pivot on the buried point [4.5,1.5,4]
  //    and both carry the same lean rot in every key, so the glint stays sealed in the guard at rest.
  //    Lean rot [-8, 10, 0] (engine order Rz*Ry*Rx): rx -8 = top away from the front (+y), ry +10 = top to local +x.
  //    Glint keys: the bar slides down the blade FRONT (0.35 voxel proud of the y = 1 face) at z 19.5 / 14.5 / 9.5.
  //    pos is in the model frame (applied after the rotation, voxelPose), so pos = R(lean) * delta.
  // ===================================================================================================================
  var LEAN = [-8, 10, 0];
  function rotVec(r, v) {   // R = Rz(rz) * Ry(ry) * Rx(rx), the engine's setRot order
    var D = Math.PI / 180, x = v[0], y = v[1], z = v[2], c, s, t;
    c = Math.cos(r[0] * D); s = Math.sin(r[0] * D); t = c * y - s * z; z = s * y + c * z; y = t;   // Rx
    c = Math.cos(r[1] * D); s = Math.sin(r[1] * D); t = c * x + s * z; z = -s * x + c * z; x = t;  // Ry
    c = Math.cos(r[2] * D); s = Math.sin(r[2] * D); t = c * x - s * y; y = s * x + c * y; x = t;   // Rz
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000];
  }
  var GLINT_HOME = [4.5, 1.5, 23.5];
  function glintAt(zc) { return { sword: { rot: LEAN }, glint: { rot: LEAN, pos: rotVec(LEAN, [0, 1.15 - GLINT_HOME[1], zc - GLINT_HOME[2]]) } }; }
  var HIDE_ALL = { sword: { rot: LEAN, pos: [0, 0, -64] }, glint: { rot: LEAN, pos: [0, 0, -64] } };
  var GLINT_REST_MS = 2400, GLINT_KEYS_MS = [70, 70, 70];

  A.voxelModels.sword = {
    name: 'sword',
    displayName: 'ruin-steel sword',
    desc: 'Voxel ruin-steel sword (US-078) planted point-down in the rubble heap by the west wall, leaning: pale steel ' +
          'edges round a dark fuller, two edge nicks, a dull ricasso, a small down-curved bronze guard (lit top, dark ' +
          'underside), dark leather grip between two bronze rings, round bronze pommel. Every 2.4 s a white glint slides ' +
          'down the blade front ("take me", like the lamp). No machine colours.',
    voxel: {
      version: 1,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [4.5, 1.5, 4],                 // the point where the blade enters the heap (4 voxels buried)
      mats: MATS,
      layers: PICKUP_LAYERS,
      parts: {
        glint: { box: [3, 1, 23, 6, 2, 24], pivot: [4.5, 1.5, 4] },   // root, sealed in the guard (extent 5)
        sword: { box: [0, 0, 0, 9, 3, 32], pivot: [4.5, 1.5, 4] }     // root (extent 44)
      },
      animations: {
        idle: { durations: [GLINT_REST_MS].concat(GLINT_KEYS_MS), loop: true, interp: 'step',
                frames: [{ sword: { rot: LEAN }, glint: { rot: LEAN } }, glintAt(19.5), glintAt(14.5), glintAt(9.5)] },
        gone: { durations: [1000], loop: true, frames: [HIDE_ALL] }   // fallback only: the take removes the entity
      },
      mounts: {
        prompt: { at: [4.5, 0, 23.5], part: 'sword' },   // guard front centre = the interactable aim point
        grip:   { at: [4.5, 1.5, 27.5], part: 'sword' },
        glint:  { at: [4.5, 0, 16], part: 'sword' }      // spare: blade-front centre, for a billboard sparkle if wanted
      }
    },
    placement: {
      level: 'tower', prop: 'sword', x: 12.86, y: 6.12, z: 0.9, facing: 110, levelEdit: 'levelPatch.towerSword',
      note: 'planted in the top of the 0.9 m rubble heap z (cell 12,6), 0.14 m in from its east face (x 13.0), south of ' +
            'the rubble3 chunk (12.2..12.8 x 6.25..6.75): no voxel overlap. Front faces ESE (110), between the wake spot ' +
            '(bearing 129, 5.3 m) and the burner side of the room (bearing ~94, 4.7 m). The lean puts the pommel at about ' +
            '(12.70, 6.22, 1.72), still over cell 12,6. Lying at the wake spot the gondola hides it and, standing, the NE ' +
            'corner of the upper-stair column (13,7) just clips the line; 1-2 steps north (or from the burner) it is in ' +
            'full view down the sun patch - a small "find it" beat, no searching.'
    },
    readability: { note: 'At 5 m (burner side / room centre -> heap): 240x90 ~16 rows tall (0.84 m above the heap) and the ' +
                   'guard ~8 cols wide; 160x60 ~11 rows / ~5 cols. Sunlit (the patch reaches the heap at elevation 60 from ' +
                   'ESE), dark ivy wall 1.9 m behind. Measured live in preview/sword.html.' }
  };

  // ===================================================================================================================
  // 4. HELD (view model geometry): tip UP. Pivot / anchor = the grip centre [4.5, 1.5, 4.5] (leather z3..5 after the
  //    flip). The guard spans z7..9, the blade tip ends at z32 (0.825 m from the pivot). One part, one rest clip.
  // ===================================================================================================================
  A.voxelModels.swordHeld = {
    name: 'swordHeld',
    desc: 'The ruin-steel sword as a first-person view model (same voxels as the pickup, tip up, no glint cells).',
    voxel: {
      version: 1,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [4.5, 1.5, 4.5],
      mats: MATS,
      layers: HELD_LAYERS,
      parts: { blade: { box: [0, 0, 0, 9, 3, 32], pivot: [4.5, 1.5, 4.5] } },
      animations: { held: { durations: [1000], loop: true, frames: [{}] } },
      mounts: {
        tip:   { at: [4.5, 1.5, 31.5], part: 'blade' },   // trail head
        mid:   { at: [4.5, 1.5, 20], part: 'blade' },     // trail ghost / hit-ray sample
        guard: { at: [4.5, 1.5, 8], part: 'blade' }
      }
    }
  };

  // ===================================================================================================================
  // 5. VIEW MODEL (README 7.4, NEW format). Poses of the WHOLE held model in EYE space:
  //    eye space = the frame of a camera at the eye with yaw 0 / pitch 0, i.e. x = right, y = BACK (forward = -y),
  //    z = up, metres. (Same handedness as the world, so eye -> world = eyePos + Rcam * p, no mirror.)
  //    key = { t (ms), pos [x,y,z] = where the model anchor (grip centre) sits, rot [rx,ry,rz] deg, R = Rz*Ry*Rx }
  //      rx + = blade top tips FORWARD (-y), ry + = top to the RIGHT, rz + = turns the blade's forward-pointing
  //      direction to the RIGHT (a horizontal blade at rx 90: rz -80 points left, rz +50 points right-forward).
  //    Sampling: linear between keys (pos and each rot component), no easing; key spacing carries the timing.
  //    A swing = windup / active / recover windows (ms) per the US-078 AC: 80 / 120 / 150 = 350 ms. 7 keys =
  //    rest, windup end (anticipation), 3 active poses (the arc), follow-through (overshoot), back to rest.
  //    Swing direction is named from the PLAYER's view: swingLR sweeps left -> right (the +x edge leads).
  // ===================================================================================================================
  var REST = { pos: [0.27, -0.42, -0.22], rot: [65, -8, 5] };
  function k(t, pos, rot) { return { t: t, pos: pos, rot: rot }; }
  A.viewModels.sword = {
    model: 'swordHeld',
    space: 'eye: x right, y back (forward = -y), z up, metres; yaw-0 / pitch-0 camera frame at the eye',
    rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot)',
    projection: 'same as the scene (75 deg HFOV, 16:9); drawn in its own depth range after the scene (never clips walls)',
    depth: { near: 0.05, far: 1.5 },
    rest: REST,
    clips: {
      idle: { loop: true, keys: [
        k(0, REST.pos, REST.rot),
        k(1100, [0.274, -0.42, -0.212], [66.5, -8, 4]),     // slow breath: up 8 mm, a hair right, tip dips 1.5 deg
        k(2200, REST.pos, REST.rot)
      ] },
      swingLR: { loop: false, windup: [0, 80], active: [80, 200], recover: [200, 350], leadEdge: '+x', keys: [
        k(0,   REST.pos, REST.rot),
        k(80,  [-0.10, -0.32, -0.10], [70, 0, -80]),       // windup end: pulled back to the left, blade pointing left, raised
        k(120, [-0.08, -0.40, -0.18], [78, 0, -45]),       // active 1: left-forward, eye height
        k(160, [0.04, -0.44, -0.22], [82, 0, 0]),          // active 2: straight ahead (a line from the bottom to the centre)
        k(200, [0.18, -0.40, -0.25], [86, 0, 50]),         // active 3: right-forward, dipping
        k(270, [0.28, -0.32, -0.30], [95, 0, 85]),         // follow-through: past the right edge, tip below horizontal
        k(350, REST.pos, REST.rot)                          // recovered
      ] },
      swingRL: { loop: false, windup: [0, 80], active: [80, 200], recover: [200, 350], leadEdge: '-x', keys: [
        k(0,   REST.pos, REST.rot),
        k(80,  [0.36, -0.30, -0.12], [70, 0, 85]),         // windup end: cocked to the right, blade pointing right-back
        k(120, [0.24, -0.40, -0.19], [78, 0, 45]),
        k(160, [0.08, -0.44, -0.22], [82, 0, 0]),
        k(200, [-0.08, -0.40, -0.25], [86, 0, -50]),
        k(270, [-0.18, -0.32, -0.29], [95, 0, -85]),       // follow-through past the left edge
        k(350, REST.pos, REST.rot)
      ] }
    },
    chain: { order: ['swingLR', 'swingRL'], max: 2, queueDuring: 'recover', restMs: 250, startAtMs: 270,
             blendMs: 80, note: 'a queued swing starts when the first reaches its follow-through key (270 ms), from the ' +
                                'CURRENT pose, and blends into its own windup-end key over its 80 ms windup (its key 0 is ' +
                                'replaced by the current pose); after 2 swings, 250 ms rest in idle' },
    bob: { note: 'engine-side walk bob while moving (not in the keys): z +-0.012 m, x +-0.006 m, roll +-1 deg, ' +
                 'one cycle per 2 steps; x0.4 while swinging', z: 0.012, x: 0.006, rollDeg: 1.0 },
    carriedLight: { heldOffsetX: -0.3, note: 'US-078 AC: with the sword taken the carried lamp light moves to the LEFT ' +
                                            '(0.3 m left of the eye instead of right, GDD 7.3)' },
    trail: {
      note: 'during the ACTIVE window only: sample mount tip (and mid) at the last `samples` steps of `stepMs` (the 60 Hz ' +
            'fixed step: 16.7 ms -> use 6 samples = 100 ms), project to scene cells, draw a line between consecutive tip ' +
            'samples (Bresenham) with the glyph picked by the on-screen slope (pixels, cell aspect 1:1.5). Newest ' +
            'segment = head glyph. Colour by age, emissive. Ghost: the blade line (mid -> tip) of one older sample drawn ' +
            'with `ghost.glyph`. Drawn in the view-model layer, before the sword cells (the blade covers its own trail).',
      mount: 'tip', ghostMount: 'mid', stepMs: 16.7, samples: 6, lifeMs: 100,
      glyphs: { h: '-', d1: '/', d2: '\\', v: '|', head: { h: '=', d1: '/', d2: '\\', v: '|' } },
      slope: { hMaxDeg: 22.5, vMinDeg: 67.5 },
      colors: [[34, 'white'], [67, 'mirror'], [100, 'ironLight']],   // [age ms <=, colour key]
      ghost: { ageMs: 50, glyph: ':', color: 'iron' }
    },
    sparks: {
      clink: { note: 'world hit (wall / terrain inside reach): 1 cell at the hit point for 100 ms + 50 ms hit-stop',
               durations: [50, 50], frames: [{ glyphs: ['*'], fg: ['W'] }, { glyphs: ['+'], fg: ['f'] }],
               keys: { W: { c: 'white', e: true }, f: { c: 'flameCore', e: true } }, anchor: { x: 0, y: 0 }, hitStopMs: 50 },
      hit: { note: 'entity hit (practice target / beast): the 3-cell spark at the hit point, 100 ms; target flashes white 100 ms',
             durations: [50, 50], frames: [{ glyphs: ['-*-'], fg: ['fWf'] }, { glyphs: ['.+.'], fg: ['efe'] }],
             keys: { W: { c: 'white', e: true }, f: { c: 'flameCore', e: true }, e: { c: 'ember', e: true } }, anchor: { x: 1, y: 0 } },
      targetFlash: { color: 'white', ms: 100 }
    }
  };

  // ===================================================================================================================
  // 6. TOWER PLACEMENT (data only; NOT applied to content/levels/tower.level.json - there is no pickup system yet and
  //    the registry does not know model `sword`. The US-078 content step copies these entries by hand, runs
  //    node tools/content-canonical.test.mjs, and adds sword.js to game/index.html after voxel_world.js.)
  //    Route: wake spot (17.0, 9.5) -> walk WNW over flagstones (14..16, 7..9), past the gondola bow, into the nook at
  //    (13, 6) between the heap (12,6 z 0.9), the hollow (13,5) and the upper-stair column (13,7, 5.4 m). No climb, no
  //    jump, not on the wake -> burner -> stair corridor, clear of the boulder roll line / hollow (boulder r 0.6 at
  //    13.9, 4.7 reaches y 5.3; the sword is at y 6.12) and of every hint circle.
  // ===================================================================================================================
  A.levelPatch.towerSword = {
    story: 'US-078',
    stateFlag: 'tower.sword.taken',
    props: { append: [
      { id: 'sword', model: 'sword', x: 12.86, y: 6.12, z: 0.9, facing: 110, variant: 'idle', interactable: 'sword',
        pickup: 'sword', note: 'US-078: the ruin-steel sword planted in the rubble heap z (12,6) by the west wall; ' +
        'removed by sword.take (save-safe flag tower.sword.taken: not spawned when set)' }
    ] },
    interactables: { append: [
      { id: 'sword', prop: 'sword', interact: 'sword.take', prompt: '[E] Take sword', once: true, radius: 1.8,
        x: 12.86, y: 6.12, z: 1.45, note: 'US-078: aim point = the guard (mounts.prompt, ~1.48 m posed); sets ' +
        'tower.sword.taken, removes the prop, enables the attack action + view model, moves the carried light left' }
    ] },
    decals: { append: [
      { id: 'scrawlSword', model: 'decal:STEEL FOR THE HUSH', facing: 0, wall: { x0: 13.08, x1: 13.92, y: 7, z0: 0.55, z1: 0.8 },
        note: 'US-078 (writer may refine): scratched on the north face of upper step I (13,7), right beside the sword, ' +
              'same style as the KEEP THE LIGHT scrawl (props[] entry with model decal:..., like `scrawl`)' }
    ] },
    practiceTarget: { x: 14.6, y: 6.6, z: 0, facing: 270, note: 'PROPOSED spot for the US-078 test target (mossy stump / ' +
                      'old armour stand, not modelled yet): floor cell (14,6), 1.8 m east of the sword, in the sun patch, ' +
                      'off the wake -> burner -> stair corridor' },
    checks: { wakeSpot: { x: 17.0, y: 9.5 }, distanceM: 5.34, bearingFromSwordDeg: 129, standCell: [13, 6],
              viewFrom: { x: 16.5, y: 8.0, note: '1-2 steps NW of the wake spot, standing: clear sightline (preview check)' },
              burnerSide: { x: 17.6, y: 6.4, note: 'beside the burner ring (cell 17,6), 4.7 m: clear sightline down the sun patch' } }
  };

  // ===================================================================================================================
  // 7. ATTACH: only once every material is merged (a missing v2 record would switch the GPU path off, 15.3 item 6).
  // ===================================================================================================================
  A.voxelModels.attachSword = function attachSword() {
    var P = A.palette, DP = A.detailPass, done = [], k, mats, ok;
    if (!P || !DP) return done;
    A.models = A.models || {};
    mats = MATS; ok = true;
    for (k in mats) if (!P.materials[mats[k]] || !DP.materials[mats[k]]) ok = false;
    if (ok && !A.models.sword) { A.models.sword = A.voxelModels.sword; done.push('sword'); }
    return done;
  };
  A.voxelModels.attachSword();

  if (typeof module === 'object' && module && module.exports) module.exports = { sword: A.voxelModels.sword, swordHeld: A.voxelModels.swordHeld, viewModel: A.viewModels.sword, kit: A.swordKit };
})(typeof window !== 'undefined' ? window : globalThis);
