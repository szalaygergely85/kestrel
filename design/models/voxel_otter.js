/* design/models/voxel_otter.js - SKIP, the otter of the empty fishing village (designer, SKIP-D1; owner approved the 12
 *                              new characters 2026-10-12; pitch docs/quest-roadmap.md 2b: "Otter of the empty fishing
 *                              village; teasing, restless, gives the coast errands"). Skip TALKS (quest giver), like Burl.
 *                              Binding rules: design/style-guide.md section 0 (realistic, all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4). Stand-alone, same builder family as Burl / Nub:
 *   <script src="../design/models/voxel_otter.js">    (browser)
 *   import '../design/models/voxel_otter.js';         (Node)
 * Sets ASSETS.models.otter and ASSETS.otterFx. `meshOnly: true`. NOT placed in the world yet (later story).
 *
 * A realistic Eurasian river otter (Lutra lutra), cellM 0.02, grid 18 x 56 x 16:
 *   - 1.12 m nose to tail tip (head + body 0.70 m, tail 0.42 m), 0.25 m at the shoulders, 0.28 m at the arched hips.
 *   - LONG LOW BODY: an 8-cell (16 cm) round tube, belly only 8 cm off the ground, short legs set wide at its sides.
 *   - THICK TAPERING TAIL: 12 cm wide at the root (as thick as the hips), flatter than tall, tapering to a 4 cm tip that
 *     is carried low, 4 cm above the ground.
 *   - FLAT HEAD: broad and flat-topped (12 cm skull, 16 cm across the cheeks), broad whisker pads with pale whiskers
 *     poking out, a wide dark nose, small dark eyes set high and forward, small round ears low on the sides of the crown.
 *   - WEBBED PAWS: dark toes with skin-toned webbing between them, tiny pale claws; big hind paddles (12 cm), smaller
 *     front paws (8 cm).
 *   - COAT: dark brown (hair_brown) with a darker dorsal line, dark legs, tail top and crown, sparse lighter sheen
 *     strands; PALE CREAM THROAT, chin, upper lip and chest bib (fur_cream), buff edge (fur_agouti_light).
 * Axes as Burl (15.1): x = east (= Skip's right), y = SOUTH with y0 = the nose (faces north at yaw 0), z = up. Anchor
 * [9, 22, 0] = between the four paws. Clip `pos` values are VOXELS (0.02 m).
 *
 * Parts (8 = MAX_VOX_PARTS; first-box-wins ownership, every parent earlier, each box sx+sy+sz <= 48). The ears are
 * 2-voxel nubs and ride on the head (no ears part); the 8th slot is the TAIL (flicks, curls):
 *   body [5,11,4, 13,35,16]  pivot [9, 22, 9]     root: trunk + throat bib. rx + = nose down (- = front up).
 *   head [5,0,8, 13,11,15]   pivot [9, 10, 10]    skull, nose, whisker pads, eyes, ears, neck top. rx - = nose up,
 *                                                  rz - = looks left (west), ry = tilt.
 *   jaw  [5,0,4, 13,11,8]    pivot [9, 7, 8]      lower jaw + chin + throat; OPEN = rx +, 0 .. JAW_MAX (dialogue sync).
 *   tail [5,35,0, 13,56,14]  pivot [9, 35, 10]    rx + = tip up, rz = side flick.
 *   armL / armR [1|12,11,0, 6|17,19,12] pivot [3.5|14.5, 14.5, 9]; legL / legR [0|12,24,0, 6|18,35,14]
 *                            pivot [3.5|14.5, 29.5, 10]. rx - = paw forward.
 *
 * Clips (ms, multiples of 50; every clip on FOUR LEGS, style-guide 0.2: Skip may lift his head and front a little
 * (body rx >= -5), never stands up). Every limb is GROUND-SNAPPED per key (pos z solved from its own voxels so the
 * lowest corner sits on z = 0 for that key's body pitch / drop; `lift` = clearance of a stepping paw); limbs plumb.
 *   idle     loop 3.0 s  RESTLESS: head snaps left / right, tail flicks, peers up with the front lifted, quick sniff.
 *   walk     loop 0.6 s  diagonal pairs, low head, tail sways. ~0.4 m/s.
 *   lope     loop 0.5 s  the otter BOUND: fronts reach, land, hinds swing forward under the body, push (back arches
 *                        with the body pitch); always two paws down. ~1.2 m/s.
 *   sniff    loop 2.0 s  nose down, sweeping side to side, jaw twitches.
 *   groom    loop 2.4 s  head turned back to the left shoulder, nibbling (jaw), body + tail curl that way.
 *   talk     loop 1.6 s  head raised 18 deg, front up 4 deg, 12 keys: jaw 0/14/4/9/2/20/6/12/0/7/15/3 (Burl's rhythm),
 *                        key 8 = closed pause; cheeky head tilts and tail twitches.
 *   listen   loop 2.4 s  head raised + tilted, tail flicking (restless), a nod, tilts the other way.
 *   laugh    once 1.4 s  CHATTERING BOB: fast jaw chops (50-100 ms), head bobbing up / down, shoulders bounce on
 *                        planted paws, tail flicks; settles at the listen head height.
 *   toss     once 0.8 s  GREETING (the wave equivalent): dip, a quick head toss up and to the side, follow-through.
 *   lieDown  once 0.8 s  belly down: fronts reach forward, hinds stretch back.
 *   lie      loop 3.0 s  flat on the belly, front paws forward, hind legs stretched back, tail flat; breathing, looks.
 *   getUp    once 0.5 s  back to the rest stance.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 18, SY = 56, SZ = 16, CELL = 0.02;
  function hsh(a, b, c) {                     // same deterministic hash as voxel_bear.js
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }

  // ---- voxel grid + rounded-slice helpers (same as voxel_bear_cub.js) ----
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

  // ---- trunk: one rounded slice per y [x0, x1, z0, z1, r] (half-open). Round 8-wide tube, belly z4, shoulders top
  // z12, lumbar arch top z13, narrowing into the tail root.
  var PROF = { 11: [6, 12, 5, 13, 3], 12: [6, 12, 5, 13, 3], 31: [5, 13, 5, 14, 4], 32: [5, 13, 5, 14, 4],
               33: [6, 12, 6, 14, 3], 34: [6, 12, 7, 13, 3] };
  for (y = 13; y <= 24; y++) PROF[y] = [5, 13, 4, 13, 4];
  for (y = 25; y <= 30; y++) PROF[y] = [5, 13, 4, 14, 4];
  // coat: P pale throat / chest bib, Q buff edge, F lighter belly + sheen strands, K dark dorsal line, B base
  function bodyMat(px, py, pz) {
    var p = PROF[py], dTop = p[3] - 1 - pz, dx = Math.abs(px - 8.5), c = hsh(px >> 1, py >> 1, pz >> 1);
    if (py <= 15 && pz <= p[2] + 2) return 'P';
    if (py <= 17 && pz <= p[2] + 3) return 'Q';
    if (pz <= p[2]) return 'F';
    if (dTop <= 0 && dx <= 1.5) return 'K';
    if (dTop <= 1) return c < 35 ? 'K' : 'B';
    if (c < 12) return 'F';
    if (c < 22) return 'K';
    return 'B';
  }
  for (y = 11; y <= 34; y++) rect('y', y, PROF[y][0], PROF[y][1], PROF[y][2], PROF[y][3], PROF[y][4], bodyMat);

  // ---- tail (tail part): 21 slices y35..55, tapering 6 -> 2 wide, 6 -> 2 tall, sloping down to a tip 4 cm up ----
  for (y = 35; y <= 55; y++) {
    var t = (y - 35) / 20, hw = Math.max(1, Math.round(3 - 2 * t)), hh = Math.max(1, Math.round(3 - 2 * t));
    var tz0 = Math.round(10 - 7.5 * t - hh), tz1 = tz0 + 2 * hh;
    (function (z0, z1, yy) {
      rect('y', yy, 9 - hw, 9 + hw, z0, z1, Math.min(hw, hh), function (px, py, pz) {
        if (yy >= 52 || pz === z1 - 1) return 'K';                 // dark tail top + tip
        if (pz === z0) return 'F';                                 // a shade lighter underneath
        return hsh(px, py >> 1, pz) < 20 ? 'K' : 'B';
      });
    })(tz0, tz1, y);
  }

  // ---- head (head part, z >= 8): flat broad skull, whisker pads, wide nose ----
  function headMat(px, py, pz) {
    var c = hsh(px >> 1, py >> 1, pz);
    if (pz === 8) return (py >= 1 && py <= 5 && px >= 7 && px <= 10) ? 'R' : 'P';   // mouth roof / pale upper lip
    if (pz === 9 && (px <= 6 || px >= 11) && py >= 2) return 'Q';                    // buff cheek edge
    if (pz >= 12) return c < 45 ? 'K' : 'B';                                         // darker flat crown
    return c < 10 ? 'F' : 'B';
  }
  rect('y', 1, 7, 11, 8, 12, 1, headMat);                       // muzzle
  rect('y', 2, 6, 12, 8, 11, 2, headMat);                       // broad whisker pads
  for (y = 3; y <= 9; y++) rect('y', y, 6, 12, 8, 13, 2, headMat);   // flat skull
  rect('y', 10, 6, 12, 8, 13, 3, headMat);                      // neck top (joins the trunk)
  for (y = 4; y <= 7; y++) rect('y', y, 5, 13, 8, 11, 1, headMat);   // cheeks: widest part of the head
  for (x = 7; x <= 10; x++) { put(x, 0, 9, 'B'); put(x, 0, 10, 'N'); put(x, 0, 11, 'N'); }   // wide dark nose
  put(7, 1, 8, 'W'); put(10, 1, 8, 'W');                        // upper canines (seen when the jaw opens)
  putSym(5, 2, 9, 'W'); putSym(6, 1, 9, 'W'); putSym(6, 2, 10, 'W');   // pale whiskers poking out of the pads
  put(7, 3, 11, 'E'); put(10, 3, 11, 'E');                      // small dark eyes, high and forward
  putSym(6, 6, 13, 'K'); putSym(6, 7, 13, 'K');                 // small round ears, low on the crown sides

  // ---- jaw part (z5..7): pale chin + throat; mouth floor only shows when open ----
  function jawMat(px, py, pz) {
    if (pz === 7 && py === 1 && (px === 8 || px === 9)) return 'W';                 // lower incisors
    if (pz === 7 && py >= 2 && py <= 5 && (px === 8 || px === 9)) return 'T';       // tongue
    if (pz === 7 && py >= 2 && py <= 5 && (px === 7 || px === 10)) return 'R';      // mouth floor
    return 'P';
  }
  rect('y', 1, 7, 11, 6, 8, 1, jawMat);                         // chin tip
  for (y = 2; y <= 7; y++) rect('y', y, 6, 12, 5, 8, 1, jawMat);
  for (y = 8; y <= 10; y++) rect('y', y, 6, 12, 5, 8, 2, jawMat);   // throat

  // ---- limbs: short, dark, webbed ----
  function upMat(px, py, pz) { var c = hsh(px, py >> 1, pz >> 1); return pz <= 5 ? 'K' : (c < 40 ? 'K' : 'B'); }
  function toeMat(toeY) { return function (px, py) { return py === toeY ? ((px & 1) ? 'G' : 'D') : 'D'; }; }
  // front (armL, mirrored armR): 8 cm paw, 6 cm leg column, shoulder against the trunk side
  rectSym('z', 0, 2, 6, 12, 16, 2, toeMat(12));
  putSym(3, 11, 0, 'C'); putSym(4, 11, 0, 'C');                 // tiny claws
  rectSym('z', 1, 2, 6, 13, 16, 1, 'D');
  for (z = 2; z <= 4; z++) rectSym('z', z, 2, 5, 13, 16, 1, 'K');
  for (z = 5; z <= 8; z++) rectSym('z', z, 2, 5, 13, 16, 1, upMat);
  rectSym('x', 4, 12, 18, 6, 11, 2, upMat);                     // shoulder
  // hind (legL, mirrored legR): 12 cm webbed paddle, heel, thigh / haunch against the trunk side
  rectSym('z', 0, 1, 6, 26, 32, 2, toeMat(26));
  putSym(2, 25, 0, 'C'); putSym(4, 25, 0, 'C');
  rectSym('z', 1, 1, 6, 27, 32, 2, 'D');
  for (z = 2; z <= 3; z++) rectSym('z', z, 2, 5, 28, 32, 1, 'K');
  rectSym('x', 4, 26, 34, 4, 13, 3, upMat);                     // haunch
  rectSym('x', 3, 27, 33, 4, 12, 3, upMat);
  rectSym('x', 2, 28, 32, 5, 10, 2, upMat);                     // outer thigh

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  var parts = {
    body: { box: [5, 11, 4, 13, 35, 16], pivot: [9, 22, 9] },
    head: { box: [5, 0, 8, 13, 11, 15], pivot: [9, 10, 10], parent: 'body' },
    jaw:  { box: [5, 0, 4, 13, 11, 8], pivot: [9, 7, 8], parent: 'head' },
    tail: { box: [5, 35, 0, 13, 56, 14], pivot: [9, 35, 10], parent: 'body' },
    armL: { box: [1, 11, 0, 6, 19, 12], pivot: [3.5, 14.5, 9], parent: 'body' },
    armR: { box: [12, 11, 0, 17, 19, 12], pivot: [14.5, 14.5, 9], parent: 'body' },
    legL: { box: [0, 24, 0, 6, 35, 14], pivot: [3.5, 29.5, 10], parent: 'body' },
    legR: { box: [12, 24, 0, 18, 35, 14], pivot: [14.5, 29.5, 10], parent: 'body' }
  };
  var PNAMES = Object.keys(parts);
  function ownerOf(px, py, pz) {
    for (var i = 0; i < PNAMES.length; i++) {
      var b = parts[PNAMES[i]].box;
      if (px >= b[0] && px < b[3] && py >= b[1] && py < b[4] && pz >= b[2] && pz < b[5]) return PNAMES[i];
    }
    return null;
  }
  var LIMB_PART = { aL: 'armL', aR: 'armR', lL: 'legL', lR: 'legR' }, LIMB_YZ = {};
  Object.keys(LIMB_PART).forEach(function (k) {
    var pn = LIMB_PART[k], seen = {}, list = [];
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (layers[z][y].charAt(x) === '.' || ownerOf(x, y, z) !== pn || seen[y + ',' + z]) continue;
      seen[y + ',' + z] = 1; list.push([y, z]);
    }
    LIMB_YZ[k] = list;
  });

  // ---- pose: o = { b: [rx, ry, rz, px, py, pz] body, h head, j jaw, t tail, aL aR lL lR limb rot (number = rx),
  // lift { aL: cells } }. Same ground solve as voxel_bear_cub.js. ----
  var JAW_MAX = 24, D2R = Math.PI / 180, PB = parts.body.pivot;
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
    var h = v3(o.h), t = v3(o.t);
    return {
      body: { rot: [r2(b[0] || 0), r2(b[1] || 0), r2(b[2] || 0)], pos: [r2(b[3] || 0), r2(b[4] || 0), r2(b[5] || 0)] },
      head: { rot: [r2(h[0]), r2(h[1]), r2(h[2])] },
      jaw: { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      tail: { rot: [r2(t[0]), r2(t[1]), r2(t[2])] },
      armL: limb('aL'), armR: limb('aR'), legL: limb('lL'), legR: limb('lR')
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
  function mix(base, o) { var r = {}, k; for (k in base) r[k] = base[k]; for (k in o) r[k] = o[k]; return r; }
  function clip(keys, loop, base) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(base ? addO(base, keys[i][1]) : keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }

  var TALK_UP = { b: [-4, 0, 0, 0, 0, 0.3], h: [-18, 0, 0], t: [4, 0, 0] };   // head + front up toward the player
  var LISTEN = { b: [-3, 0, 0, 0, 0, 0.2], t: [3, 0, 0] };
  var LAUGH = { t: [4, 0, 0] };
  var LIE_O = { b: [0, 0, 0, 0, 0, -4], h: [-6, 0, 0], t: [7, 0, 0], aL: -70, aR: -70, lL: 70, lR: 70 };
  var GB = [0, 0, -6, 0, 0, -0.4];                               // groom: body curled to the left, a little lower
  var animations = {
    idle: clip([
      [400, {}],
      [300, { h: [-6, 0, -30], t: [0, 0, 10] }],                                 // snaps a look left
      [250, { h: [-8, 0, -34] }],
      [200, { h: [-10, 0, 25], t: [0, 0, -8] }],                                 // ... and right
      [300, { h: [-10, 4, 28], b: [0, 0, 0, 0, 0, 0.3] }],
      [150, { h: [-2, 0, 0], t: [6, 0, 18] }],                                   // tail flick
      [150, { t: [2, 0, -14] }],
      [300, { h: [-14, 0, -8], b: [-2, 0, 0, 0, 0, 0] }],                        // front up, peers
      [550, { h: [-16, 0, -6], b: [-2, 0, 0, 0, 0, 0.3] }],
      [400, { h: [4, 0, 0], j: 3 }]                                              // quick sniff
    ], true),
    // GAIT-A BEGIN walk (tools/gen-gait.mjs: option A, lateral gait, duty 0.7, tuned 0.4 m/s, 12 keys x 50 ms; re-run, do not hand-edit)
    walk: { durations: [50,50,50,50,50,50,50,50,50,50,50,50], loop: true, frames: [
        { body: { rot: [0.847,1.902,0], pos: [0,0,0.107] }, head: { rot: [0.028,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [2.104,0,4.66], pos: [0,0,0] }, armL: { rot: [23.424,0,0], pos: [0,0,0.759] }, armR: { rot: [-7.662,0,0], pos: [0,0,0.296] }, legL: { rot: [-24.835,0,0], pos: [0,0,-0.253] }, legR: { rot: [10.37,0,0], pos: [0,0,0.644] } },
        { body: { rot: [1.496,1.338,1.25], pos: [0,0,0.2] }, head: { rot: [0.05,0,-1], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [2.222,0,4.942], pos: [0,0,0] }, armL: { rot: [4.442,0,0], pos: [0,0,0.77] }, armR: { rot: [-1.273,0,0], pos: [0,0,0.135] }, legL: { rot: [-18.663,0,0], pos: [0,0,-0.234] }, legR: { rot: [16.26,0,0], pos: [0,0,0.627] } },
        { body: { rot: [0.649,0.416,2.165], pos: [0,0,0.093] }, head: { rot: [0.022,0,-1.732], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [0.118,0,3.899], pos: [0,0,0] }, armL: { rot: [-16.895,0,0], pos: [0,0,0.472] }, armR: { rot: [5.1,0,0], pos: [0,0,0.337] }, legL: { rot: [-12.709,0,0], pos: [0,0,0.084] }, legR: { rot: [22.334,0,0], pos: [0,0,0.825] } },
        { body: { rot: [-0.847,-0.618,2.5], pos: [0,0,-0.107] }, head: { rot: [-0.028,0,-2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [-2.104,0,1.812], pos: [0,0,0] }, armL: { rot: [-27.818,0,0], pos: [0,0,-0.328] }, armR: { rot: [11.537,0,0], pos: [0,0,0.43] }, legL: { rot: [-6.892,0,0], pos: [0,0,0.523] }, legR: { rot: [20.964,0,0], pos: [0,0,1.396] } },
        { body: { rot: [-1.496,-1.486,2.165], pos: [0,0,-0.2] }, head: { rot: [-0.05,0,-1.732], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [-2.222,0,-0.761], pos: [0,0,0] }, armL: { rot: [-20.827,0,0], pos: [0,0,0.039] }, armR: { rot: [18.126,0,0], pos: [0,0,0.484] }, legL: { rot: [-1.146,0,0], pos: [0,0,0.64] }, legR: { rot: [3.997,0,0], pos: [0,0,1.029] } },
        { body: { rot: [-0.649,-1.956,1.25], pos: [0,0,-0.093] }, head: { rot: [-0.022,0,-1], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [-0.118,0,-3.13], pos: [0,0,0] }, armL: { rot: [-14.149,0,0], pos: [0,0,0.275] }, armR: { rot: [24.975,0,0], pos: [0,0,0.457] }, legL: { rot: [4.589,0,0], pos: [0,0,0.646] }, legR: { rot: [-15.163,0,0], pos: [0,0,0.747] } },
        { body: { rot: [0.847,-1.902,0], pos: [0,0,0.107] }, head: { rot: [0.028,0,0], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [2.104,0,-4.66], pos: [0,0,0] }, armL: { rot: [-7.662,0,0], pos: [0,0,0.296] }, armR: { rot: [23.424,0,0], pos: [0,0,0.759] }, legL: { rot: [10.37,0,0], pos: [0,0,0.644] }, legR: { rot: [-24.835,0,0], pos: [0,0,-0.253] } },
        { body: { rot: [1.496,-1.338,-1.25], pos: [0,0,0.2] }, head: { rot: [0.05,0,1], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [2.222,0,-4.942], pos: [0,0,0] }, armL: { rot: [-1.273,0,0], pos: [0,0,0.135] }, armR: { rot: [4.442,0,0], pos: [0,0,0.77] }, legL: { rot: [16.26,0,0], pos: [0,0,0.627] }, legR: { rot: [-18.663,0,0], pos: [0,0,-0.234] } },
        { body: { rot: [0.649,-0.416,-2.165], pos: [0,0,0.093] }, head: { rot: [0.022,0,1.732], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [0.118,0,-3.899], pos: [0,0,0] }, armL: { rot: [5.1,0,0], pos: [0,0,0.337] }, armR: { rot: [-16.895,0,0], pos: [0,0,0.472] }, legL: { rot: [22.334,0,0], pos: [0,0,0.825] }, legR: { rot: [-12.709,0,0], pos: [0,0,0.084] } },
        { body: { rot: [-0.847,0.618,-2.5], pos: [0,0,-0.107] }, head: { rot: [-0.028,0,2], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [-2.104,0,-1.812], pos: [0,0,0] }, armL: { rot: [11.537,0,0], pos: [0,0,0.43] }, armR: { rot: [-27.818,0,0], pos: [0,0,-0.328] }, legL: { rot: [20.964,0,0], pos: [0,0,1.396] }, legR: { rot: [-6.892,0,0], pos: [0,0,0.523] } },
        { body: { rot: [-1.496,1.486,-2.165], pos: [0,0,-0.2] }, head: { rot: [-0.05,0,1.732], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [-2.222,0,0.761], pos: [0,0,0] }, armL: { rot: [18.126,0,0], pos: [0,0,0.484] }, armR: { rot: [-20.827,0,0], pos: [0,0,0.039] }, legL: { rot: [3.997,0,0], pos: [0,0,1.029] }, legR: { rot: [-1.146,0,0], pos: [0,0,0.64] } },
        { body: { rot: [-0.649,1.956,-1.25], pos: [0,0,-0.093] }, head: { rot: [-0.022,0,1], pos: [0,0,0] }, jaw: { rot: [0,0,0], pos: [0,0,0] }, tail: { rot: [-0.118,0,3.13], pos: [0,0,0] }, armL: { rot: [24.975,0,0], pos: [0,0,0.457] }, armR: { rot: [-14.149,0,0], pos: [0,0,0.275] }, legL: { rot: [-15.163,0,0], pos: [0,0,0.747] }, legR: { rot: [4.589,0,0], pos: [0,0,0.646] } }
    ] },
    // GAIT-A END walk
    lope: clip([
      [100, { b: [3, 0, 0, 0, 0, 0.8], h: [-2, 0, 0], t: [-2, 0, 0], aL: -30, aR: -26, lL: 22, lR: 20, lift: { aL: 2, aR: 1.6 } }],  // fronts reach, hinds push
      [150, { b: [5, 0, 0, 0, 0, 0.4], h: [6, 0, 0], t: [-2, 0, 0], aL: -6, aR: -10, lL: 28, lR: 26, lift: { lL: 1.6, lR: 1.4 } }],  // fronts land
      [150, { b: [-3, 0, 0, 0, 0, 1.0], h: [4, 0, 0], t: [6, 0, 0], aL: 14, aR: 12, lL: -14, lR: -18, lift: { lL: 2.2, lR: 2 } }],   // hinds swing under
      [100, { b: [-4, 0, 0, 0, 0, 0.6], h: [-2, 0, 0], t: [6, 0, 0], aL: 22, aR: 20, lL: -24, lR: -22, lift: { aL: 1.2, aR: 1 } }]   // hinds land, fronts lift
    ], true),
    sniff: clip([
      [300, { b: [3, 0, 0, 0, 0, -0.6], h: [18, 0, -6] }],
      [200, { b: [3, 0, 0, 0, 0, -0.6], h: [20, 0, -10], j: 2 }],
      [200, { b: [3, 0, 0, 0, 0, -0.6], h: [19, 0, -4] }],
      [200, { b: [3, 0, 1, 0, 0, -0.6], h: [20, 0, 4], j: 3 }],
      [250, { b: [3, 0, 2, 0, 0, -0.6], h: [20, 0, 10], j: 2, t: [0, 0, 8] }],
      [300, { b: [2, 0, 0, 0, 0, -0.3], h: [8, 0, 6], t: [4, 0, -6] }],              // lifts a little, tail flick
      [300, { b: [3, 0, -1, 0, 0, -0.6], h: [20, 0, -2], j: 3 }],
      [250, { b: [3, 0, 0, 0, 0, -0.6], h: [18, 0, -6] }]
    ], true),
    groom: clip([
      [300, { b: GB, h: [14, -10, -70], t: [0, 0, -20] }],
      [200, { b: GB, h: [16, -10, -74], t: [0, 0, -20], j: 8 }],                     // nibble
      [150, { b: GB, h: [15, -10, -72], t: [0, 0, -20], j: 2 }],
      [200, { b: GB, h: [18, -12, -76], t: [0, 0, -22], j: 9 }],
      [150, { b: GB, h: [16, -10, -72], t: [0, 0, -20], j: 1 }],
      [300, { b: [0, 0, -4, 0, 0, -0.4], h: [6, -6, -50], t: [2, 0, -12] }],         // pause, glances up
      [200, { b: GB, h: [18, -12, -78], t: [0, 0, -22], j: 7 }],
      [150, { b: GB, h: [16, -10, -74], t: [0, 0, -22], j: 2 }],
      [200, { b: GB, h: [18, -12, -76], t: [0, 0, -22], j: 10 }],
      [250, { b: GB, h: [14, -10, -70], t: [0, 0, -20], j: 3 }],
      [300, { b: GB, h: [12, -8, -66], t: [0, 0, -18] }]
    ], true),
    // jaw sizes small (2-7) / mid (9-12) / wide (14-20), 100-150 ms syllables, key 8 = closed pause (otterFx.talk)
    talk: clip([
      [100, {}],
      [150, { j: 14, h: [-3, 0, 3], b: [0, 0, 0, 0, 0, 0.15] }],
      [100, { j: 4, h: [-1, 4, 3], t: [0, 0, 6] }],
      [100, { j: 9, h: [2, 4, 4] }],
      [100, { j: 2, h: [3, 0, 2] }],
      [150, { j: 20, h: [-5, -4, 0], b: [0, 0, 0, 0, 0, 0.3], t: [2, 0, -8] }],
      [150, { j: 6, h: [4, -6, -3], b: [0, 0, 0, 0, 0, -0.15] }],
      [100, { j: 12, h: [1, -4, -4] }],
      [250, { j: 0, h: [0, 8, -6], t: [0, 0, 10] }],                                 // pause: cheeky head tilt
      [100, { j: 7, h: [-1, 6, -3] }],
      [150, { j: 15, h: [-3, 0, 0], b: [0, 0, 0, 0, 0, 0.15], t: [2, 0, -6] }],
      [150, { j: 3, h: [2, 0, 0] }]
    ], true, TALK_UP),
    listen: clip([
      [600, { h: [-16, 12, 6], t: [0, 0, 6] }],
      [500, { h: [-17, 13, 6], t: [0, 0, -4], b: [0, 0, 0, 0, 0, 0.2] }],
      [200, { h: [-16, 12, 6], t: [4, 0, 14] }],                                     // tail flick
      [250, { h: [-8, 10, 4], t: [0, 0, -6] }],                                      // nod
      [450, { h: [-16, -8, -6], t: [0, 0, 4] }],                                     // tilts the other way
      [400, { h: [-17, -9, -6], t: [0, 0, 0] }]
    ], true, LISTEN),
    // chattering bob: fast jaw chops, head bobbing, shoulders bounce on planted paws; ends at the listen head height
    laugh: clip([
      [100, { b: [-2, 0, 0, 0, 0, -0.3], h: [-10, 0, 0], j: 4 }],
      [100, { b: [-4, 0, 0, 0, 0, 0.5], h: [-24, 0, 0], j: 18 }],
      [50, { b: [-4, 0, 0, 0, 0, 0.1], h: [-16, 0, 2], j: 4 }],
      [100, { b: [-4, 0, 0, 0, 0, 0.5], h: [-26, 0, -2], j: 20 }],
      [50, { b: [-4, 0, 0, 0, 0, 0.1], h: [-16, 0, 2], j: 3 }],
      [100, { b: [-4, 0, 0, 0, 0, 0.5], h: [-24, 0, 3], j: 16 }],
      [50, { b: [-4, 0, 0, 0, 0, 0.1], h: [-15, 0, 0], j: 4 }],
      [100, { b: [-4, 0, 0, 0, 0, 0.5], h: [-25, 0, -3], j: 18, t: [2, 0, 12] }],
      [50, { b: [-4, 0, 0, 0, 0, 0.1], h: [-16, 0, 0], j: 3, t: [0, 0, -10] }],
      [100, { b: [-3, 0, 0, 0, 0, 0.4], h: [-22, 0, 0], j: 14, t: [0, 0, 10] }],
      [150, { b: [-3, 0, 0, 0, 0, 0], h: [-18, 0, 0], j: 6 }],
      [450, { b: [-3, 0, 0, 0, 0, 0.2], h: [-16, 0, 0], j: 0 }]
    ], false, LAUGH),
    // greeting: dip, quick head toss up + to the side, follow-through, settle
    toss: clip([
      [100, { h: [6, 0, 0], b: [0, 0, 0, 0, 0, -0.3] }],
      [100, { h: [-38, 0, -10], b: [-3, 0, 0, 0, 0, 0.4], j: 6, t: [8, 0, 0] }],
      [100, { h: [-30, -8, -16], b: [-3, 0, 0, 0, 0, 0.3], j: 3, t: [6, 0, 14] }],
      [200, { h: [-14, 0, -4], b: [-1, 0, 0, 0, 0, 0], t: [2, 0, -8] }],
      [300, {}]
    ], false),
    lieDown: clip([
      [150, { b: [0, 0, 0, 0, 0, -0.4], h: [4, 0, 0] }],
      [250, { b: [2, 0, 0, 0, 0, -2], h: [2, 0, 0], aL: -35, aR: -35, lL: 30, lR: 30, t: [3, 0, 0] }],
      [400, LIE_O]
    ], false),
    lie: clip([
      [900, LIE_O],
      [700, mix(LIE_O, { b: [0, 0, 0, 0, 0, -3.8] })],                               // breath
      [600, mix(LIE_O, { h: [-12, 4, -20] })],                                       // looks left
      [800, mix(LIE_O, { h: [-10, -3, 16], t: [7, 0, 10] })]                         // looks right, tail sweep
    ], true),
    getUp: clip([
      [200, { b: [-3, 0, 0, 0, 0, -2], h: [-4, 0, 0], aL: -30, aR: -30, lL: 35, lR: 35, t: [8, 0, 0] }],
      [300, {}]
    ], false)
  };

  // materials: only already-merged palette keys (CHARGEN hair_brown ramp + EP-WILD furs). If a CHARGEN key is missing
  // from palette.js or detail-pass.js the fallback keeps the model valid.
  var PM = A.palette && A.palette.materials, DM = A.detailPass && A.detailPass.materials;
  function pick(k, fb) { return (!PM || !DM || (PM[k] && DM[k])) ? k : fb; }
  var mats = {
    B: pick('hair_brown', 'skin_shade'),         // dark brown coat (#6a4a30)
    K: pick('hair_brown_dark', 'hair_dark'),     // dorsal line, crown, legs, tail top (#45301f)
    F: pick('hair_brown_light', 'fur_roe'),      // belly + sparse sheen strands (#8a6646)
    P: 'fur_cream',                              // pale throat, chin, upper lip, chest bib
    Q: 'fur_agouti_light',                       // buff edge of the pale bib / cheeks
    D: 'hair_dark',                              // paws + toes
    G: 'skin_deep',                              // webbing between the toes
    C: 'linen_dark',                             // claws
    N: 'iron_dark',                              // nose
    E: 'iron_dark',                              // eyes
    W: 'linen_light',                            // whiskers + teeth
    R: 'gore_red_dark', T: 'gore_red'            // mouth, tongue
  };

  A.models.otter = {
    name: 'otter',
    displayName: 'river otter',
    desc: 'SKIP-D1 Skip, the otter of the empty fishing village: a realistic Eurasian river otter on all fours (1.12 m ' +
          'nose to tail tip, 0.25 m at the shoulders): long low round body, thick tapering tail carried low, flat broad ' +
          'head with whisker pads and pale whiskers, wide dark nose, small high eyes, small round ears, short dark legs ' +
          'on webbed paws; dark brown coat with a pale cream throat and chest bib. Talks with head, jaw and tail. Clips ' +
          'idle, walk, lope, sniff, groom, talk, listen, laugh, toss, lieDown, lie, getUp.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CELL,
      size: [SX, SY, SZ],
      anchor: [9, 22, 0],
      light: false,
      mats: mats,
      layers: layers,
      parts: parts,
      animations: animations,
      mounts: {
        speech:   { at: [9, 6, 17], part: 'head' },     // speech bubble / name tag anchor (~8 cm over the crown)
        eyes:     { at: [9, 3, 11.5], part: 'head' },   // dialogue camera look-at (between the eyes)
        mouth:    { at: [9, 0.5, 8.5], part: 'head' },  // voice / breath puff origin
        nose:     { at: [9, 0, 10.5], part: 'head' },   // sniff puff
        interact: { at: [9, 14, 10], part: 'body' },    // [E] Talk prompt aim (chest, 0.2 m)
        tailTip:  { at: [9, 55.5, 3], part: 'tail' }    // tail-flick splash / drip later
      }
    }
  };

  A.otterFx = {
    version: 1,
    model: 'otter',
    character: 'Skip',
    story: 'SKIP-D1 (model); placement + dialogue wiring = a later story',
    clipFor: {
      state: { idle: 'idle', greet: 'toss', talk: 'talk', listen: 'listen', laugh: 'laugh', move: 'walk', run: 'lope',
               sniff: 'sniff', groom: 'groom', lieDown: 'lieDown', rest: 'lie', getUp: 'getUp' },
      once: { toss: 'idle', laugh: 'listen', lieDown: 'lie', getUp: 'idle' },
      move: { start: 'walk', loop: 'walk', stop: 'idle' },
      note: 'Same contract as bearFx: once = non-loop clips and what follows them at animEnd. greet = toss (a quick ' +
            'head toss; an otter does not wave). Every clip is on four legs (style-guide 0.2). rest = lieDown once, ' +
            'then lie; leave rest with getUp.'
    },
    talk: {
      jawPart: 'jaw', jawAxis: 'rx', jawOpenSign: 1, jawMaxDeg: JAW_MAX, jawPivot: [9, 7, 8],
      textCps: 32,                                   // Skip talks a little faster than Burl (28)
      pauseMs: { ',': 160, ';': 160, ':': 160, '-': 160, '.': 340, '!': 340, '?': 340 },
      pauseKey: 8, pauseAtMs: 950,                   // talk key 8 = jaw closed; its start = 950 ms into the clip
      rule: 'as bearFx.talk: play `talk` while the line types on; on a punctuation pause hold at pauseAtMs (jaw ' +
            'closed) for pauseMs, then resume FROM pauseAtMs. When the line is fully shown switch to `listen`. Lines ' +
            'tagged happy play `laugh` once first.'
    },
    speeds: { walk: 0.4, lope: 1.2, note: 'm/s the clips are authored for; scale the clip rate with the real speed' },
    sampleLine: { name: 'Skip', text: 'Ha! Boots on the jetty, finally. Nobody fishes here now - so you will. Quick, ' +
                  'before the tide turns!', note: 'placeholder text for the preview; the writer owns the real lines' },
    scaleVsBurl: 0.68
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { otter: A.models.otter, otterFx: A.otterFx };
})(typeof window !== 'undefined' ? window : globalThis);
