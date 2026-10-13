/* design/models/voxel_heron.js - STILT, the heron of the Reedmire (designer, STILT-D1; owner approved 2026-10-12; pitch
 *                              docs/quest-roadmap.md 2b: "Heron of the Reedmire; speaks rarely; teaches the player to
 *                              stand still and look"). Stilt TALKS (rarely, slowly): the beak's LOWER MANDIBLE is the jaw
 *                              part, same jaw-sync contract as Burl (bearFx.talk) and Skip (otterFx.talk).
 *                              Binding rules: design/style-guide.md section 0 (realistic, nothing boxy). A heron stands on
 *                              its two legs - that is the natural bird stance (rule 0.2 is about quadrupeds standing up).
 *
 * Classic script (no import/export, check-deps rule 4). Stand-alone, same builder family as Burl / Skip:
 *   <script src="../design/models/voxel_heron.js">    (browser)
 *   import '../design/models/voxel_heron.js';         (Node)
 * Sets ASSETS.models.heron and ASSETS.heronFx. `meshOnly: true`. NOT placed in the world yet (later story).
 *
 * A realistic grey heron (Ardea cinerea), cellM 0.02, grid 13 x 38 x 48:
 *   - 0.94 m to the crown standing (neck in its resting S), 0.74 m beak tip to tail / wing tips, 0.22 m wide.
 *   - S-CURVED NECK: rises forward off the breast, bends back, then forward again into the head; white foreneck with a
 *     line of black streaks, pale grey sides and nape, long pale breast plumes hanging over the breast.
 *   - DAGGER BEAK: 12 cm, yellow-ochre, darker culmen + tip; the lower mandible is the jaw part (talk / strike gape).
 *   - HEAD: white face and crown centre, the broad BLACK STRIPE from above the eye to the nape that ends in a thin black
 *     CREST PLUME trailing back; yellow lore in front of a dark eye.
 *   - BODY: tilted ovoid (breast high, tail low), grey back, pale belly, black flank stripe on the breast sides.
 *   - FOLDED WINGS (own parts): ash-grey coverts with a pale upper edge, the black "epaulette" at the bend of the wing,
 *     dark grey-black flight feathers whose tips cross over the short grey tail.
 *   - LONG LEGS: yellowish-brown bare tibia + tarsus (1 cell = 2 cm thick), feathered pale thighs, long toes (3 front,
 *     1 back) with dark claws.
 * Axes as Burl (15.1): x = east (= Stilt's right), y = SOUTH with y0 = the beak tip (faces north at yaw 0), z = up.
 * Centre column x6 (continuous 6.5). Anchor [6.5, 24.5, 0] = between the two feet. Clip `pos` values are VOXELS.
 *
 * Parts (8 = MAX_VOX_PARTS; first-box-wins ownership, every parent earlier, each box sx+sy+sz <= 48):
 *   body  [3,13,19, 10,36,35]  pivot [6.5, 24.5, 26]   root: trunk, breast, tail, thighs. rx + = breast down.
 *   neck  [4,8,27, 9,15,43]    pivot [6.5, 13, 31]     the S neck + breast plumes. rx + = forward/down, - = drawn back;
 *                                                       rz - = turns left (west), ry - = leans left.
 *   head  [4,0,43, 9,17,48]    pivot [6.5, 10.5, 43]   skull, upper mandible, eyes, black stripe, crest plume.
 *                                                       rx + = beak down, ry = tilt, rz - = looks left.
 *   jaw   [5,0,41, 8,8,43]     pivot [6.5, 6.5, 43]    LOWER MANDIBLE + chin; OPEN = rx +, 0 .. JAW_MAX (dialogue sync).
 *   wingL [1,14,22, 4,38,36]   pivot [2.5, 15, 34]     folded wing on the left side (x1..2, tips x2..3 past the tail).
 *   wingR [9,14,22, 12,38,36]  pivot [10.5, 15, 34]    ry + (wingL) / ry - (wingR) = the wing flares out (preen).
 *   legL  [1,18,0, 6,27,21]    pivot [4.5, 25, 19.5]   bare leg + toes; rx - = foot forward. legR mirrored at x8.
 *   No tail part (a heron's tail is short and stiff, it rides on the body). No fly clips: the 1.8 m spread wingspan does
 *   not fit a 48-step part box; take-off / landing would need a separate flight model (NOTE for the PO).
 *
 * Clips (ms, multiples of 50). Legs are GROUND-SNAPPED per key (pos z solved so the lowest foot corner sits on z = 0
 * for that key's body pitch / drop; `lift` = clearance of a stepping foot); legs stay plumb under body pitch.
 *   idle      loop 4.0 s  MOTIONLESS: long holds, a rare slow head tilt (one eye down), a slow look left, a breath.
 *                         (A blink needs an eyelid part - not in the 8-part rig; the tilt reads as the "blink".)
 *   stalk     loop 2.0 s  slow HIGH STEPS: a foot lifts 10 cm, swings forward, is set down slowly; neck eases
 *                         forward with each step while the head stays level. ~0.1 m/s.
 *   stillHunt loop 3.0 s  neck drawn back (coiled), breast down, beak aimed at the water; frozen, micro-shifts only.
 *   strike    once 0.9 s  from stillHunt: a short draw-back, then the neck SHOOTS forward-down (100 ms) with the beak
 *                         open a little, hold in the water, pull up + swallow, back to the stillHunt pose.
 *   talk      loop 2.0 s  head raised a little, 12 keys: jaw 0/12/3/8/2/16/5/10/0/6/13/3 (Burl's rhythm, slower),
 *                         key 8 = closed pause; tiny calm head nods.
 *   listen    loop 3.0 s  still; slow head tilt to one eye, then the other.
 *   preen     loop 3.0 s  neck turns back over the left shoulder, beak down into the flared left wing, nibbling.
 *   nod       once 0.9 s  GREETING: a slow, dignified bow of neck and head.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 13, SY = 38, SZ = 48, CELL = 0.02, CX = 6;
  function hsh(a, b, c) {                     // same deterministic hash as voxel_bear.js
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }

  // ---- voxel grid + rounded-slice helpers (same as voxel_otter.js) ----
  var G = [], x, y, z;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }
  function keep(ea, eb, r) {
    if (r <= 1) return true;
    var da = Math.max(0, r - 0.5 - ea), db = Math.max(0, r - 0.5 - eb);
    return da * da + db * db <= (r - 0.5) * (r - 0.5) + 0.3;
  }
  function rect(axis, L, a0, a1, b0, b1, r, ch) {
    for (var b = b0; b < b1; b++) for (var a = a0; a < a1; a++) {
      if (!keep(Math.min(a - a0, a1 - 1 - a), Math.min(b - b0, b1 - 1 - b), r)) continue;
      var px = axis === 'x' ? L : a, py = axis === 'x' ? a : (axis === 'y' ? L : b), pz = axis === 'z' ? L : b;
      put(px, py, pz, typeof ch === 'function' ? ch(px, py, pz) : ch);
    }
  }

  // ---- body: one rounded slice per y [halfWidth, z0, z1, r] (z half-open). Tilted ovoid: breast high, tail low.
  var PROF = { 13: [2, 26, 32, 2], 14: [3, 24, 34, 3], 31: [2, 23, 30, 2], 32: [2, 23, 30, 2], 33: [2, 24, 29, 2],
               34: [1, 24, 28, 1], 35: [1, 24, 27, 1] };
  for (y = 15; y <= 19; y++) PROF[y] = [3, 22, 35, 3];
  for (y = 20; y <= 24; y++) PROF[y] = [3, 21, 34, 3];
  for (y = 25; y <= 27; y++) PROF[y] = [3, 21, 33, 3];
  for (y = 28; y <= 30; y++) PROF[y] = [3, 22, 32, 3];
  // W white, L pale grey, G ash grey, K black, S black streak
  function bodyMat(px, py, pz) {
    var p = PROF[py], dTop = p[2] - 1 - pz, dBot = pz - p[1], c = hsh(px, py >> 1, pz >> 1);
    if (py === 13) return (px === CX && (pz & 1)) ? 'S' : 'W';                      // breast front, streaked
    if (py >= 31) return dBot === 0 ? 'L' : 'G';                                     // short grey tail
    if (dTop <= 1) return c < 15 ? 'L' : 'G';                                        // grey back
    if ((px === 3 || px === 9) && dBot >= 2 && dBot <= 4 && py <= 22) return 'K';    // black flank stripe
    if (dBot <= 1) return c < 30 ? 'W' : 'L';                                        // pale belly
    return py <= 16 ? 'W' : 'L';
  }
  for (y = 13; y <= 35; y++) rect('y', y, CX - PROF[y][0], CX + PROF[y][0] + 1, PROF[y][1], PROF[y][2], PROF[y][3], bodyMat);
  for (z = 19; z <= 20; z++) { putSym(4, 24, z, 'L'); putSym(4, 25, z, 'L'); }     // feathered thighs

  // ---- folded wings (wingL x1..2, mirrored): [z0, z1) per y ----
  var WPROF = {};
  for (y = 15; y <= 17; y++) WPROF[y] = [28, 35];
  for (y = 18; y <= 28; y++) WPROF[y] = [25, 35];
  for (y = 29; y <= 32; y++) WPROF[y] = [24, 33];
  for (y = 33; y <= 35; y++) WPROF[y] = [24, 31];
  function wingMat(py, pz) {
    var w = WPROF[py], c = hsh(py, pz, 3);
    if (py <= 16 && pz >= 31) return 'K';                                            // black epaulette (wing bend)
    if (py >= 33) return 'K';                                                        // primary tips
    if (py >= 29 || (py >= 21 && pz <= w[0] + 1)) return c < 20 ? 'K' : 'D';        // flight feathers
    if (pz === w[1] - 1) return 'L';                                                 // pale upper edge (scapulars)
    return c < 10 ? 'L' : 'G';
  }
  for (y = 15; y <= 35; y++) for (z = WPROF[y][0]; z < WPROF[y][1]; z++) putSym(2, y, z, wingMat(y, z));
  for (y = 18; y <= 28; y++) for (z = 27; z <= 33; z++) putSym(1, y, z, wingMat(y, z));   // the folded wing's bulge
  for (z = 24; z <= 27; z++) { putSym(2, 36, z, 'K'); putSym(3, 36, z, 'K'); }        // wing tips cross over the tail
  for (z = 24; z <= 26; z++) putSym(3, 37, z, 'K');

  // ---- S neck: per z [y front, y back, half-width] + breast plumes ----
  var NECK = { 31: [11, 14, 2], 32: [10, 14, 2], 33: [10, 13, 1], 34: [9, 12, 1], 35: [9, 11, 1], 36: [9, 11, 1],
               37: [9, 11, 1], 38: [10, 12, 1], 39: [11, 13, 1], 40: [11, 13, 1], 41: [10, 13, 1], 42: [8, 12, 1] };
  for (z = 31; z <= 42; z++) {
    var nk = NECK[z];
    for (y = nk[0]; y <= nk[1]; y++) for (x = CX - nk[2]; x <= CX + nk[2]; x++) {
      var front = y === nk[0], back = y === nk[1], edge = Math.abs(x - CX) === nk[2];
      if (nk[2] === 2 && edge && (front || back)) continue;                          // round the wide base
      var ch = front ? ((x === CX && (z & 1)) ? 'S' : 'W') : back ? (z <= 34 ? 'G' : 'L') : (z >= 37 ? 'W' : 'L');
      put(x, y, z, ch);
    }
  }
  for (z = 28; z <= 30; z++) for (x = 5; x <= 7; x++) put(x, 12, z, hsh(x, 12, z) < 35 ? 'L' : 'W');   // breast plumes
  put(6, 12, 27, 'W');

  // ---- head (z43..46): skull, upper mandible, eye, black stripe, crest plume ----
  for (z = 43; z <= 45; z++) for (y = 6; y <= 11; y++) for (x = 5; x <= 7; x++) {
    var hc = 'W';
    if (y === 11 && z <= 44) hc = 'L';                                               // pale nape
    if (x !== CX && y >= 8 && z === 45) hc = 'K';                                    // black stripe behind the eye
    if (x !== CX && y >= 10 && z === 44) hc = 'K';
    if (x !== CX && (y === 6 || y === 11) && z === 45) continue;                     // round the skull
    put(x, y, z, hc);
  }
  for (y = 7; y <= 10; y++) for (x = 5; x <= 7; x++) {                              // crown: white centre, black sides
    if (x !== CX && (y === 7 || y === 10)) continue;
    put(x, y, 46, x === CX ? (y >= 9 ? 'K' : 'W') : 'K');
  }
  putSym(5, 7, 44, 'E');                                                             // dark eye
  putSym(5, 6, 44, 'I');                                                             // yellow lore
  for (x = 5; x <= 7; x++) put(x, 12, 45, 'K');                                      // crest plume root
  put(6, 12, 46, 'K'); put(6, 13, 46, 'K'); put(6, 14, 45, 'K'); put(6, 15, 45, 'K'); put(6, 16, 44, 'K');   // plume
  // upper mandible: 2 cells deep at the base, 1 at the dagger tip
  for (y = 0; y <= 5; y++) put(6, y, 43, y === 0 ? 'b' : 'B');
  for (y = 2; y <= 5; y++) put(6, y, 44, 'b');                                       // darker culmen
  for (y = 4; y <= 5; y++) { putSym(5, y, 43, 'B'); putSym(5, y, 44, 'B'); }

  // ---- jaw (z42): lower mandible + chin ----
  for (y = 1; y <= 6; y++) put(6, y, 42, y === 1 ? 'b' : 'B');
  for (y = 5; y <= 6; y++) putSym(5, y, 42, 'B');
  for (x = 5; x <= 7; x++) put(x, 7, 42, 'W');                                       // white chin

  // ---- legs (legL at x4, legR mirrored at x8): bare tibia + tarsus, toes, claws ----
  for (z = 12; z <= 18; z++) putSym(4, 25, z, 'Y');                                   // bare tibia
  putSym(4, 24, 11, 'Y'); putSym(4, 25, 11, 'Y');                                     // ankle knuckle
  for (z = 1; z <= 10; z++) putSym(4, 24, z, 'Y');                                    // tarsus
  for (y = 20; y <= 24; y++) putSym(4, y, 0, 'y');                                    // middle toe
  putSym(4, 19, 0, 'E');                                                              // its claw
  putSym(3, 22, 0, 'y'); putSym(3, 21, 0, 'y'); putSym(2, 20, 0, 'E');                // outer toe
  putSym(5, 22, 0, 'y'); putSym(5, 21, 0, 'E');                                       // inner toe
  putSym(4, 25, 0, 'y'); putSym(4, 26, 0, 'E');                                       // hind toe

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  var parts = {
    body:  { box: [3, 13, 19, 10, 36, 35], pivot: [6.5, 24.5, 26] },
    neck:  { box: [4, 8, 27, 9, 15, 43], pivot: [6.5, 13, 31], parent: 'body' },
    head:  { box: [4, 0, 43, 9, 17, 48], pivot: [6.5, 10.5, 43], parent: 'neck' },
    jaw:   { box: [5, 0, 41, 8, 8, 43], pivot: [6.5, 6.5, 43], parent: 'head' },
    wingL: { box: [1, 14, 22, 4, 38, 36], pivot: [2.5, 15, 34], parent: 'body' },
    wingR: { box: [9, 14, 22, 12, 38, 36], pivot: [10.5, 15, 34], parent: 'body' },
    legL:  { box: [1, 18, 0, 6, 27, 21], pivot: [4.5, 25, 19.5], parent: 'body' },
    legR:  { box: [7, 18, 0, 12, 27, 21], pivot: [8.5, 25, 19.5], parent: 'body' }
  };
  var PNAMES = Object.keys(parts);
  function ownerOf(px, py, pz) {
    for (var i = 0; i < PNAMES.length; i++) {
      var b = parts[PNAMES[i]].box;
      if (px >= b[0] && px < b[3] && py >= b[1] && py < b[4] && pz >= b[2] && pz < b[5]) return PNAMES[i];
    }
    return null;
  }
  var LIMB_PART = { lL: 'legL', lR: 'legR' }, LIMB_YZ = {};
  Object.keys(LIMB_PART).forEach(function (k) {
    var pn = LIMB_PART[k], seen = {}, list = [];
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (layers[z][y].charAt(x) === '.' || ownerOf(x, y, z) !== pn || seen[y + ',' + z]) continue;
      seen[y + ',' + z] = 1; list.push([y, z]);
    }
    LIMB_YZ[k] = list;
  });

  // ---- pose: o = { b: [rx, ry, rz, px, py, pz] body, n neck, h head, j jaw, wL wR wing rot, lL lR leg rot (number =
  // rx), lift { lL: cells } }. Same ground solve as voxel_otter.js. ----
  var JAW_MAX = 18, D2R = Math.PI / 180, PB = parts.body.pivot;
  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function v3(a) { return a == null ? [0, 0, 0] : typeof a === 'number' ? [a, 0, 0] : [a[0] || 0, a[1] || 0, a[2] || 0]; }
  function groundPz(k, rxDeg, b) {
    var pv = parts[LIMB_PART[k]].pivot, a = rxDeg * D2R, be = (b[0] || 0) * D2R;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(be), sb = Math.sin(be), m = 1e9, L = LIMB_YZ[k];
    for (var i = 0; i < L.length; i++) for (var cy = 0; cy < 2; cy++) for (var cz = 0; cz < 2; cz++) {
      var dy = L[i][0] + cy - pv[1], dz = L[i][1] + cz - pv[2];
      var ly = pv[1] + dy * ca - dz * sa - (b[4] || 0), lz = pv[2] + dy * sa + dz * ca;
      var wz = PB[2] + (ly - PB[1]) * sb + (lz - PB[2]) * cb + (b[5] || 0);
      if (wz < m) m = wz;
    }
    return -m / cb;
  }
  function rot3(a) { var r = v3(a); return [r2(r[0]), r2(r[1]), r2(r[2])]; }
  function pose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0], L = o.lift || {};
    function limb(k) {
      var r = v3(o[k]); r[0] -= (b[0] || 0);
      return { rot: [r2(r[0]), r2(r[1]), r2(r[2])], pos: [r2(-(b[3] || 0)), r2(-(b[4] || 0)), r2(groundPz(k, r[0], b) + (L[k] || 0))] };
    }
    return {
      body: { rot: [r2(b[0] || 0), r2(b[1] || 0), r2(b[2] || 0)], pos: [r2(b[3] || 0), r2(b[4] || 0), r2(b[5] || 0)] },
      neck: { rot: rot3(o.n) },
      head: { rot: rot3(o.h) },
      jaw: { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      wingL: { rot: rot3(o.wL) },
      wingR: { rot: rot3(o.wR) },
      legL: limb('lL'), legR: limb('lR')
    };
  }
  function arr(v) { return typeof v === 'number' ? [v] : v; }
  function addO(base, o) {                                      // additive merge (arrays + jaw add, lift overrides)
    var r = {}, k, i;
    for (k in base) r[k] = base[k];
    for (k in o) {
      if (k === 'lift' || r[k] === undefined) { r[k] = o[k]; continue; }
      var a = arr(r[k]), c = arr(o[k]), n = Math.max(a.length, c.length), s = [];
      for (i = 0; i < n; i++) s.push((a[i] || 0) + (c[i] || 0));
      r[k] = s.length === 1 ? s[0] : s;
    }
    return r;
  }
  function clip(keys, loop, base) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(base ? addO(base, keys[i][1]) : keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  var HUNT = { b: [10, 0, 0, 0, 0, -0.5], n: [-14, 0, 0], h: [28, 0, 0] };          // neck coiled, beak at the water
  var TALK_UP = { n: [-4, 0, 0], h: [-6, 0, 0] };
  var PR = { n: [4, -10, -120], h: [52, 0, 0], wL: [0, 12, 0] };                     // preen: neck back over the left shoulder
  var animations = {
    idle: clip([
      [1000, {}],
      [300, { h: [2, 7, 0] }],                                                       // rare slow tilt: one eye down
      [800, { h: [2, 7, 0] }],
      [300, { h: [0, 0, -14] }],                                                     // slow look left
      [700, { h: [0, 0, -14], n: [0, 0, -4] }],
      [400, { b: [0, 0, 0, 0, 0, 0.15] }],                                           // a breath
      [500, {}]
    ], true),
    stalk: clip([
      [300, { lL: -6, lR: 6 }],                                                      // both down, left ahead
      [400, { lL: 4, lR: -10, lift: { lR: 5 }, b: [2, 0, 0, 0, 0, 0], n: [3, 0, 0], h: [-5, 0, 0] }],   // right foot lifted high
      [300, { lL: 6, lR: -8, lift: { lR: 2 }, b: [1, 0, 0, 0, 0, 0], n: [2, 0, 0], h: [-3, 0, 0] }],    // set down slowly
      [300, { lL: 6, lR: -6 }],                                                      // both down, right ahead
      [400, { lL: -10, lR: 4, lift: { lL: 5 }, b: [2, 0, 0, 0, 0, 0], n: [3, 0, 0], h: [-5, 0, 0] }],
      [300, { lL: -8, lR: 6, lift: { lL: 2 }, b: [1, 0, 0, 0, 0, 0], n: [2, 0, 0], h: [-3, 0, 0] }]
    ], true),
    stillHunt: clip([
      [1000, {}],
      [600, { h: [1, 0, -2] }],                                                      // micro-shift, then frozen again
      [800, { h: [1, 0, -2] }],
      [600, { n: [1, 0, 0], h: [0, 0, 1] }]
    ], true, HUNT),
    strike: clip([
      [150, { n: [-8, 0, 0], h: [-4, 0, 0] }],                                       // draw back (anticipation)
      [100, { b: [16, 0, 0, 0, 0, 0], n: [70, 0, 0], h: [-12, 0, 0], j: 12 }],       // the lunge
      [150, { b: [20, 0, 0, 0, 0, 0], n: [75, 0, 0], h: [-10, 0, 0], j: 5 }],        // beak in the water
      [200, { b: [4, 0, 0, 0, 0, 0], n: [22, 0, 0], h: [-30, 0, 0], j: 3 }],         // pull up, swallow
      [300, {}]                                                                      // back to the stillHunt pose
    ], false, HUNT),
    // jaw sizes small (2-6) / mid (8-10) / wide (12-16), slow syllables, key 8 = closed pause (heronFx.talk)
    talk: clip([
      [150, {}],
      [150, { j: 12, h: [-2, 0, 0] }],
      [150, { j: 3, h: [0, 2, 0] }],
      [150, { j: 8 }],
      [150, { j: 2, h: [2, 2, 0] }],
      [200, { j: 16, h: [-3, 0, 0], n: [-1, 0, 0] }],
      [150, { j: 5, h: [1, 0, 0] }],
      [150, { j: 10, h: [0, -2, 0] }],
      [300, { j: 0, h: [3, -3, 0] }],                                                // pause: a calm small nod
      [150, { j: 6, h: [1, 0, 0] }],
      [150, { j: 13, h: [-2, 0, 0] }],
      [150, { j: 3 }]
    ], true, TALK_UP),
    listen: clip([
      [900, { h: [0, 10, 8] }],
      [600, { h: [0, 11, 8], b: [0, 0, 0, 0, 0, 0.15] }],
      [500, { h: [2, 0, 0] }],
      [1000, { h: [0, -9, -6] }]
    ], true),
    preen: clip([
      [500, PR],
      [200, addO(PR, { n: [1, 0, -2], h: [4, 0, 4], j: 8, wL: [0, 2, 0] })],           // nibble
      [200, addO(PR, { n: [1, 0, -2], h: [2, 0, -4], j: 1, wL: [0, 2, 0] })],
      [250, addO(PR, { n: [2, -1, -4], h: [6, 0, 6], j: 9, wL: [0, 3, 0] })],
      [200, addO(PR, { n: [1, 0, -2], h: [3, 0, 0], j: 2, wL: [0, 2, 0] })],
      [450, { n: [0, -4, -60], h: [10, 0, 0], wL: [0, 4, 0] }],                       // pause, looks up to the side
      [400, addO(PR, { j: 5 })],
      [200, addO(PR, { n: [1, 0, -2], h: [5, 0, -5], j: 9, wL: [0, 2, 0] })],
      [600, {}]                                                                      // back to rest, hold
    ], true),
    nod: clip([
      [200, { n: [-3, 0, 0], h: [-4, 0, 0] }],
      [300, { b: [3, 0, 0, 0, 0, 0], n: [8, 0, 0], h: [14, 0, 0] }],
      [400, {}]
    ], false)
  };

  // materials: only already-merged palette keys (CHARGEN hair_grey / hair_black / dye_weld ramps). If a CHARGEN key is
  // missing from palette.js or detail-pass.js the fallback keeps the model valid.
  var PM = A.palette && A.palette.materials, DM = A.detailPass && A.detailPass.materials;
  function pick(k, fb) { return (!PM || !DM || (PM[k] && DM[k])) ? k : fb; }
  var mats = {
    G: pick('hair_grey', 'granite_light'),       // ash-grey back, coverts, tail (#9a958d)
    L: pick('hair_grey_light', 'linen'),         // pale grey neck sides, belly, wing edge (#c8c4bc)
    D: pick('hair_grey_dark', 'granite_dark'),   // dark grey flight feathers (#6a665f)
    K: pick('hair_black', 'iron_dark'),          // crest, eye stripe, epaulette, flank stripe, primary tips (#1f1b19)
    S: pick('hair_black_light', 'iron_dark'),    // foreneck / breast streaks (#3a3532)
    W: 'linen_light',                            // white face, crown centre, foreneck, breast
    B: 'straw',                                  // yellow-ochre dagger beak
    b: 'straw_dark',                             // culmen + beak tips
    I: 'petal_yellow',                           // yellow lore in front of the eye
    E: 'iron_dark',                              // eye, claws
    Y: pick('dye_weld', 'straw_dark'),           // yellowish-brown legs (#a8904a)
    y: pick('dye_weld_dark', 'skin_shade')       // toes (#6e5e30)
  };

  A.models.heron = {
    name: 'heron',
    displayName: 'grey heron',
    desc: 'STILT-D1 Stilt, the heron of the Reedmire: a realistic grey heron standing on its two long yellowish legs ' +
          '(0.94 m): S-curved white neck with black foreneck streaks, yellow-ochre dagger beak (lower mandible moves), ' +
          'white face with the black eye stripe ending in a thin black crest plume, ash-grey folded wings with the ' +
          'black epaulette and dark flight feathers, pale breast plumes. Clips idle, stalk, stillHunt, strike, talk, ' +
          'listen, preen, nod.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [6.5, 24.5, 0],
      light: false,
      mats: mats,
      layers: layers,
      parts: parts,
      animations: animations,
      mounts: {
        speech:   { at: [6.5, 9, 50], part: 'head' },     // speech bubble / name tag anchor (~8 cm over the crown)
        eyes:     { at: [6.5, 7.5, 44.5], part: 'head' }, // dialogue camera look-at (between the eyes)
        mouth:    { at: [6.5, 3, 43], part: 'head' },     // voice origin (the gape)
        beakTip:  { at: [6.5, 0, 43], part: 'head' },     // strike splash / fish later
        interact: { at: [6.5, 16, 30], part: 'body' },    // [E] Talk prompt aim (breast, 0.6 m)
        feet:     { at: [6.5, 24.5, 0], part: 'body' }    // ripple rings when standing in water later
      }
    }
  };

  A.heronFx = {
    version: 1,
    model: 'heron',
    character: 'Stilt',
    story: 'STILT-D1 (model); placement + dialogue wiring = a later story',
    clipFor: {
      state: { idle: 'idle', greet: 'nod', talk: 'talk', listen: 'listen', move: 'stalk', run: 'stalk',
               hunt: 'stillHunt', strike: 'strike', preen: 'preen' },
      once: { strike: 'stillHunt', nod: 'idle' },
      move: { start: 'stalk', loop: 'stalk', stop: 'idle' },
      note: 'Same contract as bearFx: once = non-loop clips and what follows them at animEnd. greet = nod (a slow ' +
            'bow; a heron does not wave). strike starts and ends in the stillHunt pose. run = stalk: Stilt never ' +
            'hurries on foot (fly-off would need a separate flight model).'
    },
    talk: {
      jawPart: 'jaw', jawAxis: 'rx', jawOpenSign: 1, jawMaxDeg: JAW_MAX, jawPivot: [6.5, 6.5, 43],
      textCps: 18,                                   // Stilt speaks rarely and slowly (Burl 28, Skip 32)
      pauseMs: { ',': 320, ';': 320, ':': 320, '-': 320, '.': 700, '!': 700, '?': 700 },
      pauseKey: 8, pauseAtMs: 1250,                  // talk key 8 = jaw closed; its start = 1250 ms into the clip
      rule: 'as bearFx.talk: play `talk` while the line types on; on a punctuation pause hold at pauseAtMs (jaw ' +
            'closed) for pauseMs, then resume FROM pauseAtMs. When the line is fully shown switch to `listen` ' +
            '(Stilt goes still again quickly: after ~2 s of listen, idle is fine).'
    },
    speeds: { stalk: 0.1, note: 'm/s the clip is authored for; scale the clip rate with the real speed' },
    sampleLine: { name: 'Stilt', text: 'Stand. Be still. The water shows you nothing while you move. Now - look.',
                  note: 'placeholder text for the preview; the writer owns the real lines' },
    heightM: 0.94
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { heron: A.models.heron, heronFx: A.heronFx };
})(typeof window !== 'undefined' ? window : globalThis);
