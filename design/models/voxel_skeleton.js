/* design/models/voxel_skeleton.js - OB-191 risen skeletons: skeleton warrior + skeleton archer (content/beasts/kinds.json
 * skeleton_warrior / skeleton_archer). (PC-B designer 2026-10-15.) Rig, clip names, timing and file layout follow
 * design/models/voxel_goblin.js (architecture.md 38.57 "Model contract").
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as voxel_goblin.js:
 *   <script src="../design/models/voxel_skeleton.js">       (browser, after voxel_goblin.js)
 *   import '../design/models/voxel_skeleton.js';             (Node tests: side-effect import, after palette + detail-pass)
 * Sets ASSETS.models.skeleton (warrior), ASSETS.models.skeletonArcher and ASSETS.skeletonFx (state -> clip map, timings,
 * spawn hint, self-checks). `meshOnly` (16 parts max, > 8 parts).
 *
 * LOOK (style-guide 0: realistic, from voxels, nothing boxy): a human skeleton, 1.8 m to the crown, cellM 0.05.
 *   - Real proportions: hip joint 0.83 m, knee 0.45 m, shoulder 1.43 m; fingertips hang at mid-thigh. Thin 1-voxel
 *     long bones with 2-voxel joint knobs (condyles, kneecap, epicondyles, malleoli), two forearm and two shin bones
 *     with a gap between them, an open ribcage (4 rib rings with dark gaps, sternum, floating ribs), scapulae on the
 *     back, clavicles, a flared pelvis bowl, lumbar spine, cervical spine.
 *   - Skull: cranium wider at the back, deep dark eye sockets (no glow), a dark nasal opening, a teeth grin, jaw,
 *     a crack and a little grave moss on the crown.
 *   - Colour: bone-white (linen) with bleached tops (linen_light), yellowed grime (antler), grey dust (granite_light),
 *     dark joints / gaps (linen_dark), sockets hair_dark. Existing palette entries only (no palette.js change).
 *   - Gear: a rotten leather belt with a rusted buckle and a rag on both. WARRIOR: rusty short sword (0.75 m; pitted
 *     steel_old blade, iron edge, bronze-rust spots, leather grip) in the right fist, a broken round shield (timber_old
 *     planks, iron rim, rust boss, a jagged charred wedge missing at the top front) strapped to the left forearm.
 *     ARCHER: an old self bow (1.2 m, timber_old, horn nocks, leather grip, rope string) in the left fist, a rotten
 *     leather quiver on the back with three ragged arrows and a rope strap across the ribs, a nocked arrow while drawing.
 *
 * AXES (15.1): x = east (= the skeleton's RIGHT at yaw 0), y = SOUTH with low y = the FRONT (faces north), z = up.
 * Grid 24 x 28 x 40, anchor [12, 13, 0] = between the feet. Centre line x = 12 (cells 11 | 12); mirror x -> 23 - x.
 * Clip `pos` values are VOXELS.
 *
 * PARTS (insertion order = part index; parents EARLIER; the FIRST box that holds a voxel owns it - skeletonFx.selfCheck
 * lists any stolen voxel, must be empty; every box sx + sy + sz <= 48):
 *   body   pelvis, belt, rag, lumbar spine. ROOT, pivot [12, 14.5, 16.5] (hip joints). rx + = pitch forward,
 *          ry + = roll to the right, rz + = turn left (right hip back).
 *   chest  ribcage, sternum, thoracic spine, scapulae, clavicles (+ archer quiver + strap). pivot [12, 16.5, 22].
 *          rx + = hunch forward, rz + = right shoulder back.
 *   head   cervical spine + skull. pivot [12, 16.5, 30] (top of the thorax). rx + = chin down, rz + = look right.
 *   armL / armR   humerus. pivot [7.5 | 16.5, 15.5, 28.5] (shoulder). rx - = swing forward / raise; armL ry + / armR
 *          ry - = out to the side.
 *   foreL / foreR radius + ulna + hand (+ shield / sword / bow grip). pivot [7.5 | 16.5, 15.5, 21] (elbow).
 *          rx - = bend the elbow (forearm forward / up). Modelled hanging.
 *   legL / legR   femur + kneecap. pivot [10.5 | 13.5, 14.5, 16.5] (femoral head). rx - = foot forward.
 *   legL2 / legR2 tibia + fibula + foot (z < 9). pivot [9.5 | 14.5, 14.5, 9] (knee). rx + = knee bend.
 *   ARCHER ONLY (children of foreL, modelled with the bow HORIZONTAL along y in the hanging fist, string 3 voxels
 *   above the stave, so raising the arm forward stands the bow upright with the string toward the archer):
 *   strU / strD   the two string halves (x 5), pivots at the limb tips [5.5, 3 | 26, 16.5]: they rotate (rx) to meet
 *          at the nock and ride with the bent limb tips (pos).
 *   limbU / limbD the bow limbs, pivots at the grip ends [6.5, 12 | 17, 13.5]: rx bends them toward the string.
 *   arrow  the nocked arrow, a SECOND ROOT (no parent) stored above the skull (x 21, y 1..18, z 38): placed by forward
 *          kinematics on the string in the draw keys, else hidden 7 m under the ground (pos z -140, goblin javelin trick).
 *   Bow + arrow poses are SOLVED at load (aim search for the bow arm, limb bend for the string length, 3-angle IK for
 *   the drawing hand), so the nock, the string and the right fist always meet.
 *
 * CLIPS (ms, multiples of 10; ground contact is solved per key: standing keys put the lower sole on z 0, falling keys
 * the lowest bone, the pile rests EVERY bone on the ground):
 *   idle    loop 2.4 s  4 keys: hunched, slow sway, creaky head twitches.
 *   walk    loop 0.96 s 6 keys: stiff shamble, ~1.4 m/s at rate 1 (kinds.json walk 1.4).
 *   run     loop 0.6 s  6 keys: lean, pumping arms, flight keys; ~3.2 m/s at rate 1 (scale the rate for 4 m/s).
 *   alert   once 0.5 s  4 keys: head snaps up, settles into guard (warrior: sword forward, shield across the chest;
 *           archer: bow raised half way). Ends held.
 *   WARRIOR windup  once 0.5 s (= kinds windupSec) 3 keys: sword cocked high over the right shoulder, shield forward.
 *           attack  once 0.3 s (= activeSec) 4 keys: diagonal overhead slash with a lunge, events.hit = key 2 (120 ms).
 *   ARCHER  draw    once 0.7 s (= windupSec) 5 keys: hand to the quiver, nock, turn side-on, raise, full draw (held).
 *           shoot   once 0.3 s (= activeSec) 3 keys: release at key 0 (arrow hidden = the projectile spawns at the
 *           windup end), hand flies back past the jaw, follow-through, bow comes down.
 *           windup = draw, attack = shoot (aliases).
 *   hurt    once 0.1 s  2 step keys (goblin contract).   flinch once 0.25 s 3 keys.
 *   die     once 0.5 s  5 keys = beastView DIE_DURATIONS [90, 110, 120, 80, 100]: jolt, knees buckle, folds, the
 *           bones drop into a PILE (skull rolls off, thud key 3), settles.
 *   dead    held        the bone pile (= die key 4).
 *   sink    once 0.6 s  2 keys = SINK_DURATIONS [500, 100]: the pile lowered fully under the ground.
 *   rise    once 1.2 s  7 keys: from the pile the bones rattle, gather (skull back on the neck), sit up, kneel on the
 *           right knee, push up, stand hunched, head snaps up (= idle key 0).
 *   charge = run (alias for the unchanged generic beastView STATE_CLIPS; see skeletonFx.clipFor for the real map).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var CHECKS = [];

  var MATS = {
    W: 'linen_light',   // sun-bleached bone: crown, brow, shoulders, kneecaps, toe tips, teeth
    B: 'linen',         // bone body
    y: 'antler',        // yellowed / grimy bone, costal cartilage, horn bow nocks
    g: 'granite_light', // grey grave dust on bone
    d: 'linen_dark',    // dark joints, discs, gaps, mouth corners
    k: 'hair_dark',     // eye sockets, nasal opening
    m: 'moss_cap',      // a little grave moss
    I: 'iron_dark',     // shield rim, guard, boss plate, arrowheads
    i: 'iron_light',    // sword edge, arrow tip
    R: 'steel_old',     // pitted blade flat
    u: 'bronze',        // rust (tarnished brown): buckle, pommel, boss, rust patches
    w: 'timber_old',    // shield planks, bow stave, arrow shafts, quiver cap
    l: 'leather',       // belt, straps, grips, quiver
    p: 'rope',          // bowstring, quiver rim + strap, arrow binding
    C: 'canvas_burnt'   // rotten rags, rot holes, charred splinters, ragged fletching
  };

  var SX = 24, SY = 28, SZ = 40, MX = 23, KNEE_Z = 9, HIDE_Z = -140;
  var BASE = ['body', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'legL2', 'legR2'];
  var BOW = ['strU', 'strD', 'limbU', 'limbD', 'arrow'];
  var PIVOT = {
    body: [12, 14.5, 16.5], chest: [12, 16.5, 22], head: [12, 16.5, 30],
    armL: [7.5, 15.5, 28.5], armR: [16.5, 15.5, 28.5], foreL: [7.5, 15.5, 21], foreR: [16.5, 15.5, 21],
    legL: [10.5, 14.5, 16.5], legR: [13.5, 14.5, 16.5], legL2: [9.5, 14.5, 9], legR2: [14.5, 14.5, 9],
    strU: [5.5, 3, 16.5], strD: [5.5, 26, 16.5], limbU: [6.5, 12, 13.5], limbD: [6.5, 17, 13.5],
    arrow: [21.5, 19, 38.5]
  };
  var PARENT = { chest: 'body', head: 'chest', armL: 'chest', armR: 'chest', foreL: 'armL', foreR: 'armR',
                 legL: 'body', legR: 'body', legL2: 'legL', legR2: 'legR',
                 strU: 'foreL', strD: 'foreL', limbU: 'foreL', limbD: 'foreL' };
  var HAND = { warrior: { L: [6.5, 15.5, 12.5], R: [17.5, 15.5, 13.5] }, archer: { L: [6.5, 14.5, 13.5], R: [16.5, 15.5, 12.5] } };
  var NOCK_Y = 15, STR_Z = 16.5, STR_X = 5.5, STR_LEN = { U: 12, D: 11 };

  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }

  // =================================================================================================================
  // 1. GEOMETRY
  // =================================================================================================================
  function build(kind) {
    var archer = kind === 'archer', name = archer ? 'skeletonArcher' : 'skeleton';
    var order = archer ? BASE.concat(BOW) : BASE.slice();
    var g = [], own = [], x, y, z;
    for (z = 0; z < SZ; z++) {
      g.push([]); own.push([]);
      for (y = 0; y < SY; y++) {
        g[z].push([]); own[z].push([]);
        for (x = 0; x < SX; x++) { g[z][y].push('.'); own[z][y].push(null); }
      }
    }
    var cur = 'body', mir = false;
    function put(px, py, pz, ch) {
      if (mir) px = MX - px;
      if (px < 0 || px >= SX || py < 0 || py >= SY || pz < 0 || pz >= SZ) {
        CHECKS.push(name + ': voxel outside the grid at ' + [px, py, pz].join(',')); return;
      }
      g[pz][py][px] = ch; own[pz][py][px] = cur;
    }
    function del(px, py, pz) { g[pz][py][px] = '.'; own[pz][py][px] = null; }
    function sym(px, py, pz, ch) { put(px, py, pz, ch); put(MX - px, py, pz, ch); }

    // ---- legs (left coordinates; right = mirror). Foot z0-2, shin z3-8, knee z9, femur z10-16 ----
    function leg() {
      put(8, 10, 0, 'y'); put(9, 10, 0, 'W'); put(10, 10, 0, 'B');      // toes
      put(8, 11, 0, 'B'); put(9, 11, 0, 'B'); put(10, 11, 0, 'g');
      put(9, 12, 0, 'g'); put(9, 15, 0, 'g');                            // metatarsal heads, heel
      put(8, 12, 1, 'B'); put(9, 12, 1, 'W'); put(10, 12, 1, 'B');      // metatarsals rising to the arch
      put(9, 13, 1, 'B'); put(9, 15, 1, 'B');
      put(9, 13, 2, 'B'); put(9, 14, 2, 'W'); put(9, 15, 2, 'y');       // navicular, talus, heel top
      put(8, 14, 2, 'g'); put(10, 14, 2, 'B');                            // lateral + medial malleolus
      for (z = 3; z <= 7; z++) { put(9, 14, z, z === 5 ? 'W' : 'B'); put(8, 15, z, z === 7 ? 'B' : 'g'); } // tibia, fibula
      put(9, 14, 8, 'B'); put(10, 14, 8, 'B'); put(9, 15, 8, 'y');       // tibial plateau
      put(9, 14, 9, 'B'); put(10, 14, 9, 'g'); put(9, 15, 9, 'B'); put(10, 15, 9, 'y'); put(9, 13, 9, 'W'); // condyles, kneecap
      put(9, 13, 10, 'B'); put(9, 14, 10, 'B');
      for (z = 11; z <= 15; z++) put(9, 14, z, z === 13 ? 'W' : 'B');    // femur shaft
      put(9, 14, 16, 'B'); put(10, 14, 16, 'W'); put(8, 14, 16, 'B'); put(8, 15, 16, 'y'); // neck, head, trochanter
    }
    cur = 'legL'; leg();
    cur = 'legR'; mir = true; leg(); mir = false;

    // ---- body: pelvis z17-19, lumbar z20-21, belt + rag ----
    cur = 'body';
    sym(10, 14, 17, 'g'); sym(10, 13, 17, 'B'); sym(11, 13, 17, 'W'); sym(9, 15, 17, 'B'); sym(11, 16, 17, 'y'); // pubis, ischium, coccyx
    sym(8, 13, 18, 'W'); sym(8, 14, 18, 'B'); sym(9, 14, 18, 'B'); sym(10, 14, 18, 'B'); sym(9, 15, 18, 'y');   // ilium, acetabulum rim
    sym(11, 15, 18, 'y'); sym(11, 16, 18, 'B');                                                                 // sacrum
    sym(8, 13, 19, 'B'); sym(8, 14, 19, 'W'); sym(8, 15, 19, 'B'); sym(9, 16, 19, 'B');                      // iliac crest
    sym(11, 15, 19, 'B'); sym(11, 16, 19, 'B');
    sym(11, 15, 20, 'B'); sym(11, 16, 20, 'y'); sym(10, 15, 20, 'g');                                         // lumbar
    sym(11, 15, 21, 'd'); sym(11, 16, 21, 'B');
    // rotten leather belt slung on the hips (z18): front y12 with a rusted buckle, sides x8 / x15, back y17 with rot holes
    for (x = 9; x <= 14; x++) {
      put(x, 12, 18, x === 11 ? 'u' : (x === 12 ? 'I' : 'l'));
      put(x, 17, 18, (x === 10 || x === 13) ? 'C' : 'l');
    }
    for (y = 13; y <= 16; y++) { put(8, y, 18, 'l'); put(15, y, 18, 'l'); }
    put(10, 12, 17, 'C'); put(11, 12, 17, 'C'); put(13, 12, 17, 'C');                                           // rag

    // ---- chest: ribs z22-28 (rings on even z, gaps on odd z), clavicles z29 ----
    cur = 'chest';
    sym(9, 14, 22, 'B'); sym(9, 15, 22, 'B'); sym(10, 16, 22, 'g'); sym(11, 16, 22, 'B'); sym(11, 17, 22, 'y');  // floating ribs
    sym(11, 16, 23, 'd'); sym(11, 17, 23, 'B'); sym(11, 12, 23, 'y');                                           // gap, xiphoid
    sym(9, 13, 24, 'B'); sym(9, 14, 24, 'B'); sym(9, 15, 24, 'B'); sym(10, 12, 24, 'y'); sym(10, 16, 24, 'B');
    sym(11, 12, 24, 'B'); sym(11, 16, 24, 'B'); sym(11, 17, 24, 'y'); sym(9, 17, 24, 'y');                     // rib, scapula tip
    sym(11, 16, 25, 'd'); sym(11, 17, 25, 'B'); sym(11, 12, 25, 'B'); sym(8, 17, 25, 'g'); sym(9, 17, 25, 'B');
    sym(9, 13, 26, 'B'); sym(9, 14, 26, 'W'); sym(9, 15, 26, 'B'); sym(10, 12, 26, 'B'); sym(10, 16, 26, 'B');
    sym(11, 12, 26, 'W'); sym(11, 16, 26, 'B'); sym(11, 17, 26, 'y'); sym(8, 17, 26, 'B'); sym(9, 17, 26, 'B');
    sym(11, 16, 27, 'd'); sym(11, 17, 27, 'B'); sym(11, 12, 27, 'B'); sym(8, 17, 27, 'B'); sym(9, 17, 27, 'B');
    sym(10, 13, 28, 'B'); sym(10, 14, 28, 'W'); sym(10, 15, 28, 'B'); sym(11, 12, 28, 'W'); sym(11, 16, 28, 'B');
    sym(11, 17, 28, 'y'); sym(8, 17, 28, 'W'); sym(9, 17, 28, 'W'); sym(8, 16, 28, 'W');                       // manubrium, scapular spine, acromion
    sym(10, 12, 29, 'B'); sym(9, 13, 29, 'W'); sym(8, 14, 29, 'B'); sym(8, 15, 29, 'W');                      // clavicles
    sym(11, 16, 29, 'B'); sym(11, 17, 29, 'B');                                                               // T1
    put(8, 17, 26, 'm');                                                                                      // moss on the left scapula
    if (archer) {
      // rotten leather quiver on the back right (leaning out), rope rim, three ragged arrows, rope strap
      for (x = 12; x <= 13; x++) { put(x, 18, 20, 'w'); put(x, 19, 20, 'w'); }
      for (z = 21; z <= 23; z++) for (x = 12; x <= 13; x++) { put(x, 18, z, 'l'); put(x, 19, z, 'l'); }
      put(12, 19, 22, 'C');
      for (z = 24; z <= 26; z++) for (x = 13; x <= 14; x++) { put(x, 18, z, z === 26 ? 'p' : 'l'); put(x, 19, z, z === 26 ? 'p' : 'l'); }
      put(14, 18, 25, 'C');
      put(13, 18, 27, 'w'); put(13, 18, 28, 'C');
      put(14, 19, 27, 'w'); put(14, 19, 28, 'w'); put(14, 19, 29, 'C');
      put(14, 18, 27, 'C');
      put(9, 11, 22, 'p'); put(10, 11, 23, 'p'); put(11, 11, 24, 'p'); put(12, 11, 25, 'p'); put(13, 11, 26, 'p');
      put(14, 11, 27, 'p'); put(15, 12, 28, 'p'); put(15, 17, 28, 'p');
    }

    // ---- head: neck + jaw z30, teeth z31, skull z32-35 ----
    cur = 'head';
    sym(11, 16, 30, 'B'); sym(11, 11, 30, 'B'); sym(10, 12, 30, 'B'); sym(10, 13, 30, 'y');                   // neck, chin, jaw
    for (y = 11; y <= 15; y++) for (x = 10; x <= 13; x++) put(x, y, 31, y === 11 ? ((x === 10 || x === 13) ? 'd' : 'W') : 'B');
    sym(11, 16, 31, 'g');
    for (z = 32; z <= 34; z++) for (y = 11; y <= 15; y++) for (x = 10; x <= 13; x++) put(x, y, z, 'B');
    for (y = 12; y <= 15; y++) for (x = 10; x <= 13; x++) put(x, y, 35, 'W');                                  // crown
    for (z = 33; z <= 34; z++) { sym(9, 13, z, 'B'); sym(9, 14, z, 'y'); }                                   // parietal bulge
    sym(11, 16, 32, 'y'); sym(11, 16, 33, 'B');                                                               // occiput
    sym(11, 11, 32, 'k'); sym(11, 12, 32, 'd'); sym(10, 13, 32, 'g');                                         // nasal opening, temple
    sym(10, 11, 33, 'k'); sym(10, 12, 33, 'd');                                                               // deep eye sockets
    sym(10, 11, 34, 'W'); sym(11, 11, 34, 'W');                                                               // brow
    put(11, 13, 35, 'g'); put(12, 14, 35, 'm'); put(13, 15, 35, 'm');                                         // crack, moss

    // ---- arms ----
    function upperArm() {
      put(7, 15, 28, 'W'); put(7, 16, 28, 'B');                       // humeral head
      put(7, 14, 27, 'g'); put(7, 15, 27, 'B');                       // greater tubercle
      for (z = 22; z <= 26; z++) put(7, 15, z, z === 24 ? 'W' : 'B');
      put(7, 15, 21, 'B'); put(6, 15, 21, 'g'); put(7, 16, 21, 'y');  // epicondyles
    }
    function forearm() {
      for (z = 16; z <= 19; z++) { put(7, 14, z, z === 18 ? 'W' : 'B'); put(7, 16, z, z === 17 ? 'y' : 'B'); } // radius, ulna
      put(7, 15, 20, 'B'); put(7, 16, 20, 'W');                       // elbow, olecranon
      put(7, 15, 16, 'g');                                             // wrist
    }
    function handOpen() {
      put(7, 14, 15, 'B'); put(7, 15, 15, 'g'); put(7, 16, 15, 'B');  // carpals
      put(7, 14, 14, 'B'); put(7, 15, 14, 'W'); put(7, 16, 14, 'B');  // metacarpals
      put(7, 14, 13, 'B'); put(7, 14, 12, 'g'); put(7, 16, 13, 'B'); put(7, 16, 12, 'y'); put(7, 15, 12, 'B'); // bony fingers
      put(6, 14, 13, 'g');                                             // thumb
    }
    function bowHand() {
      put(7, 14, 15, 'B'); put(7, 15, 15, 'g'); put(7, 16, 15, 'B');
      put(7, 14, 14, 'B'); put(7, 15, 14, 'W'); put(7, 16, 14, 'B');
      put(6, 14, 14, 'B'); put(6, 16, 14, 'y');                        // fingers over the grip
      put(7, 14, 12, 'g'); put(7, 16, 12, 'B'); put(6, 15, 12, 'y');   // fingertips curled under it
      put(7, 13, 13, 'B');                                             // thumb
      for (y = 12; y <= 16; y++) put(6, y, 13, (y === 12 || y === 16) ? 'w' : 'l'); // riser + leather grip
    }
    function shield() {
      // round shield (r 5) in the y-z plane at x 4, centre (y 15, z 17); a jagged wedge broken off the top front
      var cy = 15, cz = 17, a, b, d2, broken;
      function isBroken(yy, zz) { return (zz >= 18 && yy <= 11) || (zz >= 19 && yy <= 12) || (zz >= 20 && yy <= 14) || (zz >= 21 && yy <= 15); }
      for (b = 12; b <= 21; b++) for (a = 10; a <= 19; a++) {
        d2 = (a + 0.5 - cy) * (a + 0.5 - cy) + (b + 0.5 - cz) * (b + 0.5 - cz);
        if (d2 > 25) continue;
        broken = isBroken(a, b);
        if (broken) continue;
        var nearBreak = isBroken(a - 1, b) || isBroken(a, b + 1) || isBroken(a - 1, b + 1);
        var ch = d2 > 16 ? ((a + b) % 5 === 0 ? 'u' : 'I') : (nearBreak ? 'C' : (a === 13 || a === 17 ? 'd' : 'w'));
        put(4, a, b, ch);
      }
      for (b = 15; b <= 18; b++) for (a = 13; a <= 16; a++) put(4, a, b, 'I');   // boss plate
      for (b = 16; b <= 17; b++) for (a = 14; a <= 15; a++) put(3, a, b, 'u');   // rusted boss
      put(5, 15, 16, 'l'); put(6, 15, 16, 'l'); put(5, 15, 19, 'l'); put(6, 15, 19, 'l'); // arm straps
    }
    function swordHand() {   // right hand, real coordinates: fist round a vertical grip (x 17, y 15), blade pointing down
      put(16, 14, 15, 'B'); put(16, 15, 15, 'g'); put(16, 16, 15, 'B');
      put(16, 14, 14, 'B'); put(16, 15, 14, 'W'); put(16, 16, 14, 'B');
      put(17, 14, 13, 'B'); put(17, 16, 13, 'B'); put(18, 15, 13, 'y');
      put(17, 14, 12, 'g'); put(17, 16, 12, 'g'); put(18, 15, 12, 'B');
      put(16, 14, 13, 'y');                                                       // thumb
      for (z = 12; z <= 14; z++) put(17, 15, z, 'l');                             // leather grip
      put(17, 15, 15, 'u');                                                       // rusted pommel
      put(17, 13, 11, 'I'); put(17, 14, 11, 'u'); put(17, 15, 11, 'I'); put(17, 16, 11, 'u'); put(17, 17, 11, 'I'); // guard
      for (z = 2; z <= 10; z++) {
        put(17, 15, z, (z === 4 || z === 8) ? 'u' : 'R');                         // pitted flat
        if (z !== 6) put(17, 16, z, z === 3 ? 'u' : 'i');                         // edge with a nick at z6
      }
      put(17, 15, 1, 'i');                                                        // tip
    }
    cur = 'armL'; upperArm();
    cur = 'armR'; mir = true; upperArm(); mir = false;
    cur = 'foreL'; forearm();
    if (archer) bowHand(); else { handOpen(); shield(); }
    cur = 'foreR'; mir = true; forearm(); if (archer) handOpen(); mir = false;
    if (!archer) swordHand();

    if (archer) {
      // ---- the bow: string halves (x 5, z 16), limbs (x 6) curving from the grip (z 13) up to the tips (z 16) ----
      cur = 'strU'; for (y = 3; y <= 14; y++) put(5, y, 16, 'p');
      cur = 'strD'; for (y = 15; y <= 25; y++) put(5, y, 16, 'p');
      var limb = function (sgn) {   // sgn -1: upper limb (y 11 -> 2), +1: lower limb (y 17 -> 26)
        var prev = 13, i, yy, zc, zz;
        for (i = 1; i <= 10; i++) {
          yy = sgn < 0 ? 12 - i : 16 + i;
          zc = 13 + Math.floor(i * i * 3 / 100);
          for (zz = Math.min(prev, zc); zz <= Math.max(prev, zc); zz++) put(6, yy, zz, i === 10 ? 'y' : (i === 1 ? 'p' : 'w'));
          prev = zc;
        }
        put(5, sgn < 0 ? 2 : 26, 16, 'y');   // horn nock
      };
      cur = 'limbU'; limb(-1);
      cur = 'limbD'; limb(1);
      // ---- the nocked arrow, stored above the skull: tip y1, barbed head, binding, shaft, ragged fletching, nock y18 ----
      cur = 'arrow';
      put(21, 1, 38, 'i'); put(21, 2, 38, 'I'); put(21, 3, 38, 'I'); put(20, 3, 38, 'I'); put(22, 3, 38, 'I');
      put(21, 4, 38, 'p');
      for (y = 5; y <= 17; y++) put(21, y, 38, 'w');
      for (y = 15; y <= 16; y++) { put(20, y, 38, 'C'); put(22, y, 38, 'C'); put(21, y, 39, 'C'); }
      put(21, 18, 38, 'd');
    }

    // knee split: the lower leg cells change owner only
    for (z = 0; z < KNEE_Z; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      if (own[z][y][x] === 'legL') own[z][y][x] = 'legL2'; else if (own[z][y][x] === 'legR') own[z][y][x] = 'legR2';
    }
    void del;

    // ---- parts: bounding boxes + claim check (15.1 rule 5: the FIRST part whose box holds a voxel owns it) ----
    var bb = {}, vox = {}, i, p;
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      p = own[z][y][x]; if (!p) continue;
      var B = bb[p] || (bb[p] = [x, y, z, x + 1, y + 1, z + 1]);
      if (x < B[0]) B[0] = x; if (y < B[1]) B[1] = y; if (z < B[2]) B[2] = z;
      if (x + 1 > B[3]) B[3] = x + 1; if (y + 1 > B[4]) B[4] = y + 1; if (z + 1 > B[5]) B[5] = z + 1;
      (vox[p] || (vox[p] = [])).push([x, y, z]);
    }
    var parts = {};
    for (i = 0; i < order.length; i++) {
      p = order[i];
      var box = bb[p];
      if (!box) { CHECKS.push(name + ': part ' + p + ' has no voxels'); continue; }
      if ((box[3] - box[0]) + (box[4] - box[1]) + (box[5] - box[2]) > 48) CHECKS.push(name + ': part ' + p + ' box over 48');
      parts[p] = { box: box, pivot: PIVOT[p].slice() };
      if (PARENT[p]) parts[p].parent = PARENT[p];
    }
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      p = own[z][y][x]; if (!p) continue;
      for (i = 0; i < order.length; i++) {
        var bx = bb[order[i]];
        if (bx && x >= bx[0] && x < bx[3] && y >= bx[1] && y < bx[4] && z >= bx[2] && z < bx[5]) break;
      }
      if (order[i] !== p) CHECKS.push(name + ': voxel ' + [x, y, z].join(',') + ' of ' + p + ' is claimed by ' + order[i]);
    }
    var layers = [];
    for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(g[z][y].join('')); layers.push(rows); }
    return { name: name, kind: kind, size: [SX, SY, SZ], layers: layers, parts: parts, order: order, vox: vox };
  }

  // =================================================================================================================
  // 2. FORWARD KINEMATICS (same Rz * Ry * Rx order and pivot / pos rule as engine computeVoxelPose)
  // =================================================================================================================
  function rotM(rx, ry, rz) {
    var a = rx * D2R, b = ry * D2R, c = rz * D2R;
    var cx = Math.cos(a), sx = Math.sin(a), cy = Math.cos(b), sy = Math.sin(b), cz = Math.cos(c), sz = Math.sin(c);
    var RyRx = [cy, sy * sx, sy * cx, 0, cx, -sx, -sy, cy * sx, cy * cx];
    return [cz * RyRx[0] - sz * RyRx[3], cz * RyRx[1] - sz * RyRx[4], cz * RyRx[2] - sz * RyRx[5],
            sz * RyRx[0] + cz * RyRx[3], sz * RyRx[1] + cz * RyRx[4], sz * RyRx[2] + cz * RyRx[5],
            RyRx[6], RyRx[7], RyRx[8]];
  }
  function mmul(P, Q) {
    var o = [0, 0, 0, 0, 0, 0, 0, 0, 0], i, j;
    for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) o[i * 3 + j] = P[i * 3] * Q[j] + P[i * 3 + 1] * Q[3 + j] + P[i * 3 + 2] * Q[6 + j];
    return o;
  }
  function tp(M) { return [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]; }
  function mv(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function tr(T, p) { var r = mv(T.R, p); return [r[0] + T.o[0], r[1] + T.o[1], r[2] + T.o[2]]; }
  function eulerOf(M) {   // M = Rz * Ry * Rx -> [rx, ry, rz] (deg)
    var s = Math.max(-1, Math.min(1, -M[6]));
    return [Math.atan2(M[7], M[8]) * R2D, Math.asin(s) * R2D, Math.atan2(M[3], M[0]) * R2D];
  }
  function partT(G, n, f, Tpar) {
    var st = f[n], r = st.rot, R = rotM(r[0], r[1], r[2]), c = G.parts[n].pivot, Rc = mv(R, c), t = st.pos;
    var lo = [c[0] - Rc[0] + t[0], c[1] - Rc[1] + t[1], c[2] - Rc[2] + t[2]];
    if (!Tpar) return { R: R, o: lo };
    var q = mv(Tpar.R, lo);
    return { R: mmul(Tpar.R, R), o: [q[0] + Tpar.o[0], q[1] + Tpar.o[1], q[2] + Tpar.o[2]] };
  }
  function fk(G, f) {
    var T = {}, i, n, par;
    for (i = 0; i < G.order.length; i++) { n = G.order[i]; par = G.parts[n].parent; T[n] = partT(G, n, f, par ? T[par] : null); }
    return T;
  }
  function extZ(G, T, names, wantMax) {   // lowest (or highest) z of the voxel corners of `names`
    var m = wantMax ? -1e9 : 1e9, i, j, n, R, base, v, z, list;
    for (i = 0; i < names.length; i++) {
      n = names[i]; R = T[n].R; list = G.vox[n] || [];
      base = T[n].o[2] + (wantMax ? Math.max(0, R[6]) + Math.max(0, R[7]) + Math.max(0, R[8]) : Math.min(0, R[6]) + Math.min(0, R[7]) + Math.min(0, R[8]));
      for (j = 0; j < list.length; j++) {
        v = list[j]; z = R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + base;
        if (wantMax ? z > m : z < m) m = z;
      }
    }
    return m;
  }
  function solidParts(G) { return G.order.filter(function (n) { return n !== 'arrow'; }); }

  // ---- small 3-angle search (coarse grid, then two refinements) ----
  function search3(cost, lo, hi, step) {
    var best = [lo[0], lo[1], lo[2]], bc = Infinity, a, b, c, v;
    for (a = lo[0]; a <= hi[0] + 1e-9; a += step) for (b = lo[1]; b <= hi[1] + 1e-9; b += step) for (c = lo[2]; c <= hi[2] + 1e-9; c += step) {
      v = cost(a, b, c); if (v < bc) { bc = v; best = [a, b, c]; }
    }
    return { p: best, c: bc };
  }
  function solve3(cost, lo, hi) {
    var r = search3(cost, lo, hi, 15), k, s, w, l2, h2;
    for (k = 0; k < 2; k++) {
      s = k === 0 ? 3 : 0.5; w = k === 0 ? 15 : 3;
      l2 = [0, 1, 2].map(function (i) { return Math.max(lo[i], r.p[i] - w); });
      h2 = [0, 1, 2].map(function (i) { return Math.min(hi[i], r.p[i] + w); });
      r = search3(cost, l2, h2, s);
    }
    return r;
  }

  // =================================================================================================================
  // 3. POSES
  // =================================================================================================================
  var REST = {
    warrior: { b: [0, 0, 0], t: [10, 0, 0], h: [-8, 0, 0], aL: [-6, 8, 0], fL: [-30, 0, 0], aR: [-8, -6, 0], fR: [-28, 0, 0],
               lL: [-4, 0, 0], kL: [8, 0, 0], lR: [-2, 0, 0], kR: [6, 0, 0] },
    archer:  { b: [0, 0, 0], t: [9, 0, 0], h: [-8, 0, 0], aL: [-4, 8, 0], fL: [-16, 0, 0], aR: [-6, -6, 0], fR: [-20, 0, 0],
               lL: [-4, 0, 0], kL: [8, 0, 0], lR: [-2, 0, 0], kR: [6, 0, 0] }
  };
  // shield guard: forearm relative to the chest, columns = local x -> +y, local y -> -z, local z -> -x
  // (the forearm points across the chest to the right, the shield face (local -x) points forward)
  var GUARD_C = [0, 0, -1, 1, 0, 0, 0, -1, 0];

  function solveAim(G, f, elevDeg) {   // bow arm: forearm points at the target (model -y, elevDeg up), bow upright
    var Tb = partT(G, 'body', f, null), Tc = partT(G, 'chest', f, Tb);
    var e = elevDeg * D2R, aim = [0, -Math.cos(e), Math.sin(e)];
    var Rf = rotM(f.foreL.rot[0], f.foreL.rot[1], f.foreL.rot[2]);
    var r = solve3(function (rx, ry, rz) {
      var Rt = mmul(mmul(Tc.R, rotM(rx, ry, rz)), Rf);
      var dot = -(Rt[2] * aim[0] + Rt[5] * aim[1] + Rt[8] * aim[2]);   // forearm axis = Rt * (0, 0, -1)
      return (1 - dot) * 100 + (1 + Rt[7]) * 20 + 1e-5 * (rx * rx + ry * ry + rz * rz); // bow axis Rt * (0, 1, 0) points down
    }, [-180, -90, -180], [40, 90, 180]);
    f.armL.rot = r.p.slice();
  }
  function solveIK(G, f, target, handR) {   // drawing arm: right fist on the target, elbow kept high
    var Tb = partT(G, 'body', f, null), Tc = partT(G, 'chest', f, Tb), sh = tr(Tc, G.parts.armR.pivot);
    function place(rx, ry, ex) {
      f.armR.rot = [rx, ry, 0]; f.foreR.rot = [ex, 0, 0];
      var Ta = partT(G, 'armR', f, Tc), Tf = partT(G, 'foreR', f, Ta);
      return { h: tr(Tf, handR), el: tr(Ta, G.parts.foreR.pivot) };
    }
    var r = solve3(function (rx, ry, ex) {
      var q = place(rx, ry, ex), dx = q.h[0] - target[0], dy = q.h[1] - target[1], dz = q.h[2] - target[2];
      var low = Math.max(0, sh[2] - 2 - q.el[2]);
      return dx * dx + dy * dy + dz * dz + 0.05 * low * low + 1e-5 * (rx * rx + ry * ry);
    }, [-180, -120, -160], [90, 60, 0]);
    var q = place(r.p[0], r.p[1], r.p[2]);
    return Math.hypot(q.h[0] - target[0], q.h[1] - target[1], q.h[2] - target[2]);
  }
  function bendBow(f, D) {   // string drawn D voxels back: limbs bend until each string half reaches the nock
    var N = [NOCK_Y, STR_Z + D];
    function tipAt(piv, tip, sgn, phi) {
      var a = sgn * phi * D2R, dy = tip[0] - piv[0], dz = tip[1] - piv[1];
      return [piv[0] + dy * Math.cos(a) - dz * Math.sin(a), piv[1] + dy * Math.sin(a) + dz * Math.cos(a)];
    }
    function solve(piv, tip, sgn, L) {
      function dist(phi) { var p = tipAt(piv, tip, sgn, phi); return Math.hypot(N[0] - p[0], N[1] - p[1]); }
      if (dist(0) <= L) return 0;
      var lo = 0, hi = 70, k, mid;
      for (k = 0; k < 40; k++) { mid = (lo + hi) / 2; if (dist(mid) > L) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    var pU = [PIVOT.limbU[1], PIVOT.limbU[2]], tU = [PIVOT.strU[1], PIVOT.strU[2]];
    var pD = [PIVOT.limbD[1], PIVOT.limbD[2]], tD = [PIVOT.strD[1], PIVOT.strD[2]];
    var phU = solve(pU, tU, -1, STR_LEN.U), phD = solve(pD, tD, 1, STR_LEN.D);
    var eU = tipAt(pU, tU, -1, phU), eD = tipAt(pD, tD, 1, phD);
    f.limbU.rot = [-phU, 0, 0]; f.limbD.rot = [phD, 0, 0];
    f.strU.pos = [0, eU[0] - tU[0], eU[1] - tU[1]];
    f.strD.pos = [0, eD[0] - tD[0], eD[1] - tD[1]];
    f.strU.rot = [Math.atan2(N[1] - eU[1], N[0] - eU[0]) * R2D, 0, 0];
    f.strD.rot = [Math.atan2(-(N[1] - eD[1]), -(N[0] - eD[0])) * R2D, 0, 0];
  }
  function placeArrow(G, f, D) {   // root part: nock end on the drawn string, pointing along the bow arm
    var T = fk(G, f), Tf = T.foreL, N = tr(Tf, [STR_X, NOCK_Y, STR_Z + D]), d = mv(Tf.R, [0, 0, -1]);
    var s = Math.max(-1, Math.min(1, -d[2]));
    f.arrow.rot = [Math.asin(s) * R2D, 0, Math.atan2(d[0], -d[1]) * R2D];
    f.arrow.pos = [N[0] - PIVOT.arrow[0], N[1] - PIVOT.arrow[1], N[2] - PIVOT.arrow[2]];
  }
  function dropPart(G, f, n, group) {   // rest part n (and its children) on the ground: lowest voxel of `group` -> z 0
    var T = fk(G, f), m = extZ(G, T, group, false), par = G.parts[n].parent;
    if (!par) { f[n].pos[2] -= m; return; }
    var Q = T[par].R;
    f[n].pos[0] -= m * Q[6]; f[n].pos[1] -= m * Q[7]; f[n].pos[2] -= m * Q[8];
  }
  function liftPart(G, f, n, dz) {      // move part n up by dz in model space (thud bounce)
    var T = fk(G, f), Q = T[G.parts[n].parent].R;
    f[n].pos[0] += dz * Q[6]; f[n].pos[1] += dz * Q[7]; f[n].pos[2] += dz * Q[8];
  }
  function rnd(f) {
    for (var n in f) { var s = f[n]; s.rot = s.rot.map(r3); s.pos = s.pos.map(r3); }
    return f;
  }
  function clone(f) { return JSON.parse(JSON.stringify(f)); }

  // o = { b, by, t, h, hp, aL, aR, fL, fR, lL, lR, kL, kR  (rot [rx, ry, rz] or a number = rx),
  //       guard: warrior shield across the chest, aim: archer bow-arm elevation (deg), D: draw (voxels), release,
  //       ikZ: drawing-hand target z in the bow frame, ground: 'feet' (default) | 'all' | 'pile', air, bounce }
  function mk(G, o) {
    var kind = G.kind, archer = kind === 'archer', R0 = REST[kind], f = {};
    function rv(v, d) { return v == null ? d.slice() : (typeof v === 'number' ? [v, 0, 0] : v.slice()); }
    function Z() { return [0, 0, 0]; }
    f.body = { rot: rv(o.b, R0.b), pos: [0, o.by || 0, 0] };
    f.chest = { rot: rv(o.t, R0.t), pos: Z() };
    f.head = { rot: rv(o.h, R0.h), pos: o.hp ? o.hp.slice() : Z() };
    f.armL = { rot: rv(o.aL, R0.aL), pos: Z() };
    f.armR = { rot: rv(o.aR, R0.aR), pos: Z() };
    f.foreL = { rot: rv(o.fL, R0.fL), pos: Z() };
    f.foreR = { rot: rv(o.fR, R0.fR), pos: Z() };
    f.legL = { rot: rv(o.lL, R0.lL), pos: Z() };
    f.legR = { rot: rv(o.lR, R0.lR), pos: Z() };
    f.legL2 = { rot: rv(o.kL, R0.kL), pos: Z() };
    f.legR2 = { rot: rv(o.kR, R0.kR), pos: Z() };
    if (archer) {
      f.strU = { rot: Z(), pos: Z() }; f.strD = { rot: Z(), pos: Z() };
      f.limbU = { rot: Z(), pos: Z() }; f.limbD = { rot: Z(), pos: Z() };
      f.arrow = { rot: Z(), pos: [0, 0, HIDE_Z] };
    }
    if (o.guard && !archer) f.foreL.rot = eulerOf(mmul(tp(rotM(f.armL.rot[0], f.armL.rot[1], f.armL.rot[2])), GUARD_C));
    var D = o.D;
    if (archer && o.aim != null) solveAim(G, f, o.aim);
    if (archer && D != null) {
      if (!o.release) bendBow(f, D);
      var Tb = partT(G, 'body', f, null), Tc = partT(G, 'chest', f, Tb), Ta = partT(G, 'armL', f, Tc), Tf = partT(G, 'foreL', f, Ta);
      var target = tr(Tf, [STR_X, NOCK_Y, o.ikZ != null ? o.ikZ : STR_Z + D + 0.5]);
      var res = solveIK(G, f, target, HAND.archer.R);
      if (res > 3) CHECKS.push(G.name + ': drawing hand misses its target by ' + res.toFixed(2) + ' voxels (D ' + D + ')');
    }
    if (o.lay) for (var ln in o.lay) {   // pile: a forearm (+ shield / sword / bow) laid flat in MODEL space
      var Q0 = fk(G, f)[G.parts[ln].parent].R, L = o.lay[ln];
      f[ln].rot = eulerOf(mmul(tp(Q0), rotM(L[0], L[1], L[2])));
    }
    var T = fk(G, f), gm = o.ground || 'feet';
    if (gm === 'feet') f.body.pos[2] -= extZ(G, T, ['legL2', 'legR2'], false);
    else if (gm === 'all') f.body.pos[2] -= extZ(G, T, solidParts(G), false);
    else if (gm === 'pile') {
      f.body.pos[2] -= extZ(G, T, ['body'], false);
      var seq = ['chest', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'legL2', 'legR', 'legR2'], i;
      for (i = 0; i < seq.length; i++) {
        dropPart(G, f, seq[i], (seq[i] === 'foreL' && archer) ? ['foreL', 'strU', 'strD', 'limbU', 'limbD'] : [seq[i]]);
      }
      if (o.bounce) liftPart(G, f, 'head', o.bounce);
    }
    if (o.air) f.body.pos[2] += o.air;
    if (archer && D != null && !o.release) placeArrow(G, f, D);
    return rnd(f);
  }
  function ext(base, extra) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in extra) o[k] = extra[k]; return o; }

  // =================================================================================================================
  // 4. CLIPS
  // =================================================================================================================
  function clips(G) {
    var archer = G.kind === 'archer', i, j, s;
    function P(o) { return mk(G, o); }

    var rest = P({});
    var idle = [rest,
      P({ b: [0, 1, 0], t: [12, 0, 4], h: [-4, 6, 10] }),
      P({ t: [9, 0, -3], h: [-14, -6, -20] }),
      P({ t: [11, -2, 2], h: [-6, 0, 6], aR: archer ? [-8, -8, 0] : [-12, -6, 0], fR: archer ? [-24, 0, 0] : [-34, 0, 0] })];

    // walk 0.96 s: stiff shamble; L thigh forward at key 0
    var WTH = [-24, -12, 10, 24, 12, -12], WKN = [6, 16, 8, 28, 55, 40];
    var walk = [], run = [];
    for (i = 0; i < 6; i++) {
      j = (i + 3) % 6; s = Math.cos(i * Math.PI / 3);
      walk.push(P({ b: [0, -2 * s, 4 * s], t: [12, 0, -6 * s], h: [-8, 0, 3 * s],
                    lL: WTH[i], kL: WKN[i], lR: WTH[j], kR: WKN[j],
                    aL: archer ? [-4 + 8 * s, 8, 0] : [-6 + 5 * s, 8, 0], fL: archer ? [-18, 0, 0] : [-40, 0, 0],
                    aR: [-8 - 12 * s, -6, 0], fR: archer ? [-24, 0, 0] : [-34, 0, 0] }));
    }
    // run 0.6 s: lean, pumping arms, flight after each toe-off
    var RTH = [-40, -22, 8, 30, 10, -28], RKN = [14, 30, 22, 50, 105, 75], AIR = [0, 0, 1.2, 0, 0, 1.2];
    for (i = 0; i < 6; i++) {
      j = (i + 3) % 6; s = Math.cos(i * Math.PI / 3);
      run.push(P({ b: [6, 0, 6 * s], t: [22, 0, -10 * s], h: [-20, 0, 5 * s],
                   lL: RTH[i], kL: RKN[i], lR: RTH[j], kR: RKN[j], air: AIR[i],
                   aL: [-10 + 30 * s, 10, 0], fL: archer ? [-50, 0, 0] : [-70, 0, 0],
                   aR: [-10 - 35 * s, -10, 0], fR: archer ? [-85, 0, 0] : [-80, 0, 0] }));
    }

    var GUARD = { t: [14, 0, 6], h: [-2, 0, -6], aR: [-30, -8, 0], fR: [-62, 0, 0], aL: [-55, 25, 0], guard: true,
                  lL: [-16, 0, 0], kL: [16, 0, 0], lR: [8, 0, 0], kR: [18, 0, 0] };
    var READY = { t: [12, 0, 10], h: [-4, 0, -8], aL: [-40, 16, 0], fL: [-42, 0, 0], aR: [-50, -14, 0], fR: [-70, 0, 0],
                  lL: [-12, 0, 0], kL: [14, 0, 0], lR: [6, 0, 0], kR: [16, 0, 0] };
    var alert = [
      P({ by: 0.5, t: [2, 0, 0], h: [-28, 0, 0], aL: [-20, 20, 0], aR: [-20, -20, 0] }),
      P({ t: [16, 0, 4], h: [4, 0, -4], lL: -10, kL: 18, lR: -4, kR: 16 }),
      archer ? P(ext(READY, { aL: [-30, 14, 0], fL: [-34, 0, 0], aR: [-36, -12, 0], fR: [-56, 0, 0] }))
             : P(ext(GUARD, { aR: [-24, -8, 0], fR: [-50, 0, 0], aL: [-40, 22, 0], t: [14, 0, 4], h: [-4, 0, -4] })),
      P(archer ? READY : GUARD)
    ];

    // death: jolt, buckle, fold, drop into a bone pile (thud bounce), settle
    var PILE = { b: [-20, 0, 8], by: 1, t: [72, 14, 22], h: [55, 35, 70], hp: [-3, -5, 0], aL: [-35, 70, 0], fL: [-60, 0, 0],
                 aR: [-15, -75, 0], fR: [-50, 0, 0], lL: [-78, 32, 0], kL: [150, 0, 10], lR: [-72, -30, 0], kR: [150, 0, -10],
                 lay: { foreL: [0, 88, 24], foreR: [0, -88, -34] }, ground: 'pile' };
    var dead = P(PILE);
    var die = [
      P({ by: 1, t: [-14, 0, 8], h: [-40, 0, 18], aL: [-50, 40, 0], aR: [-50, -40, 0], fL: -10, fR: -10, kL: 10, kR: 10 }),
      P({ t: [20, 8, 4], h: [20, 10, 14], aL: [-15, 20, 0], aR: [-20, -25, 0], lL: [-55, 10, 0], kL: [95, 0, 0],
          lR: [-50, -10, 0], kR: [90, 0, 0], ground: 'all' }),
      P({ b: [-10, 0, 6], t: [50, 12, 14], h: [40, 20, 30], aL: [-30, 50, 0], fL: -20, aR: [-20, -60, 0], fR: -40,
          lL: [-80, 25, 0], kL: [110, 0, 0], lR: [-75, -25, 0], kR: [100, 0, 0], ground: 'all' }),
      P(ext(PILE, { t: [64, 12, 18], h: [48, 30, 60], aL: [-40, 62, 0], aR: [-20, -68, 0], bounce: 1.5 })),
      dead
    ];
    var sunk = clone(dead), top = extZ(G, fk(G, sunk), solidParts(G), true);
    sunk.body.pos[2] = r3(sunk.body.pos[2] - top - 2);

    // rise: rattle in the pile, gather, sit up, kneel on the right knee, push up, stand hunched, head snaps up
    var rise = [
      clone(dead),
      P(ext(PILE, { t: [68, 10, 18], h: [60, 30, 64], aL: [-40, 64, 0], fL: [-54, 0, 0], aR: [-20, -70, 0], fR: [-44, 0, 0] })),
      P({ b: [12, 0, 0], t: [52, 0, 0], h: [28, 0, 6], aL: [-62, 12, 0], fL: [-20, 0, 0], aR: [-58, -12, 0], fR: [-24, 0, 0],
          lL: [-92, 12, 0], kL: [120, 0, 0], lR: [-88, -12, 0], kR: [118, 0, 0], ground: 'all' }),
      P({ b: [6, 0, 0], t: [36, 0, 0], h: [16, 0, 0], aL: [-36, 6, 0], fL: [-46, 0, 0], aR: [-22, -6, 0], fR: [-12, 0, 0],
          lL: [-86, 0, 0], kL: [86, 0, 0], lR: [-2, 0, 0], kR: [92, 0, 0], ground: 'all' }),
      P({ b: [4, 0, 0], t: [26, 0, 0], h: [14, 0, 0], aL: [-24, 8, 0], fL: [-40, 0, 0], aR: [-14, -8, 0], fR: [-60, 0, 0],
          lL: [-52, 0, 0], kL: [64, 0, 0], lR: [-14, 0, 0], kR: [52, 0, 0] }),
      P({ t: [20, 0, 0], h: [26, 0, 0], fR: [-50, 0, 0], lL: [-12, 0, 0], kL: [18, 0, 0], lR: [-6, 0, 0], kR: [12, 0, 0] }),
      clone(rest)
    ];

    var hurt = [
      P({ by: 1.5, t: [-8, 0, 6], h: [-34, 0, 14], aL: [-35, 30, 0], aR: [-35, -30, 0], lL: 6, kL: 14, lR: 8, kR: 14 }),
      P({ by: 1, t: [0, 0, 3], h: [-24, 0, 8], aL: [-24, 20, 0], aR: [-24, -20, 0], lL: 4, kL: 10, lR: 6, kR: 10 })
    ];
    var flinch = [
      P({ by: 0.6, t: [4, 0, 4], h: [-20, 0, -10], aL: [-18, 14, 0], aR: [-18, -14, 0], kL: 12, kR: 12 }),
      P({ t: [14, 0, 0], h: [-4, 0, 4] }),
      clone(rest)
    ];

    var anims = {
      idle:   { durations: [700, 500, 600, 600], loop: true, frames: idle },
      walk:   { durations: [160, 160, 160, 160, 160, 160], loop: true, frames: walk },
      run:    { durations: [100, 100, 100, 100, 100, 100], loop: true, frames: run },
      alert:  { durations: [80, 120, 140, 160], loop: false, frames: alert }
    };
    if (!archer) {
      var wind = [
        P(ext(GUARD, { aR: [-90, -20, 0], fR: [-70, 0, 0], t: [10, 0, 12] })),
        P(ext(GUARD, { aR: [-150, -25, 0], fR: [-75, 0, 0], t: [4, 0, 22], h: [-4, 0, -18], lL: [-20, 0, 0], kL: [14, 0, 0], lR: [10, 0, 0], kR: [16, 0, 0] })),
        P(ext(GUARD, { by: 0.5, aR: [-165, -25, 0], fR: [-80, 0, 0], t: [0, 0, 28], h: [-2, 0, -22], lL: [-20, 0, 0], kL: [14, 0, 0], lR: [10, 0, 0], kR: [16, 0, 0] }))
      ];
      var slash = [
        P(ext(GUARD, { aR: [-150, -15, 0], fR: [-50, 0, 0], t: [10, 0, 18], h: [-4, 0, -12], lL: [-22, 0, 0], kL: [16, 0, 0], lR: [10, 0, 0], kR: [16, 0, 0] })),
        P(ext(GUARD, { by: -0.8, aR: [-105, -5, 0], fR: [-30, 0, 0], t: [22, 0, 0], h: [-12, 0, 0], lL: [-26, 0, 0], kL: [20, 0, 0], lR: [12, 0, 0], kR: [18, 0, 0] })),
        P(ext(GUARD, { by: -1.6, aR: [-55, 10, 0], fR: [-20, 0, 0], t: [32, 0, -20], h: [-20, 0, 14], lL: [-30, 0, 0], kL: [26, 0, 0], lR: [16, 0, 0], kR: [20, 0, 0] })),
        P(ext(GUARD, { by: -1.8, aR: [-25, 15, 0], fR: [-15, 0, 0], t: [36, 0, -28], h: [-24, 0, 18], lL: [-30, 0, 0], kL: [26, 0, 0], lR: [16, 0, 0], kR: [20, 0, 0] }))
      ];
      anims.windup = { durations: [150, 200, 150], loop: false, frames: wind };
      anims.attack = { durations: [60, 60, 80, 100], loop: false, frames: slash, events: { hit: 2 } };
    } else {
      var STANCE = { b: [0, 0, 55], t: [6, 0, 25], h: [-4, 0, -76], lL: [-6, 0, 0], kL: [8, 0, 0], lR: [6, 0, 0], kR: [10, 0, 0] };
      var draw = [
        P({ b: [0, 0, 25], t: [6, 0, 10], h: [-6, 0, -30], aL: [-40, 20, 0], fL: [-22, 0, 0], aR: [-165, -20, 0], fR: [-105, 0, 0],
            lL: [-6, 0, 0], kL: [8, 0, 0], lR: [4, 0, 0], kR: [10, 0, 0] }),
        P(ext(STANCE, { b: [0, 0, 35], t: [6, 0, 15], h: [0, 0, -45], fL: [-45, 0, 0], aim: -30, D: 0 })),
        P(ext(STANCE, { fL: [-20, 0, 0], aim: -8, D: 4 })),
        P(ext(STANCE, { fL: [-6, 0, 0], aim: 1, D: 9 })),
        P(ext(STANCE, { fL: [-6, 0, 0], aim: 3, D: 13 }))
      ];
      var shoot = [
        P(ext(STANCE, { fL: [-6, 0, 0], aim: 3, D: 0, release: true, ikZ: STR_Z + 15 })),
        P(ext(STANCE, { fL: [-8, 0, 0], aim: -2, D: 0, release: true, ikZ: STR_Z + 16.5, h: [-2, 0, -72] })),
        P({ b: [0, 0, 30], t: [8, 0, 12], h: [-6, 0, -36], aL: [-34, 16, 0], fL: [-30, 0, 0], aR: [-30, -14, 0], fR: [-50, 0, 0],
            lL: [-6, 0, 0], kL: [8, 0, 0], lR: [4, 0, 0], kR: [10, 0, 0] })
      ];
      anims.draw = { durations: [120, 140, 160, 160, 120], loop: false, frames: draw, events: { nock: 1 } };
      anims.shoot = { durations: [40, 110, 150], loop: false, frames: shoot, events: { release: 0 } };
      anims.windup = anims.draw;     // aliases: windup = draw, attack = shoot
      anims.attack = anims.shoot;
    }
    anims.hurt = { durations: [50, 50], loop: false, interp: 'step', frames: hurt };
    anims.flinch = { durations: [60, 90, 100], loop: false, frames: flinch };
    anims.die = { durations: [90, 110, 120, 80, 100], loop: false, frames: die };     // = beastView DIE_DURATIONS
    anims.dead = { durations: [1000], loop: true, frames: [dead] };
    anims.sink = { durations: [500, 100], loop: false, frames: [dead, sunk] };        // = beastView SINK_DURATIONS
    anims.rise = { durations: [150, 150, 200, 200, 200, 150, 150], loop: false, frames: rise };
    anims.charge = anims.run;      // alias for the generic STATE_CLIPS (chase); skeletonFx.clipFor has the real map
    return anims;
  }

  // =================================================================================================================
  // 5. MODELS
  // =================================================================================================================
  function def(kind) {
    var G = build(kind), archer = kind === 'archer';
    var v = {
      version: 1, meshOnly: true, cellM: 0.05, size: G.size, anchor: [12, 13, 0], mats: MATS, layers: G.layers,
      parts: G.parts, animations: clips(G), light: false,
      mounts: {
        notice: { at: [12, 14, 38], part: 'body' },     // 1.9 m: over the crown
        forefeet: { at: [12, 13, 0.4], part: 'body' },  // dust origin between the feet (boarFx particle name)
        hit: { at: [12, 14.5, 25], part: 'chest' },      // ribcage centre (1.25 m): bone chips, no blood
        loot: { at: [12, 14.5, 18], part: 'body' },      // the pelvis in the bone pile
        mouth: { at: [12, 11, 31], part: 'head' },       // jaw rattle
        handL: { at: HAND[kind].L.slice(), part: 'foreL' },
        handR: { at: HAND[kind].R.slice(), part: 'foreR' }
      }
    };
    if (archer) v.mounts.arrowTip = { at: [21.5, 1, 38.5], part: 'arrow' };      // projectile spawn: valid while the draw is held
    else { v.mounts.swordTip = { at: [17.5, 15.5, 1], part: 'foreR' }; v.mounts.shieldBoss = { at: [3, 15, 17], part: 'foreL' }; }
    return v;
  }

  A.models.skeleton = {
    name: 'skeleton',
    displayName: 'skeleton warrior',
    desc: 'OB-191 skeleton warrior: realistic 1.8 m human skeleton (open ribcage, two-bone forearms and shins, deep dark ' +
          'eye sockets, grave grime and moss), rotten belt + rag, rusty short sword (right), broken round shield (left ' +
          'forearm). Clips idle, walk, run, alert, windup, attack (hit key 2), hurt, flinch, die (collapse into a bone ' +
          'pile), dead, sink, rise (pulls itself up from the pile).',
    voxel: def('warrior')
  };
  A.models.skeletonArcher = {
    name: 'skeletonArcher',
    displayName: 'skeleton archer',
    desc: 'OB-191 skeleton archer: the skeleton rig with an old self bow (bending limbs, rope string that meets the nock), ' +
          'a rotten back quiver with ragged arrows and a nocked arrow while drawing. Clips idle, walk, run, alert, draw ' +
          '(0.7 s, side-on stance, full draw held), shoot (release key 0), hurt, flinch, die, dead, sink, rise.',
    voxel: def('archer')
  };

  // =================================================================================================================
  // 6. ASSETS.skeletonFx - presentation data for the programmer (beastView branch like GOB-07a goblinClip)
  // =================================================================================================================
  A.skeletonFx = {
    version: 1,
    story: 'OB-191 skeleton models + clips (kinds.json skeleton_warrior / skeleton_archer)',
    models: { warrior: 'skeleton', archer: 'skeletonArcher' },
    kindModel: { skeleton_warrior: 'skeleton', skeleton_archer: 'skeletonArcher',
                 note: 'kinds.json skeleton_archer.model still says "skeleton": point it at skeletonArcher' },
    clipFor: {
      state: { idle: 'idle', wander: 'walk', notice: 'alert', chase: 'run', windup: 'windup', charge: 'attack',
               recover: 'idle', return: 'walk', flee: 'run', stagger: 'flinch' },
      archerState: { windup: 'draw', charge: 'shoot', recover: 'shoot' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink', spawn: 'rise',
      note: 'Same mapping idea as goblinFx.clipFor (GOB-07a goblinClip): the generic STATE_CLIPS would show charge (= run) ' +
            'for both chase and the active attack. Archer: windup -> draw (ends held at full draw), charge -> shoot, keep ' +
            'shoot for its 300 ms into RECOVER. Play rise once when a skeleton spawns / wakes (1.2 s, ends = idle key 0), ' +
            'notice -> alert once (ends held in guard).'
    },
    speeds: { walk: 1.4, run: 3.2, note: 'm/s at playback rate 1 (kinds.json walk 1.4, run 4: play run at rate 1.25).' },
    attack: { clip: 'attack', windupClip: 'windup', windupMs: 500, activeMs: 300, hitKey: 2, hitMs: 120,
              note: 'warrior: windup (sword cocked over the right shoulder, held) then attack (slash + lunge, hit at 120 ms).' },
    draw: { clip: 'draw', windupMs: 700, shootClip: 'shoot', releaseKey: 0, releaseMs: 0, arrowMount: 'arrowTip',
            note: 'archer: the sim emits the shot at the windup end; spawn the projectile at voxelMountWorld(arrowTip) while ' +
                  'draw is still held (the nocked arrow is hidden from shoot key 0). The arrow sits on the string only in ' +
                  'draw keys 1-4.' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 15, note: 'same contract as goblinFx.hurt' },
    death: {
      note: 'die 0.5 s collapses into a bone pile (every bone rests on the ground, the skull rolls off), dead = the pile, ' +
            'sink [500, 100] lowers it fully under the ground.',
      corpseCentre: { rightM: 0, fwdM: 0.1, upM: 0.15 },
      lootInteract: { prompt: '[E] Search the bones', radiusM: 1.6, aimUpM: 0.2 },
      sink: { clip: 'sink', steps: 30 }
    },
    rise: { clip: 'rise', ms: 1200, note: 'from the dead pile to idle key 0: use on spawn (night wake-up) for a readable entrance.' },
    body: { heightM: 1.8, radiusM: 0.35, note: 'regionalBeasts BODY entry for the skeleton species' },
    spawn: {
      when: 'night', note: 'kinds.json already says when: night; spawnAreas.json areas carry `when` (spawnDirector). Places: ' +
            'ruins (OB-141 ruin POIs whitecombs 1740,200 / westFells 252,514 / heartlandE 1360,950 / downs 1480,1240, the west ' +
            'gatehouse 953,1092, the Rook ruin 975,1058 only after its quest), crypts / barrows, caves (whitecombs cave rect ' +
            '[0,0,2048,330], not with the cave bears) and cellars. Groups: warriors 1-3 + 0-2 archers on a wall or slope.'
    },
    selfCheck: CHECKS
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { skeleton: A.models.skeleton, skeletonArcher: A.models.skeletonArcher, skeletonFx: A.skeletonFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
