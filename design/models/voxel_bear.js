/* design/models/voxel_bear.js - the talking brown bear (designer, v1.51, owner request 2026-10-09: "the nicest voxel
 *                               bear, must be perfect, able to talk"). A friendly NPC; the dialogue system is separate
 *                               (content/dialogue/bear.dialogue.json refers to the model key `bear`).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_beast.js:
 *   <script src="../design/models/voxel_bear.js">       (browser)
 *   import '../design/models/voxel_bear.js';            (Node tests: side-effect import)
 * Sets ASSETS.models.bear (format: design/README.md section 4/7, architecture.md 15.1) and ASSETS.bearFx (clip ->
 * state map, talk-sync data). Only ALREADY-MERGED palette materials (no palette / detail-pass edit). `meshOnly: true`.
 *
 * Axes (15.1): x = east (= the bear's RIGHT at yaw 0), y = SOUTH with y0 = the model's FRONT (faces north at yaw 0),
 * z = up. cellM 0.05. Grid 28 x 21 x 40. Anchor [14, 11, 0] = between the hind feet. Clip `pos` values are VOXELS.
 *
 * STANCE (design choice): the REST pose is UPRIGHT on the hind legs (2.0 m to the ear tips, 1.85 m crown, eyes at
 * 1.68 m: the player's 1.6 m eye looks a little UP into a friendly face, the jaw is in plain view). The model is rigged so
 * the same parts also make a real QUADRUPED: the body pitches 75 deg forward about the hip line (pivot z 12 = the hip
 * joint, 0.6 m), arms and legs counter-rotate by -75 and hang vertical, so the shoulders land at 0.77 m and the paws
 * on the ground (arm length = hip-to-shoulder drop, checked in the preview), the shoulder hump at 1.1 m and the head at
 * ~1.0 m, nose a little down. Upright is for talking (clips idle/talk/listen/wave/laugh/turn), all fours for moving
 * (drop -> walk -> rise), and `sit` (legs forward, toes up, paws on the knees) puts the head at ~1.55 m = eye to eye.
 *
 * Look (owner taste: chunky Blood / Build-engine voxel props): barrel torso 0.8 m wide with chamfered (octagonal)
 * slices, broad shoulders + a hump on the upper back, thick arms hanging to the hips, short heavy legs with big
 * haunches and long plantigrade feet, a broad flat skull with cheek ruffs, a short wide muzzle, round ears.
 * Value ladder (one soft `fabric` ramp family, so the fur reads as one animal):
 *   muzzle skin_light (#d6a07c) > face mask + belly patch skin (#b98466) > body fur skin_shade (#7e5444) >
 *   forearms / paws / lower legs / inner ears / philtrum hair_dark (#3c2b22, `|` strand texels) ; claws linen_dark
 *   (cool horn grey, a different hue so they read on the dark paws), nose iron_dark (spec = a wet shine).
 *   Mouth inside: roof gore_red_dark, tongue gore_red, 4 small linen_light teeth (only seen with the jaw open).
 * Eyes: 1 voxel each, under a 2-voxel brow. EYE_MAT 'iron_dark' (friendly dark eyes on the light face); set it to
 * 'ember_glow' for boar-style glowing eyes or 'brass_hot' for a faint warm twinkle (emissive 0.10). `light: false`, so a
 * glowing-eye variant never derives an EMIS point light.
 *
 * Parts (8 = MAX_VOX_PARTS; insertion order = part index; every parent is EARLIER; each box sx+sy+sz <= 48, style 5.14):
 *   body  box [6,6,12, 22,20,30]   pivot [14, 13, 12] = the hip line, mid-depth. Root. rx + = lean forward (75 = on all
 *                                  fours), ry + = roll top to the bear's right, rz + = turn to the right. Torso, throat,
 *                                  hump, belly patch, tail stub.
 *   head  box [7,0,30, 21,15,37]   pivot [14, 10, 30] (the neck), parent body. rx + = nod down, ry + = tilt top to the
 *                                  right, rz + = look right. Skull, face mask, cheek ruffs, muzzle + nose, eyes, brows,
 *                                  the mouth roof (+ upper teeth).
 *   jaw   box [11,1,27, 17,6,30]   pivot [14, 6, 30] = the hinge at the back-top of the lower jaw, parent head.
 *                                  OPEN = rx +, range 0 (closed) .. 28 (laugh); talk uses 2..22. (For the architect's
 *                                  `components.voxel.partRot = {part: 'jaw', rx}` override: clamp rx to [0, 28].)
 *                                  Lower lip, chin, tongue, lower teeth.
 *   ears  box [7,8,37, 21,12,40]   pivot [14, 10, 37], parent head. BOTH round ears (3 x 2 x 3, dark inner ear).
 *                                  rx + = perk forward, rx - = flick / pin back. (The spare 8th part: an NPC that is
 *                                  never attacked needs no hit-flash shell; ears carry the idle flick, the listening
 *                                  perk and the laughing pin-back, which is what sells "alive" at talking range.)
 *   armL / armR  box 5 x 10 x 17   pivot [3.5 | 24.5, 12, 28.5] (shoulder), parent body. rx - = swing forward / raise in
 *                                  front, ry = sideways (armR: ry - = out / up; armL: ry + = out). Upper arm fur, dark
 *                                  forearm + paw, 3 claws. (L = x small = the bear's left.)
 *   legL / legR  box 7 x 15 x 12   pivot [10 | 18, 13, 12] (hip), parent body. rx - = foot forward.
 *
 * Clips (durations in ms, all multiples of 50 = whole 60 Hz steps; steps in brackets):
 *   idle    loop 5.2 s [312]  breathing (chest + arms), slow look left, an ear flick (100 ms back, snap forward), slow
 *                             look right, back to centre.
 *   talk    loop 1.6 s [96]   12 keys: jaw 0/16/4/9/2/22/6/12/0/7/15/3 deg = 3 opening sizes (small / mid / wide) at
 *                             100-150 ms per syllable, key 8 = a closed 250 ms pause; head nods + small turns, the
 *                             right paw lifts on the stressed syllable (key 5), ears twitch.
 *   listen  loop 2.4 s [144]  head tilted 12 deg to the right, ears perked, breathing, one "mm-hm" nod.
 *   wave    once 1.7 s [102]  anticipation, right arm up and out, 4 waves, mouth open in a smile, arm down.
 *   laugh   once 1.6 s [96]   head back, wide jaw chops (26/12/24/10/22/8/15), belly bounce, paws to the belly, ears
 *                             pinned back, settle with a nod.
 *   walk    loop 0.7 s [42]   ON ALL FOURS: diagonal pairs reach / pass, body roll + yaw lumber, bob on the passing
 *                             keys. Tuned for ~1.0 m/s.
 *   turn    loop 0.6 s [36]   upright in-place shuffle (alternate feet lift, weight shift); the game turns the yaw.
 *   drop    once 0.75 s [45]  upright -> all fours (lean, paws reach, land with a small squash). Ends = walk pose.
 *   rise    once 0.8 s [48]   all fours -> upright (push, rise, small overshoot back). Ends = idle pose.
 *   sit     once 0.8 s [48]   upright -> seated (crouch, plop, settle); holds the seated pose.
 *   sitTalk loop 1.6 s [96]   the talk keys on the seated pose.
 *   standUp once 0.75 s [45]  seated -> upright.
 *
 * Clip -> state map (ASSETS.bearFx.clipFor; view-only, the NPC view sets components.voxel.anim):
 *   idle -> idle | greet (player first comes within ~4 m) -> wave, then idle | line typing -> talk (seated: sitTalk)
 *   | waiting for the player (line shown / choice open) -> listen (seated: hold sit) | line tagged happy -> laugh, then
 *   talk / listen | start moving -> drop, then walk while moving, rise when stopped | turning in place -> turn
 *   | rest spot -> sit ... standUp.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 28, SY = 21, SZ = 40;
  var EYE_MAT = 'iron_dark';                 // 'ember_glow' = glowing eyes (boar style), 'brass_hot' = warm twinkle
  var JAW_MAX = 28;                          // max jaw open (rx deg); talk peaks at 22, laugh at 26

  // ---- voxel grid ----
  var G = [], x, y, z, i;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  function at(px, py, pz) { return (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) ? G[pz][py][px] : '.'; }
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }
  // one z-slice rectangle [x0,x1) x [y0,y1) with its corners chamfered (cells with edge distance ex + ey < c dropped)
  function slab(pz, x0, x1, y0, y1, c, ch) {
    for (var yy = y0; yy < y1; yy++) for (var xx = x0; xx < x1; xx++) {
      var ex = Math.min(xx - x0, x1 - 1 - xx), ey = Math.min(yy - y0, y1 - 1 - yy);
      if (ex + ey < c) continue;
      put(xx, yy, pz, typeof ch === 'function' ? ch(xx, yy, pz) : ch);
    }
  }
  function slabSym(pz, x0, x1, y0, y1, c, ch) { slab(pz, x0, x1, y0, y1, c, ch); slab(pz, SX - x1, SX - x0, y0, y1, c, ch); }

  // ---- torso (body part): z 12..29, x 6..21 (0.8 m), belly front y6, back y17, hump to y19 ----
  slab(12, 7, 21, 8, 17, 2, 'B');
  slab(13, 6, 22, 7, 18, 3, 'B');
  for (z = 14; z <= 20; z++) slab(z, 6, 22, 6, 18, 3, 'B');     // belly
  for (z = 21; z <= 23; z++) slab(z, 6, 22, 7, 18, 3, 'B');
  slab(24, 6, 22, 7, 19, 3, 'B');
  for (z = 25; z <= 28; z++) slab(z, 6, 22, 8, 20, 3, 'B');     // shoulders + hump
  slab(29, 7, 21, 9, 19, 3, 'B');
  slab(27, 10, 18, 6, 8, 1, 'B'); slab(28, 10, 18, 6, 9, 1, 'B'); slab(29, 10, 18, 6, 10, 1, 'B');   // throat under the jaw
  slab(13, 13, 15, 18, 20, 0, 'B'); slab(14, 13, 15, 18, 20, 0, 'B');                                 // tail stub
  // belly patch: the two front-most fur cells inside an oval (8 wide, z 14..22) -> the lighter face tone
  for (z = 14; z <= 23; z++) for (x = 6; x < 22; x++) {
    var ex = (x + 0.5 - 14) / 3.8, ez = (z + 0.5 - 18.5) / 4.6, n = 0;
    if (ex * ex + ez * ez > 1) continue;
    for (y = 6; y < 20 && n < 2; y++) if (at(x, y, z) === 'B') { put(x, y, z, 'b'); n++; }
  }

  // ---- head (head part): z 30..36, flat broad skull, face mask in front (y <= 9), fur behind ----
  function headMat(hx, hy, hz) { return (hy <= 9 && hz <= 35) ? 'b' : 'B'; }
  slab(30, 9, 19, 6, 15, 2, headMat);
  slab(31, 8, 20, 5, 15, 2, headMat); slab(31, 7, 21, 8, 13, 1, headMat);   // + cheek ruffs
  slab(32, 8, 20, 5, 15, 2, headMat); slab(32, 7, 21, 8, 13, 1, headMat);
  slab(33, 8, 20, 5, 15, 2, headMat);
  slab(34, 8, 20, 5, 15, 2, headMat);
  slab(35, 8, 20, 6, 15, 2, headMat);
  slab(36, 8, 20, 6, 14, 2, headMat);
  // muzzle (upper jaw): z 30..32, x 11..16, y 1..5, bridge up between the eyes at z33
  slab(30, 11, 17, 1, 6, 1, 'M');
  for (x = 12; x < 16; x++) for (y = 2; y < 6; y++) put(x, y, 30, 'R');      // mouth roof (seen only when open)
  put(12, 2, 30, 'W'); put(15, 2, 30, 'W');                                   // upper canines
  put(13, 1, 30, 'D'); put(14, 1, 30, 'D');                                   // philtrum under the nose
  put(11, 4, 30, 'D'); put(16, 4, 30, 'D');                                   // mouth corners (side view smile line)
  slab(31, 11, 17, 1, 5, 1, 'M'); put(13, 1, 31, 'N'); put(14, 1, 31, 'N');  // nose tip (narrow bottom)
  slab(32, 11, 17, 1, 5, 1, 'M');
  for (x = 12; x < 16; x++) put(x, 1, 32, 'N');                              // nose (4 wide on top)
  put(13, 2, 32, 'N'); put(14, 2, 32, 'N');
  slab(33, 12, 16, 3, 5, 0, 'M');                                             // bridge
  put(11, 5, 33, 'E'); put(16, 5, 33, 'E');                                   // eyes, 1 voxel each
  put(10, 4, 34, 'B'); put(11, 4, 34, 'B'); put(16, 4, 34, 'B'); put(17, 4, 34, 'B');   // brows (level = kind)

  // ---- jaw part: z 27..29, x 11..16, y 2..5 (a small overbite behind the muzzle tip) ----
  slab(29, 11, 17, 2, 6, 1, 'M');
  for (y = 3; y < 6; y++) { put(13, y, 29, 'T'); put(14, y, 29, 'T'); put(12, y, 29, 'R'); put(15, y, 29, 'R'); }
  put(12, 3, 29, 'W'); put(15, 3, 29, 'W');                                   // lower canines
  slab(28, 12, 16, 2, 6, 1, function (jx, jy) { return jy <= 3 ? 'M' : 'b'; });
  slab(27, 12, 16, 3, 6, 1, 'b');                                             // chin

  // ---- ears part: z 37..39, round (3, 3, 1 wide), dark inner ear on the front face ----
  function ear(a) {
    slab(37, a, a + 3, 9, 11, 0, 'B'); slab(38, a, a + 3, 9, 11, 0, 'B');
    put(a + 1, 9, 39, 'B'); put(a + 1, 10, 39, 'B');
    put(a + 1, 9, 37, 'D'); put(a + 1, 9, 38, 'D');
  }
  ear(8); ear(17);

  // ---- arms: armL x 1..5, armR x 22..26 (mirrored), z 13..29 ----
  slabSym(29, 2, 6, 9, 16, 1, 'B');                                           // shoulder cap
  for (z = 22; z <= 28; z++) slabSym(z, 1, 6, 9, 16, 1, 'B');                 // upper arm
  for (z = 19; z <= 21; z++) slabSym(z, 1, 6, 9, 15, 1, 'D');                 // forearm
  for (z = 15; z <= 18; z++) slabSym(z, 1, 6, 8, 15, 1, 'D');                 // paw
  slabSym(14, 1, 6, 8, 15, 0, 'D');                                           // flat paw bottom
  for (i = 1; i <= 5; i += 2) { putSym(i, 8, 13, 'C'); putSym(i, 9, 13, 'C'); }   // 3 claws per paw

  // ---- legs: legL x 7..12 (+ haunch x6), legR x 15..20 (+ x21), z 0..11 ----
  slabSym(0, 7, 13, 6, 16, 0, 'D'); slabSym(1, 7, 13, 6, 16, 1, 'D');         // long plantigrade foot
  for (z = 2; z <= 6; z++) slabSym(z, 7, 13, 9, 16, 1, 'D');                  // lower leg
  for (z = 7; z <= 11; z++) slabSym(z, 7, 13, 8, 18, 2, 'B');                 // thigh
  for (z = 8; z <= 11; z++) slabSym(z, 6, 7, 10, 17, 0, 'B');                 // haunch bulge
  for (i = 8; i <= 12; i += 2) putSym(i, 5, 0, 'C');                          // 3 toe claws

  function buildLayers() {
    var out = [];
    for (var lz = 0; lz < SZ; lz++) { var rows = []; for (var ly = 0; ly < SY; ly++) rows.push(G[lz][ly].join('')); out.push(rows); }
    return out;
  }

  // ---- pose helpers. o = { b: [rx,ry,rz, px,py,pz] body, h: head [rx,ry,rz], j: jaw rx, e: ears, aL/aR/lL/lR: limb
  // [rx,ry,rz] or a plain rx number }. addO(base, o) adds o on top of a base pose object (seated, quadruped). ----
  function v3(a) {
    if (a === undefined || a === null) return [0, 0, 0];
    if (typeof a === 'number') return [a, 0, 0];
    return [a[0] || 0, a[1] || 0, a[2] || 0];
  }
  function r2(v) { return Math.round(v * 100) / 100; }
  function rr(a) { return [r2(a[0]), r2(a[1]), r2(a[2])]; }
  function addV(a, b) { var p = v3(a), q = v3(b); return [p[0] + q[0], p[1] + q[1], p[2] + q[2]]; }
  function addO(base, o) {
    var bb = base.b || [], ob = o.b || [], b = [], k;
    for (k = 0; k < 6; k++) b.push((bb[k] || 0) + (ob[k] || 0));
    return { b: b, h: addV(base.h, o.h), j: (base.j || 0) + (o.j || 0), e: addV(base.e, o.e),
             aL: addV(base.aL, o.aL), aR: addV(base.aR, o.aR), lL: addV(base.lL, o.lL), lR: addV(base.lR, o.lR) };
  }
  function pose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0];
    return {
      body: { rot: rr([b[0] || 0, b[1] || 0, b[2] || 0]), pos: rr([b[3] || 0, b[4] || 0, b[5] || 0]) },
      head: { rot: rr(v3(o.h)) },
      jaw:  { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      ears: { rot: rr(v3(o.e)) },
      armL: { rot: rr(v3(o.aL)) },
      armR: { rot: rr(v3(o.aR)) },
      legL: { rot: rr(v3(o.lL)) },
      legR: { rot: rr(v3(o.lR)) }
    };
  }
  // keys = [[ms, o], ...]; base = optional pose object every key is added onto
  function clip(keys, loop, base) {
    var d = [], f = [];
    for (var k = 0; k < keys.length; k++) { d.push(keys[k][0]); f.push(pose(base ? addO(base, keys[k][1]) : keys[k][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  var QB = 75;                                                    // body pitch on all fours
  var QUAD = { b: [QB, 0, 0, 0, 0, 0], h: [-55, 0, 0], aL: -QB, aR: -QB, lL: -QB, lR: -QB };   // head 20 deg nose down
  var SIT = { b: [-10, 0, 0, 0, 0, -7], h: [6, 0, 0], lL: -80, lR: -80, aL: [-25, -6, 0], aR: [-25, 6, 0] };
  var BREATH = { b: [-1.5, 0, 0, 0, 0, 0.3], aL: [0, 2, 0], aR: [0, -2, 0] };

  // talk: jaw sizes small (2-7) / mid (9-12) / wide (15-22), 100-150 ms syllables, key 8 = closed pause (bearFx.talk)
  var TALK = [
    [100, {}],
    [150, { j: 16, h: [-3, 0, 1], b: [-0.5, 0, 0, 0, 0, 0.1] }],
    [100, { j: 4, h: [-1, 0, 1] }],
    [100, { j: 9, h: [2, 0, 2] }],
    [100, { j: 2, h: [3, 0, 2] }],
    [150, { j: 22, h: [-4, 2, 0], b: [-1, 0, 0, 0, 0, 0.25], aR: [-8, -2, 0], e: [5, 0, 0] }],
    [150, { j: 6, h: [4, 1, -1], aR: [-6, -2, 0] }],
    [100, { j: 12, h: [1, 0, -2], aR: [-3, 0, 0] }],
    [250, { j: 0, h: [0, 0, -3] }],
    [100, { j: 7, h: [-1, 0, -2] }],
    [150, { j: 15, h: [-2, -1, 0], b: [-0.5, 0, 0, 0, 0, 0.1], e: [3, 0, 0] }],
    [150, { j: 3, h: [2, 0, 0] }]
  ];

  var WAVE_UP = { b: [0, -3, 0, 0, 0, 0], h: [-3, -6, 6], j: 8, e: [6, 0, 0] };
  function wave(ry, j) { var o = addO(WAVE_UP, { aR: [-15, ry, 0] }); if (j !== undefined) o.j = j; return o; }
  var LAUGH_ARMS = { aL: [-28, -14, 0], aR: [-28, 14, 0], e: [-20, 0, 0] };

  var animations = {
    // breathing loop with a slow look round and one ear flick (interp: key i blends to key i+1 over durations[i])
    idle: clip([
      [700, {}],
      [800, BREATH],
      [500, { h: [3, 0, -16] }],
      [100, { h: [3, 1, -17] }],
      [100, { h: [3, 1, -17], e: [-28, 0, 0] }],                 // flick back ...
      [900, { h: [3, 1, -17], e: [6, 0, 0] }],                   // ... snap forward, then a slow turn right
      [800, addO(BREATH, { h: [-1, 0, 8] })],
      [700, { h: [1, 0, 5] }],
      [600, { h: [0, 0, 1] }]
    ], true),
    talk: clip(TALK, true),
    // head tilted to the right, ears perked, one "mm-hm" nod; loops on the tilt
    listen: clip([
      [900, { h: [4, 12, 5], e: [10, 0, 0] }],
      [700, { h: [3, 13, 5], e: [10, 0, 0], b: [-1, 0, 0, 0, 0, 0.3] }],
      [150, { h: [3, 12, 5], e: [10, 0, 0] }],
      [250, { h: [9, 11, 5], e: [7, 0, 0] }],
      [400, { h: [4, 12, 5], e: [10, 0, 0] }]
    ], true),
    wave: clip([
      [100, {}],
      [150, { aR: [8, 4, 0], b: [0, 0, 0, 0, 0, -0.4], h: [2, 0, 0] }],   // anticipation: arm back, small dip
      [200, wave(-140)],
      [150, wave(-160)],
      [150, wave(-126)],
      [150, wave(-160)],
      [150, wave(-126)],
      [200, wave(-150, 4)],
      [250, { aR: [-6, -50, 0], b: [0, -1, 0, 0, 0, 0], j: 2 }],
      [200, {}]
    ], false),
    laugh: clip([
      [150, { h: [6, 0, 0], j: 2, b: [2, 0, 0, 0, 0, -0.3] }],
      [150, addO(LAUGH_ARMS, { h: [-20, 0, 0], j: 26, b: [-5, 0, 0, 0, 0, 0.6] })],
      [100, addO(LAUGH_ARMS, { h: [-16, 0, 2], j: 12, b: [-3, 0, 0, 0, 0, 0] })],
      [100, addO(LAUGH_ARMS, { h: [-19, 0, -2], j: 24, b: [-5, 0, 0, 0, 0, 0.6] })],
      [100, addO(LAUGH_ARMS, { h: [-15, 0, 2], j: 10, b: [-3, 0, 0, 0, 0, 0] })],
      [100, addO(LAUGH_ARMS, { h: [-17, 0, -2], j: 22, b: [-5, 0, 0, 0, 0, 0.5] })],
      [150, addO(LAUGH_ARMS, { h: [-12, 0, 0], j: 8, b: [-2, 0, 0, 0, 0, 0] })],
      [150, addO(LAUGH_ARMS, { h: [-9, 0, 0], j: 15, b: [-3, 0, 0, 0, 0, 0.3] })],
      [300, { h: [4, 0, 0], j: 3, aL: [-8, -4, 0], aR: [-8, 4, 0] }],
      [250, {}]
    ], false),
    // on all fours: diagonal pairs (left fore + right hind) reach / pass, roll + yaw lumber, bob on the passing keys
    walk: clip([
      [200, { b: [0, 3, 2, 0, 0, 0], aL: -22, aR: 16, lL: 18, lR: -16 }],
      [150, { b: [0, 0, 0, 0, 0, 0.6], h: [-2, 0, 0], aL: -4, aR: 4, lL: 2, lR: -2 }],
      [200, { b: [0, -3, -2, 0, 0, 0], aL: 16, aR: -22, lL: -16, lR: 18 }],
      [150, { b: [0, 0, 0, 0, 0, 0.6], h: [-2, 0, 0], aL: 4, aR: -4, lL: -2, lR: 2 }]
    ], true, QUAD),
    // upright in-place shuffle while the game turns the yaw
    turn: clip([
      [150, { lL: -16, b: [0, 2, 3, 0, 0, 0], h: [0, 0, 5], aL: -4, aR: 4 }],
      [150, { b: [0, 0, 0, 0, 0, -0.3] }],
      [150, { lR: -16, b: [0, -2, -3, 0, 0, 0], h: [0, 0, -5], aL: 4, aR: -4 }],
      [150, { b: [0, 0, 0, 0, 0, -0.3] }]
    ], true),
    drop: clip([
      [100, {}],
      [200, { b: [22, 0, 0, 0, 0, -0.5], aL: -45, aR: -45, lL: -18, lR: -18, h: [-14, 0, 0] }],
      [200, addO(QUAD, { b: [0, 0, 0, 0, 0, 1], aL: -12, aR: -10, h: [-6, 0, 0] })],
      [100, addO(QUAD, { b: [3, 0, 0, 0, 0, -0.6], aL: 2, aR: 2, h: [6, 0, 0] })],
      [150, QUAD]
    ], false),
    rise: clip([
      [100, QUAD],
      [150, addO(QUAD, { b: [4, 0, 0, 0, 0, -0.5], aL: 6, aR: 6, h: [4, 0, 0] })],
      [200, { b: [35, 0, 0, 0, 0, 0.8], aL: -30, aR: -30, lL: -35, lR: -35, h: [-30, 0, 0] }],
      [150, { b: [-4, 0, 0, 0, 0, 0.3], aL: 6, aR: 6, h: [3, 0, 0], e: [-8, 0, 0] }],
      [200, {}]
    ], false),
    sit: clip([
      [100, {}],
      [250, { b: [12, 0, 0, 0, 0, -3], lL: -35, lR: -35, aL: -18, aR: -18, h: [-8, 0, 0] }],
      [200, { b: [-14, 0, 0, 0, 0, -7.4], lL: -78, lR: -78, aL: -22, aR: -22, h: [8, 0, 0], e: [-10, 0, 0] }],
      [250, SIT]
    ], false),
    sitTalk: clip(TALK, true, SIT),
    standUp: clip([
      [100, SIT],
      [250, { b: [16, 0, 0, 0, 0, -5], lL: -45, lR: -45, aL: -30, aR: -30, h: [-6, 0, 0] }],
      [250, { b: [-3, 0, 0, 0, 0, 0.4], h: [2, 0, 0] }],
      [150, {}]
    ], false)
  };

  A.models.bear = {
    name: 'bear',
    displayName: 'brown bear',
    desc: 'v1.51 talking brown bear (friendly NPC): upright 2.0 m to the ear tips (1.85 m crown), also walks on all ' +
          'fours. Barrel torso with a shoulder hump and a lighter belly patch, flat broad skull with cheek ruffs, light ' +
          'muzzle with a dark nose, small dark eyes under level brows, round ears, a hinged jaw with tongue and teeth, ' +
          'thick arms with dark paws and pale-horn claws. 8 parts (body, head, jaw, ears, 2 arms, 2 legs): idle, talk, ' +
          'listen, wave, laugh, walk (on all fours), turn, drop, rise, sit, sitTalk, standUp.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: 0.05,
      size: [SX, SY, SZ],
      anchor: [14, 11, 0],
      light: false,
      mats: {
        B: 'skin_shade',     // body fur (warm mid brown)
        b: 'skin',           // face mask, belly patch, chin (lighter)
        M: 'skin_light',     // muzzle, lower lip (lightest)
        D: 'hair_dark',      // forearms, paws, lower legs, feet, inner ears, philtrum, mouth corners
        C: 'linen_dark',     // claws (cool horn grey)
        N: 'iron_dark',      // nose
        E: EYE_MAT,          // eyes
        R: 'gore_red_dark',  // mouth roof / floor
        T: 'gore_red',       // tongue
        W: 'linen_light'     // teeth
      },
      layers: buildLayers(),
      parts: {
        body: { box: [6, 6, 12, 22, 20, 30], pivot: [14, 13, 12] },
        head: { box: [7, 0, 30, 21, 15, 37], pivot: [14, 10, 30], parent: 'body' },
        jaw:  { box: [11, 1, 27, 17, 6, 30], pivot: [14, 6, 30], parent: 'head' },
        ears: { box: [7, 8, 37, 21, 12, 40], pivot: [14, 10, 37], parent: 'head' },
        armL: { box: [1, 7, 13, 6, 17, 30], pivot: [3.5, 12, 28.5], parent: 'body' },
        armR: { box: [22, 7, 13, 27, 17, 30], pivot: [24.5, 12, 28.5], parent: 'body' },
        legL: { box: [6, 4, 0, 13, 19, 12], pivot: [10, 13, 12], parent: 'body' },
        legR: { box: [15, 4, 0, 22, 19, 12], pivot: [18, 13, 12], parent: 'body' }
      },
      animations: animations,
      // grid coords, rest pose; they follow their part's animated pose (sitting lowers `speech`, etc.)
      mounts: {
        speech:   { at: [14, 10, 43], part: 'head' },   // 0.15 m over the ear tips: speech bubble / name tag anchor
        eyes:     { at: [14, 5, 33.5], part: 'head' },  // dialogue camera look-at (between the eyes)
        mouth:    { at: [14, 1.5, 30], part: 'head' },  // voice / breath puff origin
        interact: { at: [14, 6, 20], part: 'body' },    // [E] Talk prompt aim (chest, 1.0 m)
        pawR:     { at: [24.5, 11, 14], part: 'armR' }  // right paw (wave sparkle, a held item later)
      }
    }
  };

  // ===================================================================================================================
  // ASSETS.bearFx - presentation data for the NPC view + the dialogue box (no game logic here).
  // ===================================================================================================================
  A.bearFx = {
    version: 1,
    model: 'bear',
    clipFor: {
      state: { idle: 'idle', greet: 'wave', talk: 'talk', listen: 'listen', laugh: 'laugh', move: 'walk',
               turn: 'turn', sit: 'sit', sitTalk: 'sitTalk', standUp: 'standUp' },
      seated: { talk: 'sitTalk', listen: 'sit', idle: 'sit' },   // `sit` holds its last (seated) key
      once: { wave: 'idle', laugh: 'listen', drop: 'walk', rise: 'idle', sit: null, standUp: 'idle' },
      move: { start: 'drop', loop: 'walk', stop: 'rise' },
      note: 'once = non-loop clips and what follows them at animEnd (null = hold). Moving = drop (750 ms) -> walk ' +
            'loop -> rise (800 ms) on stop; the walk is tuned for ~1.0 m/s. Seated, the bear answers with sitTalk ' +
            'and listens holding the sit pose.'
    },
    talk: {
      jawPart: 'jaw', jawAxis: 'rx', jawOpenSign: 1, jawMaxDeg: JAW_MAX, jawPivot: [14, 6, 30],
      textCps: 28,                                   // suggested type-on speed of the dialogue box
      pauseMs: { ',': 180, ';': 180, ':': 180, '-': 180, '.': 380, '!': 380, '?': 380 },
      pauseKey: 8, pauseAtMs: 950,                   // talk key 8 = jaw closed; its start = 950 ms into the clip
      rule: 'play `talk` (seated: `sitTalk`) while the line types on. On a punctuation pause hold the clip at ' +
            'pauseAtMs (jaw closed) for pauseMs, then resume FROM pauseAtMs (seamless). When the line is fully shown ' +
            'switch to `listen`. Lines tagged happy play `laugh` once first. preview/voxel_bear.html does exactly this.'
    },
    sampleLine: { name: 'Bear', text: 'Hrrm. Easy, little one - I only bite honeycomb. Sit a while; the hill is quiet, ' +
                  'and I have stories.', note: 'placeholder text for the preview; the writer owns the real lines' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { bear: A.models.bear, bearFx: A.bearFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
