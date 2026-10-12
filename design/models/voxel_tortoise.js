/* design/models/voxel_tortoise.js - SLATE, the ancient tortoise on the Glasswater islet (designer, SLATE-D1; owner
 *                                 approved 2026-10-12; pitch docs/quest-roadmap.md 2b: "Ancient tortoise on the
 *                                 Glasswater islet; remembers 'the builders' of the line"). Slate TALKS (giver / lore),
 *                                 jaw-sync contract as Burl / Skip / Crag (bearFx.talk, otterFx.talk, goatFx.talk).
 *                                 Binding rules: design/style-guide.md section 0 (realistic, all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4). Stand-alone:
 *   <script src="../design/models/voxel_tortoise.js">    (browser)
 *   import '../design/models/voxel_tortoise.js';         (Node)
 * Sets ASSETS.models.tortoise and ASSETS.tortoiseFx. `meshOnly: true`. NOT in game/index.html or the world (later story).
 * Only already-merged palette + detail-pass materials (no palette / detail-pass edit needed).
 *
 * A huge, very old Aldabra-like land tortoise: shell 1.2 m long, 0.84 m to the dome top, 0.84 m wide; cellM 0.06,
 * grid 18 x 30 x 15. High superellipsoid DOME (plastron 0.24 m off the ground) with worn scutes: 5 vertebrals, 4 costals
 * a side, 24 marginals, 1-cell dark seams, faint growth rings around big polished (worn) areolae; moss cushions on the
 * upper back and moss in the seams, a few pale lichen patches; a flared rear marginal skirt over the short tail; the
 * front margin arched over the neck (opening with loose neck-root skin). Wrinkled grey neck (diagonal creases, pale
 * underside, scaly top), small grey head with a heavy brow, dark eyes, a dark horn beak (upper + lower), pink tongue;
 * thick elephant-like column legs with big front scales, an elbow bulge and dark nails.
 * Axes as Burl / Crag: x = east (the tortoise's right), y = SOUTH with y0 = the beak (faces north at yaw 0), z = up.
 * Anchor [9, 17, 0] = between the four feet. Clip `pos` values are VOXELS.
 *
 * Parts (first-box-wins ownership, every parent earlier, each box sx+sy+sz <= 48; 8 parts = engine max):
 *   shell [2,8,4, 16,30,15]   pivot [9, 17.5, 6]   carapace + plastron, neck-root skin, rear skirt, tail. rx + = nose down.
 *   neck  [5,4,4, 13,8,10]    pivot [9, 8, 6.5]    rx - = up, rz = turn; pos y + = pulled INTO the shell (withdraw).
 *   head  [6,0,8, 12,4,12]    pivot [9, 4, 9]      skull, brow, eyes, upper beak, mouth roof. rx - = nose up.
 *   jaw   [6,0,6, 12,4,8]     pivot [9, 3.5, 8]    lower beak, tongue, wrinkled chin. rx + = open, 0 .. 18.
 *   legFL / legFR [0|13,8,0, 5|18,13,4] pivot [2.5|15.5, 10.5, 4]; legBL / legBR [0|12,21,0, 6|18,28,4]
 *                             pivot [3.5|14.5, 24.5, 4]. rx - = foot forward.
 *
 * Clips (ms, multiples of 50). Every limb is GROUND-SNAPPED per key (as voxel_goat.js) and stays plumb; all four feet are
 * down in every key except the stepping pairs of walk.
 *   idle     loop 4.8 s  slow breathing (neck pumps out / in, shell rises 0.2), a slow blink (key 3), looks left + right.
 *   walk     loop 2.0 s  very slow diagonal walk (~0.12 m/s), feet lift 1 cell, shell sway, neck swing.
 *   withdraw once 1.2 s  startle, a hiss (jaw 6), neck slides 6.5 cells into the shell, shell sinks 3 onto the legs; HOLDS
 *                        its last key (head in the front opening, legs gone under the rim) until the game plays emerge.
 *   emerge   once 1.8 s  waits, peeks (eyes in the opening), the head comes out looking round, back to rest.
 *   talk     loop 2.0 s  dialogue: neck up 6, 12 keys of jaw 0/10/3/14/4/18/6/12/0/8/16/3 with slow head bobs; key 8 =
 *                        jaw closed pause at 1250 ms (tortoiseFx.talk).
 *   listen   loop 3.0 s  head turned + tilted to the player, slow blink (key 1), breath, a small nod.
 *   slowNod  once 1.8 s  a deep, slow, old nod (neck + head down, held, back up).
 *   lookUp   once 3.6 s  REMEMBERING: neck + head rise high (shell tips 3 deg, never upright), gazes up, slow blink
 *                        (key 2), lips move without words, then back to rest.
 * Blink: rigid parts cannot close an eye; the blink keys dip the head 3-4 deg (a squint). tortoiseFx.blink holds the
 * eye voxels + timing for a per-voxel material swap (NEEDS PC-A engine feature, see tortoiseFx.blink.note).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 18, SY = 30, SZ = 15, CELL = 0.06, D2R = Math.PI / 180;
  function hsh(a, b, c) {                     // same deterministic hash as voxel_bear.js
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }

  var G = [], x, y, z;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }

  // ---- shell occupancy: superellipsoid dome on the plastron (z4), x 2..15, y 8..27, top z13 ----
  var OCC = new Uint8Array(SX * SY * SZ);
  function oi(px, py, pz) { return (pz * SY + py) * SX + px; }
  function occ(px, py, pz) { return px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ && OCC[oi(px, py, pz)] === 1; }
  for (z = 4; z <= 13; z++) for (y = 8; y <= 27; y++) for (x = 2; x <= 15; x++) {
    var nx0 = (x + 0.5 - 9) / 7, ny0 = (y + 0.5 - 18) / 10, nz0 = (z + 0.5 - 4) / 10;
    if (Math.pow(Math.abs(nx0), 2.4) + Math.pow(Math.abs(ny0), 2.8) + Math.pow(nz0, 2.2) <= 1) OCC[oi(x, y, z)] = 1;
  }
  for (z = 6; z <= 7; z++) for (x = 5; x <= 12; x++) if (z === 7 || (x >= 6 && x <= 11)) OCC[oi(x, 28, z)] = 1;   // rear skirt
  for (y = 8; y <= 9; y++) for (x = 6; x <= 11; x++) for (z = 4; z <= 7; z++) OCC[oi(x, y, z)] = 0;              // neck opening

  // scute id per surface voxel: marginal ring (low), vertebral row (top), costals (sides); d = 0 centre .. 1 edge
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function sid(px, py, pz) {
    var nx = (px + 0.5 - 9) / 7, ny = (py + 0.5 - 18) / 10, nz = (pz + 0.5 - 4) / 10;
    var e = Math.atan2(nz, Math.hypot(nx, ny)) / D2R, side = Math.atan2(Math.abs(nx), nz) / D2R;
    if (pz <= 5 || e < 20) return { id: 'M' + pad2(Math.floor((Math.atan2(ny, nx) / D2R + 180) / 15)), t: 'M', d: 1, e: e, ny: ny };
    if (side < 22) {
      var psi = Math.atan2(ny, nz) / D2R, fl = ((psi + 90) % 36) / 36;
      return { id: 'V' + Math.floor((psi + 90) / 36), t: 'V', d: Math.max(Math.abs(fl - 0.5) * 2, side / 22), e: e, ny: ny };
    }
    var psi2 = Math.atan2(ny, Math.hypot(nx, nz)) / D2R, f2 = ((psi2 + 90) % 45) / 45;
    var ft = Math.max(0, Math.min(1, (side - 22) / 46));
    return { id: 'C' + (nx < 0 ? 'L' : 'R') + Math.floor((psi2 + 90) / 45), t: 'C',
             d: Math.max(Math.abs(f2 - 0.5) * 2, Math.abs(ft - 0.5) * 2), e: e, ny: ny };
  }
  var NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function surf(px, py, pz) {
    for (var i = 0; i < 6; i++) if (!occ(px + NB[i][0], py + NB[i][1], pz + NB[i][2])) return true;
    return false;
  }
  // shell materials: A worn areola, C / c growth rings, g seam, Q / q marginal, P plastron, V moss cushion, v moss in a
  // seam, L lichen, S deep shadow (inside the neck opening)
  function shellMat(px, py, pz) {
    if (!surf(px, py, pz)) return 'c';
    if (pz === 4 && occ(px - 1, py, pz) && occ(px + 1, py, pz) && occ(px, py - 1, pz) && occ(px, py + 1, pz))
      return py % 5 === 0 ? 'q' : 'P';                                        // plastron (underside) + its seams
    var s = sid(px, py, pz), seam = false, h = hsh(px, py, pz), hp = hsh(px >> 1, py >> 1, pz >> 1);
    for (var i = 0; i < 6; i++) {
      var qx = px + NB[i][0], qy = py + NB[i][1], qz = pz + NB[i][2];
      if (!occ(qx, qy, qz) || !surf(qx, qy, qz)) continue;
      var o = sid(qx, qy, qz).id;
      if (o !== s.id && o < s.id) { seam = true; break; }
    }
    if (s.t === 'M') {
      if (seam) return 'g';
      if (hsh((px + 1) >> 1, (py + 1) >> 1, 5) < 6 && pz >= 5) return 'L';
      return pz <= 4 ? 'q' : (h < 30 ? 'q' : 'Q');
    }
    if (seam) return (s.e > 30 && h < 40) ? 'v' : 'g';
    if (s.e > 48 && hp < 20) return 'V';                                      // moss cushions on the top
    if (s.ny > 0.2 && s.e > 35 && h < 30) return 'V';                         // and on the shaded rear slope
    if (s.e > 20 && s.e < 65 && hsh((px + 1) >> 1, (py + 1) >> 1, 11) < 9) return 'L';   // lichen patches
    if (s.d < 0.35) return h < 15 ? 'C' : 'A';                                // big worn, polished areola
    return Math.floor(s.d * 5) % 2 ? 'C' : 'c';                               // faint growth rings
  }
  var SHELLV = [];
  for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) if (OCC[oi(x, y, z)]) SHELLV.push([x, y, z, shellMat(x, y, z)]);
  SHELLV.forEach(function (v) { put(v[0], v[1], v[2], v[3]); });
  for (z = 4; z <= 7; z++) {                                                  // opening shadow (back wall + side walls)
    for (x = 6; x <= 11; x++) if (occ(x, 10, z)) put(x, 10, z, 'S');
    for (y = 8; y <= 9; y++) if (occ(5, y, z)) putSym(5, y, z, 'S');
  }
  // loose neck-root skin filling the opening (shell part, stays when the neck slides in)
  for (y = 8; y <= 9; y++) for (x = 7; x <= 10; x++) for (z = 4; z <= 7; z++) {
    if ((x === 7 || x === 10) && (z === 4 || z === 7)) continue;
    put(x, y, z, (y + z) % 2 ? 'k' : 'K');
  }
  put(8, 28, 4, 'k'); put(9, 28, 4, 'k'); put(8, 29, 4, 'k'); put(9, 29, 4, 'K');   // short tail under the skirt

  // ---- neck part: thick wrinkled column y4..7 rising toward the head; base folds at y7 ----
  var NECK = { 4: [6, 9], 5: [5, 8], 6: [5, 8], 7: [4, 8] };
  for (y = 4; y <= 7; y++) for (x = 7; x <= 10; x++) for (z = NECK[y][0]; z <= NECK[y][1]; z++) {
    var z0 = NECK[y][0], z1 = NECK[y][1];
    if ((x === 7 || x === 10) && (z === z0 || z === z1)) continue;            // rounded section
    var nm = z === z1 ? ((x + y) % 2 ? 'X' : 'x') : (z === z0 ? 'G' : ((y + z) % 2 === 0 ? 'k' : 'K'));
    put(x, y, z, nm);
  }
  for (z = 5; z <= 7; z++) putSym(6, 7, z, z === 6 ? 'K' : 'k');              // loose skin folds at the neck base
  putSym(6, 6, 6, 'k');

  // ---- head part: skull y0..3, heavy brow, dark eyes, upper beak + mouth roof ----
  putSym(8, 2, 11, 'X'); putSym(8, 3, 11, 'X');                               // crown scales
  putSym(7, 1, 10, 'K'); putSym(8, 1, 10, 'K'); putSym(7, 2, 10, 'G'); putSym(8, 2, 10, 'X'); putSym(7, 3, 10, 'k'); putSym(8, 3, 10, 'X');
  putSym(8, 0, 9, 'K'); putSym(7, 1, 9, 'K'); putSym(8, 1, 9, 'K'); putSym(7, 2, 9, 'E'); putSym(8, 2, 9, 'K'); putSym(7, 3, 9, 'k'); putSym(8, 3, 9, 'K');
  putSym(8, 0, 8, 'B'); putSym(7, 1, 8, 'B'); putSym(8, 1, 8, 'R'); putSym(7, 2, 8, 'K'); putSym(8, 2, 8, 'R'); putSym(7, 3, 8, 'K'); putSym(8, 3, 8, 'K');
  // ---- jaw part: lower beak, tongue, wrinkled pale chin ----
  putSym(8, 0, 7, 'B'); putSym(7, 1, 7, 'B'); putSym(8, 1, 7, 'T'); putSym(7, 2, 7, 'k'); putSym(8, 2, 7, 'T'); putSym(7, 3, 7, 'k'); putSym(8, 3, 7, 'k');
  putSym(8, 1, 6, 'G'); putSym(7, 2, 6, 'k'); putSym(8, 2, 6, 'G'); putSym(7, 3, 6, 'k'); putSym(8, 3, 6, 'G');

  // ---- legs: thick elephant columns, big front scales, elbow bulge, dark nails ----
  for (y = 9; y <= 11; y++) for (x = 1; x <= 3; x++) for (z = 0; z <= 3; z++) {
    var lm = z === 0 ? 'k' : (y === 9 ? ((x + z) % 2 ? 'X' : 'x') : (x === 1 ? (z % 2 ? 'K' : 'k') : 'K'));
    putSym(x, y, z, lm);
  }
  putSym(0, 10, 2, 'k'); putSym(0, 10, 3, 'K'); putSym(0, 11, 3, 'k');       // elbow bulge
  putSym(1, 8, 0, 'n'); putSym(3, 8, 0, 'n');                                 // fore nails
  for (y = 23; y <= 25; y++) for (x = 2; x <= 4; x++) for (z = 1; z <= 3; z++) putSym(x, y, z, (y + z) % 2 ? 'K' : 'k');
  for (y = 22; y <= 25; y++) for (x = 1; x <= 4; x++) putSym(x, y, 0, (y === 22 && (x === 2 || x === 4)) ? 'n' : 'k');   // round hind foot

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  var parts = {
    shell: { box: [2, 8, 4, 16, 30, 15], pivot: [9, 17.5, 6] },
    neck:  { box: [5, 4, 4, 13, 8, 10], pivot: [9, 8, 6.5], parent: 'shell' },
    head:  { box: [6, 0, 8, 12, 4, 12], pivot: [9, 4, 9], parent: 'neck' },
    jaw:   { box: [6, 0, 6, 12, 4, 8], pivot: [9, 3.5, 8], parent: 'head' },
    legFL: { box: [0, 8, 0, 5, 13, 4], pivot: [2.5, 10.5, 4], parent: 'shell' },
    legFR: { box: [13, 8, 0, 18, 13, 4], pivot: [15.5, 10.5, 4], parent: 'shell' },
    legBL: { box: [0, 21, 0, 6, 28, 4], pivot: [3.5, 24.5, 4], parent: 'shell' },
    legBR: { box: [12, 21, 0, 18, 28, 4], pivot: [14.5, 24.5, 4], parent: 'shell' }
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

  // ---- pose: o = { b: [rx, ry, rz, px, py, pz] shell, n neck rot, np neck pos, h head rot, j jaw deg, FL FR BL BR limb
  // rot (number = rx), lift { FL: cells } }. Limbs: plumb, pos x/y = -shell (planted), pos z ground-solved (+ lift). ----
  var JAW_MAX = 18, PB = parts.shell.pivot;
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
    var n = v3(o.n), np = v3(o.np), h = v3(o.h);
    return {
      shell: { rot: [r2(b[0] || 0), r2(b[1] || 0), r2(b[2] || 0)], pos: [r2(b[3] || 0), r2(b[4] || 0), r2(b[5] || 0)] },
      neck: { rot: [r2(n[0]), r2(n[1]), r2(n[2])], pos: [r2(np[0]), r2(np[1]), r2(np[2])] },
      head: { rot: [r2(h[0]), r2(h[1]), r2(h[2])] },
      jaw: { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      legFL: limb('FL'), legFR: limb('FR'), legBL: limb('BL'), legBR: limb('BR')
    };
  }
  function addO(base, o) {     // base + o (arrays add element-wise, numbers add, lift replaces)
    var r = {}, k;
    for (k in base) r[k] = base[k];
    for (k in o) {
      var bv = r[k], ov = o[k];
      if (k === 'lift' || bv == null) r[k] = ov;
      else if (typeof bv === 'number' && typeof ov === 'number') r[k] = bv + ov;
      else if (k === 'b') r[k] = bv.map(function (q, i) { return q + (ov[i] || 0); });
      else { var a = v3(bv), c = v3(ov); r[k] = [a[0] + c[0], a[1] + c[1], a[2] + c[2]]; }
    }
    return r;
  }
  function clip(keys, loop, base) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(base ? addO(base, keys[i][1]) : keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  // withdrawn: neck 6.5 cells into the shell, head tipped down in the front opening, shell sunk 3 onto the legs
  // np z -0.5 (not lower): the neck's base cell (y7 z4) must stay above z -0.6 with the shell sunk 3
  var WITHDRAWN = { b: [1, 0, 0, 0, 0, -3], n: [8, 0, 0], np: [0, 6.5, -0.5], h: [10, 0, 0] };
  var TALK_UP = { n: [-6, 0, 0], h: [-2, 0, 0] };
  // talk: jaw small (3-6) / mid (8-12) / wide (14-18); key 8 = closed pause at 1250 ms (tortoiseFx.talk)
  var TALK = [
    [150, {}],
    [150, { j: 10, h: [-2, 0, 2] }],
    [150, { j: 3, h: [0, 0, 3] }],
    [150, { j: 14, h: [-3, 0, 1], b: [0, 0, 0, 0, 0, 0.1] }],
    [150, { j: 4, h: [1, 0, -2] }],
    [200, { j: 18, h: [-4, 0, -3], n: [-2, 0, 0] }],                       // a long, important word
    [150, { j: 6, h: [2, 0, -1] }],
    [150, { j: 12, h: [-1, 0, 2], b: [0, 0, 0, 0, 0, -0.1] }],
    [300, { j: 0, h: [3, 0, 0] }],                                          // pause key
    [150, { j: 8, h: [0, 0, 2] }],
    [200, { j: 16, h: [-3, 0, 3], n: [-2, 0, 2] }],
    [100, { j: 3, h: [1, 0, 0] }]
  ];
  var LISTEN = { n: [-3, 0, 10], h: [-2, 4, 8] };

  var animations = {
    idle: clip([
      [600, {}],
      [700, { b: [0, 0, 0, 0, 0, 0.2], np: [0, -0.4, 0.1], h: [-2, 0, 0] }],   // breathes in: neck pumps out
      [500, {}],                                                               // breathes out
      [150, { h: [3, 0, 0] }],                                                 // slow blink (squint dip)
      [600, {}],
      [800, { n: [0, 0, -14], h: [-3, 0, -6] }],                               // looks left
      [700, { n: [-2, 0, 10], h: [-2, 0, 5] }],                                // looks right
      [750, { b: [0, 0, 0, 0, 0, 0.15], np: [0, -0.2, 0] }]
    ], true),
    walk: clip([
      [500, { b: [0, 0, 1.2, 0, 0, 0.1], n: [2, 0, -4], h: [0, 0, -2], FL: -10, FR: 8, BL: 8, BR: -10, lift: { FL: 1, BR: 1 } }],
      [500, { b: [0, 0, 0, 0, 0, 0.25], np: [0, -0.3, 0], h: [-1, 0, 0], FL: -2, FR: 2, BL: 2, BR: -2 }],
      [500, { b: [0, 0, -1.2, 0, 0, 0.1], n: [2, 0, 4], h: [0, 0, 2], FL: 8, FR: -10, BL: -10, BR: 8, lift: { FR: 1, BL: 1 } }],
      [500, { b: [0, 0, 0, 0, 0, 0.25], np: [0, -0.3, 0], h: [-1, 0, 0], FL: 2, FR: -2, BL: -2, BR: 2 }]
    ], true),
    withdraw: clip([
      [150, { n: [-6, 0, 0], h: [-4, 0, 0] }],                                 // startle: neck up
      [250, { b: [0, 0, 0, 0, 0, -1], n: [4, 0, 0], np: [0, 3, -0.5], h: [6, 0, 0], j: 6 }],   // hiss
      [300, { b: [1, 0, 0, 0, 0, -2], n: [6, 0, 0], np: [0, 5, -1], h: [8, 0, 0], j: 2 }],
      [500, WITHDRAWN]
    ], false),
    emerge: clip([
      [500, WITHDRAWN],
      [400, { b: [1, 0, 0, 0, 0, -3], n: [4, 0, 0], np: [0, 4.5, -1.2], h: [4, 0, 0] }],   // peeks: eyes in the opening
      [400, { b: [0, 0, 0, 0, 0, -1.5], n: [0, 0, -6], np: [0, 2, -0.5], h: [-2, 0, -4] }],   // head out, looks round
      [300, { b: [0, 0, 0, 0, 0, -0.4], n: [-2, 0, 4], np: [0, 0.5, 0] }],
      [200, {}]
    ], false),
    talk: clip(TALK, true, TALK_UP),
    listen: clip([
      [1000, LISTEN],
      [150, addO(LISTEN, { h: [3, 0, 0] })],                                  // slow blink
      [850, addO(LISTEN, { b: [0, 0, 0, 0, 0, 0.2] })],
      [500, addO(LISTEN, { n: [5, 0, 0], h: [8, 0, 0] })],                    // small nod
      [500, LISTEN]
    ], true),
    slowNod: clip([
      [300, { n: [-2, 0, 0] }],
      [500, { n: [8, 0, 0], h: [14, 0, 0] }],
      [300, { n: [6, 0, 0], h: [10, 0, 0] }],
      [400, { n: [-2, 0, 0], h: [-2, 0, 0] }],
      [300, {}]
    ], false),
    lookUp: clip([
      [700, { b: [-2, 0, 0, 0, 0, 0.2], n: [-16, 0, 0], h: [-10, 0, 0] }],
      [1000, { b: [-3, 0, 0, 0, 0, 0.3], n: [-24, 0, 4], h: [-18, 0, 4] }],  // gazes up, far away
      [150, { b: [-3, 0, 0, 0, 0, 0.3], n: [-24, 0, 4], h: [-14, 0, 4] }],   // slow blink
      [950, { b: [-3, 0, 0, 0, 0, 0.3], n: [-22, 0, -4], h: [-18, 0, -3], j: 2 }],   // lips move: remembering
      [500, { b: [-1, 0, 0, 0, 0, 0.1], n: [-6, 0, 0], h: [-2, 0, 0] }],
      [300, {}]
    ], false)
  };

  var mats = {
    A: 'waystone',          // worn, polished scute areola (mid slate grey)
    C: 'waystone_dark',     // growth ring (dark)
    c: 'granite_dark',      // growth ring (dark neutral) + shell interior
    g: 'iron_dark',         // scute seams
    Q: 'timber_old',        // marginal scutes (weathered grey-brown keratin)
    q: 'fur_wolf_dark',     // marginal lower edge, plastron seams
    P: 'timber_old',        // plastron (underside)
    V: 'moss_cap',          // moss cushions on the dome
    v: 'moss_top',          // moss in the seams
    L: 'waystone_light',    // pale lichen patches
    S: 'iron_dark',         // deep shadow inside the neck opening
    K: 'ash',               // grey wrinkled skin
    k: 'granite_dark',      // skin creases, soles, chin wrinkles
    G: 'granite_light',     // pale neck underside, brow, throat
    X: 'waystone',          // big leg / crown / neck-top scales
    x: 'waystone_dark',     // scale gaps
    E: 'iron_dark',         // eyes
    B: 'linen_dark',        // horn beak
    R: 'gore_red_dark',     // mouth roof
    T: 'skin_flush',        // tongue
    n: 'linen_dark'         // nails
  };

  A.models.tortoise = {
    name: 'tortoise',
    displayName: 'ancient tortoise',
    desc: 'SLATE-D1 Slate, the ancient tortoise of the Glasswater islet: a realistic Aldabra-like giant on all fours (shell ' +
          '1.2 m long, 0.84 m high): high domed shell with worn scutes, seams, moss cushions and lichen, flared rear skirt; ' +
          'wrinkled grey neck, small head with heavy brow, dark horn beak on head + jaw; thick elephant legs with nails. ' +
          '8 parts (shell, neck, head, jaw, 4 legs). Clips idle, walk, withdraw, emerge, talk, listen, slowNod, lookUp.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [9, 17, 0],
      light: false,
      mats: mats,
      layers: layers,
      parts: parts,
      animations: animations,
      mounts: {
        speech:   { at: [9, 17, 15], part: 'shell' },   // over the dome: speech bubble / name tag anchor
        eyes:     { at: [9, 2.5, 9.5], part: 'head' },  // dialogue camera look-at
        mouth:    { at: [9, 0.5, 8], part: 'head' },    // voice / breath puff origin (hiss in withdraw key 1)
        interact: { at: [9, 9, 8], part: 'shell' }      // [E] Talk prompt aim (front of the dome, 0.48 m)
      }
    }
  };

  // ASSETS.tortoiseFx - presentation data for the NPC view + the dialogue box (no game logic here).
  A.tortoiseFx = {
    version: 1,
    model: 'tortoise',
    character: 'Slate',
    story: 'SLATE-D1 (model); placement + behaviour = a later story',
    clipFor: {
      state: { idle: 'idle', move: 'walk', hide: 'withdraw', emerge: 'emerge', talk: 'talk', listen: 'listen',
               agree: 'slowNod', remember: 'lookUp' },
      once: { emerge: 'idle', slowNod: 'listen', lookUp: 'talk' },
      note: 'once = non-loop clips and what follows them at animEnd. withdraw HOLDS its last key (hidden) until the ' +
            'game plays emerge (e.g. the player stepped back). Lore lines about "the builders" start with lookUp once, ' +
            'then talk. Every clip is on four legs (style-guide 0.2).'
    },
    talk: {
      jawPart: 'jaw', jawAxis: 'rx', jawOpenSign: 1, jawMaxDeg: JAW_MAX, jawPivot: [9, 3.5, 8],
      textCps: 18,                                   // slowest talker (Burl 28, Crag 24): very old, unhurried
      pauseMs: { ',': 260, ';': 260, ':': 260, '-': 260, '.': 560, '!': 560, '?': 560 },
      pauseKey: 8, pauseAtMs: 1250,                  // talk key 8 = jaw closed; its start = 1250 ms
      rule: 'same as ASSETS.bearFx.talk: play talk while the line types on, hold at pauseAtMs on punctuation, switch ' +
            'to listen when the line is shown.'
    },
    blink: {
      part: 'head', voxels: [[7, 2, 9], [10, 2, 9]], openMat: 'iron_dark', closedMat: 'ash', ms: 150,
      keys: { idle: [3], listen: [1], lookUp: [2] },
      note: 'NEEDS PC-A (engine): per-voxel material swap for a key (eye voxels -> closedMat while the key plays). ' +
            'Until then the blink keys are a 3-4 deg head dip (squint) and this block is ignored.'
    },
    withdraw: { holdLastKey: true, hissKey: 1, note: 'shell sinks 3 cells (0.18 m); neck + head go into the front ' +
                'opening; treat as "not talkable" until emerge ends' },
    speeds: { walk: 0.12, note: 'm/s the walk is authored for; scale the clip rate with the real speed' },
    sampleLine: { name: 'Slate', text: 'Mm. Another small one, walking the line. I remember the builders, you know - ' +
                  'they walked it too. Slowly. Like me.', note: 'placeholder for the preview; the writer owns the real lines' }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { tortoise: A.models.tortoise, tortoiseFx: A.tortoiseFx };
})(typeof window !== 'undefined' ? window : globalThis);
