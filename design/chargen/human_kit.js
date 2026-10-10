/*
 * design/chargen/human_kit.js - CHARGEN-01 Human kit GENERATOR (designer script, architecture 38.29 items 1-3).
 *
 * The kit JSON `content/chargen/human.charkit.json` is the ONLY source the core / app / game read. This file just
 * writes it (node tools/chargen-build-kit.mjs) and is loaded by the preview design/preview/chargen_kit.html,
 * which checks that the JSON on disk equals what this script builds.
 *
 * BASE m_avg v3 (CHARGEN-26, D-063 "make look like this": the owner's bearded-knight reference, for ALL characters, no
 * wings / halo; owner follow-up "how they look from the sides ... not flat": the face has depth in profile):
 *   - a 1.75 m man, 70 rows (cellM 0.025) + 2 rows of hair room: grid 37 x 20 x 72 (odd width: face, nose and spine on
 *     the centre column x = 18). Axes 15.1: faces north (-y), z up, the anchor sits between the feet.
 *   - proportions: BIG head ~1/4 (z 53-69 = 17 rows + hair; 15 wide, up to 14 deep), short neck hidden behind the jaw,
 *     shoulders z 50 (21 cells over the deltoids), chest 13-15 wide, waist 13, hips 15, crotch z 28 (shorter legs),
 *     elbow z 40/41 (one-cell step), wrist z 31, block hands z 25-30, knee z 14/15 (one-cell step), ankle z 3.
 *     Chunky limbs: upper arm / forearm 5 x 5, thigh 6 x 6, shin 5 x 5, all with rounded corners.
 *   - face WITH DEPTH (profile): forehead slopes back at the top, a brow ridge one cell out (heavy dark brows painted on
 *     it, angled down to the nose = determined look), eyes set in under it (white c, highlight i, pupil P, iris e;
 *     narrow: 2 rows), cheekbones one cell out, nose 2 cells out (bridge + lit tip + shaded side), lips one cell out
 *     (mouth line d over lower lip p, dark interior behind), chin forward, jaw one cell narrower, ears set back on the
 *     side, back of the head rounded.
 *   - skin: one flat tone (a) + broad shade (s) under the nose / chin, armpits, nose side, ear hole. No noise.
 *   - plain undyed braies under the clothes. Default look (kit.defaults) = CHARGEN-25 civilian: `short` hair, `shirt`,
 *     `trousers`, `boots`, `belt`. Knight pieces (kit.looks.knight): `full` beard + moustache (beard slot, hair colour),
 *     `mail` (top) + `mail_legs` (legs) chainmail, `boots_gloves` (feet: dark boots + gloves), `tabard` (outer, white),
 *     `heraldry` (hat slot, paintOnly decal: mail checker, red cross-on-gold emblem, red hem / split trim, red sash) -
 *     a decal because an engine shell paints one char (engine ask in design/README.md section 25).
 *   - head at 1.25 cm (38.34): bases.m_avg.detail.head["2"] = a straight 2x upsample of the level-1 Head + Jaw cells.
 *   - CHARGEN-26b detail pass (owner "add more detail"): eyelid row over 2-row eyes, heavier angled brows + crease,
 *     nostrils, mouth corners + under-lip shadow, chin dimple, shaped ears (rim, hole, lobe); hair widow's peak,
 *     combed strands + side parting; beard strands, lit moustache, forked chin tuft; hands with
 *     four fingers (ridged backs, grooves), knuckles, nails, a separate thumb; a waistband buckle bump; knight decal:
 *     mail hems, red neckline trim, skirt folds, glove cuffs + knuckles, gold buckle. Proportions / rig unchanged.
 *   - CH1-D3 Fen (kit.looks.fen, a wanderer): `tunic` (top, long sleeves + a short skirt over the trousers), `mended`
 *     (beard slot, paintOnly decal: stubble + sewn cloth patches + a shoulder-bag strap + ragged hem + worn boot scuffs),
 *     `staff` (hat slot, held: bone RightHand, anchor hand_r, the fingers wrap round it). All random weight 0; the
 *     defaults and kit.looks.knight are unchanged.
 *   - rest pose: standing, arms down in a slight A (gap >= 3 cells from the hips up to z 46), 3 cells between the thighs.
 *
 * Bone boxes are axis-aligned and resolved FIRST-MATCH in skeleton order (38.29 item 3), so they are cut to the
 * anatomy: Chest takes z 41-50 (shoulder tops + neck base), Neck (z 51-57) only y >= 0 (behind the jaw), the Jaw box
 * reaches down to z 51 so the region box holds the beard.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  var SX = 37, SY = 20, SZ = 72, CX = 18, CY = 10, CELL = 0.025;
  var KIT_ID = 'kestrel.chargen.human';

  // ===================================================================================================================
  // 1. SKELETON (22 humanoid bones, Unity Humanoid / Godot SkeletonProfileHumanoid names; parents first)
  // ===================================================================================================================
  var SIDES = ['Left', 'Right'];
  var SKELETON = (function () {
    var s = [['Hips', null], ['Spine', 'Hips'], ['Chest', 'Spine'], ['Neck', 'Chest'], ['Head', 'Neck'], ['Jaw', 'Head']];
    SIDES.forEach(function (S) {
      s.push([S + 'Shoulder', 'Chest'], [S + 'UpperArm', S + 'Shoulder'], [S + 'LowerArm', S + 'UpperArm'], [S + 'Hand', S + 'LowerArm']);
    });
    SIDES.forEach(function (S) {
      s.push([S + 'UpperLeg', 'Hips'], [S + 'LowerLeg', S + 'UpperLeg'], [S + 'Foot', S + 'LowerLeg'], [S + 'Toes', S + 'Foot']);
    });
    return s.map(function (b) { return { name: b[0], parent: b[1] }; });
  })();

  // in-game collapse (38.29 item 1): the engine's array form (engine/chargen/collapse.js HUMANOID_PART_MAP), <= 8 parts,
  // parents listed first, every bone exactly once; bones[0] = the part root / pivot; compose n = the part rotation
  // composes the first n bones (body = Hips + Spine, head = Neck + Head)
  var PART_MAP = [
    { name: 'body', bones: ['Hips', 'Spine'], parent: null, compose: 2 },
    { name: 'chest', bones: ['Chest', 'LeftShoulder', 'RightShoulder'], parent: 'body' },
    { name: 'head', bones: ['Neck', 'Head'], parent: 'chest', compose: 2 },
    { name: 'jaw', bones: ['Jaw'], parent: 'head' },
    { name: 'armL', bones: ['LeftUpperArm', 'LeftLowerArm', 'LeftHand'], parent: 'chest' },
    { name: 'armR', bones: ['RightUpperArm', 'RightLowerArm', 'RightHand'], parent: 'chest' },
    { name: 'legL', bones: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes'], parent: 'body' },
    { name: 'legR', bones: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes'], parent: 'body' }
  ];
  var MAX_PARTS = 8;   // engine/chargen/collapse.js MAX_PARTS

  // ===================================================================================================================
  // 2. SLOTS (layer char -> group + shade, or a fixed material) and GROUPS (which recipe field picks the ramp id)
  // ===================================================================================================================
  var SLOTS = {
    a: { group: 'skin', shade: 'base' }, l: { group: 'skin', shade: 'light' }, s: { group: 'skin', shade: 'shade' },
    d: { group: 'skin', shade: 'deep' }, f: { group: 'skin', shade: 'flush' }, n: { group: 'skin', shade: 'nail' },
    v: { group: 'skin', shade: 'vein' },
    p: { group: 'lips', shade: 'lip', keep: 6 },
    e: { group: 'eyes', shade: 'iris', keep: 9 },
    b: { group: 'hair', shade: 'brow' },
    u: { fixed: 'linen' }, U: { fixed: 'linen_dark' }, k: { fixed: 'linen_light' },
    // eye white (CHARGEN-25: c = the white of the eye; keep so a downsample never loses it)
    c: { fixed: 'linen_light', keep: 8 },
    G: { group: 'hair', shade: 'light' }, g: { group: 'hair', shade: 'base' }, K: { group: 'hair', shade: 'dark' },
    1:{ group: 'top', shade: 'light' }, 2: { group: 'top', shade: 'base' }, 3: { group: 'top', shade: 'dark' },
    4: { group: 'legs', shade: 'light' }, 5: { group: 'legs', shade: 'base' }, 6: { group: 'legs', shade: 'dark' },
    7: { group: 'feet', shade: 'light' }, 8: { group: 'feet', shade: 'base' }, 9: { group: 'feet', shade: 'dark' },
    W: { group: 'outer', shade: 'light' }, w: { group: 'outer', shade: 'base' }, m: { group: 'outer', shade: 'dark' },
    H: { group: 'hat', shade: 'light' }, h: { group: 'hat', shade: 'base' }, j: { group: 'hat', shade: 'dark' },
    // CHARGEN-25 pupil: near-black, the same for every skin tone / eye colour (existing key hair_black_dark #100d0c)
    P: { fixed: 'hair_black_dark', keep: 9 },
    // CHARGEN-26 (fixed existing materials, valid for every skin tone): eye highlight, chainmail light / dark,
    // heraldry red (trim, sash, cross) and gold (cross core)
    i: { fixed: 'iron_light', keep: 9 },
    q: { fixed: 'iron_light' }, r: { fixed: 'dye_gall_light' },
    R: { fixed: 'gore_red' }, y: { fixed: 'dye_weld_light' }
  };
  // Ramp ids are picked by engine/chargen/compose.js (CHARGEN-02): skin / eyes = recipe.skin / recipe.eyes,
  // lips = recipe.skin, hair (also beard + brows: beard shares the hair group) = (recipe.hair || recipe.beard).ramp,
  // a dye group = recipe[group].ramp; a missing pick takes the FIRST ramp of the group. So the first ramp is the
  // natural default: darkbrown hair, undyed linen, walnut-brown shoes.
  function firstThen(obj, first) {
    var o = {}, k;
    if (obj[first]) o[first] = obj[first];
    for (k in obj) if (k !== first) o[k] = obj[k];
    return o;
  }
  function buildRamps(CG) {
    var r = { skin: {}, lips: {}, eyes: {}, hair: {}, top: {}, legs: {}, feet: {}, outer: {}, hat: {} };
    var id, g;
    for (id in CG.skin) {
      var s = CG.skin[id];
      r.skin[id] = { light: s.light, base: s.base, shade: s.shade, deep: s.deep, flush: s.flush, nail: s.nail, vein: s.vein };
      r.lips[id] = { lip: s.flush };
    }
    for (id in CG.eyes) r.eyes[id] = { iris: CG.eyes[id].iris };
    var hair = firstThen(CG.hair, 'darkbrown');
    for (id in hair) r.hair[id] = { light: hair[id].light, base: hair[id].base, dark: hair[id].dark, brow: hair[id].dark };
    ['top', 'legs', 'feet', 'outer', 'hat'].forEach(function (grp) {
      var dyes = firstThen(CG.dyes, grp === 'feet' ? 'walnut' : 'undyed');
      for (g in dyes) r[grp][g] = { light: dyes[g].light, base: dyes[g].base, dark: dyes[g].dark };
    });
    return r;
  }
  // the engine's stretch rule (engine/chargen/kit.js STRETCH_BONES, extended by arch Batch 9): waist + shin bones, and
  // the arm bones beside the waist (upper + lower arm) - but only symmetric (a row through one arm bone must also run
  // through its mirror) and never through a hand box. ARM_STRETCH maps each arm bone to its mirror.
  var STRETCH_BONES = ['Hips', 'Spine', 'LeftLowerLeg', 'RightLowerLeg', 'LeftUpperArm', 'RightUpperArm', 'LeftLowerArm', 'RightLowerArm'];
  var ARM_STRETCH = { LeftUpperArm: 'RightUpperArm', RightUpperArm: 'LeftUpperArm', LeftLowerArm: 'RightLowerArm', RightLowerArm: 'LeftLowerArm' };

  // ===================================================================================================================
  // 3. GRID (centred coords: X = x - 18 (+ = the character's RIGHT = east), Y = y - 10 (- = front/north))
  // ===================================================================================================================
  function idx(X, Y, z) {
    var x = X + CX, y = Y + CY;
    if (x < 0 || x >= SX || y < 0 || y >= SY || z < 0 || z >= SZ) return -1;
    return x + SX * (y + SY * z);
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  // ===================================================================================================================
  // 4. HEAD + HAIR (centred cells)
  // ===================================================================================================================
  // The head is built as a PROFILE (owner: "look the face. not flat"): per row z a half width, and per (X, z) the
  // front-most and back-most Y. Paint strings (X -7..7, '.' = never filled) colour the FRONT cell of that column.
  //   66 brows outer (b) on the brow ridge   65 brows inner, angled down to the nose   64 / 63 eyes (set in under the ridge):
  //   white c, highlight i over iris e, pupil P (2 x 2 dark block, highlight top-left: one light for both eyes)
  //   59 shade under the nose   58 mouth line d (on the upper lip, Head)   57 lower lip p (Jaw)
  // CHARGEN-26b detail pass (owner "add more detail"): heavier brows (outer end high on z 66, inner end low on z 65,
  // glabella crease s between them, temple shadow s), a dark upper eyelid row (z 64) over 2-row eyes (z 63 / 62),
  // under-eye line s on the cheekbone (z 61), philtrum dip (z 59), mouth line with shaded corners (z 58), lower lip
  // with corners (z 57), shadow under the lower lip (z 56), chin dimple (z 54).
  var FACE = {
    66: '.bbbbbaaabbbbb.',
    65: '.sabbbbsbbbbas.',
    64: '.sddddaaadddds.',
    63: '.aciPcaaaciPca.',
    62: '.acePcaaacePca.',
    61: '.assssaaassssa.',
    59: '.aaaaasdsaaaaa.',
    58: '.aaaasdddsaaaa.',
    57: '.aaaaspppsaaaa.',
    56: '.aaaasssssaaaa.',
    54: '.aaaaaasaaaaaa.'
  };
  // half width of the head per row: skull z 58-67 (15 wide), z 68 (13), top z 69 (11), jaw z 54-57 (13), chin z 53 (9)
  function headHalf(z) {
    if (z >= 58 && z <= 67) return 7;
    if (z === 68) return 6;
    if (z === 69) return 5;
    if (z >= 54 && z <= 57) return 6;
    if (z === 53) return 4;
    return -1;
  }
  // front-most Y of column (X, z): forehead slopes back (z 67-69), brow ridge out (z 65-66), eyes in (z 63-64),
  // cheekbones out (z 61-62, |X| 3..6), upper lip out (z 58), lower lip out (z 57), chin forward (z 53-55); the outer
  // column (|X| = half) always steps back (rounded vertical edges)
  function headFront(X, z) {
    var ax = Math.abs(X), h = headHalf(z);
    if (h < 0 || ax > h) return null;
    if (z === 69) return ax === 5 ? -3 : -4;
    if (z === 68) return ax === 6 ? -4 : -5;
    if (ax === h) return -5;
    if (z === 67) return -6;
    if (z === 65 || z === 66) return -7;
    if (z === 61) return ax >= 3 ? -7 : -6;   // cheekbones (26b: one row, the eyes now sit on z 62-63)
    if (z === 58) return ax <= 2 ? -7 : -6;
    if (z === 57) return ax <= 1 ? -7 : -6;
    if (z === 53 || z === 54 || z === 55) return ax <= 3 ? -7 : -6;
    return -6;
  }
  // back-most Y: rounded back of the skull; the jaw ends at Y -1 (the neck sits behind it)
  function headBack(X, z) {
    var ax = Math.abs(X);
    if (z <= 57) return -1;
    if (z === 69) return ax === 5 ? 2 : 3;
    if (z === 68) return ax === 6 ? 3 : 4;
    if (z <= 59) return ax <= 5 ? 4 : 3;
    return ax <= 5 ? 5 : 4;
  }
  // nose (2 cells out): bridge from the brow ridge down (Y -7, z 61-64), 3 wide at the base (z 60-61), tip Y -8 (z 60-61);
  // l = lit ridge, s = the shaded side (+X, away from the preview light)
  var NOSE = {
    '0,-7,64': 'a', '0,-7,63': 'l', '0,-7,62': 'a', '1,-7,62': 's', '-1,-7,61': 'a', '0,-7,61': 'l', '1,-7,61': 's',
    '-1,-7,60': 'd', '0,-7,60': 'a', '1,-7,60': 'd', '0,-8,61': 'l', '0,-8,60': 'a'
  };
  // 26b nostrils: the nose wings at z 60 (X +-1) are deep d; lit bridge cell at z 63.
  // ears (26b, set back on the side, X +-8): keyed 'Y,z' - helix rim a / lit l round a dark ear hole d, tragus in front
  // (Y 0), shaded concha s, a flushed lobe f at the bottom (z 59)
  var EAR = {
    '1,63': 'a', '2,63': 'a',
    '0,62': 'a', '1,62': 's', '2,62': 'l',
    '0,61': 'a', '1,61': 'd', '2,61': 'a',
    '0,60': 's', '1,60': 's', '2,60': 'a',
    '1,59': 'f', '2,59': 'a'
  };
  // the head as a function (also drives hair + beard)
  function headChar(X, Y, z) {
    var ax = Math.abs(X), c, f;
    var n = NOSE[X + ',' + Y + ',' + z];
    if (n) return n;
    if (ax === 8) return EAR[Y + ',' + z] || null;   // ears, set back
    f = headFront(X, z);
    if (f === null || Y < f || Y > headBack(X, z)) return null;
    if (Y === -6 && (z === 57 || z === 58) && ax <= 1) return 'd';    // mouth interior behind the lips (Jaw opens)
    if (Y === f && FACE[z]) { c = FACE[z].charAt(X + 7); return c === '.' ? 'a' : c; }
    return 'a';
  }
  // short hair (attachment `short`): every empty cell touching the head inside the hair zone. Front: a hairline row
  // over the top of the forehead (z 68) and the crown; temples down to z 65, above the ears z 64, behind the ears z 60,
  // the back to z 58. g = hair base, K = the dark rim along the hairline, G = a broad lit patch on the crown.
  // 26b: a widow's peak (z 67, |X| <= 1, over the forehead), combed locks:
  // strands run front-to-back on top (stripes by X, lit G between dark K partings, a side parting at X -3) and
  // downward on the sides / back (stripes by Y on the sides, by X at the back; lit G only high up).
  var HAIR_BOX = { X0: -8, Y0: -6, z0: 58, w: 17, d: 13, h: 13 };   // centred origin + size [x, y, z]
  function hairZone(X, Y, z) {
    if (z >= 70) return true;
    if (z < 58) return false;
    if (Y <= -4 && Math.abs(X) <= 6) return z >= 68 || (z === 67 && Math.abs(X) <= 1);
    return z >= (Y >= 4 ? 58 : Y >= 3 ? 60 : Y >= -1 ? 64 : 65);
  }
  function isHair(X, Y, z) {
    if (headChar(X, Y, z) !== null || !hairZone(X, Y, z)) return false;
    return headChar(X + 1, Y, z) !== null || headChar(X - 1, Y, z) !== null || headChar(X, Y + 1, z) !== null ||
           headChar(X, Y - 1, z) !== null || headChar(X, Y, z + 1) !== null || headChar(X, Y, z - 1) !== null;
  }
  function hairChar(X, Y, Z) {
    var ax = Math.abs(X), t;
    if (Z < 69 && !isHair(X, Y, Z - 1)) return 'K';                       // hairline / lower rim
    if (X === -3 && Y <= 1 && Z >= 70) return 'K';                         // side parting
    if (Z === 70) return (ax <= 3 && Y >= -3 && Y <= 1) ? 'G' : ((X + 9) % 3 === 1 ? 'K' : 'g');
    t = ((ax >= 7 && Y < 5 ? Y : X) + 21) % 4;                             // downward strands
    return t === 0 ? 'K' : (t === 2 && Z >= 66) ? 'G' : 'g';
  }
  function buildHair() {
    var layers = [], x, y, z;
    for (z = 0; z < HAIR_BOX.h; z++) {
      var L = [];
      for (y = 0; y < HAIR_BOX.d; y++) {
        var row = '';
        for (x = 0; x < HAIR_BOX.w; x++) {
          var X = HAIR_BOX.X0 + x, Y = HAIR_BOX.Y0 + y, Z = HAIR_BOX.z0 + z;
          row += !isHair(X, Y, Z) ? '.' : hairChar(X, Y, Z);
        }
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
  }
  // full beard + moustache (attachment `full`, beard slot, dyed with the hair ramp; bone Jaw so it moves when he talks):
  // every empty cell touching the head inside the beard zone - jaw, chin and the cells under them, around the jaw back
  // to the neck (never over the neck, |X| <= 2 at Y 0), sideburns up to z 61, cheeks (z 60-61, |X| >= 5), the moustache
  // row (z 59) and its droops (z 58, |X| >= 3); the lips (z 57 |X| <= 1, z 58 |X| <= 2) stay visible. Plus a chin tuft
  // (z 51). g = base, K = the lower beard (z <= 52, in shadow).
  var BEARD_BOX = { X0: -8, Y0: -8, z0: 51, w: 17, d: 9, h: 11 };
  function beardZone(X, Y, z) {
    var ax = Math.abs(X);
    if (z < 51 || z > 61 || Y > 0) return false;
    if (Y === 0) return ax >= 3 && z <= 57;
    if (z <= 56) return true;
    if (z === 57) return ax >= 2;
    if (z === 58) return ax >= 3;
    if (z === 59) return true;
    return ax >= 5;
  }
  function isBeard(X, Y, z) {
    if (headChar(X, Y, z) !== null) return false;
    if (z === 51 && Math.abs(X) <= 3 && Y >= -7 && Y <= -3) return !(X === 0 && Y <= -6);   // chin tuft, forked tip (26b)
    if (!beardZone(X, Y, z)) return false;
    return headChar(X + 1, Y, z) !== null || headChar(X - 1, Y, z) !== null || headChar(X, Y + 1, z) !== null ||
           headChar(X, Y - 1, z) !== null || headChar(X, Y, z + 1) !== null || headChar(X, Y, z - 1) !== null;
  }
  // 26b strands: vertical dark K strands every 3rd column, lit g strands in the shadowed lower beard, a lit moustache
  // top (z 59, |X| <= 2) with dark droop tips (z 58)
  function beardChar(X, Y, Z) {
    var ax = Math.abs(X), t = ax % 3;   // mirror-symmetric strands
    if (Z <= 52) return t === 1 ? 'g' : 'K';
    if (Z === 59) return ax <= 2 ? 'G' : 'g';
    if (Z === 58) return 'K';
    return t === 0 ? 'K' : 'g';
  }
  function buildBeard() {
    var layers = [], x, y, z;
    for (z = 0; z < BEARD_BOX.h; z++) {
      var L = [];
      for (y = 0; y < BEARD_BOX.d; y++) {
        var row = '';
        for (x = 0; x < BEARD_BOX.w; x++) {
          var X = BEARD_BOX.X0 + x, Y = BEARD_BOX.Y0 + y, Z = BEARD_BOX.z0 + z;
          row += !isBeard(X, Y, Z) ? '.' : beardChar(X, Y, Z);
        }
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
  }

  // head region (38.34): Head box U Jaw box (hair + beard room), centred [X0,X1, Y0,Y1, z0,z1]
  var HEAD_REGION = { bones: ['Head', 'Jaw'], box: [-9, 9, -10, 9, 51, 71] };

  // ===================================================================================================================
  // 5. BONES: joint (centred coords, continuous) + box (centred, INCLUSIVE cell ranges [X0,X1, Y0,Y1, z0,z1]).
  //    Right side listed; Left mirrors X. First match in skeleton order wins.
  // ===================================================================================================================
  var CENTER_BONES = {
    Hips:  { joint: [0, 0.5, 29.0],  box: [-8, 8, -10, 9, 28, 34] },
    Spine: { joint: [0, 0.0, 35.0],  box: [-8, 8, -10, 9, 35, 40] },
    Chest: { joint: [0, 0.0, 41.0],  box: [-7, 7, -10, 9, 41, 50] },
    Neck:  { joint: [0, 1.5, 51.0],  box: [-3, 3, 0, 9, 51, 57] },
    Head:  { joint: [0, 0.5, 58.0],  box: [-9, 9, -10, 9, 58, 71] },
    Jaw:   { joint: [0, 0.5, 58.5],  box: [-7, 7, -10, 0, 51, 57] }
  };
  var SIDE_BONES = {   // right side, X >= 0
    Shoulder: { joint: [3.5, 0.5, 49.5], box: [8, 16, -10, 9, 49, 50] },
    UpperArm: { joint: [9.5, 0.0, 48.0], box: [8, 16, -10, 9, 41, 48] },
    LowerArm: { joint: [12.5, 0.0, 41.0], box: [8, 16, -10, 9, 31, 40] },
    Hand:     { joint: [13.0, 0.0, 31.0], box: [8, 16, -10, 9, 24, 30] },
    UpperLeg: { joint: [4.5, -0.5, 27.5], box: [1, 9, -10, 9, 15, 27] },
    LowerLeg: { joint: [4.0, 0.0, 15.0],  box: [1, 9, -10, 9, 3, 14] },
    Foot:     { joint: [4.0, 0.0, 3.0],   box: [1, 9, -3, 9, 0, 2] },
    Toes:     { joint: [4.0, -3.5, 0.5],  box: [1, 9, -10, -4, 0, 2] }
  };
  function gridJoint(j) { return [r3(j[0] + CX + 0.5), r3(j[1] + CY + 0.5), r3(j[2])]; }
  // box = INCLUSIVE cell range [x0, y0, z0, x1, y1, z1] (engine/chargen/kit.js)
  function gridBox(b) { return [b[0] + CX, b[2] + CY, b[4], b[1] + CX, b[3] + CY, b[5]]; }
  function boneTable() {
    var out = {};
    SKELETON.forEach(function (b) {
      var n = b.name, d, j, bx;
      if (CENTER_BONES[n]) { d = CENTER_BONES[n]; j = d.joint; bx = d.box; }
      else {
        var left = n.indexOf('Left') === 0, key = n.replace(/^(Left|Right)/, '');
        d = SIDE_BONES[key];
        j = left ? [-d.joint[0], d.joint[1], d.joint[2]] : d.joint;
        bx = left ? [-d.box[1], -d.box[0], d.box[2], d.box[3], d.box[4], d.box[5]] : d.box;
      }
      out[n] = { joint: gridJoint(j), box: gridBox(bx) };
    });
    return out;
  }

  // ===================================================================================================================
  // 6. BUILD THE BASE m_avg (rounded blocks; one flat skin tone)
  // ===================================================================================================================
  function buildBase() {
    var N = SX * SY * SZ, G = new Array(N), X, Y, z, i, s;
    for (i = 0; i < N; i++) G[i] = '.';
    function put(X, Y, z, ch) { var q = idx(X, Y, z); if (q >= 0) G[q] = ch; }
    // a block of skin, inclusive centred ranges; cut = leave out the four vertical edge columns (rounded corners)
    function block(X0, X1, Y0, Y1, z0, z1, cut) {
      for (var zz = z0; zz <= z1; zz++) for (var yy = Y0; yy <= Y1; yy++) for (var xx = X0; xx <= X1; xx++) {
        if (cut && (xx === X0 || xx === X1) && (yy === Y0 || yy === Y1)) continue;
        put(xx, yy, zz, 'a');
      }
    }
    function pair(X0, X1, Y0, Y1, z0, z1, cut) { block(X0, X1, Y0, Y1, z0, z1, cut); block(-X1, -X0, Y0, Y1, z0, z1, cut); }

    // legs (shorter, chunky): foot (sole + toes z 0-1, instep z 2), shin 5 x 5 (z 3-14), thigh 6 x 6 (z 15-27; the
    // one-cell step at the knee: forward and out)
    pair(2, 6, -6, 2, 0, 1, true);
    pair(2, 6, -3, 2, 2, 2, true);
    pair(2, 6, -2, 2, 3, 14, true);
    pair(2, 7, -3, 2, 15, 27, true);
    // torso: crotch + hips 15 wide (z 28-34, seat at the back), waist 13 (z 35-42), chest 13 deeper in front (z 43-46),
    // upper chest 15 (z 47-49), shoulder tops (z 50)
    block(-7, 7, -3, 3, 28, 29, true);
    block(-7, 7, -4, 4, 30, 33, true);
    block(-7, 7, -4, 3, 34, 34, true);
    block(-6, 6, -3, 3, 35, 42, true);
    block(-6, 6, -4, 3, 43, 46, true);
    block(-7, 7, -4, 3, 47, 49, true);
    block(-6, 6, -3, 2, 50, 50, true);
    // short neck 5 x 5, set back behind the jaw (hidden by the beard / jaw from the front)
    block(-2, 2, 0, 4, 50, 57, true);
    // arms (slight A): deltoid cap z 49-50, upper arm stepping out to X 10-14 by z 46 (>= 3 cells from the chest),
    // forearm one cell further out below the elbow (z 32-40), wrist z 31
    pair(7, 9, -2, 2, 50, 50, true);
    pair(8, 10, -2, 2, 49, 49, true);
    pair(8, 12, -2, 2, 48, 48, true);
    pair(9, 13, -2, 2, 47, 47, true);
    pair(10, 14, -2, 2, 41, 46, true);
    pair(11, 15, -2, 2, 32, 40, true);
    pair(12, 14, -2, 1, 31, 31, false);
    // hands (26b; palm faces the thigh, the back of the hand = outer X 14): palm 3 x 5 (z 28-30) with a knuckle row
    // (z 28); four fingers Y -2..1 curled in (X 12-13, z 25-27), middle + ring one row longer (z 24); the backs of
    // the index + ring fingers ridge out to X 14 so the grooves between the fingers read; thumb forward (Y -3,
    // z 27-29) with its tip turned in (X 12, z 26), apart from the index finger
    pair(12, 14, -2, 2, 28, 30, false);
    pair(12, 13, -2, 1, 25, 27, false);
    pair(12, 13, -1, 0, 24, 24, false);
    pair(14, 14, -2, -2, 25, 27, false);
    pair(14, 14, 0, 0, 25, 27, false);
    pair(12, 13, -3, -3, 27, 29, false);
    pair(12, 12, -3, -3, 26, 26, false);
    // hand paint: lit knuckles over the ridged fingers (l) and shaded between (s), shaded finger grooves, nails n on
    // the finger tips + thumb tip, the thumb crease s, a vein v on the back of the hand
    function pp(X, Y, z, c) { put(X, Y, z, c); put(-X, Y, z, c); }
    pp(14, -2, 28, 'l'); pp(14, -1, 28, 's'); pp(14, 0, 28, 'l'); pp(14, 1, 28, 's');
    for (z = 25; z <= 27; z++) { pp(13, -1, z, 's'); pp(13, 1, z, 's'); }
    pp(13, -2, 25, 'n'); pp(13, -1, 24, 'n'); pp(13, 0, 24, 'n'); pp(13, 1, 25, 'n'); pp(12, -3, 26, 'n');
    pp(13, -3, 29, 's'); pp(14, -1, 30, 'v');
    // belt-buckle / drawstring knot: a 3 x 2 bump on the front of the waistband (z 33-34) - the belt / tabard grow
    // over it, so the buckle stands out on every outfit (26b)
    block(-1, 1, -5, -5, 33, 34, false);
    // head (profile-built, see headChar)
    for (z = 53; z <= 69; z++) for (Y = -8; Y <= 5; Y++) for (X = -8; X <= 8; X++) {
      var hc = headChar(X, Y, z);
      if (hc) put(X, Y, z, hc);
    }
    // broad shade only where light cannot reach: under the chin (neck front), the armpits (torso side under the arm)
    function shade(X, Y, z) { var q = idx(X, Y, z); if (q >= 0 && G[q] === 'a') G[q] = 's'; }
    for (X = -1; X <= 1; X++) for (z = 51; z <= 52; z++) shade(X, 0, z);
    for (s = -1; s <= 1; s += 2) for (Y = -2; Y <= 2; Y++) for (z = 45; z <= 46; z++) shade(s * 6, Y, z);
    // underwear: plain undyed linen braies, hip top (z 34) to mid-thigh (z 22), waistband + hem in linen_dark
    for (z = 22; z <= 34; z++) for (Y = -CY; Y < SY - CY; Y++) for (X = -8; X <= 8; X++) {
      var q = idx(X, Y, z);
      if (q >= 0 && G[q] === 'a') G[q] = (z === 34 || z === 22) ? 'U' : 'u';
    }

    var layers = [];
    for (z = 0; z < SZ; z++) {
      var L = [];
      for (var y = 0; y < SY; y++) {
        var row = '';
        for (var x = 0; x < SX; x++) row += G[x + SX * (y + SY * z)];
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
  }

  // the 1.25 cm head block (38.34 detail.head["2"]): a straight 2x upsample of the level-1 cells owned by Head / Jaw
  // (first-match bone box), origin = the region box min, size = box extent x 2. downsample2 gives level 1 back exactly.
  function buildHeadL2(layers, bones) {
    var B = gridBox(HEAD_REGION.box), ex = B[3] - B[0] + 1, ey = B[4] - B[1] + 1, ez = B[5] - B[2] + 1;
    var order = SKELETON.map(function (b) { return b.name; }), own = {};
    function inRegion(x, y, z) {
      var key = x + ',' + y + ',' + z;
      if (own[key] !== undefined) return own[key];
      var r = false;
      if (layers[z][y].charAt(x) !== '.') {
        for (var i = 0; i < order.length; i++) {
          var q = bones[order[i]].box;
          if (x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5]) { r = HEAD_REGION.bones.indexOf(order[i]) >= 0; break; }
        }
      }
      own[key] = r;
      return r;
    }
    var out = [];
    for (var z = 0; z < ez * 2; z++) {
      var L = [];
      for (var y = 0; y < ey * 2; y++) {
        var row = '';
        for (var x = 0; x < ex * 2; x++) {
          var gx = B[0] + (x >> 1), gy = B[1] + (y >> 1), gz = B[2] + (z >> 1);
          row += inRegion(gx, gy, gz) ? layers[gz][gy].charAt(gx) : '.';
        }
        L.push(row);
      }
      out.push(L);
    }
    return out;
  }

  // 38.34 downsample2 (preview / check twin of engine/chargen/downsample.js): each 2x2x2 block -> one cell. Any filled
  // cell with keep > 0: the char with the highest keep (ties: higher count, then lower char code); else >= 4 of 8
  // filled: the majority char (ties: lower char code); else empty. size = [x, y, z] of `layers`.
  function downsample2(layers, size, slots) {
    var W = size[0], NY = size[1], NZ = size[2], w = Math.ceil(W / 2), h = Math.ceil(NY / 2), dz = Math.ceil(NZ / 2), out = [];
    for (var z = 0; z < dz; z++) {
      var L = [];
      for (var y = 0; y < h; y++) {
        var row = '';
        for (var x = 0; x < w; x++) {
          var cnt = {}, n = 0, maxKeep = 0, c, k;
          for (k = 0; k < 8; k++) {
            var xx = 2 * x + (k & 1), yy = 2 * y + ((k >> 1) & 1), zz = 2 * z + (k >> 2);
            if (xx >= W || yy >= NY || zz >= NZ) continue;
            c = layers[zz][yy].charAt(xx);
            if (c === '.') continue;
            n++; cnt[c] = (cnt[c] || 0) + 1;
            var kp = (slots[c] && slots[c].keep) || 0;
            if (kp > maxKeep) maxKeep = kp;
          }
          var best = '.';
          if (maxKeep > 0 || n >= 4) {
            for (c in cnt) {
              if (maxKeep > 0 && ((slots[c] && slots[c].keep) || 0) !== maxKeep) continue;
              if (best === '.' || cnt[c] > cnt[best] || (cnt[c] === cnt[best] && c.charCodeAt(0) < best.charCodeAt(0))) best = c;
            }
          }
          row += best;
        }
        L.push(row);
      }
      out.push(L);
    }
    return out;
  }

  // ===================================================================================================================
  // 7. THE KIT
  // ===================================================================================================================
  // clothes (shells, 38.29 item 3: one paint char each; thick 0 repaints the body surface, thick n grows n layers)
  function sides(bone, t0, t1) { return SIDES.map(function (S) { return { bone: S + bone, t0: t0, t1: t1 }; }); }
  function buildShells() {
    return [
      // linen shirt, rolled sleeves (the top 30 % of the forearm = 3 rows below the elbow); the Neck stays bare (collar)
      { id: 'shirt', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Chest', t0: 0, t1: 1 }]
          .concat(sides('Shoulder', 0, 1), sides('UpperArm', 0, 1), sides('LowerArm', 0, 0.3)), thick: 0, paint: '2' },
      // trousers: hips to ankle (the boots cover the lower shin)
      { id: 'trousers', slot: 'legs', regions: [{ bone: 'Hips', t0: 0, t1: 1 }].concat(sides('UpperLeg', 0, 1), sides('LowerLeg', 0, 1)),
        thick: 0, paint: '5' },
      // leather boots: foot + toes + the lower 45 % of the shin (to z 9), one cell thick (the cuff steps out)
      { id: 'boots', slot: 'feet', regions: sides('LowerLeg', 0.55, 1).concat(sides('Foot', 0, 1), sides('Toes', 0, 1)), thick: 1, paint: '9' },
      // belt: the top two hip rows (z 33-34), one cell thick
      { id: 'belt', slot: 'outer', regions: [{ bone: 'Hips', t0: 0, t1: 0.25 }], thick: 1, paint: 'm' },
      // ---- knight pieces (CHARGEN-26, kit.looks.knight); the mail checker / trim / emblem come from the `heraldry` decal
      // chainmail hauberk: torso + shoulders + full sleeves to the wrist (thick 0, light grey)
      { id: 'mail', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Chest', t0: 0, t1: 1 }]
          .concat(sides('Shoulder', 0, 1), sides('UpperArm', 0, 1), sides('LowerArm', 0, 1)), thick: 0, paint: 'q' },
      // chainmail chausses: hips to ankle
      { id: 'mail_legs', slot: 'legs', regions: [{ bone: 'Hips', t0: 0, t1: 1 }].concat(sides('UpperLeg', 0, 1), sides('LowerLeg', 0, 1)),
        thick: 0, paint: 'q' },
      // dark boots + gloves (one paint: the feet dye's dark shade; knight look = gall, a dark grey), one cell thick
      { id: 'boots_gloves', slot: 'feet', regions: sides('LowerLeg', 0.55, 1).concat(sides('Foot', 0, 1), sides('Toes', 0, 1), sides('Hand', 0, 1)),
        thick: 1, paint: '9' },
      // white tabard (surcoat): chest, waist, hips and a split skirt to above the knee (UpperLeg t < 0.75 = z 18-27), one
      // cell thick; sleeveless, so the mail shows at the shoulders and arms
      { id: 'tabard', slot: 'outer', regions: [{ bone: 'Chest', t0: 0, t1: 1 }, { bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Hips', t0: 0, t1: 1 }]
          .concat(sides('UpperLeg', 0, 0.75)), thick: 1, paint: 'k' },
      // ---- CH1-D3 Fen: long wool tunic - torso, sleeves to just above the wrist (LowerArm t < 0.8 = z 33-40) and a
      // short skirt over the trousers (Hips + UpperLeg t < 0.3 = z 24-27); thick 0 so the arm / hip gap stays open.
      // Patches, strap, ragged hem come from the `mended` decal (beard slot)
      { id: 'tunic', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Chest', t0: 0, t1: 1 }, { bone: 'Hips', t0: 0, t1: 1 }]
          .concat(sides('Shoulder', 0, 1), sides('UpperArm', 0, 1), sides('LowerArm', 0, 0.8), sides('UpperLeg', 0, 0.3)), thick: 0, paint: '2' }
    ];
  }
  // random NPC weights (engine/chargen/random.js): trousers always, boots and hair mostly, shirt 3 in 4, belt 2 in 3,
  // a beard 1 in 3; the knight pieces never (they are a look, kit.looks.knight)
  var RANDOM = {
    hair: { none: 0.3 }, beard: { none: 2, full: 1, mended: 0 }, hat: { none: 1, heraldry: 0, staff: 0 },
    legs: { none: 0, trousers: 1, mail_legs: 0 }, feet: { none: 0.2, boots: 1, boots_gloves: 0 },
    top: { shirt: 3, mail: 0, tunic: 0 }, outer: { belt: 2, tabard: 0 }
  };
  // the knight look (D-063 reference): black short hair + full beard, mail, dark boots + gloves, white tabard + heraldry
  function knightLook() {
    return {
      v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'medium', eyes: 'brown',
      hair: { id: 'short', ramp: 'black' }, beard: { id: 'full', ramp: 'black' },
      top: { id: 'mail', ramp: 'undyed' }, legs: { id: 'mail_legs', ramp: 'undyed' }, feet: { id: 'boots_gloves', ramp: 'gall' },
      outer: { id: 'tabard', ramp: 'undyed' }, hat: { id: 'heraldry', ramp: 'undyed' }
    };
  }
  // red cross on gold (rows z 49 down to 41, X -3..3): a red outline round a gold Latin cross
  var EMBLEM = ['..RRR..', '..RyR..', 'RRRyRRR', 'RyyyyyR', 'RRRyRRR', '..RyR..', '..RyR..', '..RyR..', '..RRR..'];
  // the `heraldry` decal (hat slot, paintOnly: never adds voxels, keeps every bone): computed from the knight composed
  // WITHOUT it at height 0. Paints the chainmail checker (r on every odd x+y+z mail cell), the red sash (tabard z 34-35),
  // the red hem (z 18) and the red split trim (skirt cells |X| <= 1), and the emblem on the front-most tabard cells.
  // Anchor `belt` (z 33.5): the legs and sash stay aligned at every height (shin stretch rows z 4-7 lie below, waist
  // rows z 35-37 above: the chest emblem / sleeve checker may sit up to 2 rows low at |height| 4, still on the tabard).
  function buildHeraldry(kit) {
    var rc = knightLook(); rc.hat = null;
    var C = composePreview(kit, 'm_avg', rc), S = C.size, paint = {}, x, y, z, k, c, X;
    for (z = 0; z < S[2]; z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      k = x + S[0] * (y + S[1] * z); c = C.ch[k]; X = x - CX;
      var aX = Math.abs(X);
      // 26b: solid dark mail hems at the sleeve ends (z 31-32) and over the boots (z 8-9, above the shin stretch rows)
      if (c === 'q' && ((aX >= 10 && z <= 32) || (aX <= 8 && (z === 8 || z === 9)))) paint[k] = 'r';
      else if (c === 'q' && ((x + y + z) & 1)) paint[k] = 'r';
      // red trim: neckline + shoulder edge (z >= 50, 26b), sash, hem, split
      else if (c === 'k' && (z >= 50 || z === 34 || z === 35 || z === 18 || (z >= 18 && z <= 27 && aX <= 1))) paint[k] = 'R';
      else if (c === 'k' && z >= 19 && z <= 27 && aX === 4) paint[k] = 'u';   // skirt folds (26b)
      else if (c === '9' && z >= 29 && z <= 31 && aX >= 9) paint[k] = '8';    // glove cuffs (26b)
      else if (c === '9' && z === 28 && aX === 15) paint[k] = '7';            // glove knuckles (26b)
    }
    // gold belt buckle on the sash over the waistband bump (26b), front-most tabard cells, X -1..1, z 35 / 34 / 33
    var BUCKLE = { 35: 'yyy', 34: 'yRy', 33: 'yyy' };
    for (z = 33; z <= 35; z++) for (var bj = 0; bj < 3; bj++) {
      x = bj - 1 + CX;
      for (y = 0; y < S[1]; y++) {
        k = x + S[0] * (y + S[1] * z);
        if (C.ch[k] === '.') continue;
        if (C.ch[k] === 'k') paint[k] = BUCKLE[z].charAt(bj);
        break;
      }
    }
    EMBLEM.forEach(function (rowS, r) {
      z = 49 - r;
      for (var j = 0; j < rowS.length; j++) {
        var e = rowS.charAt(j);
        if (e === '.') continue;
        x = j - 3 + CX;
        for (y = 0; y < S[1]; y++) {
          k = x + S[0] * (y + S[1] * z);
          if (C.ch[k] === '.') continue;
          if (C.ch[k] === 'k') paint[k] = e;
          break;
        }
      }
    });
    var z0 = SZ, z1 = -1;
    for (var key in paint) { z = Math.floor(+key / (S[0] * S[1])); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    var layers = [];
    for (z = z0; z <= z1; z++) {
      var L = [];
      for (y = 0; y < S[1]; y++) {
        var row = '';
        for (x = 0; x < S[0]; x++) row += paint[x + S[0] * (y + S[1] * z)] || '.';
        L.push(row);
      }
      layers.push(L);
    }
    // anchor belt = cell centre (18.5, 6.5, 33.5): offset puts the box origin on grid (0, 0, z0)
    return { id: 'heraldry', slot: 'hat', bone: 'Chest', anchor: 'belt', offset: [-18.5, -6.5, z0 - 33.5],
             box: [S[0], S[1], z1 - z0 + 1], paintOnly: true, layers: layers };
  }

  // ===================================================================================================================
  // CH1-D3 Fen (D-063 style): a lone wanderer - weathered (warm skin, grey eyes), brown hair + stubble, a faded sage
  // tunic and grey trousers mended with scraps of each other and dark linen, a walnut belt and shoulder-bag strap,
  // worn walnut boots, an old walnut travelling staff in the right hand. No new palette keys (natural dyes only).
  // ===================================================================================================================
  function fenLook() {
    return {
      v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'warm', eyes: 'grey',
      hair: { id: 'short', ramp: 'brown' }, beard: { id: 'mended', ramp: 'brown' },
      top: { id: 'tunic', ramp: 'lincoln' }, legs: { id: 'trousers', ramp: 'gall' }, feet: { id: 'boots', ramp: 'walnut' },
      outer: { id: 'belt', ramp: 'walnut' }, hat: { id: 'staff', ramp: 'walnut' }
    };
  }
  // the staff (hat slot: the only free attachment slot; bone RightHand so it swings with the hand). Box X 11..14,
  // Y -6..-3 (in front of the fist: the thumb is Y -3, the forearm Y -2..2, so the shaft never touches the arm), z 0..66
  // (1.68 m, the iron ferrule on the ground). 2 x 2 shaft X 12-13 / Y -5..-4; wood = the hat dye (H h j, Fen: walnut)
  // with a lit front-right edge and a dark back-left grain, three knots, a leather grip wrap above + below the fist
  // (m / w = outer dye), the fist (skin a / s / l + a nail n) wrapped round the shaft at z 26-28 so it reads as held,
  // a worn knob z 61-66, a linen cord (U) tied under the knob with a dangling weld-gold bead (y).
  var STAFF_BOX = { X0: 11, Y0: -6, z0: 0, w: 4, d: 4, h: 67 };
  function staffChar(X, Y, z) {
    var sh = X >= 12 && X <= 13 && Y >= -5 && Y <= -4;
    if (z >= 26 && z <= 28 && !sh) {                                       // the fist round the shaft
      var ring = Y === -6 || (X === 14 && Y >= -5) || (X === 11 && Y <= -4);
      if (!ring) return null;                                              // X 12-13 / X 11 at Y -3 = the thumb side
      if (Y === -6 && (X === 11 || X === 14) && z !== 27) return null;     // rounded fist corners
      if (X === 11 && Y === -5 && z === 27) return 'n';                    // finger tip on the palm side
      if (z === 26) return 's';
      if (z === 28 && Y === -6) return X === 12 ? 'l' : 's';               // knuckles
      return 'a';
    }
    if (z >= 61 && z <= 64) {                                              // the knob, 4 x 4 minus corners
      if ((X === 11 || X === 14) && (Y === -6 || Y === -3)) return null;
      if (z === 61) return 'j';
      if (z === 64) return (X === 11 || Y === -3) ? 'h' : 'H';
      return (X === 14 || Y === -6) ? 'H' : (X === 11 || Y === -3) ? 'j' : 'h';
    }
    if (z === 65) return sh ? (X === 13 && Y === -5 ? 'H' : 'h') : null;
    if (z === 66) return X === 13 && Y === -5 ? 'H' : null;
    if (!sh) {
      if (X === 14 && Y === -5 && z >= 55 && z <= 59) return 'U';          // the dangling cord
      if (X === 14 && Y === -5 && z === 54) return 'y';                    // its bead
      if ((z === 12 && X === 14 && Y === -5) || (z === 37 && X === 11 && Y === -4) || (z === 47 && X === 14 && Y === -4)) return 'j';   // knots
      return null;
    }
    if (z === 0) return 'r';                                               // iron ferrule
    if (z <= 2) return X === 13 && Y === -5 ? 'q' : 'r';
    if (z === 59 || z === 60) return 'U';                                  // the cord tied round the neck of the staff
    if ((z >= 29 && z <= 33) || (z >= 23 && z <= 25)) return (z & 1) ? 'm' : 'w';   // grip wrap
    if (X === 13 && Y === -5) return z % 7 === 3 ? 'h' : 'H';              // lit edge
    if (X === 12 && Y === -4) return 'j';                                  // shadowed grain
    return z % 9 === 4 ? 'j' : 'h';
  }
  function buildStaff() {
    var layers = [], x, y, z;
    for (z = 0; z < STAFF_BOX.h; z++) {
      var L = [];
      for (y = 0; y < STAFF_BOX.d; y++) {
        var row = '';
        for (x = 0; x < STAFF_BOX.w; x++) row += staffChar(STAFF_BOX.X0 + x, STAFF_BOX.Y0 + y, STAFF_BOX.z0 + z) || '.';
        L.push(row);
      }
      layers.push(L);
    }
    // hand_r = cell centre (31.5, 10, 28.5): the offset puts the box origin on grid (29, 4, 0) = X 11, Y -6, z 0
    return { id: 'staff', slot: 'hat', bone: 'RightHand', anchor: 'hand_r', offset: [-2.5, -6, -28.5],
             box: [STAFF_BOX.w, STAFF_BOX.d, STAFF_BOX.h], layers: layers };
  }
  // the `mended` decal (beard slot, paintOnly; the hat slot holds the staff and a shell paints one char - engine ask in
  // design/README.md section 25): computed from Fen composed WITHOUT it and without the staff, at height 0.
  //   stubble: Jaw skin = a K / g checker (short dark growth), Head skin z 58-62 = sparse K (upper lip, jaw line,
  //     sideburns |X| >= 6); the beard pick (Fen: brown) dyes it.
  //   patches: rectangles projected on the front / back / right-side cloth, a dotted stitch edge (top / legs dark):
  //     tunic = dark linen (U) or the trouser cloth (4), trousers = the tunic cloth (1) or dark linen.
  //   bag strap (outer dark m, 2 wide) from the right shoulder to the left side, front and back; ragged tunic hem (3);
  //   worn boots: a folded cuff (8) on the top boot row, an ankle crease (8) and scuffed toe caps (7).
  // Rigid like `heraldry` (anchor belt): meant for height 0 / res 1 (Fen's recipe); at res head 2 the stubble is not
  // painted (it rides the Chest bone in the main grid).
  function buildMended(kit) {
    var rc = fenLook(); rc.beard = null; rc.hat = null;
    var C = composePreview(kit, 'm_avg', rc), S = C.size, paint = {}, x, y, z, k, c, X, Y, u;
    var HEAD = C.names.indexOf('Head'), JAW = C.names.indexOf('Jaw');
    function key(xx, yy, zz) { return xx + S[0] * (yy + S[1] * zz); }
    function proj(face, uu, zz) {   // the outermost filled cell seen from a face (u = X for front / back, Y for right)
      var n = face === 'right' ? S[0] : S[1], i, kk;
      for (i = 0; i < n; i++) {
        kk = face === 'front' ? key(uu + CX, i, zz) : face === 'back' ? key(uu + CX, S[1] - 1 - i, zz) : key(S[0] - 1 - i, uu + CY, zz);
        if (C.ch[kk] !== '.') return kk;
      }
      return -1;
    }
    // stubble
    for (z = 51; z <= 62; z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      k = key(x, y, z); c = C.ch[k]; X = x - CX; Y = y - CY;
      if ((c !== 'a' && c !== 's' && c !== 'l') || Y > 0) continue;
      if (C.bone[k] === JAW) paint[k] = ((x + z) & 1) ? 'g' : 'K';
      else if (C.bone[k] === HEAD && ((x + y + z) & 1) && (z <= 59 || (Math.abs(X) >= 6 && Y >= -3))) paint[k] = 'K';
    }
    // patches: [face, u0, u1, z0, z1, cloth char, patch char, stitch char]
    var PATCHES = [
      ['front', -6, -3, 43, 46, '2', 'U', '3'],    // left chest: dark linen on the tunic
      ['back', -6, -3, 44, 47, '2', '4', '3'],     // left shoulder blade: a scrap of the trouser cloth
      ['right', -1, 2, 38, 41, '2', 'U', '3'],     // right elbow, outer side
      ['back', -14, -11, 38, 41, '2', '4', '3'],   // left elbow, back
      ['front', 3, 6, 13, 16, '5', '1', '6'],      // right knee: a scrap of the tunic cloth
      ['front', -7, -4, 19, 22, '5', 'U', '6']     // left thigh
    ];
    PATCHES.forEach(function (p) {
      for (z = p[3]; z <= p[4]; z++) for (u = p[1]; u <= p[2]; u++) {
        k = proj(p[0], u, z);
        if (k < 0 || C.ch[k] !== p[5]) continue;
        var edge = u === p[1] || u === p[2] || z === p[3] || z === p[4];
        paint[k] = edge && ((u + z) & 1) ? p[7] : p[6];
      }
    });
    // bag strap: right shoulder (X 6, z 49) down to the left side (X -6, z 35), 2 cells wide, front + back
    for (z = 35; z <= 49; z++) {
      var sx = Math.round(6 - (49 - z) * 12 / 14);
      ['front', 'back'].forEach(function (f) {
        for (u = sx - 1; u <= sx; u++) { k = proj(f, u, z); if (k >= 0 && C.ch[k] === '2' && !paint[k]) paint[k] = 'm'; }
      });
    }
    // ragged hem (the tunic's two lowest rows) + worn boots
    var hem = SZ, bootTop = -1;
    for (k = 0; k < C.ch.length; k++) {
      z = Math.floor(k / (S[0] * S[1]));
      if (C.ch[k] === '2' && z < 30) hem = Math.min(hem, z);
      if (C.ch[k] === '9') bootTop = Math.max(bootTop, z);
    }
    for (z = 0; z < S[2] && z <= Math.max(hem + 1, bootTop); z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      k = key(x, y, z); c = C.ch[k]; Y = y - CY;
      if (c === '2' && (z === hem && x % 3 === 0 || z === hem + 1 && x % 6 === 0)) paint[k] = '3';
      else if (c === '9' && z === bootTop) paint[k] = '8';                              // folded cuff
      else if (c === '9' && z === 4 && Y < 0 && (x & 1)) paint[k] = '8';                // ankle crease
      else if (c === '9' && z >= 1 && z <= 2 && Y <= -5 && (x + z) % 3 === 0) paint[k] = '7';   // scuffed toe caps
    }
    var z0 = SZ, z1 = -1, keyS;
    for (keyS in paint) { z = Math.floor(+keyS / (S[0] * S[1])); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    var layers = [];
    for (z = z0; z <= z1; z++) {
      var L = [];
      for (y = 0; y < S[1]; y++) {
        var row = '';
        for (x = 0; x < S[0]; x++) row += paint[key(x, y, z)] || '.';
        L.push(row);
      }
      layers.push(L);
    }
    // anchor belt = cell centre (18.5, 6.5, 33.5): offset puts the box origin on grid (0, 0, z0)
    return { id: 'mended', slot: 'beard', bone: 'Chest', anchor: 'belt', offset: [-18.5, -6.5, z0 - 33.5],
             box: [S[0], S[1], z1 - z0 + 1], paintOnly: true, layers: layers };
  }

  function buildHumanKit(P) {
    var CG = P.chargen;
    if (!CG) throw new Error('human_kit: palette.chargen missing (load design/palette.js v1.54+)');
    var bones = boneTable(), layers = buildBase();
    function mount(X, Y, z) { return gridJoint([X, Y, z]); }   // anchors: [x,y,z] cells; the bone = the box it sits in
    var kit = {
      kind: 'charkit',
      schema: 1,
      id: KIT_ID,
      name: 'Kestrel human kit v0 (CHARGEN-01)',
      cellM: CELL,
      axes: 'cells; x = east (the character\'s right), y = south (the character faces north, -y), z = up; ' +
            'layers[z][y] = string of x; joints / anchors / mount positions are continuous cell coordinates',
      skeleton: SKELETON,
      partMap: PART_MAP,
      // 38.34: finer head grid. regions box = level-1 cells, inclusive; resLevels = the offered cells per 2.5 cm
      regions: { head: { bones: HEAD_REGION.bones.slice(), box: gridBox(HEAD_REGION.box) } },
      resLevels: { body: [1], head: [1, 2] },
      slots: SLOTS,
      ramps: buildRamps(CG),
      handTint: CG.handTint,
      bases: {
        m_avg: {
          label: 'Man, average build (1.75 m)',
          heightM: 1.75,
          size: [SX, SY, SZ],
          anchor: [CX + 0.5, CY + 0.5, 0],
          bones: bones,
          anchors: {
            head_top: mount(0, -0.5, 69.5),
            eyes: mount(0, -6.0, 63.0),   // 26b: the eyes are rows z 62-63
            mouth: mount(0, -6.0, 57.5),
            hand_r: mount(13.0, -0.5, 28.5),
            hand_l: mount(-13.0, -0.5, 28.5),
            back: mount(0, 4.5, 45.0),
            belt: mount(0, -4.0, 33.5)
          },
          // height (-4..4): CHARGEN-05 (engine/chargen/height.js) duplicates / deletes |height| rows picked evenly
          // over this sorted list. 4 lower-shin rows z 4-7 (LowerLeg only, inside the boots) + 3 waist rows z 35-37
          // (Spine beside both forearms) - clear of every hand box (z 24-30) and the head region (z 51+). The heraldry
          // decal (anchor belt z 33.5) relies on no stretch row between z 8 and z 34.
          stretchRows: [4, 5, 6, 7, 35, 36, 37],
          layers: layers,
          // the head at 1.25 cm (level 2 of region head) = a straight 2x upsample of the level-1 head (CHARGEN-25)
          detail: { head: { '2': { layers: buildHeadL2(layers, bones) } } }
        }
      },
      shells: buildShells(),
      attachments: [
        // short hair; head_top = cell centre (18.5, 10, 69.5), so the offset puts the box origin on X -8, Y -6, z 58
        { id: 'short', slot: 'hair', bone: 'Head', anchor: 'head_top', offset: [-8.5, -6, -11.5],
          box: [HAIR_BOX.w, HAIR_BOX.d, HAIR_BOX.h], layers: buildHair() },
        // full beard + moustache; mouth = cell centre (18.5, 4.5, 57.5), so the box origin lands on X -8, Y -8, z 51
        { id: 'full', slot: 'beard', bone: 'Jaw', anchor: 'mouth', offset: [-8.5, -2.5, -6.5],
          box: [BEARD_BOX.w, BEARD_BOX.d, BEARD_BOX.h], layers: buildBeard() }
      ],
      clips: {},
      random: RANDOM,
      defaults: {
        v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'medium', eyes: 'brown',
        hair: { id: 'short', ramp: 'darkbrown' }, beard: null,
        top: { id: 'shirt', ramp: 'undyed' }, legs: { id: 'trousers', ramp: 'walnut' }, feet: { id: 'boots', ramp: 'walnut' },
        outer: { id: 'belt', ramp: 'walnut' }, hat: null
      },
      // named looks (CHARGEN-26): full recipes a game / UI may start from; civilian = defaults
      looks: { knight: knightLook(), fen: fenLook() }
    };
    kit.attachments.push(buildHeraldry(kit));
    // CH1-D3 Fen: the held staff (hat slot) and the mended decal (beard slot), appended after the knight pieces
    kit.attachments.push(buildStaff());
    kit.attachments.push(buildMended(kit));
    return kit;
  }

  // deterministic JSON text: 2-space indent, short number arrays on one line, trailing newline
  function stringifyKit(kit) {
    return JSON.stringify(kit, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, function (m, inner) {
      return '[' + inner.replace(/,\s+/g, ', ') + ']';
    }) + '\n';
  }

  // ===================================================================================================================
  // 8. PREVIEW / TEST HELPERS (not the engine: CHARGEN-02/03 implement compose + mesh in engine/chargen)
  // ===================================================================================================================
  function decodeBase(kit, baseId) {
    var B = kit.bases[baseId], S = B.size, n = S[0] * S[1] * S[2];
    var ch = new Array(n), bone = new Int16Array(n).fill(-2), names = kit.skeleton.map(function (b) { return b.name; });
    var x, y, z, q, i;
    for (z = 0; z < S[2]; z++) for (y = 0; y < S[1]; y++) {
      var row = B.layers[z][y];
      for (x = 0; x < S[0]; x++) {
        q = x + S[0] * (y + S[1] * z);
        var c = row.charAt(x);
        ch[q] = c;
        if (c === '.') continue;
        bone[q] = -1;
        for (i = 0; i < names.length; i++) {
          var b = B.bones[names[i]].box;
          if (x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]) { bone[q] = i; break; }
        }
      }
    }
    return {
      size: S, ch: ch, bone: bone, names: names,
      at: function (x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= S[0] || y >= S[1] || z >= S[2]) return -1;
        var k = x + S[0] * (y + S[1] * z);
        return ch[k] === '.' ? -1 : k;
      }
    };
  }
  // preview twin of engine/chargen/compose.js at res 1/1 and height 0: base -> shells (legs, feet, top, outer) ->
  // attachments (hair, beard, hat); no blocks, no elder overlay. Returns a decodeBase-like grid of SLOT CHARS (the shell
  // paint / attachment chars), so the preview colours it with resolveMat(kit, recipe, ch) like the base.
  // tools/chargen-kit.test.mjs pins it cell by cell to the engine's composeCharacter for kit.defaults.
  var SHELL_SLOTS = ['legs', 'feet', 'top', 'outer'], ATTACH_SLOTS = ['hair', 'beard', 'hat'];
  var NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function composePreview(kit, baseId, recipe) {
    var D = decodeBase(kit, baseId), S = D.size, B = kit.bases[baseId], N = S[0] * S[1] * S[2];
    var ch = D.ch.slice(), bone = new Int16Array(N), names = D.names, i;
    for (i = 0; i < N; i++) bone[i] = D.bone[i];
    function item(slot, id) {
      var all = (kit.shells || []).concat(kit.attachments || []);
      for (var j = 0; j < all.length; j++) if (all[j].slot === slot && all[j].id === id) return all[j];
      return null;
    }
    function filled(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < S[0] && y < S[1] && z < S[2] && ch[x + S[0] * (y + S[1] * z)] !== '.'; }
    var hidden = {};
    ATTACH_SLOTS.forEach(function (slot) {
      var p = recipe[slot], it = p ? item(slot, p.id) : null;
      if (it && it.hides) it.hides.forEach(function (h) { hidden[h] = 1; });
    });
    SHELL_SLOTS.forEach(function (slot) {
      var p = recipe[slot], sh = p && !hidden[slot] ? item(slot, p.id) : null;
      if (!sh) return;
      var inR = new Uint8Array(N), any = false, x, y, z, k, n;
      sh.regions.forEach(function (r) {
        var bi = names.indexOf(r.bone), q = B.bones[r.bone] && B.bones[r.bone].box;
        if (!q) return;
        var h = q[5] - q[2] + 1;
        for (var zz = q[2]; zz <= q[5]; zz++) {
          var t = (q[5] + 1 - (zz + 0.5)) / h;
          if (t < r.t0 || t >= r.t1) continue;
          for (var yy = 0; yy < S[1]; yy++) for (var xx = 0; xx < S[0]; xx++) {
            var kk = xx + S[0] * (yy + S[1] * zz);
            if (ch[kk] !== '.' && bone[kk] === bi) { inR[kk] = 1; any = true; }
          }
        }
      });
      if (!any) return;
      var frontier = [];
      for (z = 0; z < S[2]; z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
        k = x + S[0] * (y + S[1] * z);
        if (!inR[k]) continue;
        for (n = 0; n < 6; n++) if (!filled(x + NB6[n][0], y + NB6[n][1], z + NB6[n][2])) { frontier.push(k); break; }
      }
      frontier.forEach(function (q) { ch[q] = sh.paint; });
      for (var layer = 0; layer < sh.thick; layer++) {
        var grown = {}, cells = [];
        frontier.forEach(function (q) {
          var qx = q % S[0], qy = Math.floor(q / S[0]) % S[1], qz = Math.floor(q / (S[0] * S[1]));
          for (var m = 0; m < 6; m++) {
            var nx = qx + NB6[m][0], ny = qy + NB6[m][1], nz = qz + NB6[m][2];
            if (nx < 0 || ny < 0 || nz < 0 || nx >= S[0] || ny >= S[1] || nz >= S[2] || filled(nx, ny, nz)) continue;
            var j = nx + S[0] * (ny + S[1] * nz);
            if (grown[j] === undefined) { grown[j] = bone[q]; cells.push(j); }
          }
        });
        cells.sort(function (a, b) { return a - b; });
        cells.forEach(function (j) { ch[j] = sh.paint; bone[j] = grown[j]; });
        frontier = cells;
      }
    });
    ATTACH_SLOTS.forEach(function (slot) {
      var p = recipe[slot], a = p && !hidden[slot] ? item(slot, p.id) : null;
      if (!a) return;
      var anc = B.anchors[a.anchor], ox = anc[0] + a.offset[0], oy = anc[1] + a.offset[1], oz = anc[2] + a.offset[2];
      var bi = names.indexOf(a.bone);
      for (var z = 0; z < a.box[2]; z++) for (var y = 0; y < a.box[1]; y++) for (var x = 0; x < a.box[0]; x++) {
        var c = a.layers[z][y].charAt(x);
        if (c === '.' || c === ' ') continue;
        var cx = Math.round(ox + x), cy = Math.round(oy + y), cz = Math.round(oz + z);
        if (cx < 0 || cy < 0 || cz < 0 || cx >= S[0] || cy >= S[1] || cz >= S[2]) continue;
        var k = cx + S[0] * (cy + S[1] * cz);
        if (a.paintOnly && ch[k] === '.') continue;
        ch[k] = c;
        if (!a.paintOnly) bone[k] = bi;
      }
    });
    return {
      size: S, ch: ch, bone: bone, names: names,
      at: function (x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= S[0] || y >= S[1] || z >= S[2]) return -1;
        var k = x + S[0] * (y + S[1] * z);
        return ch[k] === '.' ? -1 : k;
      }
    };
  }
  // a base's authored detail level as a decodeBase-like grid (block cells; bone = first region bone box x L that holds it,
  // or detail.bones[name].box in block cells when given; -1 = outside every box)
  function decodeDetail(kit, baseId, region, L) {
    var B = kit.bases[baseId], R = kit.regions[region], bx = R.box, det = B.detail[region][String(L)];
    var S = [(bx[3] - bx[0] + 1) * L, (bx[4] - bx[1] + 1) * L, (bx[5] - bx[2] + 1) * L], n = S[0] * S[1] * S[2];
    var names = kit.skeleton.map(function (b) { return b.name; }), order = names.filter(function (nm) { return R.bones.indexOf(nm) >= 0; });
    var boxes = order.map(function (nm) {
      if (det.bones && det.bones[nm]) return det.bones[nm].box;
      var b = B.bones[nm].box;
      return [(b[0] - bx[0]) * L, (b[1] - bx[1]) * L, (b[2] - bx[2]) * L, (b[3] - bx[0] + 1) * L - 1, (b[4] - bx[1] + 1) * L - 1, (b[5] - bx[2] + 1) * L - 1];
    });
    var ch = new Array(n), bone = new Int16Array(n).fill(-2), x, y, z, q, i;
    for (z = 0; z < S[2]; z++) for (y = 0; y < S[1]; y++) {
      var row = det.layers[z] && det.layers[z][y] || '';
      for (x = 0; x < S[0]; x++) {
        q = x + S[0] * (y + S[1] * z);
        var c = row.charAt(x) || '.';
        ch[q] = c;
        if (c === '.') continue;
        bone[q] = -1;
        for (i = 0; i < boxes.length; i++) {
          var b2 = boxes[i];
          if (x >= b2[0] && x <= b2[3] && y >= b2[1] && y <= b2[4] && z >= b2[2] && z <= b2[5]) { bone[q] = names.indexOf(order[i]); break; }
        }
      }
    }
    return {
      size: S, ch: ch, bone: bone, names: names, origin: bx.slice(0, 3), k: L,
      at: function (x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= S[0] || y >= S[1] || z >= S[2]) return -1;
        var k = x + S[0] * (y + S[1] * z);
        return ch[k] === '.' ? -1 : k;
      }
    };
  }
  // detail checks (38.34 validateKit twin for the designer data): size, level offered, chars, bone boxes, seam rule;
  // stats: voxels, quads, and how many level-1 region cells differ after downsample2 (the authored level 1 still wins)
  function checkDetail(kit, bid, errors, out) {
    var B = kit.bases[bid], D1 = decodeBase(kit, bid), rn, Ls;
    for (rn in B.detail) {
      var R = kit.regions && kit.regions[rn];
      if (!R) { errors.push(bid + ': detail.' + rn + ' has no kit.regions entry'); continue; }
      var bx = R.box;
      R.bones.forEach(function (bn) { if (!B.bones[bn]) errors.push('regions.' + rn + ': unknown bone ' + bn); });
      for (Ls in B.detail[rn]) {
        var L = +Ls, lay = B.detail[rn][Ls].layers, S = [(bx[3] - bx[0] + 1) * L, (bx[4] - bx[1] + 1) * L, (bx[5] - bx[2] + 1) * L];
        var tag = bid + ': detail.' + rn + '["' + Ls + '"]';
        if (L !== 2 && L !== 4) { errors.push(tag + ': level must be 2 or 4'); continue; }
        if (!(kit.resLevels && kit.resLevels[rn] && kit.resLevels[rn].indexOf(L) >= 0)) errors.push(tag + ': level not in kit.resLevels.' + rn);
        if (!Array.isArray(lay) || lay.length !== S[2] || lay.some(function (p) { return p.length !== S[1] || p.some(function (r) { return r.length !== S[0]; }); })) {
          errors.push(tag + ': size is not box extent x ' + L + ' (' + S.join('x') + ')'); continue;
        }
        var D = decodeDetail(kit, bid, rn, L), unknown = {}, outside = 0, seam = 0, vox = 0, q;
        for (q = 0; q < D.ch.length; q++) {
          if (D.ch[q] === '.') continue;
          vox++;
          if (!kit.slots[D.ch[q]]) unknown[D.ch[q]] = 1;
          if (D.bone[q] < 0) outside++;
          var x = q % S[0], y = Math.floor(q / S[0]) % S[1], z = Math.floor(q / (S[0] * S[1]));
          var k1 = D1.at(bx[0] + Math.floor(x / L), bx[1] + Math.floor(y / L), bx[2] + Math.floor(z / L));
          if (k1 >= 0 && D1.bone[k1] >= 0 && R.bones.indexOf(D1.names[D1.bone[k1]]) < 0) seam++;
        }
        if (Object.keys(unknown).length) errors.push(tag + ': unknown slot chars ' + Object.keys(unknown).join(''));
        if (outside) errors.push(tag + ': ' + outside + ' voxels outside every region bone box');
        if (seam) errors.push(tag + ': ' + seam + ' voxels over level-1 cells of a non-region bone (seam rule)');
        // downsample back to level 1 and compare with the authored region cells
        var ds = lay, dsS = S.slice(), lv = L;
        while (lv > 1) { ds = downsample2(ds, dsS, kit.slots); dsS = dsS.map(function (v) { return Math.ceil(v / 2); }); lv /= 2; }
        var diff = [];
        for (z = 0; z < dsS[2]; z++) for (y = 0; y < dsS[1]; y++) for (x = 0; x < dsS[0]; x++) {
          var k2 = D1.at(bx[0] + x, bx[1] + y, bx[2] + z), c1 = '.';
          if (k2 >= 0 && D1.bone[k2] >= 0 && R.bones.indexOf(D1.names[D1.bone[k2]]) >= 0) c1 = D1.ch[k2];
          var c2 = ds[z][y].charAt(x);
          if (c1 !== c2) diff.push([bx[0] + x, bx[1] + y, bx[2] + z, c1, c2]);
        }
        var matIds = {}, mOf = function (ch) { var m = resolveMat(kit, kit.defaults, ch) || ch; if (!matIds[m]) matIds[m] = Object.keys(matIds).length + 1; return matIds[m]; };
        out[rn + Ls] = { region: rn, level: L, size: S, voxels: vox, quads: countQuads(D, mOf), downsampleDiff: diff.length, diffCells: diff };
      }
    }
  }
  // same ramp pick as engine/chargen/compose.js rampFor (base layer, no shell pick)
  function resolveMat(kit, recipe, c) {
    var sl = kit.slots[c];
    if (!sl) return null;
    if (sl.fixed) return sl.fixed;
    var g = sl.group, set = kit.ramps[g], id;
    if (!set) return null;
    if (g === 'skin' || g === 'eyes') id = recipe[g];
    else if (g === 'lips') id = recipe.skin;
    else if (g === 'hair') id = (recipe.hair || recipe.beard || {}).ramp;
    else id = recipe[g] ? recipe[g].ramp : undefined;
    var r = set[id] || set[Object.keys(set)[0]];
    return r ? r[sl.shade] || null : null;
  }
  // per-bone culled, greedy-merged quad count (same rule as meshCharacter: never across bones)
  function countQuads(D, matOf) {
    var S = D.size, n = 0, a, sg;
    for (a = 0; a < 3; a++) {
      var u = (a + 1) % 3, v = (a + 2) % 3;
      for (sg = -1; sg <= 1; sg += 2) for (var sl = 0; sl < S[a]; sl++) {
        var W = S[u], H = S[v], mask = new Int32Array(W * H), p = [0, 0, 0], q = [0, 0, 0], i, j, t;
        for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
          p[a] = sl; p[u] = i; p[v] = j;
          var k = D.at(p[0], p[1], p[2]);
          if (k < 0) continue;
          q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[a] += sg;
          var k2 = D.at(q[0], q[1], q[2]);
          if (k2 >= 0 && D.bone[k2] === D.bone[k]) continue;
          mask[i + j * W] = (D.bone[k] + 2) * 4096 + matOf(D.ch[k]);
        }
        for (j = 0; j < H; j++) for (i = 0; i < W;) {
          var m = mask[i + j * W];
          if (!m) { i++; continue; }
          var w = 1; while (i + w < W && mask[i + w + j * W] === m) w++;
          var h = 1, ok = true;
          while (j + h < H && ok) { for (t = 0; t < w; t++) if (mask[i + t + (j + h) * W] !== m) { ok = false; break; } if (ok) h++; }
          for (var hh = 0; hh < h; hh++) for (t = 0; t < w; t++) mask[i + t + (j + hh) * W] = 0;
          n++; i += w;
        }
      }
    }
    return n;
  }
  // kit checks shared by the preview and tools/chargen-kit.test.mjs
  function checkKit(kit, P, DP) {
    var errors = [], warnings = [], stats = {};
    var names = kit.skeleton.map(function (b) { return b.name; });
    if (names.length !== 22) errors.push('skeleton has ' + names.length + ' bones, want 22');
    kit.skeleton.forEach(function (b, i) {
      if (b.parent !== null && names.indexOf(b.parent) < 0) errors.push('bone ' + b.name + ': unknown parent ' + b.parent);
      if (b.parent !== null && names.indexOf(b.parent) > i) errors.push('bone ' + b.name + ': parent listed later');
    });
    // partMap: engine array form [{name, bones, parent, compose?}], <= MAX_PARTS, parents first, every bone once
    var PM = kit.partMap;
    if (!Array.isArray(PM)) errors.push('partMap is not an array (engine collapseRig form)');
    else {
      if (PM.length > MAX_PARTS) errors.push('partMap has ' + PM.length + ' parts, max ' + MAX_PARTS);
      var pSeen = {}, bSeen = {};
      PM.forEach(function (p, pi) {
        if (!p || typeof p.name !== 'string' || !Array.isArray(p.bones) || !p.bones.length) { errors.push('partMap[' + pi + ']: needs name + bones'); return; }
        if (pSeen[p.name]) errors.push('partMap: part ' + p.name + ' twice');
        if (p.parent !== null && !pSeen[p.parent]) errors.push('partMap: part ' + p.name + ': parent ' + p.parent + ' not listed before it');
        if (p.compose !== undefined && !(p.compose === Math.floor(p.compose) && p.compose >= 1 && p.compose <= p.bones.length)) errors.push('partMap: part ' + p.name + ': bad compose ' + p.compose);
        p.bones.forEach(function (bn) {
          if (names.indexOf(bn) < 0) errors.push('partMap: part ' + p.name + ': unknown bone ' + bn);
          if (bSeen[bn]) errors.push('partMap: bone ' + bn + ' in ' + bSeen[bn] + ' and ' + p.name); else bSeen[bn] = p.name;
        });
        pSeen[p.name] = 1;
      });
      names.forEach(function (bn) { if (!bSeen[bn]) errors.push('partMap: bone ' + bn + ' in no part'); });
    }
    var keys = {}, mk;
    for (var grp in kit.ramps) for (var id in kit.ramps[grp]) for (var sh in kit.ramps[grp][id]) keys[kit.ramps[grp][id][sh]] = 1;
    for (var c in kit.slots) if (kit.slots[c].fixed) keys[kit.slots[c].fixed] = 1;
    for (var t in kit.handTint) for (var hk in kit.handTint[t]) { keys[kit.handTint[t][hk]] = 1; if (!P.materials[hk]) errors.push('handTint: ' + hk + ' is not a hand material'); }
    stats.materialKeys = Object.keys(keys).length;
    for (mk in keys) {
      if (!P.materials[mk]) errors.push('unknown material ' + mk);
      if (DP && !DP.materials[mk] && !(DP.remap && DP.remap[mk])) errors.push('no detail-pass v2 record for ' + mk);
    }
    for (c in kit.slots) { var s = kit.slots[c]; if (!s.fixed && !kit.ramps[s.group]) errors.push('slot ' + c + ': group ' + s.group + ' has no ramps'); }
    for (var g in kit.ramps) for (var rid in kit.ramps[g]) for (c in kit.slots) {
      if (kit.slots[c].group === g && !kit.ramps[g][rid][kit.slots[c].shade]) errors.push('ramps.' + g + '.' + rid + ': no shade ' + kit.slots[c].shade);
    }
    stats.bases = {};
    for (var bid in kit.bases) {
      var B = kit.bases[bid], D = decodeBase(kit, bid), cnt = {}, outside = 0, unknownCh = {}, vox = 0, top = -1, minY = 99, maxY = -1, minX = 99, maxX = -1;
      names.forEach(function (n) { cnt[n] = 0; if (!B.bones[n]) errors.push(bid + ': no joint / box for ' + n); });
      for (var q = 0; q < D.ch.length; q++) {
        if (D.ch[q] === '.') continue;
        vox++;
        if (!kit.slots[D.ch[q]]) unknownCh[D.ch[q]] = 1;
        if (D.bone[q] < 0) outside++; else cnt[names[D.bone[q]]]++;
        var x = q % B.size[0], y = Math.floor(q / B.size[0]) % B.size[1], z = Math.floor(q / (B.size[0] * B.size[1]));
        top = Math.max(top, z); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      }
      if (outside) errors.push(bid + ': ' + outside + ' voxels outside every bone box');
      if (Object.keys(unknownCh).length) errors.push(bid + ': unknown slot chars ' + Object.keys(unknownCh).join(''));
      names.forEach(function (n) { if (!cnt[n]) warnings.push(bid + ': bone ' + n + ' owns no voxel'); });
      var stretchBad = [];
      (B.stretchRows || []).forEach(function (z) {
        if (!(z === Math.floor(z) && z >= 0 && z < B.size[2])) { stretchBad.push(z + ':not a row'); return; }
        var inRow = {};
        for (var q2 = z * B.size[0] * B.size[1]; q2 < (z + 1) * B.size[0] * B.size[1]; q2++) if (D.bone[q2] >= 0) inRow[names[D.bone[q2]]] = 1;
        for (var bn in inRow) {
          if (STRETCH_BONES.indexOf(bn) < 0) stretchBad.push(z + ':' + bn);
          else if (ARM_STRETCH[bn] && !inRow[ARM_STRETCH[bn]]) stretchBad.push(z + ':' + bn + ' without ' + ARM_STRETCH[bn]);
        }
        // never a hand box: the row may not cut any Hand box (even where the hand owns no voxel in that row)
        names.forEach(function (bn2) {
          var hb = B.bones[bn2] && B.bones[bn2].box;
          if (/Hand$/.test(bn2) && hb && z >= hb[2] && z <= hb[5]) stretchBad.push(z + ':' + bn2 + ' box');
        });
      });
      if (stretchBad.length) errors.push(bid + ': stretch rows through other bones: ' + stretchBad.join(', '));
      for (var an in B.anchors) {
        var ap = B.anchors[an], ab = -1, bx3;
        for (var bi = 0; bi < names.length && ab < 0; bi++) {
          bx3 = B.bones[names[bi]].box;
          if (Math.floor(ap[0]) >= bx3[0] && Math.floor(ap[0]) <= bx3[3] && Math.floor(ap[1]) >= bx3[1] && Math.floor(ap[1]) <= bx3[4] &&
              Math.floor(ap[2]) >= bx3[2] && Math.floor(ap[2]) <= bx3[5]) ab = bi;
        }
        if (ab < 0) errors.push(bid + ': anchor ' + an + ' is in no bone box');
      }
      var matIds = {}, mOf = function (ch) { var m = resolveMat(kit, kit.defaults, ch) || ch; if (!matIds[m]) matIds[m] = Object.keys(matIds).length + 1; return matIds[m]; };
      stats.bases[bid] = {
        voxels: vox, perBone: cnt, heightM: r3((top + 1) * kit.cellM), depthM: r3((maxY - minY + 1) * kit.cellM),
        widthM: r3((maxX - minX + 1) * kit.cellM), quads: countQuads(D, mOf)
      };
      if (B.detail) { stats.bases[bid].detail = {}; checkDetail(kit, bid, errors, stats.bases[bid].detail); }
    }
    return { errors: errors, warnings: warnings, stats: stats };
  }

  var api = {
    version: 3, KIT_ID: KIT_ID, knightLook: knightLook, CELL: CELL, SKELETON: SKELETON, PART_MAP: PART_MAP, MAX_PARTS: MAX_PARTS,
    STRETCH_BONES: STRETCH_BONES, ARM_STRETCH: ARM_STRETCH,
    buildHumanKit: buildHumanKit, stringifyKit: stringifyKit, decodeBase: decodeBase, resolveMat: resolveMat,
    countQuads: countQuads, checkKit: checkKit, decodeDetail: decodeDetail, downsample2: downsample2,
    composePreview: composePreview
  };
  A.chargenKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
