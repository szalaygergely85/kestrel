/* design/models/voxel_beast_clips.js - beast COMBAT clips for the OB-153 bestiary animals (designer, OB-153 follow-up,
 *                                      2026-10-15): the deer, fox, mountain goat and snapping turtle now spawn as beasts
 *                                      (hit / flee / attack), so their models get the clips game/js/quest/beastView.js asks
 *                                      for. Binding: design/style-guide.md section 0 (realistic, ALL FOURS in every clip;
 *                                      the only exception is the death fall onto the side).
 *
 * Classic script (no import/export, check-deps rule 4). LOAD ORDER: AFTER the model files it extends (each optional):
 *   design/models/voxel_wildlife.js (deer, fox), design/models/voxel_eat_clips.js (fox eat, so its index stays),
 *   design/models/voxel_goat.js (goat), design/models/voxel_tortoise.js (tortoise = the snapping turtle's model)
 *   <script src="../design/models/voxel_beast_clips.js">     (browser, after the four above)
 *   import '../design/models/voxel_beast_clips.js';          (Node, after their imports)
 * It APPENDS animations to ASSETS.models.deer / fox / goat / tortoise (appended LAST, existing clips and their indices
 * untouched, an existing clip name is never overwritten) and sets ASSETS.beastClipsFx. Kept in its own file (as
 * voxel_eat_clips.js) so the model files and their exact-clip-set tests stay untouched. Test: tools/voxel-beast-clips.test.mjs.
 *
 * Clips per model (frame format = the model's own: {part: {rot, pos}} for EVERY part, pos in voxels, R = Rz*Ry*Rx):
 *   hurt    once 0.3 s  3 keys: flinch on all fours - jolt back + head snaps up + ears pinned (+ a bleat / hiss jaw),
 *                       follow-through, settle. The view shows it for the first 10 steps (beastView HURT_STEPS).
 *   flinch  once 0.25 s 3 keys: the stagger follow-through (recoil -> head dips past rest -> rest).
 *   windup  once = kinds.json windupSec. deer 0.5 s: weight back, head high, ears pinned, a forehoof STAMPS twice
 *                       (events.stamp keys 2, 4). fox 0.4 s: CROUCH - forequarters low, head low and forward, ears flat,
 *                       tail out. goat 0.5 s: HEAD DOWN, horns forward, weight rocks back, a forehoof paws the ground
 *                       (events.scrape key 2), coiled. turtle 0.6 s: NECK PULL-BACK into the shell, head cocked up,
 *                       beak parting - then the attack snaps.
 *   attack  once = kinds.json activeSec, events.hit = key 1. deer 0.3 s: forehoof STRIKE (kick) - the right fore cocks
 *                       (knee folded) and strikes forward-down, three hooves stay planted. fox 0.2 s: lunge BITE - the
 *                       body drives forward, head snaps down, a shake, pull back. goat 0.3 s: head BUTT - drive forward
 *                       horns low, then the hook (head tosses up) on impact. turtle 0.3 s: SNAP - neck shoots out and
 *                       down, beak wide (jaw 18), shuts, draws back.
 *   die     once 0.5 s  5 keys at [90, 110, 120, 80, 100] ms = beastView.js DIE_DURATIONS (the view drives the frames from
 *                       the sim's DYING timer): death throe (head up) -> legs buckle -> rolls onto its RIGHT side ->
 *                       thud (overshoot, legs kick) -> still. The turtle cannot roll (shell): it slumps with a list,
 *                       legs going limp and splayed, neck and head sagging to the ground. The lying body is put on the
 *                       ground by the file's own FK over the model's voxels (no part under the ground).
 *   dead    loop        the still last die key (the lootable corpse).
 *   sink    once 0.6 s  [500, 100]: the corpse sinks by its lying height (+ the sim's own sinkM), then is hidden.
 *   charge  loop        alias = a copy of the model's fastest existing gait (deer gallop, fox run, goat / turtle walk):
 *                       beastView shows `charge` for chase / charge states.
 * Standing keys use a planted-foot solve (the deer Rig maths: foot target + world limb pitch -> limb rot / pos, stride
 * angle asin(dy / L)); a struck / pawing leg is `free` (+ its lower leg folded at the knee).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var D2R = Math.PI / 180;
  var DIE_MS = [90, 110, 120, 80, 100];   // = game/js/quest/beastView.js DIE_DURATIONS (keep in step)
  var SINK_MS = [500, 100];               // = beastView.js SINK_DURATIONS
  var done = [];

  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function rr(a) { return [r2(a[0]), r2(a[1]), r2(a[2])]; }
  function v3(a) {
    if (a === undefined || a === null) return [0, 0, 0];
    if (typeof a === 'number') return [a, 0, 0];
    return [a[0] || 0, a[1] || 0, a[2] || 0];
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
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
  function mul(P, Q) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] = P[i][0] * Q[0][j] + P[i][1] * Q[1][j] + P[i][2] * Q[2][j];
    return C;
  }
  // mk(base, over): a copy of base with over's fields; rot / pos / legs / low are merged per key
  function mk(base, over) {
    var o = clone(base || {}), v = clone(over || {}), k, q;
    for (k in v) {
      if ((k === 'rot' || k === 'pos' || k === 'legs' || k === 'low') && o[k]) { for (q in v[k]) o[k][q] = v[k][q]; }
      else o[k] = v[k];
    }
    return o;
  }
  function norm(spec) {
    var o = clone(spec || {}), b = o.b || [];
    o.b = [b[0] || 0, b[1] || 0, b[2] || 0, b[3] || 0, b[4] || 0, b[5] || 0];
    o.rot = o.rot || {}; o.pos = o.pos || {}; o.legs = o.legs || {}; o.low = o.low || {};
    return o;
  }
  function add(D, clips) { for (var k in clips) if (clips[k] && !D.animations[k]) D.animations[k] = clips[k]; }
  function legsFromRig(D) {
    var out = {}, keys = ['FL', 'FR', 'BL', 'BR'], L = (D.legRig && D.legRig.legs) || [];
    for (var i = 0; i < 4 && i < L.length; i++) out[keys[i]] = { part: L[i].upper, foot: L[i].foot };
    return out;
  }

  // =================================================================================================================
  // Kit: FK over the model's own voxels (first box wins, part order) + planted-limb solve + frame / clip / die builders
  //   spec o = { b: [rx,ry,rz, px,py,pz] root, rot: {part: [..]}, pos: {part: [..]}, j: jaw deg,
  //              legs: { FL: {dy, lift, rx, ry, rz} planted | {free: [rx,ry,rz], up} }, low: { FL: [rx,ry,rz] } lower leg,
  //              settle: 'raise' | 'exact' (root's lowest voxel >= / = the ground), fit: [{leg, step} | {part, list, step}] }
  // =================================================================================================================
  function Kit(id, cfg) {
    var M = A.models[id];
    if (!M || !M.voxel || !M.voxel.animations || !M.voxel.parts || !M.voxel.layers) return null;
    var D = M.voxel, parts = D.parts, names = Object.keys(parts), rootP = cfg.root, legs = cfg.legs;
    var ground = (D.anchor && D.anchor[2]) || 0, LEG = {}, LOW = {}, own = {}, x, y, z, i;
    if (!parts[rootP]) return null;
    Object.keys(legs).forEach(function (k) {
      LEG[legs[k].part] = k;
      if (parts[legs[k].part + '2']) LOW[legs[k].part + '2'] = k;
    });
    names.forEach(function (n) { own[n] = []; });
    for (z = 0; z < D.layers.length; z++) for (y = 0; y < D.layers[z].length; y++) {
      var row = D.layers[z][y];
      for (x = 0; x < row.length; x++) {
        if (row.charAt(x) === '.' || row.charAt(x) === ' ') continue;
        for (i = 0; i < names.length; i++) {
          var bx = parts[names[i]].box;
          if (x >= bx[0] && x < bx[3] && y >= bx[1] && y < bx[4] && z >= bx[2] && z < bx[5]) { own[names[i]].push([x, y, z]); break; }
        }
      }
    }
    function xforms(f) {
      var T = {};
      for (var a = 0; a < names.length; a++) {
        var n = names[a], p = parts[n], st = f[n] || {}, r = st.rot || [0, 0, 0], t = st.pos || [0, 0, 0], c = p.pivot;
        var R = rotM(r[0], r[1], r[2]), Rc = app(R, c), lo = [c[0] - Rc[0] + t[0], c[1] - Rc[1] + t[1], c[2] - Rc[2] + t[2]];
        if (p.parent && T[p.parent]) {
          var P = T[p.parent], o2 = app(P.R, lo);
          T[n] = { R: mul(P.R, R), o: [o2[0] + P.o[0], o2[1] + P.o[1], o2[2] + P.o[2]] };
        } else T[n] = { R: R, o: lo };
      }
      return T;
    }
    // [lowest, highest] world z (voxels above the ground) of the listed parts' voxel corners
    function zr(f, list) {
      var T = xforms(f), mn = 1e9, mx = -1e9;
      for (var a = 0; a < list.length; a++) {
        var m = T[list[a]], vs = own[list[a]];
        if (!m || !vs) continue;
        var ra = m.R[2][0], rb = m.R[2][1], rc = m.R[2][2], d = m.o[2];
        var lo = Math.min(0, ra) + Math.min(0, rb) + Math.min(0, rc), hi = Math.max(0, ra) + Math.max(0, rb) + Math.max(0, rc);
        for (var j = 0; j < vs.length; j++) {
          var w = ra * vs[j][0] + rb * vs[j][1] + rc * vs[j][2] + d;
          if (w + lo < mn) mn = w + lo;
          if (w + hi > mx) mx = w + hi;
        }
      }
      return [mn - ground, mx - ground];
    }
    // planted limb (voxel_wildlife.js Rig.limbPose maths): the foot point lands on rest foot + (dx, dy, lift); the limb's
    // WORLD pitch = rx + asin(dy / L) (stride angle), its local rot cancels the root pitch.
    function plant(L, spec, b) {
      var pl = parts[L.part].pivot, pb = parts[rootP].pivot, Rb = rotM(b[0], b[1], b[2]), f = L.foot;
      var len = Math.max(1, pl[2] - f[2]), dy = spec.dy || 0, s = Math.max(-0.9, Math.min(0.9, dy / len));
      var lr = [(spec.rx || 0) + Math.asin(s) / D2R - b[0], spec.ry || 0, spec.rz || 0], Rl = rotM(lr[0], lr[1], lr[2]);
      var q = appT(Rb, [f[0] + (spec.dx || 0) - pb[0] - b[3], f[1] + dy - pb[1] - b[4], f[2] + (spec.lift || 0) - pb[2] - b[5]]);
      var w = app(Rl, [f[0] - pl[0], f[1] - pl[1], f[2] - pl[2]]);
      return { rot: rr(lr), pos: rr([q[0] - w[0] - pl[0] + pb[0], q[1] - w[1] - pl[1] + pb[1], q[2] - w[2] - pl[2] + pb[2]]) };
    }
    function frame(o) {
      var out = {}, b = o.b;
      for (var a = 0; a < names.length; a++) {
        var n = names[a];
        if (n === rootP) { out[n] = { rot: rr(b.slice(0, 3)), pos: rr(b.slice(3, 6)) }; continue; }
        if (LEG[n]) {
          var s = o.legs[LEG[n]] || {};
          out[n] = s.free ? { rot: rr(v3(s.free)), pos: rr([0, 0, s.up || 0]) } : plant(legs[LEG[n]], s, b);
          continue;
        }
        if (LOW[n]) { out[n] = { rot: rr(v3(o.low[LOW[n]])), pos: [0, 0, 0] }; continue; }
        var r = v3(o.rot[n]);
        if (n === cfg.jaw) r = [Math.max(0, Math.min(cfg.jawMax || 18, o.j || 0)), 0, 0];
        out[n] = { rot: rr(r), pos: rr(v3(o.pos[n])) };
      }
      return out;
    }
    function legList(k) { var p = legs[k].part, l = [p]; if (parts[p + '2']) l.push(p + '2'); return l; }
    // turn a part (or a free leg) by `step` until its lowest corner is on / over the ground (max 40 steps, |rot| <= 170)
    function fitOne(o, f) {
      var list = f.leg ? legList(f.leg) : f.list;
      if (f.leg && !(o.legs[f.leg] && o.legs[f.leg].free)) return;
      for (var it = 0; it < 40; it++) {
        if (zr(frame(o), list)[0] >= -0.02) return;
        var cur = f.leg ? v3(o.legs[f.leg].free) : v3(o.rot[f.part]);
        var nr = [cur[0] + f.step[0], cur[1] + f.step[1], cur[2] + f.step[2]];
        if (Math.abs(nr[0]) > 170 || Math.abs(nr[1]) > 170 || Math.abs(nr[2]) > 170) return;
        if (f.leg) o.legs[f.leg].free = nr; else o.rot[f.part] = nr;
      }
    }
    function settle(o, exact) {
      var m = zr(frame(o), [rootP])[0];
      if (exact || m < 0) o.b[5] = r2(o.b[5] - m);
    }
    function clip(keys, loop, events) {
      var c = { durations: [], loop: loop, frames: [] };
      for (var a = 0; a < keys.length; a++) { c.durations.push(keys[a][0]); c.frames.push(frame(norm(keys[a][1]))); }
      if (events) c.events = events;
      return c;
    }
    // die (5 keys, DIE_MS) + dead (its last key held) + sink (last key -> sunk by the lying height)
    function die(keys) {
      var specs = keys.map(function (k) {
        var o = norm(k[1]);
        if (o.settle) settle(o, o.settle === 'exact');
        (o.fit || []).forEach(function (f) { fitOne(o, f); });
        return o;
      });
      var frames = specs.map(frame), last = frames[frames.length - 1], S = clone(specs[specs.length - 1]);
      S.b[5] = r2(S.b[5] - zr(last, names)[1] - 0.5);
      return {
        die: { durations: keys.map(function (k) { return k[0]; }), loop: false, frames: frames },
        dead: { durations: [1000], loop: true, frames: [clone(last)] },
        sink: { durations: SINK_MS.slice(), loop: false, frames: [clone(last), frame(S)] }
      };
    }
    return { D: D, has: function (n) { return !!parts[n]; }, frame: frame, clip: clip, die: die, zr: zr, names: names };
  }

  // ---- shared quadruped pieces (deer, fox, goat: body, head (+ jaw), ears, (tail), legFL..BR + legFL2..BR2) ----
  function legsFree(fl, fr, bl, br) { return { FL: { free: fl }, FR: { free: fr }, BL: { free: bl }, BR: { free: br } }; }
  function lows(fl, fr, bl, br) { return { FL: [fl, 0, 0], FR: [fr, 0, 0], BL: [bl, 0, 0], BR: [br, 0, 0] }; }
  // buckling legs fold (fore feet back, hind feet forward); lying legs lift (body roll + leg roll = legs off the ground)
  var FOLD = [{ leg: 'FL', step: [4, 0, 0] }, { leg: 'FR', step: [4, 0, 0] }, { leg: 'BL', step: [-4, 0, 0] }, { leg: 'BR', step: [-4, 0, 0] }];
  var LIFT = [{ leg: 'FL', step: [0, 4, 0] }, { leg: 'FR', step: [0, 4, 0] }, { leg: 'BL', step: [0, 4, 0] }, { leg: 'BR', step: [0, 4, 0] }];

  // p = { back: hurt push-back (cells), jaw: [hurt0, hurt1] bleat or null }
  function quadHurt(K, p) {
    var tail = K.has('tail');
    function R(h, e, t) { var r = { head: h, ears: e }; if (tail) r.tail = t; return r; }
    var J = p.jaw || [0, 0], bk = p.back;
    var H1 = { b: [-3, 0, 1.5, 0, bk * 0.5, 0.15], j: J[1], rot: R([-6, 0, 4], [-15, 0, 0], [16, 0, 0]) };
    return {
      hurt: K.clip([
        [50,  { b: [-6, 0, 0, 0, bk, 0.3], j: J[0], rot: R([-13, 0, 0], [-25, 0, 0], [30, 0, 0]) }],   // jolt: head snaps up
        [100, H1],                                                                                      // follow-through
        [150, { b: [0, 0, 0, 0, bk * 0.1, 0], rot: R([-1, 0, 0], [-4, 0, 0], [4, 0, 0]) }]               // settle
      ], false),
      flinch: K.clip([
        [60, H1],
        [90, { b: [2, 0, 0, 0, 0, -0.1], rot: R([5, 0, 0], [-8, 0, 0], [6, 0, 0]) }],                   // head dips past rest
        [100, {}]
      ], false)
    };
  }
  // p = { z: [buckle pz, falling pz, lying pz (first guess)], throeHead, deadHead, droop (upper legs, deg), jaw: [5] or null }
  function quadDie(K, p) {
    var tail = K.has('tail'), H = K.has('jaw') ? ['head', 'jaw', 'ears'] : ['head', 'ears'];
    function R(h, e, t) { var r = { head: h, ears: e }; if (tail) r.tail = t; return r; }
    function J(i) { return p.jaw ? p.jaw[i] : 0; }
    var lying = LIFT.concat([{ part: 'head', list: H, step: [0, -4, 0] }]);
    if (tail) lying = lying.concat([{ part: 'tail', list: ['tail'], step: [0, 4, 0] }]);
    return K.die([
      [DIE_MS[0], { b: [-5, 0, 0, 0, 0.5, 0.2], j: J(0), rot: R(p.throeHead, [-30, 0, 0], [30, 0, 0]) }],          // throe
      [DIE_MS[1], { b: [5, 14, 0, 0, 0, p.z[0]], settle: 'raise', j: J(1), rot: R([-8, 0, 0], [-25, 0, 0], [10, 0, 0]),  // buckle
                    legs: legsFree([40, 0, 0], [44, 0, 0], [-36, 0, 0], [-40, 0, 0]), low: lows(30, 30, -20, -20), fit: FOLD }],
      [DIE_MS[2], { b: [2, 55, 0, 0, 0, p.z[1]], settle: 'raise', j: J(2), rot: R([-12, -6, 0], [-28, 0, 0], [10, 0, 0]), // tips over
                    legs: legsFree([20, -10, 0], [26, -10, 0], [-18, -10, 0], [-22, -10, 0]), low: lows(20, 20, -14, -14), fit: lying }],
      [DIE_MS[3], { b: [0, 96, 0, 0, 0, p.z[2]], settle: 'exact', j: J(3), rot: R([-14, -2, 0], [-30, 0, 0], [20, 0, 0]),  // thud
                    legs: legsFree([-35, 8 - p.droop, 0], [-30, -2, 0], [30, 8 - p.droop, 0], [26, -2, 0]), low: lows(10, 8, -6, -4), fit: lying }],
      // still: the upper (left) legs flop down toward the lower ones (ry - = droop), the lower legs lie out
      [DIE_MS[4], { b: [0, 90, 0, 0, 0, p.z[2]], settle: 'exact', j: J(4), rot: R(p.deadHead, [-25, 0, 0], [0, 0, 0]),     // still
                    legs: legsFree([-25, -p.droop, 0], [-20, -6, 0], [20, -p.droop, 0], [15, -6, 0]), low: lows(20, 14, -15, -10), fit: lying }]
    ]);
  }
  function addAll(K, id, clips, dieSet, chargeFrom) {
    var D = K.D, out = {}, k;
    for (k in clips) out[k] = clips[k];
    out.die = dieSet.die; out.dead = dieSet.dead; out.sink = dieSet.sink;
    if (chargeFrom && D.animations[chargeFrom]) out.charge = clone(D.animations[chargeFrom]);
    add(D, out);
    done.push(id);
  }

  // =================================================================================================================
  // DEER (voxel_wildlife.js `deer`, kinds.json red_deer: kick, windup 0.5 s, active 0.3 s). cellM 0.05, L 14 / 15.
  // =================================================================================================================
  (function () {
    var M = A.models.deer;
    var K = M && M.voxel && Kit('deer', { root: 'body', legs: legsFromRig(M.voxel) });
    if (!K) return;
    var W0 = { b: [-3, 0, 0, 0, 0.8, 0.2], rot: { head: [-14, 0, 0], ears: [-22, 0, 0], tail: [30, 0, 0] } };
    var UP = { legs: { FR: { dy: -1.5, lift: 2.5, rx: -10 } }, low: { FR: [30, 0, 0] } };   // forehoof raised, knee folded
    var DOWN = { legs: { FR: { dy: -1 } }, low: { FR: [0, 0, 0] } };                         // ... STAMP
    var c = quadHurt(K, { back: 1, jaw: null });
    c.windup = K.clip([
      [100, W0],
      [100, mk(W0, UP)],
      [100, mk(W0, mk(DOWN, { rot: { head: [-16, 0, 3] } }))],
      [100, mk(W0, UP)],
      [100, mk({ b: [-4, 0, 0, 0, 1.2, 0.2], rot: { head: [-18, 0, 0], ears: [-26, 0, 0], tail: [35, 0, 0] } }, DOWN)]
    ], false, { stamp: [2, 4] });
    c.attack = K.clip([
      // cock: the right fore comes up, knee folded (hoof ~15 cm up, forward); three hooves planted
      [100, { b: [-7, 0, 0, 0, 0.8, 0.5], rot: { head: [-18, 0, 0], ears: [-28, 0, 0], tail: [40, 0, 0] },
              legs: { FR: { free: [-55, 0, 0] }, BL: { dy: 0.5 }, BR: { dy: 0.5 } }, low: { FR: [60, 0, 0] } }],
      // STRIKE (hit): the hoof drives forward-down, the body follows
      [100, { b: [-3, 0, 0, 0, -0.6, 0.2], rot: { head: [-10, 0, 0], ears: [-28, 0, 0], tail: [40, 0, 0] },
              legs: { FR: { free: [-38, 0, 0] }, FL: { dy: -0.5 } }, low: { FR: [12, 0, 0] } }],
      // recover: hoof back down, planted
      [100, { b: [-1, 0, 0, 0, 0, 0.1], rot: { head: [-6, 0, 0], ears: [-12, 0, 0], tail: [20, 0, 0] }, legs: { FR: { dy: -1, lift: 0.5 } } }]
    ], false, { hit: 1 });
    addAll(K, 'deer', c, quadDie(K, { z: [-3.5, -7, -11], throeHead: [-22, 0, 0], deadHead: [-10, 6, 0], droop: 16 }), 'gallop');
  })();

  // =================================================================================================================
  // FOX (voxel_wildlife.js `fox` (+ eat), kinds.json fox: nip, windup 0.4 s, active 0.2 s). cellM 0.025, L 10.
  // =================================================================================================================
  (function () {
    var M = A.models.fox;
    var K = M && M.voxel && Kit('fox', { root: 'body', legs: legsFromRig(M.voxel) });
    if (!K) return;
    var FWD = { FL: { dy: -0.5 }, FR: { dy: -0.5 } };
    var c = quadHurt(K, { back: 1.6, jaw: null });
    c.windup = K.clip([
      [100, { b: [3, 0, 0, 0, 0.6, -0.8], rot: { head: [8, 0, 0], ears: [-16, 0, 0], tail: [4, 0, 0] } }],
      [100, { b: [5, 0, 0, 0, 1.2, -1.5], rot: { head: [16, 0, 0], ears: [-30, 0, 0], tail: [10, 0, 0] }, legs: FWD }],     // CROUCH
      [100, { b: [5, 0, -2, 0, 1.3, -1.5], rot: { head: [15, 0, 4], ears: [-30, 0, 4], tail: [12, 0, 6] }, legs: FWD }],   // eyes the target
      [100, { b: [6, 0, 0, 0, 1.5, -1.6], rot: { head: [18, 0, 0], ears: [-32, 0, 0], tail: [14, 0, 0] }, legs: FWD }]     // coiled
    ], false);
    var BITE = { FL: { dy: -3.5 }, FR: { dy: -3 }, BL: { dy: -1.5 }, BR: { dy: -1.5 } };
    c.attack = K.clip([
      [50, { b: [-2, 0, 0, 0, -1.5, 0.4], rot: { head: [4, 0, 0], ears: [-30, 0, 0], tail: [14, 0, 0] },
             legs: { FL: { dy: -2, lift: 1.5 }, FR: { dy: -1 } } }],                                                         // lunge
      [50, { b: [4, 0, 0, 0, -3.5, -0.6], rot: { head: [16, 0, 0], ears: [-32, 0, 0], tail: [16, 0, 0] }, legs: BITE }],      // BITE (hit)
      [50, { b: [4, 0, 3, 0, -3.2, -0.6], rot: { head: [14, 0, -10], ears: [-30, 0, 0], tail: [16, 0, -6] }, legs: BITE }],   // shake
      [50, { b: [1, 0, 0, 0, -1.2, 0], rot: { head: [5, 0, 0], ears: [-20, 0, 0], tail: [10, 0, 0] },
             legs: { FL: { dy: -1.5 }, FR: { dy: -1.5 }, BL: { dy: -0.5 }, BR: { dy: -0.5 } } }]                             // pull back
    ], false, { hit: 1 });
    addAll(K, 'fox', c, quadDie(K, { z: [-2.5, -5.5, -9.7], throeHead: [-20, 0, 0], deadHead: [-8, 4, 0], droop: 18 }), 'run');
  })();

  // =================================================================================================================
  // GOAT (voxel_goat.js `goat`, kinds.json mountain_goat: headbutt, windup 0.5 s, active 0.3 s). cellM 0.037, L 11,
  // jaw 0..20 (bleat), no tail part.
  // =================================================================================================================
  (function () {
    var M = A.models.goat;
    var K = M && M.voxel && Kit('goat', { root: 'body', legs: legsFromRig(M.voxel), jaw: 'jaw', jawMax: 20 });
    if (!K) return;
    var c = quadHurt(K, { back: 1.2, jaw: [10, 5] });
    var BACK = { b: [-1, 0, 0, 0, 1.6, -0.3], rot: { head: [30, 0, 0], ears: [-20, 0, 0] } };
    var PAW = { legs: { FL: { dy: -1, lift: 2.5 } }, low: { FL: [25, 0, 0] } };
    c.windup = K.clip([
      [100, { b: [2, 0, 0, 0, 0.6, -0.3], rot: { head: [22, 0, 0], ears: [-15, 0, 0] } }],                        // head drops
      [100, mk(BACK, PAW)],                                                                                         // rocks back, paws
      [100, mk(BACK, { rot: { head: [30, 0, -3] }, legs: { FL: { dy: 1.5, lift: 0.3 } } })],                      // SCRAPE back
      [100, mk(BACK, mk(PAW, { rot: { head: [31, 0, 3] } }))],
      [100, { b: [3, 0, 0, 0, 1.4, -0.6], rot: { head: [34, 0, 0], ears: [-22, 0, 0] } }]                         // coiled, horns forward
    ], false, { scrape: [2] });
    c.attack = K.clip([
      [100, { b: [4, 0, 0, 0, -2.5, -0.4], rot: { head: [36, 0, 0], ears: [-22, 0, 0] },
              legs: { FL: { dy: -2.5 }, FR: { dy: -2, lift: 1.5 }, BL: { dy: -1 }, BR: { dy: -1.5 } } }],           // drive, horns low
      [100, { b: [-3, 0, 0, 0, -3.5, 0.3], j: 4, rot: { head: [-2, 0, 0], ears: [-18, 0, 0] },
              legs: { FL: { dy: -3 }, FR: { dy: -3 }, BL: { dy: -2 }, BR: { dy: -2 } } }],                           // IMPACT + hook up (hit)
      [100, { b: [0, 0, 0, 0, -1.5, 0], rot: { head: [6, 0, 0], ears: [-8, 0, 0] },
              legs: { FL: { dy: -1.5 }, FR: { dy: -1.5 }, BL: { dy: -1 }, BR: { dy: -1 } } }]                        // recover
    ], false, { hit: 1 });
    addAll(K, 'goat', c, quadDie(K, { z: [-3, -6, -9], throeHead: [-18, 0, 0], deadHead: [-14, 4, 0], droop: 30, jaw: [12, 8, 4, 6, 3] }), 'walk');
  })();

  // =================================================================================================================
  // SNAPPING TURTLE (voxel_tortoise.js `tortoise`, kinds.json snapping_turtle: snap, windup 0.6 s, active 0.3 s).
  // cellM 0.06; shell (root) / neck (rx - up, pos y + = into the shell) / head / jaw 0..18 / 4 column legs (L 4).
  // =================================================================================================================
  (function () {
    var K = Kit('tortoise', { root: 'shell', jaw: 'jaw', jawMax: 18, legs: {
      FL: { part: 'legFL', foot: [2.5, 10.5, 0] }, FR: { part: 'legFR', foot: [15.5, 10.5, 0] },
      BL: { part: 'legBL', foot: [3.5, 24.5, 0] }, BR: { part: 'legBR', foot: [14.5, 24.5, 0] } } });
    if (!K) return;
    var NK = ['neck', 'head', 'jaw'];
    var H1 = { b: [-1.5, 0, 1, 0, 0.3, 0.15], j: 3, rot: { neck: [-4, 0, 0], head: [-2, 0, 0] }, pos: { neck: [0, 0.8, 0] } };
    var LUNGE = { FL: { dy: -0.75 }, FR: { dy: -0.75 }, BL: { dy: -0.75 }, BR: { dy: -0.75 } };   // feet lean with the lurch
    var c = {
      hurt: K.clip([
        [50,  { b: [-3, 0, 0, 0, 0.6, 0.3], j: 8, rot: { neck: [-10, 0, 0], head: [-6, 0, 0] }, pos: { neck: [0, 1.5, 0] } }],   // jerk + hiss
        [100, H1],
        [150, { rot: { neck: [-1, 0, 0] }, pos: { neck: [0, 0.2, 0] } }]
      ], false),
      flinch: K.clip([[60, H1], [90, { rot: { neck: [3, 0, 0], head: [2, 0, 0] } }], [100, {}]], false),
      windup: K.clip([
        [150, { b: [0, 0, 0, 0, 0.4, 0], rot: { neck: [4, 0, 0] }, pos: { neck: [0, 2.5, -0.3] } }],                           // neck draws in
        [150, { b: [-1, 0, 0, 0, 0.8, 0.1], j: 4, rot: { neck: [-4, 0, 0], head: [-8, 0, 0] }, pos: { neck: [0, 3.5, -0.4] } }], // head cocks up
        [150, { b: [-1, 0, 0, 0, 0.8, 0.1], j: 6, rot: { neck: [-5, 0, 2], head: [-9, 0, 0] }, pos: { neck: [0, 3.6, -0.4] } }],
        [150, { b: [-1.5, 0, 0, 0, 1, 0.1], j: 10, rot: { neck: [-6, 0, -1], head: [-10, 0, 0] }, pos: { neck: [0, 3.8, -0.4] } }] // beak parting
      ], false),
      attack: K.clip([
        [100, { b: [2, 0, 0, 0, -1.5, -0.1], j: 18, rot: { neck: [8, 0, 0], head: [4, 0, 0] }, pos: { neck: [0, -1, 0.2] }, legs: LUNGE }], // strike, beak wide
        [100, { b: [2, 0, 0, 0, -1.5, -0.1], j: 0, rot: { neck: [10, 0, 0], head: [6, 0, 0] }, pos: { neck: [0, -1, 0.2] }, legs: LUNGE }], // SNAP (hit)
        [100, { b: [0, 0, 0, 0, -0.3, 0], rot: { neck: [2, 0, 0] }, pos: { neck: [0, 0.5, 0] } }]                                       // draws back
      ], false, { hit: 1 })
    };
    // die: the shell cannot roll - it slumps with a list onto limp, splayed legs; neck and head sag to the ground
    function splay(a) { return { FL: { free: [0, a, 0] }, FR: { free: [0, -a, 0] }, BL: { free: [0, a, 0] }, BR: { free: [0, -a, 0] } }; }
    var SPLAY = [{ leg: 'FL', step: [0, 4, 0] }, { leg: 'BL', step: [0, 4, 0] }, { leg: 'FR', step: [0, -4, 0] }, { leg: 'BR', step: [0, -4, 0] }];
    var NECKFIT = [{ part: 'neck', list: NK, step: [-3, 0, 0] }];
    var d = K.die([
      [DIE_MS[0], { b: [-2, 0, 0, 0, 0, 0.2], j: 12, rot: { neck: [-14, 0, 0], head: [-8, 0, 0] } }],                          // gasp
      [DIE_MS[1], { b: [1, 2, 0, 0, 0, -0.5], settle: 'raise', j: 6, rot: { neck: [-4, 0, 0] }, legs: splay(30), fit: SPLAY }],  // legs give
      [DIE_MS[2], { b: [2, 5, 0, 0, 0, -1], settle: 'raise', j: 4, rot: { neck: [10, 0, -4], head: [4, 0, 0] },
                    legs: splay(55), fit: SPLAY.concat(NECKFIT) }],
      [DIE_MS[3], { b: [1, 8, 0, 0, 0, -1.8], settle: 'raise', j: 5, rot: { neck: [32, 0, -10], head: [14, 0, 0] },              // thud
                    pos: { neck: [0, -0.6, -0.4] }, legs: splay(82), fit: SPLAY.concat(NECKFIT) }],
      [DIE_MS[4], { b: [0, 6, 0, 0, 0, -1.5], settle: 'raise', j: 4, rot: { neck: [30, 0, -10], head: [14, 0, 0] },              // still
                    pos: { neck: [0, -0.6, -0.4] }, legs: splay(78), fit: SPLAY.concat(NECKFIT) }]
    ]);
    addAll(K, 'tortoise', c, d, 'walk');
  })();

  // ===================================================================================================================
  // ASSETS.beastClipsFx - presentation data for the beast view (no game logic here)
  // ===================================================================================================================
  A.beastClipsFx = {
    version: 1,
    story: 'OB-153 follow-up: beast combat clips for the bestiary animals (designer 2026-10-15)',
    models: done.slice(),
    kinds: { deer: 'red_deer', fox: 'fox', goat: 'mountain_goat', tortoise: 'snapping_turtle' },
    clips: ['hurt', 'flinch', 'windup', 'attack', 'die', 'dead', 'sink', 'charge'],
    dieMs: DIE_MS.slice(), sinkMs: SINK_MS.slice(),
    windupMs: { deer: 500, fox: 400, goat: 500, tortoise: 600 },   // = kinds.json windupSec
    attackMs: { deer: 300, fox: 200, goat: 300, tortoise: 300 },   // = kinds.json activeSec
    hitKey: { deer: 1, fox: 1, goat: 1, tortoise: 1 },             // = attack.events.hit
    hitMs: { deer: 100, fox: 50, goat: 100, tortoise: 100 },       // start of the hit key
    clipFor: {
      state: { wander: 'idle', notice: 'idle', chase: 'charge', windup: 'windup', charge: 'charge', attack: 'attack',
               recover: 'idle', stagger: 'flinch', flinch: 'flinch', hurt: 'hurt', dying: 'die', corpse: 'dead', sink: 'sink',
               flee: 'charge' },
      note: 'beastView today maps chase / charge -> charge, windup -> windup, stagger / flinch -> flinch, hurt / die / ' +
            'dead / sink by name, so those work as they are. `attack` is NOT requested yet: the melee active window ' +
            '(kinds.json activeSec, the CHARGE / BITE state of a kind brain) should show `attack` (hit on key 1) - ' +
            'programmer wiring. Fleeing deer / fox want `charge` (gallop / run) instead of idle.'
    }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { beastClipsFx: A.beastClipsFx };
})(typeof window !== 'undefined' ? window : globalThis);
