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
 *   ASSETS.voxelModels.awakeningCrates / awakeningKeeper   ENV-02 (D-038, v1.31, README 7.6): two composite clutter
 *                                      sets for the tower hall (section 6b), one voxel instance each, world-oriented.
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
        flash:  { durations: [50, 50], loop: false, interp: 'step', frames: [pellPose(4, false), pellPose(8, false)] }  /* HIT-BLEED-01: no white shell; chips fly instead */,
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
        { id: 'fall', row: 28, align: 'center', typed: true, cps: 30, fg: RGB.uiText,
          text: 'The dark again. The light still blinks.',
          placeholder: 'The dark again. The light still blinks.',
          note: 'US-080a2: writer pick (docs/story.md "Death card" option 1). Typed on after the fade at cps' },
        { id: 'wake', row: 31, align: 'center', typed: false, afterGapSec: 1.0, fg: RGB.uiText, key: [255, 210, 74],
          text: '[E] Wake again', keys: ['[E]'], cursor: { glyph: '_', periodSec: 1.0, duty: 0.5 },
          note: '`[E]` in gold (uiStyle.prompt key colour); E works from the moment this line shows (cardReady)' }
      ],
      bg: [0, 0, 0], note: 'black card, no plate, no frame: the same quiet look as the end card, so a death never feels ' +
                           'like a menu'
    }
  };

  // ===================================================================================================================
  // 6b. ENV-02 "THE AWAKENING" HALL DRESSING (D-038, README 7.6, v1.31)
  //     Two COMPOSITE clutter sets, ONE voxel instance each. Why: VoxelPool draws only the nearest MAX_VOX_INSTANCES
  //     (16) voxel entities per frame and the tower already places 16 (world_m1 adds the waystone + 2 boars), so every
  //     extra instance pushes a far one out of the frame. Each set is a meshOnly grid authored in WORLD orientation
  //     (place it with facing 0: x east, y south), 0.04 m voxels (chunky Build-engine props), built by the small
  //     deterministic builders below (integer hash3, no Math.random). Materials: already merged keys only.
  //     Kept in THIS file on purpose: World.load throws on an unregistered prop model, and every Node suite / tool that
  //     loads the tower already loads m3_props.js (for the pell); a new file would need ~40 loader lines first.
  //       awakeningCrates  north + west of the hall: crate stack + stove-in crate against the stair walkway (cells
  //                        17,5 / 16,5), fallen cheek stones, the garrison's open water butt (14,7), a fallen helm.
  //       awakeningKeeper  east + south-east: grain sacks + sealed barrel with a rope coil, a shovel leaning on the
  //                        step-7 face + a heap of chain (18,5 / 19,5), the relay-keeper's corner by KEEP THE LIGHT (18,9):
  //                        straw mat, bedroll, log book, a stool with a snapped leg, a cold candle stub, a tin cup.
  // ===================================================================================================================
  var AWK_CELL = 0.04;
  var AWK_MATS = { W: 'wood', w: 'timber_old', I: 'iron_dark', i: 'iron_light', S: 'steel_old', r: 'rope',
                   L: 'linen_light', l: 'linen', d: 'linen_dark', T: 'straw_light', t: 'straw', u: 'straw_dark',
                   B: 'block_light', b: 'block_dark', m: 'moss_cap', h: 'leather', c: 'canvas_dark' };
  var AWK_KEYS = ['awakeningCrates', 'awakeningKeeper'];

  // A voxel grid whose voxel (0,0,0) sits at world (x0m, y0m, 0); all builder inputs are WORLD metres.
  function awkGrid(x0m, y0m, wM, dM, hM) {
    var sx = Math.round(wM / AWK_CELL), sy = Math.round(dM / AWK_CELL), sz = Math.round(hM / AWK_CELL);
    var a = new Array(sx * sy * sz), i, bounds = null, pieces = [];
    for (i = 0; i < a.length; i++) a[i] = '.';
    return {
      x0m: x0m, y0m: y0m, sx: sx, sy: sy, sz: sz, pieces: pieces,
      vx: function (m) { return Math.round((m - x0m) / AWK_CELL); },
      vy: function (m) { return Math.round((m - y0m) / AWK_CELL); },
      vz: function (m) { return Math.round(m / AWK_CELL); },
      fx: function (m) { return (m - x0m) / AWK_CELL; },
      fy: function (m) { return (m - y0m) / AWK_CELL; },
      put: function (x, y, z, ch) {
        if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return;
        a[x + sx * (y + sy * z)] = ch;
        if (bounds && ch !== '.') {
          bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.min(bounds[2], z);
          bounds[3] = Math.max(bounds[3], x + 1); bounds[4] = Math.max(bounds[4], y + 1); bounds[5] = Math.max(bounds[5], z + 1);
        }
      },
      // PROP-COLLIDE-01b: authored pieces only, using the voxels actually emitted (exclusive upper bounds).
      piece: function (build, args) {
        bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        build.apply(null, [this].concat(args));
        if (bounds[5] - bounds[2] > 3) pieces.push(bounds); // <= 0.12 m remains walk-over
        bounds = null;
      },
      layers: function () {
        var out = [], z, y, L, s;
        for (z = 0; z < sz; z++) {
          L = [];
          for (y = 0; y < sy; y++) { s = sx * (y + sy * z); L.push(a.slice(s, s + sx).join('')); }
          out.push(L);
        }
        return out;
      }
    };
  }
  // A plank crate, HOLLOW (a knocked-out plank shows the dark inside): box [x0, x1) x [y0, y1) x [z0, z1) in metres.
  // Side planks run horizontally, lid planks north-south (seams every 4 voxels), dark battens on the edges, iron caps on
  // the corners. opts: openWest (two planks knocked out of the west face), mossSouth / mossWest (damp foot).
  function awkCrate(g, x0, y0, z0, x1, y1, z1, opts) {
    var X0 = g.vx(x0), X1 = g.vx(x1), Y0 = g.vy(y0), Y1 = g.vy(y1), Z0 = g.vz(z0), Z1 = g.vz(z1), x, y, z, ex, ey, ez, n, ch;
    opts = opts || {};
    for (z = Z0; z < Z1; z++) for (y = Y0; y < Y1; y++) for (x = X0; x < X1; x++) {
      ex = (x === X0 || x === X1 - 1); ey = (y === Y0 || y === Y1 - 1); ez = (z === Z0 || z === Z1 - 1);
      n = (ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0);
      if (n === 0) continue;
      if (n === 3) ch = 'I';
      else if (n === 2) ch = 'w';
      else if (ez) ch = ((x - X0) % 4 === 0) ? 'w' : 'W';
      else ch = ((z - Z0) % 4 === 0) ? 'w' : 'W';
      if (ch === 'W' && hash3(x, y, z) < 70) ch = 'w';
      if (opts.openWest && x === X0 && !ey && !ez && z - Z0 >= 2 && z - Z0 <= 5) continue;
      if (opts.mossSouth && y === Y1 - 1 && z - Z0 <= 1 && hash3(x, y, z) < 450) ch = 'm';
      if (opts.mossWest && x === X0 && z - Z0 <= 1 && hash3(x, y, z) < 450) ch = 'm';
      g.put(x, y, z, ch);
    }
  }
  // A stave barrel on z0: radius r with a 12 % belly, iron hoops at the given heights (metres above z0), alternating
  // light / dark staves (18 sectors). opts.open: no lid, dark water 2 voxels under the rim. opts.moss: north foot.
  function awkBarrel(g, cx, cy, z0, r, h, opts) {
    var CX = g.fx(cx), CY = g.fy(cy), R = r / AWK_CELL, Z0 = g.vz(z0), H = g.vz(h), hoops = {}, x, y, k, t, rr, dx, dy, d, rim, ch, top;
    opts = opts || {};
    (opts.hoops || [0.08, 0.6]).forEach(function (m) { var hz = g.vz(m); hoops[hz] = 1; hoops[hz + 1] = 1; });
    for (k = 0; k < H; k++) {
      t = (k + 0.5) / H; rr = R * (0.88 + 0.12 * Math.sin(Math.PI * t)); top = (k === H - 1);
      for (y = Math.floor(CY - R - 1); y <= Math.ceil(CY + R + 1); y++) for (x = Math.floor(CX - R - 1); x <= Math.ceil(CX + R + 1); x++) {
        dx = x + 0.5 - CX; dy = y + 0.5 - CY; d = Math.sqrt(dx * dx + dy * dy);
        if (d > rr) continue;
        rim = d > rr - 1.15;
        if (opts.open && !rim && k >= H - 3) { if (k === H - 3) g.put(x, y, Z0 + k, 'I'); continue; }
        if (rim) {
          if (top) ch = 'w';
          else if (hoops[k]) ch = 'I';
          else ch = (Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 18) % 2) ? 'w' : 'W';
        } else ch = top ? ((x % 3 === 0) ? 'w' : 'W') : 'w';
        if (opts.moss && rim && k <= 1 && dy < 0 && hash3(x, y, k) < 500) ch = 'm';
        g.put(x, y, Z0 + k, ch);
      }
    }
  }
  // A grain sack slumped on z0: squashed ellipsoid with a flat foot, pale crest, linen body, dark underside; neck =
  // a tied top (linen, rope band, a pale tuft).
  function awkSack(g, cx, cy, z0, rx, ry, rz, neck) {
    var CX = g.fx(cx), CY = g.fy(cy), Z0 = g.vz(z0), RX = rx / AWK_CELL, RY = ry / AWK_CELL, RZ = rz / AWK_CELL;
    var ZN = Math.floor(2 * RZ - 0.5), x, y, z, dx, dy, dz, hgt, hh, nx, ny, top = 0;
    nx = Math.floor(CX); ny = Math.floor(CY);
    for (z = 0; z <= ZN; z++) for (y = Math.floor(CY - RY); y <= Math.ceil(CY + RY); y++) for (x = Math.floor(CX - RX); x <= Math.ceil(CX + RX); x++) {
      dx = (x + 0.5 - CX) / RX; dy = (y + 0.5 - CY) / RY; dz = (z + 0.5 - RZ) / RZ;
      if (dz < -0.75) dz = -0.75;
      if (dx * dx + dy * dy + dz * dz > 1) continue;
      hgt = (z + 0.5) / (2 * RZ); hh = hash3(x, y, z);
      g.put(x, y, Z0 + z, hgt > 0.72 ? (hh < 600 ? 'L' : 'l') : (hgt < 0.25 ? 'd' : (hh < 120 ? 'd' : 'l')));
      if (x === nx && y === ny && z > top) top = z;              // the neck stands on the highest centre voxel
    }
    if (neck) {
      ZN = top;
      g.put(nx, ny, Z0 + ZN + 1, 'l'); g.put(nx, ny, Z0 + ZN + 2, 'r'); g.put(nx + 1, ny, Z0 + ZN + 2, 'r'); g.put(nx, ny, Z0 + ZN + 3, 'L');
    }
  }
  // A rolled bedroll along x: linen top, dark underside, leather straps 3 voxels in from each end, the rolled layers
  // (canvas_dark rings) on the end faces.
  function awkRollX(g, x0, x1, cy, cz, r) {
    var X0 = g.vx(x0), X1 = g.vx(x1), CY = g.fy(cy), CZ = cz / AWK_CELL, R = r / AWK_CELL, x, y, z, dy, dz, d, ch;
    for (x = X0; x < X1; x++) for (y = Math.floor(CY - R); y <= Math.ceil(CY + R); y++) for (z = Math.max(0, Math.floor(CZ - R)); z <= Math.ceil(CZ + R); z++) {
      dy = y + 0.5 - CY; dz = z + 0.5 - CZ; d = Math.sqrt(dy * dy + dz * dz);
      if (d > R) continue;
      if ((x - X0 === 3 || X1 - 1 - x === 3) && d > R - 1.1) ch = 'h';
      else if (x === X0 || x === X1 - 1) ch = (d < R * 0.45 || (d > R * 0.7 && d < R * 0.9)) ? 'c' : 'd';
      else ch = (dz > R * 0.3) ? 'l' : 'd';
      g.put(x, y, z, ch);
    }
  }
  // A low stone chunk (fallen wall stone / pebble): pale top with moss flecks, dark sides. At least 1 voxel per axis.
  function awkBlock(g, x0, y0, z0, x1, y1, z1) {
    var X0 = g.vx(x0), Y0 = g.vy(y0), Z0 = g.vz(z0), X1 = Math.max(g.vx(x1), X0 + 1), Y1 = Math.max(g.vy(y1), Y0 + 1), Z1 = Math.max(g.vz(z1), Z0 + 1), x, y, z;
    for (z = Z0; z < Z1; z++) for (y = Y0; y < Y1; y++) for (x = X0; x < X1; x++) {
      g.put(x, y, z, z === Z1 - 1 ? (hash3(x, y, z) < 260 ? 'm' : 'B') : 'b');
    }
  }
  // A dented iron kettle helm lying upright on the floor: steel brim ring, iron bowl narrowing upward.
  function awkHelm(g, cx, cy) {
    var CX = g.fx(cx), CY = g.fy(cy), RAD = [3.6, 2.7, 2.3, 1.6], x, y, z, dx, dy, d;
    for (z = 0; z < RAD.length; z++) for (y = Math.floor(CY - 4); y <= Math.ceil(CY + 4); y++) for (x = Math.floor(CX - 4); x <= Math.ceil(CX + 4); x++) {
      dx = x + 0.5 - CX; dy = y + 0.5 - CY; d = Math.sqrt(dx * dx + dy * dy);
      if (d > RAD[z]) continue;
      if (z === 0 && d < 2.0) continue;
      if (z === 2 && dx > 1.2 && dy < -0.5) continue;
      g.put(x, y, z, z === 0 ? 'S' : 'I');
    }
  }
  // A rope coil lying on a lid at height z: two concentric rings.
  function awkCoil(g, cx, cy, z, r) {
    var CX = g.fx(cx), CY = g.fy(cy), R = r / AWK_CELL, Z = g.vz(z), x, y, dx, dy, d;
    for (y = Math.floor(CY - R - 1); y <= Math.ceil(CY + R + 1); y++) for (x = Math.floor(CX - R - 1); x <= Math.ceil(CX + R + 1); x++) {
      dx = x + 0.5 - CX; dy = y + 0.5 - CY; d = Math.sqrt(dx * dx + dy * dy);
      if ((d >= R - 1 && d <= R + 0.4) || (d >= R - 2.4 && d < R - 1.4)) g.put(x, y, Z, 'r');
    }
  }
  // A shovel leaning on the wall east of it: a 1-voxel blade plate (y-z plane, steel edge rows at the foot) and a
  // 1x1 voxel shaft from the blade top (0.30 m) to the wall (x 19.94, 1.04 m), T grip at the top.
  function awkShovel(g, bx, by) {
    var X = g.vx(bx), Y0 = g.vy(by - 0.11), Y1 = g.vy(by + 0.11), Z1 = g.vz(0.30), YC = g.vy(by), x, y, z, k, t;
    for (z = 0; z < Z1; z++) for (y = Y0; y < Y1; y++) {
      if (z === 0 && (y === Y0 || y === Y1 - 1)) continue;
      g.put(X, y, z, z <= 1 ? 'S' : 'I');
    }
    for (k = 0; k <= 60; k++) { t = k / 60; g.put(g.vx(bx + 0.02 + (19.94 - bx - 0.02) * t), YC, g.vz(0.30 + 0.74 * t), 'w'); }
    x = g.vx(19.94); z = g.vz(1.04);
    for (y = YC - 2; y <= YC + 2; y++) g.put(x, y, z, 'w');
  }
  // A low heap of rusty chain: alternating light / dark link voxels with gaps, 2 layers.
  function awkChain(g, cx, cy, r) {
    var CX = g.fx(cx), CY = g.fy(cy), R = r / AWK_CELL, x, y, z, dx, dy;
    for (z = 0; z <= 1; z++) for (y = Math.floor(CY - R); y <= Math.ceil(CY + R); y++) for (x = Math.floor(CX - R); x <= Math.ceil(CX + R); x++) {
      dx = x + 0.5 - CX; dy = y + 0.5 - CY;
      if (Math.sqrt(dx * dx + dy * dy) > R - z * 1.2 || hash3(x, y, z + 40) < 280) continue;
      g.put(x, y, z, ((x + y + z) % 2) ? 'I' : 'i');
    }
  }
  // The keeper's straw mat (one layer, frayed edge).
  function awkMat(g, x0, y0, x1, y1) {
    var X0 = g.vx(x0), X1 = g.vx(x1), Y0 = g.vy(y0), Y1 = g.vy(y1), x, y, edge, hh;
    for (y = Y0; y < Y1; y++) for (x = X0; x < X1; x++) {
      edge = (x === X0 || x === X1 - 1 || y === Y0 || y === Y1 - 1); hh = hash3(x, y, 7);
      if (edge && hh < 200) continue;
      g.put(x, y, 0, edge ? 'u' : (hh < 180 ? 'T' : (hh > 880 ? 'u' : 't')));
    }
  }
  // The keeper's log book: leather covers, a pale page block showing on three edges, spine on the west.
  function awkBook(g, x0, y0, x1, y1, z0) {
    var X0 = g.vx(x0), X1 = g.vx(x1), Y0 = g.vy(y0), Y1 = g.vy(y1), Z0 = g.vz(z0), x, y, z;
    for (z = Z0; z < Z0 + 3; z++) for (y = Y0; y < Y1; y++) for (x = X0; x < X1; x++) g.put(x, y, z, (z === Z0 + 1 && x !== X0) ? 'L' : 'h');
  }
  // A square stool (1-voxel seat at seatZ), the south-east leg snapped: stubs left, the broken piece on the floor.
  function awkStool(g, cx, cy, seatZ, half) {
    var X0 = g.vx(cx - half), X1 = g.vx(cx + half), Y0 = g.vy(cy - half), Y1 = g.vy(cy + half), ZS = g.vz(seatZ), x, y, z, k;
    var legs = [[X0, Y0], [X1 - 1, Y0], [X0, Y1 - 1], [X1 - 1, Y1 - 1]];
    for (y = Y0; y < Y1; y++) for (x = X0; x < X1; x++) g.put(x, y, ZS, (x === X0 || x === X1 - 1 || y === Y0 || y === Y1 - 1) ? 'w' : 'W');
    for (k = 0; k < 4; k++) for (z = 0; z < ZS; z++) {
      if (k === 3 && z >= 2 && z < ZS - 3) continue;
      g.put(legs[k][0], legs[k][1], z, 'w');
    }
    for (x = X0 - 5; x < X0 - 1; x++) g.put(x, Y1 - 1, 0, 'w');
  }
  // A COLD candle stub (2x2x3 voxels, linen_light wax) standing at z0, wax run onto what it stands on: burnt down long
  // ago (canon: the keeper's log is old, nobody has been here for years). Option for the PO / writer, not in the level:
  // a lit candle = `lampFlame` billboard at the candle top (z0 + 0.12) + palette light preset `candle` 0.1 m above it.
  function awkCandle(g, cx, cy, z0) {
    var X = g.vx(cx), Y = g.vy(cy), Z = g.vz(z0), z;
    for (z = Z; z < Z + 3; z++) { g.put(X - 1, Y - 1, z, 'L'); g.put(X, Y - 1, z, 'L'); g.put(X - 1, Y, z, 'L'); g.put(X, Y, z, 'L'); }
    g.put(X + 1, Y, Z, 'L'); g.put(X - 1, Y + 1, Z, 'L');
  }
  function awkCup(g, cx, cy) {
    var X = g.vx(cx), Y = g.vy(cy);
    g.put(X, Y, 0, 'i'); g.put(X, Y, 1, 'i'); g.put(X + 1, Y, 1, 'I');
  }

  function buildAwakeningCrates() {
    var g = awkGrid(14.0, 5.0, 4.0, 3.0, 1.0);
    // against the stair walkway's south face beside the burner: a big crate, a smaller one stacked on it, a stove-in
    // crate to the west (two planks knocked out of its west face, moss at its foot)
    g.piece(awkCrate, [17.34, 5.02, 0.00, 17.96, 5.54, 0.52, { mossSouth: true }]);
    g.piece(awkCrate, [17.44, 5.06, 0.52, 17.92, 5.46, 0.88, {}]);
    g.piece(awkCrate, [17.02, 5.06, 0.00, 17.30, 5.42, 0.32, { openWest: true, mossWest: true }]);
    // fallen cheek stones + pebbles along the wall foot and toward the stair base (all <= 0.12 m: walk-over)
    [[16.02, 5.01, 0.18, 0.14, 0.08], [16.22, 5.02, 0.12, 0.12, 0.12], [16.38, 5.00, 0.22, 0.16, 0.08],
     [16.64, 5.03, 0.12, 0.10, 0.04], [16.76, 5.02, 0.14, 0.14, 0.08], [16.48, 5.26, 0.04, 0.04, 0.04],
     [15.66, 5.10, 0.12, 0.10, 0.04], [17.12, 5.56, 0.08, 0.08, 0.04]].forEach(function (s) {
      awkBlock(g, s[0], s[1], 0, s[0] + s[2], s[1] + s[3], s[4]);
    });
    // the garrison's water butt against the upper-stair column (cell 14,7): lid gone, dark water, moss at its foot
    g.piece(awkBarrel, [14.40, 7.60, 0, 0.27, 0.76, { open: true, hoops: [0.08, 0.36, 0.64], moss: true }]);
    // a second rusty kettle helm, fallen off the pell long ago
    g.piece(awkHelm, [14.84, 7.44]);
    return g;
  }
  function buildAwakeningKeeper() {
    var g = awkGrid(18.0, 5.0, 2.0, 5.0, 1.12);
    // the crate stack's east flank (cell 18,5) and the NE pocket (19,5): grain sacks, a sealed barrel + rope coil
    g.piece(awkSack, [18.24, 5.28, 0, 0.22, 0.20, 0.17, true]);
    g.piece(awkSack, [18.48, 5.50, 0, 0.14, 0.19, 0.10, false]);
    g.piece(awkBarrel, [19.60, 5.42, 0, 0.28, 0.80, { hoops: [0.10, 0.40, 0.70], moss: true }]);
    g.piece(awkCoil, [19.60, 5.42, 0.80, 0.13]);
    g.piece(awkSack, [19.17, 5.80, 0, 0.15, 0.14, 0.15, true]);
    // same pocket, against the step-7 face: a shovel leaning on the wall, a heap of chain at its foot. (Cell 19,7 under
    // the lamp stays empty: it is a wake -> burner arrival cell and the lamp approach.)
    g.piece(awkShovel, [19.72, 5.86]);
    g.piece(awkChain, [19.48, 5.86, 0.10]);
    // SE corner (cell 18,9) = the relay-keeper's corner by KEEP THE LIGHT: mat, bedroll, log book, stool, candle, cup
    g.piece(awkMat, [18.06, 9.30, 18.94, 9.96]);
    awkRollX(g, 18.10, 18.88, 9.80, 0.14, 0.10);
    g.piece(awkBook, [18.30, 9.40, 18.50, 9.52, 0.04]);
    g.piece(awkStool, [18.72, 9.16, 0.40, 0.14]);
    g.piece(awkCandle, [18.72, 9.16, 0.44]);
    g.piece(awkCup, [18.46, 9.12]);
    return g;
  }
  function awkModel(key, displayName, desc, g, ax, ay, placement) {
    var anchor = [(ax - g.x0m) / AWK_CELL, (ay - g.y0m) / AWK_CELL, 0];
    var colliders = g.pieces.map(function (b) {
      return { type: 'box', c: [(0.5 * (b[0] + b[3]) - anchor[0]) * AWK_CELL,
                               (0.5 * (b[1] + b[4]) - anchor[1]) * AWK_CELL, 0.5 * (b[2] + b[5]) * AWK_CELL],
               half: [0.5 * (b[3] - b[0]) * AWK_CELL, 0.5 * (b[4] - b[1]) * AWK_CELL, 0.5 * (b[5] - b[2]) * AWK_CELL] };
    });
    return {
      name: key, displayName: displayName, desc: desc, colliders: colliders,
      voxel: {
        version: 1, meshOnly: true, cellM: AWK_CELL, size: [g.sx, g.sy, g.sz], anchor: anchor, mats: AWK_MATS,
        layers: g.layers(),
        parts: { body: { box: [0, 0, 0, g.sx, g.sy, g.sz], pivot: anchor } },
        animations: { idle: { durations: [1000], loop: true, frames: [{ body: { rot: [0, 0, 0] } }] } }
      },
      placement: placement
    };
  }
  A.voxelModels.awakeningCrates = awkModel('awakeningCrates', 'crates by the stair',
    'ENV-02 composite (tower hall, north + west): crate stack + stove-in crate against the stair walkway beside the ' +
    'burner, fallen cheek stones, the garrison water butt (open, dark water), a fallen kettle helm. 4.0 x 3.0 x 1.0 m ' +
    'grid at 0.04 m, world orientation (facing 0).', buildAwakeningCrates(), 16.0, 6.5,
    { level: 'tower', prop: 'dressCrates', x: 16.0, y: 6.5, z: 0, facing: 0,
      note: 'grid origin = world (14.0, 5.0, 0); anchor = the placement point (16.0, 6.5). Never rotate: authored in world axes.' });
  A.voxelModels.awakeningKeeper = awkModel('awakeningKeeper', 'the keeper\'s corner',
    'ENV-02 composite (tower hall, east + south-east): grain sacks, a sealed barrel with a rope coil, a shovel + chain ' +
    'in the NE pocket, the relay-keeper\'s corner (straw mat, bedroll, log book, stool with a snapped leg, cold candle stub, ' +
    'tin cup). 2.0 x 5.0 x 1.12 m grid at 0.04 m, world orientation (facing 0).', buildAwakeningKeeper(), 19.0, 7.5,
    { level: 'tower', prop: 'dressKeeper', x: 19.0, y: 7.5, z: 0, facing: 0,
      note: 'grid origin = world (18.0, 5.0, 0); anchor = the placement point (19.0, 7.5). Candle top = (18.72, 9.16, 0.56).' });

  // 6c. READ-01 note pages (owner 2026-10-05: readable notes replace the wall scrawls; texts + read panel in notes.js).
  //     Moved here from notes.js so every loader that knows the tower knows these prop models (World.load throws otherwise).
  (function () {
    var CELL = 0.015;
    // P paper (near-white linen), p aged paper edge / back of the fold (pale ochre), k faded ink, K dark ink (title) + nail
    var MATS = { P: 'linen_light', p: 'canvas_light', k: 'linen_dark', K: 'iron_dark' };

    // ===================================================================================================================
    // 1. note: flat page, 16 x 12 x 2 voxels (0.24 x 0.18 x 0.03 m). Layer z0 = the sheet (ink is drawn INTO the sheet's
    //    top face, so lines never stand proud); z1 = only the dog-ear: the front-right corner (x14-15, y0-1) is folded back
    //    over the page and shows its aged back (p). Anchor = bottom centre [8, 6, 0]: level z = the surface it lies on.
    // ===================================================================================================================
    var FLAT_Z0 = [
      'pPPPPPPPPPPPPP..',   // y0 (front edge): x14-15 folded away
      'PPKKKKKKPPPPPPP.',   // title stroke (dark ink); x15 folded away
      'PPPPPPPPPPPPPPPP',
      'PPkkPkkkkPkkkPPp',
      'PPPPPPPPPPPPPPPP',
      'PPkkkPkkPkkkkkPP',
      'PPPPPPPPPPPPPPPP',
      'PPkkkkPkkkPkkPPP',
      'PPPPPPPPPPPPPPPP',
      'PPkkPkkkkkPPPPPP',   // short last line
      'PPPPPPPPPPPPPpPP',
      '.pPPPPPPPPPPPpp.'    // y11 (back edge): soft worn corners
    ];
    var FLAT_Z1 = [
      '................',
      '.............p..',   // the folded flap, lying on the page (its aged back up)
      '.............pp.',
      '................', '................', '................', '................', '................',
      '................', '................', '................', '................'
    ];
    A.voxelModels.note = {
      name: 'note',
      displayName: 'page',
      desc: 'A loose page lying flat: pale linen paper with faded ink lines and a darker title stroke, worn corners, the ' +
            'front-right corner dog-eared back over the sheet. 0.24 x 0.18 m. Read with [E] (note.read, ASSETS.notes).',
      voxel: {
        version: 1,
        cellM: CELL,
        size: [16, 12, 2],
        anchor: [8, 6, 0],
        mats: MATS,
        layers: [FLAT_Z0, FLAT_Z1],
        parts: { page: { box: [0, 0, 0, 16, 12, 2], pivot: [8, 6, 0] } },      // extent 30
        animations: { idle: { durations: [1000], loop: true, frames: [{}] } },
        mounts: { prompt: { at: [8, 6, 1], part: 'page' } }                   // = the interactable aim point (z + 0.015)
      },
      readability: { note: 'At 1.5 m on 400x150 ~8 x 5 cells (top-down it is foreshortened): the pale sheet against a dark ' +
                     'mat / floor is the cue; the ink stripes show from ~1 m.' }
    };

    // ===================================================================================================================
    // 2. notePinned: upright page, 12 x 3 x 16 voxels (0.18 wide x 0.045 deep x 0.24 tall). The sheet is the BACK row y2
    //    (touching the wall), ink in its front face. y1: the nail head (K) near the top centre + the bottom-right corner
    //    curling forward off the wall (p, its aged back). y0: empty (front clearance). Anchor = [6, 3, 0] = back face,
    //    bottom centre: the level x / y is the wall face, z = the page's bottom edge.
    //    Rows below are drawn TOP-DOWN for reading (z15 first); the code reverses them into layers[z].
    // ===================================================================================================================
    var PIN_SHEET_TOPDOWN = [
      '.PPPPP.PPPP.',   // z15 torn top edge
      'PPPPPPPPPPPP',   // z14
      'PPPPPPPPPPPP',   // z13 (nail in front, y1)
      'PKKKKKKKPPPP',   // z12 title stroke
      'PPPPPPPPPPPP',
      'PkkPkkkkPkkP',   // z10
      'PPPPPPPPPPPP',
      'PkkkPkkPkkkP',   // z8
      'PPPPPPPPPPPP',
      'PkkkkPkkkPPP',   // z6
      'PPPPPPPPPPPP',
      'PkkPkkkkkkPP',   // z4
      'PPPPPPPPPPPP',
      'PPPPPPPPPPpp',   // z2
      'pPPPPPPPPP..',   // z1: bottom-right corner lifts off the wall (see y1)
      '.pPPPPPPPp..'    // z0
    ];
    var E12 = '............';
    function pinLayers() {
      var layers = [], z, row, y1;
      for (z = 0; z < 16; z++) {
        row = PIN_SHEET_TOPDOWN[15 - z];
        y1 = E12;
        if (z === 13) y1 = '.....K......';              // nail head, 1.5 cm proud of the sheet
        if (z === 1) y1 = '..........pp';               // the curl (aged back of the corner)
        if (z === 0) y1 = '..........p.';
        layers.push([E12, y1, row]);
      }
      return layers;
    }
    A.voxelModels.notePinned = {
      name: 'notePinned',
      displayName: 'page',
      desc: 'A page nailed to the wall: pale linen paper, faded ink lines under a darker title stroke, a torn top edge, a ' +
            'dark iron nail head, the bottom-right corner curling off the stone. 0.18 x 0.24 m. Read with [E].',
      voxel: {
        version: 1,
        cellM: CELL,
        size: [12, 3, 16],
        anchor: [6, 3, 0],
        mats: MATS,
        layers: pinLayers(),
        parts: { page: { box: [0, 0, 0, 12, 3, 16], pivot: [6, 3, 0] } },      // extent 31
        animations: { idle: { durations: [1000], loop: true, frames: [{}] } },
        mounts: { prompt: { at: [6, 2, 8], part: 'page' } }                   // front of the sheet, mid height (z + 0.12)
      },
      readability: { note: 'At 2 m on 400x150 ~6 x 8 cells: a pale upright rectangle on dark stone, stripes visible from ~1.5 m.' }
    };
  })();

  // 6d. CH1-D1a doorBar: the barred plank door in the tower's south-west doorway (content/levels/tower.level.json Q 15,11).
  //     20 x 4 x 46 voxels at 0.05 m = 1.0 (fills the 1 m doorway) x 0.2 x 2.3 m. Front (y0) faces north = into the tower.
  //     y0-y1: the timber bar (timber_old, a pale fresh gouge where it is jammed) held in two iron U-brackets on the jambs;
  //     y2-y3: the door leaf, five vertical planks (wood, dark timber seams, staggered worn tops) on two iron straps.
  //     Parts: frameW / frameE (brackets, never move), bar, leaf (hinge = EAST edge, BACK (outer) face of the leaf).
  //     Clips (prop variant = clip): open (TOWER-DOOR-OPEN-01, what the level places: no bar, leaf swung out) |
  //     barred (rest, collider on) | unbar (0.6 s, events thud 3) - barred/unbar kept only for compatibility.
  //     ROTATION (owner bug 2026-10-10 "door disappeared"): the old pose (west hinge on the FRONT face, rz +100) laid the
  //     whole leaf on the wall side of its hinge line, i.e. inside wall cell q (14,11) - invisible. Engine Rz: +deg turns
  //     +x toward +y, model +y = world south (facing 0). Now: hinge at the east edge of the OUTER face [20,4,0], rz -80:
  //     the leaf swings south out of the tower along the east jamb (f / t walls), its body on the passage side of the
  //     hinge line, so it never enters a wall cell; the stair turns west at T, so the west ~0.7 m stays clear.
  //     The bar slides 0.9 m west into its wall socket (hidden in the stone of q) - no fallen bar. Mats: all merged.
  (function () {
    var SX = 20, SY = 4, SZ = 46, OPEN_YAW = -80;
    var MATS = { w: 'wood', t: 'timber_old', d: 'iron_dark' };
    var g = [], x, y, z;
    for (z = 0; z < SZ; z++) { g.push([]); for (y = 0; y < SY; y++) { g[z].push([]); for (x = 0; x < SX; x++) g[z][y].push('.'); } }
    // leaf (y2-y3): planks x 4 wide, seam column x%4 === 3 dark; tops 43/44 staggered, worn corners
    for (x = 0; x < SX; x++) {
      var plank = (x / 4) | 0, top = plank % 2 ? 43 : 44, seam = x % 4 === 3;
      if (x % 4 === 0 && plank % 2) top = 42;
      for (z = 0; z < top; z++) for (y = 2; y < SY; y++) {
        var strap = y === 2 && ((z >= 7 && z <= 8) || (z >= 34 && z <= 35));
        var nail = y === 2 && !strap && (z === 6 || z === 9 || z === 33 || z === 36) && x % 4 === 1;
        g[z][y][x] = strap || nail ? 'd' : (seam || z === 0 ? 't' : 'w');
      }
    }
    // bar (y0-y1), x3..16, z18..21: dark old timber, lighter top edge, a pale gouge at x12-13
    for (x = 3; x < 17; x++) for (z = 18; z < 22; z++) for (y = 0; y < 2; y++) {
      g[z][y][x] = (z === 21 && y === 0) || ((x === 12 || x === 13) && z >= 20) ? 'w' : 't';
    }
    // iron U-brackets on the jambs: x0-2 and x17-19, z16..23 (they hide the bar ends)
    for (z = 16; z < 24; z++) for (y = 0; y < 2; y++) for (x = 0; x < SX; x++) {
      if (x < 3 || x > 16) g[z][y][x] = 'd';
    }
    var layers = g.map(function (L) { return L.map(function (r) { return r.join(''); }); });
    var BAR_DOWN = { pos: [0, 4, -18], rot: [0, 0, 8] };
    var BAR_STOWED = { pos: [-18, 0, 0] };          // bar x3..17 -> x-15..-1 = world x 14.25-14.95: inside wall q, unseen
    A.voxelModels.doorBar = {
      name: 'doorBar',
      displayName: 'barred door',
      desc: 'CH1-D1a / TOWER-DOOR-OPEN-01: a weathered plank door (five planks, two iron straps) in the tower\'s ' +
            'south-west doorway, standing open: hinged on the east jamb and swung 80 deg out of the tower, the empty ' +
            'iron bar brackets on both jambs. (Legacy clips barred / unbar keep the timber bar.) 1.0 x 0.2 x 2.3 m.',
      voxel: {
        version: 1,
        cellM: 0.05,
        size: [SX, SY, SZ],
        anchor: [10, 0, 0],                         // front (inside) face, centre, floor: the level point
        mats: MATS,
        layers: layers,
        parts: {
          frameW: { box: [0, 0, 16, 3, 2, 24], pivot: [1.5, 1, 16] },
          frameE: { box: [17, 0, 16, 20, 2, 24], pivot: [18.5, 1, 16] },
          bar:    { box: [3, 0, 18, 17, 2, 22], pivot: [10, 1, 20] },
          leaf:   { box: [0, 2, 0, 20, 4, 46], pivot: [20, 4, 0] }       // hinge: east edge, leaf back (outer) face
        },
        animations: {
          barred: { durations: [1000], loop: true, frames: [{}] },
          unbar: { durations: [90, 110, 160, 240], loop: false, events: { thud: 3 }, frames: [
            {},
            { bar: { pos: [0, 0, 1.5] } },                                  // the sword bites: bar lifts in its brackets
            { bar: { pos: [0, 2, -8], rot: [0, 0, 4] }, leaf: { rot: [0, 0, -15] } },
            { bar: BAR_DOWN, leaf: { rot: [0, 0, OPEN_YAW] } }
          ] },
          open: { durations: [1000], loop: true, frames: [{ bar: BAR_STOWED, leaf: { rot: [0, 0, OPEN_YAW] } }] }
        },
        mounts: { prompt: { at: [10, 0, 20], part: 'bar' } }              // = the door.unbar aim point (z + 1.0)
      },
      clipFor: { barred: 'barred', unbarring: 'unbar', open: 'open' },
      readability: { note: 'At 3 m on 400x150 ~10 x 22 cells: brown plank stripes with two dark iron bands; the darker bar ' +
                     'across at hip height with iron blocks at both ends reads as "barred". Open: dark gap + daylight.' }
    };
  })();

  // ===================================================================================================================
  // 7. ATTACH: only once the materials / colours are merged (a missing v2 record would switch the GPU path off).
  // ===================================================================================================================
  A.voxelModels.attachM3 = function attachM3() {
    var P = A.palette, DP = A.detailPass, done = [], k, ok, n, keys, a;
    if (!P) return done;
    A.models = A.models || {};
    if (DP) {
      ok = true;
      for (k in PELL_MATS) if (!P.materials[PELL_MATS[k]] || !DP.materials[PELL_MATS[k]]) ok = false;
      if (ok && !A.models.practiceTarget) { A.models.practiceTarget = A.voxelModels.practiceTarget; done.push('practiceTarget'); }
      ok = true;
      for (k in AWK_MATS) if (!P.materials[AWK_MATS[k]] || !DP.materials[AWK_MATS[k]]) ok = false;
      for (a = 0; a < 2; a++) {   // 6c note pages: linen_light / canvas_light / linen_dark / iron_dark
        var nk = a ? 'notePinned' : 'note', nm = A.voxelModels[nk].voxel.mats, nok = true;
        for (k in nm) if (!P.materials[nm[k]] || !DP.materials[nm[k]]) nok = false;
        if (nok && !A.models[nk]) { A.models[nk] = A.voxelModels[nk]; done.push(nk); }
      }
      var dm = A.voxelModels.doorBar.voxel.mats, dok = true;   // 6d CH1-D1a barred door
      for (k in dm) if (!P.materials[dm[k]] || !DP.materials[dm[k]]) dok = false;
      if (dok && !A.models.doorBar) { A.models.doorBar = A.voxelModels.doorBar; done.push('doorBar'); }
      for (a = 0; a < AWK_KEYS.length; a++) {
        if (ok && !A.models[AWK_KEYS[a]]) { A.models[AWK_KEYS[a]] = A.voxelModels[AWK_KEYS[a]]; done.push(AWK_KEYS[a]); }
      }
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
