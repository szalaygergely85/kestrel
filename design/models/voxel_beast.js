/* design/models/voxel_beast.js - US-079a placeholder boar (architecture.md 29.1, AC 1).
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/rts_unit.js:
 *   <script src="../design/models/voxel_beast.js">     (browser, game/index.html)
 *   import '../../../design/models/voxel_beast.js';     (Node tests: side-effect import)
 * Sets ASSETS.models.boarPlaceholder directly (format: design/README.md section 4/7, architecture.md 15.1) using
 * only ALREADY-MERGED palette materials (leather, canvas_dark) - no palette.js/detail-pass.js merge step needed, so
 * the model is usable immediately on both ?renderer=dda and ?renderer=mesh.
 *
 * PLACEHOLDER (AC 1): a simple low quadruped silhouette, readable as "an animal" at 10 m / 240x90. Final art +
 * clips are a later story (US-079/US-041b) - this model has one "idle" clip (the rest pose, no motion) because
 * only FACING changes here (beastView.js writes transform.yawDeg; this model never plays a second clip).
 *
 * Axes (15.1): x = east, y = SOUTH with y0 = the model's FRONT row (faces north at yaw 0), z = up.
 * cellM 0.1, 5 x 10 x 7 voxels = 0.5 x 1.0 x 0.7 m (length 1.0 m, height 0.7 m - matches AC 1 "~1.0 m long, 0.7 m
 * tall"). One part (the whole body): the entity's own yawDeg (set by beastView.js from the sim's facing vector)
 * turns the model - no articulated legs/head at this fidelity.
 * Letters: B leather (hide), D canvas_dark (back ridge, ears, tail - a touch darker for a two-tone silhouette).
 * layers[z][y], z0 = feet, y0 = front (snout) row, y9 = rear (tail) row.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  var E = '.....';
  var LEGS_FRONT = 'B...B'; // z0-1, y1: front leg pair (silhouette only, not anatomically separate columns)
  var LEGS_BACK = 'B...B';  // z0-1, y8: back leg pair
  var SNOUT = '.BBB.';      // z1-3, y0: head/snout, held low like a boar's
  var TORSO = 'BBBBB';      // z2-3, y1..y8: full torso
  var TAIL = '..D..';       // z2-3, y9: short tail
  var BACK = 'BBBBB';       // z4, y1..y7: body top, tapered at the ends
  var EARS = '.D.D.';       // z5, y1: small ear nubs near the head
  var RIDGE = '.DDD.';      // z5, y2..y6: low back ridge/bristle hump
  var PEAK = '..D..';       // z6, y3..y4: ridge peak (top of the hump)

  var layers = [
    /* z0 */ [E, LEGS_FRONT, E, E, E, E, E, E, LEGS_BACK, E],
    /* z1 */ [SNOUT, LEGS_FRONT, E, E, E, E, E, E, LEGS_BACK, E],
    /* z2 */ [SNOUT, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TAIL],
    /* z3 */ [SNOUT, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TORSO, TAIL],
    /* z4 */ [E, BACK, BACK, BACK, BACK, BACK, BACK, BACK, E, E],
    /* z5 */ [E, EARS, RIDGE, RIDGE, RIDGE, RIDGE, RIDGE, E, E, E],
    /* z6 */ [E, E, E, PEAK, PEAK, E, E, E, E, E],
  ];

  A.models.boarPlaceholder = {
    name: 'boarPlaceholder',
    displayName: 'boar (placeholder)',
    desc: 'US-079a placeholder beast: a low two-tone quadruped silhouette (leather hide, a darker back ridge/ears/ ' +
          'tail), 1.0 m long, 0.7 m tall. Readable as an animal at 10 m / 240x90. Final art/clips come with US-079.',
    voxel: {
      version: 1,
      cellM: 0.1,
      size: [5, 10, 7],
      anchor: [2.5, 5, 0],
      mats: { B: 'leather', D: 'canvas_dark' },
      layers: layers,
      parts: {
        body: { box: [0, 0, 0, 5, 10, 7], pivot: [2.5, 5, 0] },
      },
      animations: {
        idle: { durations: [1000], loop: true, frames: [{}] },
      },
    },
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { boarPlaceholder: A.models.boarPlaceholder };
  }
})(typeof window !== 'undefined' ? window : globalThis);
