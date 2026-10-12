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
 *   stays in the rig (rest 0) for a later roar / huff. The beast clips the BEAR-01 AI needs DO NOT EXIST YET and are NOT
 *   invented here (spec BEAR-D1): see ASSETS.blackBearFx.missingClips (also listed on design/preview/black-bear.html).
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
  ['idle', 'walk', 'turn'].forEach(function (k) { anim[k] = clone(SV.animations[k]); });
  var mounts = clone(SV.mounts);
  delete mounts.speech; delete mounts.interact;        // dialogue-only anchors

  A.models.bearBlack = {
    name: 'bearBlack',
    displayName: 'black bear',
    desc: 'BEAR-D1 wild American black bear: Burl\'s bear v2 rig + voxels (1.1 m at the hump, 1.7 m nose to rump, all ' +
          'fours), recoloured: near-black coat with glossy lit guard-hair tips, darkest legs and dorsal ridge, tan muzzle ' +
          'and chin under a dark face, small pale chest blaze, dark claws, amber eyes. 8 parts; clips idle, walk, turn.',
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
      animations: anim,
      mounts: mounts           // eyes, mouth, pawR (grid coords, follow their part)
    }
  };

  A.blackBearFx = {
    version: 1,
    model: 'bearBlack',
    finalMats: FINAL,
    clipFor: {
      state: { wander: 'idle', idle: 'idle', move: 'walk', turn: 'turn', return: 'walk' },
      note: 'only the clips that exist. Everything the boar-style beast view also asks for is in missingClips.'
    },
    // NOT invented (BEAR-D1 spec): needed by BEAR-01 (boar path: ASSETS.boarFx.clipFor / hurt / death). Owner question:
    // `rearUp` is an upright pose and style-guide 0.2 says nothing stands up -> the telegraph may need to be a low
    // head-down huff + front-paw stomp on all fours instead (a real black bear's bluff-charge tell). Ask before building.
    missingClips: {
      charge: 'gallop for chase / charge (boar: 4 x 50 ms bound)',
      windup: 'the 0.8 s telegraph (spec says rear-up; see the owner question above)',
      swipe: 'front-paw swipe, 2 hearts, hit frame marked',
      hurt: 'hit flash pose (boarFx.hurt.flashClip)',
      flinch: 'post-hit flinch / shield stagger (boarFx.hurt.flinchClip, state stagger)',
      die: 'tip over (boarFx.death timeline step 6)',
      dead: 'lying corpse, lootable (step 30)'
    }
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { bearBlack: A.models.bearBlack, blackBearFx: A.blackBearFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
