/* design/models/voxel_aurochs.js - the AUROCHS bull (designer, OB-153 "more creature types"; docs/epics/ep-bestiary.md
 *                                 BEAST-D1 plains batch: grazer herds 3-5, stampede charge). content/beasts/kinds.json
 *                                 "aurochs" uses model id `aurochs`. Binding rules: design/style-guide.md section 0
 *                                 (realistic shapes from voxels, animals on all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4), stand-alone (clones nothing), same loading convention as
 * design/models/voxel_crocodile.js:
 *   <script src="../design/models/voxel_aurochs.js">  (browser, after palette.js + detail-pass.js and AFTER voxel_eat_clips.js)
 *   import '../design/models/voxel_aurochs.js';       (Node tests: side-effect import, after palette + detail-pass)
 * Sets ASSETS.models.aurochs and ASSETS.aurochsFx; when ASSETS.eatFx exists (voxel_eat_clips.js loaded first) it appends
 * 'aurochs' to eatFx.models so beastView plays `eat` (= graze) for STATE_EAT. `meshOnly: true` (13 parts > 8).
 *
 * Axes (15.1): x = east (= the bull's RIGHT at yaw 0), y = SOUTH with y0 = the muzzle (faces north at yaw 0), z = up.
 * cellM 0.08. Grid 16 x 38 x 23: 2.8 m muzzle to buttocks + the tail, 1.76 m at the withers (shoulder hump), 0.8 m wide
 * trunk, horn span 1.2 m, horn tips 1.84 m. Anchor [8, 23, 0] = between the four hooves. Centre x = 8.0 (cells 7 | 8).
 * Clip `pos` values are VOXELS (8 cm).
 *
 * Anatomy (realistic, from squares): a long heavy head with a broad flat forehead and a PALE MUZZLE ring (mealy nose,
 * dark nose pad and nostrils, pale lips + chin), side-set eyes, horizontal ears, a curly brown FORELOCK between the
 * horns, and the long pale HORNS: out sideways from the poll, then sweeping FORWARD and UP, the dark tips turning in
 * (lyre shape). A thick neck with a dewlap, a muscular shoulder HUMP (withers the highest point), a deep chest (brisket
 * at 0.8 m), a long barrel, a level back with the pale EEL STRIPE along the spine, a tucked flank, square haunches, long
 * legs (knees and hocks, dark cannons, black hooves) and the long tail hanging to the hocks with a black tuft.
 * Colour: near-black front quarters, neck and belly (K), dark brown-black flanks (B), warm brown guard-hair highlights
 * and forelock (F), pale eel stripe (E), pale muzzle (M), black nose / hooves / horn tips (H), pale horn (O) with the
 * palest mid curve (P), amber-brown eyes (Y), mouth (R).
 *
 * Parts (13 <= MAX_VOX_PARTS 16; insertion order = part index; every parent EARLIER; boxes claim voxels in order):
 *   body   box [3,13,10, 13,35,23]  pivot [8, 23, 15]   withers, barrel, haunch. rx + = nose down, ry + = roll top right.
 *   neck   box [3,7,10, 13,13,23]   pivot [8, 13.5, 18] neck + dewlap, parent body. rx + = head down (grazing).
 *   head   box [0,0,11, 16,7,23]    pivot [8, 6.5, 16]  skull, horns, ears, upper jaw, parent neck. rx + = nose down.
 *   jaw    box [5,0,8, 11,7,11]     pivot [8, 5.5, 11]  lower jaw, parent head. OPEN = rx + (0 .. JAW_MAX 20).
 *   tail   box [6,35,4, 10,38,21]   pivot [8, 35, 19]   long hanging tail + tuft. ry = swish (tip to the left at +).
 *   legFL / legFR  forearm (elbow pivot [5|11, 15, 10]); legBL / legBR gaskin (stifle pivot [5|11, 31.5, 10]);
 *   legFL2 .. legBR2 lower legs (D-101 knee rig): knee (carpus) pivot [5|11, 13.9, 5] (bend 'front'), hock pivot
 *                  [5|11, 33, 5] (bend 'back'). rx - = hoof forward.
 *
 * Clips (ms; ALL on four legs; hooves planted by an in-file 2-bone solve = the engine's 38.67 maths):
 *   idle    loop 4.0 s  6 keys: standing, breathing, chewing the cud, tail swish, head turn and a fly-toss.
 *   walk    loop 1.2 s  12 keys: lateral-sequence walk, duty 0.65, tuned 0.7 m/s, neck nods with the stride.
 *   run     loop 0.6 s  8 keys: gallop, duty 0.35, tuned 3.0 m/s, spine rocks 3 deg, head forward.
 *   charge  loop 0.6 s  8 keys: the same gallop with the HEAD DOWN, horns levelled forward (stampede / chase).
 *   alert   loop 2.0 s  4 keys: head high, looking around, a snort.
 *   windup  once 0.6 s  4 keys: the CHARGE TELEGRAPH: head drops, horns forward, a forehoof PAWS the ground twice,
 *                       weight back, tail up. Last key held (kinds windupSec 0.6).
 *   attack  once 0.8 s  5 keys: HORN CHARGE + HOOK: drive forward head-low (key 0), impact (key 1), the upward-sideways
 *                       HOOK / toss (key 2 at 300 ms), follow-through, settle.
 *   graze   loop 3.2 s  8 keys: neck down, muzzle in the grass (solved to 0.12 m), tearing grass with small twists, a
 *                       tail swish, head up chewing and looking (key 6).   eat = graze (alias, beastView STATE_EAT).
 *   hurt    once 0.1 s  2 step keys: flinch, head tosses up, bellow.   hitAdd once 0.25 s ADDITIVE (frame 0 = rest).
 *   flinch  once 0.25 s 3 keys -> rest.
 *   die     once 0.5 s  5 keys (beastView DIE_DURATIONS 90/110/120/80/100): bellow, knees buckle, rolls onto its right
 *                       side, thud with a leg kick (key 3), settles.   dead: held.   sink once 0.6 s [500, 100], 0.6 m.
 *   blend   locomotion walk @ 0.7 -> run @ 3.0 m/s (= legRig tunedMps); windup 100 ms, attack snaps in (60 ms), leaving
 *           attack >= 200 ms; additive `hit` on body / neck / head / jaw / tail.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 16, SY = 38, SZ = 23, CM = 0.08, CX = 8;
  var JAW_MAX = 20, D2R = Math.PI / 180;

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
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }   // the bull's left + mirrored right
  // a centred row of `str.length` cells at (py, pz): one colour char per cell, left (x small) to right
  function row(py, pz, str) { var x0 = CX - str.length / 2; for (var i = 0; i < str.length; i++) put(x0 + i, py, pz, str.charAt(i)); }
  // rounded cross-section width at layer pz of a section [zLo, zHi, w]: round back (2 stepped layers), narrower belly
  function secW(s, pz) {
    var w = s[2];
    if (pz === s[1]) return Math.max(2, w - (w >= 8 ? 4 : 2));
    if (pz === s[1] - 1 && w >= 8) return w - 2;
    if (pz === s[0]) return Math.max(2, w - 2);
    return w;
  }

  // ---- trunk (body part): [zLo, zHi, width] per y. Hump at the withers (y13-16), brisket z10, tucked flank ----
  var BODY = { 13: [11, 21, 10], 14: [10, 21, 10], 15: [10, 21, 10], 16: [10, 21, 10], 17: [10, 20, 10], 18: [11, 20, 10],
               19: [11, 20, 10], 20: [11, 20, 10], 21: [11, 20, 10], 22: [11, 20, 10], 23: [11, 20, 10], 24: [11, 20, 10],
               25: [11, 20, 10], 26: [12, 20, 10], 27: [12, 20, 10], 28: [11, 20, 10], 29: [11, 20, 10], 30: [10, 20, 10],
               31: [10, 20, 10], 32: [10, 20, 10], 33: [11, 20, 8], 34: [13, 19, 6] };
  function coat(px, py, pz, s, x0, w) {
    var c = hsh(px >> 1, py >> 1, pz), c1 = hsh(px, py, pz), front = py <= 17;
    if (pz === s[0]) return 'K';                                                  // belly / brisket shadow
    if (pz === s[1]) return (px === 7 || px === 8) && py >= 14 && py <= 33 ? 'E' : (c1 < 30 ? 'F' : 'K');   // eel stripe
    if (pz === s[0] + 1) return c < 60 ? 'K' : 'B';                               // lower flank: darker
    if (pz >= s[1] - 2) return c1 < 28 ? 'F' : (front ? 'K' : 'B');               // lit guard hairs on the upper flank
    return front ? (c < 55 ? 'K' : 'B') : (c < 20 ? 'K' : (c1 < 12 ? 'F' : 'B'));  // dark brown-black flank, near-black shoulder
  }
  for (y = 13; y <= 34; y++) {
    var s = BODY[y];
    for (z = s[0]; z <= s[1]; z++) {
      var w = secW(s, z), x0 = CX - w / 2;
      for (x = x0; x < x0 + w; x++) put(x, y, z, coat(x, y, z, s, x0, w));
    }
  }

  // ---- neck (neck part, y7..12): thick, near-black, with a dewlap underneath ----
  var NECK = { 7: [13, 19, 6], 8: [12, 19, 6], 9: [12, 19, 8], 10: [12, 20, 8], 11: [11, 20, 8], 12: [11, 21, 10] };
  for (y = 7; y <= 12; y++) {
    var ns = NECK[y];
    for (z = ns[0]; z <= ns[1]; z++) {
      var nw = secW(ns, z), nx0 = CX - nw / 2;
      for (x = nx0; x < nx0 + nw; x++) {
        var nc = hsh(x, y, z);
        put(x, y, z, z === ns[0] ? 'K' : z >= ns[1] - 1 ? (nc < 30 ? 'F' : 'K') : (nc < 25 ? 'B' : 'K'));
      }
    }
  }
  row(9, 11, 'KK'); row(10, 11, 'KK'); row(11, 10, 'KK'); row(12, 10, 'KK');   // dewlap

  // ---- head (z >= 11, y0 muzzle .. y6 poll): long and heavy, pale muzzle ring, side-set eyes, forelock ----
  row(0, 11, 'MMMM'); row(0, 12, 'MHHM'); row(0, 13, 'MMMM');                                       // mealy muzzle, nose pad
  row(1, 11, 'MMRRMM'); row(1, 12, 'MHMMHM'); row(1, 13, 'MMMMMM'); row(1, 14, 'BKKB');           // nostrils
  row(2, 11, 'BBRRBB'); row(2, 12, 'BKKKKB'); row(2, 13, 'KKKKKK'); row(2, 14, 'KKKKKK'); row(2, 15, 'KKKK');
  row(3, 11, 'BBRRBB'); row(3, 12, 'BBKKBB'); row(3, 13, 'BKKKKB'); row(3, 14, 'KKKKKK'); row(3, 15, 'KKKKKK'); row(3, 16, 'KKKK');
  row(4, 11, 'BBBBBB'); row(4, 12, 'BBKKBB'); row(4, 13, 'BKKKKB'); row(4, 14, 'BKKKKB'); row(4, 15, 'YKKKKY'); row(4, 16, 'KKKKKK'); row(4, 17, 'FFFF');
  row(5, 11, 'BBBBBB'); row(5, 12, 'BBBBBB'); row(5, 13, 'BKKKKB'); row(5, 14, 'BKKKKB'); row(5, 15, 'BKKKKB'); row(5, 16, 'KKKKKK'); row(5, 17, 'KFFFFK'); row(5, 18, 'FFFF');
  row(6, 12, 'BBBBBB'); row(6, 13, 'BBBBBB'); row(6, 14, 'BKKKKB'); row(6, 15, 'BKKKKB'); row(6, 16, 'KKKKKK'); row(6, 17, 'KFFFFK'); row(6, 18, 'FFFF');
  // ears: horizontal, below and behind the horn base
  putSym(4, 6, 16, 'B'); putSym(3, 6, 16, 'B'); putSym(2, 6, 16, 'K');
  // horns (left, mirrored): thick pale base out sideways from the poll, then forward + up, the dark tips turning in
  var HORN = [[5, 6, 18, 'O'], [4, 6, 18, 'O'], [4, 5, 18, 'O'], [4, 6, 19, 'O'], [3, 5, 18, 'O'], [2, 5, 19, 'P'],
              [2, 4, 19, 'P'], [1, 4, 20, 'P'], [1, 3, 20, 'P'], [1, 3, 21, 'O'], [2, 2, 21, 'H'], [2, 2, 22, 'H']];
  HORN.forEach(function (h) { putSym(h[0], h[1], h[2], h[3]); });

  // ---- lower jaw (z9..10): pale lower lip + chin, dark cheeks underneath ----
  row(1, 10, 'MMMM'); row(2, 10, 'MMMM');
  row(3, 10, 'BBBB'); row(3, 9, 'KK');
  row(4, 10, 'BBBB'); row(4, 9, 'KKKK');
  row(5, 10, 'BBBB'); row(5, 9, 'KKKK');

  // ---- legs: long, dark, knees and hocks, black hooves (left at x4-5, the right mirrored at x10-11) ----
  function legCol(pz, px, py) { var c = hsh(px, py, pz); return pz >= 7 ? (c < 30 ? 'B' : 'K') : 'K'; }
  function frontLeg(xa, xb) {
    for (y = 13; y <= 15; y++) { put(xa, y, 9, legCol(9, xa, y)); put(xb, y, 9, legCol(9, xb, y)); }   // elbow / forearm top
    for (z = 1; z <= 8; z++) for (y = 14; y <= 15; y++) { put(xa, y, z, legCol(z, xa, y)); put(xb, y, z, legCol(z, xb, y)); }
    for (y = 13; y <= 15; y++) { put(xa, y, 0, 'H'); put(xb, y, 0, 'H'); }                            // hoof
  }
  function hindLeg(xa, xb) {
    var H = [[9, 30, 32], [8, 31, 32], [7, 31, 32], [6, 32, 33], [5, 32, 33],          // gaskin back to the hock point
             [4, 32, 33], [3, 32, 33], [2, 31, 32], [1, 31, 32]];                       // cannon + fetlock
    for (var i = 0; i < H.length; i++) for (y = H[i][1]; y <= H[i][2]; y++) {
      put(xa, y, H[i][0], legCol(H[i][0], xa, y)); put(xb, y, H[i][0], legCol(H[i][0], xb, y));
    }
    for (y = 30; y <= 32; y++) { put(xa, y, 0, 'H'); put(xb, y, 0, 'H'); }                            // hoof
  }
  frontLeg(4, 5); frontLeg(10, 11); hindLeg(4, 5); hindLeg(10, 11);

  // ---- tail: from the tailhead, hanging to the hocks, black tuft ----
  row(35, 19, 'BB'); row(35, 18, 'BB');
  for (z = 9; z <= 17; z++) row(36, z, z % 3 === 0 ? 'KB' : 'BK');
  for (z = 5; z <= 8; z++) { row(36, z, 'KK'); row(37, z, z === 8 ? 'FK' : 'KK'); }

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  // ---- parts ----
  var PARTS = {
    body:   { box: [3, 13, 10, 13, 35, 23], pivot: [8, 23, 15] },
    neck:   { box: [3, 7, 10, 13, 13, 23], pivot: [8, 13.5, 18], parent: 'body' },
    head:   { box: [0, 0, 11, 16, 7, 23], pivot: [8, 6.5, 16], parent: 'neck' },
    jaw:    { box: [5, 0, 8, 11, 7, 11], pivot: [8, 5.5, 11], parent: 'head' },
    tail:   { box: [6, 35, 4, 10, 38, 21], pivot: [8, 35, 19], parent: 'body' },
    legFL:  { box: [3, 12, 5, 7, 17, 10], pivot: [5, 15, 10], parent: 'body' },
    legFR:  { box: [9, 12, 5, 13, 17, 10], pivot: [11, 15, 10], parent: 'body' },
    legBL:  { box: [3, 28, 5, 7, 35, 10], pivot: [5, 31.5, 10], parent: 'body' },
    legBR:  { box: [9, 28, 5, 13, 35, 10], pivot: [11, 31.5, 10], parent: 'body' },
    legFL2: { box: [3, 12, 0, 7, 17, 5], pivot: [5, 13.9, 5], parent: 'legFL' },
    legFR2: { box: [9, 12, 0, 13, 17, 5], pivot: [11, 13.9, 5], parent: 'legFR' },
    legBL2: { box: [3, 28, 0, 7, 35, 5], pivot: [5, 33, 5], parent: 'legBL' },
    legBR2: { box: [9, 28, 0, 13, 35, 5], pivot: [11, 33, 5], parent: 'legBR' }
  };
  var BODY_PIV = PARTS.body.pivot, NECK_PIV = PARTS.neck.pivot, HEAD_PIV = PARTS.head.pivot;

  // ---- legs + the in-file 2-bone solve (same maths as voxel_crocodile.js = engine voxelPose, architecture.md 38.67) ----
  var LEGS = [
    { k: 'FL', up: 'legFL', lo: 'legFL2', foot: [5, 14.5, 0] },
    { k: 'FR', up: 'legFR', lo: 'legFR2', foot: [11, 14.5, 0] },
    { k: 'HL', up: 'legBL', lo: 'legBL2', foot: [5, 31.5, 0] },
    { k: 'HR', up: 'legBR', lo: 'legBR2', foot: [11, 31.5, 0] }
  ];
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }
  LEGS.forEach(function (L) {
    var H = PARTS[L.up].pivot, K = PARTS[L.lo].pivot, F = L.foot;
    L.H = H; L.F = F;
    L.uy = K[1] - H[1]; L.uz = K[2] - H[2]; L.wy = F[1] - K[1]; L.wz = F[2] - K[2];
    L.a = Math.hypot(L.uy, L.uz); L.b = Math.hypot(L.wy, L.wz);
    L.phiU = Math.atan2(L.uz, L.uy); L.phiW = Math.atan2(L.wz, L.wy);
    L.sigma = wrapPi(L.phiW - L.phiU) > 0 ? 1 : -1;               // +1 apex front (knee / carpus), -1 apex back (hock)
  });
  function rotM(rx, ry, rz) {                                    // R = Rz * Ry * Rx (degrees), row-major 3x3
    var cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
    var cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
            -sy, cy * sx, cy * cx];
  }
  function solveLeg(L, br, bp, dy, dz) {
    var R = rotM(br[0], br[1], br[2]), P = BODY_PIV;
    var t0 = L.F[0] - P[0] - bp[0], t1 = L.F[1] + dy - P[1] - bp[1], t2 = L.F[2] + dz - P[2] - bp[2];
    var by = P[1] + R[1] * t0 + R[4] * t1 + R[7] * t2;            // target in the body frame (R^T)
    var bz = P[2] + R[2] * t0 + R[5] * t1 + R[8] * t2;
    var ey = by - L.H[1], ez = bz - L.H[2], D = Math.hypot(ey, ez), sm = L.a + L.b;
    D = Math.max(Math.abs(L.a - L.b) + 0.01 * sm, Math.min(sm - 0.01 * sm, D));
    var cK = Math.max(-1, Math.min(1, (D * D - L.a * L.a - L.b * L.b) / (2 * L.a * L.b)));
    var r2 = L.phiU - L.phiW + L.sigma * Math.acos(cK), c2 = Math.cos(r2), s2 = Math.sin(r2);
    var vy = L.uy + L.wy * c2 - L.wz * s2, vz = L.uz + L.wy * s2 + L.wz * c2;
    var r1 = Math.atan2(ez, ey) - Math.atan2(vz, vy);
    return [rd(wrapPi(r1) / D2R), rd(wrapPi(r2) / D2R)];
  }

  // ---- pose: o = { b: [rx,ry,rz, px,py,pz] body, n: neck [rx,ry,rz], h: head [rx,ry,rz], j: jaw open deg, t: tail,
  //   feet: { FL: [dy, dz], ... } hoof offsets from rest (cells; default planted), free: true = no solve, legs use
  //   o.FL / o.FL2 ... rotations }. Every frame keys all 13 parts; leg pos is always 0. ----
  function pose(o) {
    var b = o.b || [], br = [b[0] || 0, b[1] || 0, b[2] || 0], bp = [b[3] || 0, b[4] || 0, b[5] || 0];
    var f = {
      body: { rot: v3(br), pos: v3(bp) },
      neck: { rot: v3(o.n) },
      head: { rot: v3(o.h) },
      jaw: { rot: [rd(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      tail: { rot: v3(o.t) }
    };
    LEGS.forEach(function (L) {
      var up, lo;
      if (o.free) { up = v3(o[L.k]); lo = v3(o[L.k + '2']); }
      else {
        var off = (o.feet && o.feet[L.k]) || [0, 0], sl = solveLeg(L, br, bp, off[0], off[1]);
        up = [sl[0], 0, 0]; lo = [sl[1], 0, 0];
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

  // ---- (y, z) forward kinematics body -> neck -> head: world z of the muzzle front for a pose (graze solve) ----
  function rotYZ(dy, dz, deg) { var c = Math.cos(deg * D2R), sn = Math.sin(deg * D2R); return [c * dy - sn * dz, sn * dy + c * dz]; }
  var MUZZLE = [0, 12];                                          // model (y, z) of the muzzle front (nose pad)
  function muzzleZ(b, n, h) {
    var q = rotYZ(MUZZLE[0] - HEAD_PIV[1], MUZZLE[1] - HEAD_PIV[2], h);
    q = rotYZ(q[0] + HEAD_PIV[1] - NECK_PIV[1], q[1] + HEAD_PIV[2] - NECK_PIV[2], n);
    q = rotYZ(q[0] + NECK_PIV[1] - BODY_PIV[1], q[1] + NECK_PIV[2] - BODY_PIV[2], b[0] || 0);
    return BODY_PIV[2] + (b[5] || 0) + q[1];
  }
  // neck rx (0 .. nMax) that puts the muzzle at zTarget (bisection; the muzzle falls monotonically on that range)
  function neckFor(b, h, zTarget, nMax) {
    var lo = 0, hi = nMax;
    for (var i = 0; i < 30; i++) { var m = (lo + hi) / 2; if (muzzleZ(b, m, h) > zTarget) lo = m; else hi = m; }
    return rd((lo + hi) / 2);
  }

  // ---- gaits: ONE source for the clips and legRig.gaits (38.67 item 2). S = stance travel = v * T * duty (cells) ----
  // phase per leg in LEGS order [FL, FR, HL, HR]. walk = lateral sequence LH 0, LF .25, RH .5, RF .75; run = rotary gallop.
  var GAIT = {
    walk:   { T: 1200, keys: 12, v: 0.7, duty: 0.65, phase: [0.25, 0.75, 0, 0.5], liftM: 0.06, bz: -0.8, bob: 0.12, pitch: 0,
              yaw: 1.5, roll: 1.5, neck: 4, head: 2, nod: 3, tail: 4 },
    run:    { T: 600, keys: 8, v: 3.0, duty: 0.35, phase: [0, 0.1, 0.5, 0.6], liftM: 0.12, bz: -1.4, bob: 0.4, pitch: 3,
              yaw: 1, roll: 0.8, neck: -4, head: 0, nod: 3, tail: 6 },
    charge: { T: 600, keys: 8, v: 3.0, duty: 0.35, phase: [0, 0.1, 0.5, 0.6], liftM: 0.12, bz: -1.6, bob: 0.4, pitch: 3,
              yaw: 1, roll: 0.8, neck: 22, head: 18, nod: 2, tail: 8 }
  };
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function gaitClip(g) {
    var n = g.keys, S = g.v * (g.T / 1000) * g.duty / CM, lift = g.liftM / CM, frames = [], durs = [];
    for (var k = 0; k < n; k++) {
      var p = k / n, W = 2 * Math.PI * p, yaw = g.yaw * Math.sin(W), pit = g.pitch * Math.sin(W);
      var o = {
        b: [pit, g.roll * Math.sin(W - 2 * Math.PI * 0.2), yaw, 0, 0, g.bz + g.bob * Math.cos(2 * W)],
        n: [g.neck - pit + g.nod * Math.sin(2 * W + 0.6), 0, -yaw * 0.5],           // the head nods with each stride
        h: [g.head, 0, -yaw * 0.4],
        t: [0, g.tail * Math.sin(W - 1.2), 0],
        feet: {}
      };
      for (var li = 0; li < LEGS.length; li++) {
        var ph = (p - g.phase[li]) % 1; if (ph < 0) ph += 1;
        var Ty, lz = 0;
        if (ph < g.duty) Ty = -S / 2 + S * (ph / g.duty);                              // stance: hoof front -> back
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
    var sn = Math.sin(deg * D2R), c = Math.cos(deg * D2R), m = 1e9, gx, gy, gz, cx, cz, P = BODY_PIV;
    for (gz = 0; gz < SZ; gz++) for (gy = 0; gy < SY; gy++) for (gx = 0; gx < SX; gx++) {
      if (layers[gz][gy].charAt(gx) === '.') continue;
      for (cx = 0; cx < 2; cx++) for (cz = 0; cz < 2; cz++) m = Math.min(m, -(gx + cx - P[0]) * sn + (gz + cz - P[2]) * c);
    }
    return (ROLL_MIN[deg] = rd(-P[2] - m));
  }

  // ---- clips ----
  var anim = {};
  anim.idle = clip([
    [800,  { n: [0, 0, 0], h: [0, 0, 0], t: [0, 0, 0] }],
    [800,  { b: [0, 0, 0, 0, 0, 0.12], n: [-1, 0, 0], h: [-1, 0, 0], j: 4, t: [0, 8, 0] }],        // breath, chewing, swish
    [600,  { n: [0, 0, 0], h: [0, 0, 0], j: 0, t: [0, -6, 0] }],
    [400,  { n: [-2, 0, 8], h: [-2, 0, 6], j: 3, t: [0, 0, 0] }],                                 // head turn
    [400,  { n: [-2, 0, 8], h: [-4, 10, 8], j: 1, t: [0, 10, 0] }],                               // fly-toss
    [1000, { n: [0, 0, 0], h: [0, 0, 0], t: [0, 0, 0] }]
  ], true);
  anim.walk = gaitClip(GAIT.walk);
  anim.run = gaitClip(GAIT.run);
  anim.charge = gaitClip(GAIT.charge);
  // alert: head high and turning, a snort (jaw), tail out a little
  anim.alert = clip([
    [500, { b: [-1, 0, 0, 0, 0, -0.2], n: [-12, 0, 0], h: [-6, 0, 0], t: [10, 0, 0] }],
    [500, { b: [-1, 0, 0, 0, 0, -0.2], n: [-12, 0, 10], h: [-6, 0, 6], t: [10, 4, 0] }],
    [500, { b: [-1, 0, 0, 0, 0, -0.2], n: [-10, 0, -6], h: [-4, 0, -4], j: 6, t: [10, -4, 0] }],   // snort
    [500, { b: [-1, 0, 0, 0, 0, -0.2], n: [-12, 0, 0], h: [-6, 0, 0], t: [10, 0, 0] }]
  ], true);
  // windup 0.6 s: head drops (horns levelled forward), the right forehoof PAWS the ground twice, weight back, tail up
  anim.windup = clip([
    [150, { b: [2, 0, 0, 0, 0.8, -0.4], n: [18, 0, 0], h: [10, 0, 0], t: [20, 0, 0], feet: { FR: [-1.5, 1.5] } }],   // lift
    [150, { b: [2, 0, 0, 0, 1.0, -0.5], n: [22, 0, 0], h: [12, 0, 0], t: [25, 4, 0], feet: { FR: [1.5, 0.2] } }],    // scrape back
    [150, { b: [2, 0, 0, 0, 1.0, -0.5], n: [24, 0, -4], h: [12, 0, -4], t: [25, -4, 0], feet: { FR: [-1, 1.2] } }],  // lift again
    [150, { b: [3, 0, 0, 0, 1.2, -0.8], n: [26, 0, 0], h: [14, 0, 0], j: 4, t: [30, 0, 0] }]                          // braced (held)
  ], false);
  // attack 0.8 s: HORN CHARGE + HOOK. Drive head-low (0), impact (1), HOOK: the head tosses up and sideways (key 2 at
  // 300 ms), follow-through (3), settle near rest (4). The sim moves the entity for the stampede (kinds range 7 m).
  anim.attack = clip([
    [150, { b: [5, 0, 0, 0, -1.5, -0.6], n: [26, 0, 0], h: [16, 0, 0], t: [35, 0, 0], feet: { FL: [-3, 1.2], FR: [0.5, 0], HL: [1.5, 0], HR: [-1, 0.8] } }],
    [150, { b: [6, 0, 0, 0, -3, -0.8], n: [30, 0, -4], h: [18, 0, -4], t: [40, 0, 0], feet: { FL: [-3.5, 0], FR: [-1.5, 1.2], HL: [-0.5, 1], HR: [0.5, 0] } }],
    [150, { b: [-3, 0, 4, 0, -3, 0.2], n: [-6, 10, 14], h: [-10, 12, 10], j: 6, t: [30, 8, 0], feet: { FL: [-3.5, 0], FR: [-3, 0], HL: [-1.5, 0], HR: [-1, 0] } }],  // HOOK
    [150, { b: [-1, 0, 2, 0, -2, 0], n: [0, 6, 8], h: [-4, 6, 6], t: [20, 0, 0], feet: { FL: [-2.5, 0], FR: [-2.5, 0], HL: [-1.5, 0], HR: [-1.5, 0] } }],
    [200, { b: [0, 0, 0, 0, -0.5, 0], n: [4, 0, 0], h: [2, 0, 0], t: [10, 0, 0], feet: { FL: [-0.5, 0], FR: [-0.5, 0] } }]
  ], false);
  // graze 3.2 s: neck down with the muzzle in the grass (neck angle solved so the nose pad sits 0.12 m up), tearing grass
  // with small head twists, a tail swish, then the head comes up chewing and looking around (key 6)
  var GB = [6, 0, 0, 0, 0, -1.0], HG = -8;                       // shoulders 8 cm lower, trunk pitched 6 deg, hooves planted
  var N0 = neckFor(GB, HG, 1.5, 60);
  anim.graze = clip([
    [500, { b: GB, n: [N0, 0, 0], h: [HG, 0, 0], j: 2, t: [0, 0, 0] }],
    [300, { b: GB, n: [N0, 0, -3], h: [HG, 0, -6], j: 6, t: [0, 0, 0] }],             // tear
    [300, { b: GB, n: [N0 - 2, 0, 0], h: [HG, 0, 0], j: 2, t: [0, 0, 0] }],
    [300, { b: GB, n: [N0, 0, 3], h: [HG, 0, 6], j: 6, t: [0, 0, 0] }],               // tear
    [400, { b: GB, n: [N0 - 4, 0, 0], h: [HG, 0, 0], j: 1, t: [0, 10, 0] }],           // tail swish
    [400, { b: GB, n: [N0, 0, 0], h: [HG, 0, 0], j: 5, t: [0, -6, 0] }],
    [500, { b: [4, 0, 0, 0, 0, -0.4], n: [N0 - 34, 0, 6], h: [HG + 6, 0, 8], j: 4, t: [0, 0, 0] }],   // head up, chewing, looking
    [500, { b: GB, n: [N0, 0, 0], h: [HG, 0, 0], j: 2, t: [0, 0, 0] }]
  ], true);
  // hurt 0.1 s (2 step keys): flinch away, head tosses up, bellow
  anim.hurt = clip([
    [50, { b: [-4, 0, 0, 0, 1.2, -0.2], n: [-14, 0, 0], h: [-8, 0, 0], j: 16, t: [20, 0, 0] }],
    [50, { b: [-3, 0, 0, 0, 0.9, -0.2], n: [-9, 0, 0], h: [-5, 0, 0], j: 10, t: [15, 0, 0] }]
  ], false);
  anim.hurt.interp = 'step';
  // hitAdd 0.25 s ADDITIVE (38.68): frame 0 = rest (all zero), a jolt, back to rest (mask body / neck / head / jaw / tail)
  anim.hitAdd = clip([
    [50, { free: true }],
    [50, { free: true, b: [-3, 0, 0, 0, 0.6, 0.15], n: [-10, 0, 0], h: [-6, 0, 0], j: 12, t: [12, 0, 0] }],
    [50, { free: true, b: [-2, 0, 0, 0, 0.3, 0.1], n: [-5, 0, 4], h: [-3, 0, 2], j: 6, t: [6, 0, 0] }],
    [100, { free: true }]
  ], false);
  anim.flinch = clip([
    [50,  { b: [-3, 0, 0, 0, 0.9, -0.2], n: [-8, 0, 6], h: [-4, 0, 4], j: 6, t: [12, 0, 0] }],
    [100, { b: [1, 0, 0, 0, 0.2, 0], n: [4, 0, -4], h: [2, 0, -3], j: 2, t: [4, 0, 0] }],
    [100, {}]
  ], false);
  // dead: lying on its right side (rolled 90 deg about the trunk), legs out to the left, neck and head relaxed
  var DEAD_O = { free: true, b: [0, 90, 0, 0, 0, groundZ(90)], n: [6, 0, 0], h: [-4, 0, 0], j: 8, t: [0, 0, 0],
                 FL: [-20, 0, 0], FR: [-12, 0, 0], HL: [18, 0, 0], HR: [10, 0, 0],
                 FL2: [12, 0, 0], FR2: [6, 0, 0], HL2: [-10, 0, 0], HR2: [-5, 0, 0] };
  // die 0.5 s (beastView DIE_DURATIONS): bellow, knees buckle, rolls onto the right side, thud + leg kick (key 3), settles
  anim.die = clip([
    [90,  { b: [-5, 0, 0, 0, 0.4, -0.3], n: [-16, 0, 0], h: [-8, 0, 0], j: 18, t: [15, 0, 0] }],
    [110, { b: [5, 12, 0, 0, 0, -3], n: [10, 0, 0], h: [4, 0, 0], j: 10, t: [0, 0, 0] }],
    [120, { free: true, b: [3, 55, 0, 0, 0, groundZ(55)], n: [6, 0, 0], h: [0, 0, 0], j: 8, t: [0, 0, 0],
            FL: [-10, 0, 0], FR: [-6, 0, 0], HL: [10, 0, 0], HR: [6, 0, 0] }],
    [80,  mix(DEAD_O, { b: [0, 96, 0, 0, 0, groundZ(96)], n: [10, 0, 0], j: 12, FL: [-34, 0, 0], FR: [-24, 0, 0], HL: [30, 0, 0], HR: [22, 0, 0] })],   // THUD + kick
    [100, DEAD_O]
  ], false);
  anim.dead = clip([[1000, DEAD_O]], true);
  var SINK_M = 0.6, SUNK_O = mix(DEAD_O, { b: DEAD_O.b.slice() });
  SUNK_O.b[5] = rd(DEAD_O.b[5] - SINK_M / CM);
  anim.sink = clip([[500, DEAD_O], [100, SUNK_O]], false);
  anim.eat = anim.graze;                                         // alias: beastView STATE_EAT plays `eat`

  A.models.aurochs = {
    name: 'aurochs',
    displayName: 'aurochs',
    desc: 'OB-153 aurochs bull (2.8 m + tail, 1.76 m at the withers, on all fours): long head with a pale muzzle ring, ' +
          'long pale forward-curving horns with black tips, curly brown forelock, thick neck with dewlap, shoulder hump, ' +
          'pale eel stripe, dark brown-black coat, long legs, black hooves, tail to the hocks. 13 parts (neck + knee rig); ' +
          'clips idle, walk, run, charge (head down), alert, windup (paws the ground), attack (horn charge + hook), ' +
          'graze (= eat), hurt, hitAdd, flinch, die, dead, sink + blend block.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CM,
      size: [SX, SY, SZ],
      anchor: [8, 23, 0],
      light: false,
      mats: {
        K: 'fur_bear',           // near-black: shoulders, neck, belly, face, legs, tail tuft
        B: 'hair_dark',          // dark brown-black flanks, cheeks, ears
        F: 'fur_roe_dark',       // warm brown guard-hair highlights, curly forelock
        E: 'fur_agouti_light',   // pale eel stripe along the spine
        M: 'fur_wolf_light',     // pale mealy muzzle ring, lips, chin
        H: 'iron_dark',          // nose pad, nostrils, hooves, horn tips
        O: 'antler',             // pale horn
        P: 'linen_light',        // the palest mid curve of the horns
        Y: 'brass_dark',         // amber-brown eyes
        R: 'gore_red_dark'       // mouth
      },
      layers: layers,
      parts: PARTS,
      lookAt: { part: 'head', yawLimitDeg: 45, pitchLimitDeg: 20, hz: 1.2 },   // heavy head, slow follow
      legRig: {
        body: 'body',
        legs: LEGS.map(function (L) { return { upper: L.up, lower: L.lo, foot: L.foot.slice(), bend: L.sigma > 0 ? 'front' : 'back' }; }),
        gaits: {
          walk: { tunedMps: GAIT.walk.v, duty: GAIT.walk.duty, phase: GAIT.walk.phase.slice(), liftM: GAIT.walk.liftM },
          run:  { tunedMps: GAIT.run.v, duty: GAIT.run.duty, phase: GAIT.run.phase.slice(), liftM: GAIT.run.liftM }
        },
        stand: ['idle', 'alert', 'graze', 'eat'],               // not windup: the pawing hoof leaves the ground
        maxPitchDeg: 14, maxRollDeg: 6
      },
      animations: anim,
      // ANIM-BLEND (38.68): set speeds = legRig tunedMps. windup 100 ms, attack snaps in (60 ms); leaving the attack takes
      // >= 200 ms so the hook reads; hit = additive on body / neck / head / jaw / tail (never leg parts).
      blend: {
        sets: { locomotion: { param: 'speed', clips: [{ clip: 'walk', at: GAIT.walk.v }, { clip: 'run', at: GAIT.run.v }] } },
        fades: {
          default: 200,
          into: { windup: 100, attack: 60, charge: 150, hurt: 50, flinch: 80, graze: 300, eat: 300 },
          pairs: { 'windup>charge': 80, 'windup>attack': 60, 'charge>attack': 60, 'attack>idle': 250, 'attack>walk': 250,
                   'attack>run': 200, 'attack>charge': 200, 'graze>alert': 200, 'eat>alert': 200 }
        },
        additive: { hit: { clip: 'hitAdd', parts: ['body', 'neck', 'head', 'jaw', 'tail'], inMs: 50, outMs: 200, gain: 1 } }
      },
      mounts: {                                        // grid coords at rest; they follow their part
        notice:   { at: [8, 6, 26], part: 'body' },     // 2.1 m: over the horn tips
        forefeet: { at: [8, 14.5, 0.4], part: 'body' }, // dust between the forehooves (paw / charge)
        hit:      { at: [8, 22, 15.5], part: 'body' },  // flank centre (1.25 m)
        loot:     { at: [4, 22, 15], part: 'body' },    // the LEFT flank = the top of the corpse (dead pose)
        mouth:    { at: [8, 1, 10.5], part: 'head' },   // muzzle (grass / snort fx)
        horns:    { at: [8, 3, 21], part: 'head' }      // between the horn tips (hook hit point)
      }
    }
  };

  A.aurochsFx = {
    version: 1,
    model: 'aurochs',
    story: 'OB-153 (model + clips) for the grazer brain (herds 3-5, stampede charge)',
    clipFor: {
      state: { idle: 'idle', wander: 'walk', move: 'walk', return: 'walk', notice: 'alert', eat: 'graze', graze: 'graze',
               chase: 'charge', flee: 'run', windup: 'windup', telegraph: 'windup', charge: 'charge', stampede: 'charge',
               attack: 'attack', hook: 'attack', recover: 'idle', stagger: 'flinch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink', hitAdditive: 'hit',
      note: 'the boar view works unchanged: windup = windup, charge = the head-down gallop (chase + charge), eat = graze ' +
            '(alias). Play `attack` (hook) when the charge connects / ends at the target. With ANIM-BLEND request the ' +
            '`locomotion` set by speed for wander / flee.'
    },
    speeds: { walk: GAIT.walk.v, run: GAIT.run.v, charge: GAIT.charge.v,
              note: 'walk / run = legRig tunedMps (planted hooves); the leg driver stretches the stride above that; play ' +
                    'charge at rate ~ speed / 3.0.' },
    telegraph: { clip: 'windup', ms: 600, pawKeys: [0, 2], note: 'the right forehoof paws twice; last key held (kinds windupSec 0.6)' },
    charge: { clip: 'charge', loopMs: 600, note: 'head down, horns levelled forward; kinds activeSec 1.4' },
    hook: { clip: 'attack', ms: 800, impactKey: 1, impactMs: 150, hookKey: 2, hookMs: 300, hitMs: [150, 450],
            note: 'the clip drives the trunk 0.24 m forward; the sim moves the entity. Deal damage inside hitMs (horns mount).' },
    graze: { clip: 'graze', ms: 3200, muzzleUpM: 0.12, headUpKey: 6, note: 'beastView STATE_EAT plays `eat` (= graze)' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 15, note: 'as the boar' },
    death: {
      note: 'beastView timeline: hurt -> die (DIE_DURATIONS 90/110/120/80/100, thud at key 3) -> dead + lootable -> sink',
      thudKey: 3, thudMs: 320,
      corpseCentre: { rightM: -0.3, fwdM: 0, upM: 0.35, note: 'rolled onto the right side about the trunk centre: the ' +
                      'back lies 0.5 m to the right, the legs reach 1.2 m to the left, 0 .. 0.8 m up (entity frame)' },
      lootInteract: { prompt: '[E] Loot aurochs', radiusM: 2.4, aimUpM: 0.5 },
      sink: { clip: 'sink', steps: 30, depthM: SINK_M }
    },
    notice: { noticeUpM: 2.1, note: 'the `!` sits over the horn tips (1.84 m)' },
    collider: { lengthM: 2.8, widthM: 0.8, note: 'anchor between the hooves; muzzle 1.85 m ahead, buttocks 0.95 m behind. ' +
                'A capsule along y fits better than one circle.' }
  };

  // graze at STATE_EAT: beastView plays `eat` only for ASSETS.eatFx.models (design/models/voxel_eat_clips.js, loaded first)
  if (A.eatFx && Array.isArray(A.eatFx.models) && A.eatFx.models.indexOf('aurochs') < 0) {
    A.eatFx.models.push('aurochs');
    if (A.eatFx.ms) A.eatFx.ms.aurochs = 3200;
    if (A.eatFx.tearKey) A.eatFx.tearKey.aurochs = 1;
    if (A.eatFx.lookUpKey) A.eatFx.lookUpKey.aurochs = 6;
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { aurochs: A.models.aurochs, aurochsFx: A.aurochsFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
