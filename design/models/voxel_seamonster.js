/* design/models/voxel_seamonster.js - the SEA MONSTER past the Long Strand (PC-B designer 2026-10-13, owner-authorised;
 *                                     owner D-070, architecture.md 38.54 "Sea monster edge (SWIM-06b)").
 *                                     Binding rules: design/style-guide.md section 0 (realistic shapes from voxels,
 *                                     nothing boxy, natural colour variation).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as voxel_wolf.js:
 *   <script src="../design/models/voxel_seamonster.js">     (browser, after palette.js + detail-pass.js)
 *   import '../../../design/models/voxel_seamonster.js';    (Node tests: side-effect import)
 * Sets ASSETS.models.seaMonster (entity id `seaMonster`; format: design/README.md section 4/7, architecture.md 15.1)
 * and ASSETS.seaMonsterFx (state -> clip map, waterline, reach, placement). `meshOnly: true`. Only ALREADY-MERGED
 * palette materials (no palette.js / detail-pass.js edit).
 *
 * Axes (15.1): x = east (= the monster's RIGHT at yaw 0), y = SOUTH with y0 = the snout tip (faces north at yaw 0),
 * z = up. cellM 0.1 (10 cm voxels: it is big and is read from 10-30 m). Grid 12 x 73 x 18. Clip `pos` values are VOXELS.
 *
 * WATERLINE ANCHOR: anchor [6, 42, 9] = mid trunk, z 9 = THE WATERLINE. Put the entity at z = surfaceZ in EVERY state.
 *   The clips do the vertical work that 38.54 wrote as entity offsets: in `circle` the trunk floats 0.05-0.15 m lower
 *   (body pos z -0.5 +- 1.0 voxels) so only the back hump (0.25-0.45 m), the dorsal fin (up to 0.9 m) and, now and
 *   then, the tail fin break the surface; in `rise` the neck lifts the head ~1.4 m over the water. If the game keeps
 *   the 38.54 numbers (surfaceZ - 1.0 / + 1.5) the hump vanishes in circle and the whole trunk floats in the air in
 *   rise, so: entity z = surfaceZ, always (seaMonsterFx.waterline).
 *
 * ANATOMY (a realistic giant sea serpent / eel from squares; 7.3 m snout to tail fin, every slice an ellipse):
 *   - HEAD 1.1 m long, 0.75 m wide at the jaw hinges: long tapering snout, heavy BROW RIDGE over small EMBER eyes
 *     (ember_glow = eyeshine readable in dark water, like the wolf / boar), nostrils on top of the snout, a 3-spike
 *     CREST on the skull, back-swept GILL SPINES on both cheeks, a row of upper FANGS hanging over the lip line, a dark
 *     slit between the jaws when closed. Inside (seen when the jaw opens): gore_red_dark roof and gums, gore_red
 *     tongue, lower teeth on the jaw rim.
 *   - JAW: separate part, hinge at the back of the skull, opens to 45 deg (strike gape).
 *   - NECK 2.0 m in two parts (neck1, neck2), 0.6-0.7 m thick, a row of dorsal spines, pale ridged throat plates.
 *   - TRUNK 2.2 m, 0.9 m thick, an arched BACK HUMP (top 0.35 m over the waterline at rest) crusted with weed clumps
 *     (moss_cap) and barnacles (waystone_light); a tall spiny DORSAL FIN (rays iron_dark with pale tips, membrane
 *     granite_dark, ragged top, tips swept back) up to 0.9 m over the water = THE warning silhouette.
 *   - TAIL 2.0 m in two parts, tapering to an eel paddle with a fin fold top and bottom.
 *   Colour (one cold hide family): near-black back fur_wolf_dark > slate flanks waystone_dark with lighter mottles and
 *   a pale LATERAL LINE (waystone) > granite_dark transition > pale ventral plates granite_light / ash seams.
 *
 * Parts (7 <= MAX_VOX_PARTS; insertion order = part index; parents EARLIER; every box sx+sy+sz <= 48, style 5.14):
 *   body   box [1,31,2, 11,53,18]  pivot [6, 42, 8]    Root. rx + = nose down, ry = roll, rz + = turn right.
 *   neck1  box [2,21,2, 10,31,14]  pivot [6, 30.5, 7.2] parent body.  rx - = LIFT (raise the front), rz = sideways bend.
 *   neck2  box [2,11,2, 10,21,14]  pivot [6, 20.5, 7.3] parent neck1. same.
 *   head   box [0,0,5, 12,11,16]   pivot [6, 10.5, 7.5] parent neck2. rx + = nose down, rz = look sideways.
 *   jaw    box [1,0,1, 11,10,5]    pivot [6, 9.5, 4.5]  parent head.  rx + = OPEN, 0..45 (JAW_MAX).
 *   tail1  box [2,53,2, 10,63,13]  pivot [6, 52.5, 7.1] parent body.  rx + = tail tip UP, rz = sideways sweep.
 *   tail2  box [3,63,1, 9,73,13]   pivot [6, 62.5, 6.5] parent tail1. same.
 *
 * Clips (ms, multiples of 50):
 *   circle  loop 3.2 s  8 keys. The warning: a slow lateral S-wave travels from neck to tail (eel swimming), the head
 *                       is dipped UNDER water (neck1 rx +16), the trunk bobs so the fin rises 0.9 m and sinks back to
 *                       0.5 m, the hump rolls, and once per loop the tail fin flicks out of the water behind it.
 *   rise    once 1.2 s  5 keys: under (circle pose) -> anticipation (sinks, gathers, tail beat) -> SURGE (head breaks
 *                       the surface) -> overshoot high (jaw 16) -> settles, head cocked down at the player, hissing
 *                       gape (jaw 22), held. Head ~1.4 m over the water, ~3.5 m in front of the anchor.
 *   strike  once 0.4 s  5 keys: rise-end pose -> recoil (S-curve back, jaw 30) -> LUNGE (2.5 m forward, gape 45) ->
 *                       SNAP shut at 250 ms (key 3 = vitals.kill('eaten')) -> drags down (held).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var D2R = Math.PI / 180;

  var SX = 12, SY = 73, SZ = 18, CX = 6, W = 9, SEED = 71, CELL = 0.1;
  var ANCHOR = [6, 42, W];
  var EYE_MAT = 'ember_glow';            // 'iron_dark' = plain dark eyes
  var JAW_MAX = 45;                      // strike gape

  function hash(x, y, z, s) {
    var h = Math.imul(x + 1, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(z + 13, 83492791) ^ Math.imul(s + 1, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function rr(a) { return [r2(a[0]), r2(a[1]), r2(a[2])]; }
  function v3(a) {
    if (a === undefined || a === null) return [0, 0, 0];
    if (typeof a === 'number') return [a, 0, 0];
    return [a[0] || 0, a[1] || 0, a[2] || 0];
  }

  // ---- voxel grid ----
  var G = [], x, y, z, i;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function inb(px, py, pz) { return px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ; }
  function get(px, py, pz) { return inb(px, py, pz) ? G[pz][py][px] : '.'; }
  function put(px, py, pz, ch) { if (inb(px, py, pz)) G[pz][py][px] = ch; }
  function sym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }
  function paint(px, py, pz, ch) {
    if (get(px, py, pz) !== '.') put(px, py, pz, ch);
    if (get(SX - 1 - px, py, pz) !== '.') put(SX - 1 - px, py, pz, ch);
  }
  // y-slice ellipse centred on x = CX: cells whose centres lie inside ((x+.5-CX)/rx)^2 + ((z+.5-cz)/rz)^2 <= 1
  function ellY(py, cz, rx, rz, ch, zMin, zMax) {
    for (var pz = Math.max(zMin, 0); pz <= Math.min(zMax, SZ - 1); pz++) for (var px = 0; px < SX; px++) {
      var dx = (px + 0.5 - CX) / rx, dz = (pz + 0.5 - cz) / rz;
      if (dx * dx + dz * dz <= 1) put(px, py, pz, typeof ch === 'function' ? ch(px, py, pz) : ch);
    }
  }
  function outerX(py, pz) { for (var px = 0; px < CX; px++) if (get(px, py, pz) !== '.') return px; return -1; }
  function topZ(px, py) { for (var pz = SZ - 1; pz >= 0; pz--) if (get(px, py, pz) !== '.') return pz; return -1; }
  function botZ(px, py) { for (var pz = 0; pz < SZ; pz++) if (get(px, py, pz) !== '.') return pz; return -1; }

  // ---- hide: H near-black back, h slate flank, X lighter mottles + lateral line, S dark transition, P/p pale ventral
  // plates (p = the seam every 3rd slice), M weed / B barnacle clumps on the crusted hump. Patches are 2 x 2 x 2
  // clumps or 3-tall strands (no single-voxel speckle, style 5.14); the hash uses the mirrored x so both flanks match.
  function hide(cz, rx, rz, crust) {
    return function (px, py, pz) {
      var rel = (pz + 0.5 - cz) / rz, lat = Math.abs(px + 0.5 - CX) / rx, mx = Math.min(px, SX - 1 - px);
      var c = hash(mx >> 1, py >> 1, pz >> 1, SEED), n = hash(mx, py >> 1, (pz / 3) | 0, SEED + 5);
      if (rel < -0.62) return (py % 3 === 0) ? 'p' : 'P';
      if (rel < -0.35) return c < 0.35 ? 'P' : 'S';
      if (rel > -0.12 && rel < 0.1 && lat > 0.72) return 'X';
      if (rel > 0.55) {
        if (crust && c < 0.14) return 'M';
        if (crust && c > 0.9) return 'B';
        return c < 0.3 ? 'h' : 'H';
      }
      return c < 0.2 ? 'X' : (n < 0.3 ? 'H' : 'h');
    };
  }

  // ---- TRUNK (body): y 31..52, the arched back hump (top z12 = 0.35 m over the waterline at rest) ----
  function bodyProf(py) {
    var t = (py - 31) / 21, s = Math.pow(Math.sin(Math.PI * t), 0.6);
    return [7.2 + 1.6 * s, 3.5 + 1.1 * s, 3.5 + 0.9 * s];            // [cz, rx, rz]
  }
  for (y = 31; y <= 52; y++) { var bp = bodyProf(y); ellY(y, bp[0], bp[1], bp[2], hide(bp[0], bp[1], bp[2], y >= 34 && y <= 49), 2, 17); }

  // ---- NECK (neck2 y 11..20, neck1 y 21..30): 0.6-0.7 m thick, rising a little toward the skull ----
  for (y = 11; y <= 30; y++) {
    var tn = (y - 11) / 19, ncz = 7.4 - 0.25 * tn, nrx = 3.0 + 0.45 * tn, nrz = 2.9 + 0.5 * tn;
    ellY(y, ncz, nrx, nrz, hide(ncz, nrx, nrz, false), 2, 13);
  }
  for (y = 12; y <= 30; y += 3) {                                    // dorsal spines along the neck
    var zt = topZ(5, y);
    sym(5, y, zt + 1, 'F');
    if ((y - 12) % 6 === 0) sym(5, y, zt + 2, 'X');
  }

  // ---- TAIL (tail1 y 53..62, tail2 y 63..72): tapering to an eel paddle ----
  for (y = 53; y <= 72; y++) {
    var tt = (y - 53) / 19, tcz = 7.1 - 1.1 * tt, trx = 3.3 - 2.5 * tt, trz = 3.3 - 2.3 * tt;
    ellY(y, tcz, trx, trz, hide(tcz, trx, trz, false), 1, 12);
  }

  // ---- DORSAL FIN on the trunk (y 33..51): rays every 3rd slice (iron_dark, pale swept-back tip), lower membrane
  // between them = a ragged, spiky top line. Bases are measured BEFORE any fin cell is placed. ----
  var BASE = {};
  for (y = 31; y <= 52; y++) BASE[y] = topZ(5, y);
  for (y = 33; y <= 51; y++) {
    var fh = Math.round(4 * Math.sin(Math.PI * (y - 32) / 20));
    if (fh < 1) continue;
    if (y % 3 === 0) {
      for (z = 1; z <= fh; z++) sym(5, y, BASE[y] + z, 'F');
      sym(5, y + 1, Math.min(17, BASE[y] + fh + 1), 'X');            // tip swept back one slice
    } else {
      for (z = 1; z < fh; z++) sym(5, y, BASE[y] + z, 'f');
    }
  }
  // tail fin folds: a low ridge on tail1, a paddle (top + bottom) on tail2
  var TB = {}, BB = {}, TOPF = [1, 2, 2, 3, 3, 3, 3, 3, 2, 2], BOTF = [0, 0, 1, 1, 2, 2, 3, 3, 3, 2];
  for (y = 53; y <= 72; y++) { TB[y] = topZ(5, y); BB[y] = botZ(5, y); }
  for (y = 53; y <= 62; y++) sym(5, y, TB[y] + 1, y % 3 === 0 ? 'F' : 'f');
  for (y = 63; y <= 72; y++) {
    var th = TOPF[y - 63], bh = BOTF[y - 63], ray = (y % 3 === 0);
    for (z = 1; z <= th; z++) sym(5, y, TB[y] + z, ray ? 'F' : 'f');
    for (z = 1; z <= bh; z++) sym(5, y, BB[y] - z, ray ? 'F' : 'f');
  }

  // ---- HEAD (y 0..10, z >= 6; the lip line is z6, upper fangs hang into z5) ----
  var HEAD = [[6.6, 1.4, 1.3], [6.8, 1.8, 1.6], [7.0, 2.1, 1.9], [7.2, 2.4, 2.2], [7.4, 2.6, 2.5], [7.6, 2.9, 2.8],
              [7.8, 3.2, 3.0], [8.0, 3.5, 3.2], [8.0, 3.7, 3.4], [7.9, 3.7, 3.4], [7.7, 3.5, 3.3]];   // [cz, rx, rz]
  function headMat(cz, rz) {
    return function (px, py, pz) {
      var rel = (pz + 0.5 - cz) / rz, mx = Math.min(px, SX - 1 - px), c = hash(mx >> 1, py >> 1, pz >> 1, SEED + 2);
      if (pz === 6) return 'F';                                       // dark lip line (inner cells -> roof below)
      if (rel > 0.5) return c < 0.3 ? 'h' : 'H';
      if (rel < -0.1) return c < 0.4 ? 'S' : 'h';
      return c < 0.22 ? 'X' : 'h';
    };
  }
  for (y = 0; y <= 10; y++) ellY(y, HEAD[y][0], HEAD[y][1], HEAD[y][2], headMat(HEAD[y][0], HEAD[y][2]), 6, 15);
  for (y = 1; y <= 10; y++) {                                        // mouth roof (underside, seen when the jaw opens)
    var xr = outerX(y, 6);
    if (xr < 0) continue;
    for (x = xr + 1; x < SX - 1 - xr; x++) put(x, y, 6, 'R');
  }
  for (y = 1; y <= 8; y += 2) { var xf = outerX(y, 6); if (xf >= 0) sym(xf, y, 5, 'T'); }   // upper fangs over the lip
  sym(5, 0, 5, 'T');                                                  // front fang pair under the snout tip
  for (y = 4; y <= 6; y++) {                                         // heavy brow ridge, small ember eyes under it
    var xb = outerX(y, 9);
    if (xb > 0) sym(xb - 1, y, 9, 'H');
    if (y >= 5) { var xe = outerX(y, 8); if (xe >= 0) sym(xe, y, 8, 'E'); }
  }
  paint(4, 1, 7, 'F');                                                // nostrils on top of the snout
  var HT = {};
  for (y = 6; y <= 10; y++) HT[y] = topZ(5, y);
  sym(5, 6, HT[6] + 1, 'F');                                          // 3-spike skull crest, tallest at the back
  sym(5, 8, HT[8] + 1, 'F'); sym(5, 8, HT[8] + 2, 'X');
  sym(5, 10, HT[10] + 1, 'F'); sym(5, 10, HT[10] + 2, 'F'); sym(5, 10, HT[10] + 3, 'X');
  [[8, 9], [9, 8], [9, 9], [10, 7], [10, 8], [10, 9]].forEach(function (q) {   // back-swept gill spines on the cheeks
    var xo = outerX(q[0], q[1]); if (xo > 0) sym(xo - 1, q[0], q[1], 'F');
  });
  [[9, 9], [10, 8], [10, 9]].forEach(function (q) {
    var xo = outerX(q[0], q[1]); if (xo > 0) sym(xo - 1, q[0], q[1], 'f');
  });

  // ---- JAW (y 1..9, z 1..4): pale chin plates underneath, gums + tongue on top, lower teeth on the rim ----
  var JAW = [null, [4.0, 1.4, 1.2], [3.9, 1.8, 1.5], [3.8, 2.1, 1.8], [3.8, 2.4, 1.9], [3.8, 2.6, 2.0], [3.8, 2.8, 2.1],
             [3.9, 3.0, 2.1], [4.0, 3.1, 2.1], [4.1, 3.0, 2.0]];
  function jawMat(px, py, pz) { if (pz >= 4) return 'R'; if (pz <= 2) return (py % 2) ? 'P' : 'p'; return 'h'; }
  for (y = 1; y <= 9; y++) ellY(y, JAW[y][0], JAW[y][1], JAW[y][2], jawMat, 1, 4);
  for (y = 1; y <= 9; y++) {
    var xj = outerX(y, 4);
    if (xj < 0) continue;
    sym(xj, y, 4, (y % 2 === 0) ? 'T' : 'F');
    if (y >= 2 && y <= 7) { put(5, y, 4, 'G'); put(6, y, 4, 'G'); }
  }

  function buildLayers() {
    var out = [];
    for (var lz = 0; lz < SZ; lz++) { var rows = []; for (var ly = 0; ly < SY; ly++) rows.push(G[lz][ly].join('')); out.push(rows); }
    return out;
  }

  var PARTS = {
    body:  { box: [1, 31, 2, 11, 53, 18], pivot: [6, 42, 8] },
    neck1: { box: [2, 21, 2, 10, 31, 14], pivot: [6, 30.5, 7.2], parent: 'body' },
    neck2: { box: [2, 11, 2, 10, 21, 14], pivot: [6, 20.5, 7.3], parent: 'neck1' },
    head:  { box: [0, 0, 5, 12, 11, 16], pivot: [6, 10.5, 7.5], parent: 'neck2' },
    jaw:   { box: [1, 0, 1, 11, 10, 5], pivot: [6, 9.5, 4.5], parent: 'head' },
    tail1: { box: [2, 53, 2, 10, 63, 13], pivot: [6, 52.5, 7.1], parent: 'body' },
    tail2: { box: [3, 63, 1, 9, 73, 13], pivot: [6, 62.5, 6.5], parent: 'tail1' }
  };

  // ---- pose helper. o = { b: [rx,ry,rz, px,py,pz] body (py - = forward), n1 / n2 / h / t1 / t2: [rx,ry,rz] or rx,
  // j: jaw rx (0..JAW_MAX) } ----
  function pose(o) {
    var b = o.b || [];
    return {
      body:  { rot: rr([b[0] || 0, b[1] || 0, b[2] || 0]), pos: rr([b[3] || 0, b[4] || 0, b[5] || 0]) },
      neck1: { rot: rr(v3(o.n1)) },
      neck2: { rot: rr(v3(o.n2)) },
      head:  { rot: rr(v3(o.h)) },
      jaw:   { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      tail1: { rot: rr(v3(o.t1)) },
      tail2: { rot: rr(v3(o.t2)) }
    };
  }
  function clip(keys, loop) {
    var d = [], f = [];
    for (var k = 0; k < keys.length; k++) { d.push(keys[k][0]); f.push(pose(keys[k][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  // circle: a lateral S-wave travels neck -> tail (each joint lags the one in front), head dipped under water, the
  // trunk bobs (fin 0.5..0.9 m over the water), the tail fin flicks out once per loop
  var CIRCLE = [];
  for (i = 0; i < 8; i++) {
    var w = 2 * Math.PI * i / 8;
    CIRCLE.push([400, {
      b: [1.5 * Math.sin(w + 1), 3 * Math.sin(w), 4 * Math.sin(w - 1.6), 0, 0, -0.5 + Math.sin(w)],
      n1: [16 + 3 * Math.sin(w + 0.8), 0, 8 * Math.sin(w - 0.8)],
      n2: [6, 0, 9 * Math.sin(w)],
      h: [4, 0, -6 * Math.sin(w + 0.8)],
      t1: [-3 + 6 * Math.max(0, Math.sin(w - 2.4)), 0, 14 * Math.sin(w - 2.4)],
      t2: [-4 + 14 * Math.max(0, Math.sin(w - 3.2)), 0, 22 * Math.sin(w - 3.2)]
    }]);
  }
  var RISE_END = { b: [-4, 0, 0, 0, -1, 1], n1: [-30, 0, 0], n2: [-25, 0, 0], h: [71, 0, -4], j: 22, t1: [0, 0, 3], t2: [0, 0, 6] };

  var animations = {
    circle: clip(CIRCLE, true),
    rise: clip([
      [200, { b: [0, 0, 0, 0, 0, -1], n1: [16, 0, 0], n2: [6, 0, 0], h: [4, 0, 0], t1: [-3, 0, 0], t2: [-4, 0, 0] }],     // under
      [250, { b: [3, 0, 0, 0, 1, -2.5], n1: [24, 0, 0], n2: [10, 0, 0], h: [0, 0, 0], t1: [-8, 0, 6], t2: [-14, 0, 12] }], // gathers
      [300, { b: [-3, 0, 0, 0, -1, 0], n1: [-14, 0, 0], n2: [-10, 0, 0], h: [24, 0, 0], j: 6, t1: [4, 0, -10], t2: [8, 0, -18] }], // surge
      [250, { b: [-6, 0, 0, 0, -1.5, 2], n1: [-36, 0, 0], n2: [-31, 0, 0], h: [62, 0, 0], j: 16, t1: [2, 0, 6], t2: [4, 0, 12] }], // overshoot
      [200, RISE_END]                                                                                                       // held
    ], false),
    strike: clip([
      [100, RISE_END],
      [100, { b: [-6, 0, 0, 0, 2, 1.5], n1: [-38, 0, 0], n2: [-40, 0, 0], h: [90, 0, 0], j: 30, t1: [0, 0, -6], t2: [0, 0, -12] }], // recoil
      [50,  { b: [0, 0, 0, 0, -16, 1], n1: [-22, 0, 0], n2: [-6, 0, 0], h: [30, 0, 0], j: 45, t1: [6, 0, 10], t2: [10, 0, 18] }],   // lunge, gape
      [100, { b: [2, 0, 0, 0, -25, 1], n1: [-18, 0, 0], n2: [0, 0, 0], h: [26, 0, 0], j: 0, t1: [4, 0, 4], t2: [6, 0, 8] }],        // SNAP
      [50,  { b: [6, 0, 0, 0, -26, 0], n1: [-10, 0, 0], n2: [6, 0, 0], h: [22, 0, 0], j: 4, t1: [0, 0, 0], t2: [0, 0, 0] }]          // drags down
    ], false)
  };

  // ---- forward kinematics (R = Rz * Ry * Rx, rotate about the pivot, then pos, then the parent) for fx.reach ----
  function rotM(rx, ry, rz) {
    var cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
    var cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
    return [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy, cy * sx, cy * cx]];
  }
  function fk(frame, part, pt) {
    var p = pt.slice(), name = part;
    while (name) {
      var pd = PARTS[name], f = frame[name] || {}, r = f.rot || [0, 0, 0], t = f.pos || [0, 0, 0], pv = pd.pivot, M = rotM(r[0], r[1], r[2]);
      var d = [p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]];
      p = [M[0][0] * d[0] + M[0][1] * d[1] + M[0][2] * d[2] + pv[0] + t[0],
           M[1][0] * d[0] + M[1][1] * d[1] + M[1][2] * d[2] + pv[1] + t[1],
           M[2][0] * d[0] + M[2][1] * d[1] + M[2][2] * d[2] + pv[2] + t[2]];
      name = pd.parent;
    }
    return p;
  }
  function reachOf(frame) {   // snout (upper fang line) relative to the anchor: metres forward and over the waterline
    var p = fk(frame, 'head', [6, 0.5, 6]);
    return { fwdM: r2((ANCHOR[1] - p[1]) * CELL), upM: r2((p[2] - W) * CELL) };
  }

  A.models.seaMonster = {
    name: 'seaMonster',
    displayName: 'sea monster',
    desc: 'D-070 sea serpent past the Long Strand: 7.3 m snout to tail fin, near-black back, slate flanks with a pale ' +
          'lateral line, pale ventral plates, a weed- and barnacle-crusted back hump with a tall spiny dorsal fin, long ' +
          'neck with dorsal spines, a long fanged head with a heavy brow, ember eyes, skull crest, gill spines and an ' +
          'opening jaw; eel paddle tail. 7 parts: circle (only back + fin over the water), rise, strike.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: ANCHOR.slice(),
      light: false,
      mats: {
        H: 'fur_wolf_dark',   // near-black back
        h: 'waystone_dark',   // slate flanks, cheeks
        X: 'waystone',        // lighter mottles, lateral line, spine / ray tips
        S: 'granite_dark',    // dark transition into the belly, lower cheeks
        P: 'granite_light',   // pale ventral plates, chin
        p: 'ash',             // plate seams
        M: 'moss_cap',        // weed clumps on the hump
        B: 'waystone_light',  // barnacle clumps on the hump
        F: 'iron_dark',       // fin rays, spines, lip line, nostrils, gill spines
        f: 'granite_dark',    // fin membrane
        E: EYE_MAT,           // eyes
        T: 'linen_light',     // fangs + teeth
        R: 'gore_red_dark',   // mouth roof, gums
        G: 'gore_red'         // tongue
      },
      layers: buildLayers(),
      parts: PARTS,
      animations: animations,
      // grid coords, rest pose; they follow their part's animated pose
      mounts: {
        head:  { at: [6, 5, 8], part: 'head' },      // ripple ring origin (38.54: a ring every 0.5 s at its head)
        eyes:  { at: [6, 5.5, 8.5], part: 'head' },  // look-at for a death camera
        mouth: { at: [6, 1, 5], part: 'head' },      // bite / kill point between the fangs
        fin:   { at: [6, 42, 15], part: 'body' },    // wake / ripple origin while circling (fin middle)
        tail:  { at: [6, 70, 8], part: 'tail2' }     // tail fin splash
      }
    }
  };

  var riseEnd = animations.rise.frames[animations.rise.frames.length - 1], snap = animations.strike.frames[3];
  var REACH = { riseEnd: reachOf(riseEnd), strikeSnap: reachOf(snap) };

  // ===================================================================================================================
  // ASSETS.seaMonsterFx - presentation data for SWIM-06b (game/js/quest/seaMonster.js). No game logic here.
  // ===================================================================================================================
  A.seaMonsterFx = {
    version: 1,
    story: 'SWIM-06b (D-070, architecture.md 38.54); PC-B designer 2026-10-13, owner-authorised',
    model: 'seaMonster',
    clipFor: { hidden: null, circle: 'circle', rise: 'rise', strike: 'strike',
               note: 'hidden = parked at HIDE_Z, no clip needed (play circle). rise / strike are once clips: the last key holds.' },
    waterline: { anchorZ: W, entityZ: 'surfaceZ',
                 note: 'anchor z = the waterline: set the entity z = surfaceZ in EVERY state (circle, rise, strike). ' +
                       'The clips already sink the trunk (circle) and lift the head (rise); do not add the 38.54 ' +
                       '-1.0 / +1.5 entity offsets on top.' },
    circle: { clip: 'circle', ms: 3200, orbitM: [10, 14], radPerS: 0.6,
              tint: { rgb: [10, 16, 22], k: 0.6, note: '38.23 entity tint suggestion for the dark read while circling' },
              finTopM: 0.9, humpTopM: 0.35, rippleMount: 'fin', note: 'yaw = the orbit tangent (it swims head first)' },
    rise: { clip: 'rise', ms: 1200, surgeKey: 2, surgeMs: 450, rippleMount: 'head',
            note: 'splash / big ripple at surgeMs at the head mount' },
    strike: { clip: 'strike', ms: 400, gapeKey: 2, gapeMs: 200, snapKey: 3, snapMs: 250, killMount: 'mouth',
              note: 'vitals.kill(\'eaten\') at snapMs (38.54 says 0.6 s after rise starts the strike: start strike at ' +
                    'rise end, the snap lands 250 ms later)' },
    reach: REACH,
    place: { anchorFromPlayerM: r2(REACH.strikeSnap.fwdM - 0.3),
             note: 'in the kill band put the ANCHOR this far in front of the player (facing them): at the end of rise the ' +
                   'head is then ~' + r2(REACH.strikeSnap.fwdM - 0.3 - REACH.riseEnd.fwdM) + ' m from the player and ' +
                   REACH.riseEnd.upM + ' m over the water (on screen at 240x90), and the strike snaps ~0.3 m in front of ' +
                   'the eye. reach = snout relative to the anchor (fwdM, upM over the waterline), computed from the clips.' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { seaMonster: A.models.seaMonster, seaMonsterFx: A.seaMonsterFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
