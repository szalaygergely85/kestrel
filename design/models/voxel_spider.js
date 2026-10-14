/* design/models/voxel_spider.js - BEAST-D1 batch 1: wood spider (EP-BESTIARY roster #15, ambusher: drop from the canopy,
 * web spit, bite; D-083, OB-153). Spiderling (#16) = this model at scale 0.4; Broodmother boss = scale 2.5.
 * Designer, PC-B lane 4, 2026-10-14.
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_wolf.js:
 *   <script src="../design/models/voxel_spider.js">        (browser)
 *   import '../../../design/models/voxel_spider.js';       (Node tests: side-effect import)
 * Sets ASSETS.models.woodSpider and ASSETS.spiderFx. NOT registered in game/js/main.js here. `meshOnly`.
 *
 * Axes (15.1): x = east (= the spider's RIGHT at yaw 0), y = SOUTH with low y = the FRONT (faces north at yaw 0), z = up.
 * cellM 0.05. Grid 26 x 26 x 33 (z11..32 = only the silk thread). Anchor [13, 12, 0] = the middle of the 8 feet.
 * Centre line x = 13 (cells 12 | 13); right side = mirror x -> 26 - x (continuous). Clip `pos` values are VOXELS.
 *
 * ANATOMY (a giant wolf-spider / huntsman-like forest spider from squares, style-guide 0 "realistic"):
 *   - 1.3 m leg span, body 0.75 m (chelicerae + cephalothorax 0.3 m + abdomen 0.45 m), abdomen top 0.5 m.
 *   - 8 legs, each 4 segments: femur rising from the body to a HIGH KNEE (0.55 m, above the body = the spider tell
 *     at 20 m), patella (pale ring), tibia down-out with a pale band, metatarsus + tarsus to a dark tip on the ground.
 *   - cephalothorax: dark carapace with a pale median stripe, pale marginal bands, a dark fovea; EIGHT eyes: 2 big
 *     forward eyes, 2 small side eyes, 2 big eyes on a turret looking up/forward (ember eyeshine: big spiders really
 *     shine at night), plus 2 small dark ones.
 *   - chelicerae: two hairy blocks with pale curved fangs folded under, tips meeting; pedipalps = 2 short club legs.
 *   - abdomen: oval, hairy brown, a dark cardiac lance, pale chevrons, speckled pale sides, black belly, spinnerets.
 * Colour (browns + cream): B hair_dark base > b dye_walnut warm hair > c fur_agouti_light pale bands / chevrons >
 *   C fur_cream median stripe; K fur_bear_dark belly, tips, fovea; F antler fangs; E ember_glow eyes; s linen_light silk.
 *
 * Parts (8; insertion order = part index; parents EARLIER; boxes disjoint by design, each sx+sy+sz <= 48):
 *   body    box [10,7,2, 16,13,9]   pivot [13, 10, 4.5] (cephalothorax centre). ROOT. rx - = front up, ry = roll
 *                                   (178 = on its back), rz = turn.
 *   legLF   box [0,0,0, 10,10,12]   legs L1 + L2 (front pair, left), pivot [9.8, 8.6, 4.5]   } parent body. Legs swing
 *   legLB   box [0,10,0, 10,26,12]  legs L3 + L4 (rear pair, left),  pivot [9.8, 11.5, 4.5]  } about their coxa: LEFT
 *   legRF   box [16,0,0, 26,10,12]  legs R1 + R2, pivot [16.2, 8.6, 4.5]                      } rz + = forward, RIGHT
 *   legRB   box [16,10,0, 26,26,12] legs R3 + R4, pivot [16.2, 11.5, 4.5]                     } rz - = forward. ry up:
 *                                   LEFT +, RIGHT -. rx - = raise the pair's front (threat pose). pos z + = lifted.
 *   abdomen box [10,13,2, 16,22,10] pivot [13, 13, 5.5] (pedicel), parent body. rx + = tip down, rz = sway.
 *   fangs   box [10,1,0, 16,7,7]    chelicerae + fangs + pedipalps, pivot [13, 6.5, 4.5], parent body.
 *                                   rx - = spread / raise (fangs bared), rx + = stab down.
 *   silk    box [12,19,10, 13,20,33] the dragline (1.15 m) from the abdomen top, pivot [12.5, 19.5, 10], parent body.
 *                                   Visible ONLY in `drop`; every other clip keeps it pos z -120 (6 m under the ground,
 *                                   the goblin-javelin / lamp-glint trick).
 *   Gait pairs: walking alternates (LF + RB) with (RF + LB) - 4 leg parts are the 8-legs-in-8-parts compromise.
 *
 * Clips (ms, multiples of 10):
 *   idle    loop 2.4 s  4 keys: abdomen pulses, palps / fangs twitch, a front pair taps (lift 5 cm), weight shifts.
 *   walk    loop 0.48 s 4 keys: alternating pairs, swing pair lifted 5 cm, abdomen sways. ~0.7 m/s at rate 1.
 *   run     loop 0.28 s 4 keys: same, +-18 deg, lifted 7.5 cm, ~1.8 m/s.
 *   drop    once 1.0 s  6 keys: AMBUSH from the canopy: hangs on the silk with the legs folded over the body (0.35 m
 *                       view-only dangle), legs flare at 500 ms, the silk vanishes at 690 ms (10 ms key), LANDS at
 *                       700 ms with a squash, stance. The sim lowers the entity from the canopy.
 *   windup  once 0.5 s  3 keys: BITE TELEGRAPH (>= 0.4 s): rears, front pairs raised high and spread, fangs bared,
 *                       abdomen down. Last key held.
 *   bite    once 0.3 s  3 keys: strike (key 0 -> 100 ms: lunge 0.12 m, fangs stab), hold, back to stance.
 *   spit    once 1.0 s  5 keys: WEB SPIT: rear up + fangs wide 0-500 ms (wind-up held 100 ms), RELEASE key 3 at
 *                       500 ms (the sim spawns the web blob from mount `spit`), recover to stance by 1000 ms.
 *   hurt    once 0.1 s  2 step keys: jolt back, legs flinch up, fangs flare.
 *   flinch  once 0.25 s 3 keys: back to stance.
 *   die     once 0.5 s  5 keys (90/110/120/80/100): rears, flips over onto its back (thud key 3), legs curl up.
 *   dead    held        on its back, legs curled up over the belly.    sink: 0.5 s, 0.6 m.
 *   Aliases: charge = run.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 26, SY = 26, SZ = 33, CX = 13;
  var ORDER = ['body', 'legLF', 'legLB', 'legRF', 'legRB', 'abdomen', 'fangs', 'silk'];
  var BOX = {
    body: [10, 7, 2, 16, 13, 9],
    legLF: [0, 0, 0, 10, 10, 12], legLB: [0, 10, 0, 10, 26, 12],
    legRF: [16, 0, 0, 26, 10, 12], legRB: [16, 10, 0, 26, 26, 12],
    abdomen: [10, 13, 2, 16, 22, 10], fangs: [10, 1, 0, 16, 7, 7], silk: [12, 19, 10, 13, 20, 33]
  };
  var PIVOT = {
    body: [13, 10, 4.5],
    legLF: [9.8, 8.6, 4.5], legLB: [9.8, 11.5, 4.5], legRF: [16.2, 8.6, 4.5], legRB: [16.2, 11.5, 4.5],
    abdomen: [13, 13, 5.5], fangs: [13, 6.5, 4.5], silk: [12.5, 19.5, 10]
  };
  var PARENT = { legLF: 'body', legLB: 'body', legRF: 'body', legRB: 'body', abdomen: 'body', fangs: 'body', silk: 'body' };

  // ---- shared BEAST-D1 helper block: grid + ownership-safe writes ----
  var g = [], CLIPPED = 0, gx, gy, gz;
  for (gz = 0; gz < SZ; gz++) { g.push([]); for (gy = 0; gy < SY; gy++) { g[gz].push([]); for (gx = 0; gx < SX; gx++) g[gz][gy].push('.'); } }
  function inBox(b, x, y, z) { return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; }
  function put(part, x, y, z, ch) {
    if (!ch) return;
    if (x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ || !inBox(BOX[part], x, y, z)) { CLIPPED++; return; }
    for (var i = 0; ORDER[i] !== part; i++) if (inBox(BOX[ORDER[i]], x, y, z)) { CLIPPED++; return; }
    g[z][y][x] = ch;
  }
  function hash(x, y, z) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function dxOf(x) { return Math.abs(x + 0.5 - CX); }
  function ell(part, cx, cy, cz, rx, ry, rz, col) {
    var x, y, z, nx, ny, nz;
    for (z = Math.floor(cz - rz); z <= Math.floor(cz + rz); z++)
      for (y = Math.floor(cy - ry); y <= Math.floor(cy + ry); y++)
        for (x = Math.floor(cx - rx); x <= Math.floor(cx + rx); x++) {
          nx = (x + 0.5 - cx) / rx; ny = (y + 0.5 - cy) / ry; nz = (z + 0.5 - cz) / rz;
          if (nx * nx + ny * ny + nz * nz <= 1) put(part, x, y, z, typeof col === 'function' ? col(x, y, z, nx, ny, nz) : col);
        }
  }
  // tapered capsule a -> b (radius r0 -> r1); col(x, y, z, t), t = 0..1 along the segment
  function seg(part, a, b, r0, r1, col) {
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L2 = dx * dx + dy * dy + dz * dz || 1;
    var rm = Math.max(r0, r1), x, y, z, t, px, py, pz, ex, ey, ez, r;
    for (z = Math.floor(Math.min(a[2], b[2]) - rm); z <= Math.floor(Math.max(a[2], b[2]) + rm); z++)
      for (y = Math.floor(Math.min(a[1], b[1]) - rm); y <= Math.floor(Math.max(a[1], b[1]) + rm); y++)
        for (x = Math.floor(Math.min(a[0], b[0]) - rm); x <= Math.floor(Math.max(a[0], b[0]) + rm); x++) {
          px = x + 0.5 - a[0]; py = y + 0.5 - a[1]; pz = z + 0.5 - a[2];
          t = (px * dx + py * dy + pz * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          ex = px - t * dx; ey = py - t * dy; ez = pz - t * dz; r = r0 + (r1 - r0) * t;
          if (ex * ex + ey * ey + ez * ez <= r * r) put(part, x, y, z, typeof col === 'function' ? col(x, y, z, t) : col);
        }
  }
  function layers() {
    var out = [], z, y;
    for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(g[z][y].join('')); out.push(rows); }
    return out;
  }
  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }
  function F(o) {
    var f = {}, i, p, v;
    for (i = 0; i < ORDER.length; i++) {
      p = ORDER[i]; v = o[p] || [];
      f[p] = { rot: [r3(v[0] || 0), r3(v[1] || 0), r3(v[2] || 0)], pos: [r3(v[3] || 0), r3(v[4] || 0), r3(v[5] || 0)] };
    }
    return f;
  }

  // ---- cephalothorax (y7..12, z3..6) + eye turret (z7) ----
  // [half-width at the belly z3, at z4-5, at the carapace top z6]
  var CEPH = { 7: [1.5, 1.5, 1.5], 8: [2.5, 2.5, 1.5], 9: [2.5, 2.5, 1.5], 10: [2.5, 2.5, 1.5], 11: [1.5, 2.5, 1.5], 12: [1.5, 1.5, 0.5] };
  (function buildCeph() {
    var y, z, x, p, lim, d, c;
    for (y = 7; y <= 12; y++) {
      p = CEPH[y];
      for (z = 3; z <= 6; z++) {
        lim = z === 3 ? p[0] : z === 6 ? p[2] : p[1];
        for (x = 10; x <= 15; x++) {
          d = dxOf(x); if (d > lim) continue;
          if (z === 3) c = 'K';                                         // dark sternum / belly
          else if (z === 6) c = y === 10 && d < 1 ? 'K' : (d < 1 ? 'C' : 'B');   // median stripe, fovea
          else c = d >= 2.5 ? 'c' : (hash(x, y, z) < 0.3 ? 'b' : 'B');   // pale marginal bands
          put('body', x, y, z, c);
        }
      }
    }
    // face (front y7): 2 big anterior median eyes, 2 small laterals, dark clypeus
    put('body', 12, 7, 6, 'E'); put('body', 13, 7, 6, 'E'); put('body', 11, 7, 6, 'B'); put('body', 14, 7, 6, 'B');
    put('body', 11, 7, 5, 'E'); put('body', 14, 7, 5, 'E'); put('body', 12, 7, 5, 'K'); put('body', 13, 7, 5, 'K');
    put('body', 12, 7, 4, 'K'); put('body', 13, 7, 4, 'K');
    // eye turret: the 2 big posterior median eyes look up / forward, 2 small dark eyes beside them
    put('body', 11, 8, 7, 'K'); put('body', 12, 8, 7, 'E'); put('body', 13, 8, 7, 'E'); put('body', 14, 8, 7, 'K');
    put('body', 12, 9, 7, 'B'); put('body', 13, 9, 7, 'B');
  })();

  // ---- abdomen (oval, y13..21) ----
  ell('abdomen', 13, 17.5, 6.5, 3, 4.5, 3.5, function (x, y, z, nx, ny, nz) {
    var d = dxOf(x), h = hash(x, y, z);
    if (nz < -0.45) return 'K';                                          // black belly
    if (ny > 0.85) return 'B';                                           // rear
    if (nz > 0.5) {                                                      // dorsal pattern
      if (y <= 15 && d < 1) return 'B';                                  // dark cardiac lance
      if (y >= 16 && d < 1) return 'B';
      if ((y === 16 || y === 18 || y === 20) && d <= 2.5) return 'c';    // pale chevrons
      if ((y === 15 || y === 17 || y === 19) && d >= 1.5) return 'K';    // dark edge in front of each chevron
      return h < 0.3 ? 'B' : 'b';
    }
    if (nz > -0.3 && nz < 0.3) return h < 0.45 ? 'c' : 'b';              // speckled pale sides
    return h < 0.35 ? 'B' : 'b';
  });
  put('abdomen', 12, 21, 4, 'K'); put('abdomen', 13, 21, 4, 'K');        // spinnerets

  // ---- chelicerae, fangs, pedipalps ----
  (function buildFangs() {
    var y, z;
    for (y = 5; y <= 6; y++) for (z = 3; z <= 5; z++) {
      put('fangs', 11, y, z, y === 5 ? 'b' : 'B'); put('fangs', 12, y, z, y === 5 ? 'b' : 'B');
      put('fangs', 13, y, z, y === 5 ? 'b' : 'B'); put('fangs', 14, y, z, y === 5 ? 'b' : 'B');
    }
    put('fangs', 12, 5, 5, 'K'); put('fangs', 13, 5, 5, 'K');            // the cleft between the chelicerae
    put('fangs', 11, 5, 2, 'F'); put('fangs', 12, 5, 1, 'F');            // fangs folded under, tips meeting
    put('fangs', 14, 5, 2, 'F'); put('fangs', 13, 5, 1, 'F');
    function palp(x) {
      seg('fangs', [x, 6.5, 4.5], [x, 3.5, 3.0], 0.6, 0.6, function (xx, yy, zz, t) { return t > 0.6 ? 'c' : 'B'; });
      seg('fangs', [x, 3.5, 3.0], [x, 2.2, 0.8], 0.6, 0.65, function (xx, yy, zz, t) { return t > 0.5 ? 'K' : 'B'; });
    }
    palp(10.5); palp(15.5);
  })();

  // ---- legs: 4 points each (coxa, high knee, tibia end, tip on the ground); right side = mirror x -> 26 - x ----
  var LEGS = {
    legLF: [[[9.6, 8.0, 4.5], [5.5, 4.0, 10.5], [3.0, 1.5, 5.0], [2.2, 0.6, 0.5]],      // L1 forward-out
            [[9.6, 9.3, 4.5], [4.5, 7.5, 10.5], [1.8, 6.6, 5.0], [0.6, 6.0, 0.5]]],     // L2 side-forward
    legLB: [[[9.6, 10.8, 4.5], [4.5, 13.0, 10.0], [1.8, 15.0, 5.0], [0.8, 16.0, 0.5]],  // L3 side-back
            [[9.6, 12.2, 4.5], [5.5, 18.0, 10.5], [3.2, 22.5, 5.0], [2.5, 25.4, 0.5]]]  // L4 back-out
  };
  function leg(part, P) {
    seg(part, P[0], P[1], 0.85, 0.75, function (x, y, z, t) { return t > 0.88 ? 'c' : (hash(x, y, z) < 0.2 ? 'b' : 'B'); }); // femur + pale patella
    seg(part, P[1], P[2], 0.75, 0.65, function (x, y, z, t) { return t < 0.12 ? 'c' : (t > 0.45 && t < 0.62) ? 'c' : 'b'; }); // tibia, pale band
    seg(part, P[2], P[3], 0.65, 0.55, function (x, y, z, t) { return t > 0.75 ? 'K' : (t > 0.3 && t < 0.42) ? 'c' : 'B'; }); // metatarsus + tarsus
  }
  function mirror(P) { var out = [], i; for (i = 0; i < P.length; i++) out.push([26 - P[i][0], P[i][1], P[i][2]]); return out; }
  (function buildLegs() {
    var i;
    for (i = 0; i < 2; i++) {
      leg('legLF', LEGS.legLF[i]); leg('legRF', mirror(LEGS.legLF[i]));
      leg('legLB', LEGS.legLB[i]); leg('legRB', mirror(LEGS.legLB[i]));
    }
  })();

  // ---- silk dragline ----
  (function buildSilk() { for (var z = 10; z <= 32; z++) put('silk', 12, 19, z, 's'); })();

  // ---- clips ----
  var HIDE = [0, 0, 0, 0, 0, -120];
  function S(o) { if (!o.silk) o.silk = HIDE; return F(o); }
  function gait(i, amp, lift, bob) {
    var a = [1, 0, -1, 0][i], b = [-1, 0, 1, 0][i], la = [0, 0, 0, 1][i], lb = [0, 1, 0, 0][i];
    return S({
      body: [0, 0, 0, 0, 0, (i % 2) * bob], abdomen: [0, 0, -3 * a], fangs: [2 * a],
      legLF: [0, 0, amp * a, 0, 0, lift * la], legRB: [0, 0, -amp * a, 0, 0, lift * la],
      legRF: [0, 0, -amp * b, 0, 0, lift * lb], legLB: [0, 0, amp * b, 0, 0, lift * lb]
    });
  }
  var i, walk = [], run = [];
  for (i = 0; i < 4; i++) { walk.push(gait(i, 12, 1, 0.3)); run.push(gait(i, 18, 1.5, 0.5)); }

  var TUCK = { legLF: [-15, 35, -10], legRF: [-15, -35, 10], legLB: [15, 35, 10], legRB: [15, -35, -10] };
  var FLARE = { legLF: [-10, 10, 6], legRF: [-10, -10, -6], legLB: [0, 10, -4], legRB: [0, -10, 4] };
  function merge(o, more) { for (var k in more) if (!o[k]) o[k] = more[k]; return o; }
  var THREAT = { legLF: [-35, 28, 8, 0, 0, 1], legRF: [-35, -28, -8, 0, 0, 1], legLB: [12, 0, 6], legRB: [12, 0, -6] };
  var REAR = { legLF: [-22, 26, 8, 0, 0, 0.5], legRF: [-22, -26, -8, 0, 0, 0.5], legLB: [16, 0, 8], legRB: [16, 0, -8] };
  var DEAD_LEGS = { legLF: [0, -45, 8], legRF: [0, 45, -8], legLB: [0, -45, -8], legRB: [0, 45, 8] };
  var DEAD = S(merge({ body: [0, 176, 0], fangs: [12] }, DEAD_LEGS));
  var SUNK = S(merge({ body: [0, 176, 0, 0, 0, -12], fangs: [12] }, DEAD_LEGS));

  var animations = {
    idle:   { durations: [700, 500, 700, 500], loop: true, frames: [
      S({}),
      S({ body: [0, 0, 0, 0, 0, 0.2], abdomen: [-3], fangs: [-6], legLF: [0, 0, 0, 0, 0, 1] }),
      S({ abdomen: [1, 0, 2], fangs: [3] }),
      S({ body: [0, 0, 0, 0, 0, 0.15], abdomen: [-2, 0, -2], fangs: [-4], legRF: [0, 0, 0, 0, 0, 0.8] })
    ] },
    walk:   { durations: [120, 120, 120, 120], loop: true, frames: walk },
    run:    { durations: [70, 70, 70, 70], loop: true, frames: run },
    // canopy ambush: hang (legs folded) -> flare -> silk gone (10 ms key) -> LAND squash -> stance
    drop:   { durations: [200, 300, 190, 10, 150, 150], loop: false, frames: [
      F(merge({ body: [0, 0, 0, 0, 0, 7], abdomen: [-8], fangs: [-5], silk: [0, 0, 0] }, TUCK)),
      F(merge({ body: [0, 0, 0, 0, 0, 6.5], abdomen: [-6], fangs: [-8], silk: [0, 0, 0] }, TUCK)),
      F(merge({ body: [0, 0, 0, 0, 0, 2], abdomen: [-2], fangs: [-10], silk: [0, 0, 0] }, FLARE)),
      S(merge({ body: [0, 0, 0, 0, 0, 1.8], abdomen: [-2], fangs: [-10] }, FLARE)),
      S({ body: [0, 0, 0, 0, 0, -1.2], abdomen: [6], fangs: [-4],
          legLF: [0, -8, 8], legRF: [0, 8, -8], legLB: [0, -8, -6], legRB: [0, 8, 6] }),
      S({})
    ] },
    // bite telegraph 0.5 s: rear, front pairs up and spread, fangs bared, abdomen down (last key held)
    windup: { durations: [150, 250, 100], loop: false, frames: [
      S({ body: [-6, 0, 0, 0, 0.6, 0.5], abdomen: [5], fangs: [-12],
          legLF: [-15, 15, 5, 0, 0, 0.5], legRF: [-15, -15, -5, 0, 0, 0.5], legLB: [6, 0, 3], legRB: [6, 0, -3] }),
      S(merge({ body: [-12, 0, 0, 0, 1.2, 1.0], abdomen: [10], fangs: [-26] }, THREAT)),
      S(merge({ body: [-12, 0, 0, 0, 1.2, 1.0], abdomen: [10], fangs: [-30] }, THREAT))
    ] },
    bite:   { durations: [100, 100, 100], loop: false, frames: [
      S({ body: [8, 0, 0, 0, -2.5, -0.3], abdomen: [-6], fangs: [22],
          legLF: [10, -5, 12], legRF: [10, 5, -12], legLB: [-8, 0, -4], legRB: [-8, 0, 4] }),
      S({ body: [6, 0, 0, 0, -2, -0.2], abdomen: [-4], fangs: [16],
          legLF: [8, -4, 10], legRF: [8, 4, -10], legLB: [-6, 0, -3], legRB: [-6, 0, 3] }),
      S({})
    ] },
    // web spit 1.0 s: rear up + fangs wide (held peak), RELEASE key 3 at 500 ms, recover
    spit:   { durations: [150, 250, 100, 120, 380], loop: false, frames: [
      S({ body: [-8, 0, 0, 0, 0.8, 0.8], abdomen: [8], fangs: [-14],
          legLF: [-10, 12, 4], legRF: [-10, -12, -4], legLB: [8, 0, 0], legRB: [8, 0, 0] }),
      S(merge({ body: [-16, 0, 0, 0, 1.6, 1.6], abdomen: [14], fangs: [-32] }, REAR)),
      S(merge({ body: [-16, 0, 0, 0, 1.6, 1.6], abdomen: [14], fangs: [-34] }, REAR)),
      S({ body: [6, 0, 0, 0, -1.2, 0], abdomen: [-4], fangs: [12],
          legLF: [0, 0, 10], legRF: [0, 0, -10], legLB: [-6, 0, 0], legRB: [-6, 0, 0] }),
      S({})
    ] },
    hurt:   { durations: [50, 50], loop: false, interp: 'step', frames: [
      S({ body: [-10, 0, 0, 0, 1.2, 0.5], abdomen: [6], fangs: [-12],
          legLF: [0, 14, 0], legRF: [0, -14, 0], legLB: [10, 12, 0], legRB: [10, -12, 0] }),
      S({ body: [-6, 0, 0, 0, 1, 0.3], abdomen: [4], fangs: [-8],
          legLF: [0, 8, 0], legRF: [0, -8, 0], legLB: [6, 8, 0], legRB: [6, -8, 0] })
    ] },
    flinch: { durations: [60, 90, 100], loop: false, frames: [
      S({ body: [-5, 0, 0, 0, 0.8, 0.3], fangs: [-6] }),
      S({ body: [3, 0, 0, 0, 0.2, 0], fangs: [3] }),
      S({})
    ] },
    // die 0.5 s: rears with fangs wide, rolls over (thud key 3), legs curl up over the belly
    die:    { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      S({ body: [-8, 0, 0, 0, 0, 1], fangs: [-20], legLF: [0, 20, 0], legRF: [0, -20, 0], legLB: [0, 20, 0], legRB: [0, -20, 0] }),
      S({ body: [0, 60, 0, 0, 0, 3], legLF: [0, -15, 0], legRF: [0, 15, 0], legLB: [0, -15, 0], legRB: [0, 15, 0] }),
      S({ body: [0, 130, 0, 0, 0, 3.5], legLF: [0, -35, 0], legRF: [0, 35, 0], legLB: [0, -35, 0], legRB: [0, 35, 0] }),
      S({ body: [0, 178, 0, 0, 0, 0.8], fangs: [10], legLF: [0, -50, 6], legRF: [0, 50, -6], legLB: [0, -50, -6], legRB: [0, 50, 6] }),
      DEAD
    ] },
    dead:   { durations: [1000], loop: true, frames: [DEAD] },
    sink:   { durations: [500, 100], loop: false, frames: [DEAD, SUNK] }
  };
  animations.charge = animations.run;

  var parts = {}, k;
  for (i = 0; i < ORDER.length; i++) {
    k = ORDER[i];
    parts[k] = { box: BOX[k], pivot: PIVOT[k] };
    if (PARENT[k]) parts[k].parent = PARENT[k];
  }

  A.models.woodSpider = {
    name: 'woodSpider',
    displayName: 'wood spider',
    desc: 'BEAST-D1 wood spider: 1.3 m leg span, 8 banded hairy legs with high knees, dark carapace with a pale stripe, ' +
          '8 eyes (6 shining), pale fangs under hairy chelicerae, oval abdomen with a dark lance and pale chevrons. ' +
          '8 parts (body, 4 leg pairs, abdomen, fangs, silk): idle, walk, run, canopy drop on a silk line, bite ' +
          'telegraph, bite, web spit, hurt, flinch, flip-over death, corpse, sink.',
    voxel: {
      version: 1,
      meshOnly: true,
      light: false,
      cellM: 0.05,
      size: [SX, SY, SZ],
      anchor: [13, 12, 0],
      mats: {
        B: 'hair_dark',          // dark hairy base: carapace, femora, metatarsi
        b: 'dye_walnut',         // warm brown hair: tibiae, abdomen, chelicerae front
        c: 'fur_agouti_light',   // pale bands, patellae, chevrons, marginal bands
        C: 'fur_cream',          // median carapace stripe
        K: 'fur_bear_dark',      // belly, sternum, leg tips, fovea, clypeus, spinnerets
        F: 'antler',             // fangs
        E: 'ember_glow',         // eyeshine
        s: 'linen_light'         // silk dragline
      },
      layers: layers(),
      parts: parts,
      animations: animations,
      mounts: {
        notice: { at: [13, 12, 15], part: 'body' },
        mouth:  { at: [12.5, 4.5, 1.5], part: 'fangs' },  // bite fx point between the fang tips
        spit:   { at: [13, 4, 3], part: 'fangs' },        // web blob spawn
        hit:    { at: [13, 14, 6], part: 'body' },
        loot:   { at: [13, 15, 6], part: 'body' },
        silkTop: { at: [12.5, 19.5, 32.5], part: 'silk' } // where the line meets the canopy (drop)
      }
    }
  };

  A.spiderFx = {
    version: 1,
    story: 'BEAST-D1 batch 1 (EP-BESTIARY #15 wood spider, #16 spiderling = scale 0.4; brain: new ambush)',
    model: 'woodSpider',
    clipFor: {
      state: { idle: 'idle', hidden: 'idle', notice: 'idle', wander: 'walk', return: 'walk', stalk: 'walk', chase: 'run',
               flee: 'run', drop: 'drop', ambush: 'drop', telegraph: 'windup', windup: 'windup', bite: 'bite',
               charge: 'run', spit: 'spit', recover: 'walk', stagger: 'flinch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink'
    },
    speeds: { walk: 0.7, run: 1.8, note: 'm/s at clip rate 1' },
    drop: { clip: 'drop', ms: 1000, hangUntilMs: 500, silkHiddenMs: 690, landKey: 4, landMs: 700, dangleM: 0.35, silkM: 1.15,
            note: 'the sim lowers the entity from the canopy and starts the clip ~0.7 s before touchdown; key 4 = the land squash' },
    telegraph: { clip: 'windup', ms: 500, note: 'bite telegraph >= 0.4 s (D-083); last key held' },
    bite: { clip: 'bite', ms: 300, hitKey: 0, hitMs: 100, reachM: 0.6 },
    spit: { clip: 'spit', ms: 1000, windupMs: 500, releaseKey: 3, releaseMs: 500, mount: 'spit',
            note: 'web blob (slow 40 % 2 s) spawned from mount spit at releaseMs; NEEDS ENGINE: the web blob / web-on-ground fx' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 9 },
    death: { note: 'beastView timeline', lootInteract: { prompt: '[E] Loot spider', radiusM: 1.4, aimUpM: 0.2 },
             sink: { clip: 'sink', depthM: 0.6 } },
    variants: { spiderling: { scale: 0.4 }, broodmother: { scale: 2.5 } },
    requiredClips: ['idle', 'walk', 'run', 'drop', 'windup', 'bite', 'spit', 'hurt', 'flinch', 'die', 'dead', 'sink', 'charge'],
    windups: [['windup', 500], ['spit', 500]],
    hiddenParts: ['silk'],
    budgetTris: 2400,
    previewSeqs: {
      'loop: idle': [['idle', 0]],
      'loop: walk': [['walk', 0]],
      'loop: run': [['run', 0]],
      'ambush: drop -> windup -> bite -> idle': [['drop', 1000], ['idle', 300], ['windup', 700], ['bite', 300], ['idle', 800]],
      'ranged: windup -> spit -> idle': [['spit', 1000], ['idle', 800]],
      'hit: hurt -> flinch -> run': [['hurt', 100], ['flinch', 250], ['run', 700], ['idle', 500]],
      'death: hurt -> die -> dead -> sink': [['hurt', 100], ['die', 500], ['dead', 1500], ['sink', 500], ['gone', 600]]
    },
    selfCheck: { clippedVoxels: CLIPPED, note: 'leg voxels clipped at the coxae by the body / pair boxes (info only)' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { woodSpider: A.models.woodSpider, spiderFx: A.spiderFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
