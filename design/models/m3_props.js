/*
 * Kestrel - M3 props (US-078d practice target, US-080 HP / MP pickups + vitals HUD style).
 * Owner: Designer. Formats: architecture.md 15.1 (VoxelModelDef) + README 7 (voxel props), README 4 (sprite models),
 * README 5 (uiStyle), README 7.5 (this file). Preview: design/preview/m3-props.html (engine oracle: packVoxelModel +
 * computeVoxelPose + marchVoxelRay; the sprite + UI mocks follow README 4 / 5).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.practiceTarget  the OLD SWORD PELL of the watch garrison (voxel): a weathered timber post in a
 *                                      squared stone socket, a straw bundle lashed on with three rope bands, a
 *                                      crossbar for arms, a rusted iron kettle helm on top. Clips idle / flash / wobble.
 *   ASSETS.levelPatch.towerPracticeTarget  the tower placement (14.6, 6.6, facing 270) as data, hand-copied by the
 *                                      US-078d content step into content/levels/tower.level.json (no runtime applier).
 *   ASSETS.m3Sprites                   billboards: pickupHp (red-waxed herb flask), pickupMp (a faint glowing crystal
 *                                      splinter), strawPuff (optional straw bits on a target hit).
 *   ASSETS.pickupStyle                 the view-only pickup numbers (hover, bob, blink, collect) for presentPickups.
 *   ASSETS.uiStyle.vitals              HP / MP bars, low pulse, damage chip, mana-short flash, hurtEdge, death card.
 *                                      (LOAD AFTER title.js: title.js assigns ASSETS.uiStyle = {...}.)
 *   ASSETS.m3Kit                       PROPOSED colours (7), materials (5, v1 + v2 + remap) and 1 glyph set, for the
 *                                      merge step into palette.js / detail-pass.js (shared hot files, main session).
 *   ASSETS.voxelModels.attachM3()      registers models.practiceTarget (all 11 mats merged in BOTH palette.materials and
 *                                      detailPass.materials) and models.pickupHp / pickupMp / strawPuff (all colour keys
 *                                      in palette.colors). Before the merge it registers nothing, so the game is unaffected.
 *
 * AXES (15.1): x = east (x0 = west), y = SOUTH with y0 = the model's FRONT row (faces north at yaw 0), z = up.
 * Pell: cellM 0.05 m, 12 x 8 x 32 voxels = 0.60 x 0.40 x 1.60 m (crossbar 0.60 m, bundle 0.30 m, helm top = eye height).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.voxelModels = A.voxelModels || {};
  A.levelPatch = A.levelPatch || {};
  A.uiStyle = A.uiStyle || {};

  // ===================================================================================================================
  // 1. PROPOSED COLOURS (7). Colour language (style-guide row "Vitals", v1.23):
  //    HP = `vital*` crimson: deeper and a touch bluer than `danger` (#ff3b3b), so "my life" and "harm / enemy" never
  //    read as the same red. The hurt edge and the low-HP pulse use `danger` on purpose (they ARE harm).
  //    MP = `mana*` cold blue: NOT the aether teal (the relays / signal keep teal as "magic we know"). Magic is a myth
  //    to Wick, so the shard glows a colour nothing else in the world has; what it is stays open (writer may tie it to
  //    the relays later).
  // ===================================================================================================================
  var COLORS = {
    vitalLight: '#ff8f7e',   // wax highlight, liquid surface, HP label
    vital:      '#d8344a',   // THE HP crimson: liquid, wax, bar fill
    vitalDark:  '#5c1422',   // liquid shadow side, bar trough tint
    manaCore:   '#e8f2ff',   // the shard's white-blue core at the top of its breath
    manaLight:  '#9cc2ff',   // motes, inner sparkle, MP label
    mana:       '#4c84f2',   // THE MP blue: inner glow, bar fill
    manaDark:   '#1e2f6a'    // shard shadow edge (emissive, so the silhouette survives the dark)
  };

  // ===================================================================================================================
  // 2. PROPOSED MATERIALS (5) for the pell. Reused, already merged: rope, iron_dark, steel_old, block_light,
  //    block_dark, moss_cap, linen_dark. Straw colours (strawLight / straw / strawDark) are already in palette.js.
  //    Value ladder vs the tower floor (flagstone #7a7266 luma ~115): straw_light ~208 and straw ~179 sit far above it,
  //    the post (woodDark ~66) and the helm (ironDark ~55) far below, so the pell reads as a pale bundle on a dark post
  //    under a dark cap - one shape at 5 m, three parts at 2 m.
  // ===================================================================================================================
  var V1 = {
    straw_light: {
      desc: 'PELL (US-078d). Sun-bleached straw: the upper half of the bundle and the cut top ends. Vertical stalk ' +
            'texels `|` and loose ends `\'`. Matte.',
      base: 'strawLight', albedo: 0.92, ramp: 'grass', spec: 0.04,
      bg: { mode: 'darken', k: 0.16 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [20, 20], key: {
        a: { shade: 1.00 }, s: { shade: 0.86, tint: 'straw', amount: 0.40, glyph: '|' }, e: { shade: 1.08, tint: 'white', amount: 0.15, glyph: '\'' }
      }, rows: ['asaa', 'aaae', 'saas', 'aeaa'] }
    },
    straw: {
      desc: 'PELL (US-078d). Old straw, the bulk of the bundle: gold-grey with darker stalk lines `|` and a few crossed ' +
            'stalks `/`. Under the rope bands it is pinched (the bands are their own material: rope).',
      base: 'straw', albedo: 0.84, ramp: 'grass', spec: 0.04,
      bg: { mode: 'darken', k: 0.15 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [20, 20], key: {
        a: { shade: 1.00 }, s: { shade: 0.78, tint: 'strawDark', amount: 0.50, glyph: '|' }, l: { shade: 1.10, tint: 'strawLight', amount: 0.35, glyph: '/' }
      }, rows: ['saaa', 'aala', 'asaa', 'aaas'] }
    },
    straw_dark: {
      desc: 'PELL (US-078d). Damp, rotting straw: the underside, the lower bundle and the old sword cuts (dark slashes ' +
            'on the front and back faces). Brown-grey, rot spots `,`.',
      base: 'strawDark', albedo: 0.70, ramp: 'grass', spec: 0.02,
      bg: { mode: 'darken', k: 0.12 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [20, 20], key: {
        a: { shade: 1.00 }, s: { shade: 0.80, tint: 'ropeDark', amount: 0.45, glyph: '|' }, r: { shade: 0.70, tint: 'woodDark', amount: 0.55, glyph: ',' }
      }, rows: ['asaa', 'aaar', 'saaa', 'aras'] }
    },
    timber_old: {
      desc: 'PELL (US-078d). The weathered oak post and crossbar: dark wood gone silver-grey with age (ashDark tint), ' +
            'long drying cracks `|`. Not the plank `wood` (no seams, no knots): one old beam.',
      base: 'woodDark', albedo: 0.82, ramp: 'wood', spec: 0.05,
      bg: { mode: 'darken', k: 0.14 }, textureFade: [4, 12],
      texture: { w: 4, h: 4, scale: [20, 20], key: {
        a: { shade: 1.00 }, g: { shade: 1.12, tint: 'ashDark', amount: 0.45 }, c: { shade: 0.55, tint: 'woodDark', amount: 0.70, glyph: '|' }
      }, rows: ['agca', 'gaaa', 'acag', 'aaga'] }
    },
    hit_flash: {
      desc: 'HIT FLASH (US-078d, reusable by US-079 beasts). The white 100 ms flash on a struck target: a shell of ' +
            'emissive white `*` / `#` voxels 1 voxel proud of the target, hidden 64 voxels under the floor except ' +
            'during clip `flash` (the lamp-glint trick, README 7 v1.14). Never on a static voxel.',
      base: 'white', albedo: 1.00, ramp: 'iron', spec: 0.00, emissive: 1.00,
      bg: { mode: 'darken', k: 0.30 }, textureFade: [4, 12],
      texture: { w: 2, h: 2, scale: [20, 20], key: {
        a: { shade: 1.00, glyph: '*' }, h: { shade: 1.00, tint: 'flameCore', amount: 0.25, glyph: '#' }
      }, rows: ['ah', 'ha'] }
    }
  };
  // NEW glyph set for detail-pass.js `sets` (8 levels, ASCII 32-126, no '.' at level 3, 2-3 alternates per level):
  // straw stalks - ticks and verticals, never stone / floor marks.
  var SETS = {
    strawFace: [".'", ".,'", ",'`", "',;", ";|'", "|;/", "|/\\", "/|\\"]
  };
  // v2 (detail-pass.js materials format): tone grid 2.5 cm = half a voxel, lines: false (the edge pass draws the steps).
  function v2(v1, seed, albedo, tones, set, extra) {
    var o = { v1: v1, seed: seed, desc: V1[v1].desc, albedo: albedo, bgK: V1[v1].bg.k, detail: 40, jitter: 0.06,
              tones: tones, grid: { u: 0.025, v: 0.025, stagger: 0, lines: false },
              face: { set: set, mid: set, far: set }, lod: { mid: 12, far: 25, dither: 3 } }, k;
    for (k in extra || {}) o[k] = extra[k];
    return o;
  }
  var V2 = {
    straw_light: v2('straw_light', 411, 0.92, [['strawLight', 3], ['straw', 1]], 'strawFace'),
    straw:       v2('straw',       412, 0.84, [['straw', 3], ['strawLight', 1], ['strawDark', 1]], 'strawFace'),
    straw_dark:  v2('straw_dark',  413, 0.70, [['strawDark', 3], ['ropeDark', 1], ['straw', 1]], 'strawFace'),
    timber_old:  v2('timber_old',  414, 0.82, [['woodDark', 3], ['ashDark', 2], ['wood', 1]], 'grainV'),
    hit_flash:   v2('hit_flash',   415, 1.00, [['white', 3], ['flameCore', 1]], 'glint', { emissive: 1.00 })
  };
  A.m3Kit = {
    status: 'PROPOSED - colours + v1 + v2 + set not merged yet (README 7.5 merge step); the preview injects them locally',
    colors: COLORS,
    v1: V1, v2: V2, sets: SETS,
    remap: { straw_light: 'straw_light', straw: 'straw', straw_dark: 'straw_dark', timber_old: 'timber_old', hit_flash: 'hit_flash' },
    reused: ['rope', 'iron_dark', 'steel_old', 'block_light', 'block_dark', 'moss_cap', 'linen_dark'],
    // oracle / preview only, before the merge: nearest existing material per key (NOT the intended look)
    fallback: { straw_light: 'canvas_light', straw: 'canvas', straw_dark: 'canvas_dark', timber_old: 'wood', hit_flash: 'steel_glint' },
    // if the main session would rather not add a glyph set: strawFace -> 'canvasFace' (folds instead of stalks; reads OK)
    setFallback: { strawFace: 'canvasFace' },
    // colour-language guard (checked in the preview) for the PELL: no base / tone / tint may start with these
    forbiddenColorPrefixes: ['brass', 'copper', 'verdigris', 'aether', 'heroGreen', 'danger', 'unit', 'vital', 'mana'],
    merge: '(1) palette.js: the 7 COLORS into `colors` after the bronze colours; the 5 v1 materials appended after ' +
           'steel_glint (no id moves). (2) detail-pass.js: set strawFace into `sets` (after rune), the 5 v2 records ' +
           'after steel_glint, the 5 remap entries. (3) game/index.html: <script src="../design/models/m3_props.js"> ' +
           'AFTER title.js and sword.js. Then attachM3() registers models.practiceTarget + the 3 sprites.'
  };

  // ===================================================================================================================
  // 3. THE PELL (practice target). The watch garrison's sword post, older than the Kestrel and nothing the Low Wards
  //    would make: a squared stone socket (moss on the north-west corner), iron wedges round the post foot, a silver-
  //    grey oak post, a straw bundle (0.50 - 1.25 m) lashed with 3 rope bands, two old sword cuts on its front and one
  //    on its back, straw tufts hanging under it, a crossbar (one end broken short, a rag tied on the other) and a
  //    dented, rusted iron kettle helm. Built from small deterministic rules (integer hash, no Math.random).
  //
  //    Parts (8 max; listed so the 4 flash slabs claim their own cells first):
  //      flashN / flashS  the front (y0) / back (y7) flash slabs: the front-view silhouette of bundle + helm, 1 voxel
  //                       proud. flashW / flashE: the side slabs (x2 / x9) over the bundle height.
  //      head             bundle + bands + crossbar + rag + helm (z >= 10): turns on the post axis when struck.
  //      post             socket, wedges, moss, the bare post (z < 10): static.
  //    All head-group parts share pivot [6, 4, 10] (the post axis at the bundle foot) and the same rot in every key, so
  //    the slabs stay glued to the bundle while it twists. At rest the slabs sit 64 voxels (3.2 m) under the floor.
  // ===================================================================================================================
  var SX = 12, SY = 8, SZ = 32, CELL = 0.05;
  var PELL_MATS = { T: 'straw_light', t: 'straw', u: 'straw_dark', w: 'timber_old', r: 'rope', i: 'iron_dark',
                    s: 'steel_old', B: 'block_light', b: 'block_dark', m: 'moss_cap', q: 'linen_dark', F: 'hit_flash' };
  function hash3(x, y, z) {
    var h = Math.imul(x + 1, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(z + 13, 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 1000;
  }
  function inBundle(x, y, z) {
    if (z === 10 || z === 24) return x >= 4 && x <= 7 && y >= 2 && y <= 5;          // bound ends: pinched
    if (z < 10 || z > 24 || x < 3 || x > 8 || y < 1 || y > 6) return false;
    return !((x === 3 || x === 8) && (y === 1 || y === 6));                         // octagon section
  }
  function bundleOuter(x, y, z) {
    return !inBundle(x - 1, y, z) || !inBundle(x + 1, y, z) || !inBundle(x, y - 1, z) || !inBundle(x, y + 1, z);
  }
  var CUTS = { '4,1,20': 1, '5,1,19': 1, '6,1,18': 1, '7,1,15': 1, '6,1,14': 1, '5,1,13': 1,   // front: two slashes
               '4,6,14': 1, '5,6,15': 1, '6,6,16': 1 };                                     // back: one slash
  var TUFTS = [[3, 2, 'u'], [8, 5, 't'], [5, 1, 'u'], [6, 6, 't'], [4, 6, 'u'], [7, 1, 't']];  // z10, under the z11 ring
  var FLASH_PARTS = ['flashN', 'flashS', 'flashW', 'flashE'];

  function buildPell() {
    var g = [], x, y, z, k, ch;
    for (z = 0; z < SZ; z++) { g.push([]); for (y = 0; y < SY; y++) g[z].push('............'.split('')); }
    function put(px, py, pz, c) { g[pz][py][px] = c; }
    function get(px, py, pz) { return (pz < 0 || pz >= SZ || py < 0 || py >= SY || px < 0 || px >= SX) ? '.' : g[pz][py][px]; }
    // --- socket stone z0..2 (x2..9, y1..6), chipped corners, moss on the north-west (back-left) corner
    for (z = 0; z <= 2; z++) for (y = 1; y <= 6; y++) for (x = 2; x <= 9; x++) put(x, y, z, z === 2 ? 'B' : 'b');
    put(2, 1, 2, '.'); put(9, 6, 2, '.'); put(9, 1, 1, '.');
    put(2, 5, 2, 'm'); put(2, 6, 2, 'm'); put(3, 6, 2, 'm'); put(2, 6, 1, 'm'); put(2, 6, 3, 'm'); put(3, 6, 3, 'm');
    // --- post z2..26 (x5..6, y3..4), iron wedge collar at the socket mouth (z3)
    for (z = 2; z <= 26; z++) for (y = 3; y <= 4; y++) for (x = 5; x <= 6; x++) put(x, y, z, 'w');
    put(4, 3, 3, 'i'); put(7, 4, 3, 'i'); put(5, 2, 3, 'i'); put(6, 5, 3, 'i');
    // --- straw bundle z10..24
    for (z = 10; z <= 24; z++) for (y = 1; y <= 6; y++) for (x = 3; x <= 8; x++) {
      if (!inBundle(x, y, z)) continue;
      if (x >= 5 && x <= 6 && y >= 3 && y <= 4 && z < 24) { put(x, y, z, 'w'); continue; }   // post inside
      var outer = bundleOuter(x, y, z), band = (z === 12 || z === 17 || z === 22);
      if (band && outer) ch = 'r';
      else if (z === 10) ch = 'u';
      else if (z === 24) ch = 'T';
      else if (!outer) ch = 't';
      else {
        var h = hash3(x, y, z), light = 150 + (z - 10) * 25, dark = 350 - (z - 10) * 22;
        ch = h < light ? 'T' : (h >= 1000 - dark ? 'u' : 't');
      }
      if (CUTS[x + ',' + y + ',' + z]) ch = 'u';
      put(x, y, z, ch);
    }
    for (k = 0; k < TUFTS.length; k++) put(TUFTS[k][0], TUFTS[k][1], 10, TUFTS[k][2]);
    // --- crossbar z25..26 (x0..11, y3..4); the west end broken short (no top layer at x0), rope lashings round the post
    for (z = 25; z <= 26; z++) for (y = 3; y <= 4; y++) for (x = 0; x <= 11; x++) put(x, y, z, 'w');
    put(0, 3, 26, '.'); put(0, 4, 26, '.');
    for (z = 25; z <= 26; z++) { put(5, 2, z, 'r'); put(6, 2, z, 'r'); put(5, 5, z, 'r'); put(6, 5, z, 'r'); }
    // a strip of old linen tied under the east arm end
    put(10, 3, 24, 'q'); put(10, 3, 23, 'q'); put(10, 3, 22, 'q'); put(10, 4, 24, 'q');
    // --- iron kettle helm z27..31: rusty steel brim, dark iron bowl, a dent on the front (z29 x6)
    for (y = 1; y <= 6; y++) for (x = 3; x <= 8; x++) {
      if ((x === 3 || x === 8) && (y === 1 || y === 6)) continue;
      put(x, y, 27, (x === 3 || x === 8 || y === 1 || y === 6) ? 's' : 'i');
    }
    for (y = 2; y <= 5; y++) for (x = 4; x <= 7; x++) put(x, y, 28, 'i');
    put(4, 2, 28, 's'); put(5, 2, 28, 's');
    for (y = 2; y <= 5; y++) for (x = 4; x <= 7; x++) if (!((x === 4 || x === 7) && (y === 2 || y === 5))) put(x, y, 29, 'i');
    put(6, 2, 29, '.');                                                                     // the dent
    for (y = 3; y <= 4; y++) for (x = 4; x <= 7; x++) put(x, y, 30, 'i');
    put(5, 2, 30, 'i'); put(6, 2, 30, 'i'); put(5, 5, 30, 'i'); put(6, 5, 30, 'i');
    for (y = 3; y <= 4; y++) for (x = 5; x <= 6; x++) put(x, y, 31, 's');
    // --- flash slabs (silhouette of the head 1 voxel proud). Front / back: bundle + helm columns x3..8, z10..31.
    for (z = 10; z < SZ; z++) for (x = 3; x <= 8; x++) {
      var any = false;
      for (y = 1; y <= 6; y++) if (get(x, y, z) !== '.') any = true;
      if (any) { put(x, 0, z, 'F'); put(x, 7, z, 'F'); }
    }
    // sides: x2 / x9 over the bundle height z10..24 (rows with bundle voxels at x3..8)
    for (z = 10; z <= 24; z++) for (y = 1; y <= 6; y++) {
      var row = false;
      for (x = 3; x <= 8; x++) if (inBundle(x, y, z) || (z === 10 && get(x, y, z) !== '.')) row = true;
      if (row) { put(2, y, z, 'F'); put(9, y, z, 'F'); }
    }
    return g.map(function (L) { return L.map(function (r) { return r.join(''); }); });
  }
  var PELL_LAYERS = buildPell();

  var PIV = [6, 4, 10], HIDE = [0, 0, -64];
  function pellPose(rz, flashOn) {
    var f = { head: { rot: [0, 0, rz] } }, n;
    for (n = 0; n < FLASH_PARTS.length; n++) f[FLASH_PARTS[n]] = flashOn ? { rot: [0, 0, rz] } : { rot: [0, 0, rz], pos: HIDE };
    return f;
  }

  A.voxelModels.practiceTarget = {
    name: 'practiceTarget',
    displayName: 'old sword pell',
    desc: 'Voxel practice target (US-078d): the watch garrison\'s old sword pell in the sunlit floor cell east of the ' +
          'sword nook. Squared stone socket with moss, iron wedges, silver-grey oak post, straw bundle lashed with three ' +
          'rope bands (two old sword cuts on the front, one on the back, tufts hanging under it), a crossbar with one ' +
          'broken end and a linen rag, a dented rusty iron kettle helm. Struck: a white flash shell for 100 ms while the ' +
          'head twists 8 deg on the post, then a damped wobble back.',
    voxel: {
      version: 1,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [6, 4, 0],                     // foot centre on the floor (the post axis)
      mats: PELL_MATS,
      layers: PELL_LAYERS,
      parts: {
        flashN: { box: [3, 0, 10, 9, 1, 32], pivot: PIV },
        flashS: { box: [3, 7, 10, 9, 8, 32], pivot: PIV },
        flashW: { box: [2, 1, 10, 3, 7, 25], pivot: PIV },
        flashE: { box: [9, 1, 10, 10, 7, 25], pivot: PIV },
        head:   { box: [0, 1, 10, 12, 7, 32], pivot: PIV },
        post:   { box: [2, 1, 0, 10, 7, 10], pivot: [6, 4, 0] }
      },
      animations: {
        idle:   { durations: [1000], loop: true, frames: [pellPose(0, false)] },
        // 6 steps at 60 Hz = 100 ms (= US-078 AC "flashes white for 0.1 s"); the head twists 4 -> 8 deg (impact)
        flash:  { durations: [50, 50], loop: false, interp: 'step', frames: [pellPose(4, true), pellPose(8, true)] },
        // follow-through after the flash (optional but recommended): 8 -> -5 -> 2 -> 0 deg, linear, 530 ms = 32 steps
        wobble: { durations: [90, 110, 130, 200], loop: false, frames: [pellPose(8, false), pellPose(-5, false), pellPose(2, false), pellPose(0, false)] }
      },
      mounts: {
        hit:     { at: [6, 0.5, 17], part: 'head' },   // bundle front centre (z 0.85 m): spark / puff fallback point
        hitBack: { at: [6, 7.5, 17], part: 'head' },
        top:     { at: [6, 4, 32], part: 'head' },     // helm top (1.60 m)
        foot:    { at: [6, 4, 0], part: 'post' }
      }
    },
    target: {
      hurt: { r: 0.20, zMin: 0.45, zMax: 1.60, note: 'components.targetable cylinder (meleeArc cx, cy, cz = z + zMin, cr = r, ' +
              'ch = zMax - zMin). The US-078 hit band (eye 1.6: z 0.6 .. 1.9) overlaps bundle, crossbar and helm' },
      onHit: { clip: 'flash', steps: 6, then: 'wobble', thenSteps: 32, rest: 'idle',
               note: 'practiceTarget.js: on its own combat:hit -> anim flash for 6 steps, then wobble for 32 steps (or ' +
                     'straight to idle if the owner wants it minimal: the 8 deg twist then snaps back, ~1 row at 2 m), then ' +
                     'idle. A hit during wobble restarts flash. Never destroyed, no HP (it is a practice post)' },
      spark: 'viewModels.sword.sparks.hit at the hit point (US-078d) - unchanged',
      puff: { model: 'strawPuff', optional: true, note: 'OPTIONAL: spawn the strawPuff billboard at the hit point for its ' +
              '150 ms clip (view-only). Skip it if a short-lived sprite costs more than it is worth' },
      collider: { shape: 'cylinder', r: 0.22, h: 1.60, note: 'the player should not walk through the post: socket 0.40 x ' +
                  '0.30 m, crossbar 0.60 m at 1.25 - 1.35 m. A 0.22 m cylinder (or the voxel collider if physics=mesh ' +
                  'builds one from voxel props) is enough' }
    },
    placement: {
      level: 'tower', prop: 'practiceTarget', x: 14.6, y: 6.6, z: 0, facing: 270, levelEdit: 'levelPatch.towerPracticeTarget',
      note: 'the designer-proposed spot (levelPatch.towerSword.practiceTarget): floor cell (14,6) in the sun patch, 1.2 m ' +
            'east of the sword stand spot (13.45, 6.3); the cut front faces west, toward the nook, so the first thing ' +
            'the player sees after taking the sword is a target with old cuts in it. Off the wake -> burner -> stair ' +
            'corridor (leg 2 passes 15,5 / 16,6), outside every hint circle, clear of the boulder roll line.'
    },
    readability: { note: 'At 5 m (room centre -> pell) 240x90 ~33 rows tall, bundle ~9 cols wide; 160x60 ~22 rows / ~6 ' +
                   'cols. Pale straw on a dark post under a dark helm = one shape at 5 m, three at 2 m. Measured live in ' +
                   'preview/m3-props.html.' }
  };

  // ===================================================================================================================
  // 4. TOWER PLACEMENT (data only; the US-078d content step copies the prop into content/levels/tower.level.json and
  //    runs node tools/content-canonical.test.mjs. Supersedes levelPatch.towerSword.practiceTarget (same spot).)
  // ===================================================================================================================
  A.levelPatch.towerPracticeTarget = {
    story: 'US-078d',
    props: { append: [
      { id: 'practiceTarget', model: 'practiceTarget', x: 14.6, y: 6.6, z: 0, facing: 270, variant: 'idle',
        targetable: { r: 0.20, zMin: 0.45, zMax: 1.60 }, behaviour: 'practiceTarget',
        note: 'US-078d: the old sword pell; components.targetable from `targetable` (cylinder), the practiceTarget.js ' +
              'listener plays voxel clip flash (6 steps) -> wobble (32) -> idle on its own combat:hit' }
    ] },
    checks: { swordStand: { x: 13.45, y: 6.3 }, distanceFromStandM: 1.19, cell: [14, 6],
              corridorLeg2: ['17,7', '18,7', '16,6', '17,6', '16,5', '15,5', '15,4', '14,4', '15,3'],
              note: 'preview/m3-props.html recomputes: floor cell, corridor, hint circles, boulder, and that the two sword ' +
                    'sightlines (levelPatch.towerSword.checks viewFrom / burnerSide -> the guard) stay clear of the pell' }
  };

  // ===================================================================================================================
  // 5. PICKUP + EFFECT BILLBOARDS (README 4 sprite format). Sprites, not voxels: drops live outdoors with the beasts
  //    and up to 16 of them may exist, while voxel instances are capped at 16 for the whole scene (15 used in the tower).
  //    Readability (README 4 rule, planeDistY ~104 at 240x90): pickupHp 0.36 m tall at 5 m = ~7.5 rows for 7 art rows
  //    (scale 1.07, full tier); 160x60 = ~5 rows -> half tier (4 rows, scale 1.25). The liquid / glow keys are
  //    emissive so a drop reads on sunlit grass AND in the dark tower; `outline` keeps the edge off bright grass.
  // ===================================================================================================================
  function frame(glyphs, fg) { return { S: { glyphs: glyphs, fg: fg } }; }
  // HP: a small stoppered flask, the stopper sealed with red wax, crimson liquid glowing faintly inside, a twist of
  // herb tied at the neck with twine (Emberlands field medicine, nothing magic about it). Glint slides on the glass.
  var HP_KEYS = {
    C: { c: 'vitalLight' },           // wax cap knob (lit)
    c: { c: 'vital' },                // wax seal + drips (lit)
    g: { c: 'mirror' },               // glass, lit side
    G: { c: 'mirrorDark' },           // glass, shadow side + foot
    L: { c: 'vital', e: true },       // the liquid (emissive: the drop's glow)
    l: { c: 'vitalLight', e: true },  // liquid surface
    d: { c: 'vitalDark', e: true },   // liquid shadow side
    h: { c: 'mossLight' },            // herb leaves
    k: { c: 'moss' },
    o: { c: 'rope' },                 // twine knot
    W: { c: 'white', e: true }        // glass glint
  };
  var HP_FULL = [
    frame(['  _n_  ', '  |=|  ', ' ,/o\\` ', ' (~~~) ', "('###%)", '(:###%)', " `---' "],
          ['  cCc  ', '  gcg  ', ' hgogk ', ' glllg ', 'gWLLLdG', 'gLLLLdG', ' GGGGG ']),
    frame(['  _n_  ', '  |=|  ', ' ,/o\\` ', ' (~-~) ', '(*###%)', '(:###%)', " `---' "],
          ['  cCc  ', '  gcg  ', ' hgogk ', ' glllg ', 'gWLLLdG', 'gLLLLdG', ' GGGGG ']),
    frame(['  _n_  ', '  |=|  ', " ,/o\\` ", ' (-+~) ', "('###%)", '(:###%)', " `---' "],
          ['  cCc  ', '  gcg  ', ' hgogk ', ' glWlg ', 'gWLLLdG', 'gLLLLdG', ' GGGGG '])
  ];
  var HP_HALF = [
    frame(['_n_', '/=\\', '(#)', "`-'"], ['cCc', 'gcG', 'gLG', 'GGG']),
    frame(['_n_', '/=\\', '(*)', "`-'"], ['cCc', 'gcG', 'gWG', 'GGG']),
    frame(['_n_', "/=\\", '(#)', "`-'"], ['cCc', 'Wcg', 'gLG', 'GGG'])
  ];
  // MP: a splinter of crystal, leaning, a cold blue light breathing inside it and motes rising off it. Not a potion,
  // not a gem: something Wick has no word for.
  var MP_KEYS = {
    g: { c: 'mirror' },                         // glassy lit edge
    D: { c: 'manaDark', e: true },              // shadow edge (emissive: keeps the silhouette in the dark)
    d: { c: 'manaDark', e: true },              // dim inside
    m: { c: 'mana', e: true },                  // inner glow
    M: { c: 'manaLight', e: true },             // inner sparkle
    C: { c: 'manaCore', e: true },              // the core at the top of the breath
    s: { c: 'manaLight', e: true, fill: false } // motes
  };
  //            r0       r1       r2       r3       r4       r5       r6
  var MP_BASE = ['     ', '   /|', '  /*|', '  |:|', " /:'/", ' |./ ', ' \\/  '];
  function mpFrame(core, coreKey, inner, mote) {   // inner = 'd' | 'm' | 'M' level; mote = [row, col, glyph] or null
    var gl = MP_BASE.slice(), fg = ['     ', '   gD', '  g?D', '  g?D', ' g??D', ' g?D ', ' gD  '];
    var innerKey = inner, sparkKey = inner === 'M' ? 'M' : (inner === 'm' ? 'm' : 'd');
    gl[2] = '  /' + core + '|';
    fg[2] = '  g' + coreKey + 'D';
    fg[3] = '  g' + innerKey + 'D';
    fg[4] = ' g' + (inner === 'M' ? 'm' : innerKey) + sparkKey + 'D';
    fg[5] = ' g' + innerKey + 'D ';
    if (mote) {
      gl[mote[0]] = gl[mote[0]].substr(0, mote[1]) + mote[2] + gl[mote[0]].substr(mote[1] + 1);
      fg[mote[0]] = fg[mote[0]].substr(0, mote[1]) + 's' + fg[mote[0]].substr(mote[1] + 1);
    }
    return frame(gl, fg);
  }
  var MP_FULL = [
    mpFrame(':', 'd', 'd', null),
    mpFrame('+', 'm', 'm', [3, 0, '.']),
    mpFrame('*', 'C', 'M', [2, 0, '\'']),
    mpFrame('+', 'm', 'm', [1, 1, '\'']),
    mpFrame(':', 'd', 'd', [0, 1, '.']),
    mpFrame(':', 'd', 'd', null)
  ];
  function mpHalf(core, coreKey, inner) {
    return frame([' /|', ' ' + core + '|', '/:/', '\\/ '], [' gD', ' ' + coreKey + 'D', 'g' + inner + 'D', 'gD ']);
  }
  var MP_HALF = [mpHalf(':', 'd', 'd'), mpHalf('+', 'm', 'm'), mpHalf('*', 'C', 'M'), mpHalf('+', 'm', 'm'), mpHalf(':', 'd', 'd'), mpHalf(':', 'd', 'd')];
  var MP_DUR = [420, 160, 300, 160, 380, 300];   // 1.72 s breath: slow dim, quick swell, bright hold, fade

  // collect pop (view-only, optional): 3 x 50 ms, drawn centred on the drop the frame it is collected
  function popFrames(w, h, keyHot, keyMid) {
    var cx = Math.floor(w / 2), cy = Math.floor(h / 2), out = [], spec = [
      [[0, 0, '*', 'W']],
      [[0, -1, '+', keyHot], [0, 1, '+', keyHot], [-2, 0, '-', keyMid], [2, 0, '-', keyMid]],
      [[0, -2, '\'', keyMid], [-2, -1, '.', keyMid], [2, -1, '.', keyMid], [0, 2, '.', keyMid]]
    ], f, i;
    for (f = 0; f < spec.length; f++) {
      var gl = [], fg = [];
      for (i = 0; i < h; i++) { gl.push(new Array(w + 1).join(' ').split('')); fg.push(new Array(w + 1).join(' ').split('')); }
      for (i = 0; i < spec[f].length; i++) {
        var s = spec[f][i], x = cx + s[0], y = cy + s[1];
        if (x >= 0 && x < w && y >= 0 && y < h) { gl[y][x] = s[2]; fg[y][x] = s[3]; }
      }
      out.push(frame(gl.map(function (r) { return r.join(''); }), fg.map(function (r) { return r.join(''); })));
    }
    return out;
  }
  HP_KEYS.P = { c: 'vitalLight', e: true, fill: false };
  MP_KEYS.P = { c: 'manaLight', e: true, fill: false };
  MP_KEYS.W = { c: 'manaCore', e: true, fill: false };

  var pickupHp = {
    name: 'pickupHp', displayName: 'herb flask', billboard: true, directions: ['S'],
    desc: 'US-080b restore-HP drop (+10 HP): a small stoppered flask sealed with red wax, crimson liquid glowing faintly, ' +
          'a twist of herb tied at the neck. A white glint slides over the glass every 1.5 s.',
    size: { w: 7, h: 7 }, anchor: { x: 3, y: 6 }, world: { w: 0.26, h: 0.36 },
    keys: HP_KEYS, outline: { k: 0.4 },
    animations: {
      idle:    { durations: [1500, 90, 90], loop: true, frames: HP_FULL },
      collect: { durations: [50, 50, 50], loop: false, frames: popFrames(7, 7, 'P', 'l') }
    },
    lods: { half: { size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, animations: {
      idle:    { durations: [1500, 90, 90], loop: true, frames: HP_HALF },
      collect: { durations: [50, 50, 50], loop: false, frames: popFrames(3, 4, 'P', 'l') }
    } } }
  };
  var pickupMp = {
    name: 'pickupMp', displayName: 'cold shard', billboard: true, directions: ['S'],
    desc: 'US-080b restore-MP drop (+10 MP): a leaning splinter of crystal with a cold blue light breathing inside it ' +
          '(1.7 s) and motes drifting up off it. Mysterious on purpose: no bottle, no label, no teal.',
    size: { w: 5, h: 7 }, anchor: { x: 2, y: 6 }, world: { w: 0.19, h: 0.36 },
    keys: MP_KEYS, outline: { k: 0.4 },
    animations: {
      idle:    { durations: MP_DUR, loop: true, frames: MP_FULL },
      collect: { durations: [50, 50, 50], loop: false, frames: popFrames(5, 7, 'P', 'm') }
    },
    lods: { half: { size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, animations: {
      idle:    { durations: MP_DUR, loop: true, frames: MP_HALF },
      collect: { durations: [50, 50, 50], loop: false, frames: popFrames(3, 4, 'P', 'm') }
    } } }
  };
  var strawPuff = {
    name: 'strawPuff', billboard: true, directions: ['S'],
    desc: 'OPTIONAL (US-078d): straw bits knocked off the pell by a hit, 3 x 50 ms, lit (not emissive), glyph-only.',
    size: { w: 5, h: 3 }, anchor: { x: 2, y: 1 }, world: { w: 0.30, h: 0.18 },
    keys: { T: { c: 'strawLight', fill: false }, t: { c: 'straw', fill: false }, u: { c: 'strawDark', fill: false } },
    animations: { burst: { durations: [50, 50, 50], loop: false, frames: [
      frame([" ',' ", "'-|-'", " ,', "], [' TtT ', 'tTTTt', ' utu ']),
      frame(["'   '", ' . . ', "' , '"], ['T   T', ' t t ', 'u t u']),
      frame(["'    ", '    .', ' .   '], ['t    ', '    u', ' u   '])
    ] } },
    lods: { half: { size: { w: 3, h: 2 }, anchor: { x: 1, y: 1 }, animations: { burst: { durations: [50, 50, 50], loop: false, frames: [
      frame(["','", "'|'"], ['TtT', 'tTt']), frame(["' '", '. .'], ['T T', 'u u']), frame(['.  ', '  .'], ['t  ', '  u'])
    ] } } } }
  };
  A.m3Sprites = { pickupHp: pickupHp, pickupMp: pickupMp, strawPuff: strawPuff };

  // View-only pickup behaviour (presentPickups, architecture 30.2 US-080b: "the bob and the last-180-step blink are
  // view-only, no sim state"). Steps are the 60 Hz sim steps.
  A.pickupStyle = {
    story: 'US-080b',
    hp: { model: 'pickupHp', anim: 'idle', hoverM: 0.15, bob: { ampM: 0.04, periodMs: 1400 },
          note: 'the anchor (flask foot) floats hoverM above the drop point, +- ampM sine bob' },
    mp: { model: 'pickupMp', anim: 'idle', hoverM: 0.28, bob: { ampM: 0.06, periodMs: 2600 },
          note: 'floats higher and slower than the flask: it does not sit, it hangs' },
    phase: 'bob phase = (spawn step * 37) mod period, so two drops side by side never bob in step',
    blink: { lastSteps: 180, periodSteps: 12, onSteps: 7, fastFromSteps: 60, fastPeriodSteps: 6, fastOnSteps: 3,
             note: 'life <= 180: visible while (life mod period) < on; life <= 60: the fast pattern. Hidden = not drawn ' +
                   '(no fade: hard blink reads better at 5 m)' },
    collect: { anim: 'collect', ms: 150, note: 'OPTIONAL view-only pop: keep drawing the collected drop for 150 ms with ' +
               'clip collect (no bob), then drop it. Skip if presentPickups has no per-drop memory' },
    light: { preset: null, note: 'no point light by default (cost: one light per drop). If the owner finds drops hard to ' +
             'spot at night: hp {color vital, 0.15, r 0.8 m}, mp {color mana, 0.20, r 1.0 m}, flicker off' }
  };

  // ===================================================================================================================
  // 6. VITALS UI (uiStyle.vitals): every number is a UI-grid cell (160x60, uiStyle.uiGrid), so the HUD is the same size
  //    at 160x60 and 240x90. Colours are literal RGB (setCellRGB fast path; the palette key is in `note` / `key`).
  //    UI cells are opaque (RenderTargetGL pass 1: no blending), so every drawn cell carries its own bg.
  //
  //    Layout (x from 2, row 1 = HP, row 2 = MP):
  //      col  2   5                        26 28
  //           HP [####################] 30/30
  //           MP [====================] 20/20
  // ===================================================================================================================
  var RGB = {
    vitalLight: [255, 143, 126], vital: [216, 52, 74], vitalDark: [92, 20, 34], danger: [255, 59, 59],
    manaCore: [232, 242, 255], manaLight: [156, 194, 255], mana: [76, 132, 242], manaDark: [30, 47, 106],
    uiText: [232, 226, 208], uiHint: [169, 163, 144], uiDim: [106, 106, 120], plate: [10, 11, 16]
  };
  A.uiStyle.vitals = {
    story: 'US-080a2 (HP bar, hurt edge, death card) / US-080b (MP bar, mana-short flash)',
    layout: { x: 2, hpRow: 1, mpRow: 2, labelCol: 0, openCol: 3, firstCell: 4, cells: 20, closeCol: 24, numberCol: 26,
              note: 'cols relative to layout.x: label at x+0..1, "[" at x+3, the 20 cells x+4..x+23, "]" x+24, the ' +
                    'number from x+26 (left-aligned, up to "100/100")' },
    visibleRule: 'hidden on the title card, the map card, the settings panel, the end card and the death card; shown ' +
                 'otherwise (drawVitals `visible` from the caller)',
    textBg: RGB.plate, textBgNote: 'bg of the label / bracket / number cells and the spaces between them (a dark strip, ' +
            'so the HUD reads on the bright sky at the summit too)',
    plate: { pad: 1, bgMul: 0.35, note: 'OPTIONAL scene plate under the HUD block (same as uiStyle.hint.plate); the strip ' +
             'bg above already makes it readable' },
    fillRule: 'cells = value * 20 / max (float). full = floor(cells) cells in `fill`; if cells - full >= 0.5 one more cell ' +
              'in `part`; value > 0 always shows at least one `part` cell; the rest `empty`. 30 HP: 1 cell = 1.5 HP, a ' +
              '5 HP hit removes 3.3 cells',
    hp: {
      label: { text: 'HP', fg: RGB.vitalLight, key: 'vitalLight' },
      brackets: { open: '[', close: ']', fg: RGB.uiHint },
      fill:  { glyph: '#', fg: RGB.vital, bg: [58, 12, 20], key: 'vital' },
      part:  { glyph: '+', fg: [186, 46, 62], bg: [40, 10, 16] },
      empty: { glyph: '.', fg: [110, 40, 48], bg: [24, 8, 12] },
      number: { format: '{hp}/{max}', fg: RGB.uiText },
      low: { atOrBelow: 0.25, hz: 1.0, curve: 'a = 0.5 - 0.5 * cos(2 pi hz t), t = simTime s (presentation only)',
             fill: { fgTo: [255, 110, 96], bgTo: [120, 18, 22] }, brackets: { fgTo: RGB.danger }, number: { fgTo: RGB.danger },
             note: 'every colour lerps from its normal value to `...To` by a; glyphs unchanged. danger is right here: ' +
                   'low HP IS the warning' },
      chip: { stages: [{ ms: 120, glyph: '#', fg: [255, 214, 190] }, { ms: 150, glyph: '=', fg: [200, 90, 90] },
                       { ms: 150, glyph: ':', fg: [130, 46, 52] }],
              note: 'damage follow-through (view-only: the view remembers the previous hp and the tick it changed): the ' +
                    'cells just lost play these stages, then become `empty`. A new hit during a chip restarts it from ' +
                    'the newest value' },
      gain: { ms: 220, fg: [255, 236, 228], note: 'cells just gained (heal / pickup / respawn) flash this fg, then `fill`' }
    },
    mp: {
      label: { text: 'MP', fg: RGB.manaLight, key: 'manaLight' },
      brackets: { open: '[', close: ']', fg: RGB.uiHint },
      fill:  { glyph: '=', fg: RGB.mana, bg: [16, 24, 60], key: 'mana' },
      part:  { glyph: '-', fg: [64, 108, 200], bg: [12, 18, 44] },
      empty: { glyph: '.', fg: [44, 62, 112], bg: [8, 10, 26] },
      number: { format: '{mp}/{max}', fg: RGB.uiText },
      short: { ms: 320, blinks: 2, brackets: { fg: RGB.manaCore }, empty: { glyph: '-', fg: RGB.manaLight }, label: { fg: RGB.manaCore },
               note: 'spendMana short (manaFlashTick): 2 blinks in 320 ms (80 ms on / 80 off): brackets, label and the ' +
                     'empty cells switch to these; fill unchanged' },
      gain: { ms: 160, fg: RGB.manaCore, note: 'a regen tick (+1 MP) or a pickup: the new cell(s) flash white-blue' }
    },
    // ---- the hurt flash: a ragged red frame on the UI layer for 0.15 s after hurtTick (architecture 30.2 US-080a2)
    hurtEdge: {
      steps: 9, ms: 150,
      rings: [
        { glyph: '#', fg: RGB.danger,      bg: [120, 14, 14], coverage: 1.00 },
        { glyph: '%', fg: [226, 46, 40],   bg: [70, 8, 10],   coverage: 0.75 },
        { glyph: ':', fg: [186, 34, 30],   bg: [40, 6, 8],    coverage: 0.50, cornersOnly: { cols: 28, rows: 9 } }
      ],
      thickness: { rows: 1, cols: 2, note: 'one ring = 1 UI row on the top and bottom, 2 UI cols on the left and right ' +
                   '(a UI cell is 12 x 18 px: 2 cols ~ 1.3 rows), ring 0 = the outermost' },
      stages: [
        { untilStep: 3, rings: 3, gain: 1.00 },
        { untilStep: 6, rings: 2, gain: 0.75 },
        { untilStep: 9, rings: 1, gain: 0.50, glyph: ':' }
      ],
      ragged: 'a ring cell is drawn only if (hash(x, y) mod 100) < coverage * 100 (any fixed integer hash: the same ' +
              'cells every hit, so the edge does not crawl); ring 2 only within `cornersOnly` cols / rows of a corner',
      gainRule: 'fg and bg x gain; stage `glyph` (if set) replaces every ring glyph',
      note: 'drawn after the HUD bars and before the death card; skipped while a card is up. Pairs with the 2 deg ' +
            'camera kick (render eye only). The UI layer has no alpha, so this is a hard ragged frame, not a vignette; ' +
            'a soft scene-side edge tint would be an engine feature (not needed for M3)'
    },
    // ---- the death card (architecture 30.2: applySceneFade with the end-card LUT on deathStep; panel / richText)
    deathCard: {
      fade: { sinkSteps: 48, fadeSteps: 90, lut: 'the end-card fade LUT (uiStyle.fade rule)', note: 'eye sinks to 0.4 m ' +
              'over the sink, then the scene fades to black; the HUD hides at the first death step' },
      lines: [
        { id: 'fall', row: 28, align: 'center', typed: true, cps: 30, fg: RGB.uiText, text: null,
          placeholder: 'The dark again. The light still blinks.',
          note: 'WRITER: the death line (docs/story.md has none yet). Typed on after the fade at cps' },
        { id: 'wake', row: 31, align: 'center', typed: false, afterGapSec: 1.0, fg: RGB.uiText, key: [255, 210, 74],
          text: '[E] Wake again', keys: ['[E]'], cursor: { glyph: '_', periodSec: 1.0, duty: 0.5 },
          note: '`[E]` in gold (uiStyle.prompt key colour); E works from the moment this line shows (cardReady)' }
      ],
      bg: [0, 0, 0], note: 'black card, no plate, no frame: the same quiet look as the end card, so a death never feels ' +
                           'like a menu'
    }
  };

  // ===================================================================================================================
  // 7. ATTACH: only once the materials / colours are merged (a missing v2 record would switch the GPU path off).
  // ===================================================================================================================
  A.voxelModels.attachM3 = function attachM3() {
    var P = A.palette, DP = A.detailPass, done = [], k, ok, n, keys;
    if (!P) return done;
    A.models = A.models || {};
    if (DP) {
      ok = true;
      for (k in PELL_MATS) if (!P.materials[PELL_MATS[k]] || !DP.materials[PELL_MATS[k]]) ok = false;
      if (ok && !A.models.practiceTarget) { A.models.practiceTarget = A.voxelModels.practiceTarget; done.push('practiceTarget'); }
    }
    for (n in A.m3Sprites) {
      keys = A.m3Sprites[n].keys; ok = true;
      for (k in keys) if (!P.colors[keys[k].c]) ok = false;
      if (ok && !A.models[n]) { A.models[n] = A.m3Sprites[n]; done.push(n); }
    }
    return done;
  };
  A.voxelModels.attachM3();

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { practiceTarget: A.voxelModels.practiceTarget, sprites: A.m3Sprites, pickupStyle: A.pickupStyle,
                       vitals: A.uiStyle.vitals, kit: A.m3Kit, levelPatch: A.levelPatch.towerPracticeTarget };
  }
})(typeof window !== 'undefined' ? window : globalThis);
