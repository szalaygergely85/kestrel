/* design/models/voxel_wolf.js - WOLF-D1 grey wolf (designer, v1.60) for WOLF-01 (game/js/quest/sim/wolfBrain.js).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_beast.js:
 *   <script src="../design/models/voxel_wolf.js">        (browser)
 *   import '../../../design/models/voxel_wolf.js';       (Node tests: side-effect import)
 * Sets ASSETS.models.wolf (format: design/README.md section 4/7, architecture.md 15.1) and ASSETS.wolfFx (clip -> state
 * map, timings, corpse data). NOT registered in game/js/main.js here (the main session swaps WOLF_MODEL). `meshOnly`.
 * Materials: fur_wolf / fur_wolf_dark / fur_wolf_light (appended to palette.js + detail-pass.js in v1.60), fur_cream,
 * iron_dark, linen_light, ember_glow.
 *
 * Axes (15.1): x = east (= the wolf's RIGHT at yaw 0), y = SOUTH with y0 = the nose tip (faces north at yaw 0), z = up.
 * cellM 0.05. Grid 10 x 33 x 22. Anchor [5, 13.5, 0] = on the ground, centred under nose..rump (boar rule). Clip `pos`
 * values are VOXELS. No flash shell (HIT-BLEED-01: hurt = jolt + the engine tint), so no underground copy.
 *
 * ANATOMY (realistic grey wolf from squares, style-guide 0; what separates it from a dog / the boar at 10 m):
 *   - 1.35 m nose to rump + a 0.45 m tail, 0.8 m at the withers (top voxel z15), 0.3 m wide: NARROW and TALL.
 *   - LONG LEGS: belly 0.55 m above the ground at the loin (tucked-up waist), chest bottom 0.4 m: you see sky under it.
 *   - DEEP NARROW CHEST: a keel brisket (2 wide) between close-set forelegs, the ribcage 8 voxels deep.
 *   - LONG MUZZLE (0.2 m, 2-4 wide) with a gentle stop, a black nose, a dark lip line, pale cheeks / muzzle sides.
 *   - UPRIGHT POINTED EARS (3 voxels, 2x2 -> 2x1 -> 1 tip, cream inner face, dark rims) set high on the back of the skull.
 *   - BUSHY TAIL hanging down and back (never curled up = the dog tell), dark precaudal spot at the root, black tip.
 *   - hind legs with a real hock (thigh -> angled shank -> hock point -> vertical metatarsus), elbows behind the forelegs.
 * Colour (natural, one grey hue family + cream): fur_wolf_dark saddle / cape / ear rims / tail tip > fur_wolf
 *   grizzled grey-brown flanks + head > fur_wolf_light legs, belly, lower flanks, buttocks > fur_cream throat bib,
 *   cheeks, upper lip, inner ears. Nose, lip line, toe tips iron_dark; 2 canine specks linen_light; amber eyes (EYE_MAT,
 *   1 voxel each, ember_glow = eyeshine readable at night like the boar; 'iron_dark' for plain eyes).
 *
 * Parts (8 = MAX_VOX_PARTS; insertion order = part index; parents EARLIER; every box sx+sy+sz <= 48, style-guide 5.14):
 *   body   box [0,8,8, 10,27,22]  pivot [8, 13.5, 0] = the wolf's RIGHT body edge, mid-length, on the ground (boar rule).
 *                                 Root. rx = pitch (+ = nose down), ry = roll (+ = top to the right; 90 = lying on its
 *                                 right side), rz = turn. The clip helper re-centres PITCH on the chest centre (11 voxels
 *                                 up), so a pitched key does not slide the wolf: authored b[4]/b[5] are extra offsets.
 *   head   box [0,0,11, 10,8,22]  pivot [5, 8, 13] (neck), parent body. rx + = nose down, ry = tilt, rz + = look right.
 *   jaw    box [2,0,9, 8,8,11]    pivot [5, 6, 11] (hinge under the ear), parent head. rx + = OPEN, 0..28.
 *   legFL / legFR  box [2|6, 9, 0, 4|8, 15, 8]   pivot [3|7, 12, 8]  (elbow height), parent body.
 *   legBL / legBR  box [2|6, 21, 0, 4|8, 27, 8]  pivot [3|7, 24, 8]  (stifle height, over the metatarsus so the heel
 *                                 does not dig in when the leg coils forward), parent body.
 *                                 rx - = foot forward, rx + = foot back (L = x small = the wolf's left). A key may lift
 *                                 a swinging leg (pos z +1).
 *   tail   box [2,27,4, 8,33,15]  pivot [5, 27, 13.5] (root), parent body. rx + = raised back (0 = hanging), ry = wag
 *                                 while hanging, rz = wag while raised.
 *
 * Clips (ms; multiples of 10, the sim-facing ones of 50 where the boar had them; ALL on four legs):
 *   idle    loop 2.0 s  2 keys: breathing (chest rises 1.5 cm, paws planted), head lifts a little and turns, tail sways.
 *   walk    loop 0.6 s  6 keys: TROT, diagonal pairs (FL+BR / FR+BL), swing legs lifted 5 cm, head carried low and level,
 *                       tail slightly raised. Foot-slide free at ~1.1 m/s; faster = play it faster (wolfFx.speeds).
 *   run     loop 0.36 s 6 keys: rotary GALLOP: extended flight, front landing, front stance, gathered flight, hind
 *                       landing, hind push. Head low and stretched, tail streaming back, mouth a little open.
 *   crouch  once 0.5 s  3 keys: the LUNGE TELEGRAPH. The wolf sinks 0.1-0.12 m, shifts its weight 0.27 m BACK (view-only),
 *                       hind legs coil under the belly, forelegs brace forward, head drops level and low (staring),
 *                       tail out stiff and low, lips part. Last key held = "about to jump" (AC1 at 8 m).
 *   leap    once 0.62 s 5 keys: launch (nose up, hind push) -> flight (0.3 m arc, forelegs reaching, jaws opening) ->
 *                       strike (jaws widest, key 2 at 250 ms) -> landing (jaws snap) -> landed stance (held). View-only
 *                       arc and the back-shift returns to 0; the sim moves the entity.
 *   bite    once 0.27 s 2 keys: head + chest lunge 0.1 m with the jaws wide, then snap shut (key 1 at 120 ms).
 *   hurt    once 0.1 s  2 keys (step): jolt head-up, 0.1 m back, yelp (jaw), tail clamps under.
 *   flinch  once 0.25 s 3 keys: follow-through to rest (same contract as the boar).
 *   die     once 0.5 s  5 keys (4 + settle, boar durations 90/110/120/80/100): yelp, legs buckle, roll onto the right
 *                       side about the right body edge, overshoot with the legs kicking, settle.
 *   dead    held        lying on its right side, jaw slack, legs out.   sink: 0.5 s, 0.4 m into the ground.
 *   Aliases for the unchanged boar view (beastView STATE_CLIPS / beastAnim): windup = crouch, charge = run.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 10, SY = 33, SZ = 22;
  var EYE_MAT = 'ember_glow';                       // 'iron_dark' = plain dark eyes
  var D2R = Math.PI / 180;
  var PIV_H = 11;                                   // pitch centre height over the body pivot (the chest centre)

  // ---- grid ----
  var g = [], gx, gy, gz;
  for (gz = 0; gz < SZ; gz++) { g.push([]); for (gy = 0; gy < SY; gy++) { g[gz].push([]); for (gx = 0; gx < SX; gx++) g[gz][gy].push('.'); } }
  function put(x, y, z, ch) { if (x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ) g[z][y][x] = ch; }
  // a centred row of width w (even, centred on x 5) at (y, z); col = a char or fn(x, x0, w) -> char
  function row(y, z, w, col) {
    var x0 = 5 - w / 2, x;
    for (x = x0; x < x0 + w; x++) put(x, y, z, typeof col === 'function' ? col(x, x0, w) : col);
  }
  function edge(outer, inner) { return function (x, x0, w) { return (x === x0 || x === x0 + w - 1) ? outer : inner; }; }

  // ---- body (y8 neck .. y26 buttocks): [zLo, zHi, width, kind] ----
  // kind n = neck (rounded top + bottom), k = keel chest (2-wide brisket, then w-2), a = arm slices (upper arms make the
  // bottom full width), b = barrel / loin (rounded), h = haunch (full-width thighs at the bottom).
  var BODY = {
    8: [10, 16, 6, 'n'], 9: [9, 16, 6, 'n'],
    10: [8, 15, 6, 'k'], 11: [8, 15, 6, 'a'], 12: [8, 15, 6, 'a'], 13: [8, 15, 6, 'k'],
    14: [9, 15, 6, 'b'], 15: [9, 14, 6, 'b'], 16: [10, 14, 6, 'b'],
    17: [11, 14, 6, 'b'], 18: [11, 14, 6, 'b'], 19: [11, 14, 6, 'b'], 20: [10, 14, 6, 'b'],
    21: [9, 14, 6, 'h'], 22: [8, 14, 6, 'h'], 23: [8, 14, 6, 'h'], 24: [8, 14, 6, 'h'], 25: [9, 13, 6, 'h'],
    26: [10, 13, 4, 'b']
  };
  function bodyWidth(p, z) {
    var w = p[2], k = p[3];
    if (z === p[1]) return w - 2;
    if (z === p[0]) return k === 'k' ? 2 : (k === 'a' || k === 'h') ? w : w - 2;
    if (z === p[0] + 1 && k === 'k') return w - 2;
    return w;
  }
  function bodyColor(x, y, z, p, x0, w) {
    var outer = (x === x0 || x === x0 + w - 1), zLo = p[0], zHi = p[1];
    if (y <= 10 && z <= zLo + 3) return 'C';                                    // pale throat bib + chest front
    if (z === zHi) return y <= 23 ? 'D' : 'G';                                  // dark cape + saddle along the top line
    if (z === zHi - 1 && y >= 10 && y <= 21 && !(outer && y % 3 === 0)) return 'D'; // saddle down the upper flank, ragged edge
    if (z === zHi - 2 && outer && y >= 11 && y <= 20 && y % 4 === 1) return 'D';  // dark guard-hair strands
    if (y >= 25 && z <= zHi - 2) return 'P';                                    // pale buttocks
    if (z === zLo) return 'P';                                                  // belly
    if (z === zLo + 1 && y >= 14 && y <= 22) return 'P';                        // pale lower flank at the loin / inner thigh
    return 'G';
  }
  (function buildBody() {
    var y, z, p, w, x0, x;
    for (y = 8; y <= 26; y++) {
      p = BODY[y];
      for (z = p[0]; z <= p[1]; z++) {
        w = bodyWidth(p, z); x0 = 5 - w / 2;
        for (x = x0; x < x0 + w; x++) put(x, y, z, bodyColor(x, y, z, p, x0, w));
      }
    }
  })();

  // ---- head (y0 nose .. y7 occiput), z >= 11; the jaw (z 9..10) is its own part ----
  row(0, 11, 2, 'C'); row(0, 12, 2, 'N');                                       // upper lip + black nose pad
  row(1, 11, 2, 'T'); row(1, 12, 2, 'G');                                       // canine specks under the muzzle top
  row(2, 11, 4, 'C'); row(2, 12, 4, edge('P', 'G')); row(2, 13, 2, 'D');        // muzzle: pale sides, dark bridge
  row(3, 11, 4, 'C'); row(3, 12, 4, edge('P', 'G')); row(3, 13, 4, edge('G', 'D'));
  row(4, 11, 6, 'C'); row(4, 12, 6, edge('C', 'G')); row(4, 13, 6, edge('E', 'G')); row(4, 14, 4, edge('P', 'D')); // stop, eyes, pale brows
  row(5, 11, 6, edge('C', 'P')); row(5, 12, 6, edge('C', 'G')); row(5, 13, 6, 'G'); row(5, 14, 6, 'G'); row(5, 15, 4, edge('G', 'D'));
  row(6, 11, 4, 'P'); row(6, 12, 6, edge('C', 'G')); row(6, 13, 6, 'G'); row(6, 14, 6, 'G'); row(6, 15, 6, 'G'); row(6, 16, 4, 'D');
  row(7, 11, 4, 'P'); row(7, 12, 6, 'G'); row(7, 13, 6, 'G'); row(7, 14, 6, 'G'); row(7, 15, 6, edge('G', 'D')); row(7, 16, 4, 'D');
  // ears: upright, pointed, tips a little out. z17 2x2 (cream inner face in front), z18 2x1 dark rim, z19 tip.
  function ear(xa, xb, tipX) {
    put(xa, 6, 17, 'C'); put(xb, 6, 17, 'C'); put(xa, 7, 17, 'G'); put(xb, 7, 17, 'G');
    put(xa, 7, 18, 'D'); put(xb, 7, 18, 'D');
    put(tipX, 7, 19, 'D');
  }
  ear(2, 3, 2); ear(6, 7, 7);

  // ---- jaw (y1..6, z 9..10): dark lip line, pale chin / throat ----
  row(1, 10, 2, 'C');
  row(2, 10, 2, 'N'); row(3, 10, 2, 'N');
  row(4, 10, 4, edge('N', 'C')); row(4, 9, 2, 'C');
  row(5, 10, 4, 'C'); row(5, 9, 4, 'C');
  row(6, 10, 4, 'C'); row(6, 9, 4, 'P');

  // ---- legs ----
  function frontLeg(x0) {                       // straight long foreleg, elbow behind, paw 3 deep with dark toe tips
    var z, y, d;
    for (z = 1; z <= 7; z++) for (y = 11; y <= 12; y++) for (d = 0; d < 2; d++) put(x0 + d, y, z, z <= 4 ? 'P' : 'G');
    for (z = 6; z <= 7; z++) for (d = 0; d < 2; d++) put(x0 + d, 13, z, 'G');     // elbow
    for (y = 10; y <= 12; y++) for (d = 0; d < 2; d++) put(x0 + d, y, 0, y === 10 ? 'N' : 'P');
  }
  // hind leg rows [z, yFrom, yTo, colour]: stifle under the haunch, shank angling back, hock point, metatarsus, paw
  var HIND = [[7, 22, 24, 'G'], [6, 23, 24, 'G'], [5, 23, 25, 'G'], [4, 24, 26, 'P'], [3, 24, 26, 'P'],
              [2, 24, 25, 'P'], [1, 24, 25, 'P'], [0, 23, 25, 'P']];
  function hindLeg(x0) {
    var i, y, d, r;
    for (i = 0; i < HIND.length; i++) {
      r = HIND[i];
      for (y = r[1]; y <= r[2]; y++) for (d = 0; d < 2; d++) put(x0 + d, y, r[0], (r[0] === 0 && y === 23) ? 'N' : r[3]);
    }
  }
  frontLeg(2); frontLeg(6); hindLeg(2); hindLeg(6);

  // ---- tail: bushy, hanging down-back from the croup. [yFrom, yTo, z, width, colour] ----
  var TAIL = [[27, 27, 13, 2, 'D'], [27, 28, 12, 2, 'G'], [28, 29, 11, 4, 'G'], [28, 29, 10, 4, 'G'],
              [29, 30, 9, 4, 'G'], [29, 30, 8, 4, 'G'], [29, 30, 7, 4, 'D'], [30, 31, 6, 2, 'D'], [30, 31, 5, 2, 'D']];
  (function buildTail() {
    var i, y, t;
    for (i = 0; i < TAIL.length; i++) { t = TAIL[i]; for (y = t[0]; y <= t[1]; y++) row(y, t[2], t[3], t[4]); }
  })();

  function layers() {
    var out = [], z, y;
    for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(g[z][y].join('')); out.push(rows); }
    return out;
  }

  // ---- pose helper ----
  // o = { b: [rx, ry, rz, px, py, pz] body (pitch re-centred on the chest), h / hy / hz head, j jaw, fl fr bl br legs,
  //       lift: { fl: 1, ... } (pos z of a swinging leg), plant: true (legs counter the body pos = paws stay put),
  //       t: [rx, ry, rz] tail }
  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }
  function pose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0], a = b[0] * D2R, t = o.t || [0, 0, 0], L = o.lift || {};
    var py = b[4] + PIV_H * Math.sin(a), pz = b[5] + PIV_H * (1 - Math.cos(a));
    var pl = o.plant ? 1 : 0;
    function leg(ang, k) { return { rot: [ang || 0, 0, 0], pos: [0, r3(-pl * b[4]), r3(-pl * b[5] + (L[k] || 0))] }; }
    return {
      body:  { rot: [b[0], b[1], b[2]], pos: [r3(b[3]), r3(py), r3(pz)] },
      head:  { rot: [o.h || 0, o.hy || 0, o.hz || 0] },
      jaw:   { rot: [o.j || 0, 0, 0] },
      legFL: leg(o.fl, 'fl'), legFR: leg(o.fr, 'fr'), legBL: leg(o.bl, 'bl'), legBR: leg(o.br, 'br'),
      tail:  { rot: [t[0] || 0, t[1] || 0, t[2] || 0] }
    };
  }
  var REST = pose({ t: [8, 0, 0] });
  var DEAD_O = { b: [0, 90, 0, 0, 0, 0], h: -8, j: 10, fl: -20, fr: -12, bl: 22, br: 14, t: [35, 0, 0] };
  var DEAD = pose(DEAD_O);
  var SUNK = pose({ b: [0, 90, 0, 0, 0, -8], h: -8, j: 10, fl: -20, fr: -12, bl: 22, br: 14, t: [35, 0, 0] });
  // telegraph keys. Leg angles keep the paws on the ground for the body drop (acos((8 - drop) / 8)); the body moves
  // back by ~ the forward paw travel (8 sin angle) so the paws do not slide.
  // (A leg's world angle = body rx + leg rx; checked per key in the preview "lowest paw" lines.)
  var CR_START = pose({ b: [1, 0, 0, 0, 4.0, -0.6], h: 6, fl: -31, fr: -30, bl: -37, br: -36, t: [25, 0, 0] });
  var CROUCH = pose({ b: [3, 0, 0, 0, 5.0, -1.8], h: 16, fl: -45, fr: -43, bl: -46, br: -48, t: [40, 0, 0] });
  var COILED = pose({ b: [4, 0, 0, 0, 5.4, -2.2], h: 18, j: 3, fl: -51, fr: -50, bl: -52, br: -50, t: [48, 0, 0] });

  // trot cycle: pair A = FL + BR, pair B = FR + BL (3 keys stance forward -> back, 3 keys swing lifted)
  var TA = [-24, -8, 8, 22, 4, -14], TAL = [0, 0, 0, 0, 1, 1];
  var TB = [22, 4, -14, -24, -8, 8], TBL = [0, 1, 1, 0, 0, 0];
  var TBZ = [-0.4, 0.1, 0.1, -0.4, 0.1, 0.1], TWAG = [4, 2, -2, -4, -2, 2];
  var trot = [], i;
  for (i = 0; i < 6; i++) {
    trot.push(pose({ b: [0, 0, 0, 0, 0, TBZ[i]], h: 8 + (i % 3 === 1 ? 1 : 0), fl: TA[i], br: TA[i], fr: TB[i], bl: TB[i],
                     lift: { fl: TAL[i], br: TAL[i], fr: TBL[i], bl: TBL[i] }, t: [18, TWAG[i], 0] }));
  }
  // rotary gallop: per-leg angle cycles (stance forward -> back, swing lifted), body pitch / height per key
  var GFL = [-55, -28, 10, 40, 20, -30], GFLl = [0, 0, 0, 0, 1, 1];
  var GFR = [-45, -40, -8, 32, 30, -10], GFRl = [0, 0, 0, 0, 1, 1];
  var GBL = [50, 25, -20, -45, -25, 20], GBLl = [0, 1, 1, 0, 0, 0];
  var GBR = [42, 35, -5, -38, -40, 5], GBRl = [0, 1, 1, 0, 0, 0];
  var GP = [0, 4, 3, 0, -4, -3], GZ = [1.2, 0.2, 0, 1.0, 0.2, 0.4], GH = [12, 15, 16, 12, 10, 11], GT = [5, 2, -3, -5, -2, 3];
  var gallop = [];
  for (i = 0; i < 6; i++) {
    gallop.push(pose({ b: [GP[i], 0, 0, 0, 0, GZ[i]], h: GH[i], j: 4, fl: GFL[i], fr: GFR[i], bl: GBL[i], br: GBR[i],
                       lift: { fl: GFLl[i], fr: GFRl[i], bl: GBLl[i], br: GBRl[i] }, t: [70, 0, GT[i]] }));
  }

  var animations = {
    // breathing loop (2 keys, 2 s): chest rises 1.5 cm with the paws planted, head lifts and turns a little, tail sways
    idle:   { durations: [1000, 1000], loop: true, frames: [
      pose({ t: [8, -4, 0] }),
      pose({ b: [-1, 0, 0, 0, 0, 0.3], plant: true, h: -3, hz: 6, t: [10, 5, 0] })
    ] },
    // GAIT-A BEGIN walk (tools/gen-gait.mjs: option A, diagonal gait, duty 0.55, tuned 1.1 m/s, 12 keys x 50 ms; re-run, do not hand-edit)
    walk: { durations: [50,50,50,50,50,50,50,50,50,50,50,50], loop: true, frames: [
        { body: { rot: [0.678,0.951,0], pos: [0,0,0.064] }, head: { rot: [-0.034,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-36.478,0,0], pos: [0,0,-0.77] }, legFR: { rot: [29.309,0,0], pos: [0,0,-0.212] }, legBL: { rot: [21.554,0,0], pos: [0,0,-0.475] }, legBR: { rot: [-34.106,0,0], pos: [0,0,-0.061] }, tail: { rot: [19.683,0,3.728], pos: [0,0,0] }, legFL2: { rot: [18.239,0,0], pos: [0,0,0] }, legFR2: { rot: [-14.654,0,0], pos: [0,0,0] }, legBL2: { rot: [0.926,0,0], pos: [0,0,0] }, legBR2: { rot: [17.053,0,0], pos: [0,0,0] } },
        { body: { rot: [1.196,0.669,0.75], pos: [0,0,0.12] }, head: { rot: [-0.06,0,-0.6], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-24.731,0,0], pos: [0,0,-0.36] }, legFR: { rot: [30.251,0,0], pos: [0,0,0.009] }, legBL: { rot: [44.009,0,0], pos: [0,0,-1.846] }, legBR: { rot: [-23.659,0,0], pos: [0,0,-0.056] }, tail: { rot: [19.777,0,3.953], pos: [0,0,0] }, legFL2: { rot: [12.365,0,0], pos: [0,0,0] }, legFR2: { rot: [-8.207,0,0], pos: [0,0,0] }, legBL2: { rot: [-27.77,0,0], pos: [0,0,0] }, legBR2: { rot: [11.829,0,0], pos: [0,0,0] } },
        { body: { rot: [0.519,0.208,1.299], pos: [0,0,0.056] }, head: { rot: [-0.026,0,-1.039], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-13.754,0,0], pos: [0,0,-0.08] }, legFR: { rot: [9.197,0,0], pos: [0,0,1.097] }, legBL: { rot: [41.005,0,0], pos: [0,0,-1.322] }, legBR: { rot: [-13.422,0,0], pos: [0,0,0.111] }, tail: { rot: [18.094,0,3.119], pos: [0,0,0] }, legFL2: { rot: [6.877,0,0], pos: [0,0,0] }, legFR2: { rot: [17.223,0,0], pos: [0,0,0] }, legBL2: { rot: [-38.687,0,0], pos: [0,0,0] }, legBR2: { rot: [6.711,0,0], pos: [0,0,0] } },
        { body: { rot: [-0.678,-0.309,1.5], pos: [0,0,-0.064] }, head: { rot: [0.034,0,-1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-3.152,0,0], pos: [0,0,0.101] }, legFR: { rot: [-13.634,0,0], pos: [0,0,1.372] }, legBL: { rot: [23.474,0,0], pos: [0,0,0.313] }, legBR: { rot: [-3.135,0,0], pos: [0,0,0.302] }, tail: { rot: [16.317,0,1.449], pos: [0,0,0] }, legFL2: { rot: [1.576,0,0], pos: [0,0,0] }, legFR2: { rot: [36.361,0,0], pos: [0,0,0] }, legBL2: { rot: [-36.357,0,0], pos: [0,0,0] }, legBR2: { rot: [1.567,0,0], pos: [0,0,0] } },
        { body: { rot: [-1.196,-0.743,1.299], pos: [0,0,-0.12] }, head: { rot: [0.06,0,-1.039], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [7.368,0,0], pos: [0,0,0.215] }, legFR: { rot: [-32.655,0,0], pos: [0,0,0.631] }, legBL: { rot: [1.025,0,0], pos: [0,0,1.194] }, legBR: { rot: [7.47,0,0], pos: [0,0,0.273] }, tail: { rot: [16.223,0,-0.609], pos: [0,0,0] }, legFL2: { rot: [-3.684,0,0], pos: [0,0,0] }, legFR2: { rot: [43.874,0,0], pos: [0,0,0] }, legBL2: { rot: [-23.468,0,0], pos: [0,0,0] }, legBR2: { rot: [-3.735,0,0], pos: [0,0,0] } },
        { body: { rot: [-0.519,-0.978,0.75], pos: [0,0,-0.056] }, head: { rot: [0.026,0,-0.6], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [18.081,0,0], pos: [0,0,0.193] }, legFR: { rot: [-41.815,0,0], pos: [0,0,-0.363] }, legBL: { rot: [-19.914,0,0], pos: [0,0,0.911] }, legBR: { rot: [17.635,0,0], pos: [0,0,-0.085] }, tail: { rot: [17.906,0,-2.504], pos: [0,0,0] }, legFL2: { rot: [-9.041,0,0], pos: [0,0,0] }, legFR2: { rot: [37.393,0,0], pos: [0,0,0] }, legBL2: { rot: [-3.781,0,0], pos: [0,0,0] }, legBR2: { rot: [-7.372,0,0], pos: [0,0,0] } },
        { body: { rot: [0.678,-0.951,0], pos: [0,0,0.064] }, head: { rot: [-0.034,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [29.309,0,0], pos: [0,0,-0.112] }, legFR: { rot: [-36.478,0,0], pos: [0,0,-0.67] }, legBL: { rot: [-34.106,0,0], pos: [0,0,0.038] }, legBR: { rot: [21.554,0,0], pos: [0,0,-0.375] }, tail: { rot: [19.683,0,-3.728], pos: [0,0,0] }, legFL2: { rot: [-14.654,0,0], pos: [0,0,0] }, legFR2: { rot: [18.239,0,0], pos: [0,0,0] }, legBL2: { rot: [17.053,0,0], pos: [0,0,0] }, legBR2: { rot: [0.926,0,0], pos: [0,0,0] } },
        { body: { rot: [1.196,-0.669,-0.75], pos: [0,0,0.12] }, head: { rot: [-0.06,0,0.6], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [30.251,0,0], pos: [0,0,0.079] }, legFR: { rot: [-24.731,0,0], pos: [0,0,-0.29] }, legBL: { rot: [-23.659,0,0], pos: [0,0,0.014] }, legBR: { rot: [44.009,0,0], pos: [0,0,-1.776] }, tail: { rot: [19.777,0,-3.953], pos: [0,0,0] }, legFL2: { rot: [-8.207,0,0], pos: [0,0,0] }, legFR2: { rot: [12.365,0,0], pos: [0,0,0] }, legBL2: { rot: [11.829,0,0], pos: [0,0,0] }, legBR2: { rot: [-27.77,0,0], pos: [0,0,0] } },
        { body: { rot: [0.519,-0.208,-1.299], pos: [0,0,0.056] }, head: { rot: [-0.026,0,1.039], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [9.197,0,0], pos: [0,0,1.119] }, legFR: { rot: [-13.754,0,0], pos: [0,0,-0.058] }, legBL: { rot: [-13.422,0,0], pos: [0,0,0.132] }, legBR: { rot: [41.005,0,0], pos: [0,0,-1.3] }, tail: { rot: [18.094,0,-3.119], pos: [0,0,0] }, legFL2: { rot: [17.223,0,0], pos: [0,0,0] }, legFR2: { rot: [6.877,0,0], pos: [0,0,0] }, legBL2: { rot: [6.711,0,0], pos: [0,0,0] }, legBR2: { rot: [-38.687,0,0], pos: [0,0,0] } },
        { body: { rot: [-0.678,0.309,-1.5], pos: [0,0,-0.064] }, head: { rot: [0.034,0,1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-13.634,0,0], pos: [0,0,1.339] }, legFR: { rot: [-3.152,0,0], pos: [0,0,0.069] }, legBL: { rot: [-3.135,0,0], pos: [0,0,0.269] }, legBR: { rot: [23.474,0,0], pos: [0,0,0.281] }, tail: { rot: [16.317,0,-1.449], pos: [0,0,0] }, legFL2: { rot: [36.361,0,0], pos: [0,0,0] }, legFR2: { rot: [1.576,0,0], pos: [0,0,0] }, legBL2: { rot: [1.567,0,0], pos: [0,0,0] }, legBR2: { rot: [-36.357,0,0], pos: [0,0,0] } },
        { body: { rot: [-1.196,0.743,-1.299], pos: [0,0,-0.12] }, head: { rot: [0.06,0,1.039], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-32.655,0,0], pos: [0,0,0.553] }, legFR: { rot: [7.368,0,0], pos: [0,0,0.137] }, legBL: { rot: [7.47,0,0], pos: [0,0,0.195] }, legBR: { rot: [1.025,0,0], pos: [0,0,1.116] }, tail: { rot: [16.223,0,0.609], pos: [0,0,0] }, legFL2: { rot: [43.874,0,0], pos: [0,0,0] }, legFR2: { rot: [-3.684,0,0], pos: [0,0,0] }, legBL2: { rot: [-3.735,0,0], pos: [0,0,0] }, legBR2: { rot: [-23.468,0,0], pos: [0,0,0] } },
        { body: { rot: [-0.519,0.978,-0.75], pos: [0,0,-0.056] }, head: { rot: [0.026,0,0.6], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-41.815,0,0], pos: [0,0,-0.465] }, legFR: { rot: [18.081,0,0], pos: [0,0,0.091] }, legBL: { rot: [17.635,0,0], pos: [0,0,-0.188] }, legBR: { rot: [-19.914,0,0], pos: [0,0,0.809] }, tail: { rot: [17.906,0,2.504], pos: [0,0,0] }, legFL2: { rot: [37.393,0,0], pos: [0,0,0] }, legFR2: { rot: [-9.041,0,0], pos: [0,0,0] }, legBL2: { rot: [-7.372,0,0], pos: [0,0,0] }, legBR2: { rot: [-3.781,0,0], pos: [0,0,0] } }
    ] },
    // GAIT-A END walk
    // GAIT-A BEGIN run (tools/gen-gait.mjs: option A, gallop gait, duty 0.4, tuned 2.4 m/s, 8 keys x 50 ms; re-run, do not hand-edit)
    run: { durations: [50,50,50,50,50,50,50,50], loop: true, frames: [
        { body: { rot: [2.259,1.427,0], pos: [0,0,0.321] }, head: { rot: [-1.242,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-38.857,0,0], pos: [0,0,-1.053] }, legFR: { rot: [-42.039,0,0], pos: [0,0,-0.122] }, legBL: { rot: [42.263,0,0], pos: [0,0,-1.523] }, legBR: { rot: [42.702,0,0], pos: [0,0,-2.319] }, tail: { rot: [71.683,0,3.728], pos: [0,0,0] }, legFL2: { rot: [19.428,0,0], pos: [0,0,0] }, legFR2: { rot: [33.519,0,0], pos: [0,0,0] }, legBL2: { rot: [-28.631,0,0], pos: [0,0,0] }, legBR2: { rot: [-21.351,0,0], pos: [0,0,0] } },
        { body: { rot: [3.301,0.681,1.061], pos: [0,0,0.507] }, head: { rot: [-1.816,0,-0.849], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-13.852,0,0], pos: [0,0,-0.48] }, legFR: { rot: [-33.494,0,0], pos: [0,0,-0.84] }, legBL: { rot: [24.479,0,0], pos: [0,0,-0.399] }, legBR: { rot: [39.814,0,0], pos: [0,0,-1.512] }, tail: { rot: [71.081,0,3.661], pos: [0,0,0] }, legFL2: { rot: [6.926,0,0], pos: [0,0,0] }, legFR2: { rot: [16.747,0,0], pos: [0,0,0] }, legBL2: { rot: [-26.098,0,0], pos: [0,0,0] }, legBR2: { rot: [-29.039,0,0], pos: [0,0,0] } },
        { body: { rot: [-2.259,-0.464,1.5], pos: [0,0,-0.321] }, head: { rot: [1.242,0,-1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [9.197,0,0], pos: [0,0,0.358] }, legFR: { rot: [-9.197,0,0], pos: [0,0,0.288] }, legBL: { rot: [0.176,0,0], pos: [0,0,2.743] }, legBR: { rot: [19.818,0,0], pos: [0,0,2.075] }, tail: { rot: [68.317,0,1.449], pos: [0,0,0] }, legFL2: { rot: [-4.598,0,0], pos: [0,0,0] }, legFR2: { rot: [4.598,0,0], pos: [0,0,0] }, legBL2: { rot: [-14.577,0,0], pos: [0,0,0] }, legBR2: { rot: [-24.398,0,0], pos: [0,0,0] } },
        { body: { rot: [-3.301,-1.337,1.061], pos: [0,0,-0.507] }, head: { rot: [1.816,0,-0.849], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [33.494,0,0], pos: [0,0,0.364] }, legFR: { rot: [13.852,0,0], pos: [0,0,0.509] }, legBL: { rot: [-22.534,0,0], pos: [0,0,2.581] }, legBR: { rot: [-4.704,0,0], pos: [0,0,3.109] }, tail: { rot: [68.919,0,-1.611], pos: [0,0,0] }, legFL2: { rot: [-16.747,0,0], pos: [0,0,0] }, legFR2: { rot: [-6.926,0,0], pos: [0,0,0] }, legBL2: { rot: [2.135,0,0], pos: [0,0,0] }, legBR2: { rot: [-11.506,0,0], pos: [0,0,0] } },
        { body: { rot: [2.259,-1.427,0], pos: [0,0,0.321] }, head: { rot: [-1.242,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [23.847,0,0], pos: [0,0,0.933] }, legFR: { rot: [38.857,0,0], pos: [0,0,-0.762] }, legBL: { rot: [-36.149,0,0], pos: [0,0,-0.463] }, legBR: { rot: [-26.273,0,0], pos: [0,0,0.514] }, tail: { rot: [71.683,0,-3.728], pos: [0,0,0] }, legFL2: { rot: [0.576,0,0], pos: [0,0,0] }, legFR2: { rot: [-19.428,0,0], pos: [0,0,0] }, legBL2: { rot: [18.075,0,0], pos: [0,0,0] }, legBR2: { rot: [5.636,0,0], pos: [0,0,0] } },
        { body: { rot: [3.301,-0.681,-1.061], pos: [0,0,0.507] }, head: { rot: [-1.816,0,0.849], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-1.56,0,0], pos: [0,0,1.973] }, legFR: { rot: [19.04,0,0], pos: [0,0,0.995] }, legBL: { rot: [-13.514,0,0], pos: [0,0,-0.814] }, legBR: { rot: [-31.507,0,0], pos: [0,0,-0.84] }, tail: { rot: [71.081,0,-3.661], pos: [0,0,0] }, legFL2: { rot: [23.877,0,0], pos: [0,0,0] }, legFR2: { rot: [5.699,0,0], pos: [0,0,0] }, legBL2: { rot: [6.757,0,0], pos: [0,0,0] }, legBR2: { rot: [15.754,0,0], pos: [0,0,0] } },
        { body: { rot: [-2.259,0.464,-1.5], pos: [0,0,-0.321] }, head: { rot: [1.242,0,1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-25.701,0,0], pos: [0,0,1.959] }, legFR: { rot: [-6.725,0,0], pos: [0,0,2.574] }, legBL: { rot: [9.357,0,0], pos: [0,0,0.587] }, legBR: { rot: [-9.047,0,0], pos: [0,0,0.982] }, tail: { rot: [68.317,0,-1.449], pos: [0,0,0] }, legFL2: { rot: [36.999,0,0], pos: [0,0,0] }, legFR2: { rot: [27.51,0,0], pos: [0,0,0] }, legBL2: { rot: [-4.679,0,0], pos: [0,0,0] }, legBR2: { rot: [4.524,0,0], pos: [0,0,0] } },
        { body: { rot: [-3.301,1.337,-1.061], pos: [0,0,-0.507] }, head: { rot: [1.816,0,0.849], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, legFL: { rot: [-40.846,0,0], pos: [0,0,0.51] }, legFR: { rot: [-29.72,0,0], pos: [0,0,1.773] }, legBL: { rot: [24.637,0,0], pos: [0,0,0.84] }, legBR: { rot: [14.226,0,0], pos: [0,0,0.903] }, tail: { rot: [68.919,0,1.611], pos: [0,0,0] }, legFL2: { rot: [35.642,0,0], pos: [0,0,0] }, legFR2: { rot: [37.957,0,0], pos: [0,0,0] }, legBL2: { rot: [1,0,0], pos: [0,0,0] }, legBR2: { rot: [-7.113,0,0], pos: [0,0,0] } }
    ] },
    // GAIT-A END run
    // lunge telegraph 0.5 s: sink + weight back (100 ms), crouched (300 ms), coiled + held (last 100 ms and after)
    crouch: { durations: [100, 300, 100], loop: false, frames: [CR_START, CROUCH, COILED] },
    // leap 0.62 s: launch -> flight -> strike (jaws widest) -> land (snap) -> landed (held)
    leap:   { durations: [100, 150, 150, 120, 100], loop: false, frames: [
      pose({ b: [-16, 0, 0, 0, 4, 2], h: -8, j: 14, fl: -70, fr: -62, bl: 49, br: 47, t: [55, 0, 0] }),
      pose({ b: [-6, 0, 0, 0, 2, 5], h: -4, j: 24, fl: -78, fr: -72, bl: 60, br: 55, t: [75, 0, 0] }),
      pose({ b: [4, 0, 0, 0, 0, 6], h: 6, j: 28, fl: -60, fr: -55, bl: 50, br: 45, t: [80, 0, 4] }),
      pose({ b: [8, 0, 0, 0, -1, 1.5], h: 12, j: 6, fl: -25, fr: -20, bl: 20, br: 15, t: [65, 0, 0] }),
      pose({ b: [3, 0, 0, 0, 0, -0.3], h: 10, fl: -6, fr: -2, bl: -10, br: -8, t: [35, 0, 0] })
    ] },
    // bite 0.27 s: lunge 0.1 m with the jaws wide, snap shut at 120 ms (held)
    bite:   { durations: [120, 150], loop: false, frames: [
      pose({ b: [2, 0, 0, 0, -2, 0], h: 4, j: 28, fl: -10, fr: -14, bl: 8, br: 6, t: [40, 0, 0] }),
      pose({ b: [2, 0, 0, 0, -1, 0], h: 10, j: 0, fl: -6, fr: -8, bl: 6, br: 4, t: [35, 0, 0] })
    ] },
    // hit: 2 step keys (100 ms), jolt head-up and 0.1 m back, yelp, tail clamps under
    hurt:   { durations: [50, 50], loop: false, interp: 'step', frames: [
      pose({ b: [-8, 0, 0, 0, 3.5, 1.5], h: -10, j: 14, fl: 8, fr: 8, bl: 8, br: 8, t: [-10, 0, 0] }),
      pose({ b: [-5, 0, 0, 0, 3, 1], h: -6, j: 8, fl: 5, fr: 5, bl: 5, br: 5, t: [-8, 0, 0] })
    ] },
    flinch: { durations: [60, 90, 100], loop: false, frames: [
      pose({ b: [-5, 0, 0, 0, 3, 1], h: -4, j: 4, fl: 5, fr: 5, bl: 5, br: 5, t: [-10, 0, 0] }),
      pose({ b: [3, 0, 0, 0, 1, 0], h: 10, fl: 8, fr: 8, t: [5, 0, 0] }),
      REST
    ] },
    // die 0.5 s (boar timeline): yelp, legs buckle, roll onto the right side, overshoot + leg kick (thud key 3), settle
    die:    { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      pose({ b: [-6, 0, 0, 0, 0, 1], h: -16, j: 22, fl: 6, fr: 6, bl: 6, br: 6, t: [-5, 0, 0] }),
      pose({ b: [4, 18, 0, 0, 0, -1], h: 8, j: 10, fl: 28, fr: 24, bl: -22, br: -18, t: [10, 0, 0] }),
      pose({ b: [2, 62, 0, 0, 0, -0.6], h: 4, j: 6, fl: -10, fr: -6, bl: 14, br: 10, t: [20, 0, 0] }),
      pose({ b: [0, 98, 0, 0, 0, 0], h: -8, j: 12, fl: -32, fr: -26, bl: 30, br: 24, t: [30, 0, 0] }),
      DEAD
    ] },
    dead:   { durations: [1000], loop: true, frames: [DEAD] },
    // sink 0.5 s, 0.4 m: the lying wolf is <= 0.35 m tall, nothing pops when the entity is hidden
    sink:   { durations: [500, 100], loop: false, frames: [DEAD, SUNK] }
  };
  animations.windup = animations.crouch;           // aliases: the boar view (beastView / beastAnim) works unchanged
  animations.charge = animations.run;
  // ANIM-BLEND-02: additive hit (architecture.md 38.68): frame 0 = REST (delta 0), jolt = the two hurt keys, back to REST. Masked to body/head/jaw/tail.
  animations.hitAdd = { durations: [40, 50, 70, 100], loop: false, frames: [REST, animations.hurt.frames[0], animations.hurt.frames[1], REST] };

  A.models.wolf = {
    name: 'wolf',
    displayName: 'grey wolf',
    desc: 'WOLF-D1 grey wolf: 1.35 m nose to rump + a 0.45 m bushy hanging tail, 0.8 m at the withers, long legs, narrow ' +
          'deep chest, long muzzle, upright pointed ears; grizzled grey-brown with a dark saddle, pale legs / belly, cream ' +
          'bib and cheeks, amber eyes. 8 parts (body, head, jaw, 4 legs, tail): breathing idle, trot, gallop, crouch ' +
          'telegraph, leap, bite, hurt, flinch, roll-over death, corpse, sink.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: 0.05,
      size: [SX, SY, SZ],
      anchor: [5, 13.5, 0],
      mats: {
        G: 'fur_wolf',          // grizzled grey-brown flanks, head, upper legs, tail
        D: 'fur_wolf_dark',     // saddle, cape, ear rims, muzzle bridge, tail root + tip
        P: 'fur_wolf_light',    // legs, belly, lower flanks, buttocks, muzzle sides
        C: 'fur_cream',         // throat bib, cheeks, upper lip, chin, inner ears
        N: 'iron_dark',         // nose pad, lip line, toe tips
        T: 'linen_light',       // canine specks
        E: EYE_MAT              // eyes
      },
      layers: layers(),
      parts: {
        body:  { box: [0, 8, 8, SX, 27, SZ], pivot: [8, 13.5, 0] },
        head:  { box: [0, 0, 11, SX, 8, SZ], pivot: [5, 8, 13], parent: 'body' },
        jaw:   { box: [2, 0, 9, 8, 8, 11], pivot: [5, 6, 11], parent: 'head' },
        legFL: { box: [2, 9, 4, 4, 15, 8], pivot: [3, 12, 8], parent: 'body' },
        legFR: { box: [6, 9, 4, 8, 15, 8], pivot: [7, 12, 8], parent: 'body' },
        legBL: { box: [2, 21, 4, 4, 27, 8], pivot: [3, 24, 8], parent: 'body' },
        legBR: { box: [6, 21, 4, 8, 27, 8], pivot: [7, 24, 8], parent: 'body' },
        tail:  { box: [2, 27, 4, 8, 33, 15], pivot: [5, 27, 13.5], parent: 'body' },
        // ANIM-B-01b lower leg parts (appended: indices 0-7 unchanged). Split z4 (elbow / hock); hind hock pivot y25.5 = behind the hip-foot line
        legFL2: { box: [2, 9, 0, 4, 15, 4], pivot: [3, 12, 4], parent: 'legFL' },
        legFR2: { box: [6, 9, 0, 8, 15, 4], pivot: [7, 12, 4], parent: 'legFR' },
        legBL2: { box: [2, 21, 0, 4, 27, 4], pivot: [3, 25.5, 4], parent: 'legBL' },
        legBR2: { box: [6, 21, 0, 8, 27, 4], pivot: [7, 25.5, 4], parent: 'legBR' }
      },
      // ANIM-B-01b (note 38.67 item 2): walk / run are generated by tools/gen-gait.mjs from tools/gait-configs.mjs (wolf.walk / wolf.run); keep these numbers = that config
      legRig: {
        body: 'body',
        legs: [
          { upper: 'legFL', lower: 'legFL2', foot: [3, 12, 0], bend: 'front' },
          { upper: 'legFR', lower: 'legFR2', foot: [7, 12, 0], bend: 'front' },
          { upper: 'legBL', lower: 'legBL2', foot: [3, 24.5, 0], bend: 'back' },
          { upper: 'legBR', lower: 'legBR2', foot: [7, 24.5, 0], bend: 'back' }
        ],
        gaits: {
          walk: { tunedMps: 1.1, duty: 0.55, phase: [0, 0.5, 0.5, 0], liftM: 0.05 },
          run: { tunedMps: 2.4, duty: 0.4, phase: [0, 0.1, 0.5, 0.6], liftM: 0.1 }
        },
        stand: ['idle', 'crouch']
      },
      animations: animations,
      // ANIM-BLEND-02 (38.68; OB-150 readable wind-up / recover). Sets use legRig tunedMps. crouch (500 ms, last key held from 400) fades in
      // <= 25 %; leap / bite snap in (60 ms); recovering to run / walk / idle takes >= 150 ms (200) so the wolf visibly settles.
      blend: {
        sets: { locomotion: { param: 'speed', clips: [{ clip: 'walk', at: 1.1 }, { clip: 'run', at: 2.4 }] } },
        fades: {
          default: 150,
          into: { crouch: 100, windup: 100, leap: 60, bite: 60 },
          pairs: { 'crouch>leap': 60, 'leap>run': 200, 'leap>walk': 200, 'leap>idle': 200, 'bite>run': 200, 'bite>walk': 200, 'bite>idle': 200 }
        },
        additive: { hit: { clip: 'hitAdd', parts: ['body', 'head', 'jaw', 'tail'], inMs: 40, outMs: 160, gain: 1 } }
      },
      // grid coords, rest pose. Same names / parts as the boar (notice / forefeet / hit / loot on `body`) + `mouth`.
      mounts: {
        notice:   { at: [5, 6, 24], part: 'body' },      // 1.2 m: 0.25 m over the ear tips
        forefeet: { at: [5, 11, 0.4], part: 'body' },    // dust origin between the forepaws
        hit:      { at: [5, 15, 12], part: 'body' },     // flank centre (0.6 m)
        loot:     { at: [1.5, 15, 12], part: 'body' },   // off the LEFT flank = the top of the corpse (dead pose)
        mouth:    { at: [5, 1, 10.5], part: 'head' }     // between the jaws (bite fx / blood point)
      }
    }
  };

  // ===================================================================================================================
  // ASSETS.wolfFx - presentation data for WOLF-01. Steps = 60 Hz sim steps. Particles reuse the boar presets
  // (boarFx.attach: corpseDust, scrapeDust, hurtBristle).
  // ===================================================================================================================
  A.wolfFx = {
    version: 1,
    story: 'WOLF-D1 (model + clips) for WOLF-01 (brain)',
    model: 'wolf',
    clipFor: {
      state: { idle: 'idle', wander: 'walk', stalk: 'walk', circle: 'walk', return: 'walk', notice: 'idle',
               chase: 'run', flee: 'run', telegraph: 'crouch', windup: 'crouch', lunge: 'leap', leap: 'leap', charge: 'leap',
               bite: 'bite', eat: 'eat', recover: 'run', stagger: 'flinch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink',
      note: 'wolfBrain state names may differ: map them here. The boar view keeps working through the aliases ' +
            'windup = crouch, charge = run (beastView STATE_CLIPS / beastAnim BEAST_ANIM_DEF)'
    },
    // ground speed each moving clip is authored for (m/s at playback rate 1); faster = scale the clip rate
    speeds: { walk: 1.1, run: 7.0, note: 'trot 0.6 s cycle is foot-slide free at ~1.1 m/s; at 1.6-2 m/s play it 1.5-1.8x' },
    telegraph: { clip: 'crouch', ms: 500, backM: 0.27, dropM: 0.11,
                 note: 'view-only: the wolf sinks and shifts its weight back; the last key is held until the leap starts. ' +
                       'An arrow during the crouch cancels the leap (sim) -> play hurt / flinch.' },
    leap: { clip: 'leap', ms: 620, arcM: 0.3, jawsWideKey: 2, jawsWideMs: 250, snapKey: 3, snapMs: 400,
            note: 'view-only arc (body pos z), the clip ends on the landed stance (held). The sim moves the entity; ' +
                  'deal the bite damage near jawsWideMs..snapMs' },
    bite: { clip: 'bite', ms: 270, snapKey: 1, snapMs: 120 },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 9, note: 'same as boarFx.hurt (no flash shell)' },
    death: {
      note: 'same timeline as boarFx.death (hurt 6 steps -> die 24 -> thud dust at 25 -> dead + lootable at 30 -> sink 30)',
      corpseCentre: { rightM: 0.6, fwdM: 0, upM: 0.15, note: 'rolled about the right body edge: the lying body spans ' +
                      '0.15 .. 0.95 m to the right, 0 .. 0.35 m up (entity frame, right = +x at yaw 0)' },
      lootInteract: { prompt: '[E] Loot wolf', radiusM: 1.6, aimUpM: 0.25 },
      sink: { clip: 'sink', steps: 30, depthM: 0.4 }
    },
    notice: { noticeUpM: 1.2, note: 'beastView draws the `!` at 1.1 m today; 1.2 clears the ear tips (0.95 m)' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { wolf: A.models.wolf, wolfFx: A.wolfFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
