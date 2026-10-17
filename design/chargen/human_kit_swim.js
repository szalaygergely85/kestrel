/* design/chargen/human_kit_swim.js - player SWIM clips for the chargen human kit (PC-B designer 2026-10-13,
 *                                    owner-authorised; owner D-070 swimming + diving, architecture.md 38.54 SWIM-03c /
 *                                    SWIM-04). The player rig is the generated chargen rig: its clips live in
 *                                    design/chargen/human_kit.js buildClips() (idle, walk). These three use the SAME clip
 *                                    format (engine/chargen/clip.js: degrees R = Rz*Ry*Rx, keys sorted by t, duration a
 *                                    multiple of 50 ms, key t < duration, `pos` only on Hips, in cells of 0.025 m).
 *
 * Kept in a separate classic script on purpose: adding them to kit.clips would change the default glb export
 * (tools/export/gltfWrite.test.mjs golden SHA-256) and tools/chargen/rig.test.mjs (exactly 2 clips). So:
 *   <script src="../design/chargen/human_kit_swim.js">     (browser, after human_kit.js)
 *   import '../../design/chargen/human_kit_swim.js';       (Node: side-effect import)
 * sets ASSETS.chargenSwimClips = { kit, clips: { swim, tread, dive }, clipFor, speeds }.
 * REGISTRATION (programmer, SWIM-03c): merge them into the COMPOSED grid of the in-game player only, before the
 * 8-part collapse, e.g. Object.assign(grid.clips, ASSETS.chargenSwimClips.clips) right after composeCharacter() and
 * before collapseRig() (engine/chargen/compose.js copies kit.clips into grid.clips; collapse.js turns every grid clip
 * into part animations). Then the voxel model has animations swim / tread / dive next to idle / walk.
 *
 * Conventions (human_kit.js header): rx + = tilt forward for Hips / Spine / Chest / Neck / Head (rx - = head back);
 * arms and legs hang down: rx - = swing FORWARD (arm rx -180 = straight overhead), LowerLeg rx + = knee bend,
 * LowerArm rx - = elbow bend; Foot rx + = toes pointed. ry: right limbs ry - = out to the side, left limbs ry + = out.
 * Rz on Spine / Chest = twist about the body's long axis (the crawl roll). In game the 8-part collapse keeps only the
 * root bone of each limb part (UpperArm / UpperLeg) and composes Hips+Spine and Neck+Head; elbows / knees play in
 * the 22-bone glb only, so the strokes are readable from the upper arms alone.
 *
 * Clips:
 *   swim   loop 1.2 s  6 keys. Head-up front crawl at the surface: the body lies ~62 deg forward (Hips rx 62), the
 *                      hips are raised 0.3 m (pos z +12 cells) so the head stays over the water when the feet sit at
 *                      waterZ - 1.25 (38.54); alternating arm strokes (reach -> catch -> pull -> push -> elbow-up exit
 *                      -> recovery over the water, left half a cycle behind), the chest rolls +-12 toward the pulling
 *                      arm, 6-beat flutter kick with pointed toes, head lifted to look ahead. Tuned 1.8 m/s.
 *   tread  loop 1.6 s  4 keys. Upright, leaning 8 deg forward: forearms out front sculling in / out (upper-arm rz
 *                      sweeps), eggbeater legs (each thigh cycles forward and out with the knee bent, the two half a
 *                      cycle apart), a 1.25 cm bob per scull, the head looks around a little.
 *   dive   loop 1.4 s  7 keys. Under water, body horizontal (Hips rx 86): breaststroke pull-out - glide with the arms
 *                      overhead, out-sweep, in-sweep under the chest, arms tuck, frog kick (knees drawn up and out,
 *                      then a whip back together) while the arms shoot forward into the next glide. Head up 25 deg.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  // one key: t (ms), rot { bone: [rx,ry,rz] }, Hips pos [x,y,z] in cells
  function key(t, rot, hips) { return { t: t, rot: rot, pos: { Hips: hips || [0, 0, 0] } }; }
  function r1(v) { var r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; }

  // ---- swim (front crawl): 6 phases of the right arm; the left arm runs 3 phases behind (mirrored ry) ----
  var ARM_UP = [[-165, -8, 0], [-125, 0, 0], [-70, 4, 0], [10, -4, 0], [20, -70, 0], [-100, -65, 0]];   // right UpperArm
  var ARM_LO = [[-5, 0, 0], [-35, 0, 0], [-55, 0, 0], [-10, 0, 0], [-80, 0, 0], [-70, 0, 0]];           // LowerArm
  var ROLL = [4, 12, 8, -4, -12, -8];                                                                    // Chest rz
  function mirror(a) { return [a[0], -a[1], -a[2]]; }
  var swimKeys = [];
  for (var i = 0; i < 6; i++) {
    var j = (i + 3) % 6, even = (i % 2 === 0), bob = 0.6 * Math.sin(2 * Math.PI * i / 6);
    swimKeys.push(key(i * 200, {
      Hips: [62, 0, r1(-0.4 * ROLL[i])], Spine: [4, 0, r1(0.4 * ROLL[i])], Chest: [0, 0, ROLL[i]],
      Neck: [-15, 0, 0], Head: [-40, 0, r1(-0.5 * ROLL[i])],
      RightUpperArm: ARM_UP[i], RightLowerArm: ARM_LO[i], RightHand: [0, 0, 0],
      LeftUpperArm: mirror(ARM_UP[j]), LeftLowerArm: ARM_LO[j], LeftHand: [0, 0, 0],
      LeftUpperLeg: [even ? -2 : 18, 0, 0], LeftLowerLeg: [even ? 22 : 6, 0, 0], LeftFoot: [35, 0, 0],
      RightUpperLeg: [even ? 18 : -2, 0, 0], RightLowerLeg: [even ? 6 : 22, 0, 0], RightFoot: [35, 0, 0]
    }, [0, 4, r1(12 + bob)]));
  }

  // ---- tread: sculling arms (upper-arm rz sweep in / out), eggbeater legs half a cycle apart ----
  var SCULL = [14, 0, -14, 0], BOB = [0, 0.5, 0, 0.5];
  var THIGH = [[-45, 15, 0], [-25, 10, 0], [-10, 5, 0], [-30, 10, 0]], KNEE = [80, 50, 30, 70];
  var treadKeys = [];
  for (i = 0; i < 4; i++) {
    var o = (i + 2) % 4;
    treadKeys.push(key(i * 400, {
      Hips: [8, 0, 0], Spine: [0, 0, 0], Chest: [-3, 0, 0], Neck: [0, 0, 0], Head: [-6, 0, [0, 4, 0, -4][i]],
      RightUpperArm: [-25, -50, SCULL[i]], RightLowerArm: [-60, 0, 0], RightHand: [0, 0, -SCULL[i]],
      LeftUpperArm: [-25, 50, -SCULL[i]], LeftLowerArm: [-60, 0, 0], LeftHand: [0, 0, SCULL[i]],
      LeftUpperLeg: THIGH[i], LeftLowerLeg: [KNEE[i], 0, 0], LeftFoot: [-15, 0, 0],
      RightUpperLeg: mirror(THIGH[o]), RightLowerLeg: [KNEE[o], 0, 0], RightFoot: [-15, 0, 0]
    }, [0, 0, BOB[i]]));
  }

  // ---- dive: underwater breaststroke pull-out + frog kick. [t, armUp(right), armLo, thigh(left), knee, foot, head, surge] ----
  var DV = [
    [0,    [-172, -4, 0],  [0, 0, 0],    [4, 0, 0],    0,   40,  -25, 0],     // glide
    [200,  [-170, -6, 0],  [-2, 0, 0],   [4, 0, 0],    0,   40,  -25, -0.5],
    [400,  [-150, -38, 0], [-10, 0, 0],  [2, 0, 0],    5,   38,  -27, -1],    // out-sweep
    [600,  [-95, -45, 0],  [-75, 0, 0],  [-10, 10, 0], 40,  20,  -35, -1.5],  // in-sweep under the chest, knees start
    [800,  [-120, -10, 0], [-100, 0, 0], [-45, 22, 0], 110, -15, -30, -1],    // arms tuck, knees drawn up and out
    [1000, [-160, -6, 0],  [-20, 0, 0],  [-5, 32, 0],  25,  10,  -25, 0],     // frog kick, arms shoot forward
    [1200, [-172, -4, 0],  [0, 0, 0],    [4, 0, 0],    0,   40,  -25, 1]      // legs whip together, glide
  ];
  var diveKeys = DV.map(function (d) {
    return key(d[0], {
      Hips: [86, 0, 0], Spine: [2, 0, 0], Chest: [0, 0, 0], Neck: [-10, 0, 0], Head: [d[6], 0, 0],
      RightUpperArm: d[1], RightLowerArm: d[2], RightHand: [0, 0, 0],
      LeftUpperArm: mirror(d[1]), LeftLowerArm: d[2], LeftHand: [0, 0, 0],
      LeftUpperLeg: d[3], LeftLowerLeg: [d[4], 0, 0], LeftFoot: [d[5], 0, 0],
      RightUpperLeg: mirror(d[3]), RightLowerLeg: [d[4], 0, 0], RightFoot: [d[5], 0, 0]
    }, [0, r1(4 + d[7]), 4]);
  });

  A.chargenSwimClips = {
    version: 1,
    story: 'D-070 swimming + diving (SWIM-03c / SWIM-04d); PC-B designer 2026-10-13, owner-authorised',
    kit: 'kestrel.chargen.human',
    clips: {
      swim:  { duration: 1200, loop: true, keys: swimKeys },
      tread: { duration: 1600, loop: true, keys: treadKeys },
      dive:  { duration: 1400, loop: true, keys: diveKeys }
    },
    clipFor: { swimming: 'swim', treading: 'tread', diving: 'dive',
               note: 'swimming = moving at the surface, treading = at the surface with no stick input, diving = under ' +
                     'water (any speed). Replaces the SWIM-03c placeholder (idle).' },
    speeds: { swim: 1.8, dive: 1.2, note: 'm/s at playback rate 1; fast swim 2.6 m/s = rate ~1.45' }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = A.chargenSwimClips;
})(typeof window !== 'undefined' ? window : globalThis);
