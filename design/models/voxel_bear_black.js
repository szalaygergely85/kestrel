/* design/models/voxel_bear_black.js - the wild AMERICAN BLACK BEAR (designer, BEAR-D1, owner D-069 "black bears would
 *                                     be good"). A recolour / variant of Burl (design/models/voxel_bear.js, bear v2 +
 *                                     v1.53 body pass): SAME voxels, parts, pivots, rig and scale; only the coat changes.
 *                                     Binding rules: design/style-guide.md section 0 (realistic, all fours, nothing boxy).
 *
 * Classic script (no import/export, check-deps rule 4). LOAD ORDER: needs design/models/voxel_bear.js FIRST (it clones
 * ASSETS.models.bear), so the tag / import goes right after it:
 *   <script src="../design/models/voxel_bear_black.js">   (browser, after voxel_bear.js)
 *   import '../design/models/voxel_bear_black.js';        (Node, after the voxel_bear.js import)
 * Sets ASSETS.models.bearBlack and ASSETS.blackBearFx. `meshOnly: true`, cellM 0.05 (same size as Burl: 1.1 m at the
 * hump, 1.7 m nose to rump; a real black bear is not bigger than a brown bear, so no upscale is used).
 *
 * Coat (American black bear): near-black fur everywhere, glossy guard-hair tips on the hump / shoulders / upper flanks
 *   that catch the light (blue-grey once the fur_bear_* keys exist, see below), darkest dorsal ridge, legs and paws, a few
 *   dark-brown strands, a TAN / light-brown muzzle that also covers the chin and lower jaw, the dark face and forehead
 *   above it (no grizzled brow like Burl), a small pale crescent CHEST BLAZE low between the forelegs, dark-horn claws,
 *   warm amber-brown eyes (so they read against the black face), dark nose pad.
 *
 * Remap from Burl's letters (per cell, deterministic):
 *   head / neck 'b' (Burl's light face, y <= 9, z >= 10) -> 'B' (dark face); jaw-box 'b' (chin) -> 'M' (tan);
 *   body 'b' guard tips: 35 % stay 'b' (sheen clumps, 2 x 2 x 2 hash), the rest -> 'B'; new 'P' = chest blaze.
 *
 * Materials: TODAY only already-merged palette keys (no palette / detail-pass edit). Interim -> final:
 *   B fur_wolf_dark -> fur_bear        (#2c2d33)   base coat
 *   b fur_wolf      -> fur_bear_sheen  (#56606f)   glossy lit tips, blue-grey
 *   K/D/S hair_dark -> fur_bear_dark   (#17181c)   dorsal ridge, partings, legs, paws, belly shadow
 * The FINAL set switches on by itself as soon as palette.js AND detail-pass.js both define fur_bear, fur_bear_dark and
 * fur_bear_sheen (NEEDS MAIN, see docs/lanes/pc-b1.md BEAR-D1); nothing else to edit here.
 *
 * Clips: Burl's NON-dialogue clips only, unchanged: idle (5.7 s loop), walk (0.7 s loop, ~1.0 m/s), turn (0.6 s loop).
 *   talk / listen / laugh / wave are Burl's dialogue clips and are dropped (no black bear ever talks, D-069). The jaw part
 *   stays in the rig (rest 0) for the huff / bawl.
 * BEAR-D2 fight clips (ms, multiples of 50; ALL FOUR LEGS, owner: no rear-up, style-guide 0.2):
 *   charge  loop 0.4 s  6 keys: bounding lope (~6 m/s), ears pinned.
 *   windup  once 0.8 s  7 keys: bluff tell - head low, ears back, weight rocks back, right + left front-paw stomp with
 *                       a huff (keys 2, 4), last key coiled + held.
 *   swipe   once 0.6 s  6 keys: right front-paw swat from all fours, HIT key 2 (200..300 ms), follow-through, set down.
 *   hurt    once 0.1 s  2 step keys: recoil, head up, bawl.     flinch once 0.25 s: fade + head shake -> rest.
 *   die     once 0.5 s  5 keys: bawl, buckle, slump onto the right side, overshoot + leg kick (thud key 3), settle.
 *   dead    held        lying on the right side, legs out (body pos z from the voxel grid so nothing sinks).
 *   sink    once 0.5 s  [500, 100]: dead pose lowered 0.8 m into the ground (wolf format; beastView plays it after death).
 *   Presentation data for BEAR-01: ASSETS.blackBearFx (clipFor, telegraph, swipe, hurt, death).
 * ANIM-BLEND-02b (architecture.md 38.68):
 *   charge  = a clone of Burl's `run` (the generated gallop block now lives in voxel_bear.js); `run` = alias of charge.
 *   hurt, hitAdd  cloned from voxel_bear.js (hurt keys unchanged; hitAdd = additive, frame 0 = rest).
 *   attack  once 0.55 s 5 keys: LUNGE-BITE on all fours after the windup - launch, reach (jaws widest 100..200 ms), SNAP
 *                       (200 ms), head-shake tug, pull back. blackBearFx.bite. (`swipe` stays the paw attack.)
 *   recover once 0.4 s  3 keys: huff + head shake, ears up, settles to rest (OB-150 readable recover).
 *   blend   locomotion walk @ 1.0 -> charge @ 3.0 m/s, windup fade 150 ms (<= 25 % of 800), swipe / attack snap in 60 ms,
 *           out of swipe / attack >= 200 ms, additive `hit` on body / head / jaw / ears.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var SRC = A.models.bear;
  if (!SRC || !SRC.voxel) throw new Error('voxel_bear_black.js: load design/models/voxel_bear.js first (it clones ASSETS.models.bear)');
  var SV = SRC.voxel, SX = SV.size[0], SY = SV.size[1], SZ = SV.size[2];
  var SHEEN = 35;                                   // % of Burl's guard-tip cells kept as sheen 'b' (0 = flat black coat)

  function hsh(a, b, c) {                           // same deterministic hash as voxel_bear.js
    var h = Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 29, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) % 100;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- recoloured grid (layers[z][y] = row string over x) ----
  var G = SV.layers.map(function (rows) { return rows.map(function (r) { return r.split(''); }); });
  var x, y, z;
  for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
    var ch = G[z][y][x];
    if (ch !== 'b') continue;
    var inJaw = x >= 11 && x < 17 && y < 7 && z >= 8 && z < 10;
    if (inJaw) G[z][y][x] = 'M';                                   // tan chin / lower jaw
    else if (y <= 9 && z >= 10) G[z][y][x] = 'B';                  // dark face, forehead, neck
    else if (hsh(x >> 1, y >> 1, z >> 1) >= SHEEN) G[z][y][x] = 'B'; // fewer, glossier tips than Burl's grizzle
  }
  // chest blaze: a small pale crescent low on the chest between the forelegs (front slices y10-12, x12-15)
  function blaze(px, py, pz) { if (G[pz] && G[pz][py] && G[pz][py][px] && G[pz][py][px] !== '.') G[pz][py][px] = 'P'; }
  for (x = 12; x <= 15; x++) { blaze(x, 10, 10); blaze(x, 11, 10); }
  blaze(12, 10, 11); blaze(15, 10, 11);                          // crescent horns
  blaze(13, 12, 9); blaze(14, 12, 9); blaze(13, 11, 9); blaze(14, 11, 9);
  var layers = G.map(function (rows) { return rows.map(function (r) { return r.join(''); }); });

  // ---- materials (auto-switch to the final fur_bear_* set once both palette + detail-pass have it) ----
  var PM = A.palette && A.palette.materials, DM = A.detailPass && A.detailPass.materials;
  var FINAL = ['fur_bear', 'fur_bear_dark', 'fur_bear_sheen'].every(function (k) { return PM && PM[k] && DM && DM[k]; });
  var mats = {
    B: FINAL ? 'fur_bear' : 'fur_wolf_dark',        // base coat: near-black
    b: FINAL ? 'fur_bear_sheen' : 'fur_wolf',       // glossy guard-hair tips on the lit hump / shoulders / upper flanks
    K: FINAL ? 'fur_bear_dark' : 'hair_dark',       // dorsal ridge, saddle, partings, elbow / hock band, tail
    S: FINAL ? 'fur_bear_dark' : 'hair_dark',       // belly shadow, lower flanks, toe pads
    D: FINAL ? 'fur_bear_dark' : 'hair_dark',       // lower legs, paws, inner ears, lips
    F: 'hair_dark',                                 // a few dark-brown strands (black bears often show a brown cast)
    M: 'fur_roe_light',                             // tan / light-brown muzzle + chin
    P: 'fur_cream',                                 // chest blaze
    C: 'fur_wolf',                                  // claws: dark horn (not Burl's pale linen)
    N: 'iron_dark',                                 // nose pad
    E: 'brass_dark',                                // warm amber-brown eyes (read against the black face)
    R: 'gore_red_dark', T: 'gore_red', W: 'linen_light'   // mouth inside (only if the jaw ever opens)
  };

  var anim = {};
  // shared with Burl: idle / walk / turn + (ANIM-BLEND-02b) hurt (was authored here, same keys) and the additive hitAdd
  ['idle', 'walk', 'turn', 'hurt', 'hitAdd'].forEach(function (k) { anim[k] = clone(SV.animations[k]); });

  // ---- BEAR-D2 fight clips (same frame format as voxel_bear.js `pose`; ALL on four legs, style-guide 0.2: no rear-up) ----
  // o = { b: [rx, ry, rz, px, py, pz] body (rx + nose down, ry + roll top to the right, rz + turn right, py + = back),
  //       h head [rx (- = nose up), ry tilt, rz look], j jaw (0..28), e ears [rx], aL aR lL lR limb rot (rx - = forward,
  //       armR ry - = out to the right), lift { aL: cells }, free: true = limbs follow the body (no paw planting) }
  var JAW_MAX = 28, D2R = Math.PI / 180, PIV = SV.parts.body.pivot;
  function r2(v) { var r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; }
  function v3(a) { return a == null ? [0, 0, 0] : typeof a === 'number' ? [r2(a), 0, 0] : [r2(a[0] || 0), r2(a[1] || 0), r2(a[2] || 0)]; }
  function pose(o) {
    var b = o.b || [0, 0, 0, 0, 0, 0], L = o.lift || {}, k = o.free ? 0 : 1;
    function limb(n) { return { rot: v3(o[n]), pos: [r2(-k * (b[3] || 0)), r2(-k * (b[4] || 0)), r2(-k * (b[5] || 0) + (L[n] || 0))] }; }
    return {
      body: { rot: v3([b[0], b[1], b[2]]), pos: v3([b[3], b[4], b[5]]) },
      head: { rot: v3(o.h) }, jaw: { rot: [r2(Math.max(0, Math.min(JAW_MAX, o.j || 0))), 0, 0] }, ears: { rot: v3(o.e) },
      armL: limb('aL'), armR: limb('aR'), legL: limb('lL'), legR: limb('lR')
    };
  }
  function clip(keys, loop) {
    var d = [], f = [];
    for (var i = 0; i < keys.length; i++) { d.push(keys[i][0]); f.push(pose(keys[i][1])); }
    return { durations: d, loop: loop, frames: f };
  }
  // body pos z that keeps the lowest voxel on the ground for a roll ry = deg about the body pivot (rigid, rest limbs)
  var ROLL_MIN = {};
  function groundZ(deg) {
    if (ROLL_MIN[deg] !== undefined) return ROLL_MIN[deg];
    var s = Math.sin(deg * D2R), c = Math.cos(deg * D2R), m = 1e9, gx, gy, gz, cx, cz;
    for (gz = 0; gz < SZ; gz++) for (gy = 0; gy < SY; gy++) for (gx = 0; gx < SX; gx++) {
      if (layers[gz][gy].charAt(gx) === '.') continue;
      for (cx = 0; cx < 2; cx++) for (cz = 0; cz < 2; cz++) m = Math.min(m, -(gx + cx - PIV[0]) * s + (gz + cz - PIV[2]) * c);
    }
    return (ROLL_MIN[deg] = r2(-PIV[2] - m));
  }
  var EARS_BACK = [-26, 0, 0];
  var DEAD_O = { free: true, b: [0, 90, 0, 0, 0, groundZ(90)], h: [-4, 8, 0], j: 8, e: [-10, 0, 0],
                 aL: -24, aR: -14, lL: 26, lR: 16 };
  // charge (ANIM-B-01a): the knee-rig rotary gallop (tools/gen-gait.mjs, config bear.charge), 0.5 s loop, planted feet at
  // tunedMps 3.0 (legRig.gaits.charge). ANIM-BLEND-02b: the generated block moved to voxel_bear.js (Burl's `run`, ONE
  // source); charge is a clone of it, `run` an alias (legRig.gaits.run comes with the cloned rig).
  anim.charge = clone(SV.animations.run);
  anim.run = anim.charge;
  // windup 0.8 s: the black bear's bluff tell on ALL FOURS - head drops, ears pin, weight rocks back, right then left
  // front-paw stomp with a huff (jaw pop), last key = coiled, head low, weight back (held until the charge starts)
  anim.windup = clip([
    [100, { b: [1, 0, 0, 0, 0.8, -0.3], h: [10, 0, 0], e: [-15, 0, 0] }],
    [150, { b: [2, -2, 0, 0.3, 1.2, -0.5], h: [18, 0, 2], e: EARS_BACK, j: 4, aR: [-22, 0, 0], lift: { aR: 2.4 } }],  // paw up
    [100, { b: [4, 0, 0, 0, 0.6, -0.9], h: [22, 0, 0], e: EARS_BACK, j: 14, aR: -4 }],                             // STOMP + huff
    [100, { b: [3, 2, 0, -0.3, 1.2, -0.5], h: [18, 0, -2], e: EARS_BACK, j: 6, aL: [-20, 0, 0], lift: { aL: 2.2 } }],
    [150, { b: [4, 0, 0, 0, 0.6, -0.9], h: [23, 0, 0], e: EARS_BACK, j: 18, aL: -4 }],                             // STOMP + huff
    [100, { b: [3, 0, 0, 0, 1.6, -0.7], h: [20, 0, 0], e: [-28, 0, 0], j: 8, aL: 6, aR: 6, lL: -6, lR: -6 }],
    [100, { b: [3, 0, 0, 0, 1.9, -0.8], h: [21, 0, 0], e: [-28, 0, 0], j: 6, aL: 8, aR: 8, lL: -8, lR: -8 }]       // coiled
  ], false);
  // swipe 0.6 s: one RIGHT front-paw swat from all fours (no rear-up): weight onto the left, paw lifts out, swats across
  // (key 2 = hit, 200..300 ms), follow-through, paw sets down
  anim.swipe = clip([
    [100, { b: [0, -3, -3, -0.4, 0.8, -0.3], h: [6, 0, 4], e: EARS_BACK, j: 6, aR: [-10, 0, 0], lift: { aR: 1 } }],
    [100, { b: [-2, -4, -8, -0.5, 0.6, 0], h: [0, 0, -6], e: EARS_BACK, j: 12, aR: [-36, -26, 0], lift: { aR: 3.2 } }],
    [100, { b: [2, 3, 10, 0, -1.0, -0.2], h: [10, 0, 8], e: EARS_BACK, j: 24, aR: [-44, 16, 0], lift: { aR: 3 } }],  // HIT
    [100, { b: [4, 4, 12, 0, -1.2, -0.4], h: [14, 0, 10], e: EARS_BACK, j: 14, aR: [-14, 26, 0], lift: { aR: 1.5 } }],
    [150, { b: [1, 0, 3, 0, -0.4, 0], h: [8, 0, 2], e: [-12, 0, 0], j: 4, aR: [-4, 6, 0] }],                       // paw down
    [50,  { h: [4, 0, 0] }]
  ], false);
  // hurt 0.1 s (6 steps, step interp): cloned from voxel_bear.js above (same keys as the BEAR-D2 hurt: recoil, head up, bawl)
  // ANIM-BLEND-02b attack 0.55 s: the LUNGE-BITE on all fours (no rear-up, style-guide 0.2), played after the `windup`
  // bluff tell. Hind legs drive the trunk 8 cm forward and 3 deg nose-down (front paws lifted / hind lowered by the same
  // cells so all four stay on the ground), head comes up and out, jaws widest at key 1 (100..200 ms), SNAP shut at key 2
  // (200 ms), a head-shake tug (key 3), pull back (key 4, held = a near-rest stance the recover clip starts from).
  var PAW_FIX = function (s) { return { aL: s, aR: s, lL: -s, lR: -s }; };   // cells: front pivot 6.5 ahead of the body pivot, hind 6.5 behind
  anim.attack = clip([
    [100, { b: [1, 0, 0, 0, -0.6, -0.2], h: [-8, 0, 0], e: EARS_BACK, j: 14, aL: 3, aR: 3, lL: 5, lR: 5, lift: PAW_FIX(0.11) }],     // launch
    [100, { b: [3, 0, 0, 0, -1.6, -0.5], h: [-4, 0, 0], e: EARS_BACK, j: 28, aL: 6, aR: 6, lL: 8, lR: 8, lift: PAW_FIX(0.34) }],     // reach, jaws wide
    [100, { b: [3, 0, 0, 0, -1.6, -0.5], h: [8, 0, 0], e: EARS_BACK, j: 2, aL: 6, aR: 6, lL: 8, lR: 8, lift: PAW_FIX(0.34) }],       // SNAP
    [100, { b: [2, 3, -4, 0, -1.2, -0.4], h: [8, 6, -12], e: EARS_BACK, j: 4, aL: 4, aR: 4, lL: 6, lR: 6, lift: PAW_FIX(0.23) }],   // shake / tug
    [150, { b: [0, 0, 1, 0, -0.3, 0], h: [3, 0, 3], e: [-14, 0, 0], j: 2, aL: 1, aR: 1, lL: 1, lR: 1 }]                             // pull back
  ], false);
  // ANIM-BLEND-02b recover 0.4 s (OB-150 readable recover, after swipe / attack): a huff and a head shake, ears come up,
  // weight settles back onto all fours, ends on rest (held). The blend fades attack/swipe > recover over 200 ms.
  anim.recover = clip([
    [150, { b: [-1, 0, 0, 0, 0.6, 0.1], h: [-6, 0, 8], e: [-10, 0, 0], j: 8 }],
    [100, { b: [0, 0, 0, 0, 0.2, 0], h: [-3, 0, -6], e: [-4, 0, 0], j: 2 }],
    [150, {}]
  ], false);
  // flinch 0.25 s: recoil fades, a head shake, back to rest (also the shield-block stagger; the sim holds it 0.4 s)
  anim.flinch = clip([
    [50,  { b: [-3, 0, 0, 0, 1.2, 0.3], h: [-4, 0, 6], e: [-20, 0, 0], j: 8, aL: 3, aR: 3 }],
    [100, { b: [2, 0, 0, 0, 0.3, -0.2], h: [10, 0, -8], e: [-8, 0, 0], j: 4 }],
    [100, {}]
  ], false);
  // die 0.5 s (boar timeline): bawl, legs buckle + roll starts, slump onto the RIGHT side, overshoot + leg kick (thud,
  // key 3 at 300 ms), settle into the dead pose. Body pos z from groundZ so nothing sinks through the ground.
  anim.die = clip([
    [100, { b: [-6, 0, 0, 0, 1, 0.5], h: [-14, 0, 0], e: [-28, 0, 0], j: 24 }],
    [100, { free: true, b: [5, 18, 0, 0, 0, groundZ(18) - 1.5], h: [10, 0, 0], e: [-20, 0, 0], j: 10,
            aL: -14, aR: -10, lL: 14, lR: 10 }],
    [100, { free: true, b: [2, 60, 0, 0, 0, groundZ(60)], h: [4, 4, 0], e: [-14, 0, 0], j: 6, aL: -8, aR: -4, lL: 12, lR: 8 }],
    [100, { free: true, b: [0, 98, 0, 0, 0, groundZ(98)], h: [-6, 10, 0], e: [-10, 0, 0], j: 12,
            aL: -30, aR: -20, lL: 30, lR: 22 }],
    [100, DEAD_O]
  ], false);
  anim.dead = clip([[1000, DEAD_O]], true);
  // sink 0.5 s (wolf format [500, 100]: dead -> sunk, then held): the lying bear is ~1.1 m tall, so the body drops
  // SINK_M = 0.8 m on top of the sim's sinkM 0.3 m entity drop -> fully under the ground before the entity is hidden
  var SINK_M = 0.8, SUNK_O = clone(DEAD_O);
  SUNK_O.b = DEAD_O.b.slice(); SUNK_O.b[5] = r2(DEAD_O.b[5] - SINK_M / SV.cellM);
  anim.sink = clip([[500, DEAD_O], [100, SUNK_O]], false);

  var mounts = clone(SV.mounts);
  delete mounts.speech; delete mounts.interact;        // dialogue-only anchors
  // boar-path mounts (BEAR-D2, same names as boar / wolf, part body, grid coords at rest)
  mounts.forefeet = { at: [14, 13, 0.4], part: 'body' };   // dust origin between the forepaws (stomp / charge)
  mounts.hit = { at: [14, 20, 15], part: 'body' };         // flank centre (0.75 m)
  mounts.loot = { at: [8, 20, 15], part: 'body' };         // LEFT flank = the top of the corpse (dead pose rolls right)

  A.models.bearBlack = {
    name: 'bearBlack',
    displayName: 'black bear',
    desc: 'BEAR-D1 wild American black bear: Burl\'s bear v2 rig + voxels (1.1 m at the hump, 1.7 m nose to rump, all ' +
          'fours), recoloured: near-black coat with glossy lit guard-hair tips, darkest legs and dorsal ridge, tan muzzle ' +
          'and chin under a dark face, small pale chest blaze, dark claws, amber eyes. 12 parts (knee rig); clips idle, walk, turn ' +
          '(Burl) + BEAR-D2 fight clips on all fours: charge (lope), windup (bluff stomp + huff), swipe, hurt, flinch, ' +
          'die (slump to the right side), dead, sink; ANIM-BLEND-02b: run (= charge), attack (lunge-bite), recover, ' +
          'hitAdd (additive) + blend block.',
    voxel: {
      version: 1,
      meshOnly: true,
      cellM: SV.cellM,
      size: [SX, SY, SZ],
      anchor: SV.anchor.slice(),
      light: false,
      mats: mats,
      layers: layers,
      parts: clone(SV.parts),
      legRig: (function () { var r = clone(SV.legRig); r.gaits.charge = { tunedMps: 3, duty: 0.45, phase: [0, 0.1, 0.5, 0.6], liftM: 0.15 }; return r; })(),   // gaits.charge == tools/gait-configs.mjs bear.charge
      animations: anim,
      // ANIM-BLEND-02b (38.68; OB-150 readable wind-up / recover; same rules as wolf / boar / goblin). Set speeds = legRig
      // tunedMps (walk 1.0 amble, charge 3.0 gallop; `run` is only an alias, not in the set). windup (800 ms, last key
      // reached at 700 ms and held) fades in over 150 ms (<= 25 %); swipe / attack snap in (60 ms); leaving swipe / attack
      // for recover / idle / walk / charge takes 200 ms so the bear visibly settles; hit = additive on body/head/jaw/ears.
      blend: {
        sets: { locomotion: { param: 'speed', clips: [{ clip: 'walk', at: 1 }, { clip: 'charge', at: 3 }] } },
        fades: {
          default: 150,
          into: { windup: 150, swipe: 60, attack: 60, recover: 150, hurt: 50, flinch: 80 },
          pairs: { 'windup>charge': 80, 'windup>swipe': 60, 'windup>attack': 60, 'charge>swipe': 60, 'charge>attack': 60,
                   'swipe>recover': 200, 'swipe>idle': 200, 'swipe>walk': 200, 'swipe>charge': 200,
                   'attack>recover': 200, 'attack>idle': 200, 'attack>walk': 200, 'attack>charge': 200,
                   'recover>idle': 200, 'recover>walk': 200 }
        },
        additive: { hit: { clip: 'hitAdd', parts: ['body', 'head', 'jaw', 'ears'], inMs: 50, outMs: 200, gain: 1 } }
      },
      mounts: mounts           // eyes, mouth, pawR (grid coords, follow their part)
    }
  };

  A.blackBearFx = {
    version: 1,
    model: 'bearBlack',
    finalMats: FINAL,
    story: 'BEAR-D1 (model) + BEAR-D2 (fight clips) for BEAR-01 (brain)',
    clipFor: {
      state: { wander: 'idle', idle: 'idle', move: 'walk', turn: 'turn', return: 'walk', notice: 'idle',
               chase: 'charge', windup: 'windup', telegraph: 'windup', charge: 'charge', swipe: 'swipe', attack: 'swipe',
               bite: 'attack', lunge: 'attack', recover: 'recover', eat: 'eat', stagger: 'flinch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink', hitAdditive: 'hit',
      note: 'boar clip names (beastView STATE_CLIPS / beastAnim BEAST_ANIM_DEF) work unchanged; `swipe` is new (BEAR-01 ' +
            'plays it at the end of the charge when the player is in reach). sink: dead pose lowered 0.8 m in 0.5 s.'
    },
    speeds: { walk: 1.0, charge: 6.0, note: 'charge lope 0.4 s loop authored for ~6 m/s; scale the clip rate with speed. ' +
              'ANIM-BLEND-02b: the gallop is tuned (planted feet) at 3.0 m/s = blend.sets.locomotion; above that the leg ' +
              'driver stretches the stride' },
    // owner 2026-10-12 (style-guide 0.2): NO rear-up. The 0.8 s telegraph is the all-fours bluff tell.
    telegraph: { clip: 'windup', ms: 800, stompKeys: [2, 4], stompMs: [250, 450], backM: 0.1,
                 note: 'head low, ears pinned, weight back, right then left front-paw stomp with a huff; the last key is ' +
                       'held until the charge starts. forefeet mount = stomp dust origin. An arrow does NOT interrupt.' },
    swipe: { clip: 'swipe', ms: 600, hitKey: 2, hitMs: [200, 300], hearts: 2, paw: 'armR',
             note: 'right front paw, swat across from the right; deal damage inside hitMs; a shield block ends it in ' +
                   'flinch (stagger 0.4 s)' },
    // ANIM-BLEND-02b lunge-bite (clip `attack`, all fours): jaws widest 100..200 ms, snap at 200 ms; deal damage in hitMs
    bite: { clip: 'attack', ms: 550, snapKey: 2, snapMs: 200, hitMs: [100, 250], hearts: 2, lungeM: 0.08,
            note: 'follows the windup like swipe does; the sim may move the entity for a longer lunge. Ends near rest -> ' +
                  'recover (0.4 s huff + head shake) or straight back to charge / walk (200 ms fade)' },
    recover: { clip: 'recover', ms: 400, note: 'OB-150 readable recover after swipe / attack; last key = rest (held)' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 9,
            note: 'as wolfFx.hurt (no flash shell; engine tint). The flinch clip settles to rest in 250 ms (holds rest after)' },
    death: {
      note: 'same timeline as boarFx.death (hurt 6 steps -> die 24 -> thud at ~step 24 (die key 3) -> dead + lootable ' +
            'at 30)',
      thudKey: 3, thudMs: 300,
      corpseCentre: { rightM: 0.15, fwdM: 0, upM: 0.45, note: 'rolled onto the right side about the trunk; the lying ' +
                      'bear spans about -0.6 .. +0.5 m right, 0 .. 1.1 m up (entity frame)' },
      lootInteract: { prompt: '[E] Loot bear', radiusM: 1.8, aimUpM: 0.5 },
      sink: { clip: 'sink', steps: 30, depthM: 0.8, note: 'clip depth; the sim adds its own sinkM entity drop' }
    },
    notice: { noticeUpM: 1.4, note: 'clears the hump (1.1 m)' },
    missingClips: {}           // BEAR-D2: every clip BEAR-01 needs exists now
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { bearBlack: A.models.bearBlack, blackBearFx: A.blackBearFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
