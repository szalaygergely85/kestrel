/* design/models/voxel_crocodile.js - BEAST-D1 batch 1: river crocodile (EP-BESTIARY roster #11, D-083, OB-153;
 * grab rule D-096 "short grab": grab + hold 1.5 s, NO death roll). Designer, PC-B lane 4, 2026-10-14.
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_wolf.js:
 *   <script src="../design/models/voxel_crocodile.js">     (browser)
 *   import '../../../design/models/voxel_crocodile.js';    (Node tests: side-effect import)
 * Sets ASSETS.models.crocodile (format: design/README.md section 4/7, architecture.md 15.1) and ASSETS.crocFx (state ->
 * clip map, timings, self-check). NOT registered in game/js/main.js here. `meshOnly`. Only merged palette materials.
 *
 * Axes (15.1): x = east (= the croc's RIGHT at yaw 0), y = SOUTH with y0 = the snout tip (faces north at yaw 0), z = up.
 * cellM 0.07 (a 3.5 m animal: 0.05 would be 70 voxels long and far over the tri budget). Grid 16 x 50 x 9 =
 * 1.12 x 3.5 x 0.63 m. Anchor [8, 16, 0] = on the ground under the middle of the trunk. Clip `pos` values are VOXELS.
 *
 * ANATOMY (realistic Nile / saltwater croc from squares, style-guide 0; 4 legs on the ground in every clip):
 *   - 3.5 m: head 0.56 m (1/6), trunk 1.2 m, tail 1.75 m (half the length), flat and LOW: 0.5 m at the back scutes.
 *   - long flat snout (4 voxels wide), wider skull table at the back, raised eye bumps (ember eyeshine, crocs really
 *     shine red at night), a dark nostril knob on the snout tip, interlocking teeth showing along the closed mouth.
 *   - lower jaw its own part (pale ochre underside); inside the mouth pink-red (gore_red*), seen when the jaws open.
 *   - trunk: flat pale belly, rounded flanks, paired raised dorsal scute rows (dark), dark cross-bands.
 *   - sprawled legs: upper limb out sideways, elbow / knee at the side, 4-toed feet with dark claws; hind legs larger.
 *   - tail: tapers 8 -> 1 wide, double scute crest turning into a single tall crest, dark bands.
 * Colour (one olive hue family + pale ochre belly): O dye_lincoln_dark scutes / bands > o dye_lincoln back > l
 *   dye_lincoln_light flanks / legs > b dye_weld_light belly, w dye_weld jaw sides; teeth linen_light; mouth gore_red*;
 *   nostrils / claws iron_dark; eyes ember_glow.
 *
 * Parts (8 = MAX_VOX_PARTS; insertion order = part index; parents EARLIER; every box sx+sy+sz <= 48, style-guide 5.14;
 * the put() helper only writes a voxel where its part OWNS it, so no voxel can be stolen by an earlier box):
 *   body  box [3,8,1, 13,25,8]   pivot [8, 16, 3.5] (trunk centre). ROOT. rx + = nose down, ry + = roll top to the
 *                                right (175 = belly up), rz + = turn right.
 *   head  box [3,0,3, 13,8,8]    pivot [8, 8, 4] (neck). rx - = LIFT the snout (the upper jaw opens UP like a real croc),
 *                                rz = look / shake sideways, ry = twist.
 *   jaw   box [3,0,1, 13,8,3]    pivot [8, 7, 2.5] (hinge at the back of the lower jaw), parent head. rx + = OPEN.
 *   legFL / legFR box [0|13, 9, 0, 3|16, 14, 5]  pivot [3|13, 10.5, 2.5] (shoulder at the body side), parent body.
 *   legBL / legBR box [0|13, 18, 0, 3|16, 25, 5] pivot [3|13, 21, 3] (hip), parent body.
 *                                SPRAWLED limbs swing in the horizontal plane: LEFT legs rz + = foot forward, RIGHT legs
 *                                rz - = foot forward; ry (left -, right +) pushes the foot down = lifts the belly (high
 *                                walk); key pos z + = a lifted swing foot.
 *   tail  box [4,25,0, 12,50,8]  pivot [8, 25, 3] (root), parent body. rz = sweep (swim / thrash), rx - = lift.
 *
 * Clips (ms, multiples of 10; ALL four legs on the ground except the view-only lunge arc):
 *   idle     loop 3.2 s  3 keys: lurking, breathing, slow tail sway, a basking gape (jaws open ~16 deg).
 *   walk     loop 0.8 s  4 keys: the "high walk": belly lifted 4 cm, diagonal pairs (FL+BR / FR+BL), body + tail
 *                        undulate, head counter-turns. Foot-slide free at ~0.45 m/s (crocFx.speeds).
 *   run      loop 0.4 s  4 keys: the same gait, bigger and faster, belly 7 cm up, strong tail sweep (~1.4 m/s burst).
 *   swim     loop 1.0 s  4 keys: legs folded back along the flanks, the tail drives (+-24 deg travelling wave).
 *   windup   once 0.6 s  3 keys: the LUNGE TELEGRAPH (>= 0.4 s, D-083): draws back 0.15 m and sinks, head low and level,
 *                        hind legs gather forward, tail coils 34 deg to one side, the jaws part. Last key held.
 *   lunge    once 0.5 s  4 keys: launch -> jaws WIDEST (key 1, 100-250 ms, ~48 deg gape) -> SNAP (key 2 at 250 ms) ->
 *                        settled. View-only 0.25 m forward / 0.1 m up arc; the sim moves the entity (reach 4 m).
 *   grab     loop 0.6 s  4 keys: jaws clamped, head shakes +-16 deg with a twist, body braces, tail thrashes. D-096:
 *                        play it for the 1.5 s hold (2.5 loops), then `release`. No death roll.
 *   release  once 0.4 s  3 keys: jaws open (let go), backs off 6 cm, rest.
 *   hurt     once 0.1 s  2 step keys: jolt back, head up, hiss (jaw 18), tail lashes.
 *   flinch   once 0.25 s 3 keys: follow-through to rest (boar / wolf contract).
 *   die      once 0.5 s  5 keys (beastView DIE_DURATIONS 90/110/120/80/100): hiss, roll over, BELLY UP (thud key 3).
 *   dead     held        belly up, legs in the air, jaws slack.      sink: 0.5 s, 0.63 m into the ground.
 *   Aliases: charge = lunge (boar-view windup -> charge works unchanged).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 16, SY = 50, SZ = 9, CX = 8;
  var ORDER = ['body', 'head', 'jaw', 'legFL', 'legFR', 'legBL', 'legBR', 'tail'];
  var BOX = {
    body: [3, 8, 1, 13, 25, 8], head: [3, 0, 3, 13, 8, 8], jaw: [3, 0, 1, 13, 8, 3],
    legFL: [0, 9, 0, 3, 14, 5], legFR: [13, 9, 0, 16, 14, 5],
    legBL: [0, 18, 0, 3, 25, 5], legBR: [13, 18, 0, 16, 25, 5],
    tail: [4, 25, 0, 12, 50, 8]
  };
  var PIVOT = {
    body: [8, 16, 3.5], head: [8, 8, 4], jaw: [8, 7, 2.5],
    legFL: [3, 10.5, 2.5], legFR: [13, 10.5, 2.5], legBL: [3, 21, 3], legBR: [13, 21, 3],
    tail: [8, 25, 3]
  };
  var PARENT = { head: 'body', jaw: 'head', legFL: 'body', legFR: 'body', legBL: 'body', legBR: 'body', tail: 'body' };

  // ---- shared BEAST-D1 helper block: grid + ownership-safe writes ----
  var g = [], CLIPPED = 0, gx, gy, gz;
  for (gz = 0; gz < SZ; gz++) { g.push([]); for (gy = 0; gy < SY; gy++) { g[gz].push([]); for (gx = 0; gx < SX; gx++) g[gz][gy].push('.'); } }
  function inBox(b, x, y, z) { return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; }
  // writes only where `part` will OWN the voxel (inside its box, outside every earlier box); else counts it as clipped
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
  function layers() {
    var out = [], z, y;
    for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(g[z][y].join('')); out.push(rows); }
    return out;
  }
  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }
  // frame from { part: [rx, ry, rz, px, py, pz] } (missing part / entries = rest)
  function F(o) {
    var f = {}, i, p, v;
    for (i = 0; i < ORDER.length; i++) {
      p = ORDER[i]; v = o[p] || [];
      f[p] = { rot: [r3(v[0] || 0), r3(v[1] || 0), r3(v[2] || 0)], pos: [r3(v[3] || 0), r3(v[4] || 0), r3(v[5] || 0)] };
    }
    return f;
  }

  // ---- body (trunk y8..24): [half-width, top z]; belly z1. Half-widths are in centre-distance units (4.5 = 10 wide) ----
  var BODY = { 8: [3.5, 5], 9: [3.5, 5], 10: [4.5, 5], 11: [4.5, 6], 12: [4.5, 6], 13: [4.5, 6], 14: [4.5, 6], 15: [4.5, 6],
               16: [4.5, 6], 17: [4.5, 6], 18: [4.5, 6], 19: [4.5, 6], 20: [4.5, 6], 21: [4.5, 6], 22: [4.5, 5], 23: [3.5, 5],
               24: [3.5, 5] };
  function bodyCol(x, y, z, d, hw, zt) {
    if (z === 1) return 'b';                                            // pale belly
    if (z === 2) return d >= hw - 0.5 ? 'l' : 'b';                      // pale lower flank
    if (z === 3) return d >= hw - 0.5 ? (hash(x, y, z) < 0.3 ? 'o' : 'l') : 'o';
    if (z === zt) {
      if (y % 4 === 0) return 'O';                                      // dark cross-band
      return ((d === 1.5 || d === 3.5) && y % 2 === 0) ? 'O' : 'o';     // scute rows
    }
    return hash(x, y, z) < 0.28 ? 'O' : 'o';                           // blotched flanks
  }
  (function buildBody() {
    var y, z, x, p, hw, zt, d, lim;
    for (y = 8; y <= 24; y++) {
      p = BODY[y]; hw = p[0]; zt = p[1];
      for (z = 1; z <= zt; z++) {
        lim = (z === zt || z === 1) ? hw - 1 : hw;
        for (x = 3; x <= 12; x++) { d = dxOf(x); if (d <= lim) put('body', x, y, z, bodyCol(x, y, z, d, hw, zt)); }
      }
      if (y >= 10 && y % 2 === 0) { put('body', 6, y, zt + 1, 'O'); put('body', 9, y, zt + 1, 'O'); }   // raised paired scutes
    }
  })();

  // ---- head (y0 snout tip .. y7 skull table), z3 = the mouth line (teeth / pink roof), jaw is its own part ----
  var HEAD = [[1.5, 4], [1.5, 4], [1.5, 4], [1.5, 4], [2.5, 4], [2.5, 4], [2.5, 5], [3.5, 5]];
  (function buildHead() {
    var y, z, x, hw, zt, d, lim, c;
    for (y = 0; y <= 7; y++) {
      hw = HEAD[y][0]; zt = HEAD[y][1];
      for (z = 3; z <= zt; z++) {
        lim = z === zt ? Math.max(0.5, hw - 1) : hw;
        for (x = 3; x <= 12; x++) {
          d = dxOf(x); if (d > lim) continue;
          if (z === 3) c = d >= hw - 0.5 ? (y % 2 === 1 ? 't' : 'l') : (y === 0 ? 'o' : 'm');   // teeth / roof of the mouth
          else if (y === 0 && z === 4) c = 'N';                                                  // nostril knob
          else if (z === zt) c = y >= 7 ? 'O' : (hash(x, y, z) < 0.22 ? 'O' : 'o');
          else c = 'o';
          put('head', x, y, z, c);
        }
      }
    }
    // raised eye bumps (orbits) with forward / outward-facing ember eyes
    put('head', 5, 5, 5, 'E'); put('head', 10, 5, 5, 'E');
    put('head', 6, 5, 5, 'O'); put('head', 9, 5, 5, 'O');
    put('head', 5, 6, 5, 'o'); put('head', 10, 6, 5, 'o');
  })();

  // ---- jaw (y0..7, z1..2): ochre sides, pale underside, teeth on the even rows (interlock with the upper odd rows) ----
  var JAW = [1.5, 1.5, 1.5, 1.5, 2.5, 2.5, 3.5, 3.5];
  (function buildJaw() {
    var y, z, x, hw, d, lim, c;
    for (y = 0; y <= 7; y++) {
      hw = JAW[y];
      for (z = 1; z <= 2; z++) {
        lim = z === 1 ? Math.max(0.5, hw - 1) : hw;
        for (x = 3; x <= 12; x++) {
          d = dxOf(x); if (d > lim) continue;
          if (z === 1) c = d >= lim - 0.5 ? 'w' : 'b';
          else c = d >= hw - 0.5 ? (y % 2 === 0 ? 't' : 'l') : (y === 0 ? 'l' : 'r');
          put('jaw', x, y, z, c);
        }
      }
    }
  })();

  // ---- legs (left side written, right = mirror x -> 15 - x) ----
  var FRONT_LEG = [[2, 10, 2, 'o'], [2, 11, 2, 'o'], [2, 10, 3, 'o'], [2, 11, 3, 'o'],          // upper arm out of the flank
                   [1, 10, 2, 'o'], [1, 11, 2, 'o'], [1, 11, 3, 'o'],                            // elbow at the side
                   [0, 11, 2, 'l'], [0, 11, 1, 'l'], [1, 10, 1, 'l'], [1, 11, 1, 'l'], [0, 10, 1, 'l'], // forearm down
                   [0, 9, 0, 'N'], [1, 9, 0, 'l'], [2, 9, 0, 'N'],                               // toes + claws
                   [0, 10, 0, 'l'], [1, 10, 0, 'l'], [2, 10, 0, 'l'], [0, 11, 0, 'l'], [1, 11, 0, 'l'], [1, 12, 0, 'l']];
  var HIND_LEG = [[2, 20, 2, 'o'], [2, 21, 2, 'o'], [2, 22, 2, 'o'], [2, 20, 3, 'o'], [2, 21, 3, 'o'], [2, 22, 3, 'o'],
                  [2, 21, 4, 'o'],                                                               // thick thigh
                  [1, 20, 2, 'o'], [1, 21, 2, 'o'], [1, 22, 2, 'o'], [1, 21, 3, 'o'], [1, 22, 3, 'O'],  // knee
                  [0, 21, 2, 'o'], [0, 22, 2, 'l'], [0, 21, 1, 'l'], [0, 22, 1, 'l'], [1, 21, 1, 'l'], [1, 22, 1, 'l'],
                  [0, 19, 0, 'N'], [1, 19, 0, 'N'], [2, 19, 0, 'N'],                             // claws
                  [0, 20, 0, 'l'], [1, 20, 0, 'l'], [2, 20, 0, 'l'], [0, 21, 0, 'l'], [1, 21, 0, 'l'], [2, 21, 0, 'l'],
                  [0, 22, 0, 'l'], [1, 22, 0, 'l'], [1, 23, 0, 'l']];
  (function buildLegs() {
    var i, v;
    for (i = 0; i < FRONT_LEG.length; i++) { v = FRONT_LEG[i]; put('legFL', v[0], v[1], v[2], v[3]); put('legFR', 15 - v[0], v[1], v[2], v[3]); }
    for (i = 0; i < HIND_LEG.length; i++) { v = HIND_LEG[i]; put('legBL', v[0], v[1], v[2], v[3]); put('legBR', 15 - v[0], v[1], v[2], v[3]); }
  })();

  // ---- tail (y25..49): tapers 8 -> 1 wide and 5 -> 3 tall, crest pair -> single crest, dark bands every 9 rows ----
  (function buildTail() {
    var y, z, x, i, t, hw, zt, zb, lim, d, band, c;
    for (y = 25; y <= 49; y++) {
      i = y - 25; t = i / 24;
      hw = 3.5 - 3 * t; zt = Math.round(5 - 3 * t); zb = i >= 20 ? 0 : 1;
      band = Math.floor(i / 3) % 3 === 0;
      for (z = zb; z <= zt; z++) {
        lim = (z === zt || z === zb) ? Math.max(0.5, hw - 1) : hw;
        for (x = 4; x <= 11; x++) {
          d = dxOf(x); if (d > lim + 1e-9) continue;
          if (z === zb && hw >= 1.5) c = 'b';
          else if (z === zb + 1 && d >= lim - 0.5) c = 'l';
          else if (z >= zt - 1 && band) c = 'O';
          else c = hash(x, y, z) < 0.2 ? 'O' : 'o';
          put('tail', x, y, z, c);
        }
      }
      if (i % 2 === 0) {
        if (i < 10) { put('tail', 6, y, zt + 1, 'O'); put('tail', 9, y, zt + 1, 'O'); }
        else { put('tail', 7, y, zt + 1, 'O'); put('tail', 8, y, zt + 1, 'O'); }
      }
    }
  })();

  // ---- clips ----
  // gait: pair A = FL + BR, pair B = FR + BL; left-signed swing (+ = foot forward); ry pushes the feet down (high walk)
  function gait(i, amp, lift, bz, yaw, tailAmp, ry) {
    var a = [1, 0, -0.8, 0][i], b = [-0.8, 0, 1, 0][i], la = [0, 0, 0, 1][i], lb = [0, 1, 0, 0][i], s = [1, 0, -1, 0][i];
    return F({
      body: [0, 0, yaw * s, 0, 0, bz], head: [0, 0, -yaw * s * 0.8],
      legFL: [0, -ry, amp * a, 0, 0, lift * la], legBR: [0, ry, -amp * a, 0, 0, lift * la],
      legFR: [0, ry, -amp * b, 0, 0, lift * lb], legBL: [0, -ry, amp * b, 0, 0, lift * lb],
      tail: [0, 0, -tailAmp * s]
    });
  }
  function swim(i) {
    var s = [1, 0, -1, 0][i], c = [0, 1, 0, -1][i];
    return F({
      body: [0, 0, 4 * s], head: [0, 0, -3 * s],
      legFL: [0, 10, -55], legFR: [0, -10, 55], legBL: [0, 10, -65], legBR: [0, -10, 65],
      tail: [0, 0, 24 * c]
    });
  }
  var i, walk = [], run = [], swimK = [];
  for (i = 0; i < 4; i++) { walk.push(gait(i, 25, 1, 0.6, 3, 10, 20)); run.push(gait(i, 32, 1.3, 1.0, 5, 16, 28)); swimK.push(swim(i)); }

  var WIND_LEGS = { legFL: [0, 0, -8], legFR: [0, 0, 8], legBL: [0, 0, 22], legBR: [0, 0, -22] };
  function withLegs(o, legs) { for (var k in legs) if (!o[k]) o[k] = legs[k]; return o; }
  var DEAD_O = { body: [0, 174, 0], head: [6, 0, 5], jaw: [16], tail: [0, 0, 8],
                 legFL: [0, -15, 25], legFR: [0, 15, -25], legBL: [0, -20, -15], legBR: [0, 20, 15] };
  var DEAD = F(DEAD_O);
  var SUNK = F({ body: [0, 174, 0, 0, 0, -9], head: [6, 0, 5], jaw: [16], tail: [0, 0, 8],
                 legFL: [0, -15, 25], legFR: [0, 15, -25], legBL: [0, -20, -15], legBR: [0, 20, 15] });
  var GRAB_LEGS = { legFL: [0, 0, -10], legFR: [0, 0, 10], legBL: [0, 0, 15], legBR: [0, 0, -15] };

  var animations = {
    // lurk + breathe + basking gape
    idle:    { durations: [1200, 1000, 1000], loop: true, frames: [
      F({ tail: [0, 0, -5] }),
      F({ body: [-0.5, 0, 0, 0, 0, 0.15], head: [-3, 0, 2], tail: [0, 0, 5] }),
      F({ body: [0, 0, 0, 0, 0, 0.05], head: [-7, 0, 0], jaw: [9], tail: [0, 0, 2] })
    ] },
    walk:    { durations: [200, 200, 200, 200], loop: true, frames: walk },
    run:     { durations: [100, 100, 100, 100], loop: true, frames: run },
    swim:    { durations: [250, 250, 250, 250], loop: true, frames: swimK },
    // lunge telegraph 0.6 s: draw back + sink, head low, hind legs gather, tail coils, jaws part (last key held)
    windup:  { durations: [150, 300, 150], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 1, -0.3], head: [3], tail: [0, 0, 14], legBL: [0, 0, 10], legBR: [0, 0, -10] }),
      F(withLegs({ body: [2, 0, 0, 0, 2, -0.5], head: [4, 0, -2], jaw: [6], tail: [0, 0, 30] }, WIND_LEGS)),
      F(withLegs({ body: [2, 0, 0, 0, 2.2, -0.5], head: [2], jaw: [10], tail: [0, 0, 34] }, WIND_LEGS))
    ] },
    // strike 0.5 s: launch -> jaws widest (key 1) -> SNAP (key 2 at 250 ms) -> settled
    lunge:   { durations: [100, 150, 100, 150], loop: false, frames: [
      F({ body: [-8, 0, 0, 0, -2, 1], head: [-20], jaw: [22], tail: [0, 0, -8],
          legFL: [0, 0, -25], legFR: [0, 0, 25], legBL: [0, 0, -35], legBR: [0, 0, 35] }),
      F({ body: [-10, 0, 0, 0, -3.5, 1.5], head: [-34], jaw: [38], tail: [0, 0, -16],
          legFL: [0, 0, -30], legFR: [0, 0, 30], legBL: [0, 0, -40], legBR: [0, 0, 40] }),
      F({ body: [4, 0, 0, 0, -3.5, 0.4], head: [6], jaw: [0], tail: [0, 0, -6],
          legFL: [0, 0, -20], legFR: [0, 0, 20], legBL: [0, 0, -20], legBR: [0, 0, 20] }),
      F({ body: [0, 0, 0, 0, -1, 0], head: [2] })
    ] },
    // D-096 short grab: clamped jaws, head shake + twist, braced body, thrashing tail (loop; play 1.5 s)
    grab:    { durations: [150, 150, 150, 150], loop: true, frames: [
      F(withLegs({ body: [0, 6, -4, 0, -1, 0.3], head: [-6, 10, 16], jaw: [3], tail: [0, 0, 22] }, GRAB_LEGS)),
      F(withLegs({ body: [0, 0, 0, 0, -1, 0.5], head: [-10], jaw: [3], tail: [0, 0, 0] }, GRAB_LEGS)),
      F(withLegs({ body: [0, -6, 4, 0, -1, 0.3], head: [-6, -10, -16], jaw: [3], tail: [0, 0, -22] }, GRAB_LEGS)),
      F(withLegs({ body: [0, 0, 0, 0, -1, 0.5], head: [-10], jaw: [3], tail: [0, 0, 0] }, GRAB_LEGS))
    ] },
    release: { durations: [120, 150, 130], loop: false, frames: [
      F({ body: [-3, 0, 0, 0, -0.5, 0.4], head: [-22], jaw: [26] }),
      F({ body: [0, 0, 0, 0, 0.8, 0], head: [-6], jaw: [8] }),
      F({})
    ] },
    hurt:    { durations: [50, 50], loop: false, interp: 'step', frames: [
      F({ body: [-5, 0, 0, 0, 1.2, 0.5], head: [-12], jaw: [18], tail: [0, 0, 14] }),
      F({ body: [-3, 0, 0, 0, 1, 0.3], head: [-8], jaw: [10], tail: [0, 0, 10] })
    ] },
    flinch:  { durations: [60, 90, 100], loop: false, frames: [
      F({ body: [-3, 0, 0, 0, 1, 0.3], head: [-6], jaw: [6], tail: [0, 0, 8] }),
      F({ body: [1, 0, 0, 0, 0.3, 0], head: [3], tail: [0, 0, -4] }),
      F({})
    ] },
    // die 0.5 s: hiss, roll over to the right, belly up (thud key 3), settle
    die:     { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      F({ body: [-4, 0, 0, 0, 0, 0.5], head: [-18], jaw: [24], tail: [0, 0, 18] }),
      F({ body: [0, 40, 0, 0, 0, 1.5], head: [-6, 0, 8], jaw: [14], tail: [0, 0, -10], legFL: [0, 0, 10], legFR: [0, 0, -10] }),
      F({ body: [0, 110, 0, 0, 0, 2.5], head: [0, 0, 10], jaw: [10], tail: [0, 0, 8],
          legFL: [0, 30, 0], legFR: [0, -30, 0], legBL: [0, 30, 0], legBR: [0, -30, 0] }),
      F({ body: [0, 178, 0, 0, 0, 0.3], head: [4, 0, 6], jaw: [14], tail: [0, 0, -6],
          legFL: [0, -20, 20], legFR: [0, 20, -20], legBL: [0, -25, -10], legBR: [0, 25, 10] }),
      DEAD
    ] },
    dead:    { durations: [1000], loop: true, frames: [DEAD] },
    sink:    { durations: [500, 100], loop: false, frames: [DEAD, SUNK] }
  };
  animations.charge = animations.lunge;

  var parts = {}, k;
  for (i = 0; i < ORDER.length; i++) {
    k = ORDER[i];
    parts[k] = { box: BOX[k], pivot: PIVOT[k] };
    if (PARENT[k]) parts[k].parent = PARENT[k];
  }

  A.models.crocodile = {
    name: 'crocodile',
    displayName: 'river crocodile',
    desc: 'BEAST-D1 river crocodile: 3.5 m, 0.5 m tall, flat olive armour with paired dark scute rows and bands, pale ' +
          'ochre belly and jaw, long flat snout with interlocking teeth, raised ember eyes, sprawled 4-toed legs, a ' +
          'crested tail half its length. 8 parts: lurk idle, high walk, run, swim, lunge telegraph, lunge, D-096 short ' +
          'grab + release, hurt, flinch, belly-up death, corpse, sink.',
    voxel: {
      version: 1,
      meshOnly: true,
      light: false,
      cellM: 0.07,
      size: [SX, SY, SZ],
      anchor: [8, 16, 0],
      mats: {
        o: 'dye_lincoln',        // olive back, head, upper flanks
        O: 'dye_lincoln_dark',   // scutes, cross-bands, blotches, skull table
        l: 'dye_lincoln_light',  // lower flanks, legs, feet
        b: 'dye_weld_light',     // pale belly, throat, tail underside
        w: 'dye_weld',           // lower jaw sides
        t: 'linen_light',        // teeth
        m: 'gore_red_dark',      // roof of the mouth
        r: 'gore_red',           // tongue / mouth floor
        N: 'iron_dark',          // nostrils, claws
        E: 'ember_glow'          // eyeshine
      },
      layers: layers(),
      parts: parts,
      animations: animations,
      mounts: {
        notice: { at: [8, 12, 12], part: 'body' },   // 0.84 m: over the back
        mouth:  { at: [8, 1, 3], part: 'head' },     // between the jaws at the snout (bite fx / grab point)
        hit:    { at: [8, 16, 4], part: 'body' },
        loot:   { at: [8, 16, 1], part: 'body' },    // the belly = the top of the belly-up corpse
        forefeet: { at: [8, 10, 0.4], part: 'body' },
        tailTip: { at: [8, 48, 2], part: 'tail' }    // splash / wake origin when swimming
      }
    }
  };

  A.crocFx = {
    version: 1,
    story: 'BEAST-D1 batch 1 (EP-BESTIARY #11 river crocodile; brain: new water ambusher)',
    model: 'crocodile',
    clipFor: {
      state: { idle: 'idle', lurk: 'idle', ambush: 'idle', notice: 'idle', wander: 'walk', return: 'walk', stalk: 'walk',
               chase: 'run', flee: 'run', swim: 'swim', telegraph: 'windup', windup: 'windup', lunge: 'lunge',
               charge: 'lunge', grab: 'grab', hold: 'grab', release: 'release', recover: 'walk', stagger: 'flinch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink',
      note: 'in water use swim for any moving state; lurk = idle with the body at the water line (sim)'
    },
    speeds: { walk: 0.45, run: 1.4, swim: 1.0, note: 'm/s at clip rate 1; scale the rate by speed (clamp 0.6-1.6)' },
    telegraph: { clip: 'windup', ms: 600, backM: 0.15, note: 'D-083 readable wind-up >= 0.4 s; last key held until the lunge' },
    lunge: { clip: 'lunge', ms: 500, widestKey: 1, snapKey: 2, snapMs: 250, reachM: 4,
             note: 'view-only 0.25 m forward / 0.1 m up arc; the sim moves the entity. Deal damage / start the grab at snapMs' },
    grab: { clip: 'grab', loopMs: 600, holdMs: 1500, releaseClip: 'release', releaseMs: 400,
            note: 'D-096 short grab: 1.5 s hold, mash to escape, max 12 % HP total. No death roll.' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 9 },
    death: { note: 'beastView timeline (die 0.5 s, dead, sink 0.5 s)', corpseCentre: { rightM: 0, fwdM: 0, upM: 0.2 },
             lootInteract: { prompt: '[E] Loot crocodile', radiusM: 2.0, aimUpM: 0.3 }, sink: { clip: 'sink', depthM: 0.63 } },
    requiredClips: ['idle', 'walk', 'run', 'swim', 'windup', 'lunge', 'grab', 'release', 'hurt', 'flinch', 'die', 'dead', 'sink', 'charge'],
    windups: [['windup', 600]],
    budgetTris: 2600,
    previewSeqs: {
      'loop: idle (lurk, gape)': [['idle', 0]],
      'loop: walk (high walk)': [['walk', 0]],
      'loop: run': [['run', 0]],
      'loop: swim': [['swim', 0]],
      'attack: windup -> lunge -> grab 1.5 s -> release -> idle': [['windup', 800], ['lunge', 500], ['grab', 1500], ['release', 400], ['idle', 900]],
      'hit: hurt -> flinch -> idle': [['hurt', 100], ['flinch', 250], ['idle', 900]],
      'death: hurt -> die -> dead -> sink': [['hurt', 100], ['die', 500], ['dead', 1500], ['sink', 500], ['gone', 600]]
    },
    selfCheck: { clippedVoxels: CLIPPED, note: 'voxels the shape helpers tried to write outside their own part (info only)' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { crocodile: A.models.crocodile, crocFx: A.crocFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
