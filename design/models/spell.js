/*
 * Kestrel - THE EMBER SPELL HAND + THE FIREBALL (Sprint 6 designer pass B: HANDS-01 look, SPELL-01b view).
 * Owner: Designer. Tech: architecture.md 37.8a (hands: one def, authored LEFT, the engine mirrors the whole model with
 * a winding flip for the right hand) + 37.14 (fireball sim / view, castOffset, light + particle names).
 * Formats: 15.1 (VoxelModelDef), README 4 (sprites), README 7.4 (view models), README 8 (particles), README 14.
 * Preview: design/preview/fireball.html.
 *
 * Look (owner taste: chunky ASCII, Build / Blood sprite fire like the burner): a dark leather spell GLOVE with a
 * bronze-rimmed bracer laced with rope, palm up and cupped, a bronze focus plate in the palm, fingertips charred black
 * from casting, and an EMBER COAL resting in the cup - emissive voxels (white-hot `@ #` heart, orange `* %` skin, two
 * flame tongues). The coal is voxels, not a sprite, because it sits ~0.5 m from the eye (sprites nearer than 0.6 m
 * are culled, 37.14) and the view-model layer has no part clips: its life comes from the `spellEmber` light that
 * flickers on the glove, swells over the charge and dips when the ball leaves. The fireball in flight is a sprite ball
 * of rolling tongues + a particle trail + a moving warm light; the burst is a Build-style blast sprite + embers + smoke
 * + cinders + a flash.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.spellHandL   the glove, authored LEFT (thumb on +x), pivot = wrist. Mounts ember (= cast) / palm / wrist.
 *   ASSETS.viewModels.spellHand     README 7.4 def, hand 'left': clips idle / charge / chargeHold / cast / castHard /
 *                                   fizzle / raise / lower; castOffset (= spellConfig castOffset), glow rules,
 *                                   carriedLight, chargeReady glint. ONE def: the engine mirrors it (37.8a setHand).
 *   ASSETS.spellSprites             emissive billboards fireballCore (9x6, half 5x3), fireballCoreCharged (13x8, half 7x4),
 *                                   fireballBlast (17x9, half 9x5), fireballBlastCharged (same art, x1.5 world).
 *   ASSETS.spellFx                  SPELL-01b view rules (core / trail / light / burst / flash / kick / cap / scorch idea),
 *                                   particle presets fireTrail / fireballBurst / fireballSmoke / fireballCinders /
 *                                   handSparks (README 8), attach(), validate(palette), util (pose math, mirror).
 *   palette.js (appended): lights fireballLight, fireballLightBig, fireballFlash, fireballFlashBig, spellEmber;
 *                          materials ember_core, ember_glow (+ detail-pass.js v2 records + remap).
 *
 * LOADING (classic script, no import/export): after palette.js, detail-pass.js and models/particles.js.
 *   game/index.html: <script src="../design/models/spell.js"></script>
 *   main.js boot: ASSETS.spellFx.attach() BEFORE the particle defineEmitter loop (copies the presets into
 *   ASSETS.particles.presets and the sprites into ASSETS.models, like ASSETS.boarFx.attach()).
 *   vm.load('spellHand', ASSETS.viewModels.spellHand, gameVoxelPool) with ASSETS.voxelModels.spellHandL in the pool.
 *
 * AXES (15.1): x = east, y = SOUTH (y0 = the model's front row), z = up. The glove is authored "arm along +z":
 * z0 = sleeve end, z22 = middle fingertip; y0 = BACK of the hand, palm face = +y. A view pose rx ~80 tips the fingers
 * forward and turns the palm UP.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};
  A.viewModels = A.viewModels || {};

  var BUILD_ERRORS = [];

  // ===================================================================================================================
  // 1. THE GLOVE + COAL (voxels). cellM 0.02, 7 x 7 x 23 = 0.14 x 0.14 x 0.46 m. Anchor / pivot = wrist [3, 1, 11].
  //    z0-1   sleeve cuff (linen_dark)                    z2 / z9  bronze bracer rims (lit top row bronze_light)
  //    z3-8   leather bracer, rope lacing zig-zag on top, 4 bronze studs on the top edges
  //    z10-11 wrist                                       z12-16 palm (+ thumb pad on +x), bronze focus plate in a ring
  //    z17    knuckles; fingers x1 pinky .. x4 index, straight then curled UP (+y) into a cup; tips charred
  //    thumb  x5 -> x6, forward and up, charred tip
  //    COAL   resting in the cup over z15-18: a 2x2x2 white-hot heart (ember_core) in a rounded 4x4x4 skin
  //           (ember_glow, corners + edges cut), two flame tongues on top. Centre [3, 4, 17] = mount `ember`.
  // ===================================================================================================================
  var CELL = 0.02, SX = 7, SY = 7, SZ = 23;
  var HAND_MATS = { h: 'leather', Z: 'bronze_light', z: 'bronze', d: 'linen_dark', r: 'rope', k: 'canvas_burnt',
                    E: 'ember_core', e: 'ember_glow' };
  var ANCHOR = [3, 1, 11];

  function buildHandGrid() {
    var g = [], x, y, z;
    for (z = 0; z < SZ; z++) { g.push([]); for (y = 0; y < SY; y++) g[z].push('.......'.split('')); }
    function put(px, py, pz, ch) { g[pz][py][px] = ch; }
    // forearm x1..4, y0..2
    for (z = 0; z <= 9; z++) for (y = 0; y <= 2; y++) for (x = 1; x <= 4; x++) {
      var ch = 'h';
      if (z <= 1) ch = 'd';
      else if (z === 2 || z === 9) ch = (y === 2) ? 'Z' : 'z';
      put(x, y, z, ch);
    }
    put(1, 2, 4, 'Z'); put(4, 2, 4, 'Z'); put(1, 2, 7, 'Z'); put(4, 2, 7, 'Z');        // studs
    put(2, 2, 3, 'r'); put(3, 2, 4, 'r'); put(2, 2, 5, 'r'); put(3, 2, 6, 'r'); put(2, 2, 7, 'r'); put(3, 2, 8, 'r'); // lacing
    // wrist
    for (z = 10; z <= 11; z++) for (y = 0; y <= 1; y++) for (x = 1; x <= 4; x++) put(x, y, z, 'h');
    // palm: back y0, face y1 with the focus plate (bronze_light) in a bronze ring
    for (z = 12; z <= 16; z++) for (x = 1; x <= 4; x++) { put(x, 0, z, 'h'); put(x, 1, z, 'h'); }
    put(2, 1, 12, 'z'); put(3, 1, 12, 'z'); put(2, 1, 15, 'z'); put(3, 1, 15, 'z');
    put(1, 1, 13, 'z'); put(1, 1, 14, 'z'); put(4, 1, 13, 'z'); put(4, 1, 14, 'z');
    for (z = 13; z <= 14; z++) for (x = 2; x <= 3; x++) put(x, 1, z, 'Z');
    // thumb (+x side for the LEFT hand, palm up)
    for (z = 12; z <= 14; z++) { put(5, 0, z, 'h'); put(5, 1, z, 'h'); }
    put(5, 1, 15, 'h'); put(6, 1, 16, 'h'); put(6, 2, 17, 'h'); put(6, 2, 18, 'k');
    // knuckles
    for (x = 1; x <= 4; x++) { put(x, 0, 17, 'h'); put(x, 1, 17, 'h'); }
    // fingers: [x, last straight z, curl z (y1..2), tip z (y2)]
    [[1, 18, 19, 20], [2, 19, 20, 21], [3, 20, 21, 22], [4, 19, 20, 21]].forEach(function (f) {
      for (z = 18; z <= f[1]; z++) { put(f[0], 0, z, 'h'); put(f[0], 1, z, 'h'); }
      put(f[0], 1, f[2], 'h'); put(f[0], 2, f[2], 'h');
      put(f[0], 2, f[3], 'k');
    });
    // the coal: x1..4, y2..5, z15..18 (rounded), heart x2..3 / y3..4 / z16..17
    for (z = 15; z <= 18; z++) for (y = 2; y <= 5; y++) for (x = 1; x <= 4; x++) {
      var core = x >= 2 && x <= 3 && y >= 3 && y <= 4 && z >= 16 && z <= 17;
      var edges = (x === 1 || x === 4 ? 1 : 0) + (y === 2 || y === 5 ? 1 : 0) + (z === 15 || z === 18 ? 1 : 0);
      if (core) put(x, y, z, 'E'); else if (edges <= 1) put(x, y, z, 'e');
    }
    put(2, 6, 17, 'e'); put(3, 6, 16, 'e');                                            // flame tongues
    return g.map(function (L) { return L.map(function (r) { return r.join(''); }); });
  }

  A.voxelModels.spellHandL = {
    name: 'spellHandL',
    desc: 'The ember spell glove (view model, authored LEFT; the engine mirrors it for the right hand, 37.8a): dark ' +
          'leather, bronze-rimmed bracer laced with rope, palm up and cupped, bronze focus plate, charred fingertips, ' +
          'an emissive ember coal resting in the cup. Pivot = wrist centre.',
    voxel: {
      version: 1,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: ANCHOR.slice(),
      mats: HAND_MATS,
      layers: buildHandGrid(),
      parts: { hand: { box: [0, 0, 0, SX, SY, SZ], pivot: ANCHOR.slice() } },
      animations: { held: { durations: [1000], loop: true, frames: [{}] } },
      mounts: {
        ember: { at: [3, 4, 17], part: 'hand' },   // the coal centre: carried light + fireball origin (= castOffset)
        cast:  { at: [3, 4, 17], part: 'hand' },   // alias of ember (37.14 names the cast point)
        palm:  { at: [3, 2, 14], part: 'hand' },   // focus plate face
        wrist: { at: [3, 1, 11], part: 'hand' }
      }
    }
  };

  // ===================================================================================================================
  // 2. VIEW MODEL (README 7.4: eye space x right, y BACK (forward = -y), z up, metres; R = Rz * Ry * Rx, degrees).
  //    LEFT hand authored (hand: 'left'); the engine mirrors pose + geometry for the right hand (37.8a), never twice.
  //    The glove rises from the bottom-left edge, palm up, fingers forward and a little inward (rz +10), palm rolled
  //    8 deg toward the centre (ry +8). The wrist is below the screen edge; the coal sits in the lower-left third:
  //    at rest the ember mount is (-0.220, fwd 0.500, down 0.135) = castOffset.
  //    37.14 proposed castOffset (0.25, 0.45, 0.30): 0.30 down at 0.45 forward is 34 deg below the view centre, but the
  //    16:9 / 75 deg HFOV view only reaches 23.3 deg down, so the coal (and the fireball's start) would be off-screen.
  //    -> spellConfig castOffset = { right 0.22, fwd 0.50, down 0.135 } (the 37.14 data test then matches exactly).
  //    Timing (60 Hz steps): tap = release on the step the button goes up (castTick); the clip's flick peaks at 83 ms.
  // ===================================================================================================================
  function k(t, pos, rot) { return { t: t, pos: pos, rot: rot }; }
  var REST = { pos: [-0.25, -0.396, -0.214], rot: [80, 8, 10] };
  var CHARGE_END = { pos: [-0.19, -0.411, -0.169], rot: [81, 15, 17] };
  var LOW = { pos: [-0.27, -0.30, -0.57], rot: [100, 8, 10] };

  A.viewModels.spellHand = {
    model: 'spellHandL',
    hand: 'left',
    space: 'eye: x right, y back (forward = -y), z up, metres; yaw-0 / pitch-0 camera frame at the eye',
    rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot)',
    projection: 'same as the scene; drawn in the view-model depth range after the scene (TORCH-01a handle, 37.8a mirror)',
    depth: { near: 0.05, far: 1.5 },
    rest: REST,
    clips: {
      // ember-bearer's breath: 2.0 s (sword 2.2, torch 2.6: hands never sway in step); fingers tip 1.5 deg forward
      idle: { loop: true, keys: [
        k(0, REST.pos, REST.rot),
        k(1000, [-0.248, -0.398, -0.206], [81.5, 8, 9.5]),
        k(2000, REST.pos, REST.rot)
      ] },
      // HOLD (37.14: tMs = min(holdSteps, 36) * 1000/60, clamped at 600 = held). The glove draws in toward the centre
      // and lifts the coal while the spellEmber light swells (glow.charge). A tap only ever shows the first ~100 ms.
      charge: { loop: false, holdMs: 600, keys: [
        k(0, REST.pos, REST.rot),
        k(100, [-0.23, -0.396, -0.199], [78, 12, 14]),      // gather: palm turns a little toward the eye
        k(350, [-0.20, -0.406, -0.179], [80, 14, 16]),      // lifting
        k(600, CHARGE_END.pos, CHARGE_END.rot)               // held: ready (chargeReady glint)
      ] },
      // held after 600 ms until release: a straining tremble (3-4 mm, ~1 deg), 240 ms loop
      chargeHold: { loop: true, keys: [
        k(0, CHARGE_END.pos, CHARGE_END.rot),
        k(60, [-0.187, -0.411, -0.166], [81.8, 15, 17.5]),
        k(120, [-0.192, -0.412, -0.171], [80.4, 15.4, 16.6]),
        k(180, [-0.188, -0.410, -0.167], [81.5, 14.7, 17.3]),
        k(240, CHARGE_END.pos, CHARGE_END.rot)
      ] },
      // TAP (37.14: tMs = steps since castTick, <= 167 ms shown as the flick, then the settle): the release already
      // happened at castTick, so key 0 is the thrust start; flick peak at 83, follow-through dip, settle by 333.
      // Blend from the captured pose (key 0 replaced) so a tap out of `charge` stays continuous.
      cast: { loop: false, castAtMs: 0, active: [0, 167], recover: [167, 333], keys: [
        k(0, [-0.26, -0.391, -0.199], [76, 10, 14]),        // the gathered pose (replaced by the captured one when blending)
        k(83, [-0.22, -0.466, -0.174], [92, 4, 6]),         // flick: thrust forward, fingers level
        k(167, [-0.20, -0.506, -0.194], [104, 0, 2]),       // follow-through: fingers dip past level
        k(250, [-0.24, -0.436, -0.209], [86, 6, 8]),        // settle back
        k(333, REST.pos, REST.rot)
      ] },
      // HARD (released after the 0.6 s charge): key 0 = the charge end pose (blend), a full shove, the blast KICKS the
      // glove up and back, slow return.
      castHard: { loop: false, castAtMs: 0, active: [0, 133], recover: [133, 600], keys: [
        k(0, CHARGE_END.pos, CHARGE_END.rot),
        k(67, [-0.17, -0.516, -0.154], [96, 4, 4]),         // full shove
        k(133, [-0.20, -0.456, -0.124], [70, 6, 10]),       // recoil: kicked up + back
        k(300, [-0.22, -0.436, -0.184], [80, 8, 10]),
        k(600, REST.pos, REST.rot)
      ] },
      // not enough MP (the existing mana-short flash): the glove shakes, the coal light sputters (glow.fizzle)
      fizzle: { loop: false, keys: [
        k(0, REST.pos, REST.rot),
        k(60, [-0.254, -0.394, -0.216], [79, 8, 12.5]),
        k(120, [-0.246, -0.398, -0.211], [81, 8, 7.5]),
        k(180, [-0.252, -0.395, -0.215], [79.5, 8, 11]),
        k(250, REST.pos, REST.rot)
      ] },
      // equip (300 ms, up from below the screen edge, a 2-deg overshoot) / unequip (250 ms)
      raise: { loop: false, keys: [
        k(0, LOW.pos, LOW.rot),
        k(200, [-0.25, -0.406, -0.194], [78, 8, 9]),
        k(300, REST.pos, REST.rot)
      ] },
      lower: { loop: false, keys: [
        k(0, REST.pos, REST.rot),
        k(250, LOW.pos, LOW.rot)
      ] }
    },
    bob: { note: 'engine-side walk bob (same rule as the sword / torch, phase shared); authored for the LEFT hand (x / ' +
                 'roll signed like the BUG-VM-001 left sword), the engine mirror flips them for the right hand. ' +
                 'x0.3 while charge / chargeHold.',
           z: 0.012, x: -0.006, rollDeg: -1.0, chargeMul: 0.3 },
    // 37.14 castOffset (eye frame, metres, magnitude; the hand gives the sign of `right`: left = negative)
    // = the ember mount at REST (validate() checks it within 5 mm).
    castOffset: { right: 0.22, fwd: 0.50, down: 0.135 },
    castMount: 'cast',
    // the coal's light: components.light {preset 'spellEmber', attach 'eye', offset = the ember mount at rest (the
    // right sign mirrors with the hand)}. One carried light per player (37.8): if another one exists (torch, later),
    // skip this one. Intensity is scaled per state by `glow` (setParams intensity only, never the radius).
    carriedLight: { preset: 'spellEmber', mount: 'ember', offset: { right: -0.22, fwd: 0.50, down: 0.135 }, sway: { amp: 0.01 } },
    glow: {
      note: 'multiplier on the spellEmber preset intensity, per view state (presentation only)',
      idle: { mul: 1.0 },
      charge: { from: 1.0, to: 2.2, over: 'tMs 0..600 linear' },
      chargeHold: { mul: 2.2, pulse: { amp: 0.25, hz: 4 } },
      cast: { keys: [[0, 0.3], [120, 0.6], [250, 1.0]], note: '[tMs, mul] linear: the ball took the fire with it' },
      castHard: { keys: [[0, 0.15], [200, 0.5], [400, 1.0]] },
      fizzle: { keys: [[0, 1.0], [60, 0.4], [120, 1.1], [180, 0.5], [250, 1.0]], note: 'sputter' }
    },
    // "the hard cast is ready": once, when holdSteps reaches 36 AND mana >= 10, at the ember mount projected to its
    // screen cell (like the sword's chargeGlint; overlay.bar 1 cell if no glyph-grid primitive). 30 + 35 + 35 ms.
    chargeReady: { mount: 'ember', durations: [30, 35, 35],
                   frames: [{ glyphs: ['+'], fg: ['m'] }, { glyphs: ['*'], fg: ['W'] }, { glyphs: ["'"], fg: ['f'] }],
                   keys: { W: { c: 'white', e: true }, m: { c: 'flameCore', e: true }, f: { c: 'flameMid', e: true } },
                   anchor: { x: 0, y: 0 } },
    // optional life: sim-side sparks off the coal at eye + castOffset (like the torch embers, 37.8: never from the
    // render pose). Idle 1 burst of 1 every 14 steps; charge every 4; at castTick 1 burst of 6 along the aim.
    sparks: { preset: 'handSparks', idleEvery: 14, chargeEvery: 4, castN: 6 }
  };

  // ===================================================================================================================
  // 3. SPRITES (README 4). Colours come from the GLYPH through a paint map (like wreckage.js burnerFire), so glyph and
  //    key rows can never drift: @ W M 8 = flameCore, # % & = flameMid, * ( ) { } / \ - = flameOuter, ^ ' , . ` | =
  //    flameTip, = flameMid, o O ~ = smoke (lit ashDark, glyph-only), + = emberHot. Fire keys e: true.
  // ===================================================================================================================
  var FIRE_KEYS = {
    '1': { c: 'flameTip', e: true }, '2': { c: 'flameOuter', e: true }, '3': { c: 'flameMid', e: true },
    '4': { c: 'flameCore', e: true }, E: { c: 'emberHot', e: true }, s: { c: 'ashDark', fill: false }
  };
  var PAINT = {
    '@': '4', W: '4', M: '4', '8': '4',
    '#': '3', '%': '3', '&': '3', '=': '3',
    '*': '2', '(': '2', ')': '2', '{': '2', '}': '2', '/': '2', '\\': '2', '-': '2',
    '^': '1', "'": '1', ',': '1', '.': '1', '`': '1', '|': '1',
    o: 's', O: 's', '~': 's', '+': 'E', other: '2'
  };
  var HOT = { '|': '4', '/': '3', '\\': '3', '-': '3', '=': '4', "'": '3', '.': '2' };   // blast frame 0: white-hot rays
  function pad(r, w) { while (r.length < w) r += ' '; return r; }
  function fix(name, rows, w, h) {
    if (rows.length > h) BUILD_ERRORS.push(name + ': ' + rows.length + ' rows > ' + h);
    var o = [], i;
    for (i = 0; i < h; i++) {
      var r = rows[i] || '';
      if (r.length > w) BUILD_ERRORS.push(name + ' row ' + i + ': ' + r.length + ' chars > ' + w + ' ("' + r + '")');
      o.push(pad(r, w).slice(0, w));
    }
    return o;
  }
  function paint(g, over) {
    return g.map(function (row) {
      var o = '', c, ch;
      for (c = 0; c < row.length; c++) {
        ch = row.charAt(c);
        o += ch === ' ' ? ' ' : ((over && over[ch]) || PAINT[ch] || PAINT.other);
      }
      return o;
    });
  }
  function frames(name, list, w, h, over) {
    return list.map(function (rows, i) {
      var g = fix(name + ' f' + i, rows, w, h);
      return { S: { glyphs: g, fg: paint(g, over && over[i]) } };
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- fireballCore 9x6 (0.36 m ball, AC ~0.35 m), anchor = centre cell (4, 3) at the sim position ---------------
  var FB = [
    ["  ' ^ .", ' (*#^#*)', '(#%@W@%#)', '{*@WMW@*}', ' (#%@%#)', '  ,*%*.'],
    [" .  ^  '", '^(*#%#*)', '(#%@W@#*)', '{*@WMW@%}', ' (*#@#%)^', "  '*%*"],
    ["  .^  '", ' (*%#%*)^', '(*#@W@%#)', '{%@WMW@*}', '^(#%@#*)', "   .*%'"],
    [" '  ^ .", ' (*#^%*)', '(#*@W@#%)', '{*@W8W@*}', ' (%#@#*)', '  .*#*,']
  ];
  var FB_HALF = [
    [' (^)', '(@W@)', " '*'"],
    ['^(*)', '(@W@)', ' (*)^'],
    [' (*)^', '(@M@)', '^(*)'],
    [" '^'", '(#W#)', ' (*)']
  ];
  var fireballCore = {
    name: 'fireballCore',
    desc: 'SPELL-01b: the tap fireball in flight - a white-hot core inside rolling orange tongues ({ } curls, ragged red ' +
          'tips). 4 frames rotate the tongues so it reads as a tumbling ball of fire from any side. All emissive.',
    size: { w: 9, h: 6 }, anchor: { x: 4, y: 3 }, world: { w: 0.36, h: 0.36 },
    directions: ['S'], billboard: true, keys: FIRE_KEYS,
    animations: { fly: { fps: 12, loop: true, frames: frames('fireballCore', FB, 9, 6) } },
    lods: { half: { size: { w: 5, h: 3 }, anchor: { x: 2, y: 1 },
                    animations: { fly: { fps: 12, loop: true, frames: frames('fireballCore.half', FB_HALF, 5, 3) } } } }
  };

  // ---- fireballCoreCharged 13x8 (0.52 m), anchor (6, 4) --------------------------------------------------------
  var FBC = [
    ["  .  ^ ^  '", " '  (*^*)  .", '  (*#%@%#*)', ' (*%@WWW@%*)', '{*#@WMWMW@#*}', ' (*%@WWW@%*)', '  (*#%@%#*)', "  ' .*#*. '"],
    [" '   ^   ^ .", '^  (*^#^*)', '  (*%#@#%*) ^', ' (*#@WWW@#*)', '{%#@WM8MW@#%}', ' (*%@WWW@%*)', '^ (*#%@%#*)', "   '.*%*,'"],
    ['   ^  .  ^', " . (*^*^*) '", '  (*#%@%#*)', '^(*%@WWW@%*)', '{*#@WMWMW@#*}', ' (*#@WWW@#*)^', '  (*%#@#%*)', "  , '*#*' ."],
    ["  '  ^ . ^", '   (*^%^*) .', '^ (*#%@%#*)', ' (*%@WWW@%*)', '{%#@W8M8W@#%}', ' (*#@WWW@#*)', '  (*#%@%#*) ^', "   .'*#*'."]
  ];
  var FBC_HALF = [
    ['  ^ ^', ' (*#*)', '(#@W@#)', " '*%*'"],
    [' ^   .', '^(*#*)', '(#@M@#)', ' (*%*)^'],
    [" . ^ '", ' (*%*)^', '(%@W@#)', "^'*#*'"],
    ["  '^", ' (*#*)', '(#@8@#)', " '*%*."]
  ];
  var fireballCoreCharged = {
    name: 'fireballCoreCharged',
    desc: 'SPELL-01b: the charged fireball (hold >= 0.6 s) - bigger, a wide white core, more tongues and loose sparks.',
    size: { w: 13, h: 8 }, anchor: { x: 6, y: 4 }, world: { w: 0.52, h: 0.48 },
    directions: ['S'], billboard: true, keys: FIRE_KEYS,
    animations: { fly: { fps: 12, loop: true, frames: frames('fireballCoreCharged', FBC, 13, 8) } },
    lods: { half: { size: { w: 7, h: 4 }, anchor: { x: 3, y: 2 },
                    animations: { fly: { fps: 12, loop: true, frames: frames('fireballCoreCharged.half', FBC_HALF, 7, 4) } } } }
  };

  // ---- fireballBlast 17x9 (1.6 x 1.27 m), anchor = centre (8, 4) at the burst point -----------------------------
  //      f0 white-hot star (40 ms) - f1 the fireball swells (40) - f2 a ring tears open, hollow core (50) -
  //      f3 tongues break up, smoke puffs (60) - f4 smoke + falling embers (70) = 260 ms, then the particles carry on.
  var BL = [
    ['', "        '", '     \\  |  /', '      (#@#)', '   -=(@WMW@)=-', '      (#@#)', '     /  |  \\', '        .', ''],
    ["       . ^ '", "    ' (*^#^*) .", '   (*#%@W@%#*)', '  (*%@WWMWW@%*)', ' {*#@WM8W8MW@#*}', '  (*%@WWMWW@%*)', '   (*#%@W@%#*)', "    , (*#*) '", "       '   ."],
    ["   '  ^  ^ ^  .", " .  (*^#%#^*)  '", "  (*#%*' '*%#*)", " (*%#'     '#%*)", '{*#%(   @   )%#*}', ' (*%#.     .#%*)', '  (*#%*. .*%#*)', " '  (*^#%#^*)  .", "   .   '  ^   '"],
    ["  o  ^   '  O  .", '   O (*^ ^*) o', " ' (*#'   '#*) '", " (*%'       '%*)", '{*#.    .    .#*}', ' (*%,       ,%*)', ' o (*#.   .#*) O', '   O (*^ ^*) o', "  .   o   '   o"],
    ['    o   O   o', '  O   o   O   o', "    '  O  .  O", " o   .     '   o", "   '    *    .", ' o   .     ,   o', "    .  o  '  .", "  '    .    '", '']
  ];
  var BL_HALF = [
    ['', '  \\ | /', '-=(@W@)=-', '  / | \\', ''],
    ["  .(^) '", ' (*#@#*)', '{*@WMW@*}', ' (*#@#*)', "  '(*)'"],
    [" '(*^*)'", "(*#' '#*)", '{#(   )#}', '(*#. .#*)', ' .(*^*).'],
    [" o ^ ' O", "O(*' '*)o", '{.  .  .}', 'o(*. .*)O', " . o ' ."],
    [' o  O  o', "O  '  . o", '  . * .', "o  ,  ' O", '  . o .']
  ];
  function blastAnim(n, list, w, h) {
    return { durations: [40, 40, 50, 60, 70], loop: false, frames: frames(n, list, w, h, [HOT]) };
  }
  var fireballBlast = {
    name: 'fireballBlast',
    desc: 'SPELL-01b: the Build-style fireball burst body (sprite, not particles): white-hot star -> swelling ball -> ' +
          'torn ring with a hollow core -> breaking tongues + smoke puffs -> smoke and falling embers (260 ms). Fire ' +
          'cells emissive; the smoke puffs (o O) are lit ashDark, glyph-only.',
    size: { w: 17, h: 9 }, anchor: { x: 8, y: 4 }, world: { w: 1.6, h: 1.27 },
    directions: ['S'], billboard: true, keys: FIRE_KEYS,
    animations: { burst: blastAnim('fireballBlast', BL, 17, 9) },
    lods: { half: { size: { w: 9, h: 5 }, anchor: { x: 4, y: 2 }, animations: { burst: blastAnim('fireballBlast.half', BL_HALF, 9, 5) } } }
  };
  var fireballBlastCharged = clone(fireballBlast);
  fireballBlastCharged.name = 'fireballBlastCharged';
  fireballBlastCharged.desc = 'SPELL-01b: the charged burst = fireballBlast art at 1.5x world size (radius 3 m blast).';
  fireballBlastCharged.world = { w: 2.4, h: 1.9 };

  A.spellSprites = {
    fireballCore: fireballCore, fireballCoreCharged: fireballCoreCharged,
    fireballBlast: fireballBlast, fireballBlastCharged: fireballBlastCharged
  };

  // ===================================================================================================================
  // 4. PARTICLE PRESETS (README 8 EmitterDef, colours = palette keys). Sim side (hashed, 37.14 stepFx): never from
  //    the render pose. 5 new defs (engine cap 32).
  // ===================================================================================================================
  var PRESETS = {
    // trail (37.14: burstAt(fireTrail, x, y, z, 1, -dir) every 2nd step per ball = 30/s). Each spark lives 0.25-0.45 s,
    // leaves backwards at 0.4-1.2 m/s in a 35 deg cone, drag 2.5 stops it, heat lifts it (accelZ 0.8): a ~4-5 m comet
    // tail behind a 16 m/s ball, `# * + : ' .` cooling white-yellow -> red.
    fireTrail: {
      rate: 30, burst: 1,     // rate only used by a persistent emitter (see spellFx.trail note); burstAt ignores it
      life: [0.25, 0.45], speed: [0.4, 1.2],
      dir: [0, 0, 1], spreadDeg: 35, box: [0.06, 0.06, 0.06],
      accelZ: 0.8, drag: 2.5, wind: 0.3,
      maxLive: 64, killBelow: null,
      glyphs:  "#**++:'.",
      colors: ['flameCore', 'flameMid', 'flameMid', 'flameOuter', 'flameOuter', 'flameTip', 'ember', 'emberDark'],
      emissive: true, emissiveFog: 0.15, sizeM: 0.08
    },
    // burst embers: n 20 (charged 28) along the hit normal in a wide 80 deg cone, 3-6.5 m/s, arcing down, dying 1 m
    // under the burst. Starts white like the sword sparks.
    fireballBurst: {
      rate: 0, burst: 20,
      life: [0.35, 0.7], speed: [3.0, 6.5],
      dir: [0, 0, 1], spreadDeg: 80, box: [0.08, 0.08, 0.08],
      accelZ: -6.0, drag: 1.6, wind: 0.2,
      maxLive: 64, killBelow: 1.0,
      glyphs:  "@#**++''..",
      colors: ['white', 'flameCore', 'flameMid', 'flameMid', 'flameOuter', 'flameOuter', 'ember', 'ember', 'emberDim', 'emberDark'],
      emissive: true, emissiveFog: 0.1, sizeM: 0.07
    },
    // burst smoke: n 8 (charged 12) dark puffs rolling up out of the blast, lit (<= 35 % keys), 1.2-2 s
    fireballSmoke: {
      rate: 0, burst: 8,
      life: [1.2, 2.0], speed: [0.6, 1.4],
      dir: [0, 0, 1], spreadDeg: 60, box: [0.25, 0.25, 0.15],
      accelZ: 0.7, drag: 1.4, wind: 1,
      maxLive: 32, killBelow: null,
      glyphs:  "O@Oo%;:~'.",
      colors: ['ashDark', 'ashDark', 'ashDark', 'ironDark', 'ironDark', 'mortar', 'mortar', 'cinder', 'scorch', 'scorch'],
      emissive: false, emissiveFog: 0, sizeM: 0.3
    },
    // the cheap "scorch": n 6 (charged 10) cinders that skid 0.1-0.3 m over the ground and smoulder 1.2-2.2 s.
    // Only for ground hits (hit normal z >= 0.7), burstAt z = ground + 0.03.
    fireballCinders: {
      rate: 0, burst: 6,
      life: [1.2, 2.2], speed: [0.2, 0.6],
      dir: [0, 0, 1], spreadDeg: 85, box: [0.3, 0.3, 0.01],
      accelZ: -0.3, drag: 4.0, wind: 0,
      maxLive: 24, killBelow: 0.03,
      glyphs:  "*+o+'.,.",
      colors: ['emberHot', 'flameMid', 'ember', 'ember', 'emberDim', 'emberDim', 'emberDark', 'emberDark'],
      emissive: true, emissiveFog: 0.1, sizeM: 0.05
    },
    // OPTIONAL: sparks lifting off the coal in the hand (spellHand.sparks), small and short so they never cloud the view
    handSparks: {
      rate: 0, burst: 1,
      life: [0.3, 0.6], speed: [0.15, 0.45],
      dir: [0, 0, 1], spreadDeg: 30, box: [0.02, 0.02, 0.02],
      accelZ: 0.6, drag: 1.5, wind: 0.3,
      maxLive: 12, killBelow: null,
      glyphs:  "*+'.",
      colors: ['flameCore', 'flameMid', 'flameOuter', 'emberDim'],
      emissive: true, emissiveFog: 0.05, sizeM: 0.02
    }
  };

  // ===================================================================================================================
  // 5. VIEW RULES for SPELL-01b (fireballView.js reads these; gameplay numbers stay in spellConfig.js FIREBALL_CFG)
  // ===================================================================================================================
  A.spellFx = {
    version: 1,
    story: 'HANDS-01 (spellHand look) / SPELL-01b (fireball view); architecture.md 37.8a + 37.14',
    core: {
      tap:     { model: 'fireballCore', anim: 'fly', fps: 12 },
      charged: { model: 'fireballCoreCharged', anim: 'fly', fps: 12 },
      frameRule: 'frame = (floor(simTime * 12) + slot * 3) mod 4: two balls never flicker in step',
      note: 'spawns at castOffset (~0.5 m): the 0.6 m sprite cull hides it for at most 1 frame (16 m/s = 0.27 m/step); accepted (37.14)'
    },
    trail: {
      tap:     [{ preset: 'fireTrail', everySteps: 2, n: 1 }],
      charged: [{ preset: 'fireTrail', everySteps: 2, n: 2, note: 'charged: 2 sparks per burst = 60/s, a denser tail, same emitter count' }],
      rule: '37.14 stepFx: burstAt(fireTrail, x, y, z, n, -dx, -dy, -dz) per alive ball (sim side). NOTE for the ' +
            'architect: every burstAt holds one of the 64 emitter slots until its sparks die (0.45 s): 4 balls x 30/s x ' +
            '0.45 s = 54 transient slots, close to MAX_EMITTERS 64 next to the burner / boar emitters. If stats.dropped ' +
            'rises, use one persistent emitter per ball slot instead (createEmitter at bind, rate 30, setOn while alive, ' +
            'setEmitterPos + setEmitterDir per step) - same look, 4 slots'
    },
    light: {
      tap: 'fireballLight', charged: 'fireballLightBig',
      rule: '37.14 bindLights: 4 flight lights bound at the preset radius, on while the slot is alive, move(x, y, z) per frame. ' +
            'One radius per bound light (never change it per frame): bind with fireballLightBig\'s radius (5) and drive the ' +
            'tap / charged difference with setParams intensity (tap 0.9, charged 1.1); or keep both at 4 m (fireballLight) - ' +
            'designer preference: radius 5 for all four, the tap ball is then a little wider than 37.14\'s 4 m'
    },
    burst: {
      sprite: { tap: 'fireballBlast', charged: 'fireballBlastCharged', anim: 'burst',
                rule: 'view-only, pushed per rendered frame through the extra(pool) callback for 260 ms (frame by elapsed ms ' +
                      'since the burst tick), anchor = centre. The sim already pulls a wall burst 0.1 m out; push the sprite ' +
                      'a further 0.25 m toward the player so it is not half inside the wall' },
      particles: [
        { preset: 'fireballBurst', n: 20, nCharged: 28, dir: 'hit normal (-dir for an air burst or a target hit)' },
        { preset: 'fireballSmoke', n: 8, nCharged: 12, dir: 'up' },
        { preset: 'fireballCinders', n: 6, nCharged: 10, onlyIf: 'ground hit (normal z >= 0.7)', at: 'ground + 0.03' }
      ],
      flash: { tap: 'fireballFlash', charged: 'fireballFlashBig', steps: 9,
               envelope: '37.14: intensity = base * (1 - age/9). Designer wish (same cost): base * (1 - age/9)^2, a hotter start and a softer tail',
               bind: 'bind both flash lights at fireballFlashBig radius 8 if the charged flash should reach further; else fireballFlash 6' },
      kick: { deg: 1.5, degCharged: 2.5, withinM: 6, steps: 9, note: '37.14 fireballKickDeg: render eye only' }
    },
    lightCap: { fireball: 4, flash: 2, drop: 'oldest first (37.14: by construction)' },
    scorch: {
      status: 'IDEA for DECAL-01 (not this sprint): until decals exist, fireballCinders smoulder on the ground instead',
      stamp: { glyphs: ["  .,'.,  ", " ,:%#%:, ", "  ',.'`  "], fg: ['  ccbcc  ', ' cbsSsbc ', '  ccbcc  '],
               keys: { S: 'scorch', s: 'cinder', b: 'emberDim', c: 'ashDark' }, sizeM: [1.2, 0.8],
               life: { glowMs: 1500, fadeMs: 12000, note: 'b (emberDim) emissive for glowMs, then lit; the stamp fades over fadeMs' } }
    },
    sound: { note: 'for the audio pass (not designer data): cast whoomp, flight hiss loop, burst thump + crackle, fizzle sputter' },
    particles: PRESETS,
    lightKeys: ['fireballLight', 'fireballLightBig', 'fireballFlash', 'fireballFlashBig', 'spellEmber']
  };

  // ===================================================================================================================
  // 6. ATTACH + POSE MATH + VALIDATE
  // ===================================================================================================================
  A.spellFx.attach = function attach() {
    var done = [], key;
    if (A.particles && A.particles.presets) {
      for (key in PRESETS) if (!A.particles.presets[key]) { A.particles.presets[key] = PRESETS[key]; done.push(key); }
    }
    for (key in A.spellSprites) if (!A.models[key]) { A.models[key] = A.spellSprites[key]; done.push(key); }
    return done;
  };

  function rotApply(r, v) {   // R = Rz * Ry * Rx (engine setRot order), r in degrees
    var D = Math.PI / 180, x = v[0], y = v[1], z = v[2], c, s, t;
    c = Math.cos(r[0] * D); s = Math.sin(r[0] * D); t = c * y - s * z; z = s * y + c * z; y = t;
    c = Math.cos(r[1] * D); s = Math.sin(r[1] * D); t = c * x + s * z; z = -s * x + c * z; x = t;
    c = Math.cos(r[2] * D); s = Math.sin(r[2] * D); t = c * x - s * y; y = s * x + c * y; x = t;
    return [x, y, z];
  }
  function sampleKeys(keys, t, loop) {
    var T = keys[keys.length - 1].t, i = 0, a, b, f, j, pos = [], rot = [];
    t = loop ? ((t % T) + T) % T : Math.min(Math.max(t, 0), T);
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    a = keys[i]; b = keys[i + 1]; f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    for (j = 0; j < 3; j++) { pos.push(a.pos[j] + (b.pos[j] - a.pos[j]) * f); rot.push(a.rot[j] + (b.rot[j] - a.rot[j]) * f); }
    return { pos: pos, rot: rot };
  }
  // eye-space point of a model mount for an (authored-hand) pose; mirror = 1 negates x (the engine's 37.8a S step)
  function mountEye(vmDef, pose, mount, mirror) {
    var V = A.voxelModels[vmDef.model].voxel, at = V.mounts[mount].at, an = V.anchor, cm = V.cellM;
    var q = rotApply(pose.rot, [(at[0] - an[0]) * cm, (at[1] - an[1]) * cm, (at[2] - an[2]) * cm]);
    return [(pose.pos[0] + q[0]) * (mirror ? -1 : 1), pose.pos[1] + q[1], pose.pos[2] + q[2]];
  }
  // the BUG-VM-001 design helper, for previews only (the engine mirrors at bind; never mirror data twice)
  function mx(p) { return { pos: [-p.pos[0], p.pos[1], p.pos[2]], rot: [p.rot[0], -p.rot[1], -p.rot[2]] }; }
  A.spellFx.util = { rotApply: rotApply, sampleKeys: sampleKeys, mountEye: mountEye, mx: mx };

  // [] = OK. palette = ASSETS.palette (optional for the colour / light / material checks).
  A.spellFx.validate = function validate(palette) {
    var errs = BUILD_ERRORS.slice(), rgb = palette && palette.rgb, n, m, an, f, r, c, key, i;
    // sprites
    for (n in A.spellSprites) {
      m = A.spellSprites[n];
      for (key in m.keys) if (rgb && !rgb[m.keys[key].c]) errs.push(n + ': key ' + key + ' unknown colour ' + m.keys[key].c);
      [m].concat(m.lods && m.lods.half ? [m.lods.half] : []).forEach(function (tier, ti) {
        for (an in tier.animations) {
          var A2 = tier.animations[an];
          if (A2.durations && A2.durations.length !== A2.frames.length) errs.push(n + '.' + an + ': durations/frames length');
          for (f = 0; f < A2.frames.length; f++) {
            var S = A2.frames[f].S;
            if (S.glyphs.length !== tier.size.h || S.fg.length !== tier.size.h) errs.push(n + '.' + an + ' f' + f + ' (tier ' + ti + '): row count');
            for (r = 0; r < S.glyphs.length; r++) {
              if (S.glyphs[r].length !== tier.size.w || S.fg[r].length !== tier.size.w) errs.push(n + '.' + an + ' f' + f + ' r' + r + ': width');
              for (c = 0; c < S.glyphs[r].length; c++) {
                var g = S.glyphs[r].charCodeAt(c), fk = S.fg[r].charAt(c);
                if (g < 32 || g > 126) errs.push(n + ': non-ASCII glyph');
                if ((g === 32) !== (fk === ' ')) errs.push(n + '.' + an + ' f' + f + ': glyph/fg space mismatch r' + r + ' c' + c);
                if (fk !== ' ' && !m.keys[fk]) errs.push(n + ': unknown key ' + fk);
              }
            }
          }
        }
      });
    }
    // particles
    for (key in PRESETS) {
      var p = PRESETS[key];
      if (p.glyphs.length > 16 || p.colors.length > 16) errs.push(key + ': ramp > 16');
      if (p.glyphs.length !== p.colors.length) errs.push(key + ': glyph / colour ramps differ in length');
      for (i = 0; i < p.glyphs.length; i++) { var cc = p.glyphs.charCodeAt(i); if (cc < 33 || cc > 126) errs.push(key + ': glyph outside 33..126'); }
      for (i = 0; i < p.colors.length; i++) {
        if (rgb && !rgb[p.colors[i]]) errs.push(key + ': unknown colour ' + p.colors[i]);
        if (rgb && !p.emissive && rgb[p.colors[i]] && Math.max.apply(null, rgb[p.colors[i]]) > 0.35 * 255) errs.push(key + ': lit colour ' + p.colors[i] + ' > 35 %');
      }
    }
    // lights + materials
    if (palette) {
      A.spellFx.lightKeys.forEach(function (lk) { if (!palette.lights[lk]) errs.push('palette.lights.' + lk + ' missing'); });
      for (key in HAND_MATS) {
        if (!palette.materials[HAND_MATS[key]]) errs.push('palette.materials.' + HAND_MATS[key] + ' missing');
        if (A.detailPass && !A.detailPass.materials[HAND_MATS[key]]) errs.push('detailPass.materials.' + HAND_MATS[key] + ' missing (GPU path would switch off)');
      }
    }
    // view model: castOffset = ember mount at rest; carried light = the same point; ember on screen in every clip
    var vm = A.viewModels.spellHand, co = vm.castOffset, e0 = mountEye(vm, vm.rest, 'ember');
    var d = Math.max(Math.abs(e0[0] + co.right), Math.abs(-e0[1] - co.fwd), Math.abs(-e0[2] - co.down));
    if (d > 0.005) errs.push('castOffset off the ember mount at rest by ' + d.toFixed(4) + ' m (mount ' + e0.map(function (v) { return v.toFixed(3); }).join(', ') + ')');
    var lo = vm.carriedLight.offset;
    if (Math.max(Math.abs(e0[0] - lo.right), Math.abs(-e0[1] - lo.fwd), Math.abs(-e0[2] - lo.down)) > 0.005) errs.push('carriedLight offset != ember mount at rest');
    var TV = Math.tan(37.5 * Math.PI / 180) * 9 / 16, TH = Math.tan(37.5 * Math.PI / 180), cn, t;
    ['idle', 'charge', 'chargeHold', 'fizzle'].forEach(function (cn2) {
      var cl = vm.clips[cn2], T = cl.keys[cl.keys.length - 1].t;
      for (t = 0; t <= T; t += 10) {
        var q = mountEye(vm, sampleKeys(cl.keys, t, cl.loop), 'ember'), s = -q[1];
        if (!(s > 0.3) || Math.abs(q[2] / s) > TV * 0.95 || Math.abs(q[0] / s) > TH * 0.95) { errs.push('ember off-screen in ' + cn2 + ' @' + t); break; }
      }
    });
    for (cn in vm.clips) {
      var ks = vm.clips[cn].keys;
      for (i = 1; i < ks.length; i++) if (!(ks[i].t > ks[i - 1].t)) errs.push(cn + ': key times must increase');
    }
    return errs;
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { spellFx: A.spellFx, spellSprites: A.spellSprites, spellHand: A.viewModels.spellHand, spellHandL: A.voxelModels.spellHandL };
  }
})(typeof window !== 'undefined' ? window : globalThis);
