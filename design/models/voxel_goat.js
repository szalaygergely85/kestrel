/* design/models/voxel_goat.js - CRAG, the old goat of Signal Head (designer, CRAG-D1; owner approved the 12 new
 *                             characters 2026-10-12; pitch docs/quest-roadmap.md 2b: "Old goat of Signal Head;
 *                             grumbles, leads the player up the ledges in Ch5"). Crag TALKS (giver / guide), like Burl.
 *                             Binding rules: design/style-guide.md section 0 (realistic, all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4). Stand-alone:
 *   <script src="../design/models/voxel_goat.js">    (browser)
 *   import '../design/models/voxel_goat.js';         (Node)
 * Sets ASSETS.models.goat and ASSETS.goatFx. `meshOnly: true`. NOT in game/index.html or the world yet (later story).
 * Only already-merged palette + detail-pass materials (no palette / detail-pass edit needed).
 *
 * An old feral billy / mountain goat: 0.81 m at the withers (incl. the mane), 1.1 m to the horn crests, 1.18 m nose to
 * tail. cellM 0.037, grid 16 x 32 x 31. Shaggy long coat (greyed white-brown: pale buff-grey base, cream tips, grey-brown
 * partings, buff-brown dirty hem) hanging as a ragged SKIRT below the flanks; a neck + withers MANE and throat ruff; a
 * long BEARD (24 cm, on the jaw part so it wags while he talks); big backward-curving RIDGED horns (scimitar, dark ridge
 * grooves every cell, spreading outward, tips over the withers); sideways ears; amber eyes; a SAGGING back (withers and
 * rump high, the middle 2 cells lower); slender legs with dark knee calluses, dark pasterns, dewclaws and black hooves;
 * a short upturned tail.
 * Rig = the deer's 4-leg ungulate rig (voxel_wildlife.js: body, head + neck, ears, tail, legFL/FR/BL/BR) + Burl's jaw
 * part for the dialogue jaw sync. Axes as Burl / deer: x = east (the goat's right), y = SOUTH with y0 = the nose
 * (faces north at yaw 0), z = up. Anchor [8, 20, 0] = between the four hooves. Clip `pos` values are VOXELS.
 *
 * Parts (first-box-wins ownership, every parent earlier, each box sx+sy+sz <= 48):
 *   (8 parts = engine max, VoxelModel.js: the tail is part of the body, so no tail flick; `t` keys are ignored)
 *   body  [2,10,10, 14,32,23]  pivot [8, 20, 15]     trunk, skirt, withers mane, short tail. rx + = nose down.
 *   head  [3,0,14, 13,14,31]   pivot [8, 10, 18]     neck y7..9, skull, muzzle, horns, ear roots. rx - = nose up, rz = turn.
 *   jaw   [5,0,6, 11,7,14]     pivot [8, 6, 13.5]    lower jaw + chin + BEARD. rx + = open, 0 .. 20 (goatFx.talk).
 *   ears  [0,4,19, 16,8,24]    pivot [8, 6, 21]      both sideways ears. rx + = forward, - = back; ry = flick (one up).
 *   tail  [6,30,17, 10,32,24]  pivot [8, 30, 19]     rx + = up (flick).
 *   legFL / legFR [2|9,11,0, 7|14,16,10] pivot [4|12, 13, 11]; legBL / legBR [2|9,24,0, 7|14,30,10] pivot [4|12, 26.5, 11].
 *                             rx - = hoof forward.
 *
 * Clips (ms, multiples of 50). Every limb is GROUND-SNAPPED per key (pos z solved from its own voxels so its lowest
 * corner sits on z = 0 for that key's body pitch / drop + limb angle; `lift` adds clearance) and stays plumb (body pitch
 * cancelled). All four hooves are down in every key except the stepping pairs of walk / lead and the climbStep lifts.
 *   idle        loop 4.0 s  chewing cud (jaw + side sway), breathing, ear flick, looks left, tail flick.
 *   walk        loop 0.8 s  slow old diagonal walk, trunk yaw, head nod. ~0.6 m/s.
 *   climbStep   once 1.2 s  LEDGE STEP: looks at the ledge, sinks, the left fore lifts HIGH (22 cm), then the right fore,
 *                           weight back on the hinds (pitch -7, never upright), hinds push, settles. The game moves him up.
 *   lead        loop 3.0 s  GUIDE: 4 walk keys (0-800 ms, goatFx.lead.moveMs), stops, looks back over his left shoulder,
 *                           grumbles ("come on"), tail flick, faces forward again.
 *   grumbleTalk loop 1.6 s  dialogue: head up 8 deg, 12 keys of jaw 0/12/3/8/2/18/5/10/0/6/14/3 with grumbly head
 *                           wobbles and ears flattening on the big words; key 8 = jaw closed pause at 950 ms (as Burl).
 *   listen      loop 2.4 s  head turned + tilted to the player, chews once, a grudging nod with an ear flick.
 *   headshake   once 1.2 s  DISAPPROVAL: head dips, shakes four times (beard + horns swing), ears out, a snort.
 *   lieDown     once 1.0 s  kneels on the fore knees first (pitch nose-down), then the rump folds.
 *   lie         loop 3.0 s  lying on the sternum, left fore tucked, right fore out, hinds folded; chews cud, looks round.
 *   getUp       once 0.7 s  rump up first (as goats do), then the fore legs, back to the rest stance.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 16, SY = 32, SZ = 31, CELL = 0.037;
  function hsh(a, b, c) {                     // same deterministic hash as voxel_bear.js
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }

  // ---- voxel grid + rounded-slice helpers (same as voxel_bear.js) ----
  var G = [], x, y, z;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }
  function at(px, py, pz) { return G[pz][py][px]; }
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

  // ---- trunk (body part): one rounded slice per y [x0, x1, z0, z1, r] (half-open). Withers y12..14 (top z21) and rump
  // y25..26 (top z21) high, the old SAGGING back y17..21 two cells lower (top z19), deep chest, short round rump.
  var PROF = {
    10: [4, 12, 13, 20, 3], 11: [3, 13, 12, 21, 3], 12: [3, 13, 11, 22, 3], 13: [2, 14, 11, 22, 3], 14: [2, 14, 11, 22, 3],
    15: [2, 14, 11, 21, 3], 16: [2, 14, 11, 21, 3], 17: [2, 14, 11, 20, 3], 18: [2, 14, 11, 20, 3], 19: [2, 14, 11, 20, 3],
    20: [2, 14, 11, 20, 3], 21: [2, 14, 11, 20, 3], 22: [2, 14, 11, 21, 3], 23: [2, 14, 11, 21, 3], 24: [2, 14, 11, 21, 3],
    25: [3, 13, 11, 22, 3], 26: [3, 13, 12, 22, 3], 27: [3, 13, 12, 21, 3], 28: [4, 12, 13, 21, 3], 29: [5, 11, 14, 20, 2]
  };
  // coat: B pale buff-grey base, b cream tips / mane, K grey-brown partings, F buff-brown strands + dirty hem, S shadow
  function bodyMat(px, py, pz) {
    var p = PROF[py];
    var dTop = p[3] - 1 - pz, dBot = pz - p[2], dx = Math.abs(px - 7.5);
    var c = hsh(px >> 1, py >> 1, pz >> 1), n = hsh(px, py >> 1, (pz / 3) | 0);   // n: vertical hair strands
    if (dBot <= 0 && dx < 4) return 'S';                                   // belly shadow
    if (dTop <= 1 && py >= 10 && py <= 14) return c < 55 ? 'b' : (c < 75 ? 'F' : 'B');   // withers mane
    if (dTop <= 1) return dx <= 1 ? (c < 45 ? 'K' : 'B') : (c < 45 ? 'b' : 'B');      // back: faint dorsal parting
    if (dBot <= 2) return n < 30 ? 'K' : (n < 45 ? 'F' : 'B');             // lower flank
    if (n < 18) return 'F';
    if (n < 32) return 'K';
    if (n < 50) return 'b';
    return 'B';
  }
  for (y = 10; y <= 29; y++) rect('y', y, PROF[y][0], PROF[y][1], PROF[y][2], PROF[y][3], PROF[y][4], bodyMat);
  // the long shaggy SKIRT: the outer 3 columns of each flank hang straight down to a ragged hem at z10..12
  for (y = 12; y <= 27; y++) for (x = 2; x <= 4; x++) {
    var zl = -1;
    for (z = 10; z < SZ; z++) if (at(x, y, z) !== '.') { zl = z; break; }
    if (zl < 0) continue;
    var hem = 10 + (hsh(x, y, 3) % 3 === 0 ? 1 : 0) + (x === 4 ? 1 : 0);
    for (z = hem; z < zl; z++) {
      var s = z === hem ? 'F' : (hsh(x, y >> 1, z) < 45 ? 'K' : 'B');
      put(x, y, z, s);
      put(SX - 1 - x, y, z, z === hem ? 'F' : (hsh(SX - 1 - x, y >> 1, z) < 45 ? 'K' : 'B'));
    }
  }

  // ---- tail (tail part): short, upturned ----
  put(7, 30, 19, 'K'); put(8, 30, 19, 'K'); put(7, 30, 20, 'B'); put(8, 30, 20, 'b');
  put(7, 31, 21, 'K'); put(8, 31, 21, 'K'); put(7, 31, 22, 'b');

  // ---- head part: neck y7..9 (throat ruff + mane), skull y4..6, long straight face y0..3 ----
  var HEADP = {
    0: [6, 10, 14, 18, 1], 1: [6, 10, 14, 19, 1], 2: [6, 10, 14, 20, 1], 3: [6, 10, 14, 21, 1], 4: [5, 11, 14, 22, 2],
    5: [5, 11, 15, 23, 2], 6: [5, 11, 16, 24, 2], 7: [5, 11, 16, 23, 2], 8: [5, 11, 15, 23, 2], 9: [5, 11, 14, 22, 2]
  };
  function headMat(px, py, pz) {
    var c = hsh(px, py >> 1, pz >> 1), h = HEADP[py];
    if (py >= 7) {                                                       // neck
      if (pz <= h[2] + 1) return c < 60 ? 'b' : 'F';                      // throat ruff
      if (pz >= h[3] - 2) return c < 55 ? 'b' : 'B';                      // crest
      return c < 30 ? 'K' : (c < 45 ? 'b' : 'B');
    }
    if (py <= 1) return 'M';                                              // grey muzzle
    if (py <= 3 && pz >= h[3] - 1) return c < 50 ? 'K' : 'M';             // darker nose bridge
    if (pz >= h[3] - 1) return c < 50 ? 'K' : 'B';                        // crown between the horns
    if (px === 5 || px === 10) return c < 55 ? 'b' : 'B';                 // pale cheeks
    return c < 25 ? 'K' : 'B';
  }
  for (y = 0; y <= 9; y++) rect('y', y, HEADP[y][0], HEADP[y][1], HEADP[y][2], HEADP[y][3], HEADP[y][4], headMat);
  for (y = 7; y <= 9; y++) { put(7, y, HEADP[y][3], hsh(7, y, 1) < 50 ? 'b' : 'K'); put(8, y, HEADP[y][3], 'b'); }   // neck mane
  putSym(6, 0, 17, 'N');                                                  // nostrils
  for (x = 6; x <= 9; x++) put(x, 0, 14, 'D');                            // upper lip
  putSym(5, 5, 21, 'E');                                                  // amber eyes (sides of the skull)
  putSym(5, 4, 21, 'N');                                                  // horizontal pupil / tear line in front
  putSym(5, 5, 22, 'D');                                                  // brow
  putSym(4, 6, 21, 'B'); putSym(3, 6, 21, 'B');                           // ear roots (head part)

  // ---- horns (head part): big, backward-curving scimitar horns, ridged (dark groove every other cell), spreading
  // outward, tips over the withers. [x, y, z, mat] for the LEFT horn, mirrored.
  var HORN = [
    [5, 5, 24, 'o'], [6, 5, 24, 'o'], [5, 6, 24, 'o'], [6, 6, 24, 'o'],
    [5, 5, 25, 'O'], [6, 5, 25, 'O'], [5, 6, 25, 'O'], [6, 6, 25, 'O'],
    [5, 6, 26, 'o'], [6, 6, 26, 'o'], [5, 7, 26, 'o'], [6, 7, 26, 'o'],
    [5, 7, 27, 'O'], [6, 7, 27, 'O'], [5, 8, 27, 'O'],
    [5, 8, 28, 'o'], [5, 9, 28, 'o'], [4, 9, 28, 'o'],
    [4, 10, 28, 'O'], [4, 11, 28, 'O'], [5, 10, 28, 'O'],
    [4, 11, 27, 'o'], [4, 12, 27, 'o'],
    [4, 12, 26, 'O'], [3, 13, 26, 'O'],
    [3, 13, 25, 't']
  ];
  HORN.forEach(function (v) { putSym(v[0], v[1], v[2], v[3]); });

  // ---- ears part: sideways, a little drooped (old), pale inner face forward, dark tips ----
  putSym(2, 6, 21, 'B'); putSym(2, 5, 21, 'b'); putSym(1, 6, 21, 'B'); putSym(1, 5, 21, 'b'); putSym(0, 6, 20, 'D');

  // ---- jaw part: lower jaw (lip, teeth, mouth floor) + chin + the long BEARD ----
  for (y = 0; y <= 5; y++) for (x = 6; x <= 9; x++) {
    var jm = y === 0 ? 'D' : ((x === 7 || x === 8) ? (y === 1 ? 'W' : (y <= 3 ? 'R' : 'M')) : 'M');
    put(x, y, 13, jm);
  }
  var BEARD = { 12: [6, 9, 0, 4], 11: [6, 9, 1, 4], 10: [6, 9, 1, 3], 9: [6, 9, 1, 3], 8: [7, 8, 1, 3], 7: [7, 8, 2, 3], 6: [7, 8, 2, 2] };
  for (z = 6; z <= 12; z++) {
    var bd = BEARD[z];
    for (y = bd[2]; y <= bd[3]; y++) for (x = bd[0]; x <= bd[1]; x++) {
      var edge = (x === bd[0] || x === bd[1]) && (y === bd[2] || y === bd[3]);
      if (edge && z <= 10 && hsh(x, y, z) < 50) continue;                 // ragged strands
      var c2 = hsh(x, y, z >> 1);
      put(x, y, z, z <= 7 ? (c2 < 50 ? 'F' : 'b') : (c2 < 30 ? 'K' : (c2 < 55 ? 'B' : 'b')));
    }
  }

  // ---- legs: slender cannons, knee callus, dark pasterns, dewclaws, black hooves; hairy forearm / gaskin ----
  function hairMat(px, py, pz) { var c = hsh(px, py, pz); return c < 35 ? 'b' : (c < 60 ? 'K' : 'B'); }
  // front (left x3..4, mirrored x11..12)
  for (y = 12; y <= 13; y++) for (x = 3; x <= 4; x++) {
    putSym(x, y, 0, 'H'); putSym(x, y, 1, y === 12 ? 'H' : 'D'); putSym(x, y, 2, 'D');
    putSym(x, y, 3, 'K'); putSym(x, y, 4, 'K'); putSym(x, y, 5, y === 12 ? 'D' : 'K'); putSym(x, y, 6, 'K');
  }
  for (z = 7; z <= 9; z++) for (y = 12; y <= 14; y++) for (x = 3; x <= 5; x++) {
    if (z === 7 && (y === 14 || x === 5) && !(y === 13 && x === 5)) continue;   // taper into the knee
    putSym(x, y, z, hairMat(x, y, z));
  }
  putSym(4, 14, 2, 'H');                                                  // dewclaw
  // hind (left x3..4): hoof, cannon, hock pointing back, hairy gaskin
  for (y = 26; y <= 27; y++) for (x = 3; x <= 4; x++) {
    putSym(x, y, 0, 'H'); putSym(x, y, 1, y === 26 ? 'H' : 'D'); putSym(x, y, 2, 'D');
    for (z = 3; z <= 5; z++) putSym(x, y, z, 'K');
    putSym(x, y, 6, 'K');
  }
  putSym(3, 28, 6, 'D'); putSym(4, 28, 6, 'D');                           // point of the hock
  putSym(4, 28, 2, 'H');                                                  // dewclaw
  for (z = 7; z <= 9; z++) for (y = 25; y <= 28; y++) for (x = 3; x <= 5; x++) {
    if (z === 7 && (y === 25 || x === 5)) continue;
    putSym(x, y, z, hairMat(x, y, z));
  }

  // elbow / stifle fold (body part, z10): closes the 1-cell gap between the inner leg tops (z9) and the belly (z11)
  for (y = 12; y <= 14; y++) putSym(5, y, 10, 'K');
  for (y = 25; y <= 28; y++) putSym(5, y, 10, 'K');

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  var parts = {
    body:  { box: [2, 10, 10, 14, 32, 23], pivot: [8, 20, 15] },          // owns the short tail (engine max 8 parts)
    head:  { box: [3, 0, 14, 13, 14, 31], pivot: [8, 10, 18], parent: 'body' },
    jaw:   { box: [5, 0, 6, 11, 7, 14], pivot: [8, 6, 13.5], parent: 'head' },
    ears:  { box: [0, 4, 19, 16, 8, 24], pivot: [8, 6, 21], parent: 'head' },
    legFL: { box: [2, 11, 0, 7, 16, 10], pivot: [4, 13, 11], parent: 'body' },
    legFR: { box: [9, 11, 0, 14, 16, 10], pivot: [12, 13, 11], parent: 'body' },
    legBL: { box: [2, 24, 0, 7, 30, 10], pivot: [4, 26.5, 11], parent: 'body' },
    legBR: { box: [9, 24, 0, 14, 30, 10], pivot: [12, 26.5, 11], parent: 'body' }
  };
  var PNAMES = Object.keys(parts);
  function ownerOf(px, py, pz) {
    for (var i = 0; i < PNAMES.length; i++) {
      var b = parts[PNAMES[i]].box;
      if (px >= b[0] && px < b[3] && py >= b[1] && py < b[4] && pz >= b[2] && pz < b[5]) return PNAMES[i];
    }
    return null;
  }
  var LIMB_PART = { FL: 'legFL', FR: 'legFR', BL: 'legBL', BR: 'legBR' }, LIMB_YZ = {};
  Object.keys(LIMB_PART).forEach(function (k) {
    var pn = LIMB_PART[k], seen = {}, list = [];
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (layers[z][y].charAt(x) === '.' || ownerOf(x, y, z) !== pn || seen[y + ',' + z]) continue;
      seen[y + ',' + z] = 1; list.push([y, z]);
    }
    LIMB_YZ[k] = list;
  });

  // ---- pose: o = { b: [rx, ry, rz, px, py, pz] body, h head rot, j jaw deg, e ears rot, t tail rx, FL FR BL BR limb
  // rot (number = rx), lift { FL: cells } }. Limbs: plumb, pos x/y = -body (planted), pos z ground-solved (+ lift). ----
  var JAW_MAX = 20, D2R = Math.PI / 180, PB = parts.body.pivot;
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
  function pose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0], L = o.lift || {};
    function limb(k) {
      var r = v3(o[k]); r[0] -= (b[0] || 0);
      return { rot: [r2(r[0]), r2(r[1]), r2(r[2])], pos: [r2(-(b[3] || 0)), r2(-(b[4] || 0)), r2(groundPz(k, r[0], b) + (L[k] || 0))] };
    }
    var h = v3(o.h), e = v3(o.e);
    return {
      body: { rot: [r2(b[0] || 0), r2(b[1] || 0), r2(b[2] || 0)], pos: [r2(b[3] || 0), r2(b[4] || 0), r2(b[5] || 0)] },
      head: { rot: [r2(h[0]), r2(h[1]), r2(h[2])] },
      jaw: { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      ears: { rot: [r2(e[0]), r2(e[1]), r2(e[2])] },
      legFL: limb('FL'), legFR: limb('FR'), legBL: limb('BL'), legBR: limb('BR')
    };
  }
  // addO: base + o (arrays add element-wise, numbers add, lift merges)
  function addO(base, o) {
    var r = {}, k;
    for (k in base) r[k] = base[k];
    for (k in o) {
      var bv = r[k], ov = o[k];
      if (k === 'lift' || bv == null) r[k] = ov;
      else if (typeof bv === 'number' && typeof ov === 'number') r[k] = bv + ov;
      else { var a = v3(bv), c = v3(ov); r[k] = k === 'b' ? (bv.map ? bv.map(function (q, i) { return q + (ov[i] || 0); }) : ov) : [a[0] + c[0], a[1] + c[1], a[2] + c[2]]; }
    }
    return r;
  }
  function mix(base, o) { var r = {}, k; for (k in base) r[k] = base[k]; for (k in o) r[k] = o[k]; return r; }
  function clip(keys, loop, base) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(base ? addO(base, keys[i][1]) : keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  var WALK = [
    [200, { b: [0, 0, 1.5, 0, 0, 0], h: [3, 0, -3], FL: -14, FR: 10, BL: 10, BR: -12, lift: { FL: 1.5, BR: 1.5 } }],
    [200, { b: [0, 0, 0, 0, 0, 0.3], h: [1, 0, 0], FL: -3, FR: 3, BL: 2, BR: -2, t: 6 }],
    [200, { b: [0, 0, -1.5, 0, 0, 0], h: [3, 0, 3], FL: 10, FR: -14, BL: -12, BR: 10, lift: { FR: 1.5, BL: 1.5 } }],
    [200, { b: [0, 0, 0, 0, 0, 0.3], h: [1, 0, 0], FL: 3, FR: -3, BL: -2, BR: 2, t: 6 }]
  ];
  var TALK_UP = { h: [-8, 0, 0], e: [4, 0, 0] };
  // grumble-talk: jaw small (2-6) / mid (8-12) / wide (14-18); key 8 = closed pause at 950 ms (goatFx.talk)
  var TALK = [
    [100, {}],
    [150, { j: 12, h: [-2, 0, 3], b: [0, 0, 0, 0, 0, 0.15] }],
    [100, { j: 3, h: [0, 0, 4] }],
    [100, { j: 8, h: [2, 0, -3] }],
    [100, { j: 2, h: [3, 0, -4] }],
    [150, { j: 18, h: [-4, 0, 6], e: [-12, 0, 0] }],                      // a big grumbly word: ears flatten
    [150, { j: 5, h: [4, 0, -6], b: [0, 0, 0, 0, 0, -0.15] }],
    [100, { j: 10, h: [1, 0, 2] }],
    [250, { j: 0, h: [3, 0, 0] }],                                        // pause key
    [100, { j: 6, h: [0, 0, -2] }],
    [150, { j: 14, h: [-3, 0, 4], e: [-10, 0, 0] }],
    [150, { j: 3, h: [2, 0, 0] }]
  ];
  // lying: sternum down (drop 9 cells), front a little higher, head + neck held UP (keeps the beard off the ground)
  var LIE_O = { b: [-4, 0, 0, 0, 0, -9], h: [-24, 0, 0], FL: 80, FR: -75, BL: -80, BR: -80, t: -10 };

  var animations = {
    idle: clip([
      [500, {}],
      [200, { j: 5, h: [0, 0, 2] }],                                      // chewing cud (side sway)
      [200, { j: 1, h: [0, 0, -1] }],
      [200, { j: 6, h: [0, 0, 2] }],
      [200, { j: 1, h: [0, 0, -1] }],
      [400, { b: [0, 0, 0, 0, 0, 0.25], h: [2, 0, 0], e: [0, 14, 0] }],   // breath + ear flick
      [150, { h: [2, 0, 0], e: [0, -8, 0] }],
      [750, { h: [-6, 0, -16], b: [0, 0, -2, 0, 0, 0] }],                 // looks left
      [300, { h: [-6, 0, -16], b: [0, 0, -2, 0, 0, 0], t: 24 }],          // tail flick
      [1100, { h: [-2, 0, 8], j: 3, b: [0, 0, 0, 0, 0, 0.25] }]           // looks right, chewing
    ], true),
    walk: clip(WALK, true),
    climbStep: clip([
      [150, { b: [2, 0, 0, 0, 0, -0.4], h: [8, 0, 0] }],                                   // eyes the ledge, sinks
      [250, { b: [-6, 0, 0, 0, 0.6, 0.3], h: [-6, 0, 0], e: [6, 0, 0], FL: -55, lift: { FL: 6 } }],   // left fore HIGH
      [200, { b: [-6, 0, 0, 0, 0.6, 0.4], h: [-4, 0, 2], FL: -45, FR: -6, lift: { FL: 5 } }],
      [250, { b: [-7, 0, 0, 0, 0.8, 0.8], h: [-8, 0, 0], FL: -35, FR: -55, lift: { FL: 5, FR: 6 } }], // right fore up
      [200, { b: [-4, 0, 0, 0, 0.4, 1.0], h: [2, 0, 0], FL: -20, FR: -25, BL: 14, BR: 14, lift: { FL: 3, FR: 3 } }], // hinds push
      [150, {}]
    ], false),
    lead: clip(WALK.concat([
      [200, { b: [0, 0, 0, 0, 0, -0.3], h: [4, 0, 0] }],                                   // stops (settle)
      [300, { b: [0, 0, -4, 0, 0, 0], h: [-8, 0, -45], e: [4, 0, 0] }],                    // looks back
      [600, { b: [0, 0, -4, 0, 0, 0], h: [-10, 0, -50], j: 6, e: [-8, 0, 0] }],            // "come on" grumble
      [300, { b: [0, 0, -4, 0, 0, 0], h: [-10, 0, -50], t: 20 }],
      [300, { b: [0, 0, -2, 0, 0, 0], h: [-4, 0, -20] }],
      [500, {}]
    ]), true),
    grumbleTalk: clip(TALK, true, TALK_UP),
    listen: clip([
      [900, { h: [-6, 8, 6] }],
      [600, { h: [-6, 8, 6], b: [0, 0, 0, 0, 0, 0.25], j: 3 }],
      [200, { h: [-6, 8, 6] }],
      [300, { h: [2, 6, 6], e: [0, 10, 0] }],                                              // grudging nod
      [400, { h: [-6, 8, 6] }]
    ], true),
    headshake: clip([
      [150, { h: [6, 0, 0], e: [-6, 0, 0] }],
      [150, { h: [10, 0, -24], e: [-14, 12, 0], j: 3 }],
      [150, { h: [10, 0, 22], e: [-14, -12, 0] }],
      [150, { h: [10, 0, -20], e: [-14, 10, 0], j: 4 }],
      [150, { h: [9, 0, 16], e: [-12, -8, 0] }],
      [150, { h: [8, 0, -8], e: [-8, 0, 0], j: 6 }],                                       // snort
      [150, { h: [4, 0, 2], e: [-4, 0, 0] }],
      [150, {}]
    ], false),
    lieDown: clip([
      [150, { b: [0, 0, 0, 0, 0, -0.4], h: [6, 0, 0] }],
      [300, { b: [4, 0, 0, 0, -0.3, -3.5], h: [-4, 0, 0], FL: 60, FR: 30 }],               // fore knees first
      [300, { b: [2, 0, 0, 0, 0, -7], h: [-16, 0, 0], FL: 80, FR: -40, BL: -50, BR: -50 }], // rump folds
      [250, LIE_O]
    ], false),
    lie: clip([
      [900, LIE_O],
      [700, mix(LIE_O, { b: [-4, 0, 0, 0, 0, -8.75] })],                                   // breath
      [600, mix(LIE_O, { j: 5, h: [-22, 4, 3] })],                                         // chews cud
      [800, mix(LIE_O, { h: [-24, 0, -24] })]                                              // looks round
    ], true),
    getUp: clip([
      [250, { b: [5, 0, 0, 0, -0.3, -4], h: [-8, 0, 0], FL: 60, FR: 50, BL: -10, BR: -10 }], // rump up first
      [250, { b: [2, 0, 0, 0, 0, -1.2], h: [2, 0, 0], FL: 15, FR: 10 }],
      [200, {}]
    ], false)
  };

  var mats = {
    B: 'fur_wolf_light',    // base coat: pale buff-grey (greyed white-brown)
    b: 'fur_cream',         // cream tips, mane, throat ruff, beard
    K: 'fur_wolf',          // grey-brown partings, cannons, crown
    F: 'fur_agouti_light',  // buff-brown strands + the dirty skirt hem, beard tip
    S: 'linen_dark',        // belly shadow
    D: 'fur_wolf_dark',     // knee callus, pasterns, hock point, lips, brows, ear tips
    M: 'ash',               // grey muzzle, mouth floor edges
    H: 'iron_dark',         // hooves, dewclaws
    N: 'iron_dark',         // nostrils, pupils
    E: 'brass_dark',        // amber eyes
    O: 'antler',            // horn
    o: 'linen_dark',        // horn ridge grooves + base
    t: 'fur_wolf_dark',     // horn tips
    R: 'gore_red_dark',     // mouth
    W: 'linen_light'        // lower incisors
  };

  A.models.goat = {
    name: 'goat',
    displayName: 'old goat',
    desc: 'CRAG-D1 Crag, the old goat of Signal Head: a realistic old feral billy on all fours (0.81 m at the withers, ' +
          '1.1 m to the horn crests): shaggy greyed white-brown coat hanging as a ragged skirt, neck mane + throat ruff, ' +
          'long beard on the jaw, big backward-curving ridged horns, sideways ears, amber eyes, sagging back, slender ' +
          'legs with dark knees and black hooves, short upturned tail. Deer rig + jaw (9 parts). Clips idle, walk, ' +
          'climbStep, lead, grumbleTalk, listen, headshake, lieDown, lie, getUp.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [8, 20, 0],
      light: false,
      mats: mats,
      layers: layers,
      parts: parts,
      animations: animations,
      mounts: {
        speech:   { at: [8, 7, 30], part: 'head' },     // over the horns: speech bubble / name tag anchor
        eyes:     { at: [8, 5, 21.5], part: 'head' },   // dialogue camera look-at
        mouth:    { at: [8, 0.5, 13.5], part: 'head' }, // voice / breath puff origin
        nose:     { at: [8, 0, 17], part: 'head' },     // snort puff (headshake key 5)
        beard:    { at: [8, 2.5, 6], part: 'jaw' },     // beard tip
        interact: { at: [8, 14, 18], part: 'body' }     // [E] Talk prompt aim (front shoulder, 0.67 m)
      }
    }
  };

  // ASSETS.goatFx - presentation data for the NPC view + the dialogue box (no game logic here).
  A.goatFx = {
    version: 1,
    model: 'goat',
    character: 'Crag',
    story: 'CRAG-D1 (model); placement + behaviour = a later story',
    clipFor: {
      state: { idle: 'idle', move: 'walk', climb: 'climbStep', lead: 'lead', talk: 'grumbleTalk', listen: 'listen',
               disapprove: 'headshake', lieDown: 'lieDown', rest: 'lie', getUp: 'getUp' },
      once: { climbStep: 'idle', headshake: 'listen', lieDown: 'lie', getUp: 'idle' },
      note: 'once = non-loop clips and what follows them at animEnd. Every clip is on four legs (style-guide 0.2). ' +
            'Lines tagged grumpy / "no" play headshake once first, then listen. rest = lieDown once, then lie; leave ' +
            'it with getUp.'
    },
    talk: {
      jawPart: 'jaw', jawAxis: 'rx', jawOpenSign: 1, jawMaxDeg: JAW_MAX, jawPivot: [8, 6, 13.5],
      textCps: 24,                                   // a bit slower than Burl (28): an old grumbler
      pauseMs: { ',': 200, ';': 200, ':': 200, '-': 200, '.': 420, '!': 420, '?': 420 },
      pauseKey: 8, pauseAtMs: 950,                   // grumbleTalk key 8 = jaw closed; its start = 950 ms
      rule: 'same as ASSETS.bearFx.talk: play grumbleTalk while the line types on, hold at pauseAtMs on punctuation, ' +
            'switch to listen when the line is shown. The beard is on the jaw part, so it wags with the jaw.'
    },
    lead: { moveMs: [0, 800], speed: 0.6, note: 'move Crag only during keys 0-3 of `lead`; he stands and looks back ' +
            'for the rest (2.2 s). Loop it while the player lags behind.' },
    climb: { stepUpM: 0.22, note: 'climbStep is in place: the game raises Crag onto the ledge between 400 and 1050 ms ' +
             '(keys 2-4). Front lift 6 cells = 0.22 m clearance.' },
    speeds: { walk: 0.6, note: 'm/s the walk is authored for; scale the clip rate with the real speed' },
    sampleLine: { name: 'Crag', text: 'Hmph. Another one who thinks the ledges are a path. They are not. Follow my ' +
                  'hooves - and keep up.', note: 'placeholder for the preview; the writer owns the real lines' }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { goat: A.models.goat, goatFx: A.goatFx };
})(typeof window !== 'undefined' ? window : globalThis);
