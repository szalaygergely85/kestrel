/* design/models/voxel_lynx.js - the EURASIAN LYNX (designer, OB-153 "more creature types"; docs/epics/ep-bestiary.md BEAST-D2,
 *                              ambusher: hidden, pounce <= 8 m). content/beasts/kinds.json "lynx" uses model id `lynx`.
 *                              Binding rules: design/style-guide.md section 0 (realistic shapes from voxels, all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4), stand-alone (clones nothing), same loading convention as
 * design/models/voxel_crocodile.js:
 *   <script src="../design/models/voxel_lynx.js">   (browser, after palette.js + detail-pass.js and AFTER voxel_eat_clips.js)
 *   import '../design/models/voxel_lynx.js';        (Node tests: side-effect import, after palette + detail-pass)
 * Sets ASSETS.models.lynx and ASSETS.lynxFx; when ASSETS.eatFx exists (voxel_eat_clips.js loaded first) it appends
 * 'lynx' to eatFx.models so beastView plays `eat` at a kill. `meshOnly: true` (12 parts > 8). Only merged palette materials.
 *
 * Axes (15.1): x = east (= the lynx's RIGHT at yaw 0), y = SOUTH with y0 = the nose (faces north at yaw 0), z = up.
 * cellM 0.05. Grid 10 x 26 x 17: 1.1 m nose to rump + a 0.2 m tail, 0.62 m at the withers, 0.67 m at the rump (hind legs
 * longer: the cat's rump-high stance), 0.3 m wide trunk. Anchor [5, 14.5, 0] = between the four paws. Centre x = 5.0
 * (cells 4 | 5). Clip `pos` values are VOXELS.
 *
 * Anatomy (realistic, from squares): a short ROUND cat head (short muzzle, forward-facing amber eyes, pale brows, dark
 * forehead bars), tall triangular ears with BLACK TUFTS and dark backs, the flared FACIAL RUFF (cream with black bars)
 * hanging beside the jaw, a compact trunk on LONG legs with big furry paws, the rump higher than the shoulders, a deep
 * chest and a tucked loin, and the SHORT stubby tail with a solid black tip. Spotted tawny coat: tawny back (T), buff-grey
 * lower flanks and legs (G), dark brown spots, denser on the haunch and legs (S), cream belly / bib / chin / inner legs
 * (W), black tufts, ear backs, ruff bars, lip corners and tail tip (K), brick-pink nose (N), amber eyeshine (E).
 *
 * Parts (12 <= MAX_VOX_PARTS 16; insertion order = part index; every parent EARLIER; boxes claim voxels in order):
 *   body   box [0,5,6, 10,22,17]  pivot [5, 14.5, 9]   neck, trunk, haunch. rx + = nose down, ry + = roll top to the right.
 *   head   box [0,0,9, 10,5,17]   pivot [5, 5, 11]     skull, ears, ruff, upper jaw. rx + = nose down, rz + = look right.
 *   jaw    box [2,0,7, 8,5,9]     pivot [5, 4.5, 9]    lower jaw (z8). OPEN = rx + (0 .. JAW_MAX 32).
 *   tail   box [3,22,4, 7,26,14]  pivot [5, 22, 12]    short tail. rx + = raised, ry = sway (tip to the left at +).
 *   legFL / legFR  forearm (elbow pivot [3|7, 10, 6]); legBL / legBR gaskin (stifle pivot [3|7, 19, 6]);
 *   legFL2 .. legBR2 lower legs (D-101 knee rig, `<upper>2`, parent = upper): carpus pivot [3|7, 9.2, 2] (bend 'front'),
 *                  hock pivot [3|7, 21, 3] (bend 'back'). rx - = foot forward.
 *
 * Clips (ms; ALL on four legs; feet planted by an in-file 2-bone solve = the engine's 38.67 maths):
 *   idle    loop 3.0 s  6 keys: standing, breathing, a slow glance right and back, tail-tip flick.
 *   walk    loop 0.8 s  10 keys: lateral-sequence cat walk (LH LF RH RF), duty 0.6, tuned 0.6 m/s, low and level.
 *   run     loop 0.4 s  8 keys: bounding gallop, duty 0.35, tuned 2.2 m/s, spine rocks 5 deg.  charge = run (alias).
 *   alert   loop 1.6 s  4 keys: head up, staring, ears high, tail twitching (notice).
 *   windup  once 0.4 s  4 keys: the POUNCE TELEGRAPH: sinks 0.12 m, weight back, forepaws forward, head low and level,
 *                       hind feet tread (butt wiggle), tail tip twitches. Last key held until the pounce.
 *   attack  once 0.6 s  5 keys: POUNCE + BITE: launch (hind legs drive, forelegs reach), flight (jaws open), strike
 *                       (claws out, jaws widest at 220 ms), BITE (snap shut, key 3 at 320 ms, head tugs down), settle.
 *   eat     loop 2.0 s  10 keys: crouched at the kill, forepaws forward, mouth on the carcass, bite / chew, TEAR (key 5),
 *                       wary look up (key 9).
 *   hurt    once 0.1 s  2 step keys: recoil, head up, hiss.   hitAdd once 0.25 s ADDITIVE (frame 0 = rest).
 *   flinch  once 0.25 s 3 keys -> rest.
 *   die     once 0.5 s  5 keys (beastView DIE_DURATIONS 90/110/120/80/100): yowl, legs buckle, rolls onto its right side,
 *                       thud with a leg kick (key 3), settles.   dead: held.   sink once 0.6 s [500, 100], 0.4 m down.
 *   blend   locomotion walk @ 0.6 -> run @ 2.2 m/s (= legRig tunedMps), windup in 80 ms, attack snaps in (60 ms), leaving
 *           attack >= 200 ms, additive `hit` on body / head / jaw / tail.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 10, SY = 26, SZ = 17, CM = 0.05, CX = 5;
  var JAW_MAX = 32, D2R = Math.PI / 180;
  var EYE_MAT = 'ember_glow';    // amber eyeshine (as the wolf); 'brass_dark' = plain amber eyes

  function hsh(a, b, c) {        // same deterministic hash as voxel_bear.js / voxel_crocodile.js (every build identical)
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }
  function rd(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function v3(a) { return a == null ? [0, 0, 0] : typeof a === 'number' ? [rd(a), 0, 0] : [rd(a[0] || 0), rd(a[1] || 0), rd(a[2] || 0)]; }
  function mix() { var o = {}; for (var i = 0; i < arguments.length; i++) { var s = arguments[i]; for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k]; } return o; }

  // ---- voxel grid G[z][y][x] ----
  var G = [], x, y, z;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  // a centred row of `str.length` cells at (py, pz): one colour char per cell, left (x small) to right
  function row(py, pz, str) { var x0 = CX - str.length / 2; for (var i = 0; i < str.length; i++) put(x0 + i, py, pz, str.charAt(i)); }

  // ---- trunk + neck (body part): [zLo, zHi, width] per y ----
  var BODY = { 5: [9, 12, 4], 6: [8, 12, 6], 7: [7, 12, 6], 8: [6, 12, 6], 9: [6, 12, 6], 10: [6, 12, 6], 11: [6, 12, 6],
               12: [7, 12, 6], 13: [7, 12, 6], 14: [8, 12, 6], 15: [8, 12, 6], 16: [8, 12, 6], 17: [7, 13, 6],
               18: [6, 13, 6], 19: [6, 13, 6], 20: [6, 13, 6], 21: [7, 13, 4] };
  var LEGY = { 9: 1, 10: 1, 11: 1, 18: 1, 19: 1, 20: 1 };       // full-width bottom layer where the legs join
  function coat(px, py, pz, zLo, zHi, x0, w) {
    var outer = (px === x0 || px === x0 + w - 1), c = hsh(px, py, pz), c2 = hsh(px >> 1, py >> 1, pz);
    if (pz === zLo) return 'W';                                                   // belly, chest underside, throat
    if (py <= 7 && pz <= zLo + 2) return 'W';                                     // cream bib
    if (pz === zLo + 1 && py >= 12 && py <= 17) return outer && c < 25 ? 'S' : 'W'; // pale loin underside, spotted edge
    if (pz === zHi) return c < 16 ? 'S' : (c2 < 30 ? 'G' : 'T');                 // back: tawny, darker dorsal speckles
    if (outer && c < (py >= 17 ? 30 : 22)) return 'S';                            // dark spots, denser on the haunch
    if (pz <= zLo + 2) return c2 < 70 ? 'G' : 'T';                                // buff-grey lower flank
    return c2 < 25 ? 'G' : 'T';                                                   // tawny flank, grey ticking
  }
  for (y = 5; y <= 21; y++) {
    var p = BODY[y];
    for (z = p[0]; z <= p[1]; z++) {
      var w = p[2];
      if (z === p[1]) w = p[2] - 2;
      else if (z === p[0] && !LEGY[y]) w = p[2] - 2;
      var x0 = CX - w / 2;
      for (x = x0; x < x0 + w; x++) put(x, y, z, coat(x, y, z, p[0], p[1], x0, w));
    }
  }

  // ---- head (z >= 9, y0 nose .. y4 back of the skull): short round cat head ----
  row(0, 9, 'WW'); row(0, 10, 'NN');                                              // upper lip, nose pad
  row(1, 9, 'WLLW'); row(1, 10, 'WTTW'); row(1, 11, 'TT');                       // whisker pads, incisors, nose bridge
  row(2, 9, 'WRRRRW'); row(2, 10, 'WWTTWW'); row(2, 11, 'GETTEG'); row(2, 12, 'WKKW');   // eyes forward, pale brows, bars
  row(3, 9, 'WWRRRRWW'); row(3, 10, 'KWTTTTWK'); row(3, 11, 'WTTTTTTW'); row(3, 12, 'TTKKTT'); row(3, 13, 'TSST'); // ruff
  row(4, 9, 'KWWWWWWK'); row(4, 10, 'WTTTTTTW'); row(4, 11, 'KTTTTTTK'); row(4, 12, 'TTSSTT'); row(4, 13, 'TSST');
  // ears: tall triangles on the top corners, cream inner face in front, black backs, black tufts on the tips
  function ear(xo, xi) {
    put(xo, 3, 14, 'W'); put(xi, 3, 14, 'W'); put(xo, 4, 14, 'K'); put(xi, 4, 14, 'K');
    put(xo, 3, 15, 'W'); put(xo, 4, 15, 'K');
    put(xo, 4, 16, 'K');                                                         // tuft
  }
  ear(2, 3); ear(7, 6);

  // ---- lower jaw (z8): cream chin, black lip corners ----
  row(1, 8, 'WW'); row(2, 8, 'KWWK'); row(3, 8, 'WWWW'); row(4, 8, 'WWWW');

  // ---- legs: long, spotted on the outside, cream inside, big furry pale paws ----
  function legCol(px, py, pz, inner) {
    var c = hsh(px, py, pz);
    if (inner) return c < 22 ? 'S' : 'W';
    return c < 30 ? 'S' : (pz >= 4 ? 'T' : 'G');
  }
  function frontLeg(xo, xi) {
    for (z = 2; z <= 5; z++) for (y = 9; y <= 10; y++) { put(xo, y, z, legCol(xo, y, z, false)); put(xi, y, z, legCol(xi, y, z, true)); }
    put(xo, 11, 5, 'T'); put(xi, 11, 5, 'G');                                    // elbow
    for (y = 9; y <= 10; y++) { put(xo, y, 1, 'G'); put(xi, y, 1, 'W'); }        // pastern
    for (y = 8; y <= 10; y++) { put(xo, y, 0, y === 8 ? 'W' : 'G'); put(xi, y, 0, y === 8 ? 'W' : 'G'); }   // paw, pale toes
  }
  function hindLeg(xo, xi) {
    var H = [[5, 18, 19], [4, 19, 20], [3, 20, 21]];                             // gaskin angling back to the hock
    for (var i = 0; i < H.length; i++) for (y = H[i][1]; y <= H[i][2]; y++) { put(xo, y, H[i][0], legCol(xo, y, H[i][0], false)); put(xi, y, H[i][0], legCol(xi, y, H[i][0], true)); }
    for (z = 1; z <= 2; z++) for (y = 20; y <= 21; y++) { put(xo, y, z, y === 21 ? 'S' : 'G'); put(xi, y, z, 'W'); }   // metatarsus
    for (y = 18; y <= 20; y++) { put(xo, y, 0, y === 18 ? 'W' : 'G'); put(xi, y, 0, y === 18 ? 'W' : 'G'); }        // paw
  }
  frontLeg(2, 3); frontLeg(7, 6); hindLeg(2, 3); hindLeg(7, 6);

  // ---- tail: short and thick, hanging down-back, a dark ring and a solid black tip ----
  row(22, 12, 'TT'); row(22, 11, 'TT');
  row(23, 11, 'TG'); row(23, 10, 'GW');
  row(24, 10, 'SS'); row(24, 9, 'WW');
  row(25, 9, 'KK'); row(25, 8, 'KK');

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  // ---- parts ----
  var PARTS = {
    body:   { box: [0, 5, 6, 10, 22, 17], pivot: [5, 14.5, 9] },
    head:   { box: [0, 0, 9, 10, 5, 17], pivot: [5, 5, 11], parent: 'body' },
    jaw:    { box: [2, 0, 7, 8, 5, 9], pivot: [5, 4.5, 9], parent: 'head' },
    tail:   { box: [3, 22, 4, 7, 26, 14], pivot: [5, 22, 12], parent: 'body' },
    legFL:  { box: [1, 7, 2, 5, 13, 6], pivot: [3, 10, 6], parent: 'body' },
    legFR:  { box: [5, 7, 2, 9, 13, 6], pivot: [7, 10, 6], parent: 'body' },
    legBL:  { box: [1, 16, 3, 5, 23, 6], pivot: [3, 19, 6], parent: 'body' },
    legBR:  { box: [5, 16, 3, 9, 23, 6], pivot: [7, 19, 6], parent: 'body' },
    legFL2: { box: [1, 7, 0, 5, 13, 2], pivot: [3, 9.2, 2], parent: 'legFL' },
    legFR2: { box: [5, 7, 0, 9, 13, 2], pivot: [7, 9.2, 2], parent: 'legFR' },
    legBL2: { box: [1, 16, 0, 5, 23, 3], pivot: [3, 21, 3], parent: 'legBL' },
    legBR2: { box: [5, 16, 0, 9, 23, 3], pivot: [7, 21, 3], parent: 'legBR' }
  };
  var BODY_PIV = PARTS.body.pivot, HEAD_PIV = PARTS.head.pivot;

  // ---- legs + the in-file 2-bone solve (same maths as voxel_crocodile.js = engine voxelPose, architecture.md 38.67) ----
  // foot = sole contact point (model cells). Order = fore pair, hind pair (legRig rule).
  var LEGS = [
    { k: 'FL', up: 'legFL', lo: 'legFL2', foot: [3, 9.5, 0] },
    { k: 'FR', up: 'legFR', lo: 'legFR2', foot: [7, 9.5, 0] },
    { k: 'HL', up: 'legBL', lo: 'legBL2', foot: [3, 19.5, 0] },
    { k: 'HR', up: 'legBR', lo: 'legBR2', foot: [7, 19.5, 0] }
  ];
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }
  LEGS.forEach(function (L) {
    var H = PARTS[L.up].pivot, K = PARTS[L.lo].pivot, F = L.foot;
    L.H = H; L.F = F;
    L.uy = K[1] - H[1]; L.uz = K[2] - H[2]; L.wy = F[1] - K[1]; L.wz = F[2] - K[2];
    L.a = Math.hypot(L.uy, L.uz); L.b = Math.hypot(L.wy, L.wz);
    L.phiU = Math.atan2(L.uz, L.uy); L.phiW = Math.atan2(L.wz, L.wy);
    L.sigma = wrapPi(L.phiW - L.phiU) > 0 ? 1 : -1;               // +1 apex front (carpus), -1 apex back (hock)
  });
  function rotM(rx, ry, rz) {                                    // R = Rz * Ry * Rx (degrees), row-major 3x3
    var cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
    var cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
            -sy, cy * sx, cy * cx];
  }
  // upper + lower rx (deg) that put the foot on its rest point + (0, dy, dz) for a body rot / pos (cells); x is ignored
  function solveLeg(L, br, bp, dy, dz) {
    var R = rotM(br[0], br[1], br[2]), P = BODY_PIV;
    var t0 = L.F[0] - P[0] - bp[0], t1 = L.F[1] + dy - P[1] - bp[1], t2 = L.F[2] + dz - P[2] - bp[2];
    var by = P[1] + R[1] * t0 + R[4] * t1 + R[7] * t2;            // target in the body frame (R^T)
    var bz = P[2] + R[2] * t0 + R[5] * t1 + R[8] * t2;
    var ey = by - L.H[1], ez = bz - L.H[2], D = Math.hypot(ey, ez), s = L.a + L.b;
    D = Math.max(Math.abs(L.a - L.b) + 0.01 * s, Math.min(s - 0.01 * s, D));
    var cK = Math.max(-1, Math.min(1, (D * D - L.a * L.a - L.b * L.b) / (2 * L.a * L.b)));
    var r2 = L.phiU - L.phiW + L.sigma * Math.acos(cK), c2 = Math.cos(r2), s2 = Math.sin(r2);
    var vy = L.uy + L.wy * c2 - L.wz * s2, vz = L.uz + L.wy * s2 + L.wz * c2;
    var r1 = Math.atan2(ez, ey) - Math.atan2(vz, vy);
    return [rd(wrapPi(r1) / D2R), rd(wrapPi(r2) / D2R)];
  }

  // ---- pose: o = { b: [rx,ry,rz, px,py,pz] body, h: head [rx,ry,rz], j: jaw open deg, t: tail [rx,ry,rz],
  //   feet: { FL: [dy, dz], ... } foot offsets from rest (cells; default planted), free: true = no solve, legs use
  //   o.FL / o.FL2 ... rotations }. Every frame keys all 12 parts; leg pos is always 0. ----
  function pose(o) {
    var b = o.b || [], br = [b[0] || 0, b[1] || 0, b[2] || 0], bp = [b[3] || 0, b[4] || 0, b[5] || 0];
    var f = {
      body: { rot: v3(br), pos: v3(bp) },
      head: { rot: v3(o.h) },
      jaw: { rot: [rd(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      tail: { rot: v3(o.t) }
    };
    LEGS.forEach(function (L) {
      var up, lo;
      if (o.free) { up = v3(o[L.k]); lo = v3(o[L.k + '2']); }
      else {
        var off = (o.feet && o.feet[L.k]) || [0, 0], s = solveLeg(L, br, bp, off[0], off[1]);
        up = [s[0], 0, 0]; lo = [s[1], 0, 0];
      }
      f[L.up] = { rot: up, pos: [0, 0, 0] };
      f[L.lo] = { rot: lo, pos: [0, 0, 0] };
    });
    return f;
  }
  function clip(keys, loop) {
    var d = [], fr = [];
    for (var k = 0; k < keys.length; k++) { d.push(keys[k][0]); fr.push(pose(keys[k][1])); }
    return { durations: d, loop: loop, frames: fr };
  }

  // ---- (y, z) forward kinematics for the head: world z of the chin point for a body pose + head rx ----
  function rotYZ(dy, dz, deg) { var c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [c * dy - s * dz, s * dy + c * dz]; }
  var CHIN = [1, 8];                                             // model (y, z) of the chin (jaw front, bottom)
  function chinZ(b, h) {
    var q = rotYZ(CHIN[0] - HEAD_PIV[1], CHIN[1] - HEAD_PIV[2], h);
    q = rotYZ(q[0] + HEAD_PIV[1] - BODY_PIV[1], q[1] + HEAD_PIV[2] - BODY_PIV[2], b[0] || 0);
    return BODY_PIV[2] + (b[5] || 0) + q[1];
  }
  // head rx (0 .. hMax) that puts the chin at zTarget (bisection; z falls monotonically while the chin swings down)
  function headFor(b, zTarget, hMax) {
    var lo = 0, hi = hMax;
    for (var i = 0; i < 30; i++) { var m = (lo + hi) / 2; if (chinZ(b, m) > zTarget) lo = m; else hi = m; }
    return rd((lo + hi) / 2);
  }

  // ---- gaits: ONE source for the clips and legRig.gaits (38.67 item 2). S = stance travel = v * T * duty (cells) ----
  // phase per leg in LEGS order [FL, FR, HL, HR]. walk = lateral sequence LH 0, LF .25, RH .5, RF .75; run = rotary gallop.
  var GAIT = {
    walk: { T: 800, keys: 10, v: 0.6, duty: 0.6, phase: [0.25, 0.75, 0, 0.5], liftM: 0.04, bz: -1.0, bob: 0.15, pitch: 0,
            yaw: 1.5, roll: 1, head: 4, nod: 1.5, tailRx: 0, tail: 4 },
    run:  { T: 400, keys: 8, v: 2.2, duty: 0.35, phase: [0, 0.1, 0.5, 0.6], liftM: 0.08, bz: -1.3, bob: 0.3, pitch: 5,
            yaw: 1, roll: 0.5, head: -4, nod: 2, tailRx: 15, tail: 3 }
  };
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function gaitClip(g) {
    var n = g.keys, S = g.v * (g.T / 1000) * g.duty / CM, lift = g.liftM / CM, frames = [], durs = [];
    for (var k = 0; k < n; k++) {
      var p = k / n, W = 2 * Math.PI * p, yaw = g.yaw * Math.sin(W), pit = g.pitch * Math.sin(W);
      var o = {
        b: [pit, g.roll * Math.sin(W - 2 * Math.PI * 0.2), yaw, 0, 0, g.bz + g.bob * Math.cos(2 * W)],
        h: [g.head - pit + g.nod * Math.sin(2 * W + 0.6), 0, -yaw * 0.9],     // head steadied against the trunk
        t: [g.tailRx, g.tail * Math.sin(W - 1.2), 0],
        feet: {}
      };
      for (var li = 0; li < LEGS.length; li++) {
        var ph = (p - g.phase[li]) % 1; if (ph < 0) ph += 1;
        var Ty, lz = 0;
        if (ph < g.duty) Ty = -S / 2 + S * (ph / g.duty);                              // stance: foot front -> back
        else { var q = (ph - g.duty) / (1 - g.duty); Ty = S / 2 - S * smooth(q); lz = lift * Math.sin(Math.PI * q); }
        o.feet[LEGS[li].k] = [Ty, lz];
      }
      frames.push(pose(o)); durs.push(Math.round(g.T / n));
    }
    return { durations: durs, loop: true, frames: frames };
  }

  // ---- ground clearance for a roll (dead pose): body pos z so the lowest voxel touches z0 (rigid, rest limbs) ----
  var ROLL_MIN = {};
  function groundZ(deg) {
    if (ROLL_MIN[deg] !== undefined) return ROLL_MIN[deg];
    var s = Math.sin(deg * D2R), c = Math.cos(deg * D2R), m = 1e9, gx, gy, gz, cx, cz, P = BODY_PIV;
    for (gz = 0; gz < SZ; gz++) for (gy = 0; gy < SY; gy++) for (gx = 0; gx < SX; gx++) {
      if (layers[gz][gy].charAt(gx) === '.') continue;
      for (cx = 0; cx < 2; cx++) for (cz = 0; cz < 2; cz++) m = Math.min(m, -(gx + cx - P[0]) * s + (gz + cz - P[2]) * c);
    }
    return (ROLL_MIN[deg] = rd(-P[2] - m));
  }

  // ---- clips ----
  var anim = {};
  anim.idle = clip([
    [600, { h: [0, 0, 0], t: [0, 0, 0] }],
    [600, { b: [-0.5, 0, 0, 0, 0, 0.15], h: [-2, 0, 0], t: [0, 4, 0] }],                    // breath in
    [500, { h: [-4, 0, 18], t: [0, 0, 0] }],                                                 // slow glance right
    [500, { h: [-4, 0, 18], t: [6, -6, 0] }],                                                // tail-tip flick
    [400, { h: [2, 0, -6], t: [0, 0, 0] }],
    [400, { h: [0, 0, 0], t: [0, 0, 0] }]
  ], true);
  anim.walk = gaitClip(GAIT.walk);
  anim.run = gaitClip(GAIT.run);
  // alert: head up and staring, ears high (head part), tail twitches side to side
  anim.alert = clip([
    [400, { b: [-2, 0, 0, 0, 0, -0.3], h: [-14, 0, 0], t: [8, 0, 0] }],
    [400, { b: [-2, 0, 0, 0, 0, -0.3], h: [-14, 0, 6], t: [8, 8, 0] }],
    [400, { b: [-2, 0, 0, 0, 0, -0.3], h: [-12, 0, -4], j: 3, t: [8, -8, 0] }],
    [400, { b: [-2, 0, 0, 0, 0, -0.3], h: [-14, 0, 0], t: [8, 0, 0] }]
  ], true);
  // windup 0.4 s: the pounce telegraph. Sinks, shifts back, forepaws reach forward, head low and level, hind feet tread.
  var FW = { FL: [-1.5, 0], FR: [-1.5, 0] };
  anim.windup = clip([
    [100, { b: [2, 0, 0, 0, 1.0, -1.4], h: [2, 0, 0], t: [-4, 0, 0], feet: { FL: [-0.8, 0], FR: [-0.8, 0] } }],                // sink
    [150, { b: [3, 0, 0, 0, 1.5, -2.4], h: [0, 0, 0], t: [-2, 0, 0], feet: mix(FW, { HL: [-0.5, 0], HR: [-0.5, 0] }) }],         // crouched
    [75,  { b: [3, 1.5, 0, 0, 1.5, -2.3], h: [0, 0, 0], t: [-2, 8, 0], feet: mix(FW, { HL: [-0.5, 0.6], HR: [-0.5, 0] }) }],     // butt wiggle
    [75,  { b: [3, -1.5, 0, 0, 1.5, -2.4], h: [0, 0, 0], t: [-2, -8, 0], feet: mix(FW, { HL: [-0.5, 0], HR: [-0.5, 0.6] }) }]    // held
  ], false);
  // attack 0.6 s: POUNCE + BITE. Launch (hind legs drive back, forelegs reach), flight (0.2 m view-only arc, jaws open),
  // strike (claws out, jaws widest at 220 ms), BITE (snap shut at 320 ms = key 3, head tugs down), settle near rest.
  anim.attack = clip([
    [100, { free: true, b: [-18, 0, 0, 0, 0, 1.5], h: [-8, 0, 0], j: 10, t: [25, 0, 0],
            FL: [-55, 0, 0], FR: [-50, 0, 0], FL2: [-15, 0, 0], FR2: [-15, 0, 0], HL: [45, 0, 0], HR: [42, 0, 0], HL2: [25, 0, 0], HR2: [25, 0, 0] }],
    [120, { free: true, b: [-6, 0, 0, 0, -1.5, 4], h: [-4, 0, 0], j: 26, t: [35, 0, 0],
            FL: [-75, 0, 0], FR: [-70, 0, 0], FL2: [-25, 0, 0], FR2: [-25, 0, 0], HL: [55, 0, 0], HR: [52, 0, 0], HL2: [30, 0, 0], HR2: [30, 0, 0] }],
    [100, { free: true, b: [8, 0, 0, 0, -2.5, 2], h: [4, 0, 0], j: JAW_MAX, t: [30, 6, 0],
            FL: [-50, 0, 0], FR: [-46, 0, 0], FL2: [-30, 0, 0], FR2: [-30, 0, 0], HL: [20, 0, 0], HR: [18, 0, 0], HL2: [10, 0, 0], HR2: [10, 0, 0] }],
    [130, { b: [6, 0, 0, 0, -2, -1], h: [14, 0, -6], j: 0, t: [15, 0, 0], feet: { FL: [-2.5, 0], FR: [-2.5, 0], HL: [-1, 0], HR: [-1, 0] } }],   // BITE
    [150, { b: [3, 0, 0, 0, -0.5, -0.6], h: [8, 0, 0], j: 2, t: [5, 0, 0], feet: { FL: [-0.5, 0], FR: [-0.5, 0] } }]                             // settle
  ], false);
  // eat 2.0 s: crouched at the kill (body 0.13 m lower, pitched 8 deg, forepaws forward), chin on the carcass (solved to
  // 0.1 m), bite / chew, TEAR (key 5: head yanks up-back and twists, body rocks back), wary look up (key 9)
  var EB = [8, 0, 0, 0, 0.5, -2.6], EBK = [8, 0, 0, 0, 1.4, -2.6], EF = { FL: [-2.5, 0], FR: [-2.5, 0] };
  var H0 = headFor(EB, 2, 45);
  function eatKey(ms, b, h, j, t) { return [ms, { b: b, h: h, j: j, t: t || [-4, 0, 0], feet: EF }]; }
  anim.eat = clip([
    eatKey(300, EB, [H0, 0, 0], 0),
    eatKey(150, EB, [H0 + 3, 0, -3], 20),                                                    // bite
    eatKey(150, EB, [H0, 0, -2], 4),
    eatKey(150, EB, [H0 + 3, 0, 3], 22),
    eatKey(150, EB, [H0, 0, 2], 3),
    eatKey(250, EBK, [H0 - 18, 8, -12], 12, [0, 6, 0]),                                     // TEAR
    eatKey(200, EB, [H0 - 8, 0, -4], 6),
    eatKey(150, EB, [H0 + 2, 0, 0], 18),
    eatKey(150, EB, [H0, 0, 0], 2),
    eatKey(350, EB, [H0 - 35, 0, 10], 2, [0, 0, 0])                                         // wary look up
  ], true);
  // hurt 0.1 s (2 step keys): recoil, head up, hiss (jaw), tail clamps down
  anim.hurt = clip([
    [50, { b: [-6, 0, 0, 0, 2, -0.2], h: [-14, 0, 0], j: 20, t: [-10, 0, 0] }],
    [50, { b: [-4, 0, 0, 0, 1.5, -0.2], h: [-8, 0, 0], j: 12, t: [-8, 0, 0] }]
  ], false);
  anim.hurt.interp = 'step';
  // hitAdd 0.25 s ADDITIVE (38.68): frame 0 = rest (all zero), a jolt, back to rest; legs stay 0 (mask body / head / jaw / tail)
  anim.hitAdd = clip([
    [50, { free: true }],
    [50, { free: true, b: [-4, 0, 0, 0, 1.0, 0.2], h: [-12, 0, 0], j: 16, t: [-8, 0, 0] }],
    [50, { free: true, b: [-2, 0, 0, 0, 0.6, 0.1], h: [-6, 0, 4], j: 8, t: [-4, 0, 0] }],
    [100, { free: true }]
  ], false);
  anim.flinch = clip([
    [50,  { b: [-4, 0, 0, 0, 1.2, -0.2], h: [-6, 0, 8], j: 8, t: [-6, 0, 0] }],
    [100, { b: [1, 0, 0, 0, 0.3, 0], h: [4, 0, -6], j: 2, t: [2, 0, 0] }],
    [100, {}]
  ], false);
  // dead: lying on its right side (rolled 90 deg about the trunk), legs out to the left, head and tail relaxed
  var DEAD_O = { free: true, b: [0, 90, 0, 0, 0, groundZ(90)], h: [-6, 0, 0], j: 10, t: [10, 0, 0],
                 FL: [-25, 0, 0], FR: [-15, 0, 0], HL: [25, 0, 0], HR: [15, 0, 0],
                 FL2: [10, 0, 0], FR2: [5, 0, 0], HL2: [-10, 0, 0], HR2: [-5, 0, 0] };
  // die 0.5 s (beastView DIE_DURATIONS): yowl, legs buckle, rolls onto the right side, thud + leg kick (key 3), settles
  anim.die = clip([
    [90,  { b: [-8, 0, 0, 0, 0.5, -0.3], h: [-18, 0, 0], j: 24, t: [-6, 0, 0] }],
    [110, { b: [4, 15, 0, 0, 0, -2.5], h: [8, 0, 0], j: 12, t: [0, 0, 0] }],
    [120, { free: true, b: [2, 60, 0, 0, 0, groundZ(60)], h: [4, 0, 0], j: 8, t: [6, 0, 0],
            FL: [-10, 0, 0], FR: [-6, 0, 0], HL: [12, 0, 0], HR: [8, 0, 0] }],
    [80,  mix(DEAD_O, { b: [0, 98, 0, 0, 0, groundZ(98)], h: [-10, 0, 0], j: 14, FL: [-38, 0, 0], FR: [-28, 0, 0], HL: [34, 0, 0], HR: [26, 0, 0] })],   // THUD + kick
    [100, DEAD_O]
  ], false);
  anim.dead = clip([[1000, DEAD_O]], true);
  var SINK_M = 0.4, SUNK_O = mix(DEAD_O, { b: DEAD_O.b.slice() });
  SUNK_O.b[5] = rd(DEAD_O.b[5] - SINK_M / CM);
  anim.sink = clip([[500, DEAD_O], [100, SUNK_O]], false);
  anim.charge = anim.run;                                        // alias: the boar view's chase / charge clip = the gallop

  A.models.lynx = {
    name: 'lynx',
    displayName: 'lynx',
    desc: 'OB-153 Eurasian lynx (1.1 m + a 0.2 m black-tipped tail, 0.62 m at the withers, rump higher, on all fours): ' +
          'short round head, forward amber eyes, black ear tufts, cream-and-black facial ruff, long legs, big pale paws, ' +
          'spotted tawny coat. 12 parts (knee rig); clips idle, walk, run (= charge), alert, windup (pounce crouch), ' +
          'attack (pounce + bite), eat, hurt, hitAdd, flinch, die, dead, sink + blend block.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CM,
      size: [SX, SY, SZ],
      anchor: [5, 14.5, 0],
      light: false,
      mats: {
        T: 'fur_roe_light',      // tawny back, upper flanks, head
        G: 'fur_agouti_light',   // buff-grey lower flanks, legs, paws, grey ticking
        S: 'fur_roe_dark',       // dark brown spots, dorsal speckles, forehead / crown bars
        W: 'fur_cream',          // belly, bib, chin, muzzle, brows, inner ears, inner legs, toes
        K: 'fur_bear',           // black ear backs + tufts, ruff bars, lip corners, tail tip
        N: 'skin_flush',         // brick-pink nose pad
        E: EYE_MAT,              // amber eyes
        L: 'linen_light',        // incisors (seen when the jaw opens)
        R: 'gore_red_dark'       // mouth roof
      },
      layers: layers,
      parts: PARTS,
      lookAt: { part: 'head', yawLimitDeg: 70, pitchLimitDeg: 30, hz: 3 },   // quick, cat-like head follow
      legRig: {
        body: 'body',
        legs: LEGS.map(function (L) { return { upper: L.up, lower: L.lo, foot: L.foot.slice(), bend: L.sigma > 0 ? 'front' : 'back' }; }),
        gaits: {
          walk: { tunedMps: GAIT.walk.v, duty: GAIT.walk.duty, phase: GAIT.walk.phase.slice(), liftM: GAIT.walk.liftM },
          run:  { tunedMps: GAIT.run.v, duty: GAIT.run.duty, phase: GAIT.run.phase.slice(), liftM: GAIT.run.liftM }
        },
        stand: ['idle', 'alert', 'eat'],                         // not windup: the hind feet tread (lift 3 cm)
        maxPitchDeg: 18, maxRollDeg: 8
      },
      animations: anim,
      // ANIM-BLEND (38.68): set speeds = legRig tunedMps. windup fades in fast (80 ms), attack snaps in (60 ms); leaving the
      // attack takes >= 200 ms so the landing reads; hit = additive on body / head / jaw / tail (never leg parts).
      blend: {
        sets: { locomotion: { param: 'speed', clips: [{ clip: 'walk', at: GAIT.walk.v }, { clip: 'run', at: GAIT.run.v }] } },
        fades: {
          default: 150,
          into: { windup: 80, attack: 60, hurt: 50, flinch: 80, alert: 120 },
          pairs: { 'windup>attack': 60, 'run>attack': 60, 'attack>idle': 200, 'attack>run': 200, 'attack>walk': 200,
                   'attack>eat': 250, 'eat>alert': 150, 'alert>run': 100 }
        },
        additive: { hit: { clip: 'hitAdd', parts: ['body', 'head', 'jaw', 'tail'], inMs: 40, outMs: 160, gain: 1 } }
      },
      mounts: {                                        // grid coords at rest; they follow their part
        notice:   { at: [5, 4, 19], part: 'body' },     // 0.95 m: over the ear tufts
        forefeet: { at: [5, 9.5, 0.4], part: 'body' },  // dust between the forepaws (pounce launch)
        hit:      { at: [5, 14, 9.5], part: 'body' },   // flank centre (0.47 m)
        loot:     { at: [2, 14, 9], part: 'body' },     // the LEFT flank = the top of the corpse (dead pose)
        mouth:    { at: [5, 1, 8.5], part: 'head' }     // between the jaws (bite fx / blood point)
      }
    }
  };

  A.lynxFx = {
    version: 1,
    model: 'lynx',
    story: 'OB-153 (model + clips) for the BEAST-10 ambusher brain (hidden, pounce <= 8 m)',
    clipFor: {
      state: { idle: 'idle', wander: 'walk', move: 'walk', return: 'walk', stalk: 'walk', notice: 'alert', hidden: 'idle',
               chase: 'run', flee: 'run', windup: 'windup', telegraph: 'windup', lunge: 'attack', pounce: 'attack',
               leap: 'attack', bite: 'attack', recover: 'idle', stagger: 'flinch', eat: 'eat' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink', hitAdditive: 'hit',
      note: 'the boar view works unchanged: windup = windup, charge = run (alias, the chase gallop). The kinds.json ' +
            'attack is a `lunge` (pounce): map the sim lunge / charge state to `attack` (as wolfClip does for the wolf). ' +
            'With ANIM-BLEND request the `locomotion` set by speed instead of walk / run.'
    },
    speeds: { walk: GAIT.walk.v, run: GAIT.run.v,
              note: 'walk / run = legRig tunedMps (planted feet); the leg driver stretches the stride above that.' },
    telegraph: { clip: 'windup', ms: 400, dropM: 0.12, backM: 0.075,
                 note: 'view-only crouch; the last key (butt wiggle) is held until the pounce starts (kinds windupSec 0.4)' },
    pounce: { clip: 'attack', ms: 600, arcM: 0.2, jawsWideKey: 2, jawsWideMs: 220, snapKey: 3, snapMs: 320, hitMs: [220, 360],
              rangeM: 8,
              note: 'the clip arcs the trunk only 0.2 m; the sim moves the entity for the 8 m pounce (kinds activeSec 0.5). ' +
                    'Deal damage inside hitMs; the jaw is shut from snapMs on. Ends near rest (200 ms fade out).' },
    eat: { clip: 'eat', ms: 2000, tearKey: 5, lookUpKey: 9, chinUpM: 0.1, note: 'mouth mount over the carcass' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 15, note: 'as wolfFx.hurt (no flash shell)' },
    death: {
      note: 'beastView timeline: hurt -> die (DIE_DURATIONS 90/110/120/80/100, thud at key 3) -> dead + lootable -> sink',
      thudKey: 3, thudMs: 320,
      corpseCentre: { rightM: -0.1, fwdM: 0, upM: 0.15, note: 'rolled onto the right side about the trunk centre: the ' +
                      'back lies 0.2 m to the right, the legs reach 0.45 m to the left, 0 .. 0.3 m up (entity frame)' },
      lootInteract: { prompt: '[E] Loot lynx', radiusM: 1.4, aimUpM: 0.2 },
      sink: { clip: 'sink', steps: 30, depthM: SINK_M }
    },
    notice: { noticeUpM: 0.95, note: 'the `!` sits just over the ear tufts (0.85 m)' },
    collider: { lengthM: 1.1, widthM: 0.3, note: 'anchor between the paws; nose 0.72 m ahead, tail tip 0.57 m behind' }
  };

  // eat at a kill: beastView plays `eat` only for ASSETS.eatFx.models (design/models/voxel_eat_clips.js, loaded first)
  if (A.eatFx && Array.isArray(A.eatFx.models) && A.eatFx.models.indexOf('lynx') < 0) {
    A.eatFx.models.push('lynx');
    if (A.eatFx.ms) A.eatFx.ms.lynx = 2000;
    if (A.eatFx.tearKey) A.eatFx.tearKey.lynx = 5;
    if (A.eatFx.lookUpKey) A.eatFx.lookUpKey.lynx = 9;
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { lynx: A.models.lynx, lynxFx: A.lynxFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
