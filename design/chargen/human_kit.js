/*
 * design/chargen/human_kit.js - CHARGEN-01 Human kit GENERATOR (designer script, architecture 38.29 items 1-3).
 *
 * The kit JSON `content/chargen/human.charkit.json` is the ONLY source the core / app / game read. This file just
 * writes it (node tools/chargen-build-kit.mjs) and is loaded by the preview design/preview/chargen_kit.html,
 * which checks that the JSON on disk equals what this script builds.
 *
 * BASE m_avg v2 (CHARGEN-25, D-059 + owner follow-up 2026-10-10: "in between" the owner's stylised voxel references and
 * realism; replaces the v1 realistic small-head / noisy-skin / bald-in-underwear look):
 *   - a 1.75 m man, 70 rows (cellM 0.025) + 2 rows of hair room: grid 37 x 20 x 72 (odd width: face, nose and spine on
 *     the centre column x = 18). Axes 15.1: faces north (-y), z up, the anchor sits between the feet.
 *   - proportions: head 12 rows (z 58-69, ~1/6 of the body; 11 wide, 10 deep, large flat face with rounded vertical
 *     edges), neck z 54-60, shoulders z 55 (21 cells = 2 head widths over the deltoids), chest 13 wide, waist 11, hips 13,
 *     crotch z 34, elbow z 42/43 (one-cell step), wrist z 33, hands z 26-32 (blocks + thumb), knee z 17 (one-cell step),
 *     ankle z 3, feet z 0-2. Limbs: upper arm / forearm 5 x 5, thigh 5 x 6, shin 5 x 5, all with rounded corners.
 *   - face: eyes = white (c) + dark pupil (P) over a coloured iris (e), no lids / lashes; a thick brow line (b, the hair
 *     colour's dark shade); nose = bridge + lit tip standing one cell out, shade under it; mouth = 3-cell dark line on
 *     the Head / Jaw seam with a 3-cell lower lip (p) under it and a dark interior behind (seen when the Jaw opens);
 *     ears = simple blocks; chin = the jaw one cell narrower than the skull.
 *   - skin: ONE flat tone (a) per skin ramp; soft top-down shade (s) only under the chin, under the nose and in the
 *     armpits. No noise, no stripes, no anatomy speckles.
 *   - the base still wears plain undyed linen braies (waist to mid-thigh) under the clothes.
 *   - default look = kit pieces the generator can swap (38.29 item 3): attachment `short` (hair), shells `shirt` (top,
 *     rolled sleeves), `trousers` (legs), `boots` (feet), `belt` (outer). kit.defaults wears all of them, so the man is
 *     never bald + underwear by default.
 *   - head at 1.25 cm (CHARGEN-23 slot, 38.34): bases.m_avg.detail.head["2"] is now a STRAIGHT 2x UPSAMPLE of the
 *     level-1 Head + Jaw cells (no separate art; downsample2 gives the Standard head back exactly).
 *   - rest pose: standing, arms down in a slight A (gap >= 3 cells from the hips up to z 46; the armpit touches), 3 cells
 *     between the thighs, feet 7 cells apart (centre to centre 8).
 *
 * Bone boxes are axis-aligned and resolved FIRST-MATCH in skeleton order (38.29 item 3), so they are cut to the
 * anatomy: e.g. Neck (z 55-60) only takes y >= -1 (behind the jaw), the Jaw takes the chin + lower lip in front of it.
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
    P: { fixed: 'hair_black_dark', keep: 9 }
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
  // Front plane Y -5, rows X -5..5 ('.' = the rounded corner column, never filled). Rows not listed are flat skin.
  //   66 brows (b, hair dark)   65 eye white | pupil | white   64 eye white | iris | white   62 shade under the nose (the
  //   lit tip stands at Y -6)   61 mouth line (d) on the Head side of the seam   60 lower lip (p) on the Jaw
  var FACE = {
    66: '.bbbaaabbb.',
    65: '.cPcaaacPc.',
    64: '.cecaaacec.',
    62: '.aaasasaaa.',
    61: '.aaadddaaa.',
    60: '.aaapppaaa.'
  };
  // the head as a function (also drives the hair): skull z 61-68 (11 x 10, rounded vertical edges), top z 69 (inset one
  // cell all round), jaw z 59-60 (one cell narrower, Y -5..0), chin z 58, ears (2 x 3 blocks at X +-6), nose (Y -6)
  function headChar(X, Y, z) {
    var ax = Math.abs(X), c;
    var skull = z >= 61 && z <= 68 && ax <= 5 && Y >= -5 && Y <= 4 && !(ax === 5 && (Y === -5 || Y === 4));
    var top = z === 69 && ax <= 4 && Y >= -4 && Y <= 3 && !(ax === 4 && (Y === -4 || Y === 3));
    var jaw = (z === 59 || z === 60) && ax <= 4 && Y >= -5 && Y <= 0 && !(ax === 4 && Y === -5);
    var chin = z === 58 && ax <= 3 && Y >= -5 && Y <= -1 && !(ax === 3 && Y === -5);
    var ear = ax === 6 && Y >= 0 && Y <= 1 && z >= 62 && z <= 64;
    var nose = X === 0 && Y === -6 && (z === 62 || z === 63);
    if (nose) return z === 62 ? 'l' : 'a';            // bridge (z 63) + lit tip (z 62)
    if (ear) return Y === 0 && z === 63 ? 's' : 'a';  // a shaded ear hole on the front of the block
    if (!(skull || top || jaw || chin)) return null;
    if (Y === -5 && FACE[z]) { c = FACE[z].charAt(X + 5); return c === '.' ? 'a' : c; }
    if (Y === -4 && (z === 60 || z === 61) && ax <= 1) return 'd';   // mouth interior (seen when the Jaw opens)
    return 'a';
  }
  // short hair (attachment `short`): every empty cell touching the head inside the hair zone. Front: only the top edge
  // (z 69) and the crown (z 70) so the forehead (z 67-68) shows; temples down to z 67, sides down to z 65 (above the
  // ears), behind the ears to z 62, the back to z 61 (never over the Neck / Jaw rows). g = hair base, K = the dark rim
  // along the hairline at the sides and back.
  var HAIR_BOX = { X0: -6, Y0: -6, z0: 61, w: 13, d: 12, h: 10 };   // centred origin + size [x, y, z]
  function hairZone(X, Y, z) {
    if (z >= 70) return true;
    if (Y <= -5) return z >= 69;
    if (Math.abs(X) < 5 && Y < 4) return false;
    return z >= (Y >= 4 ? 61 : Y >= 2 ? 62 : Y >= -3 ? 65 : 67);
  }
  function isHair(X, Y, z) {
    if (headChar(X, Y, z) !== null || !hairZone(X, Y, z)) return false;
    return headChar(X + 1, Y, z) !== null || headChar(X - 1, Y, z) !== null || headChar(X, Y + 1, z) !== null ||
           headChar(X, Y - 1, z) !== null || headChar(X, Y, z + 1) !== null || headChar(X, Y, z - 1) !== null;
  }
  function buildHair() {
    var layers = [], x, y, z;
    for (z = 0; z < HAIR_BOX.h; z++) {
      var L = [];
      for (y = 0; y < HAIR_BOX.d; y++) {
        var row = '';
        for (x = 0; x < HAIR_BOX.w; x++) {
          var X = HAIR_BOX.X0 + x, Y = HAIR_BOX.Y0 + y, Z = HAIR_BOX.z0 + z;
          row += !isHair(X, Y, Z) ? '.' : (Z < 69 && !isHair(X, Y, Z - 1)) ? 'K' : 'g';
        }
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
  }

  // head region (38.34): Head + Jaw boxes plus the hair room, centred [X0,X1, Y0,Y1, z0,z1]
  var HEAD_REGION = { bones: ['Head', 'Jaw'], box: [-6, 6, -10, 9, 58, 71] };

  // ===================================================================================================================
  // 5. BONES: joint (centred coords, continuous) + box (centred, INCLUSIVE cell ranges [X0,X1, Y0,Y1, z0,z1]).
  //    Right side listed; Left mirrors X. First match in skeleton order wins.
  // ===================================================================================================================
  var CENTER_BONES = {
    Hips:  { joint: [0, 0.5, 35.0],  box: [-8, 8, -10, 9, 34, 40] },
    Spine: { joint: [0, 0.0, 41.0],  box: [-8, 8, -10, 9, 41, 46] },
    Chest: { joint: [0, 0.0, 47.0],  box: [-6, 6, -10, 9, 47, 54] },
    Neck:  { joint: [0, 1.0, 55.0],  box: [-2, 2, -1, 9, 55, 60] },
    Head:  { joint: [0, 0.5, 61.0],  box: [-6, 6, -10, 9, 61, 71] },
    Jaw:   { joint: [0, 0.5, 61.5],  box: [-5, 5, -10, 0, 58, 60] }
  };
  var SIDE_BONES = {   // right side, X >= 0
    Shoulder: { joint: [2.5, 0.5, 54.5], box: [3, 6, -10, 9, 55, 56] },
    UpperArm: { joint: [8.5, 0.0, 53.5], box: [7, 16, -10, 9, 43, 56] },
    LowerArm: { joint: [11.5, 0.0, 43.0], box: [7, 16, -10, 9, 33, 42] },
    Hand:     { joint: [12.0, -0.5, 33.0], box: [7, 16, -10, 9, 24, 32] },
    UpperLeg: { joint: [4.0, -0.5, 33.5], box: [1, 9, -10, 9, 18, 33] },
    LowerLeg: { joint: [4.0, -0.5, 17.5], box: [1, 9, -10, 9, 3, 17] },
    Foot:     { joint: [4.0, 0.0, 3.0],   box: [1, 9, -4, 9, 0, 2] },
    Toes:     { joint: [4.0, -4.5, 0.5],  box: [1, 9, -10, -5, 0, 2] }
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

    // legs: foot (sole + toes z 0-1, instep z 2), shin 5 x 5, knee + thigh 5 x 6 (the one-cell step at the knee front)
    pair(2, 6, -5, 2, 0, 1, true);
    pair(2, 6, -2, 2, 2, 16, true);
    pair(2, 6, -3, 2, 17, 33, true);
    // torso: hips 13 wide (z 34-40), waist 11 (z 41-46), chest 13 (z 47-53, deeper in front), shoulder top, traps
    block(-6, 6, -3, 4, 34, 38, true);
    block(-6, 6, -3, 3, 39, 40, true);
    block(-5, 5, -3, 3, 41, 46, true);
    block(-6, 6, -3, 3, 47, 47, true);
    block(-6, 6, -4, 3, 48, 52, true);
    block(-6, 6, -3, 3, 53, 53, true);
    block(-5, 5, -3, 3, 54, 54, true);
    block(-4, 4, -1, 2, 55, 55, true);
    // neck 5 x 5, set back (behind the jaw)
    block(-2, 2, -1, 3, 54, 60, true);
    // arms (slight A): deltoid cap z 54-55, upper arm stepping out to X 9-13 by z 46 (>= 3 cells from the waist),
    // forearm one cell further out below the elbow (z 34-42), wrist z 33
    pair(7, 8, -1, 1, 55, 55, false);
    pair(7, 9, -2, 2, 54, 54, true);
    pair(7, 10, -2, 2, 51, 53, true);
    pair(7, 11, -2, 2, 49, 50, true);
    pair(8, 12, -2, 2, 47, 48, true);
    pair(9, 13, -2, 2, 43, 46, true);
    pair(10, 14, -2, 2, 34, 42, true);
    pair(11, 13, -2, 1, 33, 33, false);
    // hands (palm faces the thigh): a 3 x 4 block, fingers curled in at z 26, thumb forward (Y -3)
    pair(11, 13, -2, 1, 27, 32, false);
    pair(11, 12, -2, 1, 26, 26, false);
    pair(11, 12, -3, -3, 29, 31, false);
    // head
    for (z = 58; z <= 69; z++) for (Y = -6; Y <= 4; Y++) for (X = -6; X <= 6; X++) {
      var hc = headChar(X, Y, z);
      if (hc) put(X, Y, z, hc);
    }
    // soft top-down shade only: under the chin (front of the neck), the armpits (torso side under the arm)
    for (X = -1; X <= 1; X++) put(X, -1, 57, 's');
    for (s = -1; s <= 1; s += 2) for (Y = -2; Y <= 2; Y++) for (z = 47; z <= 48; z++) put(s * 6, Y, z, 's');
    // underwear: plain undyed linen braies, waist (z 40) to mid-thigh (z 28), waistband + hem in linen_dark
    for (z = 28; z <= 40; z++) for (Y = -CY; Y < SY - CY; Y++) for (X = -8; X <= 8; X++) {
      var q = idx(X, Y, z);
      if (q >= 0 && G[q] === 'a') G[q] = (z === 40 || z === 28) ? 'U' : 'u';
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
      // belt: the top two hip rows (z 39-40), one cell thick
      { id: 'belt', slot: 'outer', regions: [{ bone: 'Hips', t0: 0, t1: 0.25 }], thick: 1, paint: 'm' }
    ];
  }
  // random NPC weights (engine/chargen/random.js): trousers always, boots and hair mostly, shirt 3 in 4, belt 2 in 3
  var RANDOM = { hair: { none: 0.3 }, legs: { none: 0 }, feet: { none: 0.2 }, top: { shirt: 3 }, outer: { belt: 2 } };

  function buildHumanKit(P) {
    var CG = P.chargen;
    if (!CG) throw new Error('human_kit: palette.chargen missing (load design/palette.js v1.54+)');
    var bones = boneTable(), layers = buildBase();
    function mount(X, Y, z) { return gridJoint([X, Y, z]); }   // anchors: [x,y,z] cells; the bone = the box it sits in
    return {
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
            eyes: mount(0, -5.0, 64.5),
            mouth: mount(0, -5.0, 60.5),
            hand_r: mount(12.0, -0.5, 29.5),
            hand_l: mount(-12.0, -0.5, 29.5),
            back: mount(0, 4.5, 50.0),
            belt: mount(0, -4.0, 39.5)
          },
          // height (-4..4): CHARGEN-05 (engine/chargen/height.js) duplicates / deletes |height| rows picked evenly
          // over this sorted list. 6 shin rows (LowerLeg only) + 2 waist rows: z 37 (hips beside both forearms) and
          // z 44 (waist beside both upper arms) - clear of every hand box (z 24-32) and the head region (z 58+).
          stretchRows: [6, 8, 9, 11, 12, 14, 37, 44],
          layers: layers,
          // the head at 1.25 cm (level 2 of region head) = a straight 2x upsample of the level-1 head (CHARGEN-25)
          detail: { head: { '2': { layers: buildHeadL2(layers, bones) } } }
        }
      },
      shells: buildShells(),
      attachments: [
        // short hair; head_top = cell centre (18.5, 10, 69.5), so the offset puts the box origin on X -6, Y -6, z 61
        { id: 'short', slot: 'hair', bone: 'Head', anchor: 'head_top', offset: [-6.5, -6, -8.5],
          box: [HAIR_BOX.w, HAIR_BOX.d, HAIR_BOX.h], layers: buildHair() }
      ],
      clips: {},
      random: RANDOM,
      defaults: {
        v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'medium', eyes: 'brown',
        hair: { id: 'short', ramp: 'darkbrown' }, beard: null,
        top: { id: 'shirt', ramp: 'undyed' }, legs: { id: 'trousers', ramp: 'walnut' }, feet: { id: 'boots', ramp: 'walnut' },
        outer: { id: 'belt', ramp: 'walnut' }, hat: null
      }
    };
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
    version: 2, KIT_ID: KIT_ID, CELL: CELL, SKELETON: SKELETON, PART_MAP: PART_MAP, MAX_PARTS: MAX_PARTS,
    STRETCH_BONES: STRETCH_BONES, ARM_STRETCH: ARM_STRETCH,
    buildHumanKit: buildHumanKit, stringifyKit: stringifyKit, decodeBase: decodeBase, resolveMat: resolveMat,
    countQuads: countQuads, checkKit: checkKit, decodeDetail: decodeDetail, downsample2: downsample2,
    composePreview: composePreview
  };
  A.chargenKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
