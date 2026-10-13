/* design/models/voxel_eat_clips.js - `eat` clips for the predators (PC-B designer 2026-10-13, owner-authorised;
 *                                    owner D-071 "predators hunt and eat prey"). Binding: design/style-guide.md section 0
 *                                    (all four legs, realistic). Head down at the kill, bite / chew, a TEAR (head yanks
 *                                    back and twists), more chewing, then a wary look up; loops.
 *
 * Classic script (no import/export, check-deps rule 4). LOAD ORDER: AFTER the model files it extends; each model is
 * optional (skipped when not loaded):
 *   design/models/voxel_wildlife.js (fox), design/models/voxel_wolf.js (wolf), design/models/voxel_bear.js (bear),
 *   design/models/voxel_bear_black.js (bearBlack, same rig as Burl)
 *   <script src="../design/models/voxel_eat_clips.js">     (browser, after the four above)
 *   import '../../../design/models/voxel_eat_clips.js';    (Node, after their imports)
 * It APPENDS animations.eat to ASSETS.models.fox / wolf / bear / bearBlack (appended LAST, so the existing clip indices
 * do not move) and sets ASSETS.eatFx. Kept in its own file so the model files and their exact-clip-set tests
 * (tools/voxel-wildlife.test.mjs, tools/voxel-bear.test.mjs, tools/voxel-bear-black.test.mjs) are untouched.
 *
 * Poses (same frame format and conventions as each model file):
 *   fox        loop 2.0 s 10 keys  body + legs = the fox's own `sniff` rest key (nose on the ground, limb-solved, feet
 *                                  planted); the fox has no jaw part, so chewing = quick head bites (rx 57..61) + small
 *                                  twists; tear at key 5; wary look up with ears forward at key 9.
 *   wolf       loop 2.0 s 10 keys  forelegs braced 20 deg forward, chest 5 cm lower, pitched 5 deg; paws solved onto the
 *                                  ground (lift); nose 0.18 m over the ground (on the carcass); jaw 0..16; tear key 5
 *                                  pulls 6 cm back; look up key 9.
 *   bear/      loop 2.4 s 10 keys  trunk pitched 6 deg nose down, 2.5 cm lower, paws re-planted (lift), nose 0.2 m over
 *   bearBlack                      the ground; jaw 1..14; tear keys 5-6 (head up + twist, trunk rocks back 5 cm); a
 *                                  wary look-around key 9 with ears up.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var D2R = Math.PI / 180;

  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }
  function rr(a) { return [r2(a[0]), r2(a[1]), r2(a[2])]; }
  function v3(a) {
    if (a === undefined || a === null) return [0, 0, 0];
    if (typeof a === 'number') return [a, 0, 0];
    return [a[0] || 0, a[1] || 0, a[2] || 0];
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // M(base, over): a copy of base with over's fields replacing it (no adding)
  function M(base, over) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in over || {}) o[k] = over[k]; return o; }
  var done = [];

  // =================================================================================================================
  // FOX (voxel_wildlife.js): body + legs from sniff key 0 (the solved nose-down stance), head / ears / tail per key
  // =================================================================================================================
  (function () {
    var F = A.models.fox;
    if (!F || !F.voxel || !F.voxel.animations.sniff) return;
    var REST = F.voxel.animations.sniff.frames[0];
    function fx(h, e, t) {
      var f = clone(REST);
      f.head = { rot: rr(h), pos: [0, 0, 0] };
      f.ears = { rot: rr(e || [10, 0, 0]), pos: [0, 0, 0] };
      f.tail = { rot: rr(t || [-6, 0, 0]), pos: [0, 0, 0] };
      return f;
    }
    var keys = [
      [300, fx([58, 0, 0])],
      [150, fx([61, 0, -4])],                         // bite
      [150, fx([57, 0, -2])],
      [150, fx([61, 0, 4])],
      [150, fx([57, 0, 2])],
      [250, fx([46, 8, -10], [4, 0, -6], [-2, 0, 4])], // TEAR: head yanks up-back and twists
      [200, fx([52, 0, -4])],
      [150, fx([60, 0, 0])],
      [150, fx([57, 0, 0])],
      [350, fx([30, 0, 10], [14, 0, 6], [2, 0, 0])]   // wary look up, ears forward
    ];
    F.voxel.animations.eat = { durations: keys.map(function (k) { return k[0]; }), loop: true, frames: keys.map(function (k) { return k[1]; }) };
    done.push('fox');
  })();

  // =================================================================================================================
  // WOLF (voxel_wolf.js pose: pitch re-centred on the chest, PIV_H 11; plant = legs cancel body pos; lift = leg pos z)
  // =================================================================================================================
  (function () {
    var Wf = A.models.wolf;
    if (!Wf || !Wf.voxel) return;
    var PIV_H = 11;
    function pose(o) {
      var b = o.b || [0, 0, 0, 0, 0, 0], a = b[0] * D2R, t = o.t || [0, 0, 0], L = o.lift || {};
      var py = b[4] + PIV_H * Math.sin(a), pz = b[5] + PIV_H * (1 - Math.cos(a)), pl = o.plant ? 1 : 0;
      function leg(ang, k) { return { rot: [ang || 0, 0, 0], pos: [0, r3(-pl * b[4]), r3(-pl * b[5] + (L[k] || 0))] }; }
      return {
        body:  { rot: [b[0], b[1], b[2]], pos: [r3(b[3]), r3(py), r3(pz)] },
        head:  { rot: [o.h || 0, o.hy || 0, o.hz || 0] },
        jaw:   { rot: [Math.max(0, Math.min(28, o.j || 0)), 0, 0] },
        legFL: leg(o.fl, 'fl'), legFR: leg(o.fr, 'fr'), legBL: leg(o.bl, 'bl'), legBR: leg(o.br, 'br'),
        tail:  { rot: [t[0] || 0, t[1] || 0, t[2] || 0] }
      };
    }
    // pitch 5 drops the elbow pivots 0.12 and lifts the stifles 0.93 voxels; forelegs at 20 deg world need 0.36 down
    var BASE = { b: [5, 0, 0, 0, 0, -1], plant: true, h: 70, j: 0, fl: -25, fr: -25, bl: -5, br: -5,
                 lift: { fl: -0.36, fr: -0.36, bl: -0.93, br: -0.93 }, t: [10, 0, 0] };
    var keys = [
      [300, BASE],
      [150, M(BASE, { h: 74, j: 14 })],                                   // bite
      [150, M(BASE, { h: 72, j: 2 })],
      [150, M(BASE, { h: 74, j: 16, hz: 4 })],
      [150, M(BASE, { h: 71, j: 3 })],
      [250, M(BASE, { b: [5, 0, 0, 0, 1.2, -1], h: 52, hy: 8, hz: -10, j: 10, t: [14, 0, 4] })],   // TEAR: pulls back
      [200, M(BASE, { h: 60, hz: -4, j: 4 })],
      [150, M(BASE, { h: 72, j: 12 })],
      [150, M(BASE, { h: 70, j: 0 })],
      [350, M(BASE, { h: 30, hz: 10, j: 2, t: [14, 0, 0] })]              // wary look up
    ];
    Wf.voxel.animations.eat = { durations: keys.map(function (k) { return k[0]; }), loop: true, frames: keys.map(function (k) { return pose(k[1]); }) };
    done.push('wolf');
  })();

  // =================================================================================================================
  // BEAR + BLACK BEAR (voxel_bear.js pose: limbs pos = -body.pos (+ lift); rx - = paw forward; jaw 0..28)
  // =================================================================================================================
  function bearPose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0], lift = o.lift || {};
    function limb(n) { return { rot: rr(v3(o[n])), pos: rr([-(b[3] || 0), -(b[4] || 0), -(b[5] || 0) + (lift[n] || 0)]) }; }
    return {
      body: { rot: rr([b[0] || 0, b[1] || 0, b[2] || 0]), pos: rr([b[3] || 0, b[4] || 0, b[5] || 0]) },
      head: { rot: rr(v3(o.h)) },
      jaw:  { rot: [r2(Math.max(0, Math.min(28, o.j || 0))), 0, 0] },
      ears: { rot: rr(v3(o.e)) },
      armL: limb('aL'), armR: limb('aR'), legL: limb('lL'), legR: limb('lR')
    };
  }
  // pitch 6 about the mid-trunk pivot drops the shoulders 0.70 and lifts the hips 0.66 voxels: lift re-plants the paws,
  // limb rx -6 keeps them vertical. Head 50 + body 6 = nose 0.2 m over the ground.
  var BEAR_BASE = { b: [6, 0, 0, 0, 0, -0.5], h: [50, 0, 0], j: 0, e: [-6, 0, 0], aL: -6, aR: -6, lL: -6, lR: -6,
                    lift: { aL: 0.7, aR: 0.7, lL: -0.66, lR: -0.66 } };
  var BEAR_KEYS = [
    [300, BEAR_BASE],
    [200, M(BEAR_BASE, { h: [54, 0, -3], j: 12 })],                                    // bite
    [200, M(BEAR_BASE, { h: [50, 0, -2], j: 2 })],
    [200, M(BEAR_BASE, { h: [54, 0, 2], j: 14 })],
    [200, M(BEAR_BASE, { h: [50, 0, 3], j: 3 })],
    [300, M(BEAR_BASE, { b: [6, 0, 0, 0, 1, -0.5], h: [40, 0, -10], j: 8 })],          // TEAR: head yanks up, trunk rocks back
    [200, M(BEAR_BASE, { b: [6, 0, 0, 0, 0.6, -0.5], h: [36, 6, -12], j: 4 })],        // twist
    [200, M(BEAR_BASE, { h: [48, 0, 0], j: 10 })],
    [200, M(BEAR_BASE, { h: [50, 0, 0], j: 1 })],
    [400, M(BEAR_BASE, { h: [30, 0, 8], j: 4, e: [4, 0, 0] })]                         // wary look-around, ears up
  ];
  ['bear', 'bearBlack'].forEach(function (id) {
    var Bm = A.models[id];
    if (!Bm || !Bm.voxel) return;
    Bm.voxel.animations.eat = { durations: BEAR_KEYS.map(function (k) { return k[0]; }), loop: true,
                                frames: BEAR_KEYS.map(function (k) { return bearPose(k[1]); }) };
    done.push(id);
  });

  // ===================================================================================================================
  // ASSETS.eatFx - presentation data for the D-071 predator brains (no game logic here)
  // ===================================================================================================================
  A.eatFx = {
    version: 1,
    story: 'D-071 predators eat prey (PC-B designer 2026-10-13, owner-authorised)',
    clip: 'eat',
    models: done.slice(),
    ms: { fox: 2000, wolf: 2000, bear: 2400, bearBlack: 2400 },
    tearKey: { fox: 5, wolf: 5, bear: 5, bearBlack: 5 },
    lookUpKey: { fox: 9, wolf: 9, bear: 9, bearBlack: 9 },
    stand: { fox: 'nose at the prey: stop with the nose mount ~0.05 m from the carcass', wolf: 'mouth mount over the carcass',
             bear: 'mouth mount over the carcass' },
    note: 'state eat -> clip eat (loop) while the predator stands at the kill. Map it in wildlifeFx / wolfFx / ' +
          'blackBearFx clipFor (the main session owns those files). Bite sound / blood fx on the bite keys (1, 3, 7).'
  };

  if (typeof module === 'object' && module && module.exports) module.exports = { eatFx: A.eatFx };
})(typeof window !== 'undefined' ? window : globalThis);
