/* design/models/voxel_troll.js - BEAST-D1 batch 1: troll (EP-BESTIARY roster #24, tank: club slam, roar, boulder throw;
 * fire stops its regen; Troll King boss = scale 1.3). D-083, OB-153. Designer, PC-B lane 4, 2026-10-14.
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_goblin.js:
 *   <script src="../design/models/voxel_troll.js">          (browser)
 *   import '../../../design/models/voxel_troll.js';         (Node tests: side-effect import)
 * Sets ASSETS.models.troll and ASSETS.trollFx. NOT registered in game/js/main.js here. `meshOnly`.
 *
 * Axes (15.1): x = east (= the troll's RIGHT at yaw 0), y = SOUTH with low y = the FRONT (faces north at yaw 0), z = up.
 * cellM 0.08 (a 2.6 m tank; 0.05 would be ~4x the tris). Grid 30 x 22 x 33 = 2.4 x 1.76 x 2.64 m. Anchor [15, 14, 0]
 * = between the feet. Centre line x = 15 (cells 14 | 15); right side = mirror x -> 29 - x. Clip `pos` = VOXELS.
 *
 * LOOK (a realistic mountain troll from squares, style-guide 0: heavy primate-like build, not a cartoon ogre):
 *   - 2.6 m to the top of the HUMP, hunched: the small head hangs LOW and FORWARD of a huge shoulder hump, the back is
 *     overgrown with moss, a stringy black mane runs down the spine.
 *   - LONG heavy arms (knuckles at 0.4 m), stony callus plates on knuckles / elbows / knees, yellowed nails.
 *   - short thick bowed legs, huge flat 3-toed feet. Pot belly, a rope belt, a ragged hide loincloth.
 *   - head: heavy stony brow over small deep-set ember eyes, a long drooping nose, an UNDERBITE jaw (own part) with two
 *     tusks rising in front of the upper lip, small pointed ears.
 *   - weapon: a tree-trunk club in the RIGHT fist, held forward at knee height (iron band + spikes, a broken pale end);
 *     the LEFT hand is free (boulder throw, mount handL).
 * Colour (3 families + emissive eyes): grey skin g dye_gall > G dye_gall_light (belly, brow, knuckles lit) > d
 *   dye_gall_dark (creases, lips, throat) + s granite_dark stony plates; green M moss_cap on the hump, shoulders and
 *   crown; browns: H fur_roe_dark hide (+ F fur_roe patches), p rope, w timber_old club, c wood_cut end; h hair_black
 *   mane; T antler tusks; n linen_dark nails; m / r gore_red_dark / gore_red mouth; I iron_dark spikes; E ember_glow.
 *
 * Parts (8; insertion order = part index; parents EARLIER; each box sx+sy+sz <= 48; put() writes only owned voxels):
 *   body   box [6,8,12, 24,21,22]  hips, belly, belt, loincloth, lower chest. pivot [15, 14, 12] (hips). ROOT.
 *                                  rx + = bow / fall forward, ry = roll, rz = turn.
 *   chest  box [6,9,22, 24,22,33]  upper chest, shoulders, mossy HUMP, mane. pivot [15, 15, 21.5], parent body.
 *                                  rx + = hunch forward, rx - = rear back, rz = twist.
 *   head   box [11,1,24, 19,9,33]  skull, brow, eyes, nose, ears, upper lip. pivot [15, 8, 26] (neck), parent chest.
 *                                  rx - = chin up, rz = look.
 *   jaw    box [11,0,19, 19,8,26]  underbite jaw, tongue, lower teeth, TUSKS. pivot [15, 7, 23.5], parent head. rx + = OPEN.
 *   armL   box [1,11,5, 6,19,30]   left arm, free fist. pivot [3.5, 15, 27] (shoulder), parent chest. rx - = forward /
 *                                  up (-176 = overhead), ry + = out to the side.
 *   armR   box [24,0,5, 29,18,30]  right arm + CLUB. pivot [26.5, 15, 27], parent chest. rx - = forward / up (-178 =
 *                                  club cocked back over the head), ry - = out to the side.
 *   legL / legR box [7|16, 9, 0, 14|23, 18, 12]  pivot [10.5|19.5, 13.5, 11.5] (hip), parent body. rx - = foot
 *                                  forward, key pos z + = lifted swing foot.
 *
 * Clips (ms, multiples of 10):
 *   idle    loop 3.2 s  4 keys: heavy breathing (chest heaves), looks around, slack jaw, snort.
 *   walk    loop 1.2 s  4 keys: lumbering: hips roll and sway, shoulders counter-twist, the free arm swings, the club arm
 *                       only swings back (so the club never digs in). ~1.0 m/s.
 *   run     loop 0.7 s  4 keys: a hunched charging lope, ~2.5 m/s.
 *   slam    once 1.65 s 6 keys: BIG ATTACK (>= 0.8 s + ground marker, D-083): club raised (250) -> COCKED behind the head,
 *                       leaning back, snarl (400) -> held tremble (250, windup ends 900 ms) -> SLAM (120 ms) -> impact key 4
 *                       at 1020 ms (club on the ground ~2 m ahead, crouched) -> recover (450).
 *   roar    once 1.4 s  4 keys: inhale (200) -> ROAR: chest up, chin up, jaws wide, arms thrown out (250) -> held (500;
 *                       stagger event key 2 at 450 ms) -> settle (450).
 *   throw   once 1.6 s  5 keys: BOULDER: scoop (300) -> heave it over the head (400) -> held (200; windup ends 900 ms) ->
 *                       RELEASE key 3 (900-1020 ms, spawn at ~960) -> recover. The boulder is a prop at mount handL.
 *   hurt    once 0.1 s  2 step keys: rocked back, head snaps up, grunt.
 *   flinch  once 0.25 s 3 keys: back to stance.
 *   die     once 0.5 s  5 keys (beastView 90/110/120/80/100): bellow, knees buckle, topples FORWARD (thud key 3).
 *   dead    held        face down, arms along the body.    sink: 0.5 s, 1.3 m.
 *   Aliases: windup = slam, charge = run.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 30, SY = 22, SZ = 33, CX = 15;
  var ORDER = ['body', 'chest', 'head', 'jaw', 'armL', 'armR', 'legL', 'legR'];
  var BOX = {
    body: [6, 8, 12, 24, 21, 22], chest: [6, 9, 22, 24, 22, 33], head: [11, 1, 24, 19, 9, 33], jaw: [11, 0, 19, 19, 8, 26],
    armL: [1, 11, 5, 6, 19, 30], armR: [24, 0, 5, 29, 18, 30],
    legL: [7, 9, 0, 14, 18, 12], legR: [16, 9, 0, 23, 18, 12]
  };
  var PIVOT = {
    body: [15, 14, 12], chest: [15, 15, 21.5], head: [15, 8, 26], jaw: [15, 7, 23.5],
    armL: [3.5, 15, 27], armR: [26.5, 15, 27], legL: [10.5, 13.5, 11.5], legR: [19.5, 13.5, 11.5]
  };
  var PARENT = { chest: 'body', head: 'chest', jaw: 'head', armL: 'chest', armR: 'chest', legL: 'body', legR: 'body' };

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
  // one horizontal superellipse slice at height z (centre cx, cy; radii rx, ry; exponent p): col(x, y, z, nx, ny)
  function slab(part, z, cx, cy, rx, ry, p, col) {
    var x, y, nx, ny;
    for (y = Math.floor(cy - ry); y <= Math.floor(cy + ry); y++)
      for (x = Math.floor(cx - rx); x <= Math.floor(cx + rx); x++) {
        nx = (x + 0.5 - cx) / rx; ny = (y + 0.5 - cy) / ry;
        if (Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p) <= 1) put(part, x, y, z, col(x, y, z, nx, ny));
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
  // natural skin: grey base, dark creases, a few stony warts, lit tops left to the light
  function skin(x, y, z) {
    var h = hash(x, y, z);
    if (h < 0.1) return 's';
    if (h < 0.3) return 'd';
    if (h > 0.9) return 'G';
    return 'g';
  }

  // ---- legs (left written; right = mirror x -> 29 - x by writing with a mirrored centre) ----
  function buildLeg(part, m) {               // m(cx) maps a left-side centre to this side
    var z;
    slab(part, 0, m(10.5), 13.2, 3.4, 4.6, 2.6, function (x, y) {                          // foot sole + 3 toes
      if (y <= 9) return (x === m(8.5) - 0.5 || x === m(10.5) - 0.5 || x === m(12.5) - 0.5) ? 'n' : null;
      return y >= 16 ? 'd' : 'g';
    });
    slab(part, 1, m(10.5), 13.6, 3.0, 4.0, 2.6, function (x, y, zz) { return y <= 10 ? 'G' : skin(x, y, zz); });
    for (z = 2; z <= 5; z++) {                                                               // bowed shin, calf behind
      slab(part, z, m(z === 3 || z === 4 ? 10.1 : 10.5), z >= 4 ? 13.8 : 13.5, 2.6, z >= 4 ? 3.0 : 2.5, 2.4,
           function (x, y, zz, nx, ny) { return ny > 0.6 ? 'd' : skin(x, y, zz); });
    }
    for (z = 6; z <= 7; z++) {                                                               // knee + stony kneecap
      slab(part, z, m(10.5), 13.2, 2.9, 3.0, 2.4, function (x, y, zz, nx, ny) { return ny < -0.7 ? 's' : skin(x, y, zz); });
    }
    for (z = 8; z <= 11; z++) {                                                              // thick thigh
      slab(part, z, m(10.5), 13.5, 3.4, 3.5, 2.4, function (x, y, zz, nx, ny) { return ny < -0.75 && z >= 10 ? 'G' : skin(x, y, zz); });
    }
  }
  buildLeg('legL', function (c) { return c; });
  buildLeg('legR', function (c) { return 30 - c; });

  // ---- body: hips + loincloth (z12-13), rope belt (z14), pot belly (z15-17), lower chest (z18-21) ----
  (function buildBody() {
    var z;
    for (z = 12; z <= 13; z++) {
      slab('body', z, 15, 14, 8.6, 4.8, 2.4, function (x, y, zz) {
        var h = hash(x, y, zz);
        if (zz === 12 && h < 0.3) return null;                                              // ragged hem
        return h > 0.82 ? 'F' : 'H';
      });
    }
    slab('body', 14, 15, 13.8, 8.8, 5.4, 2.4, function (x, y, zz, nx, ny) {
      return Math.pow(Math.abs(nx), 2.4) + Math.pow(Math.abs(ny), 2.4) > 0.55 ? 'p' : 'g';
    });
    for (z = 15; z <= 17; z++) {
      slab('body', z, 15, 13.6, 8.8, 5.7, 2.4, function (x, y, zz, nx, ny) {
        if (ny < -0.8) return (zz === 16 && (x === 14 || x === 15) && y === 8) ? 'd' : 'G';   // pale belly, navel
        return ny > 0.7 && hash(x, y, zz) < 0.3 ? 's' : skin(x, y, zz);
      });
    }
    for (z = 18; z <= 21; z++) {
      slab('body', z, 15, 14, 8.8, 5.4, 2.4, function (x, y, zz, nx, ny) {
        if (ny > 0.7 && Math.abs(x + 0.5 - CX) < 2) return zz % 2 ? 'h' : 'd';                 // mane / spine furrow
        return ny > 0.7 && hash(x, y, zz) < 0.3 ? 's' : skin(x, y, zz);
      });
    }
  })();

  // ---- chest: shoulders + the mossy hump (z22..32); [cy, rx, ry] ----
  var CH = { 22: [14.5, 8.8, 5.6], 23: [14.5, 8.8, 5.6], 24: [14.5, 8.9, 5.6], 25: [14.6, 9.0, 5.8], 26: [14.6, 9.0, 5.8],
             27: [14.8, 9.0, 5.7], 28: [15, 8.2, 5.4], 29: [15.6, 7.0, 5.0], 30: [16.2, 5.8, 4.5], 31: [16.8, 4.6, 3.8],
             32: [17.4, 3.0, 2.8] };
  (function buildChest() {
    var z, c;
    for (z = 22; z <= 32; z++) {
      c = CH[z];
      slab('chest', z, 15, c[0], c[1], c[2], 2.4, function (x, y, zz, nx, ny) {
        var h = hash(x, y, zz);
        if (zz >= 29 && h < (zz - 27) * 0.2) return 'M';                                    // moss on the hump
        if (ny > 0.5 && Math.abs(x + 0.5 - CX) < 2) return zz % 2 ? 'h' : 'M';              // mane down the spine
        if (ny > 0.6 && h < 0.3) return 's';                                                // stony back plates
        if (zz >= 24 && zz <= 26 && ny < -0.7) return 'G';                                  // lit pecs
        return skin(x, y, zz);
      });
    }
  })();

  // ---- head: skull, brow, eyes, nose, ears, upper lip, mouth roof, hair ----
  (function buildHead() {
    var x, y, z, c;
    for (x = 12; x <= 17; x++) for (y = 3; y <= 7; y++) put('head', x, y, 24, y === 3 ? 'd' : 'm');   // upper lip, mouth roof
    for (z = 25; z <= 26; z++) for (x = 11; x <= 18; x++) for (y = 3; y <= 8; y++) {                 // cheeks / muzzle
      if (y === 3 && (x === 11 || x === 18)) continue;
      put('head', x, y, z, (x === 11 || x === 18) ? 'd' : skin(x, y, z));
    }
    for (z = 27; z <= 30; z++) for (x = 12; x <= 17; x++) for (y = 3; y <= 8; y++) {                 // skull
      if (z === 28 && y === 3 && (x === 13 || x === 16)) continue;                                   // deep eye sockets
      c = skin(x, y, z);
      if (y === 8 && hash(x, y, z) < 0.5) c = 'h';                                                    // hair at the back
      put('head', x, y, z, c);
    }
    put('head', 13, 4, 28, 'E'); put('head', 16, 4, 28, 'E');                                        // ember eyes
    for (x = 12; x <= 17; x++) put('head', x, 2, 29, (x === 12 || x === 17) ? null : 's');          // heavy stony brow
    for (x = 12; x <= 17; x++) for (y = 3; y <= 8; y++) put('head', x, y, 29, y === 3 ? 'G' : skin(x, y, 29));
    for (x = 13; x <= 16; x++) for (y = 4; y <= 8; y++) put('head', x, y, 31, hash(x, y, 31) < 0.5 ? 'M' : 'h');  // crown
    for (x = 13; x <= 16; x++) for (y = 5; y <= 7; y++) put('head', x, y, 32, 'h');
    for (z = 25; z <= 28; z++) { put('head', 14, 2, z, 'g'); put('head', 15, 2, z, 'g'); }             // long nose
    put('head', 14, 1, 25, 'G'); put('head', 15, 1, 25, 'G'); put('head', 14, 1, 26, 'G'); put('head', 15, 1, 26, 'G');   // bulb
    put('head', 14, 1, 24, 'd'); put('head', 15, 1, 24, 'd');                                         // nostrils
    put('head', 11, 6, 28, 'g'); put('head', 11, 7, 28, 'g'); put('head', 11, 6, 29, 'g'); put('head', 11, 7, 29, 'd'); put('head', 11, 7, 30, 'd');  // ears
    put('head', 18, 6, 28, 'g'); put('head', 18, 7, 28, 'g'); put('head', 18, 6, 29, 'g'); put('head', 18, 7, 29, 'd'); put('head', 18, 7, 30, 'd');
  })();

  // ---- jaw: underbite (front at y0), tongue, lower teeth, two tusks ----
  (function buildJaw() {
    var x, y;
    for (x = 12; x <= 17; x++) for (y = 0; y <= 7; y++)
      put('jaw', x, y, 23, y === 0 ? 'd' : (x === 12 || x === 17 || y === 7) ? 'g' : 'r');
    for (x = 11; x <= 18; x++) for (y = 0; y <= 7; y++) put('jaw', x, y, 22, (x === 11 || x === 18) ? 'd' : skin(x, y, 22));
    for (x = 12; x <= 17; x++) for (y = 1; y <= 7; y++) put('jaw', x, y, 21, y === 1 ? 'd' : skin(x, y, 21));
    for (x = 13; x <= 16; x++) { for (y = 3; y <= 7; y++) put('jaw', x, y, 20, 'd'); for (y = 5; y <= 7; y++) put('jaw', x, y, 19, 'd'); }
    put('jaw', 13, 0, 24, 'T'); put('jaw', 13, 0, 25, 'T'); put('jaw', 16, 0, 24, 'T'); put('jaw', 16, 0, 25, 'T');  // tusks
    put('jaw', 14, 0, 24, 'T'); put('jaw', 15, 0, 24, 'T');                                         // lower teeth
  })();

  // ---- arms: deltoid, upper arm, elbow, forearm, wrist, big fist (right = mirrored centre) + the club ----
  // z: [cx(left), cy, rx, ry]
  var ARM = { 5: [3.5, 14.2, 2.4, 3.2], 6: [3.5, 14, 2.6, 3.5], 7: [3.5, 14, 2.6, 3.5], 8: [3.5, 14.2, 2.5, 3.3],
              9: [3.5, 14.5, 2.0, 2.4], 10: [3.5, 14.6, 2.4, 3.0], 11: [3.5, 14.6, 2.4, 3.0], 12: [3.5, 14.6, 2.4, 3.0],
              13: [3.5, 14.6, 2.5, 3.2], 14: [3.5, 14.6, 2.5, 3.2], 15: [3.5, 14.6, 2.5, 3.2], 16: [3.5, 15.2, 2.3, 2.6],
              17: [3.5, 15.2, 2.3, 2.6], 18: [3.5, 15, 2.3, 2.4], 19: [3.5, 15, 2.3, 2.4], 20: [3.5, 15, 2.3, 2.4],
              21: [3.5, 15, 2.3, 2.4], 22: [3.5, 15, 2.3, 2.4], 23: [3.5, 15, 2.4, 2.6], 24: [3.5, 15, 2.5, 2.9],
              25: [3.6, 15, 2.6, 3.4], 26: [3.6, 15, 2.6, 3.4], 27: [3.6, 15, 2.6, 3.4], 28: [3.7, 15, 2.4, 3.2], 29: [3.8, 15.2, 2.0, 2.6] };
  function armCol(x, y, z, nx, ny) {
    var h = hash(x, y, z);
    if (z <= 8) {                                                                            // fist
      if (ny < -0.7) return z === 5 ? 'n' : (h < 0.5 ? 's' : 'G');                           // knuckles, nails
      return z === 5 ? 'd' : skin(x, y, z);
    }
    if ((z === 16 || z === 17) && ny > 0.6) return 's';                                      // elbow callus
    if (z >= 27 && h < 0.55) return 'M';                                                     // moss on the shoulder
    if (z >= 25 && h < 0.2) return 's';
    return skin(x, y, z);
  }
  function buildArm(part, mirror) {
    var z, a;
    for (z = 5; z <= 29; z++) {
      a = ARM[z];
      slab(part, z, mirror ? 30 - a[0] : a[0], a[1], a[2], a[3], 2.4, armCol);
    }
  }
  // the club first (the fist then wraps the grip)
  seg('armR', [26.5, 17.3, 7.0], [26.5, 9.0, 6.8], 0.95, 1.1, function (x, y, z) { return y >= 11 ? 'H' : 'w'; });   // hide-wrapped grip, shaft
  seg('armR', [26.5, 9.0, 6.8], [26.5, 1.4, 6.6], 1.1, 2.05, function (x, y, z, t) {
    var h = hash(x, y, z);
    if (y <= 1) return 'c';                                                                  // broken pale end
    if (y === 5) return 'I';                                                                 // iron band
    if (t > 0.45 && h < 0.18) return 'I';                                                    // spikes / nails
    return h < 0.25 ? 'd' : 'w';
  });
  buildArm('armL', false);
  buildArm('armR', true);

  // ---- clips ----
  var COCK = { body: [0, 0, 0, 0, 0.5, -1], legL: [-14], legR: [10] };
  function with2(o, more) { var r = {}, k; for (k in more) r[k] = more[k]; for (k in o) r[k] = o[k]; return r; }
  var ROAR_LEGS = { legL: [-6, 0, -4], legR: [6, 0, 4] };
  var DEAD_O = { body: [85, 0, 0, 0, 0, -6], legL: [-30, 0, -6], legR: [-25, 0, 6], head: [-45, 0, 35], jaw: [14],
                 armL: [-25, 20, 0], armR: [-25, -20, 0] };
  var DEAD = F(DEAD_O);
  var SUNK = F({ body: [85, 0, 0, 0, 0, -22], legL: [-30, 0, -6], legR: [-25, 0, 6], head: [-45, 0, 35], jaw: [14],
                 armL: [-25, 20, 0], armR: [-25, -20, 0] });

  var animations = {
    idle:   { durations: [900, 700, 900, 700], loop: true, frames: [
      F({ jaw: [4], armR: [2] }),
      F({ body: [0, 0, 0, 0, 0, 0.3], chest: [-2], head: [-3, 0, 8], jaw: [8], armL: [-3, 4, 0], armR: [3] }),
      F({ chest: [1, 0, 2], head: [2, 0, -10], jaw: [3], armL: [2] }),
      F({ body: [0, 0, 0, 0, 0, 0.3], chest: [-2], head: [-4], jaw: [10], armR: [4] })
    ] },
    walk:   { durations: [300, 300, 300, 300], loop: true, frames: [
      F({ body: [0, 3, 5, 0, 0, -0.6], chest: [6, 0, -7], head: [-4, 0, 5], jaw: [5], legL: [-20], legR: [17], armL: [14], armR: [2] }),
      F({ body: [0, 0, 0, 0, 0, 0.4], chest: [6], head: [-4], jaw: [3], legR: [-4, 0, 0, 0, 0, 1.6], armR: [6] }),
      F({ body: [0, -3, -5, 0, 0, -0.6], chest: [6, 0, 7], head: [-4, 0, -5], jaw: [5], legL: [17], legR: [-20], armL: [-12], armR: [12] }),
      F({ body: [0, 0, 0, 0, 0, 0.4], chest: [6], head: [-4], jaw: [3], legL: [-4, 0, 0, 0, 0, 1.6], armR: [6] })
    ] },
    run:    { durations: [170, 180, 170, 180], loop: true, frames: [
      F({ body: [0, 3, 6, 0, 0, -1], chest: [18, 0, -8], head: [-14, 0, 4], jaw: [12], legL: [-32], legR: [26], armL: [28], armR: [4] }),
      F({ body: [0, 0, 0, 0, 0, 1], chest: [18], head: [-12], jaw: [8], legL: [6], legR: [-6, 0, 0, 0, 0, 2.5], armL: [6], armR: [10] }),
      F({ body: [0, -3, -6, 0, 0, -1], chest: [18, 0, 8], head: [-14, 0, -4], jaw: [12], legL: [26], legR: [-32], armL: [-24], armR: [20] }),
      F({ body: [0, 0, 0, 0, 0, 1], chest: [18], head: [-12], jaw: [8], legL: [-6, 0, 0, 0, 0, 2.5], legR: [6], armL: [0], armR: [10] })
    ] },
    // BIG ATTACK: raise (250) -> cocked (400) -> held (250, windup ends 900) -> SLAM (120) -> impact key 4 at 1020 -> recover
    slam:   { durations: [250, 400, 250, 120, 180, 450], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 0, -0.5], chest: [-6, 0, -6], head: [-10], jaw: [10], armL: [-30, 18, 0], armR: [-90, -6, 0], legL: [-10], legR: [8] }),
      F(with2({ chest: [-15, 0, -12], head: [-14, 0, 4], jaw: [18], armL: [-40, 22, 0], armR: [-175, -6, 0] }, COCK)),
      F(with2({ chest: [-17, 0, -13], head: [-16, 0, 4], jaw: [22], armL: [-42, 24, 0], armR: [-178, -6, 0] }, COCK)),
      F({ body: [0, 0, 0, 0, -2, -1.5], chest: [32, 0, 10], head: [10, 0, -4], jaw: [6], armL: [-24, 10, 0], armR: [-28, 4, 0], legL: [-28], legR: [18] }),
      F({ body: [0, 0, 0, 0, -2, -1.6], chest: [34, 0, 10], head: [12, 0, -4], jaw: [4], armL: [-22, 10, 0], armR: [-22, 4, 0], legL: [-28], legR: [18] }),
      F({})
    ] },
    roar:   { durations: [200, 250, 500, 450], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 0, 0.3], chest: [-10], head: [-10], jaw: [8], armL: [-10, 12, 0], armR: [-6, -10, 0] }),
      F(with2({ body: [0, 0, 0, 0, 0.5, 0.6], chest: [-18], head: [-30], jaw: [32], armL: [-30, 42, 0], armR: [-24, -40, 0] }, ROAR_LEGS)),
      F(with2({ body: [0, 0, 0, 0, 0.5, 0.6], chest: [-20, 0, 2], head: [-28, 0, -3], jaw: [30], armL: [-34, 46, 0], armR: [-28, -44, 0] }, ROAR_LEGS)),
      F({})
    ] },
    // boulder throw with the free LEFT hand: scoop -> heave overhead -> held (windup ends 900) -> RELEASE key 3 -> recover
    throw:  { durations: [300, 400, 200, 120, 580], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 0, -1.5], chest: [26, 0, 6], head: [8], armL: [-35, 6, 0], armR: [8], legL: [-12], legR: [10] }),
      F({ body: [0, 0, 0, 0, 0.6, 0], chest: [-14, 0, -14], head: [-14, 0, -6], jaw: [14], armL: [-170, 8, 0], armR: [10, -8, 0], legL: [-6], legR: [12] }),
      F({ body: [0, 0, 0, 0, 0.6, 0], chest: [-16, 0, -16], head: [-14, 0, -6], jaw: [18], armL: [-176, 8, 0], armR: [10, -8, 0], legL: [-6], legR: [12] }),
      F({ body: [0, 0, 0, 0, -1, -0.6], chest: [22, 0, 12], head: [6, 0, 6], jaw: [6], armL: [-60], armR: [6], legL: [-20], legR: [14] }),
      F({})
    ] },
    hurt:   { durations: [50, 50], loop: false, interp: 'step', frames: [
      F({ body: [0, 0, 0, 0, 1, 0], chest: [-10], head: [-16], jaw: [16], armL: [0, 8, 0], armR: [0, -8, 0] }),
      F({ body: [0, 0, 0, 0, 0.8, 0], chest: [-6], head: [-10], jaw: [10], armL: [0, 5, 0], armR: [0, -5, 0] })
    ] },
    flinch: { durations: [60, 90, 100], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 0.6, 0], chest: [-5], head: [-8], jaw: [8] }),
      F({ chest: [3], head: [3] }),
      F({})
    ] },
    // die 0.5 s: bellow, knees buckle, topple forward (thud key 3), settle face down
    die:    { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      F({ chest: [-8], head: [-22], jaw: [28], armL: [-10, 10, 0], armR: [-10, -10, 0] }),
      F({ body: [12, 0, 0, 0, 0, -2.5], chest: [12], head: [8], jaw: [18], legL: [-30], legR: [-26] }),
      F({ body: [45, 0, 0, 0, 0, -4.5], chest: [6], head: [-10], jaw: [16], legL: [-34], legR: [-30], armL: [-20, 18, 0], armR: [-20, -18, 0] }),
      F({ body: [88, 0, 0, 0, 0, -6.2], head: [-40, 0, 30], jaw: [16], legL: [-30], legR: [-25], armL: [-26, 22, 0], armR: [-26, -22, 0] }),
      DEAD
    ] },
    dead:   { durations: [1000], loop: true, frames: [DEAD] },
    sink:   { durations: [500, 100], loop: false, frames: [DEAD, SUNK] }
  };
  animations.windup = animations.slam;
  animations.charge = animations.run;

  var parts = {}, i, k;
  for (i = 0; i < ORDER.length; i++) {
    k = ORDER[i];
    parts[k] = { box: BOX[k], pivot: PIVOT[k] };
    if (PARENT[k]) parts[k].parent = PARENT[k];
  }

  A.models.troll = {
    name: 'troll',
    displayName: 'troll',
    desc: 'BEAST-D1 troll: 2.6 m to the mossy shoulder hump, hunched, long heavy arms, short bowed legs and huge flat ' +
          'feet; grey stony skin with granite callus plates, a black mane, a small low head with a stony brow, ember ' +
          'eyes, a drooping nose and an underbite with tusks; hide loincloth, rope belt; a spiked tree-trunk club in the ' +
          'right fist. 8 parts: idle, lumbering walk, charging run, club slam (0.9 s wind-up), roar, boulder throw, ' +
          'hurt, flinch, forward fall, corpse, sink.',
    voxel: {
      version: 1,
      meshOnly: true,
      light: false,
      cellM: 0.08,
      size: [SX, SY, SZ],
      anchor: [15, 14, 0],
      mats: {
        g: 'dye_gall',         // grey skin
        G: 'dye_gall_light',   // lit skin: belly, pecs, brow, knuckles, foot tops
        d: 'dye_gall_dark',    // creases, lips, throat, soles
        s: 'granite_dark',     // stony callus plates and warts
        M: 'moss_cap',         // moss on the hump, shoulders, crown
        h: 'hair_black',       // mane, hair
        E: 'ember_glow',       // eyes
        T: 'antler',           // tusks, lower teeth
        n: 'linen_dark',       // yellowed nails
        m: 'gore_red_dark',    // roof of the mouth
        r: 'gore_red',         // tongue
        H: 'fur_roe_dark',     // hide loincloth, grip wrap
        F: 'fur_roe',          // lighter hide patches
        p: 'rope',             // belt
        w: 'timber_old',       // club
        c: 'wood_cut',         // the club's broken end
        I: 'iron_dark'         // iron band and spikes
      },
      layers: layers(),
      parts: parts,
      animations: animations,
      mounts: {
        notice:  { at: [15, 15, 36], part: 'chest' },     // 2.9 m
        mouth:   { at: [15, 2, 23.5], part: 'jaw' },      // roar fx
        hit:     { at: [15, 13, 18], part: 'body' },
        loot:    { at: [15, 14, 16], part: 'body' },      // the back of the face-down corpse
        handL:   { at: [3.5, 12.5, 6.5], part: 'armL' },  // boulder prop / spawn
        clubTip: { at: [26.5, 1.5, 6.6], part: 'armR' }   // slam impact dust + ground marker origin
      }
    }
  };

  A.trollFx = {
    version: 1,
    story: 'BEAST-D1 batch 1 (EP-BESTIARY #24 troll; Troll King boss = scale 1.3; brain: bearBrain + ranged)',
    model: 'troll',
    clipFor: {
      state: { idle: 'idle', notice: 'roar', wander: 'walk', return: 'walk', stalk: 'walk', chase: 'run', flee: 'run',
               telegraph: 'slam', windup: 'slam', slam: 'slam', attack: 'slam', charge: 'run', roar: 'roar',
               throw: 'throw', recover: 'walk', stagger: 'flinch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink',
      note: 'windup and slam both map to `slam` so the clip does not restart'
    },
    speeds: { walk: 1.0, run: 2.5, note: 'm/s at clip rate 1' },
    slam: { clip: 'slam', ms: 1650, windupMs: 900, impactKey: 4, impactMs: 1020, aoeM: 2.5, aheadM: 2.0, mount: 'clubTip',
            note: 'D-083 big attack: wind-up >= 0.8 s with a ground marker glyph at aheadM from 0 ms (NEEDS ENGINE: ground ' +
                  'marker decal); dust burst at mount clubTip at impactMs' },
    roar: { clip: 'roar', ms: 1400, staggerKey: 2, staggerMs: 450, note: 'player stagger 0.3 s at staggerMs (cave-bear rule)' },
    throw: { clip: 'throw', ms: 1600, windupMs: 900, releaseKey: 3, releaseMs: 960, rangeM: 20, mount: 'handL',
             note: 'boulder: show a rock prop at mount handL from 300 ms to releaseMs (NEEDS ENGINE: attach a prop to a ' +
                   'mount), then the sim spawns the projectile' },
    regen: { pctPerSec: 2, stoppedByFire: true, note: 'view hint: while regen is blocked by fire, tint the moss voxels ash (optional)' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 9 },
    death: { note: 'beastView timeline; the corpse lies face down ~1.2 m in front of the anchor',
             corpseCentre: { rightM: 0, fwdM: 1.2, upM: 0.4 },
             lootInteract: { prompt: '[E] Loot troll', radiusM: 2.2, aimUpM: 0.5 }, sink: { clip: 'sink', depthM: 1.3 } },
    variants: { trollKing: { scale: 1.3 } },
    requiredClips: ['idle', 'walk', 'run', 'slam', 'roar', 'throw', 'hurt', 'flinch', 'die', 'dead', 'sink', 'windup', 'charge'],
    windups: [['slam', 900], ['throw', 900]],
    budgetTris: 3000,
    previewSeqs: {
      'loop: idle': [['idle', 0]],
      'loop: walk': [['walk', 0]],
      'loop: run': [['run', 0]],
      'attack: slam -> idle': [['slam', 1650], ['idle', 900]],
      'roar -> idle': [['roar', 1400], ['idle', 800]],
      'ranged: throw -> idle': [['throw', 1600], ['idle', 800]],
      'hit: hurt -> flinch -> idle': [['hurt', 100], ['flinch', 250], ['idle', 900]],
      'death: hurt -> die -> dead -> sink': [['hurt', 100], ['die', 500], ['dead', 1500], ['sink', 500], ['gone', 600]]
    },
    selfCheck: { clippedVoxels: CLIPPED, note: 'shape voxels outside their own part box (info only)' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { troll: A.models.troll, trollFx: A.trollFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
