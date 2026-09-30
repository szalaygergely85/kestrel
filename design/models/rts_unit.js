/* design/models/rts_unit.js - RTS-01 (D-032) placeholder soldier, designer readability pass.
 *
 * Classic script (no import/export, check-deps rule 4). Loads both ways:
 *   <script src="../design/models/rts_unit.js">           (browser, optional)
 *   import '../../../design/models/rts_unit.js';           (side-effect import: game/js/rts/unitModel.js does this)
 * It only writes ASSETS.rtsModels.rtsUnit (a plain voxel ModelDef `{name, desc, voxel}`); it does NOT touch
 * ASSETS.models, so the game keeps registering the model itself (assets.add('model', 'rtsUnit', def)).
 *
 * Read at 58 deg down, ~30 m across, 400x150 (unit ~8 cells tall) and 240x90 (~5 cells):
 *   - top-down silhouette = a wide pauldron bar (full 1.0 m) + round helmet + a pale bedroll across the pack,
 *     so from above the unit is a team-coloured "plus" with a cream stripe at the back (facing reads at a glance).
 *   - team slot `team.a` on tabard, arms, pauldrons, legs, pack and helmet: 348 / 536 = 65 % of the non-bottom
 *     exposed faces, 70 / 87 = 80 % of the TOP faces (the ones the RTS camera sees most).
 *   - contrast accents only in thin bands: dark boots + leather belt ground it, skin band between pauldrons and
 *     helmet separates the head, wood spear with a steel tip on the right side (front = -y, like the waystone).
 * cellM 0.1, 10 x 8 x 16 (1.0 x 0.8 x 1.6 m, axis sum 34), 506 voxels, 2 parts (body, head).
 * Letters: T team.a (slot), I iron_dark (boots), W wood (belt, spear), H canvas (skin), L linen_light (bedroll),
 *          M iron_light (spear tip). layers[z][y][x], z0 = feet, y0 = front row.
 */
(function (root) {
  var A = root.ASSETS = root.ASSETS || {};
  A.rtsModels = A.rtsModels || {};

  var E = '..........';
  var BOOT = '..II..II..', LEG = '..TT..TT..', SPEAR = '.........W', TIP = '.........M';
  var BELT = '.WWWWWWWW.', TORSO = '.TTTTTTTT.', ARMS = 'TTTTTTTTTT', HANDS = 'HTTTTTTTTH', PACK = '..TTTTTT..';
  var HEAD = '...HHHH...', ROLL = '.LLLLLLLL.', RIM = '..TTTTTT..', DOME = '...TTTT...';
  var FIST = '.........H';
  //            y0     y1     y2     y3     y4     y5     y6     y7
  var layers = [
    /* z0  */ [E,     E,     BOOT,  BOOT,  BOOT,  E,     E,     E],
    /* z1  */ [E,     E,     BOOT,  BOOT,  BOOT,  E,     E,     E],
    /* z2  */ [E,     E,     LEG,   LEG,   LEG,   E,     E,     E],
    /* z3  */ [SPEAR, E,     LEG,   LEG,   LEG,   E,     E,     E],
    /* z4  */ [SPEAR, E,     LEG,   LEG,   LEG,   E,     E,     E],
    /* z5  */ [SPEAR, E,     BELT,  BELT,  BELT,  BELT,  E,     E],
    /* z6  */ [SPEAR, E,     HANDS, HANDS, HANDS, TORSO, E,     E],
    /* z7  */ [SPEAR, E,     ARMS,  ARMS,  ARMS,  TORSO, PACK,  PACK],
    /* z8  */ [SPEAR, FIST,  ARMS,  ARMS,  ARMS,  TORSO, PACK,  PACK],
    /* z9  */ [SPEAR, E,     ARMS,  ARMS,  ARMS,  TORSO, PACK,  PACK],
    /* z10 */ [SPEAR, E,     ARMS,  ARMS,  ARMS,  TORSO, PACK,  PACK],
    /* z11 */ [SPEAR, ARMS,  ARMS,  ARMS,  ARMS,  ARMS,  PACK,  PACK],   // pauldron bar, the widest top face
    /* z12 */ [SPEAR, E,     HEAD,  HEAD,  HEAD,  HEAD,  ROLL,  ROLL],   // skin band + bedroll on the pack
    /* z13 */ [SPEAR, E,     HEAD,  HEAD,  HEAD,  HEAD,  E,     E],
    /* z14 */ [TIP,   RIM,   RIM,   RIM,   RIM,   RIM,   RIM,   E],      // helmet brim overhangs the face
    /* z15 */ [TIP,   E,     DOME,  DOME,  DOME,  DOME,  E,     E]
  ];

  A.rtsModels.rtsUnit = {
    name: 'rtsUnit',
    desc: 'RTS-01 placeholder soldier (designer pass): pauldron bar + helmet + bedroll silhouette from above, ' +
          'team slot team.a on 65 % of the visible faces (80 % of the top faces).',
    voxel: {
      version: 1,
      cellM: 0.1,
      size: [10, 8, 16],
      anchor: [5, 3.5, 0],                      // feet centre
      mats: { T: 'team.a', I: 'iron_dark', W: 'wood', H: 'canvas', L: 'linen_light', M: 'iron_light' },
      layers: layers,
      parts: {
        body: { box: [0, 0, 0, 10, 8, 12], pivot: [5, 3.5, 0] },
        head: { box: [0, 0, 12, 10, 8, 16], pivot: [5, 3.5, 12], parent: 'body' }
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
