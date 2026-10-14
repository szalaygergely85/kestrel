/* design/models/voxel_skeleton.js - BEAST-D1 batch 1: skeleton warrior (EP-BESTIARY roster #20, night only, D-094
 * "undead at night = yes"; #21 skeleton archer = this model + a bow (variant); Bone Knight boss = scale 1.4).
 * Designer, PC-B lane 4, 2026-10-14.
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_goblin.js:
 *   <script src="../design/models/voxel_skeleton.js">       (browser)
 *   import '../../../design/models/voxel_skeleton.js';      (Node tests: side-effect import)
 * Sets ASSETS.models.skeleton and ASSETS.skeletonFx. NOT registered in game/js/main.js here. `meshOnly`.
 *
 * Axes (15.1): x = east (= the skeleton's RIGHT at yaw 0), y = SOUTH with low y = the FRONT (faces north at yaw 0),
 * z = up. cellM 0.05. Grid 22 x 19 x 37 (1.85 m to the crown). Anchor [11, 15.5, 0] = between the feet. Centre line
 * x = 11 (cells 10 | 11); right side = mirror x -> 21 - x. Clip `pos` values are VOXELS.
 *
 * LOOK (a realistic human skeleton from squares, style-guide 0; old battlefield dead):
 *   - real proportions: legs 0.8 m, pelvis 0.3 m, ribcage 0.45 m, skull 0.3 m; long arms (fingertips at mid thigh).
 *   - bones 1 voxel (5 cm) thick with 2-voxel KNOBBLY joints (antler material = rough bone): shoulders, elbows, hips,
 *     knees, ankles; two forearm bones (ulna + radius) and two shin bones (tibia + fibula).
 *   - RIBCAGE with real gaps: 4 rib rings on every other layer (the hollow reads in ASCII as stripes), sternum, a
 *     vertebra column with spinous processes, clavicles, shoulder blades, a tattered rag on the right shoulder.
 *   - SKULL: lit dome, brow ridge, two OPEN eye sockets with a glowing ember point deep inside each (the night tell),
 *     a dark nasal hole, upper teeth; the jaw is its own part (chatters, gapes, falls open).
 *   - gear: a broken round wooden shield (iron rim, bronze boss, one chunk bitten out) on the LEFT forearm held in
 *     front; a short rusty sword in the RIGHT fist in a LOW GUARD (tip forward-down), bronze guard, leather grip.
 *   - a rotted rag loincloth on the pelvis.
 * Colour: bone W linen > w linen_dark (shadowed / old bone, discs) > H linen_light (lit dome, clavicles, teeth) > A
 *   antler (knobbly joints, vertebrae); K iron_dark (holes, rim); E ember_glow eyes; R canvas_burnt rags; P timber_old
 *   + D dye_walnut_dark shield planks / seams; Z bronze; S steel_old / X steel_edge sword; L leather grip.
 *
 * Parts (8; insertion order = part index; parents EARLIER; each box sx+sy+sz <= 48; put() writes a voxel only where its
 * part owns it):
 *   body   box [7,11,16, 15,19,22]  pelvis + lumbar spine + rags. pivot [11, 15.5, 17]. ROOT. rx + = bow forward.
 *   chest  box [7,14,22, 15,19,32]  ribcage, thoracic spine, neck, clavicles, scapulae. pivot [11, 16, 22], parent body.
 *                                   rx + = hunch forward, rz + = turn the right shoulder back.
 *   head   box [8,11,32, 14,19,37]  skull. pivot [11, 15.5, 32] (atlas), parent chest. rx + = chin down, ry = tilt.
 *   jaw    box [8,10,29, 14,14,32]  mandible + lower teeth. pivot [11, 14, 31.5], parent head. rx + = OPEN.
 *   armL   box [0,5,13, 11,19,31]   left arm + forearm held forward + SHIELD. pivot [6.5, 15.5, 28.5], parent chest.
 *                                   rx - = raise forward (shield up), ry + = out to the side.
 *   armR   box [15,1,8, 18,19,31]   right arm + SWORD (low guard). pivot [15.5, 15.5, 28.5], parent chest.
 *                                   rx - = raise forward (-172 = sword cocked back over the head), ry - = out.
 *   legL / legR box [7|11, 10, 0, 11|15, 19, 16]  pivot [8.5|13.5, 15.5, 15.5] (hip), parent body. rx - = foot forward,
 *                                   key pos z + = lifted swing foot.
 *
 * Clips (ms, multiples of 10):
 *   idle     loop 2.4 s  4 keys: creepy sway, head tilts, jaw chatters, sword arm twitches.
 *   walk     loop 0.9 s  4 keys: stiff shamble, hips twist, head lolls, sword swings, jaw rattles. ~1.1 m/s.
 *   run      loop 0.5 s  4 keys: lurching run, torso leaning 16 deg. ~2.5 m/s.
 *   attack   once 1.0 s  6 keys: WINDUP 0-500 ms (>= 0.4 s, D-083): shield forward, sword raised and COCKED BEHIND THE
 *                        SKULL (held 100 ms, jaw gapes) -> STRIKE key 3 (500 ms) -> hit key 4 at 600 ms (follow-
 *                        through, low) -> recover to the guard by 1000 ms.
 *   block    once 0.3 s  2 keys: shield raised to the face, crouched; last key held.
 *   hurt     once 0.1 s  2 step keys: ribcage snaps back, skull jerks, jaw falls open.
 *   flinch   once 0.25 s 3 keys: back to the guard.
 *   collapse once 0.5 s  5 keys (beastView DIE_DURATIONS 90/110/120/80/100): the bones give out: legs fold forward,
 *                        the pelvis drops to the ground, the ribcage tips onto the legs, the skull rolls off (thud key 3).
 *   rise     once 1.0 s  5 keys: the heap pulls itself together into the guard (night spawn at dusk, D-094).
 *   dead     held        the bone heap.     sink: 0.5 s, 0.4 m.
 *   Aliases: die = collapse, windup = attack, charge = run.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var SX = 22, SY = 19, SZ = 37;
  var ORDER = ['body', 'chest', 'head', 'jaw', 'armL', 'armR', 'legL', 'legR'];
  var BOX = {
    body: [7, 11, 16, 15, 19, 22], chest: [7, 14, 22, 15, 19, 32], head: [8, 11, 32, 14, 19, 37], jaw: [8, 10, 29, 14, 14, 32],
    armL: [0, 5, 13, 11, 19, 31], armR: [15, 1, 8, 18, 19, 31],
    legL: [7, 10, 0, 11, 19, 16], legR: [11, 10, 0, 15, 19, 16]
  };
  var PIVOT = {
    body: [11, 15.5, 17], chest: [11, 16, 22], head: [11, 15.5, 32], jaw: [11, 14, 31.5],
    armL: [6.5, 15.5, 28.5], armR: [15.5, 15.5, 28.5], legL: [8.5, 15.5, 15.5], legR: [13.5, 15.5, 15.5]
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
  // put a voxel and its mirror (x -> 21 - x) on the same part
  function put2(part, x, y, z, ch) { put(part, x, y, z, ch); put(part, 21 - x, y, z, ch); }

  // ---- body: pelvis, lumbar spine, rags ----
  (function buildBody() {
    var z, x, y;
    for (z = 18; z <= 21; z++) { put('body', 10, 17, z, z % 2 ? 'w' : 'A'); put('body', 11, 17, z, z % 2 ? 'w' : 'A'); }
    put('body', 10, 18, 18, 'W'); put('body', 11, 18, 18, 'W'); put('body', 10, 18, 20, 'W'); put('body', 11, 18, 20, 'W');
    for (x = 7; x <= 9; x++) for (y = 15; y <= 17; y++) put2('body', x, y, 18, 'W');      // iliac wings
    for (x = 7; x <= 9; x++) put2('body', x, 16, 19, 'H');                                 // iliac crests (lit)
    for (x = 8; x <= 9; x++) for (y = 15; y <= 16; y++) put2('body', x, y, 17, 'W');       // ischium / ilium body
    put('body', 10, 17, 16, 'W'); put('body', 11, 17, 16, 'W'); put('body', 10, 17, 17, 'W'); put('body', 11, 17, 17, 'W'); // sacrum
    for (x = 9; x <= 12; x++) put('body', x, 14, 16, 'W');                                 // pubic arch
    put2('body', 8, 15, 16, 'A');                                                          // hip sockets
    put2('body', 9, 16, 16, 'w');
    // rotted rag loincloth: front + back strips, ragged lower edge
    for (x = 9; x <= 12; x++) {
      put('body', x, 13, 17, 'R'); if (hash(x, 13, 16) < 0.6) put('body', x, 13, 16, 'R');
      put('body', x, 18, 17, 'R'); if (hash(x, 18, 16) < 0.6) put('body', x, 18, 16, 'R');
    }
    put2('body', 8, 14, 17, 'R');
  })();

  // ---- chest: spine, neck, ribs, sternum, clavicles, scapulae, shoulder rag ----
  var RIBS = { 22: [8, 13, 15, 17, true, 'w'], 24: [7, 14, 14, 17, false, 'W'], 26: [7, 14, 14, 17, false, 'W'], 28: [8, 13, 14, 17, false, 'W'] };
  (function buildChest() {
    var z, x, y, r;
    for (z = 22; z <= 29; z++) {
      put('chest', 10, 17, z, z % 2 ? 'w' : 'A'); put('chest', 11, 17, z, z % 2 ? 'w' : 'A');
      if (z % 2 === 0) { put('chest', 10, 18, z, 'W'); put('chest', 11, 18, z, 'W'); }    // spinous processes
    }
    put('chest', 10, 16, 30, 'A'); put('chest', 11, 16, 30, 'A'); put('chest', 10, 16, 31, 'w'); put('chest', 11, 16, 31, 'w'); // neck
    for (z in RIBS) {
      r = RIBS[z]; z = +z;
      for (x = r[0]; x <= r[1]; x++) for (y = r[2]; y <= r[3]; y++) {
        var edge = x === r[0] || x === r[1] || y === r[2] || y === r[3];
        if (!edge) continue;
        if (r[4] && y === r[2] && x > r[0] && x < r[1]) continue;                          // floating ribs: open front
        put('chest', x, y, z, r[5]);
      }
    }
    for (z = 23; z <= 27; z += 2) { put('chest', 10, 14, z, 'H'); put('chest', 11, 14, z, 'H'); }  // sternum
    put('chest', 10, 14, 29, 'W'); put('chest', 11, 14, 29, 'W');                          // manubrium
    put2('chest', 9, 14, 29, 'H'); put2('chest', 8, 14, 29, 'H'); put2('chest', 7, 15, 29, 'H');   // clavicles
    put2('chest', 7, 16, 29, 'A');                                                         // acromion
    for (z = 25; z <= 28; z++) { put2('chest', 7, 18, z, 'W'); put2('chest', 8, 18, z, 'W'); }    // shoulder blades
    // tattered rag over the right shoulder blade
    for (z = 24; z <= 29; z++) for (x = 12; x <= 14; x++) if (z >= 27 || hash(x, 18, z) < 0.55) put('chest', x, 18, z, 'R');
    put('chest', 13, 17, 29, 'R'); put('chest', 14, 17, 29, 'R');
  })();

  // ---- skull (z32..36) ----
  (function buildSkull() {
    var x, y;
    // z32: upper teeth, palate, cheek arches, skull base
    for (x = 9; x <= 12; x++) { put('head', x, 12, 32, 'H'); for (y = 13; y <= 17; y++) put('head', x, y, 32, 'W'); }
    put2('head', 8, 14, 32, 'W'); put2('head', 8, 15, 32, 'W');
    // z33: nasal hole, cheekbones, cranium sides
    put('head', 9, 12, 33, 'W'); put('head', 10, 12, 33, 'K'); put('head', 11, 12, 33, 'K'); put('head', 12, 12, 33, 'W');
    for (x = 8; x <= 13; x++) for (y = 13; y <= 17; y++) put('head', x, y, 33, 'W');
    // z34 / z35: OPEN eye sockets at y12 (x9, x12), the ember point deep inside (y13)
    put2('head', 8, 12, 34, 'W'); put('head', 10, 12, 34, 'W'); put('head', 11, 12, 34, 'W');
    put2('head', 8, 13, 34, 'W'); put('head', 9, 13, 34, 'E'); put('head', 12, 13, 34, 'E');
    put('head', 10, 13, 34, 'W'); put('head', 11, 13, 34, 'W');
    put2('head', 8, 12, 35, 'W'); put('head', 10, 12, 35, 'H'); put('head', 11, 12, 35, 'H');
    put2('head', 8, 13, 35, 'W'); put('head', 9, 13, 35, 'K'); put('head', 12, 13, 35, 'K');
    put('head', 10, 13, 35, 'W'); put('head', 11, 13, 35, 'W');
    for (x = 8; x <= 13; x++) for (y = 14; y <= 17; y++) { put('head', x, y, 34, 'W'); put('head', x, y, 35, 'W'); }
    // z36: brow ridge + lit dome, a crack
    for (x = 9; x <= 12; x++) { for (y = 12; y <= 16; y++) put('head', x, y, 36, 'H'); put('head', x, 17, 36, 'W'); }
    for (y = 13; y <= 16; y++) put2('head', 8, y, 36, 'W');
    put('head', 11, 14, 36, 'K'); put('head', 12, 15, 36, 'K');
  })();

  // ---- jaw (mandible z30..31, y12..13) ----
  (function buildJaw() {
    var x;
    for (x = 9; x <= 12; x++) { put('jaw', x, 12, 31, 'H'); put('jaw', x, 12, 30, 'W'); put('jaw', x, 13, 30, 'W'); }
    for (x = 8; x <= 13; x++) put('jaw', x, 13, 31, 'W');
    put2('jaw', 8, 13, 30, 'w');
  })();

  // ---- left arm: humerus, elbow, forearm held forward, hand on the shield grip, broken round SHIELD ----
  (function buildArmL() {
    var z, y, x, d, cx = 5.5, cz = 21;
    for (z = 22; z <= 27; z++) put('armL', 6, 15, z, 'W');
    put('armL', 6, 15, 28, 'A'); put('armL', 6, 16, 28, 'A');
    put('armL', 6, 15, 21, 'A'); put('armL', 6, 16, 21, 'A');
    for (y = 10; y <= 14; y++) { put('armL', 6, y, 21, 'W'); put('armL', 5, y, 20, 'w'); }   // ulna + radius
    put('armL', 5, 9, 20, 'A'); put('armL', 6, 9, 20, 'A'); put('armL', 5, 9, 21, 'A'); put('armL', 6, 9, 21, 'A');
    for (x = 0; x <= 10; x++) for (z = 15; z <= 26; z++) {
      d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (z + 0.5 - cz) * (z + 0.5 - cz));
      if (d > 5.2) continue;
      if (x >= 8 && z >= 24 && d > 3.2) continue;                                        // a chunk bitten out
      put('armL', x, 8, z, 'P');                                                           // back of the planks
      put('armL', x, 7, z, d > 4.3 ? 'K' : (x % 3 === 0 ? 'D' : 'P'));                     // iron rim, plank seams
    }
    put('armL', 5, 6, 20, 'Z'); put('armL', 5, 6, 21, 'Z'); put('armL', 5, 6, 22, 'Z'); put('armL', 4, 6, 21, 'Z'); put('armL', 6, 6, 21, 'Z'); // boss
  })();

  // ---- right arm: humerus, elbow, ulna + radius, the SWORD in a low guard (tip forward-down), bony fist ----
  (function buildArmR() {
    var z;
    for (z = 22; z <= 27; z++) put('armR', 15, 15, z, 'W');
    put('armR', 15, 15, 28, 'A'); put('armR', 15, 16, 28, 'A');
    put('armR', 15, 15, 21, 'A'); put('armR', 15, 16, 21, 'A');
    for (z = 17; z <= 20; z++) put('armR', 15, 15, z, 'W');
    for (z = 18; z <= 20; z++) put('armR', 16, 15, z, 'w');
    seg('armR', [15.5, 14.2, 15.6], [15.5, 16.2, 16.8], 0.5, 0.5, 'L');                    // grip
    put('armR', 15, 16, 17, 'Z');                                                           // pommel
    seg('armR', [15.5, 13.8, 16.6], [15.5, 12.6, 14.0], 0.55, 0.55, 'Z');                  // crossguard
    seg('armR', [15.5, 12.6, 14.8], [15.5, 2.0, 8.7], 0.72, 0.5, function (x, y, z, t) {   // rusty blade, honed tip
      return t > 0.8 ? 'X' : (hash(x, y, z) < 0.15 ? 'X' : 'S');
    });
    put('armR', 15, 14, 15, 'A'); put('armR', 16, 14, 15, 'A'); put('armR', 15, 15, 16, 'A'); put('armR', 16, 15, 16, 'A');  // fist
    put('armR', 16, 14, 16, 'A'); put('armR', 16, 15, 15, 'A');
  })();

  // ---- legs: femur + head, knee + kneecap, tibia + fibula, ankle, foot (right = mirror x -> 21 - x) ----
  (function buildLegs() {
    var z, y;
    function both(x, y2, z2, ch) { put('legL', x, y2, z2, ch); put('legR', 21 - x, y2, z2, ch); }
    for (z = 11; z <= 14; z++) both(8, 15, z, 'W');
    both(8, 15, 15, 'W'); both(9, 15, 15, 'A');
    both(8, 15, 9, 'A'); both(8, 15, 10, 'A'); both(8, 14, 10, 'H');
    for (z = 2; z <= 8; z++) both(8, 15, z, 'W');
    for (z = 3; z <= 7; z++) both(9, 16, z, 'w');
    both(8, 15, 1, 'A'); both(8, 16, 1, 'A');
    both(8, 16, 0, 'A'); both(9, 16, 0, 'w');
    for (y = 13; y <= 15; y++) { both(8, y, 0, 'W'); both(9, y, 0, 'w'); }
    both(8, 12, 0, 'W'); both(9, 12, 0, 'W');
  })();

  // ---- clips ----
  var HEAP_O = { body: [0, 0, 0, 0, 0, -14], chest: [80, 0, 0, 0, 0, -5], head: [-60, 0, 30, 0, -3, -0.5], jaw: [24],
                 armL: [0, 50, 0], armR: [0, -38, 0], legL: [-88, 0, -15], legR: [-86, 0, 14] };
  var HEAP = F(HEAP_O);
  var SUNK = F({ body: [0, 0, 0, 0, 0, -22], chest: [80, 0, 0, 0, 0, -5], head: [-60, 0, 30, 0, -3, -0.5], jaw: [24],
                 armL: [0, 50, 0], armR: [0, -38, 0], legL: [-88, 0, -15], legR: [-86, 0, 14] });
  var COL1 = F({ body: [0, 0, 0, 0, 0, -5], chest: [20, 0, 0, 0, 0, -1], head: [12, 0, 10], jaw: [20],
                 armL: [-20, 20, 0], armR: [-20, -20, 0], legL: [-45, 0, -8], legR: [-38, 0, 8] });
  var COL2 = F({ body: [0, 0, 0, 0, 0, -11], chest: [55, 0, 0, 0, 0, -3], head: [-20, 0, 20, 0, -1.5, 0], jaw: [28],
                 armL: [10, 40, 0], armR: [10, -30, 0], legL: [-75, 0, -12], legR: [-70, 0, 12] });
  var COCKED = { body: [0, 0, -10, 0, 0.5, -1], chest: [-8, 0, -24], head: [10, 0, 12], legL: [-16], legR: [14] };
  function with2(o, more) { var r = {}, k; for (k in more) r[k] = more[k]; for (k in o) r[k] = o[k]; return r; }

  var animations = {
    idle:     { durations: [600, 600, 600, 600], loop: true, frames: [
      F({ head: [0, 6, 0], armR: [-4] }),
      F({ body: [0, 2, 0, 0, 0, -0.2], chest: [2, 0, 4], head: [4, -4, 6], jaw: [10], armR: [-6], armL: [-3] }),
      F({ head: [0, -8, 0], jaw: [2], chest: [0, 0, -2], armR: [-2] }),
      F({ body: [0, -2, 0, 0, 0, -0.2], chest: [3], head: [6, 4, -4], jaw: [14], armR: [-8], armL: [-4] })
    ] },
    walk:     { durations: [220, 230, 220, 230], loop: true, frames: [
      F({ body: [0, 0, 4, 0, 0, -0.6], chest: [4, 0, -8], head: [0, 6, 6], jaw: [6], legL: [-22], legR: [18], armR: [-14], armL: [-4] }),
      F({ body: [0, 0, 0, 0, 0, 0.3], chest: [4], head: [2], legR: [-4, 0, 0, 0, 0, 1.5], armL: [-2] }),
      F({ body: [0, 0, -4, 0, 0, -0.6], chest: [4, 0, 8], head: [0, -6, -6], jaw: [8], legL: [18], legR: [-22], armR: [10] }),
      F({ body: [0, 0, 0, 0, 0, 0.3], chest: [4], head: [2], legL: [-4, 0, 0, 0, 0, 1.5], armR: [-4], armL: [-2] })
    ] },
    run:      { durations: [120, 130, 120, 130], loop: true, frames: [
      F({ body: [0, 0, 6, 0, 0, -1], chest: [16, 0, -10], head: [-10], jaw: [10], legL: [-35], legR: [28], armR: [-30], armL: [-10] }),
      F({ body: [0, 0, 0, 0, 0, 0.8], chest: [16], head: [-8], jaw: [4], legL: [10], legR: [-5, 0, 0, 0, 0, 3], armR: [-6], armL: [-6] }),
      F({ body: [0, 0, -6, 0, 0, -1], chest: [16, 0, 10], head: [-10], jaw: [12], legL: [28], legR: [-35], armR: [20], armL: [-2] }),
      F({ body: [0, 0, 0, 0, 0, 0.8], chest: [16], head: [-8], jaw: [4], legL: [-5, 0, 0, 0, 0, 3], legR: [10], armR: [-6], armL: [-6] })
    ] },
    // windup 0-500 (cocked + held) -> strike key 3 at 500 -> hit key 4 at 600 -> recover by 1000
    attack:   { durations: [150, 250, 100, 100, 150, 250], loop: false, frames: [
      F({ body: [0, 0, -8, 0, 0, -0.8], chest: [-4, 0, -14], head: [8, 0, 8], jaw: [10], armL: [-14], armR: [-110, -12, 0], legL: [-14], legR: [12] }),
      F(with2({ jaw: [16], armL: [-18], armR: [-172, -8, 0] }, COCKED)),
      F(with2({ jaw: [22], armL: [-18], armR: [-176, -6, 0] }, COCKED)),
      F({ body: [0, 0, 8, 0, -2, -1.5], chest: [18, 0, 14], head: [4, 0, -6], jaw: [4], armL: [-10], armR: [-38, 4, 0], legL: [-24], legR: [16] }),
      F({ body: [0, 0, 10, 0, -2, -1.6], chest: [22, 0, 18], head: [6], jaw: [2], armL: [-10], armR: [-12, 6, 0], legL: [-24], legR: [16] }),
      F({})
    ] },
    block:    { durations: [150, 150], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 0, -0.8], chest: [6, 0, 6], head: [12], armL: [-30], armR: [-10], legL: [-10], legR: [10] }),
      F({ body: [0, 0, 0, 0, 0, -0.8], chest: [6, 0, 6], head: [12], armL: [-34], armR: [-12], legL: [-10], legR: [10] })
    ] },
    hurt:     { durations: [50, 50], loop: false, interp: 'step', frames: [
      F({ body: [0, 0, 0, 0, 1, 0], chest: [-12], head: [-16], jaw: [22], armL: [6], armR: [14] }),
      F({ body: [0, 0, 0, 0, 0.8, 0], chest: [-8], head: [-10], jaw: [14], armL: [4], armR: [8] })
    ] },
    flinch:   { durations: [60, 90, 100], loop: false, frames: [
      F({ body: [0, 0, 0, 0, 0.6, 0], chest: [-6], head: [-8], jaw: [8] }),
      F({ chest: [4], head: [4] }),
      F({})
    ] },
    // the bones give out (beastView die timeline): jolt -> legs fold -> pelvis drops -> ribcage tips (thud) -> heap
    collapse: { durations: [90, 110, 120, 80, 100], loop: false, frames: [
      F({ chest: [-8], head: [-18, 0, 8], jaw: [26], armL: [0, 24, 0], armR: [0, -24, 0] }),
      COL1,
      COL2,
      F({ body: [0, 0, 0, 0, 0, -14.5], chest: [84, 0, 0, 0, 0, -5.5], head: [-55, 0, 32, 0, -3, -0.5], jaw: [30],
          armL: [0, 54, 0], armR: [0, -42, 0], legL: [-90, 0, -16], legR: [-88, 0, 15] }),
      HEAP
    ] },
    // night spawn: the heap pulls itself up into the guard, jaw gaping
    rise:     { durations: [250, 250, 250, 150, 100], loop: false, frames: [
      HEAP, COL2, COL1,
      F({ chest: [-6], head: [-10], jaw: [20], armR: [-10] }),
      F({})
    ] },
    dead:     { durations: [1000], loop: true, frames: [HEAP] },
    sink:     { durations: [500, 100], loop: false, frames: [HEAP, SUNK] }
  };
  animations.die = animations.collapse;
  animations.windup = animations.attack;
  animations.charge = animations.run;

  var parts = {}, i, k;
  for (i = 0; i < ORDER.length; i++) {
    k = ORDER[i];
    parts[k] = { box: BOX[k], pivot: PIVOT[k] };
    if (PARENT[k]) parts[k].parent = PARENT[k];
  }

  A.models.skeleton = {
    name: 'skeleton',
    displayName: 'skeleton warrior',
    desc: 'BEAST-D1 skeleton warrior: a 1.85 m human skeleton (knobbly joints, ribcage with gaps, two forearm and shin ' +
          'bones), skull with open sockets and ember points deep inside, a broken round shield on the left forearm and ' +
          'a short rusty sword in a low guard, rags. 8 parts: idle, shamble walk, run, attack (cocked over the skull), ' +
          'block, hurt, flinch, collapse into a bone heap, rise, heap, sink.',
    voxel: {
      version: 1,
      meshOnly: true,
      light: false,
      cellM: 0.05,
      size: [SX, SY, SZ],
      anchor: [11, 15.5, 0],
      mats: {
        W: 'linen',          // bone
        w: 'linen_dark',     // shadowed / old bone, discs, the fibula and radius
        H: 'linen_light',    // lit dome, brow, clavicles, sternum, teeth, kneecaps
        A: 'antler',         // knobbly joints, vertebral bodies, finger bones
        K: 'iron_dark',      // nasal hole, socket shadow, skull crack, shield rim
        E: 'ember_glow',     // the points of light in the sockets
        R: 'canvas_burnt',   // rags
        P: 'timber_old',     // shield planks
        D: 'dye_walnut_dark',// plank seams
        Z: 'bronze',         // shield boss, sword guard and pommel
        S: 'steel_old',      // rusty blade
        X: 'steel_edge',     // honed edge glints and the tip
        L: 'leather'         // sword grip
      },
      layers: layers(),
      parts: parts,
      animations: animations,
      mounts: {
        notice: { at: [11, 15, 40], part: 'body' },     // 2.0 m
        eyes:   { at: [11, 13, 34.5], part: 'head' },   // optional faint socket glow / night light anchor
        hit:    { at: [11, 16, 25], part: 'chest' },
        loot:   { at: [11, 15, 18], part: 'body' },     // on the pelvis = the middle of the heap
        swordTip: { at: [15.5, 2.0, 8.7], part: 'armR' },
        shield: { at: [5.5, 6.5, 21], part: 'armL' }    // block spark point
      }
    }
  };

  A.skeletonFx = {
    version: 1,
    story: 'BEAST-D1 batch 1 (EP-BESTIARY #20 skeleton warrior; #21 archer = variant + bow; brain: goblinBrain melee)',
    model: 'skeleton',
    clipFor: {
      state: { idle: 'idle', notice: 'idle', wander: 'walk', patrol: 'walk', return: 'walk', stalk: 'walk', chase: 'run',
               flee: 'run', telegraph: 'attack', windup: 'attack', attack: 'attack', charge: 'run', block: 'block',
               recover: 'walk', stagger: 'flinch', rise: 'rise', spawn: 'rise' },
      hurt: 'hurt', flinch: 'flinch', die: 'collapse', dead: 'dead', sink: 'sink',
      note: 'windup and attack both map to `attack` so the clip does not restart between them (goblin rule)'
    },
    speeds: { walk: 1.1, run: 2.5, note: 'm/s at clip rate 1' },
    attack: { clip: 'attack', ms: 1000, windupMs: 500, strikeKey: 3, hitKey: 4, hitMs: 600, recoverMs: 400, reachM: 1.5 },
    block: { clip: 'block', ms: 300, note: 'last key held while blocking; frontal hits on the shield -> spark at mount shield' },
    night: { onlyAtNight: true, riseClip: 'rise', riseMs: 1000,
             note: 'D-094: rises at dusk (or when the player comes near at night), collapses at dawn or in Waystone light' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 9 },
    death: { clip: 'collapse', note: 'beastView timeline; the heap lies in front of the anchor (~0.5 m)',
             lootInteract: { prompt: '[E] Search the bones', radiusM: 1.6, aimUpM: 0.15 }, sink: { clip: 'sink', depthM: 0.4 } },
    eyes: { mat: 'ember_glow', alt: 'crystal_lit', note: 'teal would read as "magic" (= Waystone, which they fear): kept ember' },
    variants: { archer: { note: 'swap the shield + sword for a bow (needs a bow prop or the goblin-archer bow)' }, boneKnight: { scale: 1.4 } },
    requiredClips: ['idle', 'walk', 'run', 'attack', 'block', 'hurt', 'flinch', 'collapse', 'rise', 'dead', 'sink', 'die', 'windup', 'charge'],
    windups: [['attack', 500]],
    budgetTris: 2000,
    previewSeqs: {
      'loop: idle': [['idle', 0]],
      'loop: walk (shamble)': [['walk', 0]],
      'loop: run': [['run', 0]],
      'attack: attack -> idle': [['attack', 1000], ['idle', 800]],
      'block (held)': [['idle', 600], ['block', 1200]],
      'hit: hurt -> flinch -> idle': [['hurt', 100], ['flinch', 250], ['idle', 900]],
      'night: collapse -> heap -> rise -> idle': [['hurt', 100], ['collapse', 500], ['dead', 1200], ['rise', 1000], ['idle', 900]],
      'death: collapse -> dead -> sink': [['collapse', 500], ['dead', 1500], ['sink', 500], ['gone', 600]]
    },
    selfCheck: { clippedVoxels: CLIPPED, note: 'should be 0 (every voxel placed inside its own part)' }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { skeleton: A.models.skeleton, skeletonFx: A.skeletonFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
