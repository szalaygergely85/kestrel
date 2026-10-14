/* design/models/voxel_goblin.js - GOB-D1 goblin raiders (D-072, architecture.md 38.57 "Model contract").
 * (PC-B designer 2026-10-13, owner-authorised.)
 *
 * Classic script (no import/export, check-deps rule 4), same loading convention as design/models/voxel_wolf.js:
 *   <script src="../design/models/voxel_goblin.js">       (browser)
 *   import '../../../design/models/voxel_goblin.js';      (Node tests: side-effect import)
 * Sets ASSETS.models.goblin, ASSETS.models.goblinTorch, ASSETS.models.goblinSpear (format: design/README.md 4/7,
 * architecture.md 15.1) and ASSETS.goblinFx (state -> clip map, timings, spear + torch data, self-checks).
 * NOT registered in game/js/main.js here (GOB-07). `meshOnly`.
 *
 * LOOK (style-guide 0 + D-053 "realistic things, but from squares"; lore docs/story.md "Goblins (D-072)": small, wiry,
 * quick, scrap-hungry, a nursery tale come true):
 *   - 1.05 m to the crown (1.1 m to the spare javelin tips on the back), HUNCHED: the head hangs FORWARD of the chest
 *     (a vulture neck), the back is humped, knees always a little bent, big flat clawed feet.
 *   - LONG ARMS: the fists hang at knee height (shoulder 0.75 m, fist 0.28 m). Thin wiry limbs (2 voxels = 10 cm).
 *   - Head: a narrow skull, heavy brow ridge with the eyes sunk under it (eyeshine = ember_glow, reads at night like
 *     the beasts), a long hooked nose (2 voxels proud of the face), wide mouth with two fangs, pointed chin, big
 *     pointed ears swept out and back (the silhouette tell at 20 m), a few scraggly hair strands.
 *   - Clothes: a sleeveless ragged leather vest open over a ribbed chest, a rope baldric, a rope belt hung with stolen
 *     nails and a hinge for a buckle, ragged sack-cloth shorts with torn hems and a linen patch, rope shin wraps.
 *   - Gear: LEFT hand = a nail-studded wooden club (0.55 m); RIGHT hand = a crude javelin (0.9 m, iron head with
 *     barbs, rope binding, a rag tuft at the butt); two spare javelins tied on the back. goblinTorch: the LEFT hand
 *     holds a lit pitch torch raised high instead of the club.
 *   - Hue budget (style-guide 5.7): olive-grey skin / browns (leather, sack-cloth, rope, old wood) / iron greys, plus
 *     the emissive eyes and torch fire. No brass (machine only), no reserved hues.
 *
 * AXES (15.1): x = east (= the goblin's RIGHT at yaw 0), y = SOUTH with low y = the FRONT (faces north at yaw 0), z = up.
 * cellM 0.05. Grid 22 x 20 x 23 (goblinTorch: 22 x 20 x 35, the raised torch). Anchor [11, 11, 0] = between the feet.
 * Centre line x = 11 (cells 10 | 11); the right side is the mirror x -> 21 - x. Clip `pos` values are VOXELS.
 *
 * PARTS (8 = MAX_VOX_PARTS; insertion order = part index; parents EARLIER; boxes are the bounding boxes of each
 * part's voxels, computed below, every box sx + sy + sz <= 48 (style-guide 5.14); goblinFx.selfCheck lists any voxel
 * that an earlier box would steal - must be empty):
 *   body   pelvis + rope belt.            pivot [11, 11.5, 9.5] (hip centre). ROOT. rx + = pitch forward, ry + = roll
 *                                         to the right (90 = lying on the right side), rz = turn.
 *   chest  torso, vest, baldric, the 2 spare javelins on the back.  pivot [11, 11.5, 11] (lower spine), parent body.
 *                                         rx + = hunch forward (12 = the rest hunch), rz + = right shoulder back.
 *   head   head, ears, nose, neck front.  pivot [11, 9, 17.5] (neck), parent chest. rx + = chin down, rz + = look right.
 *   armL   left arm + CLUB (goblin) / raised arm + TORCH (goblinTorch). pivot [6, 11, 15] (shoulder), parent chest.
 *          rx - = swing forward / raise (goblin: -172 = club cocked over the head); ry + = out to the side.
 *          goblinTorch: the arm is MODELLED RAISED (fist at 1.15 m, flame 1.55-1.75 m), so its rx 0 = torch up.
 *   armR   right arm (fist = javelin grip [16.5, 8.5, 6]). pivot [16, 11, 15], parent chest. ry - = out to the side.
 *   legL / legR  bent-knee leg + the ragged shorts half + foot. pivot [9 | 13, 11.5, 8.5] (hip joint), parent body.
 *          rx - = foot forward; key pos z = a lifted swing foot.
 *   spear  the javelin in the right hand. Modelled TIP DOWN at the grid edge (x 20, y 17, z 2..19, grip z 14).
 *          parent BODY (not armR): every key places it in the right fist by forward kinematics (pose helper below),
 *          pitch rx = alpha - 180 (alpha = tip angle from straight up toward the front). This lets the throw clip HIDE
 *          it (pos z -140 = 7 m under the ground, the lamp-glint trick) after the release key.
 *
 * CLIPS (ms, multiples of 10; contract names + aliases):
 *   idle        loop 2.4 s  4 keys: breathing, glances right / left with a sniff, weight shifts.
 *   walk        loop 0.5 s  6 keys: quick scurry, bent knees, arms swing (club + javelin), body rocks. ~1.6 m/s.
 *   run         loop 0.36 s 6 keys: low sprint, torso pitched 28, arms pumping, flight phase. ~4 m/s at rate 1.
 *   carryTorch  loop 0.5 s  6 keys: walk with the left arm RAISED (goblinTorch: the torch high; goblin: club brandished).
 *   attack      once 0.8 s  7 keys (+100 hold): WINDUP 0-500 ms (crouch, raise the club / torch over the head, lean
 *               back, cocked + held at 500) then the LUNGE 500-800 (step + overhead smash, HIT key 5 at 680 ms, follow-
 *               through held). windup AND charge both map to `attack`, so the clip does not restart between them.
 *   throw       once 1.0 s  12 keys (+100 hold): WINDUP 0-600 (raise the javelin, cock it over the shoulder, lean back,
 *               club arm points at the target, whip) - RELEASE key 8 at 600 ms = windup end (the sim emits beast:throw
 *               there); key 9 at 610 ms the held javelin is hidden; 610-1000 follow-through + recover (keep playing
 *               `throw` for 400 ms into RECOVER, see goblinFx.throw).
 *   hurt        once 0.1 s  2 step keys: knocked back 7 cm, head snaps up (yelp), arms fling out.
 *   flinch      once 0.25 s 3 keys: follow-through to rest (boar / wolf contract).
 *   die         once 0.5 s  5 keys = beastView DIE_DURATIONS [90, 110, 120, 80, 100]: yelp, knees buckle, topples onto
 *               the right side, overshoot (thud key 3), settles curled up.
 *   dead        held        curled on the right side, knees drawn up, the left arm draped forward, javelin dropped.
 *   sink        once 0.6 s  2 keys = SINK_DURATIONS [500, 100]: the dead pose lowered 0.65 m.
 *   Aliases for the unchanged boar view (beastView STATE_CLIPS): windup = attack, charge = run.
 * goblinSpear clips: fly (loop), stuck (tip 0.1 m in the ground, 60 deg), stuckWobble (once 0.22 s, ends = stuck),
 *   blocked (once 0.27 s: clatters down and lies flat on the ground).
 *
 * MATERIALS: only merged palette keys. Skin = INTERIM `dye_lincoln*` (CHARGEN olive-sage dye) until the main session
 * appends skin_goblin / skin_goblin_light / skin_goblin_dark to palette.js AND detail-pass.js (goblinFx.palette.need);
 * then this file switches to them by itself (black-bear pattern), nothing else to edit.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var D2R = Math.PI / 180;

  // ---- materials (interim -> final skin switch) ----
  var PM = A.palette && A.palette.materials, DM = A.detailPass && A.detailPass.materials;
  var FINAL_SKIN = ['skin_goblin', 'skin_goblin_light', 'skin_goblin_dark'].every(function (k) { return PM && PM[k] && DM && DM[k]; });
  var MATS = {
    s: FINAL_SKIN ? 'skin_goblin' : 'dye_lincoln',              // olive-grey skin
    S: FINAL_SKIN ? 'skin_goblin_light' : 'dye_lincoln_light',  // lit skin: shoulders, knuckles, nose, forehead, crown
    d: FINAL_SKIN ? 'skin_goblin_dark' : 'dye_lincoln_dark',    // creases, ribs, under the jaw, inner ears, brow ridge
    E: 'ember_glow',       // eyeshine (emissive 0.9). goblin / goblinSpear set `light: false`, so no derived light.
    t: 'linen_light',      // fangs
    h: 'hair_dark',        // mouth, claws, hair strands
    v: 'leather',          // vest, grip wraps
    c: 'dye_walnut',       // sack-cloth shorts
    C: 'dye_walnut_dark',  // torn hems, tatters, the javelin rag
    l: 'linen_dark',       // patches, the torch rag
    r: 'rope',             // belt, baldric, wraps, bindings
    w: 'timber_old',       // club, javelin shafts, torch haft
    I: 'iron_dark',        // javelin heads, club studs, hinge
    i: 'iron_light',       // tips, nail heads, belt trinkets
    b: 'canvas_burnt',     // charred torch head
    F: 'ember_core',       // torch flame: white-hot heart (emissive 1.0)
    f: 'flame_mid',        // torch flame: yellow body (0.95)
    g: 'ember_glow',       // torch flame: orange skin (0.9)
    T: 'flame_tip'         // torch flame: red tips (0.75)
  };

  var SX = 22, SY = 20, SZ_GOB = 23, SZ_TORCH = 35;
  var PART_ORDER = ['body', 'chest', 'head', 'armL', 'armR', 'legL', 'legR', 'spear', 'legL2', 'legR2'];   // ANIM-B-01d: legL2 / legR2 = shin + foot (z < KNEE_Z), appended idx 8, 9
  var PIVOT = {
    body: [11, 11.5, 9.5], chest: [11, 11.5, 11], head: [11, 9, 17.5],
    armL: [6, 11, 15], armR: [16, 11, 15], legL: [9, 11.5, 8.5], legR: [13, 11.5, 8.5],
    spear: [20.5, 17.5, 14.5], legL2: [9, 11.5, 5], legR2: [13, 11.5, 5]
  };
  var KNEE_Z = 5;                       // ANIM-B-01d: the leg box splits here (upper keeps z >= 5, lower z < 5; knee pivot z5)
  var PARENT = { chest: 'body', head: 'chest', armL: 'chest', armR: 'chest', legL: 'body', legR: 'body', spear: 'body', legL2: 'legL', legR2: 'legR' };
  var HAND_R = [16.5, 8.5, 6];          // right fist centre in the rest grid = javelin grip
  var SPEAR_G = PIVOT.spear;            // javelin grip in its own (tip-down) storage spot
  var LEG_LEN = 8.5;                    // hip pivot to sole (voxels)
  var HIDE_Z = -140;                    // hidden javelin: 7 m under the ground (body space)
  var CHECKS = [];

  function r3(v) { var r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; }

  // =================================================================================================================
  // 1. GEOMETRY
  // =================================================================================================================
  function build(torch) {
    var SZ = torch ? SZ_TORCH : SZ_GOB;
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
      if (mir) px = 21 - px;
      if (px < 0 || px >= SX || py < 0 || py >= SY || pz < 0 || pz >= SZ) {
        CHECKS.push((torch ? 'goblinTorch' : 'goblin') + ': voxel outside the grid at ' + [px, py, pz].join(',')); return;
      }
      g[pz][py][px] = ch; own[pz][py][px] = ch === '.' ? null : cur;
    }
    function fill(x0, x1, y0, y1, z0, z1, ch) {
      var a, b, c;
      for (c = z0; c <= z1; c++) for (b = y0; b <= y1; b++) for (a = x0; a <= x1; a++) {
        put(a, b, c, typeof ch === 'function' ? ch(a, b, c) : ch);
      }
    }

    // ---- body: pelvis (z9 sack-cloth) + rope belt (z10) with a stolen hinge buckle and dangling nails ----
    cur = 'body';
    fill(8, 13, 10, 13, 9, 9, 'c');
    fill(8, 13, 10, 13, 10, 10, function (a, b) { return (a === 8 || a === 13 || b === 10 || b === 13) ? 'r' : 'c'; });
    put(10, 9, 10, 'i'); put(11, 9, 10, 'I');                 // hinge buckle
    put(9, 9, 9, 'i'); put(12, 9, 9, 'i'); put(13, 14, 9, 'i'); // nails / a ring hung from the belt

    // ---- chest: torso z11..17 [x0, x1, y0, y1], vest, ribs, baldric, spare javelins ----
    cur = 'chest';
    var CH = { 11: [8, 13, 10, 13], 12: [8, 13, 10, 13], 13: [8, 13, 9, 13], 14: [7, 14, 9, 13], 15: [7, 14, 9, 13],
               16: [8, 13, 10, 13], 17: [9, 12, 11, 13] };
    var CUT = { '7,9,15': 1, '14,9,15': 1, '7,13,15': 1, '14,13,15': 1, '8,10,16': 1, '13,10,16': 1 };
    function chestCol(a, b, c) {
      var r = CH[c], front = (b === r[2]), back = (b === r[3]);
      if (c === 17) return b === 11 ? 'S' : 'v';                        // humped back, vest over it
      if (c === 16) return (a === 9 || a === 12 || back) ? 'v' : 'S';    // vest straps over bare trapezius
      if (a === 7 || a === 14) return c === 15 ? 'S' : 's';               // bare shoulder caps
      if (front && (a === 10 || a === 11)) return c === 15 ? 'S' : (c % 2 ? 'd' : 's'); // ribbed chest in the open vest
      return 'v';
    }
    for (z = 11; z <= 17; z++) {
      var rr = CH[z];
      for (y = rr[2]; y <= rr[3]; y++) for (x = rr[0]; x <= rr[1]; x++) {
        if (CUT[x + ',' + y + ',' + z]) continue;
        put(x, y, z, chestCol(x, y, z));
      }
    }
    put(10, 9, 16, 's'); put(11, 9, 16, 's'); put(10, 9, 17, 'd'); put(11, 9, 17, 'd'); // neck base
    put(10, 10, 17, 's'); put(11, 10, 17, 's');
    // rope baldric: left shoulder -> right hip on the front, back up again on the back
    put(8, 9, 15, 'r'); put(9, 9, 14, 'r'); put(10, 9, 13, 'r'); put(11, 9, 13, 'r'); put(12, 10, 12, 'r'); put(13, 10, 11, 'r');
    put(13, 13, 11, 'r'); put(12, 13, 12, 'r'); put(11, 13, 13, 'r'); put(10, 13, 14, 'r'); put(9, 13, 15, 'r'); put(8, 13, 16, 'r');
    put(9, 13, 12, 'l'); put(10, 13, 12, 'l'); put(9, 13, 13, 'l');      // linen patch on the vest back
    put(8, 10, 11, 'd'); put(13, 11, 11, 'd');                            // torn vest hem shows skin
    // two spare javelins tied on the back (behind the right shoulder blade), tips over the shoulder
    for (z = 11; z <= 19; z++) put(12, 14, z, 'w');
    put(12, 14, 20, 'I'); put(12, 14, 21, 'i');
    for (z = 12; z <= 18; z++) put(13, 14, z, 'w');
    put(13, 14, 19, 'I'); put(13, 14, 20, 'i');
    put(12, 14, 13, 'r'); put(13, 14, 13, 'r'); put(12, 14, 17, 'r'); put(13, 14, 17, 'r');

    // ---- head (z16..22), hanging forward of the chest ----
    cur = 'head';
    // z16 pointed chin + under-jaw shadow + neck
    put(10, 4, 16, 's'); put(11, 4, 16, 's');
    fill(9, 12, 5, 5, 16, 16, 's'); fill(9, 12, 6, 7, 16, 16, 'd'); put(10, 8, 16, 'd'); put(11, 8, 16, 'd');
    // z17 wide mouth with two fangs
    var MOUTH = ['s', 't', 'h', 'h', 't', 's'];
    for (x = 8; x <= 13; x++) put(x, 3, 17, MOUTH[x - 8]);
    fill(8, 13, 4, 7, 17, 17, 's'); fill(9, 12, 8, 8, 17, 17, 'd');
    // z18 cheeks, eye bags, the drooping nose tip + nostrils
    for (x = 8; x <= 13; x++) put(x, 3, 18, (x === 9 || x === 12) ? 'd' : 's');
    fill(8, 13, 4, 8, 18, 18, 's');
    put(10, 1, 18, 's'); put(11, 1, 18, 's'); put(10, 2, 18, 'd'); put(11, 2, 18, 'd');
    // z19 eyes sunk one voxel under the brow, hooked nose ridge
    put(8, 3, 19, 's'); put(10, 3, 19, 'S'); put(11, 3, 19, 'S'); put(13, 3, 19, 's');
    put(8, 4, 19, 's'); put(9, 4, 19, 'E'); put(10, 4, 19, 's'); put(11, 4, 19, 's'); put(12, 4, 19, 'E'); put(13, 4, 19, 's');
    fill(8, 13, 5, 8, 19, 19, 's');
    put(10, 1, 19, 'S'); put(11, 1, 19, 'S'); put(10, 2, 19, 'S'); put(11, 2, 19, 'S');
    // z20 heavy brow ridge over the sockets, hair strands down the back
    fill(8, 13, 3, 3, 20, 20, 'd');
    fill(8, 13, 4, 8, 20, 20, function (a, b) { return (b === 8 && a % 2 === 1) ? 'h' : 's'; });
    // z21 forehead + skull
    fill(8, 13, 4, 4, 21, 21, 'S');
    fill(8, 13, 5, 8, 21, 21, function (a, b) {
      if (b === 8 && (a === 8 || a === 13)) return '.';
      return (b === 8 && (a === 10 || a === 12)) || (a === 9 && b === 7) ? 'h' : 's';
    });
    // z22 crown with scraggly strands
    fill(9, 12, 5, 8, 22, 22, function (a, b) { return ((a === 10 && b === 7) || (a === 12 && b === 6) || (a === 9 && b === 8)) ? 'h' : 'S'; });
    // ears: big, pointed, swept out-back-up; front faces dark (inner ear). Left, then the mirror.
    function ear() {
      put(7, 5, 19, 'd'); put(7, 6, 19, 's'); put(7, 7, 19, 's');
      put(7, 5, 20, 's'); put(7, 6, 20, 'S'); put(7, 7, 20, 's');
      put(6, 6, 19, 'd'); put(6, 7, 19, 's'); put(6, 6, 20, 'd'); put(6, 7, 20, 'S'); put(6, 7, 21, 's');
      put(5, 7, 20, 's'); put(5, 7, 21, 'S'); put(5, 8, 21, 's');
      put(4, 8, 21, 'S'); put(4, 8, 22, 's');
    }
    ear(); mir = true; ear(); mir = false;

    // ---- arms ----
    function hangingArm() {       // left-side coordinates; mirrored for the right arm
      fill(5, 6, 10, 12, 15, 15, 'S');                         // shoulder
      fill(5, 6, 10, 11, 12, 14, 's');                         // upper arm
      fill(5, 6, 10, 11, 11, 11, 's'); fill(5, 6, 12, 12, 11, 11, 'd'); // elbow point
      fill(5, 6, 9, 10, 9, 10, 's');                           // forearm (angles forward)
      fill(5, 6, 8, 9, 8, 8, 'r');                             // wrist wrap
      fill(5, 6, 8, 9, 7, 7, 's');                             // wrist
      fill(4, 6, 7, 9, 6, 6, function (a, b) { return b === 7 ? 'S' : 's'; }); // fist, lit knuckles
      fill(4, 6, 7, 9, 5, 5, function (a, b) { return (b === 7 && a !== 5) ? 'h' : 's'; }); // fingers + claws
    }
    cur = 'armL';
    if (!torch) {
      hangingArm();
      // nail-studded club through the left fist, pointing forward (handle y5..10, knob y1..4 at z6..7)
      put(5, 10, 6, 'v'); put(5, 6, 6, 'w'); put(5, 5, 6, 'w');
      fill(5, 6, 1, 4, 6, 7, 'w');
      put(4, 2, 6, 'i'); put(4, 3, 7, 'i'); put(5, 3, 8, 'i'); put(6, 1, 8, 'I'); put(5, 0, 7, 'i'); put(6, 2, 5, 'I');
    } else {
      // raised arm holding a pitch torch high (haft beside the forearm at x4, y10)
      fill(5, 6, 10, 12, 15, 15, 'S');
      fill(5, 6, 10, 11, 16, 18, 's'); fill(5, 6, 12, 12, 18, 18, 'd'); // upper arm + elbow
      fill(5, 6, 10, 11, 19, 20, 's');                                 // forearm
      fill(5, 6, 10, 11, 21, 21, 'r');                                 // wrist wrap
      for (z = 19; z <= 26; z++) put(4, 10, z, 'w');                   // haft (z22-23 inside the fist)
      fill(4, 6, 9, 11, 22, 23, function (a, b, c) { return (b === 9 && c === 23) ? 'S' : 's'; }); // fist
      put(4, 10, 27, 'r');                                             // binding under the rag
      var cross = function (c, ch) { put(4, 10, c, ch); put(3, 10, c, ch); put(5, 10, c, ch); put(4, 9, c, ch); put(4, 11, c, ch); };
      cross(28, 'l'); cross(29, 'l'); cross(30, 'b');                  // oily rag head, charred top
      cross(31, 'f'); put(4, 10, 31, 'F');                             // flame: white heart, yellow body,
      put(4, 10, 32, 'F'); put(3, 10, 32, 'g'); put(5, 10, 32, 'f'); put(4, 9, 32, 'g'); put(4, 11, 32, 'f');
      put(4, 10, 33, 'f'); put(5, 10, 33, 'g'); put(4, 11, 33, 'g');   // orange skin,
      put(4, 10, 34, 'T'); put(5, 10, 34, 'T');                        // red licking tips
    }
    cur = 'armR'; mir = true; hangingArm(); mir = false;

    // ---- legs (bent knee, ragged shorts half, big clawed foot); right = mirror ----
    function leg(side) {
      var k = side === 'R' ? 1 : 0;
      fill(7, 9, 9, 13, 0, 0, function (a, b) { return b === 13 ? 'd' : 's'; });       // sole + foot
      put(7, 8, 0, 'h'); put(8, 8, 0, 's'); put(9, 8, 0, 'h'); put(8, 7, 0, 'h');       // splayed toes + claws
      fill(8, 9, 10, 13, 1, 1, function (a, b) { return b <= 11 ? 'S' : 's'; });       // instep
      fill(8, 9, 12, 13, 2, 2, 'r');                                                   // ankle wrap
      fill(8, 9, 11, 12, 3, 4, 's');                                                   // shin
      fill(8, 9, 10, 12, 5, 5, function (a, b) { return b === 10 ? 'S' : 's'; });      // knee
      fill(8, 9, 10, 12, 6, 7, 's');                                                   // thigh (inside the shorts)
      var a2, b2;
      for (b2 = 9; b2 <= 13; b2++) for (a2 = 7; a2 <= 10; a2++) {
        var edgeC = (a2 === 7 || a2 === 10 || b2 === 9 || b2 === 13);
        if (edgeC && ((a2 * 7 + b2 * 3 + k) % 4) !== 0) put(a2, b2, 6, 'C');            // torn hem
        if (edgeC) put(a2, b2, 7, (a2 === 7 && b2 === 11) ? 'l' : 'c');                  // shorts + patch
        put(a2, b2, 8, 'c');
      }
      put(8 + k, 9, 5, 'C'); put(9 - k, 13, 5, 'C');                                  // hanging tatters
    }
    cur = 'legL'; leg('L');
    cur = 'legR'; mir = true; leg('R'); mir = false;

    // ---- spear: the held javelin, stored TIP DOWN at x20 y17 (tip z2, blade + barbs, binding, shaft, grip, rag, butt) ----
    cur = 'spear';
    put(20, 17, 2, 'i'); put(20, 17, 3, 'I');
    put(19, 17, 4, 'I'); put(20, 17, 4, 'I'); put(21, 17, 4, 'I');
    put(19, 17, 5, 'i'); put(20, 17, 5, 'I'); put(21, 17, 5, 'i');
    put(20, 17, 6, 'r');
    for (z = 7; z <= 19; z++) put(20, 17, z, (z === 14 || z === 15) ? 'v' : 'w');
    put(19, 17, 17, 'C'); put(21, 17, 18, 'C');

    for (z = 0; z < KNEE_Z; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {   // option B: lower leg cells change owner only
      if (own[z][y][x] === 'legL') own[z][y][x] = 'legL2'; else if (own[z][y][x] === 'legR') own[z][y][x] = 'legR2';
    }
    // ---- parts: bounding boxes + claim check (15.1 rule 5: the FIRST part whose box holds a voxel owns it) ----
    var bb = {}, i, p;
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      p = own[z][y][x]; if (!p) continue;
      var B = bb[p] || (bb[p] = [x, y, z, x + 1, y + 1, z + 1]);
      if (x < B[0]) B[0] = x; if (y < B[1]) B[1] = y; if (z < B[2]) B[2] = z;
      if (x + 1 > B[3]) B[3] = x + 1; if (y + 1 > B[4]) B[4] = y + 1; if (z + 1 > B[5]) B[5] = z + 1;
    }
    var name = torch ? 'goblinTorch' : 'goblin';
    var parts = {};
    for (i = 0; i < PART_ORDER.length; i++) {
      p = PART_ORDER[i];
      var box = bb[p];
      if (!box) { CHECKS.push(name + ': part ' + p + ' has no voxels'); continue; }
      if ((box[3] - box[0]) + (box[4] - box[1]) + (box[5] - box[2]) > 48) CHECKS.push(name + ': part ' + p + ' box over 48');
      parts[p] = { box: box, pivot: PIVOT[p].slice() };
      if (PARENT[p]) parts[p].parent = PARENT[p];
    }
    for (z = 0; z < SZ; z++) for (y = 0; y < SY; y++) for (x = 0; x < SX; x++) {
      p = own[z][y][x]; if (!p) continue;
      for (i = 0; i < PART_ORDER.length; i++) {
        var bx = bb[PART_ORDER[i]];
        if (bx && x >= bx[0] && x < bx[3] && y >= bx[1] && y < bx[4] && z >= bx[2] && z < bx[5]) break;
      }
      if (PART_ORDER[i] !== p) CHECKS.push(name + ': voxel ' + [x, y, z].join(',') + ' of ' + p + ' is claimed by ' + PART_ORDER[i]);
    }
    var layers = [];
    for (z = 0; z < SZ; z++) { var rows = []; for (y = 0; y < SY; y++) rows.push(g[z][y].join('')); layers.push(rows); }
    return { size: [SX, SY, SZ], layers: layers, parts: parts };
  }

  // =================================================================================================================
  // 2. POSE HELPER (forward kinematics for the javelin; same Rz * Ry * Rx order as engine setRot)
  // =================================================================================================================
  function rotM(rx, ry, rz) {
    var a = rx * D2R, b = ry * D2R, c = rz * D2R;
    var cx = Math.cos(a), sx = Math.sin(a), cy = Math.cos(b), sy = Math.sin(b), cz = Math.cos(c), sz = Math.sin(c);
    var RyRx = [cy, sy * sx, sy * cx, 0, cx, -sx, -sy, cy * sx, cy * cx];
    return [cz * RyRx[0] - sz * RyRx[3], cz * RyRx[1] - sz * RyRx[4], cz * RyRx[2] - sz * RyRx[5],
            sz * RyRx[0] + cz * RyRx[3], sz * RyRx[1] + cz * RyRx[4], sz * RyRx[2] + cz * RyRx[5],
            RyRx[6], RyRx[7], RyRx[8]];
  }
  function about(M, piv, p) {
    var dx = p[0] - piv[0], dy = p[1] - piv[1], dz = p[2] - piv[2];
    return [M[0] * dx + M[1] * dy + M[2] * dz + piv[0], M[3] * dx + M[4] * dy + M[5] * dz + piv[1], M[6] * dx + M[7] * dy + M[8] * dz + piv[2]];
  }
  function raise(a) { return LEG_LEN * (1 - Math.cos((a || 0) * D2R)); }  // how far a rotated leg lifts its foot

  // o = { b: body rot, bp: body pos (explicit; no auto ground), by: body pos y, dz: extra body height,
  //       plant: legs counter dz / by (feet stay), t: chest rot, h: head rot, al / alT: armL rot (goblin / goblinTorch),
  //       ar: armR rot, ll / lr: leg rx, lift: { l, r } swing-foot lift, sa: javelin tip angle from vertical (deg, 90 =
  //       level forward; default = the rest 55 carried by the arm swing), hide: javelin hidden }
  // Auto ground (no `bp`): body z = dz - min(foot lift of either leg) so the stance foot stays on the ground.
  function pose(o, torch, tag) {
    var t = o.t || [12, 0, 0], h = o.h || [-10, 0, 0];
    var al = torch ? (o.alT || [0, 0, 0]) : (o.al || [-16, 6, 0]);
    var ar = o.ar || [-16, -6, 0];
    var L = o.lift || {}, pl = o.plant ? 1 : 0, dz = o.dz || 0, by = o.by || 0;
    var b = o.b || [0, 0, 0], bp;
    if (o.bp) bp = o.bp;
    else bp = [0, by, dz - Math.min(raise(o.ll) + (L.l || 0), raise(o.lr) + (L.r || 0))];
    function leg(a, k) { return { rot: [a || 0, 0, 0], pos: [0, r3(-pl * by), r3((L[k] || 0) - pl * dz)] }; }
    // javelin: grip at the right fist (FK through chest + armR), pitch in body space
    var hand = about(rotM(t[0], t[1], t[2]), PIVOT.chest, about(rotM(ar[0], ar[1], ar[2]), PIVOT.armR, HAND_R));
    var alpha = o.sa != null ? o.sa : 55 + (t[0] - 12) + (ar[0] + 16);
    var sp = alpha - 180;
    if (sp > 180 || sp < -180) { CHECKS.push((tag || '?') + ': javelin pitch out of range (' + alpha + ')'); sp = Math.max(-180, Math.min(180, sp)); }
    return {
      body:  { rot: [b[0], b[1], b[2]], pos: [r3(bp[0]), r3(bp[1]), r3(bp[2])] },
      chest: { rot: [t[0], t[1], t[2]] },
      head:  { rot: [h[0], h[1], h[2]] },
      armL:  { rot: [al[0], al[1], al[2]] },
      armR:  { rot: [ar[0], ar[1], ar[2]] },
      legL:  leg(o.ll, 'l'),
      legR:  leg(o.lr, 'r'),
      spear: { rot: [r3(sp), 0, 0], pos: [r3(hand[0] - SPEAR_G[0]), r3(hand[1] - SPEAR_G[1]), r3(hand[2] - SPEAR_G[2] + (o.hide ? HIDE_Z : 0))] }
    };
  }

  // =================================================================================================================
  // 3. CLIPS
  // =================================================================================================================
  // ANIM-B-01d: legs + body bob of walk / run, generated by tools/gen-gait.mjs (goblin.walk / goblin.run): upper + lower leg parts and the body
  // frame, 6 keys each (same count as the arm / chest keys below). Shared by goblin + goblinTorch (walk, carryTorch, run).
  // GAIT-A BEGIN goblin.walk (tools/gen-gait.mjs: legs of biped gait, duty 0.5, tuned 1.6 m/s, 6 keys; re-run, do not hand-edit)
  var GOB_WALK = { durations: [83,83,83,83,83,83], frames: [
      { body: { rot: [0,1.902,0], pos: [0,0,0.064] }, legL: { rot: [-47.344,0,0], pos: [0,0,-0.759] }, legL2: { rot: [30.774,0,0], pos: [0,0,0] }, legR: { rot: [47.344,0,0], pos: [0,0,-0.056] }, legR2: { rot: [-30.774,0,0], pos: [0,0,0] } },
      { body: { rot: [0,0.416,0], pos: [0,0,0.056] }, legL: { rot: [-14.664,0,0], pos: [0,0,0.019] }, legL2: { rot: [9.532,0,0], pos: [0,0,0] }, legR: { rot: [-6.819,0,0], pos: [0,0,2.325] }, legR2: { rot: [34.743,0,0], pos: [0,0,0] } },
      { body: { rot: [0,-1.486,0], pos: [0,0,-0.12] }, legL: { rot: [14.664,0,0], pos: [0,0,0.437] }, legL2: { rot: [-9.532,0,0], pos: [0,0,0] }, legR: { rot: [-55.28,0,0], pos: [0,0,0.189] }, legR2: { rot: [66.243,0,0], pos: [0,0,0] } },
      { body: { rot: [0,-1.902,0], pos: [0,0,0.064] }, legL: { rot: [47.344,0,0], pos: [0,0,-0.056] }, legL2: { rot: [-30.774,0,0], pos: [0,0,0] }, legR: { rot: [-47.344,0,0], pos: [0,0,-0.759] }, legR2: { rot: [30.774,0,0], pos: [0,0,0] } },
      { body: { rot: [0,-0.416,0], pos: [0,0,0.056] }, legL: { rot: [-6.819,0,0], pos: [0,0,2.325] }, legL2: { rot: [34.743,0,0], pos: [0,0,0] }, legR: { rot: [-14.664,0,0], pos: [0,0,0.019] }, legR2: { rot: [9.532,0,0], pos: [0,0,0] } },
      { body: { rot: [0,1.486,0], pos: [0,0,-0.12] }, legL: { rot: [-55.28,0,0], pos: [0,0,0.189] }, legL2: { rot: [66.243,0,0], pos: [0,0,0] }, legR: { rot: [14.664,0,0], pos: [0,0,0.437] }, legR2: { rot: [-9.532,0,0], pos: [0,0,0] } }
  ] };
  // GAIT-A END goblin.walk
  // GAIT-A BEGIN goblin.run (tools/gen-gait.mjs: legs of biped gait, duty 0.5, tuned 2.6 m/s, 6 keys; re-run, do not hand-edit)
  var GOB_RUN = { durations: [60,60,60,60,60,60], frames: [
      { body: { rot: [0,1.902,0], pos: [0,0,0.214] }, legL: { rot: [-57.627,0,0], pos: [0,0,-1.357] }, legL2: { rot: [37.457,0,0], pos: [0,0,0] }, legR: { rot: [57.627,0,0], pos: [0,0,-0.534] }, legR2: { rot: [-37.457,0,0], pos: [0,0,0] } },
      { body: { rot: [0,0.416,0], pos: [0,0,0.185] }, legL: { rot: [-17.207,0,0], pos: [0,0,-0.122] }, legL2: { rot: [11.185,0,0], pos: [0,0,0] }, legR: { rot: [4.578,0,0], pos: [0,0,2.227] }, legR2: { rot: [18.675,0,0], pos: [0,0,0] } },
      { body: { rot: [0,-1.486,0], pos: [0,0,-0.4] }, legL: { rot: [17.207,0,0], pos: [0,0,0.736] }, legL2: { rot: [-11.185,0,0], pos: [0,0,0] }, legR: { rot: [-49.06,0,0], pos: [0,0,0.514] }, legR2: { rot: [53.539,0,0], pos: [0,0,0] } },
      { body: { rot: [0,-1.902,0], pos: [0,0,0.214] }, legL: { rot: [57.627,0,0], pos: [0,0,-0.534] }, legL2: { rot: [-37.457,0,0], pos: [0,0,0] }, legR: { rot: [-57.627,0,0], pos: [0,0,-1.357] }, legR2: { rot: [37.457,0,0], pos: [0,0,0] } },
      { body: { rot: [0,-0.416,0], pos: [0,0,0.185] }, legL: { rot: [4.578,0,0], pos: [0,0,2.227] }, legL2: { rot: [18.675,0,0], pos: [0,0,0] }, legR: { rot: [-17.207,0,0], pos: [0,0,-0.122] }, legR2: { rot: [11.185,0,0], pos: [0,0,0] } },
      { body: { rot: [0,1.486,0], pos: [0,0,-0.4] }, legL: { rot: [-49.06,0,0], pos: [0,0,0.514] }, legL2: { rot: [53.539,0,0], pos: [0,0,0] }, legR: { rot: [17.207,0,0], pos: [0,0,0.736] }, legR2: { rot: [-11.185,0,0], pos: [0,0,0] } }
  ] };
  // GAIT-A END goblin.run
  function withLegs(fr, g, i) {         // overwrite body + both legs (upper + lower) of one key with the generated gait key
    var k = g.frames[i];
    for (var n in k) fr[n] = k[n];
    return fr;
  }
  function clips(torch) {
    var tag = torch ? 'goblinTorch' : 'goblin';
    function P(o) { return pose(o, torch, tag); }
    function seq(arr) { return arr.map(P); }
    var i, fr;

    var idle = seq([
      {},
      { t: [9, 0, 0], h: [-12, 0, 0], dz: 0.2, plant: true, al: [-14, 7, 0], ar: [-14, -7, 0], alT: [-3, 2, 0] },
      { t: [12, 0, 5], h: [-20, 0, 24], al: [-18, 8, 0], alT: [2, 0, 0] },
      { t: [13, -2, -4], h: [-6, 4, -20], ar: [-22, -8, 0], alT: [-2, -3, 0] }
    ]);

    // walk: quick scurry 0.5 s. L forward at key 0, back at key 3; swing keys lifted 1 voxel.
    var WLL = [-28, -10, 12, 28, 8, -16], WLR = [28, 8, -16, -28, -10, 12];
    var WLIFTL = [0, 0, 0, 0, 1, 1], WLIFTR = [0, 1, 1, 0, 0, 0];
    var WSW = [17, 6, -7, -17, -5, 10], WTZ = [5, 2, -2, -5, -2, 2], WROLL = [-2, -1, 1, 2, 1, -1];
    var walk = [], carry = [];
    for (i = 0; i < 6; i++) {
      walk.push(P({ b: [0, WROLL[i], 0], t: [16, 0, WTZ[i]], h: [-14, 0, -WTZ[i] / 2], ll: WLL[i], lr: WLR[i],
                    lift: { l: WLIFTL[i], r: WLIFTR[i] }, dz: (i % 3 === 0) ? 0 : 0.1,
                    al: [-16 + WSW[i], 6, 0], ar: [-16 - WSW[i], -6, 0], alT: [-4 + WSW[i] * 0.2, 2, 0] }));
      walk[i] = withLegs(walk[i], GOB_WALK, i);
      // carryTorch: same legs, more upright and proud, the left arm RAISED (torch high / club brandished)
      carry.push(P({ b: [0, WROLL[i], 0], t: [10, 0, WTZ[i]], h: [-14, 0, -WTZ[i] / 2], ll: WLL[i], lr: WLR[i],
                     lift: { l: WLIFTL[i], r: WLIFTR[i] }, dz: (i % 3 === 0) ? 0 : 0.1,
                     al: [-152 + WSW[i] * 0.3, 12, 0], ar: [-16 - WSW[i], -6, 0], alT: [-3 + WSW[i] * 0.15, 3, 0] }));
      carry[i] = withLegs(carry[i], GOB_WALK, i);
    }
    // run: low sprint 0.36 s with a flight phase (dz +0.7) and pumping arms
    var RLL = [-35, -10, 25, 40, 10, -25], RLR = [40, 10, -25, -35, -10, 25];
    var RLIFTL = [0, 0, 0, 0, 1.5, 1.5], RLIFTR = [0, 1.5, 1.5, 0, 0, 0];
    var RPU = [30, 10, -20, -35, -10, 20], RTZ = [7, 3, -3, -7, -3, 3], RDZ = [0, 0.3, 0.7, 0, 0.3, 0.7];
    var run = [];
    for (i = 0; i < 6; i++) {
      run.push(P({ t: [28, 0, RTZ[i]], h: [-28, 0, -RTZ[i] / 2], ll: RLL[i], lr: RLR[i], lift: { l: RLIFTL[i], r: RLIFTR[i] },
                   dz: RDZ[i], al: [-20 + RPU[i], 10, 0], ar: [-20 - RPU[i], -10, 0], alT: [-8 + RPU[i] * 0.15, 4, 0] }));
      run[i] = withLegs(run[i], GOB_RUN, i);
    }

    // attack 0.8 s: windup 0-500 (crouch, raise, cocked + held), lunge 500-800 (step, overhead smash, hit key 5 @ 680)
    var attack = seq([
      {},
      { dz: -1, plant: true, t: [22, 0, -8], h: [-24, 0, 6], al: [-60, 10, 0], alT: [-20, 4, 0], ar: [10, -10, 0], ll: -8, lr: 6 },
      { dz: -0.5, plant: true, t: [-4, 0, -16], h: [-8, 0, 10], al: [-150, 14, 0], alT: [-40, 6, 0], ar: [25, -16, 0], ll: -20, lr: 14 },
      { dz: -0.6, plant: true, t: [-10, 0, -20], h: [-4, 0, 14], al: [-172, 12, 0], alT: [-55, 6, 0], ar: [30, -18, 0], ll: -24, lr: 16 },
      { by: -1, dz: -0.2, t: [30, 0, 8], h: [-30, 0, -6], al: [-70, 6, 0], alT: [40, 4, 0], ar: [10, -20, 0], ll: -34, lr: 24 },
      { by: -1.5, dz: -0.6, t: [42, 0, 14], h: [-38, 0, -8], al: [8, 0, 0], alT: [105, 0, 0], ar: [-10, -24, 0], ll: -36, lr: 28 },
      { by: -1, dz: -0.4, t: [36, 0, 10], h: [-30, 0, -4], al: [18, 4, 0], alT: [115, 2, 0], ar: [-4, -14, 0], ll: -30, lr: 22 }
    ]);

    // throw 1.0 s: windup 0-600 (release key 8 @ 600), hidden from key 9 @ 610, follow-through, recover.
    // arm world angle = chest rx + armR rx: -4 rest, -50, -110, -150, -188 cocked, -150 whip, -126, -106 release.
    var thr = seq([
      {},
      { t: [10, 0, 8], h: [-12, 0, -8], ar: [-60, -6, 0], sa: 30, al: [-30, 10, 0], alT: [-6, 2, 0], ll: -6 },
      { t: [4, 0, 16], h: [-8, 0, -14], ar: [-114, -6, 0], sa: 60, al: [-55, 12, 0], alT: [-8, 2, 0], ll: -12, lr: 6 },
      { t: [-4, 0, 24], h: [-4, 0, -20], ar: [-146, -6, 0], sa: 72, al: [-68, 14, 0], alT: [-10, 4, 0], ll: -18, lr: 10 },
      { t: [-12, 0, 30], h: [-2, 0, -26], ar: [-176, -6, 0], sa: 80, al: [-78, 16, 0], alT: [-12, 4, 0], ll: -22, lr: 14, dz: -0.4, plant: true },
      { t: [-14, 0, 32], h: [0, 0, -28], ar: [-176, -6, 0], sa: 80, al: [-82, 16, 0], alT: [-12, 4, 0], ll: -24, lr: 16, dz: -0.6, plant: true },
      { t: [14, 0, 10], h: [-18, 0, -8], ar: [-164, -6, 0], sa: 82, al: [-40, 10, 0], alT: [-8, 2, 0], ll: -28, lr: 20, dz: -0.3 },
      { t: [24, 0, -4], h: [-26, 0, 2], ar: [-150, -6, 0], sa: 84, al: [-16, 8, 0], alT: [-6, 2, 0], ll: -30, lr: 22, dz: -0.3 },
      { t: [30, 0, -14], h: [-30, 0, 8], ar: [-136, -6, 0], sa: 86, al: [0, 6, 0], alT: [-4, 2, 0], ll: -30, lr: 22, dz: -0.3 },
      { t: [30, 0, -14], h: [-30, 0, 8], ar: [-136, -6, 0], sa: 86, al: [0, 6, 0], alT: [-4, 2, 0], ll: -30, lr: 22, dz: -0.3, hide: true },
      { t: [36, 0, -24], h: [-32, 0, 12], ar: [4, 8, 0], al: [10, 6, 0], alT: [-2, 2, 0], ll: -26, lr: 10, dz: -0.3, hide: true },
      { t: [18, 0, -6], h: [-16, 0, 2], ar: [-14, -6, 0], al: [-16, 6, 0], alT: [0, 0, 0], ll: -10, lr: 4, hide: true }
    ]);

    var hurt = seq([
      { by: 1.5, dz: 0.3, t: [-4, 0, 0], h: [-30, 0, 0], al: [-30, 30, 0], ar: [-30, -30, 0], alT: [-20, 10, 0], ll: 8, lr: 8 },
      { by: 1, t: [2, 0, 0], h: [-22, 0, 0], al: [-24, 20, 0], ar: [-24, -20, 0], alT: [-12, 6, 0], ll: 5, lr: 5 }
    ]);
    var flinch = seq([
      { by: 0.6, t: [6, 0, 0], h: [-18, 0, 0], al: [-20, 14, 0], ar: [-20, -14, 0], alT: [-8, 4, 0], ll: 4, lr: 4 },
      { t: [16, 0, 0], h: [-8, 0, 0] },
      {}
    ]);

    // die: yelp, buckle, topple onto the right side about the hips, overshoot (thud key 3), settle curled up.
    // Lying: hips pivot z 9.5 - 5 = 4.5; the right flank (x edge 15) rests at z 0.5.
    var DEAD_O = { b: [0, 90, 0], bp: [0, 1, -5], t: [30, 0, 0], h: [14, 0, -16], al: [-40, -60, 0], ar: [-70, 30, 0],
                   alT: [110, -30, 0], ll: -46, lr: -30 };
    var dead = P(DEAD_O);
    var sunk = P({ b: [0, 90, 0], bp: [0, 1, -18], t: [30, 0, 0], h: [14, 0, -16], al: [-40, -60, 0], ar: [-70, 30, 0],
                   alT: [110, -30, 0], ll: -46, lr: -30 });
    var die = seq([
      { bp: [0, 1, 0.4], t: [-8, 0, 0], h: [-34, 0, 0], al: [-40, 34, 0], ar: [-40, -34, 0], alT: [-30, 20, 0], ll: 6, lr: 6 },
      { b: [0, 16, 0], bp: [0, 1, -1.5], t: [30, 0, 0], h: [0, 0, 10], al: [-10, 10, 0], ar: [-30, -10, 0], alT: [20, 0, 0], ll: -30, lr: -20 },
      { b: [0, 55, 0], bp: [0, 1, -3.5], t: [32, 0, 0], h: [8, 0, 12], al: [-40, -20, 0], ar: [-60, 10, 0], alT: [60, -10, 0], ll: -40, lr: -30 },
      { b: [0, 96, 0], bp: [0, 1, -5.3], t: [34, 0, 0], h: [16, 0, -12], al: [-50, -55, 0], ar: [-80, 26, 0], alT: [100, -30, 0], ll: -52, lr: -36 }
    ]);
    die.push(dead);

    var anims = {
      idle:       { durations: [700, 500, 600, 600], loop: true, frames: idle },
      walk:       { durations: [80, 90, 80, 80, 90, 80], loop: true, frames: walk },
      run:        { durations: [60, 60, 60, 60, 60, 60], loop: true, frames: run },
      carryTorch: { durations: [80, 90, 80, 80, 90, 80], loop: true, frames: carry },
      attack:     { durations: [120, 180, 200, 100, 80, 120, 100], loop: false, frames: attack },
      throw:      { durations: [120, 100, 70, 60, 120, 60, 40, 30, 10, 190, 200, 100], loop: false, frames: thr },
      hurt:       { durations: [50, 50], loop: false, interp: 'step', frames: hurt },
      flinch:     { durations: [60, 90, 100], loop: false, frames: flinch },
      die:        { durations: [90, 110, 120, 80, 100], loop: false, frames: die },   // = beastView DIE_DURATIONS
      dead:       { durations: [1000], loop: true, frames: [dead] },
      sink:       { durations: [500, 100], loop: false, frames: [dead, sunk] }       // = beastView SINK_DURATIONS
    };
    if (torch) anims.walk = { durations: anims.carryTorch.durations, loop: true, frames: carry }; // torch held up while walking
    anims.windup = anims.attack;         // aliases: the unchanged boar view (STATE_CLIPS) still plays something sensible
    anims.charge = anims.run;
    // ANIM-BLEND-02: additive hit (38.68): frame 0 = identity (delta 0), the two hurt keys, back to identity
    anims.hitAdd = { durations: [40, 50, 70, 100], loop: false, frames: [P({}), hurt[0], hurt[1], P({})] };
    return anims;
  }

  // =================================================================================================================
  // 4. MODELS
  // =================================================================================================================
  function goblinDef(torch) {
    var G = build(torch);
    var v = {
      version: 1, meshOnly: true, cellM: 0.05, size: G.size, anchor: [11, 11, 0], mats: MATS, layers: G.layers,
      parts: G.parts, animations: clips(torch),
      // ANIM-BLEND-02 (38.68; OB-150): walk 1.6 -> run 2.6 m/s (legRig tunedMps). attack / throw snap in (60) after the idle/walk/run
      // blend; the attack's cocked key is reached at 500 ms (= sim windup); recovering to run / walk / carry / idle takes 200 ms.
      blend: {
        sets: { locomotion: { param: 'speed', clips: [{ clip: 'walk', at: 1.6 }, { clip: 'run', at: 2.6 }] } },
        fades: {
          default: 150,
          into: { attack: 60, windup: 60, throw: 60 },
          pairs: { 'attack>run': 200, 'attack>walk': 200, 'attack>carryTorch': 200, 'attack>idle': 200,
                   'throw>run': 200, 'throw>walk': 200, 'throw>carryTorch': 200, 'throw>idle': 200 }
        },
        additive: { hit: { clip: 'hitAdd', parts: ['body', 'chest', 'head', 'armL', 'armR'], inMs: 40, outMs: 160, gain: 1 } }
      },
      // ANIM-B-01d: knee rig (forward knee at z5); walk / run legs = tools/gait-configs.mjs goblin.walk / goblin.run (gait-b.test checks the numbers)
      legRig: {
        body: 'body',
        legs: [{ upper: 'legL', lower: 'legL2', foot: [9, 11.5, 0], bend: 'front' }, { upper: 'legR', lower: 'legR2', foot: [13, 11.5, 0], bend: 'front' }],
        gaits: { walk: { tunedMps: 1.6, duty: 0.5, phase: [0, 0.5], liftM: 0.05 }, run: { tunedMps: 2.6, duty: 0.5, phase: [0, 0.5], liftM: 0.06 } },
        stand: ['idle']
      },
      light: torch ? { preset: 'torchSconce' } : false,
      // grid coords, rest pose
      mounts: {
        notice:   { at: [11, 6, 26], part: 'body' },     // 1.3 m: over the crown, clear of the javelin tips
        forefeet: { at: [11, 11, 0.4], part: 'body' },   // dust origin between the feet (boarFx particle name)
        hit:      { at: [11, 11.5, 13], part: 'chest' }, // chest centre (0.65 m) - blood point
        loot:     { at: [8, 11, 14], part: 'chest' },    // the upper (left) flank of the curled corpse
        mouth:    { at: [11, 3, 17.5], part: 'head' },   // bark / blood
        handL:    { at: [5.5, 8.5, 6], part: 'armL' },
        handR:    { at: HAND_R.slice(), part: 'armR' },  // the javelin release point (beast:throw x, y, z)
        clubTip:  { at: [5.5, 0.5, 6.5], part: 'armL' }  // goblin only: smash trail / impact dust
      }
    };
    if (torch) {
      delete v.mounts.clubTip;
      v.mounts.flame = { at: [4.5, 10.5, 32.5], part: 'armL' };   // the torch flame (embers, smoke)
    }
    return v;
  }

  A.models.goblin = {
    name: 'goblin',
    displayName: 'goblin',
    desc: 'GOB-D1 goblin raider (D-072): 1.05 m, hunched, long arms, big pointed ears, hooked nose, sunken glowing ' +
          'eyes; ragged leather vest, sack-cloth shorts, rope belt hung with stolen nails; nail-studded club (left), ' +
          'javelin (right), two spare javelins on the back. 8 parts: idle, walk, run, carryTorch, attack (windup + smash), ' +
          'throw (javelin, hidden after release), hurt, flinch, side-fall death, corpse, sink.',
    voxel: goblinDef(false)
  };
  A.models.goblinTorch = {
    name: 'goblinTorch',
    displayName: 'goblin (torch)',
    desc: 'GOB-D1 night raider: the goblin rig with a lit pitch torch raised in the left hand instead of the club. ' +
          'Emissive flame voxels -> EMIS-01b derived light, preset torchSconce (0.6 / 4 m, flicker).',
    voxel: goblinDef(true)
  };

  // ---- goblinSpear: the thrown javelin. Tip at y0 (= forward at yaw 0), one part, anchor = pivot = balance point ----
  var spear = (function () {
    var sx = 3, sy = 18, sz = 3, g = [], x, y, z;
    for (z = 0; z < sz; z++) { g.push([]); for (y = 0; y < sy; y++) g[z].push(['.', '.', '.']); }
    function put(px, py, ch) { g[1][py][px] = ch; }
    put(1, 0, 'i'); put(1, 1, 'I');
    put(0, 2, 'I'); put(1, 2, 'I'); put(2, 2, 'I');
    put(0, 3, 'i'); put(1, 3, 'I'); put(2, 3, 'i');
    put(1, 4, 'r');
    for (y = 5; y <= 17; y++) put(1, y, (y === 12 || y === 13) ? 'v' : 'w');
    put(0, 15, 'C'); put(2, 16, 'C');
    var layers = [];
    for (z = 0; z < sz; z++) { var rows = []; for (y = 0; y < sy; y++) rows.push(g[z][y].join('')); layers.push(rows); }
    var PIV = [1.5, 7.5, 1.5], TIP = 7.5;                       // tip front edge is 7.5 voxels ahead of the pivot
    function stuckAt(a) {                                       // tip-down pitch a, tip held 2 voxels under the anchor
      return { shaft: { rot: [a, 0, 0], pos: [0, r3(TIP * Math.cos(a * D2R)), r3(TIP * Math.sin(a * D2R) - 2)] } };
    }
    return {
      version: 1, meshOnly: true, cellM: 0.05, size: [sx, sy, sz], anchor: PIV.slice(),
      mats: { i: MATS.i, I: MATS.I, r: MATS.r, w: MATS.w, v: MATS.v, C: MATS.C },
      layers: layers,
      parts: { shaft: { box: [0, 0, 1, 3, 18, 2], pivot: PIV.slice() } },
      light: false,
      animations: {
        // in flight: level (pitch comes from inst.addPart 0 / addRx), a faint shiver
        fly:         { durations: [80, 80], loop: true, frames: [{ shaft: { rot: [0, 3, 0] } }, { shaft: { rot: [0, -3, 0] } }] },
        stuck:       { durations: [1000], loop: true, frames: [stuckAt(60)] },
        stuckWobble: { durations: [40, 40, 40, 40, 60], loop: false, frames: [stuckAt(68), stuckAt(54), stuckAt(64), stuckAt(58), stuckAt(60)] },
        // blocked: spawned ON THE GROUND under the shield hit point; clatters down from 0.3 m and lies flat
        blocked:     { durations: [90, 80, 100], loop: false, frames: [
          { shaft: { rot: [25, 0, 0], pos: [0, 0, 6] } },
          { shaft: { rot: [-6, 0, 4], pos: [0, 0, 1.2] } },
          { shaft: { rot: [3, 0, 6], pos: [0, 0, 0.5] } }
        ] }
      },
      mounts: { tip: { at: [1.5, 0, 1.5], part: 'shaft' }, butt: { at: [1.5, 18, 1.5], part: 'shaft' } }
    };
  })();
  A.models.goblinSpear = {
    name: 'goblinSpear',
    displayName: 'goblin javelin',
    desc: 'GOB-D1 thrown javelin (0.9 m): crude barbed iron head, rope binding, leather grip, rag tuft. Clips fly, ' +
          'stuck, stuckWobble, blocked.',
    voxel: spear
  };

  // =================================================================================================================
  // 5. ASSETS.goblinFx - presentation data for GOB-01..07. Steps = 60 Hz sim steps.
  // =================================================================================================================
  A.goblinFx = {
    version: 1,
    story: 'GOB-D1 (models + clips) for GOB-01..07 (architecture 38.57)',
    models: { melee: 'goblin', thrower: 'goblin', torch: 'goblinTorch', spear: 'goblinSpear' },
    clipFor: {
      state: { idle: 'idle', wander: 'walk', notice: 'idle', chase: 'run', windup: 'attack', windupThrower: 'throw',
               charge: 'attack', recover: 'run', return: 'walk', flee: 'run', stagger: 'flinch' },
      torchState: { wander: 'carryTorch', chase: 'carryTorch', recover: 'carryTorch', return: 'carryTorch', flee: 'carryTorch' },
      hurt: 'hurt', flinch: 'flinch', die: 'die', dead: 'dead', sink: 'sink',
      note: 'windup -> attack (melee, brain.role) or throw (thrower). goblinTorch: torchState overrides the moving states ' +
            '(play carryTorch ~1.6x faster in chase / flee). A role-less fallback still works through the aliases ' +
            'windup = attack, charge = run.'
    },
    speeds: { walk: 1.6, run: 2.6, carryTorch: 1.6,
              note: 'm/s at playback rate 1 (foot-slide free). Faster ground speed = scale the clip rate.' },
    attack: { clip: 'attack', ms: 800, windupMs: 500, cockedKey: 3, hitKey: 5, hitMs: 680,
              note: 'windup (0.5 s) and charge (0.3 s lunge) both map to attack; the clip runs on across the state change. ' +
                    'Deal the melee hit near hitMs. View-only forward shift (body pos y) is <= 0.075 m.' },
    throw: { clip: 'throw', windupMs: 600, releaseKey: 8, releaseMs: 600, hideKey: 9, hideMs: 610, totalMs: 1000,
             holdIntoRecoverMs: 400, handMount: 'handR', releaseUpM: 1.05,
             note: 'the sim emits beast:throw at windup end = releaseMs. Keep showing `throw` for holdIntoRecoverMs into ' +
                   'RECOVER (else run starts at once and the held javelin pops back the same frame the projectile ' +
                   'spawns). The held javelin reappears with the next clip (drawn from the 2 on the back). At release the ' +
                   'right fist is ~1.05 m up, ~0.35 m in front (voxelMountWorld handR gives the exact point).' },
    hurt: { clip: 'hurt', steps: 6, flinchClip: 'flinch', flinchSteps: 15, note: 'same contract as boarFx.hurt (no flash shell)' },
    death: {
      note: 'same timeline as boarFx.death (die 0.5 s -> dead + lootable -> sink [500, 100])',
      corpseCentre: { rightM: 0.15, fwdM: -0.1, upM: 0.15,
                      note: 'rolled onto the right side about the hips: the curled body spans about -0.35 .. +0.6 m to the ' +
                            'right and 0 .. 0.55 m up (entity frame, right = +x at yaw 0)' },
      lootInteract: { prompt: '[E] Loot goblin', radiusM: 1.6, aimUpM: 0.25 },
      sink: { clip: 'sink', steps: 30, depthM: 0.65 }
    },
    notice: { noticeUpM: 1.3, note: 'beastView draws the `!` at 1.1 m today: that is inside the javelin tips (1.1 m)' },
    torch: { model: 'goblinTorch', lightPreset: 'torchSconce', flameMount: 'flame', flameUpM: 1.62,
             note: 'EMIS-01b derived light from the emissive flame voxels (15 voxels, ember_core / flame_mid / ember_glow / ' +
                   'flame_tip); def.light = { preset: torchSconce } sets colour / 0.6 / 4 m / flicker. The centroid is ' +
                   'posed by the ROOT only (offerEmissive), so it sits at the raised-torch rest spot (1.6 m up, 0.33 m left) ' +
                   'whatever the arm does - the arm is modelled raised for that reason. Eyes (ember_glow) are also emissive ' +
                   'and pull the centroid ~0.1 m toward the head.' },
    spear: {
      model: 'goblinSpear', lengthM: 0.9, tipFwdM: 0.375, buttBackM: 0.525,
      clips: { fly: 'fly', stuck: 'stuck', hit: 'stuckWobble', blocked: 'blocked' },
      note: 'Entity position = the balance point (anchor). FLY: yaw = flight direction (yawFromDelta), pitch = ' +
            'inst.addPart 0 + addRx (deg, + = nose down), addRx 0 otherwise. STUCK: put the entity AT the hit point, ' +
            'yaw = flight yaw, addRx 0: the clip pitches it 60 deg tip-down with the tip 0.1 m in. Play stuckWobble once, ' +
            'then stuck. BLOCKED (beast:spearBlocked): spawn on the GROUND under the hit point, play blocked (clatters down ' +
            'from 0.3 m, lies flat).'
    },
    palette: {
      interimSkin: !FINAL_SKIN,
      need: [
        "colors.skinGoblin = '#6f7448'       // olive-grey goblin skin",
        "colors.skinGoblinLight = '#979d6a'  // lit skin: shoulders, knuckles, nose, crown",
        "colors.skinGoblinDark = '#3d4229'   // creases, ribs, under-jaw, inner ears",
        "materials.skin_goblin / skin_goblin_light / skin_goblin_dark = fabricMat(..., 'skinGoblin*', 0.86 / 0.90 / 0.72, " +
          "skin tile like skin_shade + a faint vein tint) + the v2 records in detail-pass.js"
      ]
    },
    selfCheck: CHECKS
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { goblin: A.models.goblin, goblinTorch: A.models.goblinTorch, goblinSpear: A.models.goblinSpear, goblinFx: A.goblinFx };
  }
})(typeof window !== 'undefined' ? window : globalThis);
