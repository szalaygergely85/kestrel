/* design/models/voxel_crocodile.js - the RIVER CROCODILE (designer, BEAST-D1 first animal; docs/epics/ep-bestiary.md row 11:
 *                                    water ambush, lunge 4 m from the water, grab, slow on land). content/beasts/kinds.json
 *                                    "river_crocodile" uses model id `crocodile`. Binding rules: design/style-guide.md
 *                                    section 0 (realistic shapes from voxels, animals on all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4), stand-alone (clones nothing), same loading convention as
 * design/models/voxel_bear.js:
 *   <script src="../design/models/voxel_crocodile.js">   (browser, after palette.js + detail-pass.js)
 *   import '../design/models/voxel_crocodile.js';        (Node tests: side-effect import, after palette + detail-pass)
 * Sets ASSETS.models.crocodile and ASSETS.crocFx. `meshOnly: true` (14 parts > 8). Only already-merged palette materials.
 *
 * Axes (15.1): x = east (= the croc's RIGHT at yaw 0), y = SOUTH with y0 = the snout tip (faces north at yaw 0), z = up.
 * cellM 0.05. Grid 22 x 58 x 10 (2.9 m nose to tail tip, 0.5 m wide trunk, back 0.35 m, eyes 0.33 m). Anchor [11, 23, 0]
 * = mid trunk between the four feet. Centre line x = 11.0 (cells 10 | 11). Clip `pos` values are VOXELS.
 *
 * Anatomy (realistic, from squares): long flat SNOUT that widens to the jaw hinge, a small notch behind the nostrils
 * where the big 4th lower tooth sits, raised nostril knob, bulging EYES on top with dark lids, a flat skull table and
 * post-occipital scutes; a thick neck with the NUCHAL plate (4 raised scutes); a broad, low trunk (rounded section, flat
 * pale belly) with rows of keeled dorsal OSTEODERMS; a long, laterally flattened TAIL (half the length) with a double
 * crest that merges into one row; short SPRAWLING legs (upper limb out sideways, lower limb down): 5-toed hands, long
 * 4-toed webbed hind feet pointing forward, dark claws. Interlocking teeth show along the closed mouth line.
 * Colour: dark olive-brown hide (B), near-black scute seams, crests and tail bands (K), olive-tan mottles and lit keels
 * (O), yellow-olive lower flanks and lips (Y), cream belly (P) with seams (S), a few green algae flecks on the back (G),
 * yellow eyes (E), dark nostrils + claws (N), pale teeth (W), pale yellow mouth lining (R), pink-brown tongue (T).
 *
 * Parts (14 <= MAX_VOX_PARTS 16; insertion order = part index; every parent is EARLIER; boxes claim voxels in order):
 *   body   box [6,11,0, 16,31,10]  pivot [11, 22, 3.5]  root: neck, trunk, belly. rx + = nose down, ry + = roll top to
 *                                  the right, rz + = turn right.
 *   head   box [6,0,3, 16,11,10]   pivot [11, 11, 4]    skull + upper jaw (z >= 3). rx - = nose up, rz + = look right.
 *   jaw    box [6,0,0, 16,11,3]    pivot [11, 11, 3]    lower jaw (z < 3), parent head. OPEN = rx + (0 .. JAW_MAX 40).
 *   tail1 / tail2 / tail3  boxes y31-39 / 40-48 / 49-57 (x 6..15), pivots [11,31,4] / [11,40,3.5] / [11,49,3], chained.
 *                                  rz + = tip swings to the croc's LEFT, rx + = tip up.
 *   armL / armR   upper fore limbs (shoulder pivot [6|16, 16, 4.5]), legL / legR upper hind limbs (hip [6|16, 29, 4.5]);
 *   armL2 .. legR2 lower limbs (D-101 knee rig: `<upper>2`, parent = upper, pivot = elbow / knee). Elbows point BACK
 *                                  (bend 'back'), hind knees point FORWARD (bend 'front'), from the rest pose.
 *   Legs rotate in the y-z plane (rx - = foot forward). Swim tucks them with ry / rz (free legs, no leg solve).
 *
 * Clips (ms, multiples of 50; ALL on four legs or swimming; feet planted by an in-file 2-bone solve = the engine's
 * 38.67 maths, so knees bend when the body sinks / lunges):
 *   idle     loop 6.0 s   7 keys: basking low (belly on the ground), slow breath, the GAPE (head lifts, lower jaw stays
 *                         on the ground), held, closes, tail flick + head turn.
 *   walk     loop 1.0 s   10 keys: LOW BELLY CRAWL, lateral sequence (LH LF RH RF), duty 0.7, tuned 0.4 m/s, trunk yaw
 *                         + tail S-wave. Generated from GAIT.walk (= legRig.gaits.walk).
 *   run      loop 0.3 s   6 keys: short BURST, diagonal couplets, duty 0.5, tuned 1.9 m/s, bigger yaw / tail swing.
 *   swim     loop 1.2 s   8 keys: TAIL-DRIVEN S-wave (tail 10 / 18 / 26 deg, lagging), legs tucked back along the
 *                         flanks, trunk + head counter-yaw a little. Not in legRig (no leg solve in water).
 *   attack   once 0.6 s   5 keys: LUNGE + JAW SNAP: coil (0), launch with jaws widest (100 ms), SNAP shut at 200 ms
 *                         (key 2), tug / twist (300), pull back (450). crocFx.lunge.
 *   grab     loop 1.0 s   4 keys: jaws held SHUT, small body roll +-6 deg and head tug (D-088 movement-only pin).
 *   recover  once 0.4 s   3 keys: settles back to rest after attack / grab.
 *   hurt     once 0.1 s   2 step keys: recoil, head up, jaws pop.   hitAdd once 0.25 s: ADDITIVE hit (frame 0 = rest).
 *   flinch   once 0.25 s  3 keys: stagger / block recoil -> rest.
 *   die      once 0.6 s   5 keys: jaws gape + tail lash, ROLLS ONTO ITS BACK (thud key 3 at 300 ms), settles.
 *   dead     held         belly up, legs limp in the air.   sink once 0.6 s [500, 100]: dead pose lowered 0.6 m.
 *   blend    locomotion walk @ 0.4 -> run @ 1.9 m/s (= legRig tunedMps), attack snaps in (60 ms), leaving attack / grab
 *            >= 200 ms, land <-> swim 300 ms, additive `hit` on body / head / jaw / tail1.
 *   Presentation data: ASSETS.crocFx (clipFor state map, lunge / grab timing, death, water notes).
 *
 * Materials TODAY: only merged keys. B block_dark, K waystone_dark, O canvas_dark are interim; the FINAL olive set switches
 * on by itself once palette.js AND detail-pass.js both define scale_croc, scale_croc_dark, scale_croc_light (NEEDS MAIN,
 * proposed colours in design/README.md section 31). Nothing else to edit here.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 22, SY = 58, SZ = 10, CM = 0.05, CX = 11;
  var JAW_MAX = 40, D2R = Math.PI / 180;
  var ALGAE = 8;                 // % of back clumps with green algae flecks (0 = none)

  function hsh(a, b, c) {        // same deterministic hash as voxel_bear.js (no Math.random: every build identical)
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }
  function rd(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function v3(a) { return a == null ? [0, 0, 0] : typeof a === 'number' ? [rd(a), 0, 0] : [rd(a[0] || 0), rd(a[1] || 0), rd(a[2] || 0)]; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function mix() { var o = {}; for (var i = 0; i < arguments.length; i++) { var s = arguments[i]; for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k]; } return o; }

  // ---- voxel grid G[z][y][x] ----
  var G = [], x, y, z, i;
  for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
  function put(px, py, pz, ch) { if (px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ) G[pz][py][px] = ch; }
  function putSym(px, py, pz, ch) { put(px, py, pz, ch); put(SX - 1 - px, py, pz, ch); }   // the croc's left + mirrored right
  // one cross-section at y = py: layer z0 + li is `widths[li]` cells wide (even), centred on CX.
  // mat(px, py, pz, x0, x1, li, n) -> voxel char (x0 / x1 = this layer's half-open x span, n = layer count)
  function section(py, widths, z0, mat) {
    for (var li = 0; li < widths.length; li++) {
      var w = widths[li], x0 = CX - w / 2, x1 = CX + w / 2;
      for (var px = x0; px < x1; px++) put(px, py, z0 + li, mat(px, py, z0 + li, x0, x1, li, widths.length));
    }
  }
  function trunkW(w, h) {        // rounded trunk: narrower belly layer, two stepped back layers (flat back, round flanks)
    var a = [];
    for (var k = 0; k < h; k++) a.push(Math.max(2, k === h - 1 ? w - 4 : (k === 0 || k === h - 2) ? w - 2 : w));
    return a;
  }
  function tailW(w, h) {         // tail: a rounded slab, taller than wide toward the tip
    var a = [];
    for (var k = 0; k < h; k++) a.push(k === 0 || k === h - 1 ? Math.max(2, w - 2) : w);
    return a;
  }

  // ---- trunk + neck (body part): [w, zBottom, layers] per y ----
  var TRUNK = {};
  for (y = 11; y <= 13; y++) TRUNK[y] = [8, 1, 5];             // neck
  TRUNK[14] = [8, 1, 6];
  for (y = 15; y <= 29; y++) TRUNK[y] = [10, 1, 6];            // broad trunk, 0.5 m
  TRUNK[30] = [8, 1, 6];                                       // hips taper into the tail
  function hideMat(px, py, pz, x0, x1, li, n) {
    var ex = Math.min(px - x0, x1 - 1 - px), c = hsh(px >> 1, py >> 1, pz >> 1);
    if (li === 0) return (py % 3 === 0) ? 'S' : 'P';                     // cream belly scutes, seam every 3rd row
    if (li === 1) return ex === 0 && c < 55 ? 'Y' : 'P';                 // belly edge -> yellow-olive lower flank
    if (li === n - 1) {                                                  // the back: transverse osteoderm rows
      if (c < ALGAE) return 'G';
      return (py % 2 === 0) ? 'K' : (c < 30 ? 'O' : 'B');
    }
    if (li === n - 2) return ex === 0 && c < 30 ? 'O' : 'B';             // upper flank
    if (li === 2) return c < 35 ? 'O' : 'Y';                             // lower flank: yellow-olive, olive-tan mottles
    return c < 25 ? 'O' : (c < 40 ? 'K' : 'B');                          // mid flank: dark hide, mottles, dark blotches
  }
  for (y = 11; y <= 30; y++) section(y, trunkW(TRUNK[y][0], TRUNK[y][2]), TRUNK[y][1], hideMat);
  // keeled dorsal osteoderms: paramedian keels every odd row, the outer pair every 4th row (lit tips)
  for (y = 15; y <= 29; y += 2) {
    put(9, y, 7, 'K'); put(12, y, 7, 'K');
    if (y % 4 === 3) { put(8, y, 7, 'O'); put(13, y, 7, 'O'); }
  }
  // nuchal plate: 4 raised scutes behind the skull
  for (y = 12; y <= 13; y++) { put(9, y, 6, 'K'); put(10, y, 6, 'O'); put(11, y, 6, 'O'); put(12, y, 6, 'K'); }

  // ---- tail (tail1..3): tapers 8 -> 2 cells, crest rows on top (double, merging into one) ----
  function tailDims(py) {
    var w = py <= 35 ? 8 : py <= 43 ? 6 : py <= 51 ? 4 : 2, zb = py < 40 ? 1 : 2, zt = py <= 35 ? 7 : py <= 43 ? 6 : py <= 51 ? 5 : 4;
    return [w, zb, zt - zb];
  }
  function tailMat(px, py, pz, x0, x1, li, n) {
    var c = hsh(px >> 1, py >> 1, pz), band = (py - 31) % 5 < 2;          // dark crossbands, 2 of every 5 rows
    if (li === 0) return n > 2 ? ((py % 3 === 0) ? 'S' : 'P') : (band ? 'K' : 'Y');
    if (band && c < 80) return 'K';
    if (li === n - 1) return c < 30 ? 'O' : 'B';
    if (li === 1 && n > 3) return 'Y';
    return c < 30 ? 'O' : 'B';
  }
  for (y = 31; y <= 57; y++) {
    var td = tailDims(y), tw = tailW(td[0], td[2]);
    section(y, tw, td[1], tailMat);
    if (y % 2 === 1) {                                                   // crest scutes on the top layer's edges
      var top = tw[tw.length - 1], cx0 = CX - top / 2, cz = td[1] + td[2], cm = (y % 4 === 3) ? 'O' : 'K';
      put(cx0, y, cz, cm); put(cx0 + top - 1, y, cz, cm);
    }
  }

  // ---- head (z >= 3): [w, layers] per y; snout y0-6, skull y7-10 ----
  var HEAD = [[4, 2], [4, 2], [6, 2], [6, 2], [4, 2], [6, 2], [6, 3], [8, 3], [8, 3], [10, 3], [10, 3]];
  var TOOTH_U = { 1: 1, 3: 1, 5: 1, 7: 1, 9: 1 }, TOOTH_L = { 2: 1, 4: 1, 6: 1, 8: 1 };   // interlocking, alternating
  function headMat(px, py, pz, x0, x1, li, n) {
    var ex = Math.min(px - x0, x1 - 1 - px), c = hsh(px, py, pz);
    if (li === 0) return ex === 0 ? (TOOTH_U[py] ? 'W' : 'Y') : 'R';    // upper lip line + teeth, palate inside
    if (li === n - 1) return c < 22 ? 'K' : (c < 34 ? 'O' : 'B');         // rough snout / skull table
    return ex === 0 ? (c < 40 ? 'O' : 'Y') : 'B';                        // snout sides
  }
  for (y = 0; y <= 10; y++) {
    var hw = HEAD[y][0], hh = HEAD[y][1];
    section(y, hh === 2 ? [hw, hw - 2] : [hw, hw, hw - 2], 3, headMat);
  }
  put(10, 1, 5, 'N'); put(11, 1, 5, 'N');                       // nostril knob
  put(8, 8, 6, 'E'); put(13, 8, 6, 'E');                        // bulging eyes on top
  put(8, 9, 6, 'K'); put(13, 9, 6, 'K');                        // dark upper lids behind them
  put(10, 10, 6, 'K'); put(11, 10, 6, 'K');                     // post-occipital scutes

  // ---- lower jaw (z1-2) ----
  var JAWW = [4, 4, 6, 6, 6, 6, 6, 8, 8, 10, 10];
  function jawMat(px, py, pz, x0, x1, li, n) {
    var ex = Math.min(px - x0, x1 - 1 - px);
    if (li === n - 1) {                                                  // top of the lower jaw (mouth floor)
      if (ex === 0) return TOOTH_L[py] ? 'W' : 'Y';
      return (px === 10 || px === 11) && py >= 4 && py <= 9 ? 'T' : 'R';
    }
    return ex === 0 ? 'Y' : 'P';                                         // pale throat / chin underneath
  }
  section(0, [4], 2, jawMat);
  for (y = 1; y <= 10; y++) section(y, [JAWW[y] - 2, JAWW[y]], 1, jawMat);

  // ---- limbs (left side, mirrored to the right): short, sprawling ----
  function upMat(pz, top) { return pz === top ? 'B' : pz === 3 ? 'Y' : 'O'; }
  // fore upper (armL): humerus out sideways from the shoulder (x5) to the elbow (x3)
  for (y = 15; y <= 17; y++) { for (z = 3; z <= 5; z++) putSym(5, y, z, upMat(z, 5)); for (z = 3; z <= 4; z++) putSym(4, y, z, upMat(z, 4)); }
  for (y = 16; y <= 17; y++) for (z = 3; z <= 4; z++) putSym(3, y, z, upMat(z, 4));
  // fore lower (armL2): forearm down from the elbow, flat hand with 5 splayed fingers + claws
  for (y = 15; y <= 17; y++) { putSym(3, y, 2, 'O'); putSym(4, y, 2, 'B'); }
  for (y = 15; y <= 16; y++) { putSym(3, y, 1, 'Y'); putSym(4, y, 1, 'Y'); }
  for (y = 14; y <= 16; y++) { putSym(2, y, 0, 'B'); putSym(3, y, 0, 'O'); putSym(4, y, 0, 'O'); }
  putSym(5, 14, 0, 'B'); putSym(5, 13, 0, 'N');                  // digit I
  putSym(4, 13, 0, 'B'); putSym(4, 12, 0, 'N');                  // II
  putSym(3, 13, 0, 'B'); putSym(3, 12, 0, 'B'); putSym(3, 11, 0, 'N');   // III (longest)
  putSym(2, 13, 0, 'B'); putSym(1, 12, 0, 'N');                  // IV
  putSym(1, 14, 0, 'B'); putSym(0, 14, 0, 'N');                  // V
  // hind upper (legL): heavy thigh out from the hip (x5) to the knee (x3)
  for (y = 27; y <= 30; y++) for (z = 3; z <= 5; z++) putSym(5, y, z, upMat(z, 5));
  for (y = 27; y <= 29; y++) for (z = 3; z <= 5; z++) putSym(4, y, z, upMat(z, 5));
  for (y = 27; y <= 28; y++) for (z = 3; z <= 4; z++) putSym(3, y, z, upMat(z, 4));
  // hind lower (legL2): shin down + back to the ankle, long sole, 4 webbed toes pointing forward + out
  for (y = 28; y <= 29; y++) { putSym(3, y, 2, 'O'); putSym(4, y, 2, 'B'); }
  for (y = 29; y <= 30; y++) { putSym(3, y, 1, 'Y'); putSym(4, y, 1, 'Y'); }
  for (y = 29; y <= 32; y++) { putSym(1, y, 0, 'B'); putSym(2, y, 0, 'O'); putSym(3, y, 0, 'O'); putSym(4, y, 0, y === 32 ? 'Y' : 'O'); }
  for (x = 1; x <= 4; x++) putSym(x, 28, 0, 'B');                // toe bases + web
  putSym(4, 27, 0, 'N'); putSym(3, 27, 0, 'B'); putSym(2, 27, 0, 'B'); putSym(0, 27, 0, 'N');
  putSym(3, 26, 0, 'N'); putSym(2, 26, 0, 'N');

  var layers = [];
  for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(G[z][y].join('')); layers.push(rows); }

  // ---- parts ----
  var PARTS = {
    body:  { box: [6, 11, 0, 16, 31, 10], pivot: [11, 22, 3.5] },
    head:  { box: [6, 0, 3, 16, 11, 10], pivot: [11, 11, 4], parent: 'body' },
    jaw:   { box: [6, 0, 0, 16, 11, 3], pivot: [11, 11, 3], parent: 'head' },
    tail1: { box: [6, 31, 0, 16, 40, 10], pivot: [11, 31, 4], parent: 'body' },
    tail2: { box: [6, 40, 0, 16, 49, 10], pivot: [11, 40, 3.5], parent: 'tail1' },
    tail3: { box: [6, 49, 0, 16, 58, 10], pivot: [11, 49, 3], parent: 'tail2' },
    armL:  { box: [0, 12, 3, 6, 20, 8], pivot: [6, 16, 4.5], parent: 'body' },
    armR:  { box: [16, 12, 3, 22, 20, 8], pivot: [16, 16, 4.5], parent: 'body' },
    legL:  { box: [0, 25, 3, 6, 34, 8], pivot: [6, 29, 4.5], parent: 'body' },
    legR:  { box: [16, 25, 3, 22, 34, 8], pivot: [16, 29, 4.5], parent: 'body' },
    armL2: { box: [0, 11, 0, 6, 20, 3], pivot: [3.5, 17, 2.5], parent: 'armL' },
    armR2: { box: [16, 11, 0, 22, 20, 3], pivot: [18.5, 17, 2.5], parent: 'armR' },
    legL2: { box: [0, 24, 0, 6, 35, 3], pivot: [3.5, 27.5, 2.5], parent: 'legL' },
    legR2: { box: [16, 24, 0, 22, 35, 3], pivot: [18.5, 27.5, 2.5], parent: 'legR' }
  };
  var BODY_PIV = PARTS.body.pivot;

  // ---- legs + the in-file 2-bone solve (same maths as engine voxelPose, architecture.md 38.67 section 3) ----
  // foot = sole contact point (model cells). Order = fore pair, hind pair (legRig rule).
  var LEGS = [
    { k: 'aL', up: 'armL', lo: 'armL2', foot: [3, 15.5, 0] },
    { k: 'aR', up: 'armR', lo: 'armR2', foot: [19, 15.5, 0] },
    { k: 'lL', up: 'legL', lo: 'legL2', foot: [2.5, 30.5, 0] },
    { k: 'lR', up: 'legR', lo: 'legR2', foot: [19.5, 30.5, 0] }
  ];
  function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }
  LEGS.forEach(function (L) {
    var H = PARTS[L.up].pivot, K = PARTS[L.lo].pivot, F = L.foot;
    L.H = H; L.F = F;
    L.uy = K[1] - H[1]; L.uz = K[2] - H[2]; L.wy = F[1] - K[1]; L.wz = F[2] - K[2];
    L.a = Math.hypot(L.uy, L.uz); L.b = Math.hypot(L.wy, L.wz);
    L.phiU = Math.atan2(L.uz, L.uy); L.phiW = Math.atan2(L.wz, L.wy);
    L.sigma = wrapPi(L.phiW - L.phiU) > 0 ? 1 : -1;               // +1 apex front (hind knee), -1 apex back (elbow)
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

  // ---- pose: o = { b: [rx,ry,rz, px,py,pz] body, h: head [rx,ry,rz], j: jaw open deg, t1/t2/t3: tail [rx,ry,rz],
  //   feet: { aL: [dy, dz], ... } foot offsets from rest (cells; default planted), free: true = no solve, limbs use
  //   o.aL / o.aL2 ... rotations }. Every frame keys all 14 parts; limb pos is always 0 (limbs follow the body, the knees
  //   do the work, exactly as the engine solve does it). ----
  function pose(o) {
    var b = o.b || [], br = [b[0] || 0, b[1] || 0, b[2] || 0], bp = [b[3] || 0, b[4] || 0, b[5] || 0];
    var f = {
      body: { rot: v3(br), pos: v3(bp) },
      head: { rot: v3(o.h) },
      jaw: { rot: [rd(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] },
      tail1: { rot: v3(o.t1) }, tail2: { rot: v3(o.t2) }, tail3: { rot: v3(o.t3) }
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
  function TZ(a, b, c) { return { t1: [0, 0, a], t2: [0, 0, b], t3: [0, 0, c] }; }   // tail S-curve (rz per segment)

  // ---- gaits: ONE source for the clips and legRig.gaits (38.67 item 2). S = stance travel = v * T * duty (cells) ----
  // phase per leg in LEGS order [FL, FR, HL, HR]. walk = lateral sequence LH 0, LF .25, RH .5, RF .75; run = diagonal.
  var GAIT = {
    walk: { T: 1000, keys: 10, v: 0.4, duty: 0.7, phase: [0.25, 0.75, 0, 0.5], liftM: 0.05, bz: -0.8, bob: 0.15, yaw: 3, roll: 1.5, nod: 1, tail: [5, 8, 11] },
    run:  { T: 300, keys: 6, v: 1.9, duty: 0.5, phase: [0, 0.5, 0.5, 0], liftM: 0.05, bz: -0.8, bob: 0.2, yaw: 4, roll: 1, nod: 1.5, tail: [7, 11, 15] }
  };
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
  function gaitClip(g) {
    var n = g.keys, S = g.v * (g.T / 1000) * g.duty / CM, lift = g.liftM / CM, frames = [], durs = [];
    for (var k = 0; k < n; k++) {
      var p = k / n, W = 2 * Math.PI * p, yaw = g.yaw * Math.sin(W);
      var o = {
        b: [0, g.roll * Math.sin(W - 2 * Math.PI * 0.2), yaw, 0, 0, g.bz + g.bob * Math.cos(2 * W)],
        h: [-2 + g.nod * Math.sin(2 * W + 0.6), 0, -yaw * 0.9],                       // head steadied against the trunk yaw
        t1: [0, 0, -g.tail[0] * Math.sin(W - 0.9)], t2: [0, 0, -g.tail[1] * Math.sin(W - 1.8)], t3: [0, 0, -g.tail[2] * Math.sin(W - 2.7)],
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
  var LOW = -1;                                                  // basking: belly on the ground
  var anim = {};
  // idle 6.0 s (stand clip: feet stay planted, knees fold under the low trunk). The gape lifts the HEAD (upper jaw) and
  // opens the jaw by the same angle, so the lower jaw stays on the ground, as a basking croc does.
  anim.idle = clip([
    [1200, { b: [0, 0, 0, 0, 0, LOW], h: [-2, 0, 0] }],
    [800,  { b: [0, 0, 0, 0, 0, LOW + 0.25], h: [-3, 0, 0] }],                                  // breath in
    [600,  { b: [0, 0, 0, 0, 0, LOW], h: [-20, 0, 0], j: 20 }],                                 // gape opening
    [1400, { b: [0, 0, 0, 0, 0, LOW + 0.15], h: [-22, 0, 0], j: 22 }],                          // gape held
    [500,  { b: [0, 0, 0, 0, 0, LOW], h: [-2, 0, 0], j: 0 }],                                   // jaws close
    [800,  mix({ b: [0, 0, 0, 0, 0, LOW], h: [-2, 0, 5] }, TZ(3, 6, 10))],                     // tail flick, glance
    [700,  { b: [0, 0, 0, 0, 0, LOW], h: [-2, 0, 0] }]
  ], true);
  anim.walk = gaitClip(GAIT.walk);                               // low belly crawl
  anim.run = gaitClip(GAIT.run);                                 // short burst
  // swim 1.2 s: legs tucked back along the flanks (upper limbs lifted out + swept back, lower limbs trail), the tail drives
  var TUCK = { free: true, aL: [0, 50, -70], aR: [0, -50, 70], lL: [0, 45, -60], lR: [0, -45, 60],
               aL2: [30, 0, 0], aR2: [30, 0, 0], lL2: [40, 0, 0], lR2: [40, 0, 0] };
  anim.swim = (function () {
    var keys = [];
    for (var k = 0; k < 8; k++) {
      var W = 2 * Math.PI * k / 8;
      keys.push([150, mix(TUCK, { b: [0, 0, -3 * Math.sin(W), 0, 0, 0], h: [-2, 0, 2.5 * Math.sin(W)], j: 0,
        t1: [0, 0, 10 * Math.sin(W)], t2: [0, 0, 18 * Math.sin(W - 1.0)], t3: [0, 0, 26 * Math.sin(W - 2.0)] })]);
    }
    return clip(keys, true);
  })();
  // attack 0.6 s: LUNGE + JAW SNAP. Coil, launch (body 0.15 m forward + up, nose up, head up, jaws widest at 100 ms, front
  // feet reach), SNAP shut at 200 ms (key 2: jaw 40 -> 0 over 100..200 ms), tug / twist, pull back near rest. The sim moves
  // the entity for the real 4 m lunge (crocFx.lunge).
  anim.attack = clip([
    [100, mix({ b: [0, 0, 0, 0, 1.5, -0.3], h: [-4, 0, 0], j: 4 }, TZ(6, 10, 12))],                                        // coil
    [100, mix({ b: [-6, 0, 0, 0, -3, 1.0], h: [-20, 0, 0], j: JAW_MAX - 4, feet: { aL: [-2, 1.2], aR: [-2, 1.2] } }, TZ(-3, -5, -6))],  // LAUNCH, jaws wide
    [100, mix({ b: [-2, 0, 0, 0, -3.5, 0.6], h: [8, 0, 0], j: 0, feet: { aL: [-2.5, 0], aR: [-2.5, 0] } }, TZ(3, 6, 9))],     // SNAP
    [150, mix({ b: [0, 6, 4, 0, -3, 0.3], h: [6, 8, -10], j: 0, feet: { aL: [-2.5, 0], aR: [-2.5, 0] } }, TZ(-6, -10, -12))], // tug / twist
    [150, { b: [0, 0, 0, 0, -0.6, 0], h: [2, 0, 0], j: 2, feet: { aL: [-0.5, 0], aR: [-0.5, 0] } }]                          // pull back
  ], false);
  // grab 1.0 s loop: jaws SHUT on the prey, a small body roll and a head tug side to side, the tail counters
  anim.grab = clip([
    [250, mix({ b: [0, 6, 3, 0, -1, 0.6], h: [4, 4, -8], j: 0 }, TZ(-4, -7, -9))],
    [250, mix({ b: [0, 0, 0, 0, -1.2, 0.6], h: [5, 0, 0], j: 0 }, TZ(0, 0, 0))],
    [250, mix({ b: [0, -6, -3, 0, -1, 0.6], h: [4, -4, 8], j: 0 }, TZ(4, 7, 9))],
    [250, mix({ b: [0, 0, 0, 0, -1.2, 0.6], h: [5, 0, 0], j: 0 }, TZ(0, 0, 0))]
  ], true);
  // recover 0.4 s (after attack / grab): head comes back, a last jaw pop, settles to rest (held)
  anim.recover = clip([
    [150, mix({ b: [0, 0, 0, 0, 0.6, 0], h: [-6, 0, 6], j: 6 }, TZ(-3, -5, -6))],
    [100, mix({ h: [-2, 0, -4], j: 2 }, TZ(2, 3, 4))],
    [150, {}]
  ], false);
  // hurt 0.1 s (2 step keys): recoil back, head up, jaws pop, tail curls
  anim.hurt = clip([
    [50, mix({ b: [-4, 0, 0, 0, 1.2, 0.4], h: [-16, 0, 0], j: 22 }, TZ(8, 12, 14))],
    [50, mix({ b: [-3, 0, 0, 0, 0.9, 0.3], h: [-10, 0, 0], j: 14 }, TZ(5, 8, 10))]
  ], false);
  anim.hurt.interp = 'step';
  // hitAdd 0.25 s ADDITIVE (38.68): frame 0 = rest (all zero), a jolt, back to rest. Legs stay 0 (free), the blend mask is
  // body / head / jaw / tail1.
  anim.hitAdd = clip([
    [50, { free: true }],
    [50, { free: true, b: [-3, 0, 0, 0, 0.5, 0.2], h: [-12, 0, 0], j: 14, t1: [0, 0, 6] }],
    [50, { free: true, b: [-2, 0, 0, 0, 0.3, 0.1], h: [-8, 0, 4], j: 8, t1: [0, 0, 3] }],
    [100, { free: true }]
  ], false);
  // flinch 0.25 s: stagger / block recoil, head shake, back to rest
  anim.flinch = clip([
    [50,  mix({ b: [-3, 0, 0, 0, 1.0, 0.3], h: [-6, 0, 8], j: 6 }, TZ(4, 6, 8))],
    [100, mix({ b: [1, 0, 0, 0, 0.3, 0], h: [4, 0, -8], j: 2 }, TZ(-2, -3, -4))],
    [100, {}]
  ], false);
  // dead: belly up (rolled 180 deg about the trunk), legs limp in the air, head and tail droop
  var DEAD_O = { free: true, b: [0, 180, 0, 0, 0, groundZ(180)], h: [-8, 0, 0], j: 10, t1: [-3, 0, 4], t2: [-3, 0, 6], t3: [-2, 0, 8],
                 aL: [-20, 25, 0], aR: [-20, -25, 0], lL: [20, 25, 0], lR: [20, -25, 0],
                 aL2: [-25, 0, 0], aR2: [-25, 0, 0], lL2: [25, 0, 0], lR2: [25, 0, 0] };
  // die 0.6 s: jaws gape + tail lash (planted), then it ROLLS onto its back, thud (key 3 at 300 ms) with a leg kick, settles
  anim.die = clip([
    [100, mix({ b: [-4, 0, 8, 0, 0.6, 0.2], h: [-24, 0, -10], j: 30 }, TZ(-14, -20, -24))],
    [100, mix({ free: true, b: [0, 50, -4, 0, 0, groundZ(50)], h: [-8, 0, 8], j: 22, aL: [-10, 20, 0], aR: [-10, -10, 0], lL: [10, 15, 0], lR: [10, -10, 0] }, TZ(10, 14, 18))],
    [100, mix({ free: true, b: [0, 120, 0, 0, 0, groundZ(120)], h: [-6, 0, 4], j: 16, aL: [-30, 30, 0], aR: [-30, -30, 0], lL: [30, 30, 0], lR: [30, -30, 0] }, TZ(4, 6, 8))],
    [150, mix(DEAD_O, { b: [0, 180, 0, 0, 0, groundZ(180) - 0.4], j: 18, aL: [-40, 35, 0], aR: [-40, -35, 0], lL: [40, 30, 0], lR: [40, -30, 0] })],   // THUD + kick
    [150, DEAD_O]
  ], false);
  anim.dead = clip([[1000, DEAD_O]], true);
  // sink 0.6 s (wolf / bear format [500, 100]): dead pose, then lowered SINK_M (on top of the sim's own entity drop)
  var SINK_M = 0.6, SUNK_O = mix(DEAD_O, { b: DEAD_O.b.slice() });
  SUNK_O.b[5] = rd(DEAD_O.b[5] - SINK_M / CM);
  anim.sink = clip([[500, DEAD_O], [100, SUNK_O]], false);

  // ---- materials (auto-switch to the final olive scale set once palette + detail-pass both have it) ----
  var PM = A.palette && A.palette.materials, DM = A.detailPass && A.detailPass.materials;
  var FINAL = ['scale_croc', 'scale_croc_dark', 'scale_croc_light'].every(function (k) { return !!(PM && PM[k] && DM && DM[k]); });
  var mats = {
    B: FINAL ? 'scale_croc' : 'block_dark',          // base hide: dark olive-brown (interim: dark warm stone, knobbly ramp)
    K: FINAL ? 'scale_croc_dark' : 'waystone_dark',  // scute seams, keels, crests, tail bands, lids: near-black
    O: FINAL ? 'scale_croc_light' : 'canvas_dark',   // olive-tan mottles, lit keel tips
    Y: 'straw_dark',                                 // yellow-olive lower flanks, lips, limb undersides
    P: 'fur_cream',                                  // cream belly, throat, chin
    S: 'linen',                                      // belly scute seams
    G: 'moss_cap',                                   // a few green algae flecks on the back
    E: 'petal_yellow',                               // yellow eyes
    N: 'iron_dark',                                  // nostrils, claws
    W: 'linen_light',                                // teeth
    R: 'canvas_light',                               // pale yellow mouth lining (palate, mouth floor)
    T: 'skin_flush'                                  // tongue
  };

  A.models.crocodile = {
    name: 'crocodile',
    displayName: 'river crocodile',
    desc: 'BEAST-D1 river crocodile (2.9 m, on all fours): long flat snout with interlocking teeth, raised nostrils and ' +
          'bulging eyes, nuchal plate, broad low trunk with keeled osteoderm rows, long crested tail, short sprawling ' +
          'legs (webbed hind feet). 14 parts (knee rig, 3-segment tail); clips idle (basking gape), walk (belly crawl), ' +
          'run (burst), swim (tail-driven, legs tucked), attack (lunge + jaw snap), grab, recover, hurt, hitAdd, ' +
          'flinch, die (rolls belly up), dead, sink + blend block.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: CM,
      size: [SX, SY, SZ],
      anchor: [11, 23, 0],
      light: false,
      mats: mats,
      layers: layers,
      parts: PARTS,
      lookAt: { part: 'head', yawLimitDeg: 30, pitchLimitDeg: 12, hz: 0.8 },   // stiff neck, slow follow
      legRig: {
        body: 'body',
        legs: LEGS.map(function (L, li) { return { upper: L.up, lower: L.lo, foot: L.foot.slice(), bend: li < 2 ? 'back' : 'front' }; }),
        gaits: {
          walk: { tunedMps: GAIT.walk.v, duty: GAIT.walk.duty, phase: GAIT.walk.phase.slice(), liftM: GAIT.walk.liftM },
          run:  { tunedMps: GAIT.run.v, duty: GAIT.run.duty, phase: GAIT.run.phase.slice(), liftM: GAIT.run.liftM }
        },
        stand: ['idle'],
        maxPitchDeg: 12, maxRollDeg: 6
      },
      animations: anim,
      // ANIM-BLEND (38.68): set speeds = legRig tunedMps. attack snaps in (60 ms); leaving attack / grab takes >= 200 ms so
      // the croc visibly settles; land <-> water 300 ms; hit = additive on body / head / jaw / tail1 (never leg parts).
      blend: {
        sets: { locomotion: { param: 'speed', clips: [{ clip: 'walk', at: GAIT.walk.v }, { clip: 'run', at: GAIT.run.v }] } },
        fades: {
          default: 150,
          into: { attack: 60, grab: 80, recover: 150, hurt: 50, flinch: 80, swim: 250 },
          pairs: { 'run>attack': 60, 'swim>attack': 60, 'idle>attack': 60, 'attack>grab': 60,
                   'attack>recover': 200, 'attack>idle': 200, 'attack>walk': 200, 'attack>swim': 200,
                   'grab>recover': 200, 'grab>swim': 250, 'recover>idle': 200, 'recover>walk': 200, 'recover>swim': 250,
                   'walk>swim': 300, 'swim>walk': 300, 'idle>swim': 300, 'swim>idle': 300 }
        },
        additive: { hit: { clip: 'hitAdd', parts: ['body', 'head', 'jaw', 'tail1'], inMs: 50, outMs: 200, gain: 1 } }
      },
      mounts: {                                       // grid coords at rest; they follow their part
        eyes:     { at: [11, 8, 6.5], part: 'head' },   // 0.33 m: ambush eye line at the water surface
        nostrils: { at: [11, 1.5, 5.5], part: 'head' }, // 0.28 m: second ripple / bubble point
        mouth:    { at: [11, 0.5, 3], part: 'head' },   // hiss / breath origin
        jawTip:   { at: [11, 1, 2], part: 'jaw' },      // bite point (snap spark / splash)
        grab:     { at: [11, 3, 3], part: 'head' },     // where the held player is pinned (between the jaws)
        forefeet: { at: [11, 15.5, 0.4], part: 'body' },// dust / splash between the forefeet (lunge launch)
        hit:      { at: [11, 22, 4], part: 'body' },    // flank centre (0.2 m)
        loot:     { at: [11, 22, 1], part: 'body' },    // the BELLY = the top of the corpse (dead pose is belly up)
        tailTip:  { at: [11, 57, 3], part: 'tail3' }    // tail splash
      }
    }
  };

  A.crocFx = {
    version: 1,
    model: 'crocodile',
    finalMats: FINAL,
    story: 'BEAST-D1 (model + clips) for BEAST-08b (croc lunge / grab) and BEAST-09 (spawns)',
    clipFor: {
      state: { idle: 'idle', wander: 'walk', move: 'walk', return: 'walk', notice: 'idle', chase: 'run', charge: 'run',
               swim: 'swim', submerged: 'swim', ambush: 'swim', windup: 'idle', telegraph: 'idle', lunge: 'attack',
               attack: 'attack', bite: 'attack', grab: 'grab', recover: 'recover', stagger: 'flinch' },
      water: { idle: 'swim', wander: 'swim', move: 'swim', chase: 'swim', return: 'swim',
               note: 'when the croc is SUBMERGED / on water mask 1 every movement state plays swim (rate ~ speed / ' +
                     'speeds.swim); lunge / grab / hurt / die keep their own clips in water too' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink', hitAdditive: 'hit',
      note: 'boar / bear clip names work (charge = run, bite = attack). wander on land = walk (belly crawl), in water ' +
            '= swim. With the ANIM-BLEND blender request the `locomotion` set by speed instead of walk / run.'
    },
    speeds: { walk: 0.4, run: 1.9, swim: 1.2,
              note: 'walk / run = legRig tunedMps (planted feet); the leg driver stretches the stride above that. swim ' +
                    'loop is authored for ~1.2 m/s, scale its rate with speed. Slow on land (epic row 11).' },
    lunge: { clip: 'attack', ms: 600, coilMs: [0, 100], jawsWideMs: [100, 200], snapKey: 2, snapMs: 200, hitMs: [150, 250],
             clipReachM: 0.18, rangeM: 4,
             note: 'the clip moves the trunk only 0.18 m; the sim moves the entity for the 4 m lunge from the water ' +
                   '(kinds.json lunge range 4, windup 0.5 s = idle / swim held still with eyes up). Deal damage inside ' +
                   'hitMs; the jaw is shut from snapMs on. Ends near rest -> grab (60 ms) or recover / idle (200 ms).' },
    grab: { clip: 'grab', loopMs: 1000, mount: 'grab', jawShut: true, rollDeg: 6,
            note: 'D-088: movement-only pin (camera, attack, block, items keep working). Hold the player at the grab ' +
                  'mount; on release play recover (200 ms fade).' },
    recover: { clip: 'recover', ms: 400, note: 'after attack / grab; last key = rest (held)' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 15,
            note: 'as blackBearFx.hurt; `belly after stagger` (epic row 11): the flinch clip lifts the chest a little' },
    death: {
      note: 'same timeline as boarFx.death (hurt 6 steps -> die 36 steps -> thud at die key 3 (300 ms) -> dead + ' +
            'lootable)',
      thudKey: 3, thudMs: 300,
      corpseCentre: { rightM: 0, fwdM: 0.3, upM: 0.2, note: 'belly up, rolled about the trunk; the corpse spans about ' +
                      '-1.15 .. +1.75 m along the body, 0 .. 0.45 m up (entity frame)' },
      lootInteract: { prompt: '[E] Loot crocodile', radiusM: 2.0, aimUpM: 0.3 },
      sink: { clip: 'sink', steps: 30, depthM: SINK_M, note: 'clip depth; the sim adds its own sinkM entity drop' }
    },
    water: { eyesUpM: 0.33, nostrilsUpM: 0.28, backUpM: 0.35,
             note: 'ambush look: with the entity at surface - 0.30 m only the eyes, the nostril knob and the keels break ' +
                   'the surface (BEAST-08a uses surface - 0.4: eyes 7 cm under; PO: 0.30 shows the classic eyes-and-' +
                   'nostrils silhouette).' },
    notice: { noticeUpM: 0.8, note: 'the notice mark sits low (the croc is 0.35 m tall)' },
    collider: { lengthM: 2.9, widthM: 0.55, note: 'long body: the anchor is mid trunk; snout 1.15 m ahead, tail tip 1.75 m ' +
                'behind. A capsule along y fits better than one circle.' },
    missingClips: {}
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { crocodile: A.models.crocodile, crocFx: A.crocFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
