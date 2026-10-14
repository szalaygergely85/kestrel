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
 * v1.58 (EP-WILD step 2, owner 2026-10-11 "nice properly detailed rabbit, fox, bird etc."): detail pass on rabbit
 * (dorsal stripe, rufous shoulders, 2-cell eyes + catch-light, wider pink inner ears, bigger white scut) and deer
 * (back ticks, pale muzzle band, eye ring + preorbital line, dark pasterns, dewclaws, hock tuft); NEW fox, squirrel,
 * songbird (robin + finch coats), crow (= Rook). Their headers sit above each builder below. New palette materials:
 * fur_fox, fur_fox_light; the rest reuse fur_*, hair_*, dye_*, eye_brown, iron_dark, linen_light (catch-lights).
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
          if (Math.abs(x + 0.5 - CX) < 1.2) return h < 0.55 ? 'K' : 'A';   // v1.58: darker dorsal stripe
          return h < 0.3 ? 'K' : (h > 0.9 ? 'L' : 'A');               // ticked back, a few pale tips
        }
        if (rel > 0.2 && y <= 10) return h < 0.25 ? 'R' : 'A';        // v1.58: warm rufous wash on the shoulders
        return h < 0.1 ? 'L' : (h > 0.94 ? 'K' : 'A');
      };
    }
    for (var i = 0; i < TR.length; i++) g.ellY(7 + i, CX, TR[i][0], TR[i][2], TR[i][1], trunkMat(TR[i][0], TR[i][1]), 3);
    // tail: a fluffy white scut on the rump (the white flash when running), dark top
    g.sym(5, 20, 4, 'W'); g.sym(5, 20, 5, 'W'); g.sym(4, 20, 5, 'W'); g.sym(5, 20, 6, 'W'); g.sym(4, 20, 6, 'W');
    g.sym(5, 19, 4, 'W'); g.sym(5, 20, 7, 'K'); g.sym(5, 19, 7, 'K');

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
    g.paint(4, 3, 9, 'E'); g.paint(3, 4, 9, 'E');                     // large dark eyes on the sides (2 cells)
    g.paint(4, 3, 10, 'S');                                           // v1.58: wet catch-light on the top front of the eye
    g.paint(4, 2, 9, 'W');                                            // pale eye ring

    // ---- ears (earL / earR parts): 4 cells (8 cm) on the top of the head, leaning back and a little out ----
    // v1.58: pink inner face 2 cells wide, dark rim on the back edge, dark tips both columns
    g.sym(5, 4, 12, 'A'); g.sym(5, 5, 12, 'A');
    g.sym(5, 4, 13, 'P'); g.sym(5, 5, 13, 'A'); g.sym(4, 5, 13, 'K');
    g.sym(4, 4, 14, 'P'); g.sym(5, 4, 14, 'P'); g.sym(4, 5, 14, 'A'); g.sym(5, 5, 14, 'A');
    g.sym(4, 5, 15, 'K'); g.sym(4, 4, 15, 'K');                       // dark ear tips

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
      // GAIT-A BEGIN walk (tools/gen-gait.mjs: option A, lateral gait, duty 0.7, tuned 0.15 m/s, 12 keys x 50 ms; re-run, do not hand-edit)
      walk: { durations: [50,50,50,50,50,50,50,50,50,50,50,50], loop: true, frames: [
          { body: { rot: [1.129,1.902,0], pos: [0,0,0.054] }, head: { rot: [-0.056,0,0], pos: [0,0,0] }, earL: { rot: [2.728,0,0], pos: [0,0,0] }, earR: { rot: [2.728,0,0], pos: [0,0,0] }, legFL: { rot: [22.54,0,0], pos: [0,0,0.53] }, legFR: { rot: [-7.387,0,0], pos: [0,0,0.155] }, legBL: { rot: [-18.361,0,0], pos: [0,0,0.805] }, legBR: { rot: [7.759,0,0], pos: [0,0,0.292] } },
          { body: { rot: [1.994,1.338,1], pos: [0,0,0.1] }, head: { rot: [-0.1,0,-0.8], pos: [0,0,0] }, earL: { rot: [0.283,0,0], pos: [0,0,0] }, earR: { rot: [0.283,0,0], pos: [0,0,0] }, legFL: { rot: [4.283,0,0], pos: [0,0,0.626] }, legFR: { rot: [-1.228,0,0], pos: [0,0,0.179] }, legBL: { rot: [-13.887,0,0], pos: [0,0,0.546] }, legBR: { rot: [12.122,0,0], pos: [0,0,0.306] } },
          { body: { rot: [0.865,0.416,1.732], pos: [0,0,0.046] }, head: { rot: [-0.043,0,-1.386], pos: [0,0,0] }, earL: { rot: [-2.445,0,0], pos: [0,0,0] }, earR: { rot: [-2.445,0,0], pos: [0,0,0] }, legFL: { rot: [-16.275,0,0], pos: [0,0,0.354] }, legFR: { rot: [4.917,0,0], pos: [0,0,0.196] }, legBL: { rot: [-9.497,0,0], pos: [0,0,0.476] }, legBR: { rot: [16.559,0,0], pos: [0,0,0.345] } },
          { body: { rot: [-1.129,-0.618,2], pos: [0,0,-0.054] }, head: { rot: [0.056,0,-1.6], pos: [0,0,0] }, earL: { rot: [-2.728,0,0], pos: [0,0,0] }, earR: { rot: [-2.728,0,0], pos: [0,0,0] }, legFL: { rot: [-26.744,0,0], pos: [0,0,-0.231] }, legFR: { rot: [11.12,0,0], pos: [0,0,0.116] }, legBL: { rot: [-5.164,0,0], pos: [0,0,0.494] }, legBR: { rot: [15.565,0,0], pos: [0,0,0.562] } },
          { body: { rot: [-1.994,-1.486,1.732], pos: [0,0,-0.1] }, head: { rot: [0.1,0,-1.386], pos: [0,0,0] }, earL: { rot: [-0.283,0,0], pos: [0,0,0] }, earR: { rot: [-0.283,0,0], pos: [0,0,0] }, legFL: { rot: [-20.051,0,0], pos: [0,0,-0.158] }, legFR: { rot: [17.458,0,0], pos: [0,0,0.106] }, legBL: { rot: [-0.859,0,0], pos: [0,0,0.369] }, legBR: { rot: [2.997,0,0], pos: [0,0,0.449] } },
          { body: { rot: [-0.865,-1.956,1], pos: [0,0,-0.046] }, head: { rot: [0.043,0,-0.8], pos: [0,0,0] }, earL: { rot: [2.445,0,0], pos: [0,0,0] }, earR: { rot: [2.445,0,0], pos: [0,0,0] }, legFL: { rot: [-13.634,0,0], pos: [0,0,0.01] }, legFR: { rot: [24.025,0,0], pos: [0,0,0.202] }, legBL: { rot: [3.44,0,0], pos: [0,0,0.231] }, legBR: { rot: [-11.313,0,0], pos: [0,0,0.979] } },
          { body: { rot: [1.129,-1.902,0], pos: [0,0,0.054] }, head: { rot: [-0.056,0,0], pos: [0,0,0] }, earL: { rot: [2.728,0,0], pos: [0,0,0] }, earR: { rot: [2.728,0,0], pos: [0,0,0] }, legFL: { rot: [-7.387,0,0], pos: [0,0,0.155] }, legFR: { rot: [22.54,0,0], pos: [0,0,0.53] }, legBL: { rot: [7.759,0,0], pos: [0,0,0.292] }, legBR: { rot: [-18.361,0,0], pos: [0,0,0.805] } },
          { body: { rot: [1.994,-1.338,-1], pos: [0,0,0.1] }, head: { rot: [-0.1,0,0.8], pos: [0,0,0] }, earL: { rot: [0.283,0,0], pos: [0,0,0] }, earR: { rot: [0.283,0,0], pos: [0,0,0] }, legFL: { rot: [-1.228,0,0], pos: [0,0,0.179] }, legFR: { rot: [4.283,0,0], pos: [0,0,0.626] }, legBL: { rot: [12.122,0,0], pos: [0,0,0.306] }, legBR: { rot: [-13.887,0,0], pos: [0,0,0.546] } },
          { body: { rot: [0.865,-0.416,-1.732], pos: [0,0,0.046] }, head: { rot: [-0.043,0,1.386], pos: [0,0,0] }, earL: { rot: [-2.445,0,0], pos: [0,0,0] }, earR: { rot: [-2.445,0,0], pos: [0,0,0] }, legFL: { rot: [4.917,0,0], pos: [0,0,0.196] }, legFR: { rot: [-16.275,0,0], pos: [0,0,0.354] }, legBL: { rot: [16.559,0,0], pos: [0,0,0.345] }, legBR: { rot: [-9.497,0,0], pos: [0,0,0.476] } },
          { body: { rot: [-1.129,0.618,-2], pos: [0,0,-0.054] }, head: { rot: [0.056,0,1.6], pos: [0,0,0] }, earL: { rot: [-2.728,0,0], pos: [0,0,0] }, earR: { rot: [-2.728,0,0], pos: [0,0,0] }, legFL: { rot: [11.12,0,0], pos: [0,0,0.116] }, legFR: { rot: [-26.744,0,0], pos: [0,0,-0.231] }, legBL: { rot: [15.565,0,0], pos: [0,0,0.562] }, legBR: { rot: [-5.164,0,0], pos: [0,0,0.494] } },
          { body: { rot: [-1.994,1.486,-1.732], pos: [0,0,-0.1] }, head: { rot: [0.1,0,1.386], pos: [0,0,0] }, earL: { rot: [-0.283,0,0], pos: [0,0,0] }, earR: { rot: [-0.283,0,0], pos: [0,0,0] }, legFL: { rot: [17.458,0,0], pos: [0,0,0.106] }, legFR: { rot: [-20.051,0,0], pos: [0,0,-0.158] }, legBL: { rot: [2.997,0,0], pos: [0,0,0.449] }, legBR: { rot: [-0.859,0,0], pos: [0,0,0.369] } },
          { body: { rot: [-0.865,1.956,-1], pos: [0,0,-0.046] }, head: { rot: [0.043,0,0.8], pos: [0,0,0] }, earL: { rot: [2.445,0,0], pos: [0,0,0] }, earR: { rot: [2.445,0,0], pos: [0,0,0] }, legFL: { rot: [24.025,0,0], pos: [0,0,0.202] }, legFR: { rot: [-13.634,0,0], pos: [0,0,0.01] }, legBL: { rot: [-11.313,0,0], pos: [0,0,0.979] }, legBR: { rot: [3.44,0,0], pos: [0,0,0.231] } }
      ] },
      // GAIT-A END walk
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
          E: 'iron_dark',         // eyes
          S: 'linen_light'        // v1.58: eye catch-light
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
        if (rel > 0.35 && h > 0.9) return 'K';                        // v1.58: darker hair ticks over the back
        return h < 0.1 ? 'L' : 'B';
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
        return hash(x, y, z, SEED + 5) < 0.1 ? 'K' : 'B';             // v1.58: a few darker hairs
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
        if (y === 2 && rel < 0.45) return 'W';                        // v1.58: the roe's pale muzzle band behind the nose
        if (y <= 2) return 'L';                                       // muzzle
        if (y >= 4 && rel > 0.6) return 'K';                          // darker crown
        if (rel < -0.4) return 'L';                                   // cheeks
        return 'B';
      };
    }
    for (i = 0; i < HD.length; i++) g.ellY(i, CX, HD[i][0], HD[i][2], HD[i][1], headMat(HD[i][0], HD[i][1]), 12);
    g.paint(5, 0, 22, 'H'); g.paint(5, 0, 23, 'H'); g.paint(5, 1, 23, 'H');   // black nose (rhinarium)
    g.paint(4, 5, 25, 'H');                                                  // eyes
    g.paint(4, 5, 24, 'W');                                                  // v1.58: pale eye ring (lower lid)
    g.paint(4, 4, 24, 'K');                                                  // v1.58: dark preorbital line in front of the eye
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
    // v1.58 detail: dark pasterns over the hooves, dewclaws behind the fetlocks, dark hock tuft (metatarsal gland),
    // pale back of the hind cannon, darker knee
    g.sym(4, 14, 1, 'K'); g.sym(4, 15, 1, 'H'); g.sym(4, 14, 6, 'K');
    g.sym(4, 26, 1, 'K'); g.sym(4, 27, 1, 'H'); g.paint(4, 27, 7, 'K'); g.paint(4, 26, 4, 'L');

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
  // v1.58 shared: procedural quadruped gait (same maths as the deer's `gait`, any limb table; cfg.rot(t) gives the
  // rotations of the non-limb parts), bird pose / clip helpers
  // =================================================================================================================
  function gaitKeys(LIMBS, cfg) {
    var LN = ['FL', 'FR', 'BL', 'BR'], keys = [], n = cfg.n, ms = cfg.T / n;
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
      o.b = [cfg.pitch * Math.sin(4 * Math.PI * t), 0, cfg.yaw * Math.sin(2 * Math.PI * t), 0, 0, bz];
      o.rot = cfg.rot(t);
      keys.push([ms, o]);
    }
    return keys;
  }

  // Birds: the wings are modelled SPREAD (horizontal, chord along y) so a flap is a clean roll about the body axis
  // (left wing ry + = up, right wing ry - = up). FOLD_L = the folded wing: flat against the body side, tip back, the
  // chord hanging down from the shoulder (left [-90,0,-90], right [-90,0,90]). Legs: `legs` / `legL` / `legR` keys are
  // WORLD pitch (the body pitch is taken out), so the feet stay under the bird when it leans; omitted = vertical.
  var FOLD_L = [-90, 0, -90];
  function birdPose(parts, o) {
    var out = {}, b = o.b || [], brx = b[0] || 0, wl = o.wl || FOLD_L, wr = o.wr || [wl[0], -wl[1], -wl[2]];
    for (var i = 0; i < parts.length; i++) {
      var n = parts[i], r, lg;
      if (n === 'body') { out[n] = { rot: rr([brx, b[1] || 0, b[2] || 0]), pos: rr([b[3] || 0, b[4] || 0, b[5] || 0]) }; continue; }
      if (n === 'wingL') r = wl;
      else if (n === 'wingR') r = wr;
      else if (n === 'legs' || n === 'legL' || n === 'legR') { lg = o[n] || o.legs || [0, 0, 0]; r = [lg[0] - brx, lg[1], lg[2]]; }
      else r = o[n] || [0, 0, 0];
      out[n] = { rot: rr(r), pos: [0, 0, 0] };
    }
    return out;
  }
  function bclip(parts, keys, loop) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(birdPose(parts, keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }
  function legAng(u) { return u < 0.6 ? -22 + 44 * (u / 0.6) : 22 - 44 * ((u - 0.6) / 0.4); }
  // k: pitch (perched body pitch, - = upright), tail, up / down (flap ry of the left wing), glide, hopZ, peck /
  // peckHead (pitch that puts the beak on the ground), beatMs (50 small bird, 100 crow), bound (finch-style bounding
  // flight), crow (adds walk, tilt, caw, talk)
  function birdClips(parts, k) {
    var P0 = { b: [k.pitch, 0, 0, 0, 0, 0], head: [-k.pitch - 6, 0, 0], tail: [k.tail, 0, 0] };
    function P(o) { return M(P0, o); }
    function hd(rx, ry, rz) { return [-k.pitch - 6 + rx, ry, rz]; }
    var U = k.up, D = k.down, T1 = k.beatMs, T2 = 2 * k.beatMs;
    var UPb = k.pitch * 0.6, UP = { b: [UPb, 0, 0, 0, 0, 0], head: [-UPb - 4, 0, 0], tail: [k.tail, 0, 0] };
    var PK = { b: [k.peck, 0, 0, 0, 0, -0.2], head: [k.peckHead, 0, 0], tail: [k.tail - 10, 0, 0] };
    var PK2 = M(PK, { b: [k.peck - 6, 0, 0, 0, 0, -0.1], head: [k.peckHead - 12, 0, 0] });
    var FL = { b: [0, 0, 0, 0, 0, 0], head: [0, 0, 0], tail: [4, 0, 0], legs: [80, 0, 0] };
    function fl(w, z) { return M(FL, { wl: w, b: [0, 0, 0, 0, 0, z || 0] }); }
    var AL = { b: [k.pitch - 8, 0, 0, 0, 0, 0.2], head: [-k.pitch + 4, 0, 0], tail: [k.tail + 8, 0, 0] };
    var c = {
      // perched: quick head turns, tail flicks, a wing flick, a look down, a head tilt, breathing
      perch: bclip(parts, [
        [500, P0],
        [100, P({ head: hd(0, 0, -35) })],
        [500, P({ head: hd(0, 0, -35) })],
        [100, P({ head: hd(0, 0, 28) })],
        [400, P({ head: hd(0, 0, 28) })],
        [100, P({ tail: [k.tail + 22, 0, 0] })],
        [100, P({ tail: [k.tail - 4, 0, 0] })],
        [100, P({ tail: [k.tail + 18, 0, 0] })],
        [100, P0],
        [100, P({ wl: [-90, 0, -76] })],
        [100, P0],
        [300, P({ head: hd(12, 0, 0) })],
        [200, P({ head: hd(6, 14, 0) })],
        [300, P({ b: [k.pitch, 0, 0, 0, 0, 0.2] })],
        [500, P0]
      ], true),
      // two-footed hop on the ground (feet together), wings flick open a little in the air
      hop: bclip(parts, [
        [50, P({ b: [k.pitch * 0.4, 0, 0, 0, 0, -0.6], head: hd(4, 0, 0), tail: [k.tail + 8, 0, 0] })],
        [50, P({ b: [k.pitch * 0.9, 0, 0, 0, 0, 0.4], legs: [30, 0, 0], wl: [-82, 0, -82] })],
        [50, P({ b: [k.pitch * 0.6, 0, 0, 0, 0, k.hopZ], legs: [40, 0, 0], wl: [-72, 0, -76] })],
        [50, P({ b: [k.pitch * 0.5, 0, 0, 0, 0, k.hopZ * 1.1], legs: [10, 0, 0] })],
        [50, P({ b: [k.pitch * 0.3, 0, 0, 0, 0, k.hopZ * 0.5], legs: [-15, 0, 0] })],
        [50, P({ b: [k.pitch * 0.2, 0, 0, 0, 0, 0], tail: [k.tail + 16, 0, 0] })],
        [50, P({ b: [k.pitch * 0.4, 0, 0, 0, 0, -0.4], tail: [k.tail + 10, 0, 0] })]
      ], true),
      // pecking on the ground: beak to the grass twice, look around, twice again
      peck: bclip(parts, [
        [200, UP], [100, PK], [100, PK2], [100, PK],
        [300, M(UP, { head: [-UPb - 4, 0, -22] })],
        [200, M(UP, { head: [-UPb - 4, 0, 16] })],
        [100, PK], [100, PK2],
        [400, UP]
      ], true),
      // play once: crouch, leap with wings up, first beats, legs tucked back
      takeoff: bclip(parts, [
        [T1, { b: [k.pitch * 0.3, 0, 0, 0, 0, -0.8], head: [4, 0, 0], tail: [k.tail + 6, 0, 0], wl: [-50, 0, -50] }],
        [T1, { b: [-30, 0, 0, 0, 0, 0.4], head: [22, 0, 0], tail: [-10, 0, 0], legs: [40, 0, 0], wl: [0, U, -10] }],
        [T1, { b: [-24, 0, 0, 0, 0, 1.0], head: [18, 0, 0], tail: [-6, 0, 0], legs: [60, 0, 0], wl: [0, D, 0] }],
        [T1, { b: [-16, 0, 0, 0, 0, 1.2], head: [12, 0, 0], legs: [75, 0, 0], wl: [0, U, -10] }],
        [T1, { b: [-10, 0, 0, 0, 0, 1.0], head: [8, 0, 0], legs: [80, 0, 0], wl: [0, D, 0] }],
        [T1, { b: [-6, 0, 0, 0, 0, 0.5], head: [5, 0, 0], legs: [80, 0, 0], wl: [0, U * 0.7, -6] }]
      ], false),
      // climbing / level flight; small birds: 3 beats then a closed-wing bound (the dipping finch flight)
      flap: bclip(parts, k.bound ?
        [[50, fl([0, U, -12], 0.2)], [50, fl([0, D, 0], -0.2)], [50, fl([0, U, -12], 0.3)], [50, fl([0, D, 0], 0)],
         [50, fl([0, U, -12], 0.4)], [50, fl([0, D, 0], 0.2)], [200, fl(FOLD_L, -0.4)]] :
        [[100, fl([0, U, -10], -0.3)], [50, fl([0, 10, -5], 0)], [100, fl([0, D, 0], 0.4)], [50, fl([0, 5, -5], 0.1)]], true),
      // level / descending: wings spread with a slight dihedral, small corrections
      glide: bclip(parts, [[500, fl([0, k.glide, 0], 0)], [500, fl([0, k.glide - 4, 3], -0.2)]], true),
      // play once (the last 1.5 m): flare upright, legs forward, braking beats, touch down, fold
      land: bclip(parts, [
        [T2, { b: [-35, 0, 0, 0, 0, 1.5], head: [30, 0, 0], tail: [25, 0, 0], legs: [-30, 0, 0], wl: [0, U * 0.8, -10] }],
        [T1, { b: [-40, 0, 0, 0, 0, 1.0], head: [32, 0, 0], tail: [30, 0, 0], legs: [-25, 0, 0], wl: [0, -20, -20] }],
        [T1, { b: [-30, 0, 0, 0, 0, 0.3], head: [26, 0, 0], tail: [25, 0, 0], legs: [-10, 0, 0], wl: [0, U * 0.6, -30] }],
        [T2, { b: [k.pitch * 0.6, 0, 0, 0, 0, -0.5], head: [-k.pitch * 0.6 - 2, 0, 0], tail: [k.tail + 10, 0, 0], wl: [-60, 0, -60] }],
        [T2, P0]
      ], false),
      // sleek and upright, quick head turns, alarm tail flicks
      alert: bclip(parts, [
        [400, AL],
        [100, M(AL, { head: [-k.pitch + 4, 0, -30] })],
        [400, M(AL, { head: [-k.pitch + 4, 0, -30] })],
        [100, M(AL, { head: [-k.pitch + 4, 0, 25] })],
        [300, M(AL, { head: [-k.pitch + 4, 0, 25] })],
        [100, M(AL, { tail: [k.tail + 30, 0, 0] })],
        [100, AL],
        [100, M(AL, { tail: [k.tail + 28, 0, 0] })],
        [100, AL],
        [300, AL]
      ], true)
    };
    if (k.crow) {
      // walk: alternate legs (crows walk, they do not hop), head bob, a slight waddle
      var wk = [];
      for (var i = 0; i < 8; i++) {
        var t = i / 8;
        wk.push([50, P({ b: [k.pitch, 2 * Math.sin(2 * Math.PI * t), 3 * Math.sin(2 * Math.PI * t), 0, 0, -0.15 * Math.abs(Math.sin(2 * Math.PI * t))],
                         head: hd(6 * Math.sin(4 * Math.PI * t), 0, -2 * Math.sin(2 * Math.PI * t)),
                         legL: [legAng(t), 0, 0], legR: [legAng((t + 0.5) % 1), 0, 0] })]);
      }
      c.walk = bclip(parts, wk, true);
      // Rook: the curious head tilt (one eye on you, then the other)
      c.tilt = bclip(parts, [
        [500, P0],
        [200, P({ head: hd(-4, 26, 10) })],
        [900, P({ head: hd(-4, 26, 10) })],
        [150, P({ head: hd(0, -4, 0) })],
        [150, P({ head: hd(-4, -28, -10) })],
        [800, P({ head: hd(-4, -28, -10) })],
        [300, P0]
      ], true);
      // caw: lean back to breathe in, bow forward with the beak wide open, wings half out, tail pumps down (x2)
      var IN = P({ b: [k.pitch - 6, 0, 0, 0, 0, -0.2], head: hd(-14, 0, 0), tail: [k.tail + 6, 0, 0] });
      var CAW = P({ b: [k.pitch + 14, 0, 0, 0, 0, -0.5], head: hd(14, 0, 0), jaw: [30, 0, 0], tail: [k.tail - 12, 0, 0], wl: [-84, 0, -72] });
      c.caw = bclip(parts, [
        [200, P0], [100, IN], [100, CAW], [150, CAW], [100, M(CAW, { jaw: [6, 0, 0] })],
        [100, IN], [100, CAW], [150, CAW], [200, P0]
      ], true);
      // talk (Rook's dialogue loop): beak flaps of different sizes, small head bobs and tilts
      c.talk = bclip(parts, [
        [100, P({ head: hd(0, 6, 0), jaw: [14, 0, 0] })],
        [100, P({ head: hd(2, 6, 0), jaw: [3, 0, 0] })],
        [150, P({ head: hd(-2, 10, 4), jaw: [18, 0, 0] })],
        [100, P({ head: hd(0, 10, 4), jaw: [5, 0, 0] })],
        [100, P({ head: hd(2, 4, -2), jaw: [12, 0, 0] })],
        [150, P({ head: hd(0, -6, -4), jaw: [0, 0, 0] })],
        [100, P({ head: hd(-2, -8, -4), jaw: [16, 0, 0] })],
        [200, P({ head: hd(0, 0, 0), jaw: [0, 0, 0] })]
      ], true);
    }
    return c;
  }
  // bird voxels: neck + body ellipse slices ([y, cz, rz, rx]), an ellipsoid head ([cy, cz, rx, ry, rz]), the spread
  // wings from a per-column profile, then S.extra(g) adds beak, eyes, tail and legs. Roles -> mats per species.
  function buildBirdLayers(S) {
    var g = Grid(S.SX, S.SY, S.SZ), CX = S.SX / 2, q, d, j;
    function slices(list, zMin, seed) {
      for (q = 0; q < list.length; q++) (function (sl) {
        g.ellY(sl[0], CX, sl[1], sl[3], sl[2], function (x, y, z) { return S.bodyRole((z + 0.5 - sl[1]) / sl[2], y, hash(x, y, z, seed)); }, zMin);
      })(list[q]);
    }
    slices(S.neck, S.neckZMin, S.seed + 1);
    slices(S.body, S.bodyZMin, S.seed);
    var H = S.head;
    g.ell3(CX, H[0], H[1], H[2], H[3], H[4], 0, S.SX - 1, S.headZMin, function (x, y, z) {
      return S.headRole((y + 0.5 - H[0]) / H[3], (z + 0.5 - H[1]) / H[4], hash(x, y, z, S.seed + 2));
    });
    for (d = 0; d < S.wingLen; d++) {
      var ys = S.wingProf(d), wx = S.wingRootX - d;
      for (j = 0; j < ys.length; j++) g.sym(wx, ys[j], S.wingZ, S.wingRole(d, ys[j] - ys[0], hash(wx, ys[j], S.wingZ, S.seed + 3)));
    }
    S.extra(g);
    return g.layers();
  }
  function range(a, b) { var o = []; for (var v = a; v <= b; v++) o.push(v); return o; }

  // =================================================================================================================
  // FOX (red fox, v1.58): cellM 0.025, grid 10 x 44 x 21, anchor [5, 18.25, 0] (between the four paws).
  //   1.1 m nose to tail tip (body 0.67 m + tail 0.43 m), 0.40 m at the shoulder, ear tips 0.50 m. Deep narrow chest,
  //   tucked waist, rounded haunch; long slim muzzle with a black nose, dark tear line, white lips / cheeks / throat /
  //   chest bib; big upright triangular ears (white inner fur, BLACK backs and tips); black stockings to the elbow and
  //   hock; bushy tail hanging low (dark guard hairs on top, paler underside, WHITE tip). Coat: orange-red with ticked
  //   darker saddle, pale lower flanks, grey-cream belly. Eyes: dark with a catch-light.
  //   Parts (8): body [1,11,9, 9,27,17] pivot [5,19,12.5]; head (neck + head) [1,0,10, 9,11,17] pivot [5,11,12.5];
  //              ears [1,4,17, 9,8,21] pivot [5,5.5,17] (both: rx perk / pin, ry flick, rz swivel);
  //              tail [1,27,2, 9,44,17] pivot [5,27,12.6]; legFL/FR [1|5,9,0, 5|9,16,9] pivot [3.5|6.5,12.5,10];
  //              legBL/BR [1|5,20,0, 5|9,28,9] pivot [3.5|6.5,24,10].
  //   Clips: idle 4.4 s, sniff 3.2 s (nose on the ground, sweeps, a forefoot step), walk 0.6 s (4-beat, 0.67 m/s),
  //          trot 0.4 s (diagonal, 1.9 m/s), run 0.4 s (rotary gallop, flee, ~8 m/s, ears flat, tail streaming),
  //          alert 3.0 s (head high, ears forward, one forepaw raised, a head tilt), pounce once 2.3 s (the mousing
  //          jump: crouch, aim, spring, arc, nose-first dive, forepaws land, nose in the grass, stand).
  // =================================================================================================================
  (function () {
    var SX = 10, SY = 44, SZ = 21, CX = 5, SEED = 41;
    var g = Grid(SX, SY, SZ), i, y, z;

    // ---- trunk (body): y 11..26, shoulder 0.40 m, tucked waist, chest / belly >= z 9 ----
    var TR = [
      [12.5, 3.0, 2.2], [12.3, 3.4, 2.5], [12.2, 3.6, 2.7], [12.1, 3.7, 2.8], [12.1, 3.6, 2.8], [12.2, 3.4, 2.7],
      [12.4, 3.1, 2.6], [12.5, 2.9, 2.5], [12.6, 2.8, 2.5], [12.6, 2.8, 2.5], [12.6, 2.9, 2.6], [12.6, 3.0, 2.7],
      [12.5, 3.1, 2.8], [12.4, 3.1, 2.8], [12.3, 2.9, 2.6], [12.3, 2.5, 2.3]
    ];
    function trunkMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, ax = Math.abs(x + 0.5 - CX), h = hash(x, y, z, SEED);
        if (rel < -0.6 && y <= 15) return h < 0.85 ? 'W' : 'g';          // white chest bib
        if (rel < -0.72) return h < 0.4 ? 'W' : 'g';                       // pale grey-cream belly
        if (rel < -0.3) return h < 0.35 ? 'F' : 'L';                       // lighter lower flank
        if (rel > 0.62) return ax <= 1 ? (h < 0.55 ? 'D' : 'F') : (h < 0.22 ? 'D' : 'F');   // ticked darker saddle
        return h < 0.12 ? 'L' : (h > 0.92 ? 'D' : 'F');
      };
    }
    for (i = 0; i < TR.length; i++) g.ellY(11 + i, CX, TR[i][0], TR[i][2], TR[i][1], trunkMat(TR[i][0], TR[i][1]), 9);
    for (y = 12; y <= 14; y++) g.sym(2, y, 9, 'F');                                        // shoulder over the forearm
    for (y = 22; y <= 25; y++) { g.sym(2, y, 9, 'F'); g.sym(3, y, 9, 'F'); g.sym(2, y, 10, y === 22 ? 'L' : 'F'); }   // haunch

    // ---- neck (head part): y 10..7, rising forward, white throat ----
    var NK = [[13.2, 2.6, 2.0], [13.6, 2.4, 1.9], [13.9, 2.3, 1.9], [14.0, 2.3, 2.0]];
    function neckMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, h = hash(x, y, z, SEED + 1);
        if (rel < -0.3) return 'W';
        if (rel > 0.6) return h < 0.35 ? 'D' : 'F';
        return h < 0.2 ? 'L' : 'F';
      };
    }
    for (i = 0; i < NK.length; i++) g.ellY(10 - i, CX, NK[i][0], NK[i][2], NK[i][1], neckMat(NK[i][0], NK[i][1]), 10);
    // ---- head: y 0..6, long slim muzzle (y 0..3) in front of a broad skull with white cheeks ----
    var HD = [[12.7, 0.8, 0.8], [12.8, 1.0, 1.0], [13.0, 1.2, 1.2], [13.4, 1.6, 1.5], [14.0, 2.1, 2.2], [14.2, 2.3, 2.5], [14.2, 2.4, 2.4]];
    function headMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, h = hash(x, y, z, SEED + 2);
        if (y <= 3) return rel < -0.1 ? 'W' : (rel > 0.4 ? 'F' : 'L');   // muzzle: white lips and chin, orange bridge
        if (rel < -0.25) return 'W';                                      // white cheeks and throat
        if (rel > 0.55) return h < 0.3 ? 'D' : 'F';                       // crown
        return h < 0.25 ? 'L' : 'F';
      };
    }
    for (i = 0; i < HD.length; i++) g.ellY(i, CX, HD[i][0], HD[i][2], HD[i][1], headMat(HD[i][0], HD[i][1]), 10);
    g.paint(4, 0, 12, 'N'); g.paint(4, 1, 13, 'N');                    // black nose
    g.paint(4, 3, 13, 'K');                                            // dark tear line down the muzzle side
    g.paint(3, 4, 14, 'E'); g.paint(3, 4, 15, 'S');                    // eye + catch-light
    // ---- ears: roots on the skull (head part), then 3 cells up (ears part); white inner fur, black backs and tips ----
    g.sym(3, 5, 16, 'W'); g.sym(4, 5, 16, 'F'); g.sym(3, 6, 16, 'K');
    g.sym(2, 5, 17, 'F'); g.sym(3, 5, 17, 'W'); g.sym(2, 6, 17, 'K'); g.sym(3, 6, 17, 'K');
    g.sym(3, 5, 18, 'W'); g.sym(3, 6, 18, 'K');
    g.sym(3, 5, 19, 'K');

    // ---- tail (tail part): y 27..43, hangs from the rump to 15 cm over the ground, bushy, white tip ----
    var TL = [1.4, 1.6, 1.8, 2.0, 2.2, 2.3, 2.4, 2.4, 2.4, 2.4, 2.4, 2.3, 2.1, 1.9, 1.7, 1.4, 1.0];
    function tailMat(cz, r, yy) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / r, h = hash(x, y, z, SEED + 3);
        if (yy >= 41 || (yy === 40 && h < 0.6)) return 'W';
        if (yy >= 38 && rel > 0.3 && h < 0.5) return 'K';
        if (rel > 0.4) return h < 0.4 ? 'D' : (h < 0.5 ? 'K' : 'F');
        if (rel < -0.45) return h < 0.5 ? 'L' : 'g';
        return h < 0.15 ? 'D' : (h > 0.85 ? 'L' : 'F');
      };
    }
    for (i = 0; i < TL.length; i++) {
      var tcz = 12.6 - i * 0.42;
      g.ellY(27 + i, CX, tcz, TL[i] * 0.95, TL[i], tailMat(tcz, TL[i], 27 + i), 0);
    }

    // ---- legs: black stockings; forelegs (x 3, mirrored x 6) paw, cannon, forearm ----
    g.sym(3, 11, 0, 'K'); g.sym(3, 12, 0, 'K');
    for (z = 1; z <= 6; z++) g.sym(3, 12, z, z === 3 ? 'k' : 'K');
    g.sym(3, 13, 6, 'D');
    g.sym(2, 12, 7, 'F'); g.sym(3, 12, 7, 'K'); g.sym(2, 13, 7, 'F'); g.sym(3, 13, 7, 'F');
    g.sym(2, 12, 8, 'F'); g.sym(3, 12, 8, 'F'); g.sym(2, 13, 8, 'F'); g.sym(3, 13, 8, 'L');
    // hind: paw, slanted metatarsus, hock pointing back, gaskin, thigh
    g.sym(3, 24, 0, 'K'); g.sym(3, 25, 0, 'K');
    g.sym(3, 25, 1, 'K'); g.sym(3, 25, 2, 'K'); g.sym(3, 26, 2, 'k'); g.sym(3, 26, 3, 'K'); g.sym(3, 25, 3, 'k');
    g.sym(3, 25, 4, 'F'); g.sym(3, 26, 4, 'D'); g.sym(3, 25, 5, 'F'); g.sym(3, 26, 5, 'F');
    for (y = 24; y <= 25; y++) { g.sym(2, y, 6, 'F'); g.sym(3, y, 6, 'F'); }
    for (y = 23; y <= 25; y++) { g.sym(2, y, 7, 'F'); g.sym(3, y, 7, y === 23 ? 'L' : 'F'); g.sym(2, y, 8, 'F'); g.sym(3, y, 8, 'F'); }

    var PARTS = {
      body:  { box: [1, 11, 9, 9, 27, 17], pivot: [5, 19, 12.5] },
      head:  { box: [1, 0, 10, 9, 11, 17], pivot: [5, 11, 12.5], parent: 'body' },
      ears:  { box: [1, 4, 17, 9, 8, 21], pivot: [5, 5.5, 17], parent: 'head' },
      tail:  { box: [1, 27, 2, 9, 44, 17], pivot: [5, 27, 12.6], parent: 'body' },
      legFL: { box: [1, 9, 5, 5, 16, 9], pivot: [3.5, 12.5, 10], parent: 'body' },
      legFR: { box: [5, 9, 5, 9, 16, 9], pivot: [6.5, 12.5, 10], parent: 'body' },
      legBL: { box: [1, 20, 5, 5, 28, 9], pivot: [3.5, 24, 10], parent: 'body' },
      legBR: { box: [5, 20, 5, 9, 28, 9], pivot: [6.5, 24, 10], parent: 'body' },
      // ANIM-B-01b lower leg parts (appended: indices 0-7 unchanged). Split z5 (elbow / hock); hind hock pivot y25.5 = behind the hip-foot line
      legFL2: { box: [1, 9, 0, 5, 16, 5], pivot: [3.5, 12.5, 5], parent: 'legFL' },
      legFR2: { box: [5, 9, 0, 9, 16, 5], pivot: [6.5, 12.5, 5], parent: 'legFR' },
      legBL2: { box: [1, 20, 0, 5, 28, 5], pivot: [3.5, 25.5, 5], parent: 'legBL' },
      legBR2: { box: [5, 20, 0, 9, 28, 5], pivot: [6.5, 25.5, 5], parent: 'legBR' }
    };
    var ORDER = Object.keys(PARTS), PIV = {};
    for (i = 0; i < ORDER.length; i++) PIV[ORDER[i]] = PARTS[ORDER[i]].pivot;
    var LIMBS = {
      FL: { part: 'legFL', foot: [3.5, 12, 0], L: 10, auto: true },
      FR: { part: 'legFR', foot: [6.5, 12, 0], L: 10, auto: true },
      BL: { part: 'legBL', foot: [3.5, 24.5, 0], L: 10, auto: true },
      BR: { part: 'legBR', foot: [6.5, 24.5, 0], L: 10, auto: true }
    };
    var clip = Rig(ORDER, PIV, 'body', LIMBS).clip;
    function R3(h, e, t) { return { head: h, ears: e || [0, 0, 0], tail: t || [0, 0, 0] }; }
    function W(base, over) { var o = M(base, {}), k; for (k in over) o[k] = over[k]; return o; }

    // sniff base: body tipped 8 deg and 2.5 cm lower, nose on the ground (head 58 + body 8), ears forward, tail low
    var SN = { b: [8, 0, 0, 0, 0, -1], rot: R3([58, 0, 0], [10, 0, 0], [-6, 0, 0]), FL: { dy: -1 }, FR: { dy: 0.5 } };
    function sn(h, e, extra) { return W(M(SN, { rot: R3(h, e || [10, 0, 0], [-6, 0, 0]) }), extra || {}); }
    // alert base: head high, ears forward, tail straight out, the left forepaw raised (the frozen fox)
    var AL = { b: [0, 0, 0, 0, 0, 0.3], rot: R3([-14, 0, 0], [12, 0, 0], [12, 0, 0]), FL: { dy: -0.5, lift: 3, rx: -15 } };
    function al(h, e, t) { return M(AL, { rot: R3(h, e, t || [12, 0, 0]) }); }

    var animations = {
      idle: clip([
        [600, {}],
        [500, { b: [0, 0, 0, 0, 0, 0.15], rot: R3([2, 0, 0]) }],
        [400, { rot: R3([-4, 0, -18], [0, 0, -10]) }],
        [600, { rot: R3([-4, 0, -18], [0, 0, -10]) }],
        [100, { rot: R3([-4, 0, -18], [0, 12, -10]) }],
        [100, { rot: R3([-4, 0, -18], [0, -6, -10]) }],
        [400, { rot: R3([-2, 0, 14], [4, 0, 10], [0, 0, 10]) }],
        [500, { rot: R3([-2, 0, 14], [4, 0, 10], [0, 0, -8]) }],
        [300, { rot: R3([0, 0, 10], [2, 0, 6], [0, 0, 6]) }],
        [600, { b: [0, 0, 0, 0, 0, 0.15], rot: R3([2, 0, 0]) }],
        [300, {}]
      ], true),
      sniff: clip([
        [300, SN],
        [200, sn([60, 0, -8])],
        [200, sn([57, 0, -10])],
        [200, sn([60, 0, 4])],
        [200, sn([57, 0, 10])],
        [250, sn([61, 0, 6])],
        [150, sn([58, 0, 6])],
        [300, sn([58, 0, 2], null, { FL: { dy: -2.5, lift: 1.5 } })],
        [200, sn([59, 0, 0], null, { FL: { dy: -2.5 } })],
        [300, sn([50, 0, -4], [14, 0, -8], { FL: { dy: -2.5 } })],
        [400, sn([54, 0, -4], [14, 0, -8], { FL: { dy: -2.5 } })],
        [200, sn([58, 0, 0], null, { FL: { dy: -1.8, lift: 1 } })],
        [300, SN]
      ], true),
      // GAIT-A BEGIN fox.walk (tools/gen-gait.mjs: option A, lateral gait, duty 0.625, tuned 0.45 m/s, 8 keys x 50 ms; re-run, do not hand-edit)
      walk: { durations: [50,50,50,50,50,50,50,50], loop: true, frames: [
          { body: { rot: [0.565,1.427,0], pos: [0,0,0.086] }, head: { rot: [0.395,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, tail: { rot: [8.524,0,5.592], pos: [0,0,0] }, legFL: { rot: [-8.727,0,0], pos: [0,0,2.248] }, legFR: { rot: [-3.439,0,0], pos: [0,0,0.014] }, legBL: { rot: [-16.959,0,0], pos: [0,0,0.065] }, legBR: { rot: [9.422,0,0], pos: [0,0,-0.295] }, legFL2: { rot: [30.344,0,0], pos: [0,0,0] }, legFR2: { rot: [1.72,0,0], pos: [0,0,0] }, legBL2: { rot: [8.479,0,0], pos: [0,0,0] }, legBR2: { rot: [-3.155,0,0], pos: [0,0,0] } },
          { body: { rot: [0.825,0.681,1.061], pos: [0,0,0.135] }, head: { rot: [0.578,0,-0.849], pos: [0,0,0] }, ears: { rot: [-1.248,0,0], pos: [0,0,0] }, tail: { rot: [7.621,0,5.492], pos: [0,0,0] }, legFL: { rot: [-26.121,0,0], pos: [0,0,1.839] }, legFR: { rot: [3.439,0,0], pos: [0,0,0.023] }, legBL: { rot: [-10.203,0,0], pos: [0,0,-0.025] }, legBR: { rot: [17.865,0,0], pos: [0,0,-0.753] }, legFL2: { rot: [39.041,0,0], pos: [0,0,0] }, legFR2: { rot: [-1.72,0,0], pos: [0,0,0] }, legBL2: { rot: [5.101,0,0], pos: [0,0,0] }, legBR2: { rot: [-8.932,0,0], pos: [0,0,0] } },
          { body: { rot: [-0.565,-0.464,1.5], pos: [0,0,-0.086] }, head: { rot: [-0.395,0,-1.2], pos: [0,0,0] }, ears: { rot: [-2.728,0,0], pos: [0,0,0] }, tail: { rot: [3.476,0,2.174], pos: [0,0,0] }, legFL: { rot: [-17.388,0,0], pos: [0,0,-0.195] }, legFR: { rot: [10.355,0,0], pos: [0,0,0.041] }, legBL: { rot: [-3.422,0,0], pos: [0,0,0.255] }, legBR: { rot: [24.031,0,0], pos: [0,0,1.286] }, legFL2: { rot: [8.694,0,0], pos: [0,0,0] }, legFR2: { rot: [-5.178,0,0], pos: [0,0,0] }, legBL2: { rot: [1.711,0,0], pos: [0,0,0] }, legBR2: { rot: [-33.666,0,0], pos: [0,0,0] } },
          { body: { rot: [-0.825,-1.337,1.061], pos: [0,0,-0.135] }, head: { rot: [-0.578,0,-0.849], pos: [0,0,0] }, ears: { rot: [1.248,0,0], pos: [0,0,0] }, tail: { rot: [4.379,0,-2.417], pos: [0,0,0] }, legFL: { rot: [-10.355,0,0], pos: [0,0,0.003] }, legFR: { rot: [17.388,0,0], pos: [0,0,-0.046] }, legBL: { rot: [3.457,0,0], pos: [0,0,0.187] }, legBR: { rot: [5.582,0,0], pos: [0,0,2.069] }, legFL2: { rot: [5.178,0,0], pos: [0,0,0] }, legFR2: { rot: [-8.694,0,0], pos: [0,0,0] }, legBL2: { rot: [-1.728,0,0], pos: [0,0,0] }, legBR2: { rot: [-24.442,0,0], pos: [0,0,0] } },
          { body: { rot: [0.565,-1.427,0], pos: [0,0,0.086] }, head: { rot: [0.395,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, tail: { rot: [8.524,0,-5.592], pos: [0,0,0] }, legFL: { rot: [-3.439,0,0], pos: [0,0,0.014] }, legFR: { rot: [-8.727,0,0], pos: [0,0,2.248] }, legBL: { rot: [9.422,0,0], pos: [0,0,-0.295] }, legBR: { rot: [-16.959,0,0], pos: [0,0,0.065] }, legFL2: { rot: [1.72,0,0], pos: [0,0,0] }, legFR2: { rot: [30.344,0,0], pos: [0,0,0] }, legBL2: { rot: [-3.155,0,0], pos: [0,0,0] }, legBR2: { rot: [8.479,0,0], pos: [0,0,0] } },
          { body: { rot: [0.825,-0.681,-1.061], pos: [0,0,0.135] }, head: { rot: [0.578,0,0.849], pos: [0,0,0] }, ears: { rot: [-1.248,0,0], pos: [0,0,0] }, tail: { rot: [7.621,0,-5.492], pos: [0,0,0] }, legFL: { rot: [3.439,0,0], pos: [0,0,0.023] }, legFR: { rot: [-26.121,0,0], pos: [0,0,1.839] }, legBL: { rot: [17.865,0,0], pos: [0,0,-0.753] }, legBR: { rot: [-10.203,0,0], pos: [0,0,-0.025] }, legFL2: { rot: [-1.72,0,0], pos: [0,0,0] }, legFR2: { rot: [39.041,0,0], pos: [0,0,0] }, legBL2: { rot: [-8.932,0,0], pos: [0,0,0] }, legBR2: { rot: [5.101,0,0], pos: [0,0,0] } },
          { body: { rot: [-0.565,0.464,-1.5], pos: [0,0,-0.086] }, head: { rot: [-0.395,0,1.2], pos: [0,0,0] }, ears: { rot: [-2.728,0,0], pos: [0,0,0] }, tail: { rot: [3.476,0,-2.174], pos: [0,0,0] }, legFL: { rot: [10.355,0,0], pos: [0,0,0.041] }, legFR: { rot: [-17.388,0,0], pos: [0,0,-0.195] }, legBL: { rot: [24.031,0,0], pos: [0,0,1.286] }, legBR: { rot: [-3.422,0,0], pos: [0,0,0.255] }, legFL2: { rot: [-5.178,0,0], pos: [0,0,0] }, legFR2: { rot: [8.694,0,0], pos: [0,0,0] }, legBL2: { rot: [-33.666,0,0], pos: [0,0,0] }, legBR2: { rot: [1.711,0,0], pos: [0,0,0] } },
          { body: { rot: [-0.825,1.337,-1.061], pos: [0,0,-0.135] }, head: { rot: [-0.578,0,0.849], pos: [0,0,0] }, ears: { rot: [1.248,0,0], pos: [0,0,0] }, tail: { rot: [4.379,0,2.417], pos: [0,0,0] }, legFL: { rot: [17.388,0,0], pos: [0,0,-0.046] }, legFR: { rot: [-10.355,0,0], pos: [0,0,0.003] }, legBL: { rot: [5.582,0,0], pos: [0,0,2.069] }, legBR: { rot: [3.457,0,0], pos: [0,0,0.187] }, legFL2: { rot: [-8.694,0,0], pos: [0,0,0] }, legFR2: { rot: [5.178,0,0], pos: [0,0,0] }, legBL2: { rot: [-24.442,0,0], pos: [0,0,0] }, legBR2: { rot: [-1.728,0,0], pos: [0,0,0] } }
      ] },
      // GAIT-A END fox.walk
      // GAIT-A BEGIN fox.trot (tools/gen-gait.mjs: option A, diagonal gait, duty 0.5, tuned 1 m/s, 6 keys x 50 ms; re-run, do not hand-edit)
      trot: { durations: [50,50,50,50,50,50], loop: true, frames: [
          { body: { rot: [0.847,0.951,0], pos: [0,0,0.214] }, head: { rot: [0.028,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, tail: { rot: [17.683,0,3.728], pos: [0,0,0] }, legFL: { rot: [-23.403,0,0], pos: [0,0,-0.523] }, legFR: { rot: [23.403,0,0], pos: [0,0,-0.33] }, legBL: { rot: [24.305,0,0], pos: [0,0,-1.218] }, legBR: { rot: [-22.623,0,0], pos: [0,0,-0.058] }, legFL2: { rot: [11.701,0,0], pos: [0,0,0] }, legFR2: { rot: [-11.701,0,0], pos: [0,0,0] }, legBL2: { rot: [-12.152,0,0], pos: [0,0,0] }, legBR2: { rot: [11.311,0,0], pos: [0,0,0] } },
          { body: { rot: [0.649,0.208,0.866], pos: [0,0,0.185] }, head: { rot: [0.022,0,-0.693], pos: [0,0,0] }, ears: { rot: [-2.445,0,0], pos: [0,0,0] }, tail: { rot: [16.094,0,3.119], pos: [0,0,0] }, legFL: { rot: [-7.657,0,0], pos: [0,0,-0.135] }, legFR: { rot: [-8.605,0,0], pos: [0,0,3.018] }, legBL: { rot: [30.77,0,0], pos: [0,0,1.28] }, legBR: { rot: [-7.573,0,0], pos: [0,0,-0.072] }, legFL2: { rot: [3.828,0,0], pos: [0,0,0] }, legFR2: { rot: [34.613,0,0], pos: [0,0,0] }, legBL2: { rot: [-41.366,0,0], pos: [0,0,0] }, legBR2: { rot: [3.786,0,0], pos: [0,0,0] } },
          { body: { rot: [-1.496,-0.743,0.866], pos: [0,0,-0.4] }, head: { rot: [-0.05,0,-0.693], pos: [0,0,0] }, ears: { rot: [-0.283,0,0], pos: [0,0,0] }, tail: { rot: [14.223,0,-0.609], pos: [0,0,0] }, legFL: { rot: [7.657,0,0], pos: [0,0,0.276] }, legFR: { rot: [-32.265,0,0], pos: [0,0,2.605] }, legBL: { rot: [5.288,0,0], pos: [0,0,3.218] }, legBR: { rot: [7.744,0,0], pos: [0,0,0.374] }, legFL2: { rot: [-3.828,0,0], pos: [0,0,0] }, legFR2: { rot: [46.443,0,0], pos: [0,0,0] }, legBL2: { rot: [-28.625,0,0], pos: [0,0,0] }, legBR2: { rot: [-3.872,0,0], pos: [0,0,0] } },
          { body: { rot: [0.847,-0.951,0], pos: [0,0,0.214] }, head: { rot: [0.028,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, tail: { rot: [17.683,0,-3.728], pos: [0,0,0] }, legFL: { rot: [23.403,0,0], pos: [0,0,-0.33] }, legFR: { rot: [-23.403,0,0], pos: [0,0,-0.523] }, legBL: { rot: [-22.623,0,0], pos: [0,0,-0.058] }, legBR: { rot: [24.305,0,0], pos: [0,0,-1.218] }, legFL2: { rot: [-11.701,0,0], pos: [0,0,0] }, legFR2: { rot: [11.701,0,0], pos: [0,0,0] }, legBL2: { rot: [11.311,0,0], pos: [0,0,0] }, legBR2: { rot: [-12.152,0,0], pos: [0,0,0] } },
          { body: { rot: [0.649,-0.208,-0.866], pos: [0,0,0.185] }, head: { rot: [0.022,0,0.693], pos: [0,0,0] }, ears: { rot: [-2.445,0,0], pos: [0,0,0] }, tail: { rot: [16.094,0,-3.119], pos: [0,0,0] }, legFL: { rot: [-8.605,0,0], pos: [0,0,3.018] }, legFR: { rot: [-7.657,0,0], pos: [0,0,-0.135] }, legBL: { rot: [-7.573,0,0], pos: [0,0,-0.072] }, legBR: { rot: [30.77,0,0], pos: [0,0,1.28] }, legFL2: { rot: [34.613,0,0], pos: [0,0,0] }, legFR2: { rot: [3.828,0,0], pos: [0,0,0] }, legBL2: { rot: [3.786,0,0], pos: [0,0,0] }, legBR2: { rot: [-41.366,0,0], pos: [0,0,0] } },
          { body: { rot: [-1.496,0.743,-0.866], pos: [0,0,-0.4] }, head: { rot: [-0.05,0,0.693], pos: [0,0,0] }, ears: { rot: [-0.283,0,0], pos: [0,0,0] }, tail: { rot: [14.223,0,0.609], pos: [0,0,0] }, legFL: { rot: [-32.265,0,0], pos: [0,0,2.605] }, legFR: { rot: [7.657,0,0], pos: [0,0,0.276] }, legBL: { rot: [7.744,0,0], pos: [0,0,0.374] }, legBR: { rot: [5.288,0,0], pos: [0,0,3.218] }, legFL2: { rot: [46.443,0,0], pos: [0,0,0] }, legFR2: { rot: [-3.828,0,0], pos: [0,0,0] }, legBL2: { rot: [-3.872,0,0], pos: [0,0,0] }, legBR2: { rot: [-28.625,0,0], pos: [0,0,0] } }
      ] },
      // GAIT-A END fox.trot
      // GAIT-A BEGIN fox.run (tools/gen-gait.mjs: option A, gallop gait, duty 0.35, tuned 1.3 m/s, 8 keys x 50 ms; re-run, do not hand-edit)
      run: { durations: [50,50,50,50,50,50,50,50], loop: true, frames: [
          { body: { rot: [2.259,1.427,0], pos: [0,0,0.429] }, head: { rot: [-1.242,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, tail: { rot: [23.683,0,3.728], pos: [0,0,0] }, legFL: { rot: [-28.697,0,0], pos: [0,0,-0.746] }, legFR: { rot: [-33.235,0,0], pos: [0,0,0.094] }, legBL: { rot: [29.184,0,0], pos: [0,0,-0.716] }, legBR: { rot: [31.979,0,0], pos: [0,0,-1.61] }, legFL2: { rot: [14.349,0,0], pos: [0,0,0] }, legFR2: { rot: [28.236,0,0], pos: [0,0,0] }, legBL2: { rot: [-24.539,0,0], pos: [0,0,0] }, legBR2: { rot: [-19.579,0,0], pos: [0,0,0] } },
          { body: { rot: [3.301,0.681,1.061], pos: [0,0,0.675] }, head: { rot: [-1.816,0,-0.849], pos: [0,0,0] }, ears: { rot: [-1.248,0,0], pos: [0,0,0] }, tail: { rot: [23.081,0,3.661], pos: [0,0,0] }, legFL: { rot: [-7.964,0,0], pos: [0,0,-0.336] }, legFR: { rot: [-24.382,0,0], pos: [0,0,-0.607] }, legBL: { rot: [16.659,0,0], pos: [0,0,0.163] }, legBR: { rot: [27.324,0,0], pos: [0,0,-0.792] }, legFL2: { rot: [3.982,0,0], pos: [0,0,0] }, legFR2: { rot: [12.191,0,0], pos: [0,0,0] }, legBL2: { rot: [-22.894,0,0], pos: [0,0,0] }, legBR2: { rot: [-24.89,0,0], pos: [0,0,0] } },
          { body: { rot: [-2.259,-0.464,1.5], pos: [0,0,-0.429] }, head: { rot: [1.242,0,-1.2], pos: [0,0,0] }, ears: { rot: [-2.728,0,0], pos: [0,0,0] }, tail: { rot: [20.317,0,1.449], pos: [0,0,0] }, legFL: { rot: [11.983,0,0], pos: [0,0,0.198] }, legFR: { rot: [-3.975,0,0], pos: [0,0,0.152] }, legBL: { rot: [-0.437,0,0], pos: [0,0,2.509] }, legBR: { rot: [13.428,0,0], pos: [0,0,2.221] }, legFL2: { rot: [-5.991,0,0], pos: [0,0,0] }, legFR2: { rot: [1.987,0,0], pos: [0,0,0] }, legBL2: { rot: [-13.807,0,0], pos: [0,0,0] }, legBR2: { rot: [-21.605,0,0], pos: [0,0,0] } },
          { body: { rot: [-3.301,-1.337,1.061], pos: [0,0,-0.675] }, head: { rot: [1.816,0,-0.849], pos: [0,0,0] }, ears: { rot: [1.248,0,0], pos: [0,0,0] }, tail: { rot: [20.919,0,-1.611], pos: [0,0,0] }, legFL: { rot: [26.311,0,0], pos: [0,0,0.381] }, legFR: { rot: [16.047,0,0], pos: [0,0,0.242] }, legBL: { rot: [-16.913,0,0], pos: [0,0,2.205] }, legBR: { rot: [-3.938,0,0], pos: [0,0,2.745] }, legFL2: { rot: [-10.142,0,0], pos: [0,0,0] }, legFR2: { rot: [-8.023,0,0], pos: [0,0,0] }, legBL2: { rot: [-0.065,0,0], pos: [0,0,0] }, legBR2: { rot: [-11.313,0,0], pos: [0,0,0] } },
          { body: { rot: [2.259,-1.427,0], pos: [0,0,0.429] }, head: { rot: [-1.242,0,0], pos: [0,0,0] }, ears: { rot: [2.728,0,0], pos: [0,0,0] }, tail: { rot: [23.683,0,-3.728], pos: [0,0,0] }, legFL: { rot: [9.595,0,0], pos: [0,0,1.262] }, legFR: { rot: [23.506,0,0], pos: [0,0,-0.023] }, legBL: { rot: [-27.515,0,0], pos: [0,0,-0.433] }, legBR: { rot: [-19.69,0,0], pos: [0,0,0.446] }, legFL2: { rot: [11.78,0,0], pos: [0,0,0] }, legFR2: { rot: [-5.77,0,0], pos: [0,0,0] }, legBL2: { rot: [13.758,0,0], pos: [0,0,0] }, legBR2: { rot: [2.874,0,0], pos: [0,0,0] } },
          { body: { rot: [3.301,-0.681,-1.061], pos: [0,0,0.675] }, head: { rot: [-1.816,0,0.849], pos: [0,0,0] }, ears: { rot: [-1.248,0,0], pos: [0,0,0] }, tail: { rot: [23.081,0,-3.661], pos: [0,0,0] }, legFL: { rot: [-9.597,0,0], pos: [0,0,1.817] }, legFR: { rot: [5.754,0,0], pos: [0,0,1.28] }, legBL: { rot: [-7.874,0,0], pos: [0,0,-0.843] }, legBR: { rot: [-23.535,0,0], pos: [0,0,-0.758] }, legFL2: { rot: [29.072,0,0], pos: [0,0,0] }, legFR2: { rot: [15.836,0,0], pos: [0,0,0] }, legBL2: { rot: [3.937,0,0], pos: [0,0,0] }, legBR2: { rot: [11.767,0,0], pos: [0,0,0] } },
          { body: { rot: [-2.259,0.464,-1.5], pos: [0,0,-0.429] }, head: { rot: [1.242,0,1.2], pos: [0,0,0] }, ears: { rot: [-2.728,0,0], pos: [0,0,0] }, tail: { rot: [20.317,0,-1.449], pos: [0,0,0] }, legFL: { rot: [-25.558,0,0], pos: [0,0,1.616] }, legFR: { rot: [-13.218,0,0], pos: [0,0,2.208] }, legBL: { rot: [12.174,0,0], pos: [0,0,0.368] }, legBR: { rot: [-3.952,0,0], pos: [0,0,0.792] }, legFL2: { rot: [36.154,0,0], pos: [0,0,0] }, legFR2: { rot: [31.426,0,0], pos: [0,0,0] }, legBL2: { rot: [-6.047,0,0], pos: [0,0,0] }, legBR2: { rot: [1.976,0,0], pos: [0,0,0] } },
          { body: { rot: [-3.301,1.337,-1.061], pos: [0,0,-0.675] }, head: { rot: [1.816,0,0.849], pos: [0,0,0] }, ears: { rot: [1.248,0,0], pos: [0,0,0] }, tail: { rot: [20.919,0,1.611], pos: [0,0,0] }, legFL: { rot: [-33.104,0,0], pos: [0,0,0.445] }, legFR: { rot: [-27.894,0,0], pos: [0,0,1.489] }, legBL: { rot: [31.338,0,0], pos: [0,0,0.061] }, legBR: { rot: [15.576,0,0], pos: [0,0,0.683] }, legFL2: { rot: [30.754,0,0], pos: [0,0,0] }, legFR2: { rot: [36.084,0,0], pos: [0,0,0] }, legBL2: { rot: [-17.477,0,0], pos: [0,0,0] }, legBR2: { rot: [-6.599,0,0], pos: [0,0,0] } }
      ] },
      // GAIT-A END fox.run
      alert: clip([
        [900, AL],
        [300, al([-14, 0, 0], [12, 0, 14])],
        [700, al([-14, 0, 0], [12, 0, 14])],
        [150, al([-14, 10, 6], [12, 0, 0])],
        [600, al([-14, 10, 6], [12, 0, 0])],
        [200, al([-16, 0, 0], [16, 0, 0])],
        [150, AL]
      ], true),
      pounce: clip([
        [300, { b: [4, 0, 0, 0, 0, -1.5], rot: R3([22, 0, 0], [16, 0, 0], [10, 0, 0]), FL: { dy: -1 }, FR: { dy: -1 } }],
        [250, { b: [4, 0, 0, 0, 0, -1.5], rot: R3([24, 0, 0], [18, 0, 0], [10, 0, 10]), FL: { dy: -1 }, FR: { dy: -1 } }],
        [100, { b: [-30, 0, 0, 0, 0, 1], rot: R3([12, 0, 0], [12, 0, 0], [30, 0, 0]),
                FL: { free: [-55, 0, 0] }, FR: { free: [-50, 0, 0] }, BL: { dy: 3, rx: 14 }, BR: { dy: 3, rx: 14 } }],
        [150, { b: [10, 0, 0, 0, 0, 9], rot: R3([25, 0, 0], [18, 0, 0], [35, 0, 0]),
                FL: { free: [-15, 0, 0] }, FR: { free: [-15, 0, 0] }, BL: { free: [40, 0, 0] }, BR: { free: [40, 0, 0] } }],
        [150, { b: [45, 0, 0, 0, 0, 7], rot: R3([20, 0, 0], [16, 0, 0], [20, 0, 0]),
                FL: { free: [-30, 0, 0] }, FR: { free: [-30, 0, 0] }, BL: { free: [30, 0, 0] }, BR: { free: [30, 0, 0] } }],
        [150, { b: [30, 0, 0, 0, 0, 1.5], rot: R3([35, 0, 0], [10, 0, 0], [30, 0, 0]),
                FL: { dy: -3, rx: -15 }, FR: { dy: -2.5, rx: -14 }, BL: { free: [20, 0, 0] }, BR: { free: [20, 0, 0] } }],
        [400, { b: [18, 0, 0, 0, 0, -0.5], rot: R3([44, 0, 0], [10, 0, 0], [15, 0, 0]),
                FL: { dy: -3 }, FR: { dy: -2.5 }, BL: { dy: -2 }, BR: { dy: -2 } }],
        [500, { b: [18, 0, 0, 0, 0, -0.5], rot: R3([44, 0, 6], [10, 0, 0], [15, 0, 12]),
                FL: { dy: -3 }, FR: { dy: -2.5 }, BL: { dy: -2 }, BR: { dy: -2 } }],
        [300, { rot: R3([10, 0, 0]) }]
      ], false)
    };

    A.models.fox = {
      name: 'fox',
      displayName: 'red fox',
      desc: 'v1.58 EP-WILD: red fox, 1.1 m nose to tail tip, 0.40 m at the shoulder: orange-red coat with a ticked ' +
            'darker saddle, white lips / cheeks / throat / chest, black nose, tear lines, ear backs and stockings, big ' +
            'upright ears, bushy low tail with a white tip. 8 parts: idle, sniff, walk, trot, run, alert, pounce.',
      voxel: {
        version: 1,
        meshOnly: true,
        cellM: 0.025,
        size: [SX, SY, SZ],
        anchor: [5, 18.25, 0],
        light: false,
        mats: {
          F: 'fur_fox',            // back, flanks, head, upper legs, tail
          L: 'fur_fox_light',      // lower flanks, muzzle sides, tail underside
          D: 'hair_auburn',        // darker saddle ticks, crown, nape, tail guard hairs
          W: 'fur_cream',          // lips, cheeks, throat, chest bib, inner ears, tail tip
          g: 'hair_grey_light',    // grey-cream belly, tail underside
          K: 'hair_black',         // ear backs and tips, stockings, tear line
          k: 'hair_black_light',   // stocking variation
          N: 'iron_dark',          // nose
          E: 'iron_dark',          // eyes
          S: 'linen_light'         // eye catch-light
        },
        layers: g.layers(),
        parts: PARTS,
        // ANIM-B-01b (note 38.67 item 2): walk / trot / run are generated by tools/gen-gait.mjs (fox.walk/trot/run in tools/gait-configs.mjs); keep these numbers = that config
        legRig: {
          body: 'body',
          legs: [
            { upper: 'legFL', lower: 'legFL2', foot: [3.5, 12.5, 0], bend: 'front' },
            { upper: 'legFR', lower: 'legFR2', foot: [6.5, 12.5, 0], bend: 'front' },
            { upper: 'legBL', lower: 'legBL2', foot: [3.5, 24.5, 0], bend: 'back' },
            { upper: 'legBR', lower: 'legBR2', foot: [6.5, 24.5, 0], bend: 'back' }
          ],
          gaits: {
            walk: { tunedMps: 0.45, duty: 0.625, phase: [0.25, 0.75, 0, 0.5], liftM: 0.0625 },
            trot: { tunedMps: 1, duty: 0.5, phase: [0, 0.5, 0.5, 0], liftM: 0.0875 },
            run: { tunedMps: 1.3, duty: 0.35, phase: [0, 0.1, 0.5, 0.6], liftM: 0.05 }
          },
          stand: ['idle', 'alert']
        },
        animations: animations,
        mounts: {
          eyes:    { at: [5, 4, 14.5], part: 'head' },
          nose:    { at: [5, 0, 12.5], part: 'head' },
          tailTip: { at: [5, 42, 6.5], part: 'tail' },
          center:  { at: [5, 19, 12.5], part: 'body' }
        }
      }
    };
  })();

  // =================================================================================================================
  // SQUIRREL (red squirrel, v1.58): cellM 0.015, grid 8 x 24 x 20, anchor [4, 9, 0].
  //   0.34 m nose to tail (body 0.20 m), crouched back 0.12 m, tail curled up over the back to 0.28 m, ear tufts
  //   0.19 m. Rusty-red coat with dark and grey-brown hairs, cream belly / chin / throat, big dark eyes with a pale
  //   ring and a catch-light, ears with dark TUFTS, long flat hind feet, short forelegs, very bushy S-curved tail with a
  //   frosted pale fringe.
  //   Parts (8): body [1,5,3, 7,16,11] pivot [4,12,5] (hips); head [0,0,4, 8,5,9] pivot [4,5,6]; ears [0,2,9, 8,6,13]
  //              pivot [4,3.5,9]; tail [1,13,3, 7,24,20] pivot [4,15.5,4.5]; legFL/FR [0|5,4,0, 3|8,9,3] pivot
  //              [2.5|5.5,6.5,4]; legBL/BR [0|5,9,0, 3|8,15,3] pivot [2|6,12,4.5].
  //   Clips: idle 3.6 s (jerky looks, tail flicks), forage 2.8 s (nose down, forepaws dig, head up to chew), hop 0.4 s
  //          (bound, 0.36 m/s), run 0.3 s (fast bound, tail streaming), alert 2.8 s (frozen, alarm tail flicks),
  //          climb 0.4 s and peek 3.7 s ON A TRUNK: the body is pitched -90 deg (nose up, belly to the trunk) inside the
  //          clip, paws on the instance's y plane (the trunk surface), body raised 16.5 cm (tail clear of the ground).
  // =================================================================================================================
  (function () {
    var SX = 8, SY = 24, SZ = 20, CX = 4, SEED = 53;
    var g = Grid(SX, SY, SZ), i;

    var TR = [[5.4, 2.0, 1.7], [5.2, 2.3, 1.9], [5.1, 2.4, 2.0], [5.1, 2.4, 2.0], [5.2, 2.5, 2.0], [5.3, 2.6, 2.1],
              [5.4, 2.8, 2.3], [5.4, 2.9, 2.4], [5.3, 2.9, 2.4], [5.1, 2.6, 2.2], [4.9, 2.0, 1.8]];   // y 5..15
    function trunkMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, h = hash(x, y, z, SEED);
        if (rel < -0.55) return 'W';
        if (rel < -0.2) return h < 0.3 ? 'W' : 'O';
        if (rel > 0.5) return h < 0.25 ? 'T' : (h > 0.85 ? 'G' : 'R');
        return h < 0.15 ? 'G' : (h > 0.8 ? 'O' : 'R');
      };
    }
    for (i = 0; i < TR.length; i++) g.ellY(5 + i, CX, TR[i][0], TR[i][2], TR[i][1], trunkMat(TR[i][0], TR[i][1]), 3);
    g.sym(1, 11, 3, 'R'); g.sym(1, 12, 3, 'R'); g.sym(1, 13, 3, 'R'); g.sym(1, 12, 4, 'R'); g.sym(1, 11, 4, 'O');   // haunches

    var HD = [[6.6, 0.8, 0.8], [7.0, 1.3, 1.2], [7.3, 1.7, 1.6], [7.5, 1.9, 1.8], [7.4, 1.8, 1.7]];   // y 0..4
    function headMat(cz, rz) {
      return function (x, y, z) {
        var rel = (z + 0.5 - cz) / rz, h = hash(x, y, z, SEED + 1);
        if (rel < -0.4) return 'W';
        if (y <= 1) return rel > 0.3 ? 'R' : 'O';
        if (rel > 0.5) return h < 0.3 ? 'T' : 'R';
        return h < 0.3 ? 'O' : 'R';
      };
    }
    g.ellY(4, CX, 5.6, 1.4, 1.6, headMat(5.6, 1.6), 4);                                   // neck
    for (i = 0; i < HD.length; i++) g.ellY(i, CX, HD[i][0], HD[i][2], HD[i][1], headMat(HD[i][0], HD[i][1]), 4);
    g.paint(3, 0, 6, 'N');                                                                // nose
    g.paint(2, 3, 7, 'E'); g.paint(2, 3, 8, 'S'); g.paint(2, 2, 7, 'W'); g.paint(2, 4, 7, 'W');   // eye, catch-light, pale ring
    // ears with dark tufts (ears part)
    g.sym(2, 3, 9, 'O'); g.sym(2, 4, 9, 'R'); g.sym(2, 3, 10, 'O'); g.sym(2, 4, 10, 'R');
    g.sym(2, 3, 11, 'T'); g.sym(2, 4, 11, 'T'); g.sym(1, 4, 12, 'T');

    // tail: overlapping round puffs along an S curve, back from the rump then up and over the back
    var TC = [[16, 4.5, 1.2], [17.5, 5.5, 1.6], [19, 7, 2.0], [20, 9, 2.3], [20.3, 11, 2.5], [19.8, 13, 2.6],
              [18.8, 15, 2.5], [17.5, 16.3, 2.3], [16.2, 17, 2.0], [15, 17.2, 1.6]];
    function tailMat(cy, cz, r) {
      return function (x, y, z) {
        var dx = (x + 0.5 - CX) / (r * 0.9), dy = (y + 0.5 - cy) / r, dz = (z + 0.5 - cz) / r;
        var d = Math.sqrt(dx * dx + dy * dy + dz * dz), h = hash(x, y, z, SEED + 2);
        if (d > 0.78) return h < 0.4 ? 'O' : (h < 0.55 ? 'T' : 'R');
        return h < 0.3 ? 'T' : 'R';
      };
    }
    for (i = 0; i < TC.length; i++) g.ell3(CX, TC[i][0], TC[i][1], TC[i][2] * 0.9, TC[i][2], TC[i][2], 0, SX - 1, 0, tailMat(TC[i][0], TC[i][1], TC[i][2]));

    // legs: short forelegs with pale toes; long flat hind feet, heel, thigh
    g.sym(2, 5, 0, 'O'); g.sym(2, 6, 0, 'R'); g.sym(2, 6, 1, 'R'); g.sym(2, 6, 2, 'O'); g.sym(2, 7, 2, 'R');
    g.sym(2, 10, 0, 'O'); g.sym(2, 11, 0, 'R'); g.sym(2, 12, 0, 'R'); g.sym(2, 13, 0, 'T');
    g.sym(2, 12, 1, 'R'); g.sym(2, 13, 1, 'R');
    g.sym(1, 11, 2, 'R'); g.sym(1, 12, 2, 'R'); g.sym(2, 11, 2, 'R'); g.sym(2, 12, 2, 'O');

    var PARTS = {
      body:  { box: [1, 5, 3, 7, 16, 11], pivot: [4, 12, 5] },
      head:  { box: [0, 0, 4, 8, 5, 9], pivot: [4, 5, 6], parent: 'body' },
      ears:  { box: [0, 2, 9, 8, 6, 13], pivot: [4, 3.5, 9], parent: 'head' },
      tail:  { box: [1, 13, 3, 7, 24, 20], pivot: [4, 15.5, 4.5], parent: 'body' },
      legFL: { box: [0, 4, 0, 3, 9, 3], pivot: [2.5, 6.5, 4], parent: 'body' },
      legFR: { box: [5, 4, 0, 8, 9, 3], pivot: [5.5, 6.5, 4], parent: 'body' },
      legBL: { box: [0, 9, 0, 3, 15, 3], pivot: [2, 12, 4.5], parent: 'body' },
      legBR: { box: [5, 9, 0, 8, 15, 3], pivot: [6, 12, 4.5], parent: 'body' }
    };
    var ORDER = Object.keys(PARTS), PIV = {};
    for (i = 0; i < ORDER.length; i++) PIV[ORDER[i]] = PARTS[ORDER[i]].pivot;
    var clip = Rig(ORDER, PIV, 'body', {
      FL: { part: 'legFL', foot: [2.5, 6, 0], L: 4, auto: false },
      FR: { part: 'legFR', foot: [5.5, 6, 0], L: 4, auto: false },
      BL: { part: 'legBL', foot: [2, 11, 0], L: 4.5, auto: false },
      BR: { part: 'legBR', foot: [6, 11, 0], L: 4.5, auto: false }
    }).clip;
    function SR(h, e, t) { return { head: h || [0, 0, 0], ears: e || [0, 0, 0], tail: t || [0, 0, 0] }; }
    function W(base, over) { var o = M(base, {}), k; for (k in over) o[k] = over[k]; return o; }

    var FG = { b: [14, 0, 0, 0, 0, -0.4], rot: SR([38, 0, 0], [6, 0, 0], [-6, 0, 0]) };
    function fg(h, extra) { return W(M(FG, { rot: SR(h, [6, 0, 0], [-6, 0, 0]) }), extra || {}); }
    var CHEW = { b: [4, 0, 0, 0, 0, 0], rot: SR([0, 0, 0], [4, 0, 0], [6, 0, 0]) };
    var AL = { b: [-6, 0, 0, 0, 0, 0.3], rot: SR([-14, 0, 0], [10, 0, 0], [4, 0, 0]) };
    // on the trunk: body pitched -90 (nose up, belly and paws to the trunk), tail laid down along the bark
    var FREE0 = { free: [0, 0, 0] };
    var CL = { b: [-90, 0, 0, 0, 2, 11], rot: SR([-25, 0, 0], [-6, 0, 0], [-70, 0, 0]), FL: FREE0, FR: FREE0, BL: FREE0, BR: FREE0 };
    function cl(over) { return M(CL, over); }

    var animations = {
      idle: clip([
        [500, {}],
        [100, { rot: SR([-6, 0, -22]) }],
        [600, { rot: SR([-6, 0, -22], [0, 0, -8]) }],
        [100, { rot: SR([-6, 0, -22], [0, 0, -8], [10, 0, 0]) }],
        [100, { rot: SR([-6, 0, -22], [0, 0, -8], [-4, 0, 0]) }],
        [100, { rot: SR([-6, 0, -22], [0, 0, -8], [10, 0, 6]) }],
        [100, { rot: SR([-6, 0, -22], [0, 0, -8], [0, 0, 0]) }],
        [100, { rot: SR([-4, 0, 18], [0, 0, 8]) }],
        [700, { rot: SR([-4, 0, 18], [0, 0, 8]) }],
        [100, { rot: SR([5, 0, 4]) }],
        [100, { rot: SR([0, 0, 0]) }],
        [600, { b: [0, 0, 0, 0, 0, 0.15], rot: SR([2, 0, 0], null, [3, 0, 0]) }],
        [400, {}]
      ], true),
      forage: clip([
        [300, FG],
        [150, fg([38, 0, 0], { FL: { dy: -0.8, lift: 1.2 } })],
        [150, fg([38, 0, 0], { FR: { dy: -0.8, lift: 1.2 } })],
        [150, fg([38, 0, 0], { FL: { dy: -0.8, lift: 1.2 } })],
        [150, fg([38, 0, 0], { FR: { dy: 0.4 } })],
        [300, fg([38, 0, -8])],
        [200, fg([40, 0, 6])],
        [150, fg([36, 0, 0])],
        [400, CHEW],
        [100, M(CHEW, { rot: SR([4, 0, 0], [4, 0, 0], [6, 0, 0]) })],
        [100, CHEW],
        [100, M(CHEW, { rot: SR([4, 0, -6], [4, 0, 0], [6, 0, 0]) })],
        [100, M(CHEW, { rot: SR([0, 0, -6], [4, 0, 0], [6, 0, 0]) })],
        [450, FG]
      ], true),
      hop: clip([
        [50, { b: [-3, 0, 0, 0, 0, -0.3], rot: SR([2, 0, 0], [-6, 0, 0], [4, 0, 0]),
               FL: { free: [30, 0, 0], up: 0.6 }, FR: { free: [30, 0, 0], up: 0.6 }, BL: { dy: 0.6, rx: 6 }, BR: { dy: 0.6, rx: 6 } }],
        [50, { b: [-8, 0, 0, 0, 0, 0.2], rot: SR([4, 0, 0], [-8, 0, 0], [0, 0, 0]),
               FL: { free: [-30, 0, 0], up: 0.4 }, FR: { free: [-30, 0, 0], up: 0.4 }, BL: { dy: 1.8, rx: 25 }, BR: { dy: 1.8, rx: 25 } }],
        [50, { b: [-2, 0, 0, 0, 0, 2.2], rot: SR([1, 0, 0], [-12, 0, 0], [-10, 0, 0]),
               FL: { free: [-45, 0, 0] }, FR: { free: [-45, 0, 0] }, BL: { free: [40, 0, 0] }, BR: { free: [40, 0, 0] } }],
        [50, { b: [10, 0, 0, 0, 0, 1.4], rot: SR([-5, 0, 0], [-10, 0, 0], [-14, 0, 0]),
               FL: { free: [-20, 0, 0] }, FR: { free: [-20, 0, 0] }, BL: { free: [10, 0, 0] }, BR: { free: [10, 0, 0] } }],
        [50, { b: [14, 0, 0, 0, 0, 0.4], rot: SR([-8, 0, 0], [-4, 0, 0], [-8, 0, 0]),
               FL: { dy: -1.8, rx: -15 }, FR: { dy: -1.8, rx: -15 }, BL: { free: [-15, 0, 0], up: 0.4 }, BR: { free: [-15, 0, 0], up: 0.4 } }],
        [50, { b: [8, 0, 0, 0, 0, 0], rot: SR([-5, 0, 0], [-4, 0, 0], [0, 0, 0]),
               FL: { dy: -0.6, rx: -5 }, FR: { dy: -0.6, rx: -5 }, BL: { free: [-30, 0, 0], up: 1.2 }, BR: { free: [-30, 0, 0], up: 1.2 } }],
        [50, { b: [2, 0, 0, 0, 0, -0.2], rot: SR([-1, 0, 0], [-6, 0, 0], [6, 0, 0]),
               FL: { dy: 0.6, rx: 8 }, FR: { dy: 0.6, rx: 8 }, BL: { dy: -1.8, rx: -6 }, BR: { dy: -1.8, rx: -6 } }],
        [50, { b: [0, 0, 0, 0, 0, -0.3], rot: SR([0, 0, 0], [-6, 0, 0], [6, 0, 0]),
               FL: { dy: 1.8, rx: 20 }, FR: { dy: 1.8, rx: 20 }, BL: { dy: -0.6 }, BR: { dy: -0.6 } }]
      ], true),
      run: clip([
        [50, { b: [-8, 0, 0, 0, 0, 0.3], rot: SR([6, 0, 0], [-25, 0, 0], [-30, 0, 0]),
               FL: { free: [-55, 0, 0], up: 0.4 }, FR: { free: [-50, 0, 0], up: 0.4 }, BL: { dy: 1.2, rx: 30 }, BR: { dy: 1.2, rx: 30 } }],
        [50, { b: [-2, 0, 0, 0, 0, 2.8], rot: SR([4, 0, 0], [-28, 0, 0], [-36, 0, 0]),
               FL: { free: [-60, 0, 0] }, FR: { free: [-55, 0, 0] }, BL: { free: [55, 0, 0] }, BR: { free: [55, 0, 0] } }],
        [50, { b: [8, 0, 0, 0, 0, 2.4], rot: SR([0, 0, 0], [-26, 0, 0], [-34, 0, 0]),
               FL: { free: [-15, 0, 0] }, FR: { free: [-25, 0, 0] }, BL: { free: [15, 0, 0], up: 0.8 }, BR: { free: [20, 0, 0], up: 0.8 } }],
        [50, { b: [14, 0, 0, 0, 0, 0.5], rot: SR([-6, 0, 0], [-22, 0, 0], [-28, 0, 0]),
               FL: { dy: -2.4, rx: -20 }, FR: { free: [-30, 0, 0], up: 0.8 }, BL: { free: [-20, 0, 0], up: 1.2 }, BR: { free: [-20, 0, 0], up: 1.2 } }],
        [50, { b: [10, 0, 0, 0, 0, 0.2], rot: SR([-4, 0, 0], [-24, 0, 0], [-30, 0, 0]),
               FL: { dy: 0, rx: 5 }, FR: { dy: -1.6, rx: -12 }, BL: { free: [-50, 0, 0], up: 1.6 }, BR: { free: [-50, 0, 0], up: 1.6 } }],
        [50, { b: [0, 0, 0, 0, 0, -0.2], rot: SR([2, 0, 0], [-25, 0, 0], [-32, 0, 0]),
               FL: { free: [35, 0, 0], up: 0.8 }, FR: { dy: 1.6, rx: 25 }, BL: { dy: -2.4, rx: -10 }, BR: { dy: -2, rx: -8 } }]
      ], true),
      alert: clip([
        [700, AL],
        [100, M(AL, { rot: SR([-14, 0, 0], [10, 0, 0], [14, 0, 0]) })],
        [100, M(AL, { rot: SR([-14, 0, 0], [10, 0, 0], [0, 0, 0]) })],
        [100, M(AL, { rot: SR([-14, 0, 0], [10, 0, 0], [14, 0, 6]) })],
        [100, AL],
        [500, M(AL, { rot: SR([-12, 0, 20], [10, 0, 10], [4, 0, 0]) })],
        [600, M(AL, { rot: SR([-12, 0, 20], [10, 0, 10], [4, 0, 0]) })],
        [100, M(AL, { rot: SR([-14, 0, -6], [10, 0, 0], [12, 0, -6]) })],
        [100, AL],
        [400, AL]
      ], true),
      climb: clip([
        [100, cl({ FL: { free: [15, 0, 0] }, FR: { free: [20, 0, 0] }, BL: { free: [-35, 0, 0], up: 0.6 }, BR: { free: [-30, 0, 0], up: 0.6 } })],
        [100, cl({ b: [-92, 0, 0, 0, 2, 12], rot: SR([-30, 0, 0], [-10, 0, 0], [-66, 0, 0]),
                   FL: { free: [-35, 0, 0] }, FR: { free: [-30, 0, 0] }, BL: { free: [20, 0, 0] }, BR: { free: [25, 0, 0] } })],
        [100, cl({ b: [-90, 0, 0, 0, 2, 12.5], FL: { free: [-15, 0, 0] }, FR: { free: [-12, 0, 0] }, BL: { free: [10, 0, 0] }, BR: { free: [12, 0, 0] } })],
        [100, cl({ b: [-88, 0, 0, 0, 2, 11.5], FL: { free: [5, 0, 0] }, FR: { free: [8, 0, 0] }, BL: { free: [-15, 0, 0], up: 0.3 }, BR: { free: [-12, 0, 0], up: 0.3 } })]
      ], true),
      peek: clip([
        [600, CL],
        [300, cl({ b: [-90, 0, 0, -1.5, 2, 11], rot: SR([-20, 0, -40], [4, 0, -10], [-70, 0, 0]) })],
        [800, cl({ b: [-90, 0, 0, -1.5, 2, 11], rot: SR([-20, 0, -40], [4, 0, -10], [-70, 0, 0]) })],
        [100, cl({ b: [-90, 0, 0, -1.5, 2, 11], rot: SR([-18, 0, -34], [4, 0, -10], [-60, 0, 0]) })],
        [300, CL],
        [400, CL],
        [300, cl({ b: [-90, 0, 0, 1.5, 2, 11], rot: SR([-20, 0, 40], [4, 0, 10], [-70, 0, 0]) })],
        [600, cl({ b: [-90, 0, 0, 1.5, 2, 11], rot: SR([-22, 0, 38], [4, 0, 10], [-64, 0, 0]) })],
        [300, CL]
      ], true)
    };

    A.models.squirrel = {
      name: 'squirrel',
      displayName: 'red squirrel',
      desc: 'v1.58 EP-WILD: red squirrel, 0.34 m with the tail: rusty-red coat, cream belly, big dark eyes with a pale ' +
            'ring, tufted ears, long hind feet, bushy S-curved tail over the back. 8 parts: idle, forage, hop, run, alert, ' +
            'climb + peek (body pitched -90 deg on a trunk inside the clip).',
      voxel: {
        version: 1,
        meshOnly: true,
        cellM: 0.015,
        size: [SX, SY, SZ],
        anchor: [4, 9, 0],
        light: false,
        mats: {
          R: 'hair_auburn_light',  // rusty-red coat, tail
          O: 'fur_fox_light',      // bright orange: flanks, muzzle, ear fronts, tail fringe, toes
          T: 'hair_auburn_dark',   // ear tufts, dark hairs on back / tail, heels
          G: 'hair_brown',         // grey-brown hairs on the flanks
          W: 'fur_cream',          // belly, chin, throat, eye ring
          N: 'skin_deep',          // nose
          E: 'iron_dark',          // eyes
          S: 'linen_light'         // eye catch-light
        },
        layers: g.layers(),
        parts: PARTS,
        animations: animations,
        mounts: {
          eyes:   { at: [4, 3, 7.5], part: 'head' },
          nose:   { at: [4, 0, 6.5], part: 'head' },
          tail:   { at: [4, 20, 11], part: 'tail' },
          center: { at: [4, 10, 5], part: 'body' }
        }
      }
    };
  })();

  // =================================================================================================================
  // SONGBIRDS (v1.58): one shape, two coats - `robin` (European robin: orange face and breast, grey border, olive-brown
  //   back, white belly) and `finch` (male chaffinch: blue-grey crown, pink-brick breast, chestnut back, olive rump,
  //   black wings with white bars, white outer tail). cellM 0.01, grid 23 x 16 x 10, anchor [11.5, 6.5, 0] (the feet
  //   = the perch point). 16 cm beak to tail, wingspan 23 cm, 8 cm tall perched. Round body, small round head, dark eye
  //   with a catch-light, thin beak, two thin legs with toes.
  //   Parts (6): body [9,5,2, 14,11,8] pivot [11.5,6.5,3]; head (+ neck) [8,0,3, 15,5,9] pivot [11.5,4.5,5.5];
  //              tail [9,11,3, 14,16,8] pivot [11.5,11,5.5]; wingL [0,4,6, 9,11,7] pivot [8.6,5.5,6.5];
  //              wingR [14,4,6, 23,11,7] pivot [14.4,5.5,6.5]; legs (both, hop together) [9,4,0, 14,9,2] pivot [11.5,6.5,2].
  //   Clips: perch 3.5 s, hop 0.35 s (0.3 m/s), peck 1.6 s, takeoff once 0.3 s, flap 0.5 s (3 beats + a closed-wing
  //          bound), glide 1.0 s, land once 0.4 s, alert 2.0 s.
  // CROW (carrion crow; also ROOK, the talking crow of the quest line): cellM 0.02, grid 39 x 26 x 13, anchor
  //   [19.5, 8.5, 0]. 0.50 m beak to tail, wingspan 0.78 m, 0.24 m tall. All black with a faint sheen (hair_black_light
  //   flecks), stout grey-black beak whose LOWER MANDIBLE is its own part (caw / talk), dark brown eyes with a
  //   catch-light, fingered wing tips, rounded tail, two legs (crows walk).
  //   Parts (8): body [17,6,4, 22,16,11] pivot [19.5,8.5,5]; head [16,0,8, 23,6,13] pivot [19.5,5.5,8.5];
  //              jaw [18,0,6, 21,3,8] pivot [19.5,2.5,8] (rx + = open); tail [17,16,4, 23,26,9] pivot [19.5,16,7.5];
  //              wingL [0,6,9, 17,15,10] pivot [16.6,7.5,9.5]; wingR [22,6,9, 39,15,10] pivot [22.4,7.5,9.5];
  //              legL [17,5,0, 19,11,4] pivot [18.5,8.5,4]; legR [20,5,0, 22,11,4] pivot [20.5,8.5,4].
  //   Clips: the songbird set (slower beats) + walk 0.4 s (0.25 m/s), tilt 3.0 s (Rook's curious head tilt), caw 1.2 s,
  //          talk 1.0 s (beak flaps for dialogue).
  // =================================================================================================================
  (function () {
    var SONG = {
      SX: 23, SY: 16, SZ: 10, seed: 61,
      body: [[5, 4.7, 2.7, 2.6], [6, 4.6, 2.8, 2.7], [7, 4.6, 2.7, 2.6], [8, 4.7, 2.4, 2.3], [9, 4.9, 2.0, 1.9], [10, 5.1, 1.5, 1.4]],
      bodyZMin: 2,
      neck: [[3, 5.0, 1.8, 1.8], [4, 4.8, 2.4, 2.4]], neckZMin: 3,
      head: [2.4, 6.6, 1.6, 1.7, 1.6], headZMin: 0,
      bodyRole: function (rel, y, h) {
        if (rel > 0.55) return y >= 9 ? 'U' : (h < 0.2 ? 'D' : 'O');      // back, rump
        if (y <= 6 && rel < 0.3) return 'R';                              // breast
        if (y === 7 && rel > -0.45 && rel < 0.3) return 'R';
        if (rel < 0.3) return 'W';                                        // belly, undertail
        return y <= 7 ? 'g' : 'O';                                        // grey border of the breast / flank
      },
      headRole: function (ry, rz, h) {
        if (rz > 0.5) return ry > 0.3 ? 'O' : 'C';                        // crown / nape
        if (ry < 0.25 || rz < -0.2) return 'R';                           // face, throat
        return ry > 0.5 ? 'O' : 'g';
      },
      wingLen: 9, wingRootX: 8, wingZ: 6,
      wingProf: function (d) { return [range(5, 8), range(5, 9), range(5, 9), range(5, 9), range(6, 9), range(6, 10), range(7, 10), range(8, 10), range(9, 10)][d]; },
      wingRole: function (d, r, h) { if (r === 0) return 'O'; if (r === 1 && d <= 5) return 'V'; return h < 0.15 ? 'O' : 'D'; },
      extra: function (g) {
        var y;
        for (y = 11; y <= 15; y++) g.put(11, y, 5, 'D');                  // tail: dark centre feathers
        for (y = 12; y <= 15; y++) g.sym(10, y, 5, 'T');                  // outer tail feathers
        g.put(11, 0, 6, 'B');                                             // thin beak
        g.paint(10, 2, 6, 'E'); g.paint(10, 2, 7, 'S');                   // eye + catch-light
        g.sym(10, 6, 1, 'K'); g.sym(10, 6, 0, 'K'); g.sym(10, 5, 0, 'K'); g.sym(10, 7, 0, 'K');   // legs, toes
      }
    };
    var songLayers = buildBirdLayers(SONG);
    var SONG_PARTS = {
      body:  { box: [9, 5, 2, 14, 11, 8], pivot: [11.5, 6.5, 3] },
      head:  { box: [8, 0, 3, 15, 5, 9], pivot: [11.5, 4.5, 5.5], parent: 'body' },
      tail:  { box: [9, 11, 3, 14, 16, 8], pivot: [11.5, 11, 5.5], parent: 'body' },
      wingL: { box: [0, 4, 6, 9, 11, 7], pivot: [8.6, 5.5, 6.5], parent: 'body' },
      wingR: { box: [14, 4, 6, 23, 11, 7], pivot: [14.4, 5.5, 6.5], parent: 'body' },
      legs:  { box: [9, 4, 0, 14, 9, 2], pivot: [11.5, 6.5, 2], parent: 'body' }
    };
    var SONG_K = { pitch: -22, tail: 10, up: 65, down: -45, glide: 8, hopZ: 2.5, peck: 35, peckHead: 43, beatMs: 50, bound: true };
    function songbird(name, displayName, desc, mats) {
      return {
        name: name, displayName: displayName, desc: desc,
        voxel: {
          version: 1, meshOnly: true, cellM: 0.01, size: [SONG.SX, SONG.SY, SONG.SZ], anchor: [11.5, 6.5, 0], light: false,
          mats: mats, layers: songLayers, parts: SONG_PARTS,
          animations: birdClips(Object.keys(SONG_PARTS), SONG_K),
          mounts: {
            eyes:   { at: [11.5, 2.5, 6.5], part: 'head' },
            beak:   { at: [11.5, 0, 6.5], part: 'head' },
            feet:   { at: [11.5, 6.5, 0], part: 'legs' },
            center: { at: [11.5, 7, 4.5], part: 'body' }
          }
        }
      };
    }
    A.models.robin = songbird('robin', 'robin',
      'v1.58 EP-WILD songbird (robin coat): 16 cm, orange face and breast with a grey border, olive-brown back and ' +
      'wings, white belly, dark eye with a catch-light. 6 parts: perch, hop, peck, takeoff, flap, glide, land, alert.',
      { O: 'dye_walnut_light', C: 'dye_walnut_light', U: 'dye_walnut_light', R: 'fur_fox', g: 'hair_grey_light', W: 'fur_cream',
        D: 'dye_walnut', V: 'hair_brown_light', T: 'dye_walnut', B: 'iron_dark', K: 'skin_shade', E: 'iron_dark', S: 'linen_light' });
    A.models.finch = songbird('finch', 'chaffinch',
      'v1.58 EP-WILD songbird (male chaffinch coat): blue-grey crown and nape, pink-brick face and breast, chestnut back, ' +
      'olive rump, dark wings with a white bar, white outer tail. Same shape and clips as the robin.',
      { O: 'hair_brown', C: 'dye_woad_light', U: 'dye_lincoln_light', R: 'dye_madder_light', g: 'dye_woad_light', W: 'fur_cream',
        D: 'hair_black_light', V: 'linen_light', T: 'linen_light', B: 'dye_gall_light', K: 'skin_shade', E: 'iron_dark', S: 'linen_light' });

    var CROW = {
      SX: 39, SY: 26, SZ: 13, seed: 71,
      body: [[6, 7.0, 2.4, 2.2], [7, 6.8, 2.9, 2.7], [8, 6.7, 3.1, 2.9], [9, 6.6, 3.2, 3.0], [10, 6.6, 3.1, 2.9],
             [11, 6.7, 2.9, 2.7], [12, 6.8, 2.6, 2.4], [13, 7.0, 2.2, 2.0], [14, 7.2, 1.8, 1.6], [15, 7.4, 1.4, 1.2]],
      bodyZMin: 4,
      neck: [[5, 8.6, 1.9, 2.0]], neckZMin: 8,
      head: [3.8, 9.6, 1.9, 2.1, 2.0], headZMin: 8,
      bodyRole: function (rel, y, h) { return h < 0.18 ? 'R' : (rel < -0.5 ? 'W' : 'O'); },
      headRole: function (ry, rz, h) { return h < 0.15 ? 'R' : 'O'; },
      wingLen: 17, wingRootX: 16, wingZ: 9,
      wingProf: function (d) {
        if (d <= 2) return range(7, 12);
        if (d <= 8) return range(7, 13);
        if (d <= 11) return range(8, 13);
        if (d <= 13) return range(9, 13);
        if (d === 14) return [9, 11, 13];                                  // fingered primaries (slots between)
        if (d === 15) return [10, 12];
        return [11, 13];
      },
      wingRole: function (d, r, h) { if (r === 0 && d <= 11) return 'V'; return h < 0.2 ? 'R' : 'D'; },
      extra: function (g) {
        var y, dx;
        for (y = 16; y <= 24; y++) {                                       // rounded tail, drooping a little
          var tz = y <= 20 ? 7 : 6, w = (y <= 18 || y === 24) ? 1 : 2;
          for (dx = 0; dx <= w; dx++) g.sym(19 - dx, y, tz, dx === 0 ? 'D' : (hash(dx, y, tz, 77) < 0.3 ? 'R' : 'D'));
        }
        g.put(19, 0, 8, 'B'); g.put(19, 1, 8, 'B'); g.put(19, 1, 9, 'B');    // upper mandible (head), arched tip
        g.put(19, 1, 7, 'B'); g.put(19, 2, 7, 'B');                          // lower mandible (jaw part)
        g.paint(18, 3, 9, 'E'); g.paint(18, 3, 10, 'S');                     // dark brown eye + catch-light
        g.sym(18, 8, 1, 'K'); g.sym(18, 8, 2, 'K'); g.sym(18, 8, 3, 'O');    // tarsus, feathered thigh
        g.sym(18, 6, 0, 'K'); g.sym(18, 7, 0, 'K'); g.sym(18, 8, 0, 'K'); g.sym(18, 9, 0, 'K');   // toes (3 front, 1 back)
      }
    };
    var CROW_PARTS = {
      body:  { box: [17, 6, 4, 22, 16, 11], pivot: [19.5, 8.5, 5] },
      head:  { box: [16, 0, 8, 23, 6, 13], pivot: [19.5, 5.5, 8.5], parent: 'body' },
      jaw:   { box: [18, 0, 6, 21, 3, 8], pivot: [19.5, 2.5, 8], parent: 'head' },
      tail:  { box: [17, 16, 4, 23, 26, 9], pivot: [19.5, 16, 7.5], parent: 'body' },
      wingL: { box: [0, 6, 9, 17, 15, 10], pivot: [16.6, 7.5, 9.5], parent: 'body' },
      wingR: { box: [22, 6, 9, 39, 15, 10], pivot: [22.4, 7.5, 9.5], parent: 'body' },
      legL:  { box: [17, 5, 0, 19, 11, 4], pivot: [18.5, 8.5, 4], parent: 'body' },
      legR:  { box: [20, 5, 0, 22, 11, 4], pivot: [20.5, 8.5, 4], parent: 'body' }
    };
    A.models.crow = {
      name: 'crow',
      displayName: 'crow',
      desc: 'v1.58 EP-WILD: carrion crow (also Rook, the talking crow), 0.50 m: glossy black with faint sheen, stout ' +
            'grey-black beak with a moving lower mandible, dark brown eyes with a catch-light, fingered wing tips, ' +
            'rounded tail, walks on two legs. 8 parts: perch, hop, walk, peck, takeoff, flap, glide, land, alert, tilt, caw, talk.',
      voxel: {
        version: 1, meshOnly: true, cellM: 0.02, size: [CROW.SX, CROW.SY, CROW.SZ], anchor: [19.5, 8.5, 0], light: false,
        mats: { O: 'hair_black', R: 'hair_black_light', W: 'hair_black_dark', D: 'hair_black_dark', V: 'hair_black_light',
                B: 'iron_dark', K: 'hair_black_dark', E: 'eye_brown', S: 'linen_light' },
        layers: buildBirdLayers(CROW),
        parts: CROW_PARTS,
        animations: birdClips(Object.keys(CROW_PARTS),
          { pitch: -10, tail: 2, up: 50, down: -40, glide: 6, hopZ: 2, peck: 45, peckHead: 40, beatMs: 100, bound: false, crow: true }),
        mounts: {
          eyes:   { at: [19.5, 3.5, 9.5], part: 'head' },
          beak:   { at: [19.5, 0, 8.5], part: 'head' },
          center: { at: [19.5, 10, 6.5], part: 'body' },
          talk:   { at: [19.5, 1, 7.5], part: 'jaw' }       // speech-bubble / caw anchor
        }
      }
    };
  })();

  // =================================================================================================================
  // ASSETS.wildlifeFx - presentation data for the ambient wildlife system (architect designs the system next; no game
  // logic here). Distances in metres from the player, speeds in m/s, times in seconds.
  // =================================================================================================================
  A.wildlifeFx = {
    version: 1,
    states: ['idle', 'graze', 'move', 'flee', 'alert'],
    animals: {
      rabbit: {
        fleeFrom: 'predators', // LIFE-07
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
        kind: 'ground',
        spawn: { kind: 'ground', habitats: ['meadow', 'edge'], cellChance: 0.35, spawnMinM: 15, spawnMaxM: 60, despawnM: 75, drawM: 45, cap: 10 },
        habitat: 'meadow edges, path verges, forest clearings; never deep forest',
        note: 'Gait rate = speed / tunedMps clamped to `rate`: the hop keeps its planted feet still at 0.6 m/s; the run ' +
              'touches the ground for only 50 ms per foot, so it can play at 1.0-1.6x for any flee speed (foot slip is ' +
              'not visible). alert = sits up (sitUp once, then alert loop); from alert go to flee or back to idle.'
      },
      deer: {
        fleeFrom: 'predators', // LIFE-07
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
        kind: 'ground',
        spawn: { kind: 'ground', habitats: ['edge', 'meadow', 'forest', 'riverbank'], cellChance: 0.15, spawnMinM: 35, spawnMaxM: 120, despawnM: 150, drawM: 90, cap: 6 },
        habitat: 'forest edges and clearings, meadows at the forest line',
        note: 'Gait rate = speed / tunedMps clamped to `rate`. alert = head up, frozen, a forefoot stamp; then flee ' +
              '(gallop, tail up = white rump flag) or back to graze / idle. Trot = the first second of a flee or a ' +
              'nervous move away.'
      },
      // ---- v1.58 (EP-WILD step 2): fox, squirrel, songbirds, crow. Spawn blocks = WILD-D4 (38.31 item 2), modest
      // densities; habitats: 'forest' | 'edge' (forest line, clearings) | 'meadow' | 'riverbank' (the game maps them to
      // its habitatAt mask). Every species: 'once' clips chain to their next clip, 'extra' = optional clips.
      fox: {
        models: ['fox'],
        kind: 'ground',
        hunts: ['rabbit'], huntR: 20, chaseMaxS: 8, eatS: 4, // LIFE-07 (38.56 c); eat clip from voxel_eat_clips.js
        clipFor: { idle: 'idle', graze: 'sniff', move: 'walk', flee: 'run', alert: 'alert', eat: 'eat' },
        extra: { trot: 'trot', pounce: 'pounce' },     // trot = nervous move / first second of a flee; pounce = mousing
        once: { pounce: 'sniff' },
        gaits: [
          { clip: 'walk', tunedMps: 0.67, minMps: 0.3, maxMps: 1.3, rate: [0.6, 1.8] },
          { clip: 'trot', tunedMps: 1.9, minMps: 1.3, maxMps: 4.0, rate: [0.7, 1.6] },
          { clip: 'run', tunedMps: 8.0, minMps: 4.0, maxMps: 12.0, rate: [0.6, 1.5] }
        ],
        speeds: { wander: 0.7, nervous: 1.9, flee: 8.0 },
        dist: { notice: 30, alert: 22, flee: 14, fleeIfRunning: 22, safe: 50 },
        times: { idle: [3, 7], graze: [5, 14], alert: [1.5, 4], wanderM: [4, 15], pounceEveryS: [8, 25] },
        flee: { turnDegPerS: 300, maxDistM: 60, hideOrDespawn: true },
        blendMs: 130,
        groupSize: [1, 1],
        spawn: { kind: 'ground', habitats: ['forest', 'edge', 'meadow'], cellChance: 0.06, spawnMinM: 40, spawnMaxM: 90, despawnM: 112, drawM: 60, cap: 2 },
        habitat: 'forest edges and meadows at dusk-like light; hunts mice in long grass (sniff -> pounce)',
        note: 'graze = sniff (nose on the ground). pounce is a once clip played from sniff now and then (times.pounceEveryS), ' +
              'in place (no root motion: the body rises 25 cm and dives back). alert = the frozen fox with a raised forepaw.'
      },
      squirrel: {
        models: ['squirrel'],
        kind: 'climber',
        clipFor: { idle: 'idle', graze: 'forage', move: 'hop', flee: 'run', alert: 'alert' },
        climb: { clip: 'climb', peek: 'peek', tunedMps: 1.2, rate: [0.6, 1.6], heightM: [2, 5], bodyLiftM: 0.165,
                 note: 'climb/peek have the body pitched -90 deg in the clip; instance yaw faces the trunk, instance x/y on ' +
                       'the trunk surface (paws on the instance y plane), instance z = height of the paws minus 0.165 m.' },
        gaits: [
          { clip: 'hop', tunedMps: 0.36, minMps: 0.1, maxMps: 0.8, rate: [0.6, 2.0] },
          { clip: 'run', tunedMps: 1.35, minMps: 0.8, maxMps: 4.0, rate: [1.0, 2.6] }
        ],
        speeds: { wander: 0.4, flee: 3.5 },
        dist: { notice: 14, alert: 10, flee: 6, fleeIfRunning: 10, safe: 25 },
        times: { idle: [2, 5], graze: [3, 8], alert: [1, 3], wanderHopM: [0.5, 3], peek: [3, 8] },
        flee: { toTrunk: true, turnDegPerS: 600, maxDistM: 20, hideOrDespawn: false },
        blendMs: 100,
        groupSize: [1, 2],
        spawn: { kind: 'climber', habitats: ['forest'], cellChance: 0.3, spawnMinM: 25, spawnMaxM: 50, despawnM: 62, drawM: 25, cap: 6 },
        habitat: 'forest floor near trunks (oak, pine); flees up the nearest trunk'
      },
      songbird: {
        models: ['robin', 'finch'],
        kind: 'flyer',
        clipFor: { idle: 'perch', graze: 'peck', move: 'hop', flee: 'flap', alert: 'alert' },
        flight: { takeoff: 'takeoff', flap: 'flap', glide: 'glide', land: 'land', perch: 'perch', speedMps: [6, 9],
                  cruiseAboveCanopyM: [3, 6], landLastM: 1.5 },
        once: { takeoff: 'flap', land: 'perch' },
        gaits: [{ clip: 'hop', tunedMps: 0.3, minMps: 0.05, maxMps: 0.8, rate: [0.6, 1.8] }],
        speeds: { wander: 0.3, flee: 7.5 },
        dist: { notice: 14, alert: 9, flee: 6, fleeIfRunning: 10, safe: 30 },
        times: { idle: [3, 10], graze: [2, 6], alert: [0.5, 2], perchS: [6, 25] },
        blendMs: 80,
        groupSize: [1, 4],
        variantChance: { robin: 0.5, finch: 0.5 },
        spawn: { kind: 'flyer', habitats: ['forest', 'edge', 'meadow'], cellChance: 0.4, spawnMinM: 15, spawnMaxM: 55, despawnM: 87, drawM: 40, cap: 14 },
        // perch ring per forest tree model: r = metres from the trunk axis, z = metres over the tree base. DERIVED from
        // ASSETS.forestTrees trunk numbers (trunkR, trunkH = lowest canopy next to the trunk) + the lower canopy, not
        // ray-measured on the meshes yet: re-check on preview/forest.html (WILD-D3 follow-up).
        perchByModel: {
          forestOakSmall:   { r: [0.9, 2.1], z: [2.8, 4.0] },
          forestOakLarge:   { r: [1.0, 2.5], z: [3.3, 4.8] },
          forestBirchSmall: { r: [0.8, 1.6], z: [2.9, 4.2] },
          forestBirchLarge: { r: [0.9, 1.9], z: [3.4, 5.0] },
          forestPineSmall:  { r: [0.8, 1.6], z: [1.6, 3.0] },
          forestPineLarge:  { r: [0.9, 1.9], z: [1.9, 3.6] }
        },
        habitat: 'perches in forest and edge trees, hops and pecks on meadows and paths near cover'
      },
      crow: {
        models: ['crow'],
        kind: 'flyer',
        clipFor: { idle: 'perch', graze: 'peck', move: 'walk', flee: 'flap', alert: 'alert' },
        flight: { takeoff: 'takeoff', flap: 'flap', glide: 'glide', land: 'land', perch: 'perch', speedMps: [7, 11],
                  cruiseAboveCanopyM: [5, 10], landLastM: 2.0 },
        once: { takeoff: 'flap', land: 'perch' },
        extra: { hop: 'hop', tilt: 'tilt', caw: 'caw', talk: 'talk' },   // Rook (quest NPC) uses tilt / talk / caw
        gaits: [
          { clip: 'walk', tunedMps: 0.25, minMps: 0.05, maxMps: 0.6, rate: [0.6, 1.8] },
          { clip: 'hop', tunedMps: 0.8, minMps: 0.6, maxMps: 1.6, rate: [0.7, 1.5] }
        ],
        speeds: { wander: 0.3, flee: 9.0 },
        dist: { notice: 30, alert: 20, flee: 12, fleeIfRunning: 20, safe: 45 },
        times: { idle: [4, 12], graze: [4, 12], alert: [1, 3], perchS: [8, 30], cawEveryS: [6, 20] },
        blendMs: 120,
        groupSize: [1, 3],
        spawn: { kind: 'flyer', habitats: ['meadow', 'edge', 'riverbank'], cellChance: 0.08, spawnMinM: 40, spawnMaxM: 90, despawnM: 112, drawM: 45, cap: 3 },
        perchFrom: 'songbird',                         // same perchByModel table (the crow sits a little higher: + 0.5 m z)
        habitat: 'meadows, field edges and riverbanks; walks and pecks in the open, perches on tall trees',
        note: 'Rook (the talking crow of the quest line) = this model placed as an NPC: perch + tilt while idle, talk while ' +
              'speaking (jaw part), caw on greet. Mount `talk` = the beak (speech-bubble anchor).'
      }
    },
    engineNotes: [
      'crossfade between voxel clips (~120-150 ms) so state switches do not snap',
      'per-instance clip playback rate (rate = ground speed / tunedMps) so gait feet stay planted',
      'optional: random start phase per instance so a group does not move in sync'
    ]
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { rabbit: A.models.rabbit, deer: A.models.deer, deerBuck: A.models.deerBuck, fox: A.models.fox,
                       squirrel: A.models.squirrel, robin: A.models.robin, finch: A.models.finch, crow: A.models.crow,
                       wildlifeFx: A.wildlifeFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
