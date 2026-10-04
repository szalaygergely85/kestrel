/*
 * Kestrel - THE TORCH (TORCH-01, owner 2026-10-04: "instead of this lantern, put a torch to pick up to the right hand").
 * Owner: Designer. Tech: architecture.md 37.8 (TORCH-01a multi-handle view model, TORCH-01b game + content).
 * Format: architecture.md 15.1 (VoxelModelDef) + README section 4 (sprites) + README 7.4 (view models), like sword.js.
 *
 * Look (Blood / Build-engine prop + sprite fire, the owner's taste): a long pine haft (0.48 m), a rope grip wrap, a
 * dark iron ferrule at the butt and an iron collar under the head, an oily rag head (dark linen) bound with a rope band,
 * charred black on top. The fire is NOT voxels: an animated emissive billboard `torchFlame` sits on the head top.
 * In the tower it stands in an iron WALL SCONCE (ring + arm + brace + wall plate) on step 8's west face, exactly where
 * the brass lamp hung, leaning 12 deg out from the wall, burning. Taking it hides the torch; the sconce stays.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.torchProp   the world / pick-up model: torch in its wall sconce. Clips lit (default), empty (after
 *                                  the take: torch hidden, sconce stays), lying (SPARE: a torch dropped on the floor,
 *                                  sconce hidden). Mounts flame, light, prompt, grip.
 *   ASSETS.voxelModels.torchHeld   the same torch alone, pivot = grip centre (view-model geometry). Mount flame.
 *   ASSETS.models.torchFlame       the animated emissive sprite flame (6 frames `burn` @ 12 fps, 5x7, half 3x4,
 *                                  world 0.12 x 0.22 m, anchor bottom centre, every key e: true).
 *   ASSETS.viewModels.torch        README 7.4 def: RIGHT hand (rest pos.x > 0), clips idle / raise / lower, bob, mount
 *                                  flame >= 0.7 m in front of the eye (37.8: sprites nearer than 0.6 m are culled).
 *   ASSETS.levelPatch.towerTorch   the tower content swap as data (TORCH-01b copies it into tower.level.json together
 *                                  with torch.take + the test updates; NOT applied here so the Node suites stay green).
 *   ASSETS.voxelModels.attachTorch()  registers ASSETS.models.torchProp once every material is merged (all are today).
 *
 * LOADING: a NEW file. TORCH-01b adds <script src="../design/models/torch.js"></script> to game/index.html (after
 * lantern.js / voxel_props.js) and to every Node loader that loads the tower (World.load throws on an unregistered prop
 * model, so the level swap and the loader lines land in the same commit).
 *
 * AXES (15.1): x = east, y = SOUTH with y0 = the model's FRONT row, z = up. cellM 0.02 m.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};
  A.viewModels = A.viewModels || {};
  A.levelPatch = A.levelPatch || {};

  var CELL = 0.02, SX = 6, SZ = 31;
  // all merged already (AWK_MATS in m3_props.js + envelope canvas_burnt): no palette / detail-pass edit needed
  var MATS = { W: 'wood', w: 'timber_old', r: 'rope', I: 'iron_dark', i: 'iron_light', l: 'linen_dark', c: 'canvas_burnt' };

  // ===================================================================================================================
  // 1. GEOMETRY. Haft core 2 x 2 voxels (4 cm) at x 2..3, y cy..cy+1, z 0..23; head 4 x 4 (corners cut) z 24..30.
  //    z0 iron ferrule, z1-3 + z9-23 pine grain (W / w by (x+y+z) % 3), z4-8 rope grip wrap (grip centre z 6.5),
  //    z24-25 iron collar (light rivet front + back), z26 rag, z27 rope binding, z28 rag with char streaks,
  //    z29 charred, z30 charred cap (inner 2 x 2). The flame sprite stands on z 30.5 (half sunk into the cap).
  //    Sconce (prop only, cy = 5): ring z15-16 round the haft (dark, light top lip), arm y8-9, brace, wall plate y10
  //    (x1..4, z10..19, light top row + 4 rivets).
  // ===================================================================================================================
  function buildTorch(sy, cy, withSconce) {
    var g = [], x, y, z;
    for (z = 0; z < SZ; z++) { g.push([]); for (y = 0; y < sy; y++) g[z].push('......'.split('')); }
    function put(px, py, pz, ch) { g[pz][py][px] = ch; }
    function headCell(px, py) {            // 4 x 4 minus the corners
      var ex = (px === 1 || px === 4), ey = (py === cy - 1 || py === cy + 2);
      return !(ex && ey);
    }
    function isCore(px, py) { return px >= 2 && px <= 3 && py >= cy && py <= cy + 1; }
    // haft
    for (z = 0; z <= 23; z++) for (y = cy; y <= cy + 1; y++) for (x = 2; x <= 3; x++) {
      if (z === 0) put(x, y, z, 'I');
      else if (z >= 4 && z <= 8) put(x, y, z, 'r');
      else put(x, y, z, ((x + y + z) % 3 === 0) ? 'w' : 'W');
    }
    // head
    for (z = 24; z <= 30; z++) for (y = cy - 1; y <= cy + 2; y++) for (x = 1; x <= 4; x++) {
      if (!headCell(x, y)) continue;
      var rim = !isCore(x, y), ch;
      if (z <= 25) ch = 'I';
      else if (z === 26) ch = 'l';
      else if (z === 27) ch = rim ? 'r' : 'l';
      else if (z === 28) ch = (rim && (x + y) % 3 === 0) ? 'c' : 'l';
      else if (z === 29) ch = 'c';
      else { if (rim) continue; ch = 'c'; }
      put(x, y, z, ch);
    }
    put(2, cy - 1, 25, 'i'); put(3, cy + 2, 25, 'i');            // collar rivets (front, back)
    if (withSconce) {
      for (z = 15; z <= 16; z++) for (y = cy - 1; y <= cy + 2; y++) for (x = 1; x <= 4; x++) {
        if (isCore(x, y)) continue;
        put(x, y, z, z === 16 ? 'i' : 'I');
      }
      for (y = cy + 3; y <= cy + 4; y++) for (x = 2; x <= 3; x++) { put(x, y, 15, 'I'); put(x, y, 16, 'i'); }   // arm
      for (x = 2; x <= 3; x++) { put(x, cy + 4, 12, 'I'); put(x, cy + 4, 13, 'I'); put(x, cy + 3, 14, 'I'); } // brace
      for (z = 10; z <= 19; z++) for (x = 1; x <= 4; x++) put(x, cy + 5, z, z === 19 ? 'i' : 'I');           // plate
      put(1, cy + 5, 11, 'i'); put(4, cy + 5, 11, 'i'); put(1, cy + 5, 18, 'i'); put(4, cy + 5, 18, 'i');      // rivets
    }
    return g.map(function (L) { return L.map(function (r) { return r.join(''); }); });
  }

  // ===================================================================================================================
  // 2. torchProp: torch in the wall sconce. size 6 x 11 x 31 (0.12 x 0.22 x 0.62 m). Anchor [3, 6, 0] = haft centre at
  //    the butt; the plate back (y 11) is 0.10 m behind it, so the lamp's placement (19.9, 6.5) facing 270 puts the
  //    plate on the wall face x 20.0 (as the lamp bracket). Parts (first part wins): haft (root), head (child of haft),
  //    sconce (root, never posed). Lean: haft rot [12, 0, 0] about the ring centre [3, 6, 16] = top 12 deg OUT from the
  //    wall (+rx = top toward the front, -y). Hidden: pos z -160 voxels (-3.2 m, under the floor from every view).
  //    World points at the placement (x 19.9, y 6.5, z 1.15, facing 270), posed `lit` (checked by hand, see README v1.33):
  //      flame mount  (19.840, 6.5, 1.754)   -> prop torchFlame        light mount (19.823, 6.5, 1.832) -> torchSconce light
  //      prompt mount (19.864, 6.5, 1.544)   -> interactable aim z     ring (sconce) z 1.45 - 1.49, plate z 1.35 - 1.55
  //      butt (posed) x <= 19.986 (clear of the wall 20.0), z ~1.16
  // ===================================================================================================================
  var PROP_CY = 5, PROP_SY = 11;
  var LEAN = [12, 0, 0];
  var HIDE_Z = -160;
  A.voxelModels.torchProp = {
    name: 'torchProp',
    displayName: 'torch',
    desc: 'A pitch torch burning in an iron wall sconce on step 8\'s west face (where the brass lamp hung): long pine ' +
          'haft with a rope grip and an iron butt ferrule, iron collar, oily dark-linen rag head bound with rope, charred ' +
          'black on top; a sprite flame (torchFlame) on the head. Leans 12 deg out from the wall. Taking it leaves the ' +
          'empty iron ring on its arm and plate.',
    voxel: {
      version: 1,
      cellM: CELL,
      size: [SX, PROP_SY, SZ],
      anchor: [3, 6, 0],
      mats: MATS,
      layers: buildTorch(PROP_SY, PROP_CY, true),
      parts: {
        haft:   { box: [2, 5, 0, 4, 7, 24], pivot: [3, 6, 16] },                       // extent 28
        head:   { box: [1, 4, 24, 5, 8, 31], pivot: [3, 6, 16], parent: 'haft' },     // extent 15
        sconce: { box: [1, 4, 10, 5, 11, 20], pivot: [3, 9, 15] }                      // extent 21 (haft cells inside belong to haft)
      },
      animations: {
        lit:   { durations: [1000], loop: true, frames: [{ haft: { rot: LEAN } }] },                         // DEFAULT
        empty: { durations: [1000], loop: true, frames: [{ haft: { rot: LEAN, pos: [0, 0, HIDE_Z] } }] },   // after the take
        // SPARE: a torch lying on the floor (e.g. dropped / found outdoors): haft along the model y axis, head resting
        // on the floor (z 0..4 voxels), sconce hidden. Flame mount ends on the head's side - spawn torchFlame there.
        lying: { durations: [1000], loop: true, frames: [{ haft: { rot: [90, 0, 0], pos: [0, -0.5, -14] }, sconce: { pos: [0, 0, HIDE_Z] } }] }
      },
      mounts: {
        flame:  { at: [3, 6, 30.5], part: 'head' },   // flame sprite base (bottom centre), half sunk into the charred cap
        light:  { at: [3, 6, 34.5], part: 'head' },   // sconce light origin, 8 cm above the flame base
        prompt: { at: [3, 5, 20], part: 'haft' },     // front of the haft above the ring = the interactable aim point
        grip:   { at: [3, 6, 6.5], part: 'haft' }
      }
    },
    placement: { level: 'tower', prop: 'torch', x: 19.9, y: 6.5, z: 1.15, facing: 270, wallX: 20.0,
                 note: 'same x / y / facing as the brass lamp; z 1.15 puts the sconce ring at ~1.47 m and the flame base at 1.75 m' },
    readability: { note: 'At 2.5 m on 160x60 ~12 rows tall incl. flame; the flame + warm sconce light are the "take me" ' +
                   'cue (no glint, as the lit lamp, OWN-REQ-006).' }
  };

  // ===================================================================================================================
  // 3. torchHeld: the torch alone (6 x 6 x 31), pivot / anchor = the grip centre [3, 3, 6.5]. flame mount is 24 voxels
  //    = 0.48 m above the grip along the haft.
  // ===================================================================================================================
  A.voxelModels.torchHeld = {
    name: 'torchHeld',
    desc: 'The torch as a first-person view model (right hand): same voxels as torchProp without the sconce, pivot = grip.',
    voxel: {
      version: 1,
      cellM: CELL,
      size: [SX, 6, SZ],
      anchor: [3, 3, 6.5],
      mats: MATS,
      layers: buildTorch(6, 2, false),
      parts: {
        haft: { box: [2, 2, 0, 4, 4, 24], pivot: [3, 3, 6.5] },
        head: { box: [1, 1, 24, 5, 5, 31], pivot: [3, 3, 6.5], parent: 'haft' }
      },
      animations: { held: { durations: [1000], loop: true, frames: [{}] } },
      mounts: {
        flame: { at: [3, 3, 30.5], part: 'head' },    // torchFlame base + the carried light (37.8)
        grip:  { at: [3, 3, 6.5], part: 'haft' },
        butt:  { at: [3, 3, 0], part: 'haft' }
      }
    }
  };

  // ===================================================================================================================
  // 4. torchFlame: emissive sprite fire (README 4), the burnerFire language at torch size. Heat keys 1 tip .. 4 core,
  //    every cell emissive. 5 x 7 cells, anchor bottom centre (x 2, y 6), world 0.12 x 0.22 m (37.8). 6 frames @ 12 fps:
  //    tall / lean left / tall split / lean right / squat + sparks / twin tips. The bottom row is the burning rag top
  //    (white-yellow core under orange), so the flame never floats off the head. Half LOD 3 x 4 (same cycle).
  // ===================================================================================================================
  var FK = { '1': { c: 'flameTip', e: true }, '2': { c: 'flameOuter', e: true },
             '3': { c: 'flameMid', e: true }, '4': { c: 'flameCore', e: true } };
  function ff(g, k) { return { S: { glyphs: g, fg: k } }; }
  A.models.torchFlame = {
    name: 'torchFlame',
    desc: 'TORCH-01: the torch\'s Build-style sprite flame - white-yellow core on the rag, orange tongues, red ragged tips ' +
          'and loose sparks. All emissive. Used on the wall sconce (level prop) and pushed per frame on the held torch.',
    size: { w: 5, h: 7 }, anchor: { x: 2, y: 6 }, world: { w: 0.12, h: 0.22 },
    directions: ['S'], billboard: true,
    keys: FK,
    mountOn: { model: 'torchProp', mount: 'flame', clip: 'lit',
               note: 'spawn while torchProp shows `lit`; removed by torch.take (flameProp). Held: torchView pushes it at ' +
                     'viewModels.torch mount flame (37.8)' },
    animations: { burn: { fps: 12, loop: true, frames: [
      ff(["  '  ", '  ^  ', ' (^) ', ' (*) ', '(*#*)', '(#@#)', ' *@* '],
         ['  1  ', '  1  ', ' 212 ', ' 232 ', '23332', '23432', ' 343 ']),
      ff(["'    ", ' ^   ', '(^)  ', '(*)^ ', '(*#*)', '(#@#)', ' *@* '],
         ['1    ', ' 1   ', '212  ', '2321 ', '23332', '23432', ' 343 ']),
      ff(['  .  ', '  ^  ', '  ^  ', ' (*) ', ' (#) ', '(*@*)', ' #@# '],
         ['  1  ', '  1  ', '  2  ', ' 232 ', ' 232 ', '23432', ' 343 ']),
      ff(["    '", '   ^ ', '  (^)', ' ^(*)', '(*#*)', '(#@#)', ' *@* '],
         ['    1', '   1 ', '  212', ' 1232', '23332', '23432', ' 343 ']),
      ff([" .  '", '     ', '  ^  ', ' (^) ', '(*#*)', '(#@#)', ' *@* '],
         [' 1  1', '     ', '  1  ', ' 212 ', '23332', '23432', ' 343 ']),
      ff([" '   ", '  ^ ^', ' (^)^', ' (*#)', '(*#*)', '(#@#)', ' *@* '],
         [' 1   ', '  1 1', ' 2121', ' 2332', '23332', '23432', ' 343 '])
    ] } },
    lods: { half: { size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, animations: { burn: { fps: 12, loop: true, frames: [
      ff([" ' ", ' ^ ', '(*)', '*@*'], [' 1 ', ' 2 ', '232', '343']),
      ff(["'  ", '^  ', '(*)', '*@*'], ['1  ', '1  ', '232', '343']),
      ff([' . ', ' ^ ', '(#)', '*@*'], [' 1 ', ' 2 ', '232', '343']),
      ff(["  '", '  ^', '(*)', '*@*'], ['  1', '  1', '232', '343']),
      ff([". '", '   ', '(^)', '*@*'], ['1 1', '   ', '212', '343']),
      ff([" ' ", ' ^^', '(*)', '*@*'], [' 1 ', ' 11', '232', '343'])
    ] } } } }
  };

  // ===================================================================================================================
  // 5. VIEW MODEL (README 7.4; eye space x right, y BACK (forward = -y), z up, metres; R = Rz * Ry * Rx, degrees).
  //    RIGHT hand (the sword is LEFT after BUG-VM-001). The torch is held low at the right, pushed forward and tipped
  //    35 deg away from the eye, top leaning 10 deg in toward the centre: the haft rises from the bottom-right screen edge
  //    (the hand is off-screen) to the flame right of centre, a little below the horizon.
  //    REST grip (0.36, -0.50, -0.50); top direction t = (sin(-10) cos35, -sin35, cos(-10) cos35) = (-0.142, -0.574, 0.807).
  //    flame mount at rest = grip + 0.48 t = (0.292, -0.775, -0.113): forward 0.775 m (>= 0.7, 37.8), on screen about
  //    21 deg right / 8 deg below centre (75 deg HFOV, 16:9). idle only ever tips the top further forward (rx 35 -> 36.5,
  //    rz 0 -> 1.5): forward 0.775 .. 0.787 over the whole clip. raise / lower stay >= 0.77 at every key.
  //    Butt end (0.13 m below the grip) stays 0.425 m in front of the eye.
  //    Carried light (37.8): components.light { preset 'torch', attach 'eye', offset { right 0.29, fwd 0.78, down 0.11 },
  //    sway { amp 0.02 } } = the flame mount at rest.
  // ===================================================================================================================
  var REST = { pos: [0.36, -0.50, -0.50], rot: [35, -10, 0] };
  var LOW = { pos: [0.40, -0.42, -0.86], rot: [60, -10, 8] };   // below the bottom edge, tipped forward (raise start)
  function k(t, pos, rot) { return { t: t, pos: pos, rot: rot }; }
  A.viewModels.torch = {
    model: 'torchHeld',
    hand: 'right',
    space: 'eye: x right, y back (forward = -y), z up, metres; yaw-0 / pitch-0 camera frame at the eye',
    rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot)',
    projection: 'same as the scene; drawn in the view-model depth range after the scene (TORCH-01a: second handle)',
    depth: { near: 0.05, far: 1.5 },
    rest: REST,
    clips: {
      // slow flame-bearer's breath: the top dips 1.5 deg forward and rolls a hair, 2.6 s (slower than the sword's 2.2 s
      // so the two hands never sway in step)
      idle: { loop: true, keys: [
        k(0, REST.pos, REST.rot),
        k(1300, [0.362, -0.50, -0.492], [36.5, -10, 1.5]),
        k(2600, REST.pos, REST.rot)
      ] },
      // the take (300 ms, 37.8): from below the screen edge up into the hand, a 2-deg overshoot back, settle
      raise: { loop: false, keys: [
        k(0, LOW.pos, LOW.rot),
        k(200, [0.36, -0.51, -0.47], [33, -10, -1]),
        k(300, REST.pos, REST.rot)
      ] },
      // SPARE (cinematics / swimming later): lower out of view, 250 ms
      lower: { loop: false, keys: [
        k(0, REST.pos, REST.rot),
        k(250, LOW.pos, LOW.rot)
      ] }
    },
    flameMount: 'flame',   // torchHeld mount name: torchFlame base AND the carried light point
    bob: { note: 'engine-side walk bob while moving (same numbers as the sword, phase shared, 37.8 setBob per handle)',
           z: 0.012, x: 0.006, rollDeg: 1.0 },
    flame: { model: 'torchFlame', anim: 'burn', mount: 'flame', fps: 12,
             note: '37.8: pushed per rendered frame via SpritePool.push at eyeToWorld(mountEye(flame)), frame = ' +
                   'floor(simTime * 12) mod 6; flame mount forward >= 0.7 m so the 0.6 m near cull never hides it' },
    carriedLight: { preset: 'torch', mount: 'flame', offset: { right: 0.29, fwd: 0.78, down: 0.11 }, sway: { amp: 0.02 },
                    note: '37.8: the flame mount at rest (pe.x, -pe.y, -pe.z). Always right; no left/right flip with the sword.' },
    embers: { preset: 'embers', everySteps: 10, note: 'optional (37.8): 1 particle every ~10 sim steps at the light position, sim side only' }
  };

  // ===================================================================================================================
  // 6. TOWER CONTENT SWAP (TORCH-01b copies these by hand into content/levels/tower.level.json, keys alphabetical as the
  //    canonical writer wants, then runs node tools/content-canonical.test.mjs). Replaces the lamp entries 1:1.
  // ===================================================================================================================
  A.levelPatch.towerTorch = {
    story: 'TORCH-01b',
    stateFlag: 'tower.torch.taken',
    replace: {
      'props[id=lantern]':   { facing: 270, id: 'torch', interactable: 'torch', model: 'torchProp', variant: 'lit', x: 19.9, y: 6.5, z: 1.15,
                               note: 'TORCH-01 (owner 2026-10-04): pitch torch in an iron wall sconce where the brass lamp hung (step 8 west face). torch.take plays `empty` (torch hidden, sconce stays), removes torchFlame, switches the torchSconce light off' },
      'props[id=lampFlame]': { facing: 270, id: 'torchFlame', model: 'torchFlame', variant: 'burn', x: 19.84, y: 6.5, z: 1.754,
                               note: 'TORCH-01: the torch flame sprite at torchProp mount flame (posed lit); removed by torch.take' },
      'lights[id=lanternHook]': { id: 'torchSconce', on: true, preset: 'torchSconce', x: 19.823, y: 6.5, z: 1.832 },
      'interactables[id=lantern]': { flameProp: 'torchFlame', id: 'torch', interact: 'torch.take', light: 'torchSconce', once: true,
                                     prompt: '[E] Take torch', prop: 'torch', radius: 1.8, x: 19.86, y: 6.5, z: 1.54,
                                     note: 'TORCH-01b (37.8): sets tower.torch.taken, hides the torch (clip empty), removes torchFlame, sconce light off, carried light preset torch at the held flame mount, view model raise -> idle (right hand)' }
    },
    alsoUpdate: [
      'interactables[id=beacon].requires: tower.lantern.taken -> tower.torch.taken (or keep the lantern flag mapped, 37.8 old saves)',
      'triggers[id=hintBurner].note: skipIfState flag name (uiStyle.storyHints burner.on.skipIfState) -> tower.torch.taken',
      'world_m1.world.json state: add "tower.torch.taken": false',
      'tests pinning the lamp ids / model / prompt: game/js/quest/tower.test.js 3b (lines ~211-271) + section 10 (~683), ' +
        'swordTake.test.js (lantern prop/interactable), restart.test.js (lantern rec), hints.test.js (skip flag)'
    ],
    checks: { lampSpot: { x: 19.9, y: 6.5 }, burnerDistM: 1.34, hintBurnerR: 3, approachCell: [19, 6],
              note: 'the torch stays inside hintBurner (r 3 round 18.5, 6.5) like the lamp; cell 19,7 / 19,6 stay clear' }
  };

  // ===================================================================================================================
  // 7. ATTACH: registers models.torchProp (+ torchHeld for the VoxelPool binding the view model needs) once every
  //    material is in palette.materials AND detailPass.materials (a missing v2 record would switch the GPU path off).
  // ===================================================================================================================
  A.voxelModels.attachTorch = function attachTorch() {
    var P = A.palette, DP = A.detailPass, done = [], k, ok = true;
    if (!P || !DP) return done;
    for (k in MATS) if (!P.materials[MATS[k]] || !DP.materials[MATS[k]]) ok = false;
    if (!ok) return done;
    if (!A.models.torchProp) { A.models.torchProp = A.voxelModels.torchProp; done.push('torchProp'); }
    return done;
  };
  A.voxelModels.attachTorch();

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { torchProp: A.voxelModels.torchProp, torchHeld: A.voxelModels.torchHeld, torchFlame: A.models.torchFlame,
                       viewModel: A.viewModels.torch, levelPatch: A.levelPatch.towerTorch };
  }
})(typeof window !== 'undefined' ? window : globalThis);
