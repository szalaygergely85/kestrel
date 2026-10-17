/* design/models/voxel_bear_cub.js - NUB, Burl's cub (designer, NUB-D1; owner approved the 12 new characters 2026-10-12,
 *                                  docs/decisions.md D-069 addendum; pitch docs/quest-roadmap.md 2b: "Burl's cub; no
 *                                  lines; wanders off, gets stuck, watches his mother fight").
 *                                  Binding rules: design/style-guide.md section 0 (realistic, all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4). Stand-alone (does NOT need voxel_bear.js), same builder as Burl:
 *   <script src="../design/models/voxel_bear_cub.js">    (browser)
 *   import '../design/models/voxel_bear_cub.js';         (Node)
 * Sets ASSETS.models.bearCub and ASSETS.bearCubFx. `meshOnly: true`. NOT placed in the world yet (later story).
 *
 * Derived from Burl (design/models/voxel_bear.js, bear v2 + v1.53): the same 8-part rig (same part names, parents, axes
 * and pivot logic), the same rounded-slice builder and fur-hash, re-proportioned as a first-summer brown bear cub:
 *   - SIZE: cellM 0.025 (half of Burl's 0.05). Grid 28 x 32 x 24. 0.50 m at the shoulders, ~0.60 m to the ear tips,
 *     0.80 m nose to tail = ~45-55 % of Burl (1.1 m hump, 1.65 m).
 *   - CUB PROPORTIONS: a big round head (skull 14 cells wide x 11 tall, ~30 % of the voxels vs Burl's ~17 %) with a
 *     domed forehead, a SHORT snout (3 cells = 7.5 cm, Burl 20 cm), wide-set eyes, BIG ROUND ears set wide on the dome;
 *     a short round barrel trunk with almost no hump (rump as high as the shoulders); SHORT thick legs (belly at 0.18 m
 *     = 29 % of the height, Burl 41 %) on big paws.
 *   - COAT: fluffier and lighter than Burl: lighter warm base, many more pale guard-hair tips (fluff), soft (not dark)
 *     dorsal line, fluffy cheek tufts, dark lower legs, and a faint pale natal COLLAR on the neck sides (common in
 *     brown bear cubs).
 * Axes as Burl (15.1): x = east (= the cub's right), y = SOUTH with y0 = the nose (faces north at yaw 0), z = up. Anchor
 * [14, 17, 0] = between the four paws. Clip `pos` values are VOXELS (0.025 m).
 *
 * Parts (first-box-wins ownership, every parent earlier, each box sx+sy+sz <= 48):
 *   body  [8,10,7, 20,32,21]  pivot [14, 20, 13]   root: trunk, collar, tail. rx + = nose down.
 *   head  [6,0,10, 22,10,21]  pivot [14, 9, 15]    skull, cheeks, snout, nose, eyes, neck slice y9. rx - = nose up.
 *   jaw   [10,0,8, 18,7,10]   pivot [14, 6, 10]    lower jaw (rest 0; only a sniff / huff twitch, NO talk clips).
 *   ears  [8,5,21, 20,9,24]   pivot [14, 6.5, 21]  both round ears. rx + = perk forward, - = pin back.
 *   armL / armR [3|17,10,0, 11|25,19,18] pivot [7.5|20.5, 14, 14]   legL / legR [3|17,21,0, 11|25,32,20]
 *                             pivot [7.5|20.5, 26.5, 14]. rx - = paw forward.
 *
 * Clips (ms, multiples of 50; ALL FOUR PAWS ON THE GROUND in every clip, style-guide 0.2; no dialogue clips - Nub has
 * no lines). Every limb is GROUND-SNAPPED per key: its pos z is solved from its own voxels so the lowest corner sits on
 * z = 0 for that key's body pitch / drop and limb angle (`lift` adds clearance on a stepping paw). Limbs also stay
 * plumb (body pitch is cancelled on the limb angle).
 *   idle        loop 4.0 s  breathing, curious look left (ear flick) / right with a head tilt, a quick sniff.
 *   walk        loop 0.6 s  diagonal pairs, quick short cub steps, trunk yaw + bob, head swings. ~0.5 m/s.
 *   trot        loop 0.4 s  bouncy diagonal trot (catching up with mother). ~1.2 m/s.
 *   sniff       loop 2.0 s  trunk leans forward + down, nose low (~9 cm) and sweeping, jaw twitches.
 *   lookUp      loop 2.4 s  WATCHING: weight back, head up 30 deg, ears forward, an ear flinch (a thud), follows.
 *   stuckWiggle loop 0.8 s  GETS STUCK: pulls back from something, rump wiggles side to side, hind paws stamp, front
 *                           paws scrabble, ears pinned, head low.
 *   lieDown     once 0.9 s  SIT REPLACEMENT: a cub sitting on its rump is an upright pose (Burl v1's sit was removed for
 *                           0.2), so Nub LIES DOWN instead: rump folds first, then the fore legs, onto the belly.
 *   lie         loop 3.0 s  lying on the belly (sphinx), fore paws forward, hind legs tucked, all four on the ground;
 *                           breathing, head up and turning (also a valid "watching" pose).
 *   getUp       once 0.6 s  fronts push up first, then the hinds, back to the rest stance.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 28, SY = 32, SZ = 24, CELL = 0.025;
  // pale-tip density knob (1 = full fluffy coat, 0 = zoned tones only). Tri budget: LOD0 <= Burl's LOD0 (test). The
  // first build (FLUFF 1, 1-cell-wide strands) was over Burl; now 0.6 + the strand hash in 2-wide clumps (px >> 1). If
  // still over: FLUFF 0.4, then 0.25 (the zoned tones - pale dome / cheek ruffs / collar - keep the cub look).
  var FLUFF = 0.6;
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
  function rectSym(axis, L, a0, a1, b0, b1, r, ch) {
    rect(axis, L, a0, a1, b0, b1, r, ch);
    if (axis === 'x') rect('x', SX - 1 - L, a0, a1, b0, b1, r, ch);
    else rect(axis, L, SX - a1, SX - a0, b0, b1, r, ch);
  }

  // ---- trunk: one rounded slice per y [x0, x1, z0, z1, r] (half-open). Short round barrel, belly z7, top z20 at the
  // shoulders AND the rump (a cub has almost no hump), slight dip behind the shoulders, round rump cap y30 + tail y31.
  var PROF = {
    10: [9, 19, 9, 19, 3], 11: [8, 20, 8, 20, 4],
    12: [8, 20, 7, 21, 4], 13: [8, 20, 7, 21, 4], 14: [8, 20, 7, 21, 4], 15: [8, 20, 7, 21, 4],
    16: [8, 20, 7, 20, 4], 17: [8, 20, 7, 20, 4], 18: [8, 20, 7, 20, 4], 19: [8, 20, 7, 20, 4],
    20: [8, 20, 7, 20, 4], 21: [8, 20, 7, 20, 4], 22: [8, 20, 7, 20, 4], 23: [8, 20, 7, 20, 4],
    24: [8, 20, 7, 21, 4], 25: [8, 20, 7, 21, 4], 26: [8, 20, 8, 21, 4], 27: [8, 20, 8, 20, 4],
    28: [9, 19, 8, 20, 4], 29: [9, 19, 9, 19, 4], 30: [10, 18, 10, 18, 3]
  };
  // coat: S belly shadow, P pale natal collar, K soft dorsal line / partings, b pale fluffy tips, F light strands, B base
  function bodyMat(px, py, pz) {
    var p = PROF[py];
    if (!p) return 'B';
    var dTop = p[3] - 1 - pz, dx = Math.abs(px - 13.5);
    var n = hsh(px >> 1, py >> 1, (pz / 3) | 0), c = hsh(px >> 1, py >> 1, pz >> 1);
    if (pz <= p[2]) return 'S';
    if (pz === p[2] + 1) return c < 50 ? 'S' : 'B';
    if (py <= 11 && dx >= 3.5 && pz >= p[2] + 2 && pz <= p[2] + 6) return c < 65 ? 'P' : 'b';   // natal collar
    if (dTop <= 1) return (dx <= 1.5 && py >= 13 && py <= 27) ? (c < 55 ? 'K' : 'B') : (c < 60 * FLUFF ? 'b' : 'B');
    if (dTop <= 3) return c < 48 * FLUFF ? 'b' : (c < 66 ? 'F' : 'B');
    if (pz <= p[2] + 3) return n < 30 ? 'S' : (n < 42 ? 'K' : 'B');
    if (n < 26 * FLUFF) return 'F';
    if (n < 34) return 'K';
    if (n < 34 + 16 * FLUFF) return 'b';
    return 'B';
  }
  for (y = 10; y <= 30; y++) rect('y', y, PROF[y][0], PROF[y][1], PROF[y][2], PROF[y][3], PROF[y][4], bodyMat);
  put(13, 31, 16, 'K'); put(14, 31, 16, 'b'); put(13, 31, 15, 'b'); put(14, 31, 15, 'S');   // short fluffy tail stub

  // ---- head (head part): BIG round skull y4..8 + neck y9, short snout y1..3, nose button y0 ----
  function headMat(px, py, pz) {
    var c = hsh(px >> 1, py >> 1, pz >> 1);
    if (py <= 4 && pz >= 16) return c < 50 ? 'b' : 'B';          // lighter brow / forehead
    if (pz >= 18) return c < 45 * FLUFF ? 'b' : 'B';             // fluffy dome
    if (px <= 8 || px >= 19) return c < 55 * FLUFF ? 'b' : 'B';  // cheek ruffs
    return c < 14 ? 'F' : 'B';
  }
  rect('y', 9, 10, 18, 11, 19, 3, headMat);                    // neck (head part, joins the chest)
  rect('y', 8, 8, 20, 10, 20, 4, headMat);                     // back of the skull
  rect('y', 7, 7, 21, 10, 21, 4, headMat);                     // widest: cheeks + domed crown
  rect('y', 6, 7, 21, 10, 21, 4, headMat);
  rect('y', 5, 8, 20, 10, 20, 4, headMat);                     // face
  rect('y', 4, 9, 19, 10, 19, 3, headMat);                     // the stop (steep, a cub's forehead)
  rect('y', 3, 10, 18, 10, 16, 2, 'M');                        // short snout
  rect('y', 2, 11, 17, 10, 15, 2, 'M');
  rect('y', 1, 12, 16, 10, 14, 1, 'M');
  for (x = 12; x <= 15; x++) put(x, 1, 13, 'N');               // nose pad + button tip
  put(13, 0, 12, 'N'); put(14, 0, 12, 'N'); put(13, 0, 13, 'N'); put(14, 0, 13, 'N');
  put(12, 1, 10, 'D'); put(15, 1, 10, 'D'); put(13, 1, 10, 'R'); put(14, 1, 10, 'R');           // lips + mouth roof
  put(11, 2, 10, 'D'); put(16, 2, 10, 'D'); put(13, 2, 10, 'R'); put(14, 2, 10, 'R');
  put(11, 4, 16, 'E'); put(16, 4, 16, 'E');                    // eyes, set wide
  put(11, 4, 17, 'B'); put(16, 4, 17, 'B');                    // soft brows
  putSym(6, 7, 12, 'b'); putSym(6, 7, 13, 'b'); putSym(6, 6, 12, 'b'); putSym(6, 6, 13, 'B');   // fluffy cheek tufts
  putSym(9, 6, 20, 'B'); putSym(9, 7, 20, 'B');                // ear bases on the dome

  // ---- jaw part ----
  function jawTop(px, py) {
    if (py === 1) return 'D';
    if ((px === 13 || px === 14) && py >= 2 && py <= 3) return 'T';
    if ((px === 12 || px === 15) && py === 2) return 'W';
    if ((px === 12 || px === 15) && py >= 3 && py <= 4) return 'R';
    return 'b';
  }
  rect('z', 9, 11, 17, 1, 6, 2, jawTop);
  rect('z', 8, 12, 16, 2, 6, 2, 'b');                          // fluffy chin

  // ---- ears part: big ROUND ears set wide on the dome (x9..11 / x16..18, z21..23) ----
  for (var ey = 6; ey <= 7; ey++) {
    for (x = 9; x <= 11; x++) { putSym(x, ey, 21, ey === 6 ? 'b' : 'B'); putSym(x, ey, 22, ey === 6 ? 'b' : 'B'); }
    putSym(10, ey, 23, ey === 6 ? 'b' : 'B');
  }
  putSym(10, 6, 22, 'D'); putSym(10, 6, 21, 'D');              // dark inner ear

  // ---- limbs: short, thick, big paws ----
  function limbMat(pz, hi, mid, px, py) {
    var n = hsh(px >> 1, py >> 1, (pz / 3) | 0), c = hsh(px >> 1, py >> 1, pz >> 1);
    if (pz >= hi) return c < 52 * FLUFF ? 'b' : (c < 64 ? 'K' : 'B');
    if (pz >= mid) return n < 28 * FLUFF ? 'F' : (n < 36 ? 'K' : 'B');
    if (pz >= mid - 2) return n < 55 ? 'K' : 'B';
    if (pz >= mid - 3) return n < 60 ? 'D' : 'K';
    return 'D';
  }
  function armMat(px, py, pz) { return limbMat(pz, 12, 7, px, py); }
  function legMat(px, py, pz) { return limbMat(pz, 13, 8, px, py); }
  function padRow(px) { return (px >= 5 && px <= 8) || (px >= 19 && px <= 22); }
  // front limbs (armL, mirrored armR)
  rectSym('z', 0, 4, 10, 11, 17, 2, function (px, py) { return py === 11 && padRow(px) ? 'S' : 'D'; });   // paw 6 x 6
  rectSym('z', 1, 4, 10, 11, 17, 2, 'D');
  for (z = 2; z <= 3; z++) rectSym('z', z, 5, 9, 12, 16, 2, 'D');      // wrist 4 x 4
  for (z = 4; z <= 6; z++) rectSym('z', z, 4, 10, 11, 17, 2, armMat);  // fluffy forearm 6 x 6
  rectSym('x', 7, 11, 18, 4, 17, 3, armMat);                   // shoulder + upper arm (outside the trunk)
  rectSym('x', 6, 11, 18, 5, 16, 3, armMat);
  rectSym('x', 5, 12, 17, 6, 15, 2, armMat);
  putSym(5, 10, 0, 'C'); putSym(7, 10, 0, 'C');                // small front claws
  // hind limbs (legL, mirrored legR): plantigrade foot, short shin, round haunch
  rectSym('z', 0, 4, 10, 23, 31, 2, function (px, py) { return py === 23 && padRow(px) ? 'S' : 'D'; });   // foot 6 x 8
  rectSym('z', 1, 4, 10, 23, 31, 2, 'D');
  for (z = 2; z <= 3; z++) rectSym('z', z, 5, 9, 25, 31, 2, 'D');      // heel
  for (z = 4; z <= 7; z++) rectSym('z', z, 4, 10, 24, 31, 2, legMat);  // shin
  rectSym('x', 7, 22, 32, 4, 19, 4, legMat);                   // haunch / buttock (outside the trunk)
  rectSym('x', 6, 23, 32, 5, 18, 4, legMat);
  rectSym('x', 5, 24, 31, 6, 17, 3, legMat);
  rectSym('x', 4, 25, 30, 8, 15, 2, legMat);                   // outer thigh
  putSym(5, 22, 0, 'C'); putSym(7, 22, 0, 'C');

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  var parts = {
    body: { box: [8, 10, 7, 20, 32, 21], pivot: [14, 20, 13] },
    head: { box: [6, 0, 10, 22, 10, 21], pivot: [14, 9, 15], parent: 'body' },
    jaw:  { box: [10, 0, 8, 18, 7, 10], pivot: [14, 6, 10], parent: 'head' },
    ears: { box: [8, 5, 21, 20, 9, 24], pivot: [14, 6.5, 21], parent: 'head' },
    armL: { box: [3, 10, 0, 11, 19, 18], pivot: [7.5, 14, 14], parent: 'body' },
    armR: { box: [17, 10, 0, 25, 19, 18], pivot: [20.5, 14, 14], parent: 'body' },
    legL: { box: [3, 21, 0, 11, 32, 20], pivot: [7.5, 26.5, 14], parent: 'body' },
    legR: { box: [17, 21, 0, 25, 32, 20], pivot: [20.5, 26.5, 14], parent: 'body' }
  };
  var PNAMES = Object.keys(parts);
  function ownerOf(px, py, pz) {
    for (var i = 0; i < PNAMES.length; i++) {
      var b = parts[PNAMES[i]].box;
      if (px >= b[0] && px < b[3] && py >= b[1] && py < b[4] && pz >= b[2] && pz < b[5]) return PNAMES[i];
    }
    return null;
  }
  // (y, z) cells owned by each limb (pitch-only ground solve)
  var LIMB_PART = { aL: 'armL', aR: 'armR', lL: 'legL', lR: 'legR' }, LIMB_YZ = {};
  Object.keys(LIMB_PART).forEach(function (k) {
    var pn = LIMB_PART[k], seen = {}, list = [];
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (layers[z][y].charAt(x) === '.' || ownerOf(x, y, z) !== pn || seen[y + ',' + z]) continue;
      seen[y + ',' + z] = 1; list.push([y, z]);
    }
    LIMB_YZ[k] = list;
  });

  // ---- pose: o = { b: [rx, ry, rz, px, py, pz] body (rx + nose down, py + = back), h head, j jaw, e ears, aL aR lL lR
  // limb rot (number = rx), lift { aL: cells of clearance } }. Limbs: plumb (rx - body rx), pos x/y = -body (planted),
  // pos z solved so the limb's lowest voxel corner touches z = 0 (+ lift). ----
  var JAW_MAX = 12, D2R = Math.PI / 180, PB = parts.body.pivot;
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
      var r = v3(o[k]); r[0] -= (b[0] || 0);                   // plumb: cancel the body pitch
      return { rot: [r2(r[0]), r2(r[1]), r2(r[2])], pos: [r2(-(b[3] || 0)), r2(-(b[4] || 0)), r2(groundPz(k, r[0], b) + (L[k] || 0))] };
    }
    var h = v3(o.h), e = v3(o.e);
    return {
      body: { rot: [r2(b[0] || 0), r2(b[1] || 0), r2(b[2] || 0)], pos: [r2(b[3] || 0), r2(b[4] || 0), r2(b[5] || 0)] },
      head: { rot: [r2(h[0]), r2(h[1]), r2(h[2])] }, jaw: { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      ears: { rot: [r2(e[0]), r2(e[1]), r2(e[2])] },
      armL: limb('aL'), armR: limb('aR'), legL: limb('lL'), legR: limb('lR')
    };
  }
  function clip(keys, loop) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }
  function mix(base, o) {                                       // shallow merge: o's fields override base's
    var r = {}, k; for (k in base) r[k] = base[k]; for (k in o) r[k] = o[k]; return r;
  }

  var PIN = [-22, 0, 0];
  // lying on the belly: trunk dropped 6.5 cells (belly on the ground), fore paws forward, hind legs tucked under
  var LIE_O = { b: [0, 0, 0, 0, 0, -6.5], h: [-10, 0, 0], e: [6, 0, 0], aL: -72, aR: -72, lL: -60, lR: -60 };
  var animations = {
    idle: clip([
      [700, {}],
      [600, { b: [0, 0, 0, 0, 0, 0.3], h: [2, 0, 0] }],                                  // breath
      [400, { h: [-8, 4, -14], e: [6, 0, 0] }],                                           // curious look left
      [150, { h: [-8, 4, -14], e: [-20, 0, 0] }],                                         // ear flick
      [550, { h: [-8, 4, -14], e: [8, 0, 0], b: [0, 0, 0, 0, 0, 0.3] }],
      [500, { h: [-4, -8, 12], b: [0, 0, 1, 0, 0, 0] }],                                  // look right, head tilt
      [400, { h: [8, 0, 4], j: 3 }],                                                      // quick sniff
      [700, { h: [2, 0, 0] }]
    ], true),
    // GAIT-A BEGIN walk (tools/gen-gait.mjs: option A, amble gait, duty 0.68, tuned 0.5 m/s, 12 keys x 50 ms; re-run, do not hand-edit)
    walk: { durations: [50,50,50,50,50,50,50,50,50,50,50,50], loop: true, frames: [
        { body: { rot: [0.847,3.329,0], pos: [0,0,0.129] }, head: { rot: [-0.254,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, armL: { rot: [-6.143,0,0], pos: [0,0,0.518] }, armR: { rot: [1.965,0,0], pos: [0,0,0.495] }, legL: { rot: [-16.944,0,0], pos: [0,0,0.074] }, legR: { rot: [7.883,0,0], pos: [0,0,0.652] } },
        { body: { rot: [1.496,2.342,1.5], pos: [0,0,0.24] }, head: { rot: [-0.449,0,-1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [0.283,0,0], pos: [0,0,0] }, armL: { rot: [-15.678,0,0], pos: [0,0,0.231] }, armR: { rot: [6.068,0,0], pos: [0,0,0.577] }, legL: { rot: [-12.709,0,0], pos: [0,0,-0.078] }, legR: { rot: [12.039,0,0], pos: [0,0,0.51] } },
        { body: { rot: [0.649,0.728,2.598], pos: [0,0,0.111] }, head: { rot: [-0.195,0,-2.078], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-2.445,0,0], pos: [0,0,0] }, armL: { rot: [-14.562,0,0], pos: [0,0,0.184] }, armR: { rot: [10.203,0,0], pos: [0,0,0.541] }, legL: { rot: [-8.544,0,0], pos: [0,0,0.217] }, legR: { rot: [16.26,0,0], pos: [0,0,0.6] } },
        { body: { rot: [-0.847,-1.082,3], pos: [0,0,-0.129] }, head: { rot: [0.254,0,-2.4], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-2.728,0,0], pos: [0,0,0] }, armL: { rot: [-10.37,0,0], pos: [0,0,0.477] }, armR: { rot: [14.393,0,0], pos: [0,0,0.463] }, legL: { rot: [-4.424,0,0], pos: [0,0,0.7] }, legR: { rot: [12.707,0,0], pos: [0,0,1.233] } },
        { body: { rot: [-1.496,-2.601,2.598], pos: [0,0,-0.24] }, head: { rot: [0.449,0,-2.078], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-0.283,0,0], pos: [0,0,0] }, armL: { rot: [-6.233,0,0], pos: [0,0,0.642] }, armR: { rot: [15.889,0,0], pos: [0,0,0.588] }, legL: { rot: [-0.327,0,0], pos: [0,0,0.828] }, legR: { rot: [1.043,0,0], pos: [0,0,0.936] } },
        { body: { rot: [-0.649,-3.424,1.5], pos: [0,0,-0.111] }, head: { rot: [0.195,0,-1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.445,0,0], pos: [0,0,0] }, armL: { rot: [-2.129,0,0], pos: [0,0,0.538] }, armR: { rot: [6.632,0,0], pos: [0,0,0.702] }, legL: { rot: [3.768,0,0], pos: [0,0,0.775] }, legR: { rot: [-11.153,0,0], pos: [0,0,0.982] } },
        { body: { rot: [0.847,-3.329,0], pos: [0,0,0.129] }, head: { rot: [-0.254,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, armL: { rot: [1.965,0,0], pos: [0,0,0.495] }, armR: { rot: [-6.143,0,0], pos: [0,0,0.518] }, legL: { rot: [7.883,0,0], pos: [0,0,0.652] }, legR: { rot: [-16.944,0,0], pos: [0,0,0.074] } },
        { body: { rot: [1.496,-2.342,-1.5], pos: [0,0,0.24] }, head: { rot: [-0.449,0,1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [0.283,0,0], pos: [0,0,0] }, armL: { rot: [6.068,0,0], pos: [0,0,0.577] }, armR: { rot: [-15.678,0,0], pos: [0,0,0.231] }, legL: { rot: [12.039,0,0], pos: [0,0,0.51] }, legR: { rot: [-12.709,0,0], pos: [0,0,-0.078] } },
        { body: { rot: [0.649,-0.728,-2.598], pos: [0,0,0.111] }, head: { rot: [-0.195,0,2.078], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-2.445,0,0], pos: [0,0,0] }, armL: { rot: [10.203,0,0], pos: [0,0,0.541] }, armR: { rot: [-14.562,0,0], pos: [0,0,0.184] }, legL: { rot: [16.26,0,0], pos: [0,0,0.6] }, legR: { rot: [-8.544,0,0], pos: [0,0,0.217] } },
        { body: { rot: [-0.847,1.082,-3], pos: [0,0,-0.129] }, head: { rot: [0.254,0,2.4], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-2.728,0,0], pos: [0,0,0] }, armL: { rot: [14.393,0,0], pos: [0,0,0.463] }, armR: { rot: [-10.37,0,0], pos: [0,0,0.477] }, legL: { rot: [12.707,0,0], pos: [0,0,1.233] }, legR: { rot: [-4.424,0,0], pos: [0,0,0.7] } },
        { body: { rot: [-1.496,2.601,-2.598], pos: [0,0,-0.24] }, head: { rot: [0.449,0,2.078], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-0.283,0,0], pos: [0,0,0] }, armL: { rot: [15.889,0,0], pos: [0,0,0.588] }, armR: { rot: [-6.233,0,0], pos: [0,0,0.642] }, legL: { rot: [1.043,0,0], pos: [0,0,0.936] }, legR: { rot: [-0.327,0,0], pos: [0,0,0.828] } },
        { body: { rot: [-0.649,3.424,-1.5], pos: [0,0,-0.111] }, head: { rot: [0.195,0,1.2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.445,0,0], pos: [0,0,0] }, armL: { rot: [6.632,0,0], pos: [0,0,0.702] }, armR: { rot: [-2.129,0,0], pos: [0,0,0.538] }, legL: { rot: [-11.153,0,0], pos: [0,0,0.982] }, legR: { rot: [3.768,0,0], pos: [0,0,0.775] } }
    ] },
    // GAIT-A END walk
    // GAIT-A BEGIN trot (tools/gen-gait.mjs: option A, diagonal gait, duty 0.5, tuned 1.2 m/s, 10 keys x 50 ms; re-run, do not hand-edit)
    trot: { durations: [50,50,50,50,50,50,50,50,50,50], loop: true, frames: [
        { body: { rot: [1.129,1.427,0], pos: [0,0,0.257] }, head: { rot: [-0.339,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, armL: { rot: [-25.377,0,0], pos: [0,0,-0.308] }, armR: { rot: [25.377,0,0], pos: [0,0,0.333] }, legL: { rot: [25.377,0,0], pos: [0,0,-0.014] }, legR: { rot: [-25.377,0,0], pos: [0,0,0.386] } },
        { body: { rot: [1.919,0.882,1.176], pos: [0,0,0.465] }, head: { rot: [-0.576,0,-0.94], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-0.344,0,0], pos: [0,0,0] }, armL: { rot: [-14.901,0,0], pos: [0,0,-0.049] }, armR: { rot: [19.842,0,0], pos: [0,0,1.026] }, legL: { rot: [19.842,0,0], pos: [0,0,0.593] }, legR: { rot: [-14.901,0,0], pos: [0,0,0.07] } },
        { body: { rot: [0.057,0,1.902], pos: [0,0,0.03] }, head: { rot: [-0.017,0,-1.522], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-2.941,0,0], pos: [0,0,0] }, armL: { rot: [-4.917,0,0], pos: [0,0,0.18] }, armR: { rot: [7.288,0,0], pos: [0,0,1.514] }, legL: { rot: [7.288,0,0], pos: [0,0,1.565] }, legR: { rot: [-4.917,0,0], pos: [0,0,0.294] } },
        { body: { rot: [-1.884,-0.882,1.902], pos: [0,0,-0.446] }, head: { rot: [0.565,0,-1.522], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-1.473,0,0], pos: [0,0,0] }, armL: { rot: [4.917,0,0], pos: [0,0,0.54] }, armR: { rot: [-7.288,0,0], pos: [0,0,1.59] }, legL: { rot: [-7.288,0,0], pos: [0,0,2.44] }, legR: { rot: [4.917,0,0], pos: [0,0,0.778] } },
        { body: { rot: [-1.221,-1.427,1.176], pos: [0,0,-0.306] }, head: { rot: [0.366,0,-0.94], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.03,0,0], pos: [0,0,0] }, armL: { rot: [14.901,0,0], pos: [0,0,0.885] }, armR: { rot: [-19.842,0,0], pos: [0,0,0.861] }, legL: { rot: [-19.842,0,0], pos: [0,0,1.991] }, legR: { rot: [14.901,0,0], pos: [0,0,0.946] } },
        { body: { rot: [1.129,-1.427,0], pos: [0,0,0.257] }, head: { rot: [-0.339,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, armL: { rot: [25.377,0,0], pos: [0,0,0.333] }, armR: { rot: [-25.377,0,0], pos: [0,0,-0.308] }, legL: { rot: [-25.377,0,0], pos: [0,0,0.386] }, legR: { rot: [25.377,0,0], pos: [0,0,-0.014] } },
        { body: { rot: [1.919,-0.882,-1.176], pos: [0,0,0.465] }, head: { rot: [-0.576,0,0.94], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-0.344,0,0], pos: [0,0,0] }, armL: { rot: [19.842,0,0], pos: [0,0,1.026] }, armR: { rot: [-14.901,0,0], pos: [0,0,-0.049] }, legL: { rot: [-14.901,0,0], pos: [0,0,0.07] }, legR: { rot: [19.842,0,0], pos: [0,0,0.593] } },
        { body: { rot: [0.057,0,-1.902], pos: [0,0,0.03] }, head: { rot: [-0.017,0,1.522], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-2.941,0,0], pos: [0,0,0] }, armL: { rot: [7.288,0,0], pos: [0,0,1.514] }, armR: { rot: [-4.917,0,0], pos: [0,0,0.18] }, legL: { rot: [-4.917,0,0], pos: [0,0,0.294] }, legR: { rot: [7.288,0,0], pos: [0,0,1.565] } },
        { body: { rot: [-1.884,0.882,-1.902], pos: [0,0,-0.446] }, head: { rot: [0.565,0,1.522], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [-1.473,0,0], pos: [0,0,0] }, armL: { rot: [-7.288,0,0], pos: [0,0,1.59] }, armR: { rot: [4.917,0,0], pos: [0,0,0.54] }, legL: { rot: [4.917,0,0], pos: [0,0,0.778] }, legR: { rot: [-7.288,0,0], pos: [0,0,2.44] } },
        { body: { rot: [-1.221,1.427,-1.176], pos: [0,0,-0.306] }, head: { rot: [0.366,0,0.94], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, ears: { rot: [2.03,0,0], pos: [0,0,0] }, armL: { rot: [-19.842,0,0], pos: [0,0,0.861] }, armR: { rot: [14.901,0,0], pos: [0,0,0.885] }, legL: { rot: [14.901,0,0], pos: [0,0,0.946] }, legR: { rot: [-19.842,0,0], pos: [0,0,1.991] } }
    ] },
    // GAIT-A END trot
    sniff: clip([
      [300, { b: [6, 0, 0, 0, -0.8, -1.2], h: [36, 0, -4], e: [6, 0, 0] }],
      [200, { b: [7, 0, 0, 0, -0.9, -1.4], h: [44, 0, -6], j: 2 }],                       // sniff
      [150, { b: [7, 0, 0, 0, -0.9, -1.4], h: [42, 0, -4] }],
      [200, { b: [7, 0, 1, 0, -0.9, -1.4], h: [45, 0, 2], j: 3 }],                        // sniff, sweeping
      [150, { b: [7, 0, 1, 0, -0.9, -1.4], h: [43, 0, 4] }],
      [300, { b: [8, 0, 2, 0, -1.0, -1.5], h: [46, 0, 8], j: 2 }],
      [400, { b: [6, 0, 0, 0, -0.8, -1.2], h: [36, 0, 2], e: [10, 0, 0] }],               // half up, ears forward
      [300, { b: [6, 0, -1, 0, -0.8, -1.2], h: [44, 0, -2], j: 2 }]
    ], true),
    lookUp: clip([
      [500, { b: [-2, 0, 0, 0, 0.6, 0], h: [-30, 0, 0], e: [12, 0, 0] }],
      [400, { b: [-2, 0, 0, 0, 0.6, 0.25], h: [-32, 4, -6], e: [12, 0, 0] }],             // breath, head follows
      [150, { b: [-2, 0, 0, 0, 0.6, 0], h: [-32, 4, -6], e: [-14, 0, 0] }],               // ear flinch (a thud)
      [450, { b: [-3, 0, -2, 0, 0.8, 0], h: [-34, -4, 8], e: [14, 0, 0], j: 2 }],
      [400, { b: [-2, 0, -1, 0, 0.6, 0.25], h: [-30, -2, 6], e: [12, 0, 0] }],
      [500, { b: [-2, 0, 0, 0, 0.6, 0], h: [-28, 0, 0], e: [10, 0, 0] }]
    ], true),
    stuckWiggle: clip([
      [150, { b: [2, -4, -6, 0, 0.8, -0.4], h: [16, 0, 12], e: PIN, j: 6, aL: -8, aR: -8, lL: -8, lR: 6, lift: { lL: 1.5 } }],
      [100, { b: [3, 0, 0, 0, 1.0, -0.6], h: [18, 0, 0], e: PIN, j: 10, aL: -10, aR: -10 }],                // strain
      [150, { b: [2, 4, 6, 0, 0.8, -0.4], h: [16, 0, -12], e: PIN, j: 6, aL: -8, aR: -8, lL: 6, lR: -8, lift: { lR: 1.5 } }],
      [100, { b: [3, 0, 0, 0, 1.0, -0.6], h: [18, 0, 0], e: PIN, j: 12, aL: -10, aR: -10 }],
      [150, { b: [1, -3, -4, 0, 0.6, -0.2], h: [12, 0, 8], e: [-18, 0, 0], j: 4, aL: -14, aR: -6, lift: { aL: 1.2 } }],  // scrabble
      [150, { b: [1, 3, 4, 0, 0.6, -0.2], h: [12, 0, -8], e: [-18, 0, 0], j: 4, aL: -6, aR: -14, lift: { aR: 1.2 } }]
    ], true),
    lieDown: clip([
      [150, { b: [0, 0, 0, 0, 0, -0.3], h: [4, 0, 0] }],                                  // anticipation
      [250, { b: [-6, 0, 0, 0, 0.5, -2.5], h: [-2, 0, 0], lL: -35, lR: -35 }],            // rump folds first
      [250, { b: [-2, 0, 0, 0, 0.3, -5], h: [-6, 0, 0], aL: -45, aR: -45, lL: -55, lR: -55 }],
      [250, LIE_O]
    ], false),
    lie: clip([
      [900, LIE_O],
      [700, mix(LIE_O, { b: [0, 0, 0, 0, 0, -6.2] })],                                    // breath
      [600, mix(LIE_O, { h: [-14, 4, -16], e: [10, 0, 0] })],                             // looks left
      [800, mix(LIE_O, { h: [-12, -3, 10], e: [8, 0, 0] })]                               // looks right
    ], true),
    getUp: clip([
      [200, { b: [-3, 0, 0, 0, 0.3, -4], h: [-6, 0, 0], aL: -30, aR: -30, lL: -50, lR: -50 }],   // fronts push up
      [200, { b: [-2, 0, 0, 0, 0.2, -1.5], h: [-2, 0, 0], aL: -6, aR: -6, lL: -20, lR: -20 }],
      [200, {}]
    ], false)
  };

  // materials: Burl's fur keys, shifted lighter. Optional final cub tones (NEEDS MAIN, docs/lanes/pc-b1.md NUB-D1):
  // fur_bear_cub (#8c6446 soft mid brown, less red than fur_roe) + fur_bear_cub_light (#b89474 fluffy tips) switch on
  // by themselves once BOTH palette.js and detail-pass.js define them.
  var PM = A.palette && A.palette.materials, DM = A.detailPass && A.detailPass.materials;
  var FINAL = ['fur_bear_cub', 'fur_bear_cub_light'].every(function (k) { return PM && PM[k] && DM && DM[k]; });
  var mats = {
    B: FINAL ? 'fur_bear_cub' : 'fur_roe',          // base coat: lighter, warmer than Burl's skin_shade
    b: FINAL ? 'fur_bear_cub_light' : 'skin',       // pale fluffy guard-hair tips, dome, cheek ruffs, chin
    F: 'fur_roe_light',                             // light warm strands
    K: 'skin_shade',                                // soft dorsal line + partings (Burl's base tone, not his dark ridge)
    S: 'skin_deep',                                 // belly shadow, lower flanks, toe pads
    P: 'fur_cream',                                 // natal collar
    M: 'skin_light',                                // snout (tan)
    D: 'hair_dark',                                 // lower legs, paws, inner ears, lips
    C: 'linen_dark',                                // claws
    N: 'iron_dark',                                 // nose
    E: 'iron_dark',                                 // eyes
    R: 'gore_red_dark', T: 'gore_red', W: 'linen_light'
  };

  A.models.bearCub = {
    name: 'bearCub',
    displayName: 'bear cub',
    desc: 'NUB-D1 Nub, Burl\'s cub: a realistic first-summer brown bear cub on all fours (0.5 m at the shoulders, 0.8 m ' +
          'nose to tail, ~half of Burl), Burl\'s 8-part rig re-proportioned: big round head with a short snout, wide-set ' +
          'eyes and big round ears, round barrel trunk with no hump, short thick legs on big paws; fluffy lighter brown ' +
          'coat with pale tips, soft dorsal line, cheek tufts, faint natal collar, dark legs. Clips idle, walk, trot, ' +
          'sniff, lookUp, stuckWiggle, lieDown, lie, getUp (no dialogue clips).',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [14, 17, 0],
      light: false,
      mats: mats,
      layers: layers,
      parts: parts,
      animations: animations,
      mounts: {
        eyes:  { at: [14, 4, 16.5], part: 'head' },     // look-at between the eyes
        mouth: { at: [14, 0.5, 10.5], part: 'head' },   // squeak / breath puff origin
        nose:  { at: [14, 0, 13], part: 'head' },       // sniff dust / scent puff
        hit:   { at: [14, 20, 13], part: 'body' },      // trunk centre (0.33 m)
        tag:   { at: [14, 7, 25], part: 'head' }        // name tag (over the ears)
      }
    }
  };

  A.bearCubFx = {
    version: 1,
    model: 'bearCub',
    character: 'Nub',
    story: 'NUB-D1 (model); placement + behaviour = a later story',
    finalMats: FINAL,
    clipFor: {
      state: { idle: 'idle', wander: 'walk', move: 'walk', follow: 'trot', run: 'trot', sniff: 'sniff',
               watch: 'lookUp', stuck: 'stuckWiggle', lieDown: 'lieDown', rest: 'lie', getUp: 'getUp' },
      note: 'rest = play lieDown once, then lie (loop); leave rest with getUp once, then idle. No talk / listen: Nub has ' +
            'no lines. Sitting is not used (upright pose, style-guide 0.2): lie is the seated-rest replacement.'
    },
    speeds: { walk: 0.5, trot: 1.2, note: 'm/s the clips are authored for; scale the clip rate with the real speed' },
    scaleVsBurl: 0.5
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { bearCub: A.models.bearCub, bearCubFx: A.bearCubFx };
})(typeof window !== 'undefined' ? window : globalThis);
