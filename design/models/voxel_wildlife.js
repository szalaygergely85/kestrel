/* design/models/voxel_wildlife.js - EP-WILD step 1 (designer, v1.53, owner 2026-10-10 "living forest", D-053):
 * PREVIEW of the first two ambient animals, a wild rabbit and a deer (+ a roe-buck antler variant), so the owner can
 * confirm the style before squirrel / fox / bird are made. Binding rules: design/style-guide.md section 0 (realistic
 * anatomy from voxels, four-legged animals on all fours, rounded bodies, natural colour variation). Nothing is placed.
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as voxel_bear.js:
 *   <script src="../design/models/voxel_wildlife.js">     (browser, after palette.js + detail-pass.js)
 *   import '../design/models/voxel_wildlife.js';          (Node tests: side-effect import)
 * Sets ASSETS.models.rabbit, ASSETS.models.deer, ASSETS.models.deerBuck (format: design/README.md section 4/7,
 * architecture.md 15.1) and ASSETS.wildlifeFx (state -> clip map, gait speeds, flee distances). `meshOnly: true`.
 * New palette materials (appended, v2 records in detail-pass.js): fur_agouti, fur_agouti_dark, fur_agouti_light,
 * fur_cream, fur_roe, fur_roe_dark, fur_roe_light, antler.
 *
 * Axes (15.1, same as the bear): x = east (= the animal's RIGHT at yaw 0), y = SOUTH with y0 = the nose (the animal
 * faces north at yaw 0), z = up. Clip `pos` values are VOXELS. Rotations: R = Rz * Ry * Rx (deg).
 *   body rx + = nose down, rz + = turn right. head rx - = lift. limb rx - = foot forward. ear rx + = tip forward,
 *   rx - = laid back; ear rz turns the ear opening (earL rz - / earR rz + = turned out to the side). tail rx + = up.
 *
 * Shapes are built from ELLIPSE SLICES (every y-slice of trunk, neck and head is an ellipse of its own centre and
 * radii), so the silhouettes are round and tapered from every angle (style 0.3), with per-voxel colour variation
 * (ticked backs, buff flanks, cream bellies). Limbs are slender columns that widen into forearm / thigh.
 *
 * LIMB SOLVER (build time, data only): a "planted" limb key gives a foot target (dy = slide along y, lift = height,
 * both voxels, relative to the rest foot point) and a WORLD pitch for the limb; the file computes the limb's local
 * rot (world pitch - body pitch) and the local pos that puts the foot point exactly on the target, whatever the body
 * does. Deer limbs also get the stride angle asin(dy / L) automatically. A "free" key ({free: [rx,ry,rz], up}) swings
 * the limb with the body (airborne phases), `up` slides it into the body = a folded leg. The output is plain
 * {rot, pos} per part, exactly the bear's format.
 *
 * ---------------------------------------------------------------------------------------------------------------
 * RABBIT (European wild rabbit): cellM 0.02, grid 12 x 21 x 16, anchor [6, 12, 0] (between the four feet).
 *   0.42 m nose to tail, 0.22 m at the arched back, ears to 0.32 m. Crouched, arched back highest over the loins,
 *   big rounded haunches, long flat hind feet, short thin forelegs, round head with large side eyes and pale eye
 *   ring, pale whisker pads, pinkish nose, LONG ears (8 cm, dark tips, pink inner face), rufous nape, white tail
 *   underside (+ dark top), cream belly.
 *   Parts (8): body  [3,7,3, 9,21,13]  pivot [6,15,5] (the hips: sitting up turns about the hip line)
 *              head  [2,0,5, 10,7,12]  pivot [6,6.5,8]   parent body
 *              earL  [3,3,12, 6,8,16]  pivot [5.5,4.5,12] parent head   (each ear moves on its own)
 *              earR  [6,3,12, 9,8,16]  pivot [6.5,4.5,12] parent head
 *              legFL [3,6,0, 6,10,3]   pivot [4.5,8.5,3.5] / legFR [6,6,0, 9,10,3] pivot [7.5,8.5,3.5]
 *              legBL [1,11,0, 4,21,9]  pivot [3,15,5]    / legBR [8,11,0, 11,21,9] pivot [9,15,5]  (haunch + foot)
 *   Clips (ms, multiples of 50):
 *     idle   loop 4.6 s  breathing, nose twitches (quick head nods), the left ear turns out to listen, then the right,
 *                        a small head turn, the ears relax back.
 *     graze  loop 2.6 s  body tipped forward, chest low, nose on the grass: nibbles left / right, an ear turns while
 *                        chewing, the head comes up a little to chew and look.
 *     hop    loop 0.4 s  the real slow hop: gather (forefeet lift) -> push with the hind feet (heels rise) ->
 *                        flight with forelegs reaching -> forefeet land one body length ahead (nose down) -> hind feet
 *                        swing past and land behind them -> crouch. Ears flop back in flight. Tuned 0.6 m/s.
 *     run    loop 0.3 s  fast bound: hind push, long stretched flight, forefeet land staggered, hind feet swing far
 *                        forward and land ahead of them; ears laid flat along the back, tail flashing white.
 *     sitUp  once 0.4 s  from the crouch onto the haunches (play once, then `alert`).
 *     alert  loop 4.0 s  SITS UP on its hind legs (owner-approved exception, a short natural alert pose): forepaws
 *                        hanging at the chest, ears straight up, nose twitch, ears swivel to the sides, a look right.
 *
 * DEER (red / roe deer hind): cellM 0.05, grid 12 x 32 x 33, anchor [6, 20.5, 0] (between the four hooves).
 *   1.6 m nose to tail, 1.0 m at the withers, croup 0.95 m, eyes 1.28 m, head top 1.35 m, ear tips 1.45 m.
 *   Deep chest, belly tucked up at the flank, rounded haunch; long neck rising forward-up to a narrow tapering head
 *   carried at ~45 deg, black nose, white chin, cream throat patch; big ears out-and-up with cream inner face and
 *   dark rims; slender legs (5 cm cannons, grey-brown lower legs, black hooves) widening into forearm / thigh, hock
 *   pointing back; WHITE RUMP PATCH under a short tail (brown outer face, white inner face: raised tail = white flag).
 *   deerBuck = the same deer + small roe-buck antlers (coronet, beam, front tine, back tine, pale tips; 0.3 m).
 *   Parts (8): body  [2,12,11, 10,30,21] pivot [6,20,15]      (mid trunk)
 *              head  [4,0,12, 8,12,33]   pivot [6,13,15.5]    parent body (neck + head + antlers; the pivot is the
 *                                                             neck root inside the chest so grazing reaches the grass)
 *              ears  [1,6,25, 11,10,30]  pivot [6,7.5,26.5]   parent head (both ears: rx perk / pin, ry = one ear
 *                                                             up, the other down = an ear flick, rz = swivel)
 *              tail  [4,30,14, 8,32,19]  pivot [6,30,18]      parent body
 *              legFL [2,12,0, 6,17,11] pivot [4.5,14.5,14] / legFR [6,12,0, 10,17,11] pivot [7.5,14.5,14] (shoulder)
 *              legBL [2,23,0, 6,29,11] pivot [4.5,25,15]   / legBR [6,23,0, 10,29,11] pivot [7.5,25,15]  (hip)
 *   Clips:
 *     idle    loop 5.4 s  breathing, an ear flick, a look left, two tail flicks, a look right.
 *     graze   loop 4.25 s neck down (head rx 86 + body 5 = nose 5 cm over the ground), nibbles left / right, ear
 *                         flick, tail flick, a forefoot steps forward and back (no foot slide).
 *     walk    loop 1.0 s  4-beat lateral walk (LH, LF, RH, RF; duty 0.65), head nods twice per stride. Tuned 0.75 m/s.
 *     trot    loop 0.6 s  diagonal pairs (duty 0.42), body dips at mid-stance, neck forward, tail half up. Tuned 2.4 m/s.
 *     gallop  loop 0.4 s  flee bound: hind feet push one after the other, a long stretched flight, forefeet land one
 *                         after the other, hind legs swing far forward under the belly; neck pumping, ears back,
 *                         tail UP = the white rump flag. Tuned 9 m/s.
 *     alert   loop 3.5 s  head high, ears perked, tail half raised (rump flare), frozen; ears swivel; a forefoot STAMP.
 *
 * Clip -> state map: ASSETS.wildlifeFx (bottom of the file). Engine notes for the wildlife system (architect): clip
 * switches want a short crossfade (~120 ms; voxel clips have no blend today), and the gait clips' playback rate should
 * follow the ground speed (rate = speed / tunedMps, clamped) so the planted feet do not slide.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var D2R = Math.PI / 180;

  // =================================================================================================================
  // shared helpers: voxel grid, ellipse slices, deterministic hash, rig + limb solver, clip builder
  // =================================================================================================================
  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function rr(a) { return [r2(a[0]), r2(a[1]), r2(a[2])]; }
  function v3(a) {
    if (a === undefined || a === null) return [0, 0, 0];
    if (typeof a === 'number') return [a, 0, 0];
    return [a[0] || 0, a[1] || 0, a[2] || 0];
  }
  function hash(x, y, z, s) {
    var h = Math.imul(x + 1, 73856093) ^ Math.imul(y + 7, 19349663) ^ Math.imul(z + 13, 83492791) ^ Math.imul(s + 1, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function Grid(SX, SY, SZ) {
    var G = [], x, y, z;
    for (z = 0; z < SZ; z++) { G.push([]); for (y = 0; y < SY; y++) { G[z].push([]); for (x = 0; x < SX; x++) G[z][y].push('.'); } }
    function inb(px, py, pz) { return px >= 0 && px < SX && py >= 0 && py < SY && pz >= 0 && pz < SZ; }
    var g = {
      get: function (px, py, pz) { return inb(px, py, pz) ? G[pz][py][px] : '.'; },
      put: function (px, py, pz, ch) { if (inb(px, py, pz)) G[pz][py][px] = ch; },
      // the cell and its mirror on the animal's right side (x -> SX-1-x)
      sym: function (px, py, pz, ch) { g.put(px, py, pz, ch); g.put(SX - 1 - px, py, pz, ch); },
      // recolour a filled cell (and its mirror) only
      paint: function (px, py, pz, ch) {
        if (g.get(px, py, pz) !== '.') g.put(px, py, pz, ch);
        if (g.get(SX - 1 - px, py, pz) !== '.') g.put(SX - 1 - px, py, pz, ch);
      },
      // y-slice ellipse: cells whose centres lie inside ((x+.5-cx)/rx)^2 + ((z+.5-cz)/rz)^2 <= 1, z >= zMin
      ellY: function (py, cx, cz, rx, rz, ch, zMin) {
        var z0 = Math.max(zMin || 0, Math.floor(cz - rz) - 1), z1 = Math.min(SZ - 1, Math.ceil(cz + rz) + 1);
        for (var pz = z0; pz <= z1; pz++) for (var px = 0; px < SX; px++) {
          var dx = (px + 0.5 - cx) / rx, dz = (pz + 0.5 - cz) / rz;
          if (dx * dx + dz * dz <= 1) g.put(px, py, pz, typeof ch === 'function' ? ch(px, py, pz) : ch);
        }
      },
      // ellipsoid restricted to x in [xa, xb], z >= zMin
      ell3: function (cx, cy, cz, rx, ry, rz, xa, xb, zMin, ch) {
        for (var pz = Math.max(zMin || 0, 0); pz < SZ; pz++) for (var py = 0; py < SY; py++) for (var px = xa; px <= xb; px++) {
          var dx = (px + 0.5 - cx) / rx, dy = (py + 0.5 - cy) / ry, dz = (pz + 0.5 - cz) / rz;
          if (dx * dx + dy * dy + dz * dz <= 1) g.put(px, py, pz, typeof ch === 'function' ? ch(px, py, pz) : ch);
        }
      },
      layers: function () {
        var out = [];
        for (var lz = 0; lz < SZ; lz++) { var rows = []; for (var ly = 0; ly < SY; ly++) rows.push(G[lz][ly].join('')); out.push(rows); }
        return out;
      }
    };
    return g;
  }

  // R = Rz * Ry * Rx (degrees), the engine's convention (engine/voxel/voxelPose.js)
  function rotM(rx, ry, rz) {
    var cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
    var cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
    return [
      [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
      [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
      [-sy, cy * sx, cy * cx]
    ];
  }
  function app(M, v) { return [M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2], M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2], M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]]; }
  function appT(M, v) { return [M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2], M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2], M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2]]; }

  // rig: partOrder = part names (insertion order), pivots = {name: [x,y,z]}, root = root part, limbs =
  // { FL: {part, foot: [x,y,z] rest foot point, L: pivot height (voxels), auto: stride angle from dy} , ... }
  function Rig(partOrder, pivots, root, limbs) {
    var limbOf = {}, k;
    for (k in limbs) limbOf[limbs[k].part] = k;
    function limbPose(L, spec, Rb, pb, tb, brx) {
      var pl = pivots[L.part];
      if (spec && spec.free) return { rot: rr(v3(spec.free)), pos: rr([0, 0, spec.up || 0]) };
      spec = spec || {};
      var dy = spec.dy || 0, dx = spec.dx || 0, lift = spec.lift || 0, s = dy / L.L;
      if (s > 0.9) s = 0.9; if (s < -0.9) s = -0.9;
      var wrx = (spec.rx || 0) + (L.auto ? Math.asin(s) / D2R : 0);
      var lr = [wrx - brx, spec.ry || 0, spec.rz || 0];
      var Rl = rotM(lr[0], lr[1], lr[2]), f = L.foot;
      var q = appT(Rb, [f[0] + dx - pb[0] - tb[0], f[1] + dy - pb[1] - tb[1], f[2] + lift - pb[2] - tb[2]]);
      var w = app(Rl, [f[0] - pl[0], f[1] - pl[1], f[2] - pl[2]]);
      return { rot: rr(lr), pos: rr([q[0] - w[0] - pl[0] + pb[0], q[1] - w[1] - pl[1] + pb[1], q[2] - w[2] - pl[2] + pb[2]]) };
    }
    // o = { b: [rx,ry,rz, px,py,pz], rot: {part: [rx,ry,rz]}, FL/FR/BL/BR: limb spec }
    function pose(o) {
      var b = o.b || [], brx = b[0] || 0, bry = b[1] || 0, brz = b[2] || 0, tb = [b[3] || 0, b[4] || 0, b[5] || 0];
      var Rb = rotM(brx, bry, brz), pb = pivots[root], out = {};
      for (var i = 0; i < partOrder.length; i++) {
        var n = partOrder[i];
        if (n === root) out[n] = { rot: rr([brx, bry, brz]), pos: rr(tb) };
        else if (limbOf[n]) out[n] = limbPose(limbs[limbOf[n]], o[limbOf[n]], Rb, pb, tb, brx);
        else out[n] = { rot: rr(v3((o.rot || {})[n])), pos: [0, 0, 0] };
      }
      return out;
    }
    function clip(keys, loop) {
      var d = [], f = [];
      for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(keys[i][1])); }
      return { durations: d, loop: loop, frames: f };
    }
    return { pose: pose, clip: clip };
  }
  // M(base, over): a copy of base with over's fields replacing it; `rot` is merged per part
  function M(base, over) {
    var o = {}, k;
    for (k in base) o[k] = base[k];
    for (k in over) o[k] = over[k];
    if (base.rot || over.rot) {
      o.rot = {};
      for (k in (base.rot || {})) o.rot[k] = base.rot[k];
      for (k in (over.rot || {})) o.rot[k] = over.rot[k];
    }
    return o;
  }

  // =================================================================================================================
  // RABBIT
  // =================================================================================================================
  (function () {
    var SX = 12, SY = 21, SZ = 16, CX = 6, SEED = 11;
    var g = Grid(SX, SY, SZ);

    // ---- trunk (body part): y 7..19, arched back highest over the loins (y 13-15), chest and belly >= z 3 ----
    var TR = [
      [6.0, 2.8, 2.4], [6.1, 3.2, 2.7], [6.2, 3.5, 2.9], [6.4, 3.8, 3.0], [6.6, 4.1, 3.0], [6.8, 4.3, 3.0], [6.9, 4.4, 3.0],
      [6.9, 4.5, 3.0], [6.8, 4.4, 3.0], [6.5, 4.2, 3.0], [6.0, 3.8, 2.8], [5.4, 3.2, 2.5], [4.8, 2.4, 2.0]
    ];
    function trunkMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, h = hash(x, y, z, SEED);
        if (rel < -0.72) return 'W';                                  // cream belly
        if (rel < -0.3) return h < 0.2 ? 'A' : 'L';                   // buff lower flank
        if (rel > 0.55) {
          if (y <= 8) return h < 0.3 ? 'A' : 'R';                     // rufous nape patch
          return h < 0.3 ? 'K' : 'A';                                 // ticked back
        }
        return h < 0.1 ? 'L' : (h > 0.94 ? 'K' : 'A');
      };
    }
    for (var i = 0; i < TR.length; i++) g.ellY(7 + i, CX, TR[i][0], TR[i][2], TR[i][1], trunkMat(TR[i][0], TR[i][1]), 3);
    // tail: a fluffy puff on the rump, dark top, white underside (the white flash when running)
    g.sym(5, 20, 5, 'W'); g.sym(5, 20, 6, 'W'); g.sym(5, 20, 7, 'K'); g.sym(5, 19, 7, 'K');

    // ---- head (head part): y 0..6, round skull, large side eyes ----
    var HD = [[8.2, 1.2, 1.2], [8.5, 1.8, 1.7], [8.8, 2.2, 2.1], [9.0, 2.5, 2.4], [9.1, 2.6, 2.6], [9.0, 2.6, 2.6], [8.6, 2.4, 2.4]];
    function headMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, h = hash(x, y, z, SEED + 1);
        if (y <= 1 && rel < 0.1) return 'W';                          // pale whisker pads
        if (rel < -0.6) return 'W';                                   // chin / throat
        if (rel < -0.1) return 'L';                                   // cheeks
        if (rel > 0.55) return h < 0.35 ? 'K' : 'A';                  // crown
        return 'A';
      };
    }
    for (i = 0; i < HD.length; i++) g.ellY(i, CX, HD[i][0], HD[i][2], HD[i][1], headMat(HD[i][0], HD[i][1]), 5);
    g.sym(5, 0, 8, 'N');                                              // nose (pinkish brown)
    g.sym(5, 0, 7, 'W');
    g.paint(4, 3, 9, 'E');                                            // large dark eyes on the sides
    g.paint(4, 3, 10, 'W'); g.paint(4, 2, 9, 'W');                    // pale eye ring

    // ---- ears (earL / earR parts): 4 cells (8 cm) on the top of the head, leaning back and a little out ----
    g.sym(5, 4, 12, 'A'); g.sym(5, 5, 12, 'A');
    g.sym(5, 4, 13, 'P'); g.sym(5, 5, 13, 'A');
    g.sym(4, 4, 14, 'P'); g.sym(4, 5, 14, 'A'); g.sym(5, 5, 14, 'A');
    g.sym(4, 5, 15, 'K');                                             // dark ear tips

    // ---- forelegs (legFL / legFR): thin, vertical under the chest, pale toes ----
    for (var z = 0; z <= 2; z++) g.sym(4, 8, z, 'L');
    g.sym(4, 9, 2, 'L'); g.sym(4, 7, 0, 'W');

    // ---- hind legs (legBL / legBR): big rounded haunch (x <= 3) over a long flat foot ----
    g.ell3(3.0, 16.0, 4.0, 2.0, 3.6, 3.0, 1, 3, 1, function (x, y, z) {
      var rel = (z + 0.5 - 4.0) / 3.0, h = hash(x, y, z, SEED + 2);
      if (rel > 0.45) return h < 0.3 ? 'K' : 'A';
      if (rel < -0.4) return 'L';
      return h < 0.12 ? 'L' : 'A';
    });
    for (var y = 13; y <= 18; y++) { g.sym(2, y, 0, y === 13 ? 'W' : (y >= 17 ? 'A' : 'L')); g.sym(3, y, 0, y === 13 ? 'W' : (y >= 17 ? 'A' : 'L')); }
    for (y = 16; y <= 18; y++) { g.sym(2, y, 1, 'A'); g.sym(3, y, 1, 'A'); }   // heel / hock
    g.sym(3, 14, 1, 'L'); g.sym(3, 15, 1, 'L');
    // mirror the haunch to the right side (ell3 filled x 1..3 only)
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (var x = 1; x <= 3; x++) {
      var c = g.get(x, y, z);
      if (c !== '.' && g.get(SX - 1 - x, y, z) === '.') g.put(SX - 1 - x, y, z, c);
    }

    var PARTS = {
      body:  { box: [3, 7, 3, 9, 21, 13], pivot: [6, 15, 5] },
      head:  { box: [2, 0, 5, 10, 7, 12], pivot: [6, 6.5, 8], parent: 'body' },
      earL:  { box: [3, 3, 12, 6, 8, 16], pivot: [5.5, 4.5, 12], parent: 'head' },
      earR:  { box: [6, 3, 12, 9, 8, 16], pivot: [6.5, 4.5, 12], parent: 'head' },
      legFL: { box: [3, 6, 0, 6, 10, 3], pivot: [4.5, 8.5, 3.5], parent: 'body' },
      legFR: { box: [6, 6, 0, 9, 10, 3], pivot: [7.5, 8.5, 3.5], parent: 'body' },
      legBL: { box: [1, 11, 0, 4, 21, 9], pivot: [3, 15, 5], parent: 'body' },
      legBR: { box: [8, 11, 0, 11, 21, 9], pivot: [9, 15, 5], parent: 'body' }
    };
    var ORDER = Object.keys(PARTS), PIV = {};
    for (i = 0; i < ORDER.length; i++) PIV[ORDER[i]] = PARTS[ORDER[i]].pivot;
    var rig = Rig(ORDER, PIV, 'body', {
      FL: { part: 'legFL', foot: [4.5, 8, 0], L: 3.5, auto: false },
      FR: { part: 'legFR', foot: [7.5, 8, 0], L: 3.5, auto: false },
      BL: { part: 'legBL', foot: [3, 14, 0], L: 5, auto: false },     // foot point = the toe ball (push-off pivot)
      BR: { part: 'legBR', foot: [9, 14, 0], L: 5, auto: false }
    });
    var clip = rig.clip;

    function E(l, r) { return { earL: l, earR: r }; }
    function H(h, ears) { var o = { head: h }; if (ears) { o.earL = ears.earL; o.earR = ears.earR; } return o; }
    var EAR_TURN_L = [0, -6, -35], EAR_TURN_R = [0, 6, 35];
    // graze base: body tipped 12 deg, chest 1 cm off the grass, nose down
    var GZ = { b: [12, 0, 0, 0, 0, -0.5], rot: H([34, 0, 0], E([-20, -4, -8], [-20, 4, 8])) };
    function gz(h, ears) { return M(GZ, { rot: H(h, ears || E([-20, -4, -8], [-20, 4, 8])) }); }
    // sitting up: body pitched 55 deg nose-up about the hip line, forepaws hanging, ears up, head level
    var SIT = { b: [-55, 0, 0, 0, 0, 0.4], rot: H([44, 0, 0], E([8, -3, -6], [8, 3, 6])),
                FL: { free: [55, 0, 0] }, FR: { free: [50, 0, 0] } };
    function sit(over) { return M(SIT, over); }

    var animations = {
      idle: clip([
        [600, {}],
        [100, { rot: H([2, 0, 0]) }],                                   // nose twitch (quick nods)
        [100, { rot: H([-1, 0, 0]) }],
        [100, { rot: H([2, 0, 0]) }],
        [400, { rot: H([0, 0, 0]) }],
        [700, { rot: H([0, 0, -6], E(EAR_TURN_L, [0, 0, 0])) }],       // left ear turns out to listen
        [300, { rot: H([0, 0, -6], E(EAR_TURN_L, [4, 0, 10])) }],
        [700, { rot: H([-3, 0, 8], E([-5, 0, 0], EAR_TURN_R)) }],      // right ear turns, head looks right
        [100, { rot: H([-1, 0, 8], E([-5, 0, 0], EAR_TURN_R)) }],
        [100, { rot: H([-4, 0, 8], E([-5, 0, 0], EAR_TURN_R)) }],
        [100, { rot: H([-1, 0, 8], E([-5, 0, 0], EAR_TURN_R)) }],
        [500, { rot: H([-3, 0, 8], E([-5, 0, 0], EAR_TURN_R)) }],
        [700, { b: [0, 0, 0, 0, 0, 0.2], rot: H([0, 0, 0], E([-14, 0, 0], [-14, 0, 0])) }],   // breath, ears relax back
        [100, {}]
      ], true),
      graze: clip([
        [300, gz([34, 0, 0])],
        [150, gz([36, 0, -4])],
        [150, gz([34, 0, -4])],
        [150, gz([36, 0, 3])],
        [150, gz([34, 0, 3])],
        [300, gz([35, 0, 0], E([-5, -4, -28], [-20, 4, 8]))],          // an ear turns while chewing
        [150, gz([36, 0, 5], E([-5, -4, -28], [-20, 4, 8]))],
        [250, gz([33, 0, 5])],
        [500, { b: [6, 0, 0, 0, 0, -0.3], rot: H([8, 0, 2], E([0, -4, -10], [0, 4, 10])) }],   // head up: chew, look
        [300, { b: [6, 0, 0, 0, 0, -0.3], rot: H([6, 0, -6], E([0, -4, -10], [0, 4, 14])) }],
        [200, gz([30, 0, 0])]
      ], true),
      // slow hop, 8 x 50 ms; planted feet slide 1.5 voxels (3 cm) per key = 0.6 m/s
      hop: clip([
        [50, { b: [-3, 0, 0, 0, 0, -0.3], rot: H([2, 0, 0], E([-10, -3, 0], [-10, 3, 0])),       // gather: forefeet lift
               FL: { free: [30, 0, 0], up: 0.8 }, FR: { free: [30, 0, 0], up: 0.8 }, BL: { dy: 0.8, rx: 6 }, BR: { dy: 0.8, rx: 6 } }],
        [50, { b: [-8, 0, 0, 0, 0, 0.2], rot: H([4, 0, 0], E([-14, -3, 0], [-14, 3, 0])),        // push: heels rise
               FL: { free: [-30, 0, 0], up: 0.5 }, FR: { free: [-30, 0, 0], up: 0.5 }, BL: { dy: 2.3, rx: 25 }, BR: { dy: 2.3, rx: 25 } }],
        [50, { b: [-2, 0, 0, 0, 0, 2.5], rot: H([1, 0, 0], E([-25, -4, 0], [-25, 4, 0])),        // flight, stretched
               FL: { free: [-45, 0, 0] }, FR: { free: [-45, 0, 0] }, BL: { free: [40, 0, 0] }, BR: { free: [40, 0, 0] } }],
        [50, { b: [10, 0, 0, 0, 0, 1.6], rot: H([-5, 0, 0], E([-20, -4, 0], [-20, 4, 0])),       // reaching down
               FL: { free: [-20, 0, 0] }, FR: { free: [-20, 0, 0] }, BL: { free: [10, 0, 0] }, BR: { free: [10, 0, 0] } }],
        [50, { b: [14, 0, 0, 0, 0, 0.4], rot: H([-7, 0, 0], E([-6, -3, 0], [-6, 3, 0])),         // forefeet land
               FL: { dy: -2.2, rx: -15 }, FR: { dy: -2.2, rx: -15 }, BL: { free: [-15, 0, 0], up: 0.5 }, BR: { free: [-15, 0, 0], up: 0.5 } }],
        [50, { b: [8, 0, 0, 0, 0, 0], rot: H([-4, 0, 0], E([-10, -3, 0], [-10, 3, 0])),
               FL: { dy: -0.7, rx: -5 }, FR: { dy: -0.7, rx: -5 }, BL: { free: [-30, 0, 0], up: 1.5 }, BR: { free: [-30, 0, 0], up: 1.5 } }],
        [50, { b: [2, 0, 0, 0, 0, -0.2], rot: H([-1, 0, 0], E([-12, -3, 0], [-12, 3, 0])),       // hind feet land
               FL: { dy: 0.8, rx: 8 }, FR: { dy: 0.8, rx: 8 }, BL: { dy: -2.2, rx: -6 }, BR: { dy: -2.2, rx: -6 } }],
        [50, { b: [0, 0, 0, 0, 0, -0.4], rot: H([0, 0, 0], E([-10, -3, 0], [-10, 3, 0])),        // crouch
               FL: { dy: 2.3, rx: 20 }, FR: { dy: 2.3, rx: 20 }, BL: { dy: -0.7 }, BR: { dy: -0.7 } }]
      ], true),
      // fast bound, 6 x 50 ms; ears flat along the back
      run: clip([
        [50, { b: [-8, 0, 0, 0, 0, 0.3], rot: H([6, 0, 0], E([-45, -4, 0], [-45, 4, 0])),        // hind push
               FL: { free: [-55, 0, 0], up: 0.5 }, FR: { free: [-50, 0, 0], up: 0.5 }, BL: { dy: 1.5, rx: 30 }, BR: { dy: 1.5, rx: 30 } }],
        [50, { b: [-2, 0, 0, 0, 0, 3.5], rot: H([4, 0, 0], E([-50, -4, 0], [-50, 4, 0])),        // stretched flight
               FL: { free: [-60, 0, 0] }, FR: { free: [-55, 0, 0] }, BL: { free: [55, 0, 0] }, BR: { free: [55, 0, 0] } }],
        [50, { b: [8, 0, 0, 0, 0, 3.0], rot: H([0, 0, 0], E([-48, -4, 0], [-48, 4, 0])),         // gathering
               FL: { free: [-15, 0, 0] }, FR: { free: [-25, 0, 0] }, BL: { free: [15, 0, 0], up: 1 }, BR: { free: [20, 0, 0], up: 1 } }],
        [50, { b: [14, 0, 0, 0, 0, 0.6], rot: H([-6, 0, 0], E([-40, -4, 0], [-40, 4, 0])),       // left forefoot lands
               FL: { dy: -3, rx: -20 }, FR: { free: [-30, 0, 0], up: 1 }, BL: { free: [-20, 0, 0], up: 1.5 }, BR: { free: [-20, 0, 0], up: 1.5 } }],
        [50, { b: [10, 0, 0, 0, 0, 0.2], rot: H([-4, 0, 0], E([-42, -4, 0], [-42, 4, 0])),       // right forefoot, hinds swing far
               FL: { dy: 0, rx: 5 }, FR: { dy: -2, rx: -12 }, BL: { free: [-50, 0, 0], up: 2 }, BR: { free: [-50, 0, 0], up: 2 } }],
        [50, { b: [0, 0, 0, 0, 0, -0.2], rot: H([2, 0, 0], E([-45, -4, 0], [-45, 4, 0])),        // hind feet land ahead
               FL: { free: [35, 0, 0], up: 1 }, FR: { dy: 2, rx: 25 }, BL: { dy: -3, rx: -10 }, BR: { dy: -2.5, rx: -8 } }]
      ], true),
      sitUp: clip([
        [100, {}],
        [150, { b: [-30, 0, 0, 0, 0, 0.2], rot: H([24, 0, 0], E([2, -3, -3], [2, 3, 3])), FL: { free: [30, 0, 0] }, FR: { free: [28, 0, 0] } }],
        [150, SIT]
      ], false),
      alert: clip([
        [1200, SIT],
        [100, sit({ rot: H([42, 0, 0], E([8, -3, -6], [8, 3, 6])) })],         // nose twitch
        [100, sit({ rot: H([45, 0, 0], E([8, -3, -6], [8, 3, 6])) })],
        [300, SIT],
        [300, sit({ rot: H([44, 0, 0], E([6, -3, -32], [6, 3, 32])) })],       // both ears swivel to the sides
        [900, sit({ rot: H([44, 0, 0], E([6, -3, -32], [6, 3, 32])) })],
        [300, sit({ rot: H([44, 0, 14], E([8, -3, -6], [8, 3, 20])) })],       // a look right
        [800, sit({ rot: H([44, 0, 14], E([8, -3, -6], [8, 3, 20])) })]
      ], true)
    };

    A.models.rabbit = {
      name: 'rabbit',
      displayName: 'wild rabbit',
      desc: 'v1.53 EP-WILD preview: European wild rabbit, 0.42 m nose to tail, 0.22 m at the arched back: crouched ' +
            'rounded body, big haunches on long flat hind feet, thin forelegs, round head with big side eyes and a ' +
            'pale eye ring, long ears with dark tips, rufous nape, cream belly, white tail underside. 8 parts (body, ' +
            'head, 2 ears, 4 legs): idle, graze, hop, run, sitUp, alert (sits up on its haunches).',
      voxel: {
        version: 1,
        meshOnly: true,
        cellM: 0.02,
        size: [SX, SY, SZ],
        anchor: [6, 12, 0],
        light: false,
        mats: {
          A: 'fur_agouti',        // back, flanks, head (ticked grey-brown)
          K: 'fur_agouti_dark',   // dorsal ticking, ear tips, tail top
          L: 'fur_agouti_light',  // lower flanks, cheeks, legs (buff)
          W: 'fur_cream',         // belly, chin, whisker pads, eye ring, tail underside, toes
          R: 'fur_roe_light',     // rufous nape
          P: 'skin',              // inner ear (pinkish)
          N: 'skin_flush',        // nose
          E: 'iron_dark'          // eyes
        },
        layers: g.layers(),
        parts: PARTS,
        animations: animations,
        mounts: {
          eyes:   { at: [6, 3, 9.5], part: 'head' },     // look-at / head-turn target
          nose:   { at: [6, 0, 8], part: 'head' },       // sniff / graze contact
          tail:   { at: [6, 20.5, 6.5], part: 'body' },  // the white flash (flee readability)
          center: { at: [6, 13, 6], part: 'body' }       // body centre (hit / despawn checks, 0.12 m)
        }
      }
    };
  })();

  // =================================================================================================================
  // DEER (doe = `deer`, roe buck = `deerBuck`)
  // =================================================================================================================
  function buildDeer(antlers) {
    var SX = 12, SY = 32, SZ = 33, CX = 6, SEED = 23;
    var g = Grid(SX, SY, SZ), i, y, z;

    // ---- trunk (body part): y 12..29; withers 1.0 m, flank tucked up, rounded haunch, white rump patch ----
    var TR = [
      [16.0, 3.6, 2.6], [15.8, 4.2, 3.0], [15.6, 4.5, 3.3], [15.5, 4.5, 3.5], [15.5, 4.4, 3.6], [15.6, 4.2, 3.7],
      [15.7, 4.0, 3.8], [15.8, 3.8, 3.8], [15.9, 3.6, 3.8], [15.9, 3.5, 3.7], [15.9, 3.5, 3.7], [15.8, 3.6, 3.7],
      [15.7, 3.8, 3.7], [15.6, 3.9, 3.6], [15.5, 3.9, 3.5], [15.4, 3.7, 3.3], [15.3, 3.3, 2.9], [15.3, 2.6, 2.3]
    ];
    function trunkMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, ax = Math.abs(x + 0.5 - CX), h = hash(x, y, z, SEED);
        if (y >= 28 && rel < 0.55 && ax <= 2.2) return 'W';            // white rump patch
        if (rel < -0.8 && ax < 2) return 'W';                         // cream belly line
        if (rel < -0.45) return h < 0.25 ? 'B' : 'L';                 // lighter lower flank
        if (rel > 0.7) return ax <= 1.0 ? 'K' : (h < 0.15 ? 'K' : 'B');   // dark dorsal line
        return h < 0.08 ? 'L' : 'B';
      };
    }
    for (i = 0; i < TR.length; i++) g.ellY(12 + i, CX, TR[i][0], TR[i][2], TR[i][1], trunkMat(TR[i][0], TR[i][1]), 11);

    // ---- neck (head part): rising forward-up from the chest, dark mane line, cream throat patch ----
    var NK = [[17.6, 3.2, 2.0], [18.9, 3.0, 1.9], [20.2, 2.8, 1.8], [21.5, 2.6, 1.8], [22.8, 2.5, 1.8]];   // y 11 .. 7
    function neckMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz;
        if (rel > 0.7) return 'K';
        if (y >= 8 && y <= 10 && rel < -0.6) return 'W';
        if (rel < -0.35) return 'L';
        return 'B';
      };
    }
    for (i = 0; i < NK.length; i++) g.ellY(11 - i, CX, NK[i][0], NK[i][2], NK[i][1], neckMat(NK[i][0], NK[i][1]), 12);
    // ---- head: y 0..7, narrow tapering skull and muzzle, carried at ~45 deg ----
    var HD = [[22.5, 1.2, 1.2], [22.9, 1.4, 1.3], [23.4, 1.5, 1.4], [24.0, 1.6, 1.5], [24.5, 1.8, 1.7], [25.0, 2.0, 1.9],
              [25.2, 2.3, 2.0], [25.0, 2.4, 1.9]];
    function headMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz;
        if (y <= 2 && rel < -0.2) return 'W';                         // white chin and lower lip
        if (y <= 2) return 'L';                                       // muzzle
        if (y >= 4 && rel > 0.6) return 'K';                          // darker crown
        if (rel < -0.4) return 'L';                                   // cheeks
        return 'B';
      };
    }
    for (i = 0; i < HD.length; i++) g.ellY(i, CX, HD[i][0], HD[i][2], HD[i][1], headMat(HD[i][0], HD[i][1]), 12);
    g.paint(5, 0, 22, 'H'); g.paint(5, 0, 23, 'H'); g.paint(5, 1, 23, 'H');   // black nose (rhinarium)
    g.paint(4, 5, 25, 'H');                                                  // eyes
    g.sym(4, 7, 26, 'B');                                                    // ear roots (head part)

    // ---- ears (ears part): big, out and up at ~45 deg, cream inner face, dark rims ----
    g.sym(3, 7, 26, 'B'); g.sym(3, 8, 26, 'B');
    g.sym(2, 7, 27, 'W'); g.sym(2, 8, 27, 'B');
    g.sym(1, 7, 28, 'K');

    // ---- antlers (head part, buck only): roe buck, coronet + beam + front tine + back tine, pale tips ----
    if (antlers) {
      g.sym(5, 6, 27, 'T'); g.sym(5, 6, 28, 'T'); g.sym(5, 6, 29, 'T'); g.sym(5, 5, 29, 't');
      g.sym(5, 6, 30, 'T'); g.sym(4, 6, 30, 'T'); g.sym(4, 6, 31, 'T'); g.sym(4, 7, 31, 't'); g.sym(4, 6, 32, 't');
    }

    // ---- tail (tail part): short, hangs over the rump patch; outer face brown, inner face white ----
    for (z = 15; z <= 17; z++) g.sym(5, 30, z, 'W');
    g.sym(5, 31, 16, 'K'); g.sym(5, 31, 17, 'K');

    // ---- legs: slender 5 cm cannons, grey-brown lower legs, black hooves, forearm / thigh ----
    // front (x 4 left, mirrored x 7): hoof, pastern + cannon, knee, forearm, elbow
    g.sym(4, 14, 0, 'H');
    for (z = 1; z <= 5; z++) g.sym(4, 14, z, 'G');
    g.sym(4, 14, 6, 'G'); g.sym(4, 15, 6, 'G');
    for (z = 7; z <= 8; z++) { g.sym(4, 14, z, 'B'); g.sym(4, 15, z, 'L'); }
    for (z = 9; z <= 10; z++) { g.sym(4, 14, z, 'B'); g.sym(4, 15, z, 'B'); g.sym(3, 14, z, 'B'); g.sym(3, 15, z, 'B'); }
    g.sym(4, 14, 11, 'B'); g.sym(4, 15, 11, 'B'); g.sym(3, 14, 11, 'B'); g.sym(3, 15, 11, 'B');   // elbow (body part)
    // hind (x 4 left): hoof, cannon, hock pointing back, gaskin, stifle / thigh
    g.sym(4, 26, 0, 'H');
    for (z = 1; z <= 6; z++) g.sym(4, 26, z, 'G');
    g.sym(4, 26, 7, 'G'); g.sym(4, 27, 7, 'G');
    g.sym(4, 26, 8, 'B'); g.sym(4, 27, 8, 'B');
    g.sym(4, 25, 9, 'B'); g.sym(4, 26, 9, 'B'); g.sym(3, 26, 9, 'B');
    for (y = 24; y <= 26; y++) { g.sym(4, y, 10, 'B'); g.sym(3, y, 10, 'B'); g.sym(4, y, 11, 'B'); g.sym(3, y, 11, 'B'); g.sym(3, y, 12, 'B'); }

    var PARTS = {
      body:  { box: [2, 12, 11, 10, 30, 21], pivot: [6, 20, 15] },
      head:  { box: [4, 0, 12, 8, 12, 33], pivot: [6, 13, 15.5], parent: 'body' },
      ears:  { box: [1, 6, 25, 11, 10, 30], pivot: [6, 7.5, 26.5], parent: 'head' },
      tail:  { box: [4, 30, 14, 8, 32, 19], pivot: [6, 30, 18], parent: 'body' },
      legFL: { box: [2, 12, 0, 6, 17, 11], pivot: [4.5, 14.5, 14], parent: 'body' },
      legFR: { box: [6, 12, 0, 10, 17, 11], pivot: [7.5, 14.5, 14], parent: 'body' },
      legBL: { box: [2, 23, 0, 6, 29, 11], pivot: [4.5, 25, 15], parent: 'body' },
      legBR: { box: [6, 23, 0, 10, 29, 11], pivot: [7.5, 25, 15], parent: 'body' }
    };
    var ORDER = Object.keys(PARTS), PIV = {};
    for (i = 0; i < ORDER.length; i++) PIV[ORDER[i]] = PARTS[ORDER[i]].pivot;
    var LIMBS = {
      FL: { part: 'legFL', foot: [4.5, 14.5, 0], L: 14, auto: true },
      FR: { part: 'legFR', foot: [7.5, 14.5, 0], L: 14, auto: true },
      BL: { part: 'legBL', foot: [4.5, 26.5, 0], L: 15, auto: true },
      BR: { part: 'legBR', foot: [7.5, 26.5, 0], L: 15, auto: true }
    };
    var rig = Rig(ORDER, PIV, 'body', LIMBS), clip = rig.clip;
    var LN = ['FL', 'FR', 'BL', 'BR'];

    // procedural gait: phase[L] = (1 - touchdown time) per limb, beta = duty factor, A = half stride (voxels),
    // H = swing lift, dropK = body follows the legs' stride drop, bounce = + up / - down at mid-stance
    function gait(cfg) {
      var keys = [], n = cfg.n, ms = cfg.T / n;
      for (var k = 0; k < n; k++) {
        var t = k / n, o = {}, drop = 0, cnt = 0, mid = 0;
        for (var j = 0; j < 4; j++) {
          var L = LN[j], u = (t + cfg.phase[L]) % 1, dy, lift;
          if (u < cfg.beta) {
            var s = u / cfg.beta;
            dy = -cfg.A + 2 * cfg.A * s; lift = 0;
            var th = Math.asin(Math.max(-0.9, Math.min(0.9, dy / LIMBS[L].L)));
            drop += LIMBS[L].L * (1 - Math.cos(th)); cnt++;
            mid = Math.max(mid, Math.sin(Math.PI * s));
          } else {
            var s2 = (u - cfg.beta) / (1 - cfg.beta), e = 0.5 - 0.5 * Math.cos(Math.PI * s2);
            dy = cfg.A - 2 * cfg.A * e; lift = cfg.H * Math.sin(Math.PI * s2);
          }
          o[L] = { dy: dy, lift: lift };
        }
        var bz = -(cnt ? drop / cnt : 0) * cfg.dropK + cfg.bounce * mid;
        o.b = [cfg.pitch * Math.sin(2 * Math.PI * (2 * t)), 0, cfg.yaw * Math.sin(2 * Math.PI * t), 0, 0, bz];
        o.rot = { head: [cfg.head0 + cfg.nod * Math.sin(2 * Math.PI * (2 * t + 0.25)), 0, -cfg.yaw * 0.6 * Math.sin(2 * Math.PI * t)],
                  ears: cfg.ears, tail: cfg.tail };
        keys.push([ms, o]);
      }
      return keys;
    }

    // graze base: body tipped 5 deg and 2.5 cm lower, neck down (nose ~5 cm over the grass), forefeet a little forward
    var GZ = { b: [5, 0, 0, 0, 0, -0.5], rot: { head: [86, 0, 0], ears: [-8, 0, 0], tail: [0, 0, 0] }, FL: { dy: -1.5 }, FR: { dy: -0.5 } };
    function gz(over) { return M(GZ, over); }
    function gh(h, ears, tail) { return { head: h, ears: ears || [-8, 0, 0], tail: tail || [0, 0, 0] }; }
    // alert base: head high, ears perked, tail half raised
    var AL = { b: [0, 0, 0, 0, 0, 0.2], rot: { head: [-16, 0, 0], ears: [18, 0, 0], tail: [25, 0, 0] } };
    function al(over) { return M(AL, over); }
    var BREATH = { b: [0, 0, 0, 0, 0, 0.15], rot: { head: [2, 0, 0] } };

    var animations = {
      idle: clip([
        [800, {}],
        [700, BREATH],
        [100, { rot: { ears: [0, 14, 0] } }],                                // ear flick (one up, one down)
        [100, { rot: { ears: [0, -6, 0] } }],
        [600, { rot: { ears: [0, 0, 0] } }],
        [700, { rot: { head: [-5, 0, -15], ears: [4, 0, -8] } }],            // looks left
        [100, { rot: { head: [-5, 0, -15], ears: [4, 0, -8], tail: [35, 0, 0] } }],   // tail flick x2
        [100, { rot: { head: [-5, 0, -15], ears: [4, 0, -8], tail: [0, 0, 0] } }],
        [100, { rot: { head: [-5, 0, -15], ears: [4, 0, -8], tail: [30, 0, 0] } }],
        [600, { rot: { head: [-4, 0, -14], ears: [4, 0, -8], tail: [0, 0, 0] } }],
        [700, { b: [0, 0, 0, 0, 0, 0.15], rot: { head: [-3, 0, 10], ears: [6, 0, 8] } }],   // looks right
        [800, { rot: { head: [0, 0, 8], ears: [2, 0, 4] } }]
      ], true),
      graze: clip([
        [500, GZ],
        [250, gz({ rot: gh([88, 0, 5]) })],
        [250, gz({ rot: gh([85, 0, -3]) })],
        [250, gz({ rot: gh([88, 0, -6]) })],
        [400, gz({ rot: gh([86, 0, 2], [-8, 10, 0]) })],                     // ear flick
        [100, gz({ rot: gh([86, 0, 2], [-8, -8, 0]) })],
        [300, gz({ rot: gh([87, 0, 6], null, [35, 0, 0]) })],                // tail flick
        [100, gz({ rot: gh([86, 0, 4]) })],
        [300, gz({ rot: gh([86, 0, 4]), FL: { dy: -3, lift: 2 } })],         // a forefoot steps forward
        [300, gz({ rot: gh([87, 0, 0]), FL: { dy: -3 } })],
        [600, gz({ rot: gh([88, 0, -4]), FL: { dy: -3 } })],
        [300, gz({ rot: gh([86, 0, -2]), FL: { dy: -2.2, lift: 1.5 } })],    // ... and back
        [300, gz({ rot: gh([86, 0, 0]), FL: { dy: -1.5 } })],
        [200, GZ]
      ], true),
      walk: clip(gait({ n: 10, T: 1000, beta: 0.65, A: 5, H: 2, phase: { BL: 0, FL: 0.75, BR: 0.5, FR: 0.25 },
                        dropK: 0.6, bounce: 0.15, pitch: 0.6, yaw: 1.5, head0: 0, nod: 4, ears: [0, 0, 0], tail: [0, 0, 0] }), true),
      trot: clip(gait({ n: 12, T: 600, beta: 0.42, A: 6, H: 3, phase: { FL: 0, BR: 0, FR: 0.5, BL: 0.5 },
                        dropK: 0.6, bounce: -0.4, pitch: 0.8, yaw: 0, head0: 6, nod: 2, ears: [-6, 0, 0], tail: [15, 0, 0] }), true),
      // flee bound, 8 x 50 ms: planted feet slide 9 voxels (0.45 m) per key = 9 m/s
      gallop: clip([
        [50, { b: [-5, 0, 0, 0, 0, 0], rot: { head: [8, 0, 0], ears: [-30, 0, 0], tail: [70, 0, 0] },
               BL: { dy: 4 }, BR: { dy: -5 }, FL: { free: [-10, 0, 0], up: 3 }, FR: { free: [35, 0, 0], up: 2 } }],
        [50, { b: [-7, 0, 0, 0, 0, 0.1], rot: { head: [6, 0, 0], ears: [-30, 0, 0], tail: [70, 0, 0] },
               BL: { free: [35, 0, 0], up: 0.5 }, BR: { dy: 4 }, FL: { free: [-40, 0, 0], up: 1.5 }, FR: { free: [-15, 0, 0], up: 3 } }],
        [50, { b: [-2, 0, 0, 0, 0, 2.5], rot: { head: [10, 0, 0], ears: [-32, 0, 0], tail: [72, 0, 0] },
               BL: { free: [45, 0, 0] }, BR: { free: [40, 0, 0], up: 0.5 }, FL: { free: [-50, 0, 0] }, FR: { free: [-45, 0, 0], up: 1 } }],
        [50, { b: [4, 0, 0, 0, 0, 2.0], rot: { head: [14, 0, 0], ears: [-30, 0, 0], tail: [70, 0, 0] },
               BL: { free: [25, 0, 0], up: 2 }, BR: { free: [45, 0, 0] }, FL: { free: [-35, 0, 0] }, FR: { free: [-48, 0, 0] } }],
        [50, { b: [7, 0, 0, 0, 0, 0.3], rot: { head: [16, 0, 0], ears: [-28, 0, 0], tail: [68, 0, 0] },
               BL: { free: [-10, 0, 0], up: 3 }, BR: { free: [20, 0, 0], up: 2 }, FL: { dy: -5 }, FR: { free: [-30, 0, 0], up: 0.5 } }],
        [50, { b: [9, 0, 0, 0, 0, -0.2], rot: { head: [14, 0, 0], ears: [-28, 0, 0], tail: [68, 0, 0] },
               BL: { free: [-35, 0, 0], up: 2 }, BR: { free: [-15, 0, 0], up: 3 }, FL: { dy: 4 }, FR: { dy: -5 } }],
        [50, { b: [5, 0, 0, 0, 0, -0.2], rot: { head: [10, 0, 0], ears: [-30, 0, 0], tail: [70, 0, 0] },
               BL: { free: [-40, 0, 0], up: 1 }, BR: { free: [-38, 0, 0], up: 2 }, FL: { free: [30, 0, 0], up: 1.5 }, FR: { dy: 4 } }],
        [50, { b: [0, 0, 0, 0, 0, 0], rot: { head: [8, 0, 0], ears: [-30, 0, 0], tail: [70, 0, 0] },
               BL: { dy: -5 }, BR: { free: [-35, 0, 0], up: 1 }, FL: { free: [40, 0, 0], up: 2 }, FR: { free: [30, 0, 0], up: 1.5 } }]
      ], true),
      alert: clip([
        [1350, AL],
        [300, al({ rot: { head: [-16, 0, 0], ears: [18, 0, 14], tail: [25, 0, 0] } })],     // ears swivel
        [900, al({ rot: { head: [-16, 0, 0], ears: [18, 0, 14], tail: [25, 0, 0] } })],
        [150, al({ rot: { head: [-16, 0, 6], ears: [18, 0, 0], tail: [30, 0, 0] }, FL: { dy: -0.5, lift: 2.5 } })],   // stamp
        [100, al({ rot: { head: [-16, 0, 6], ears: [18, 0, 0], tail: [30, 0, 0] }, FL: { dy: 0 } })],
        [200, al({ b: [0, 0, 0, 0, 0, 0.1], rot: { head: [-15, 0, 4], ears: [18, 0, 0], tail: [30, 0, 0] } })],
        [500, AL]
      ], true)
    };

    var mats = {
      B: 'fur_roe',          // body, neck, face (red-brown)
      K: 'fur_roe_dark',     // dorsal line, mane, crown, ear tips, tail top
      L: 'fur_roe_light',    // lower flanks, cheeks, muzzle, back of the forearm
      W: 'fur_cream',        // rump patch, belly line, throat, chin, inner ears, tail underside
      G: 'fur_agouti',       // grey-brown lower legs
      H: 'iron_dark'         // hooves, nose, eyes
    };
    if (antlers) { mats.T = 'antler'; mats.t = 'linen_light'; }
    return {
      name: antlers ? 'deerBuck' : 'deer',
      displayName: antlers ? 'roe buck' : 'deer',
      desc: 'v1.53 EP-WILD preview: ' + (antlers ? 'roe buck (the deer + small antlers with front and back tines)' : 'red / roe deer hind') +
            ', 1.6 m nose to tail, 1.0 m at the withers: deep chest, tucked flank, long neck, narrow head with black ' +
            'nose and white chin, big ears, slender legs with black hooves, white rump patch under a short tail. ' +
            '8 parts (body, head + neck, ears, tail, 4 legs): idle, graze, walk, trot, gallop (flee), alert.',
      voxel: {
        version: 1,
        meshOnly: true,
        cellM: 0.05,
        size: [SX, SY, SZ],
        anchor: [6, 20.5, 0],
        light: false,
        mats: mats,
        layers: g.layers(),
        parts: PARTS,
        animations: animations,
        mounts: {
          eyes:   { at: [6, 5, 25.5], part: 'head' },    // look-at (1.28 m)
          nose:   { at: [6, 0, 22.5], part: 'head' },    // graze contact
          rump:   { at: [6, 29.5, 15], part: 'body' },   // the white rump flag (flee readability)
          center: { at: [6, 20, 15], part: 'body' }      // body centre (0.75 m)
        }
      }
    };
  }
  A.models.deer = buildDeer(false);
  A.models.deerBuck = buildDeer(true);

  // =================================================================================================================
  // ASSETS.wildlifeFx - presentation data for the ambient wildlife system (architect designs the system next; no game
  // logic here). Distances in metres from the player, speeds in m/s, times in seconds.
  // =================================================================================================================
  A.wildlifeFx = {
    version: 1,
    states: ['idle', 'graze', 'move', 'flee', 'alert'],
    animals: {
      rabbit: {
        models: ['rabbit'],
        clipFor: { idle: 'idle', graze: 'graze', move: 'hop', flee: 'run', alert: 'alert' },
        enter: { alert: 'sitUp' },                     // play once when entering the state, then the state clip
        once: { sitUp: 'alert' },
        gaits: [
          { clip: 'hop', tunedMps: 0.6, minMps: 0.3, maxMps: 1.5, rate: [0.6, 2.0] },
          { clip: 'run', tunedMps: 1.8, minMps: 1.5, maxMps: 8.0, rate: [1.0, 1.6] }
        ],
        speeds: { wander: 0.7, flee: 5.5, fleeBurst: 7.0 },
        dist: { notice: 12, alert: 9, flee: 5, fleeIfRunning: 9, safe: 22 },
        times: { idle: [2, 6], graze: [4, 12], alert: [1.5, 4], wanderHopM: [0.5, 3] },
        flee: { turnDegPerS: 540, zigzagDeg: 35, zigzagEveryS: 0.5, maxDistM: 30, hideOrDespawn: true },
        blendMs: 120,
        groupSize: [1, 3],
        habitat: 'meadow edges, path verges, forest clearings; never deep forest',
        note: 'Gait rate = speed / tunedMps clamped to `rate`: the hop keeps its planted feet still at 0.6 m/s; the run ' +
              'touches the ground for only 50 ms per foot, so it can play at 1.0-1.6x for any flee speed (foot slip is ' +
              'not visible). alert = sits up (sitUp once, then alert loop); from alert go to flee or back to idle.'
      },
      deer: {
        models: ['deer', 'deerBuck'],
        clipFor: { idle: 'idle', graze: 'graze', move: 'walk', flee: 'gallop', alert: 'alert' },
        extra: { trot: 'trot' },                       // a nervous move / the first steps out of a flee
        gaits: [
          { clip: 'walk', tunedMps: 0.75, minMps: 0.3, maxMps: 1.4, rate: [0.5, 1.8] },
          { clip: 'trot', tunedMps: 2.4, minMps: 1.4, maxMps: 4.0, rate: [0.6, 1.6] },
          { clip: 'gallop', tunedMps: 9.0, minMps: 4.0, maxMps: 13.0, rate: [0.6, 1.4] }
        ],
        speeds: { wander: 0.8, nervous: 2.4, flee: 9.0 },
        dist: { notice: 35, alert: 25, flee: 16, fleeIfRunning: 25, safe: 60 },
        times: { idle: [3, 8], graze: [6, 20], alert: [2, 5], wanderM: [3, 12] },
        flee: { turnDegPerS: 180, maxDistM: 80, hideOrDespawn: true },
        blendMs: 150,
        groupSize: [1, 4],
        buckChance: 0.3,
        habitat: 'forest edges and clearings, meadows at the forest line',
        note: 'Gait rate = speed / tunedMps clamped to `rate`. alert = head up, frozen, a forefoot stamp; then flee ' +
              '(gallop, tail up = white rump flag) or back to graze / idle. Trot = the first second of a flee or a ' +
              'nervous move away.'
      }
    },
    engineNotes: [
      'crossfade between voxel clips (~120-150 ms) so state switches do not snap',
      'per-instance clip playback rate (rate = ground speed / tunedMps) so gait feet stay planted',
      'optional: random start phase per instance so a group does not move in sync'
    ]
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { rabbit: A.models.rabbit, deer: A.models.deer, deerBuck: A.models.deerBuck, wildlifeFx: A.wildlifeFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
