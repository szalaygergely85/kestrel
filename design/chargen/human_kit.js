/*
 * design/chargen/human_kit.js - CHARGEN-01 Human kit v0 GENERATOR (designer script, architecture 38.29 items 1-3).
 *
 * The kit JSON `content/chargen/human.charkit.json` is the ONLY source the core / app / game read. This file just
 * writes it (node tools/chargen-build-kit.mjs) and is loaded by the preview design/preview/chargen_kit.html,
 * which checks that the JSON on disk equals what this script builds.
 *
 * BASE m_avg (style-guide 0: realistic, built from 2.5 cm voxels, not boxy, natural skin variation):
 *   - a 1.75 m adult man, 70 rows (cellM 0.025), grid 37 x 20 x 70 (odd width: the face, nose, spine and navel sit
 *     on one centre column x = 18). Axes 15.1: faces north (-y), z up, the anchor sits between the feet.
 *   - real proportions: head 25 cm (1/7), chin 1.50 m, shoulders 1.45 m, elbow 1.08 m, waist 1.05 m, crotch 0.85 m,
 *     wrist 0.84 m, fingertips 0.65 m, knee 0.49 m, ankle 0.09 m; shoulders 47 cm over the deltoids, hips 37 cm,
 *     waist 28 cm, foot 25 cm.
 *   - every body section is an ellipse / superellipse slice with keyframed radii (torso S-curve, pecs, buttocks,
 *     calves, knees, ankles), so no flat cube face reads at 3-6 m. Head, hands and feet are hand-placed cells.
 *   - face v2 (owner 2026-10-10): eyes (white + iris) on the face plane under brows and a lit brow bone, nose bridge +
 *     lit tip, cheek apples, lit cheekbones, ears with helix / concha / lobe, 3-wide lips with shaded corners, a dark
 *     mouth interior on the jaw seam (seen when the Jaw bone opens), lit chin. See the HEAD table.
 *   - head at 1.25 cm (CHARGEN-23, D-055, architecture 38.34): kit.regions.head (Head + Jaw boxes), kit.resLevels,
 *     bases.m_avg.detail.head["2"] (14 x 40 x 22 fine cells) + slot `keep`; face v2 above stays level 1 (Standard).
 *   - hands: palm facing the thigh, thumb forward, four fingers with natural lengths (middle longest, pinky
 *     shortest), slight curl, knuckles, nails, veins. Feet: heel, arch, ball, big toe, toes, ankle bones.
 *   - skin variation: broad anatomy cues only (collarbones, pec crowns, sternum, pec line, nipples, navel, spine
 *     groove, shoulder blades, kneecaps, elbows, throat shade); the v1 random tone patches were removed (stripy).
 *   - underwear: undyed linen braies from the waist to mid-thigh (waistband + hem in linen_dark, a few folds).
 *   - rest pose: standing, arms down in a slight A (gap >= 3 cells from the lower ribs down; the armpit itself
 *     touches, as on a real body), >= 3 cells between the thighs, feet 12 cm apart.
 *
 * Bone boxes are axis-aligned and resolved FIRST-MATCH in skeleton order (38.29 item 3), so they are cut to the
 * anatomy: e.g. Neck (z 58-61) only takes y >= the jaw seam, the Jaw takes the chin + lower lip in front of it.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  var SX = 37, SY = 20, SZ = 70, CX = 18, CY = 10, CELL = 0.025;
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
    // CHARGEN-23: eye white + catchlight of the 1.25 cm head get their own chars, so their downsample `keep` never touches
    // linen clothes (u / k). Brows / lash line (b) have no keep: hidden interior b cells carry the brow row instead (README 25)
    o: { fixed: 'linen', keep: 7 }, c: { fixed: 'linen_light', keep: 8 },
    G: { group: 'hair', shade: 'light' }, g: { group: 'hair', shade: 'base' }, K: { group: 'hair', shade: 'dark' },
    1:{ group: 'top', shade: 'light' }, 2: { group: 'top', shade: 'base' }, 3: { group: 'top', shade: 'dark' },
    4: { group: 'legs', shade: 'light' }, 5: { group: 'legs', shade: 'base' }, 6: { group: 'legs', shade: 'dark' },
    7: { group: 'feet', shade: 'light' }, 8: { group: 'feet', shade: 'base' }, 9: { group: 'feet', shade: 'dark' },
    W: { group: 'outer', shade: 'light' }, w: { group: 'outer', shade: 'base' }, m: { group: 'outer', shade: 'dark' },
    H: { group: 'hat', shade: 'light' }, h: { group: 'hat', shade: 'base' }, j: { group: 'hat', shade: 'dark' }
  };
  // Ramp ids are picked by engine/chargen/compose.js (CHARGEN-02): skin / eyes = recipe.skin / recipe.eyes,
  // lips = recipe.skin, hair (also beard + brows: beard shares the hair group) = (recipe.hair || recipe.beard).ramp,
  // a dye group = recipe[group].ramp; a missing pick takes the FIRST ramp of the group. So the first ramp is the
  // natural default: darkbrown hair (brows of a bald man), undyed linen, walnut-brown shoes.
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
  // 3. MATHS + GRID (centred coords: X = x - 18 (+ = the character's RIGHT = east), Y = y - 10 (- = front/north))
  // ===================================================================================================================
  function idx(X, Y, z) {
    var x = X + CX, y = Y + CY;
    if (x < 0 || x >= SX || y < 0 || y >= SY || z < 0 || z >= SZ) return -1;
    return x + SX * (y + SY * z);
  }
  function lerpKeys(keys, z) {
    if (z < keys[0][0] || z > keys[keys.length - 1][0]) return null;
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i], b = keys[i + 1];
      if (z <= b[0]) {
        var t = (z - a[0]) / (b[0] - a[0]), o = [];
        for (var j = 1; j < a.length; j++) o.push(a[j] + (b[j] - a[j]) * t);
        return o;
      }
    }
    return keys[keys.length - 1].slice(1);
  }
  function inSuper(u, v, n) { return Math.pow(Math.abs(u), n) + Math.pow(Math.abs(v), n) <= 1; }
  function hash3(x, y, z, s) {
    var h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(s | 0, 0x2545f491)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function sm(t) { return t * t * (3 - 2 * t); }
  // smooth value noise, lattice `sc` cells, 0..1
  function vnoise(x, y, z, sc, seed) {
    var fx = x / sc, fy = y / sc, fz = z / sc, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    var tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz), out = 0;
    for (var c = 0; c < 8; c++) {
      var dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      var w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      out += w * hash3(ix + dx, iy + dy, iz + dz, seed);
    }
    return out;
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  // ===================================================================================================================
  // 4. BODY SHAPES (cells; zc = row centre). Radii were set against adult male averages, see the header.
  // ===================================================================================================================
  // torso: zc, rx (half width), ryF (front), ryB (back), cy (centre y: the spine's S-curve)
  var TORSO = [
    [34.5, 6.2, 4.0, 4.8, 0.3], [36, 6.6, 4.2, 5.2, 0.3], [38, 6.5, 4.2, 4.8, 0.2], [40, 6.1, 4.1, 4.0, 0.1],
    [42, 5.7, 4.1, 3.7, 0.0], [44, 5.8, 4.1, 3.8, 0.0], [46, 6.0, 4.2, 4.1, -0.1], [48, 6.3, 4.5, 4.5, -0.1],
    [50, 6.6, 4.9, 4.8, -0.1], [52, 6.8, 5.0, 4.9, 0.0], [54, 6.9, 4.7, 4.9, 0.1], [56, 6.9, 3.8, 4.4, 0.3],
    [57.5, 7.0, 2.6, 3.4, 0.6], [58.5, 3.6, 2.2, 3.0, 0.8]
  ];
  var NECK = [[55, 2.4, 2.5, 2.5, 0.9], [62, 2.3, 2.3, 2.4, 0.5]];
  // leg (right side; left mirrors): zc, cx, cy, rx, ryF, ryB
  var LEG = [
    [3, 4.3, 1.0, 1.4, 1.4, 1.6], [5, 4.3, 1.0, 1.3, 1.3, 1.4], [8, 4.3, 0.7, 1.6, 1.4, 1.8], [11, 4.2, 0.4, 2.0, 1.6, 2.4],
    [14, 4.2, 0.1, 2.2, 1.8, 2.7], [17, 4.2, -0.2, 2.0, 2.0, 2.2], [19, 4.2, -0.4, 2.0, 2.3, 1.9], [21, 4.2, -0.4, 2.1, 2.2, 2.0],
    [24, 4.3, -0.4, 2.4, 2.5, 2.4], [28, 4.5, -0.3, 2.6, 2.8, 2.8], [32, 4.7, -0.1, 2.8, 3.0, 3.2], [35, 4.6, 0.0, 3.0, 3.2, 3.6]
  ];
  // arm (right side): zc, cx, cy, rx, ry. Shoulder joint (7.6, 0.3, 56) -> elbow (12.2, 0.8, 43) -> wrist (12.6, 0, 34)
  var ARM = [
    [34, 12.6, 0.0, 1.0, 1.5], [36, 12.5, 0.2, 1.2, 1.6], [39, 12.4, 0.5, 1.5, 1.9], [42, 12.25, 0.75, 1.6, 1.9],
    [43, 12.2, 0.8, 1.6, 1.8], [44, 11.85, 0.76, 1.6, 1.8], [47, 10.8, 0.65, 1.75, 2.0], [50, 9.7, 0.53, 1.9, 2.2],
    [54, 8.3, 0.38, 2.1, 2.3], [56, 7.6, 0.3, 2.0, 2.2]
  ];
  var DELTOID = { c: [7.8, 0.3, 55.0], r: [2.0, 2.6, 2.8] };

  // right hand cells [X, Y, z, char] (palm faces the thigh = -X, thumb forward = -Y); the left hand mirrors X
  var HAND = [
    [12, -1, 33, 's'], [12, 0, 33, 's'], [12, 1, 33, 's'], [13, -1, 33, 'a'], [13, 0, 33, 'v'], [13, 1, 33, 'a'],
    [12, -2, 32, 'f'], [12, -1, 32, 'a'], [12, 0, 32, 'a'], [12, 1, 32, 'f'], [13, -2, 32, 'a'], [13, -1, 32, 'a'], [13, 0, 32, 'v'], [13, 1, 32, 'a'],
    [12, -3, 31, 'a'], [12, -2, 31, 'f'], [12, -1, 31, 's'], [12, 0, 31, 'a'], [12, 1, 31, 'f'], [13, -2, 31, 'a'], [13, -1, 31, 'v'], [13, 0, 31, 'a'], [13, 1, 31, 'l'],
    [12, -3, 30, 'a'], [11, -3, 30, 'f'], [12, -2, 30, 'a'], [12, -1, 30, 'a'], [12, 0, 30, 'a'], [12, 1, 30, 'a'],
    [13, -2, 30, 'l'], [13, -1, 30, 'f'], [13, 0, 30, 'l'], [13, 1, 30, 'f'],
    [11, -3, 29, 'n'], [12, -2, 29, 'a'], [12, -1, 29, 'f'], [12, 0, 29, 'a'], [12, 1, 29, 'f'],
    [12, -2, 28, 's'], [12, -1, 28, 's'], [12, 0, 28, 's'], [12, 1, 28, 'n'],
    [12, -2, 27, 'n'], [12, -1, 27, 'a'], [11, -1, 27, 'f'], [12, 0, 27, 'n'],
    [11, -1, 26, 'n']
  ];
  // foot (right): half width per Y (heel +3 .. toe tip -6), centre line toes-out ~6 deg
  var FOOT_HW = { 3: 1.15, 2: 1.3, 1: 1.4, 0: 1.45, '-1': 1.5, '-2': 1.7, '-3': 1.9, '-4': 2.0, '-5': 1.8, '-6': 1.2 };
  function footXc(Y) { return 4.3 + (1 - Y) * 0.1; }

  // head, rows z 60..69; each row = 10 strings (Y -5 front .. +4 back) of 7 chars (X -3 .. +3)
  // a skin, l light, s shade, d deep, f flush, p lips, e iris, k eye white (linen_light), b brow (hair group)
  // Face v2 (owner 2026-10-10 "redesign the face": v1 read as a skull - eyes sunk one cell behind the face plane under an
  // overhanging brow, dark temples, hollow cheeks). v2: the eyes sit ON the face plane (Y -4: white outside, iris inside),
  // brows on the same plane above them with a lit brow bone / forehead (z 67), no overhang and no dark socket cells; nose
  // = bridge (z 64) + lit tip (z 63) on Y -5, soft nose-wing shade, flushed cheek apples, lit cheekbones filling the
  // cheek-to-ear hollow (X +-3, z 64-65); 3-wide lips (upper z 62 on Head, lower z 61 on Jaw) with shaded corners and the
  // dark mouth interior behind them (seen when the Jaw opens); lit chin, shaded underside; ears (helix flush, concha
  // shade, lobe) stand free of the skull behind them (Y +2 empty at z 63-65).
  var HEAD = {
    69: ['.......', '.......', '.......', '..aaa..', '.aaaaa.', '.aaaaa.', '.aaaaa.', '..aaa..', '.......', '.......'],
    68: ['.......', '.......', '..ala..', '.aaaaa.', '.aaaaa.', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '.......'],
    67: ['.......', '.allla.', '.aaaaa.', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '.......'],
    66: ['.......', '.bbabb.', '.baaab.', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..'],
    65: ['.......', '.keaek.', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'faaaaaf', '.aaaaa.', '.aaaaa.', '..aaa..'],
    64: ['...a...', '.aaaaa.', 'laaaaal', 'aaaaaaa', 'aaaaaaa', 'saaaaas', 'faaaaaf', '.aaaaa.', '.aaaaa.', '..aaa..'],
    63: ['...l...', '.fsasf.', '.aaaaa.', '.aaaaa.', '.aaaaa.', 'faaaaaf', '.aaaaa.', '.aaaaa.', '.aaaaa.', '.......'],
    62: ['.......', '.apppa.', '.addda.', '.aaaaa.', '.aaaaa.', '.aaaaa.', '.aaaaa.', '.aaaaa.', '..aaa..', '.......'],
    61: ['.......', '..ppp..', '.sddds.', '.aaaaa.', '.......', '.......', '.......', '.......', '.......', '.......'],
    60: ['.......', '..ala..', '.aaaaa.', '.sssss.', '.......', '.......', '.......', '.......', '.......', '.......']
  };

  // ---- HEAD at 1.25 cm (CHARGEN-23, D-055, architecture 38.34): bases.m_avg.detail.head["2"] -------------------------
  // Region head = Head box U Jaw box (level-1 cells), so the block is 14 x 40 x 22 fine cells; origin = the box min.
  // Working coords below: x2 0..13 (x2 = 2*(X+3) + sub; the centre line runs between x2 6 | 7), yy2 0..19 (Y -5..4,
  // front -> back; yy2 2,3 = the face plane Y -4), zr 0..19 (z 60..69; zr 4,5 = z 62, the Head / Jaw seam is zr 3 | 4).
  // Same silhouette and bone boxes as face v2; every 2x2x2 block downsamples (38.34 downsample2) back to the face v2 cell,
  // except the two eye-white cells (the centred iris wins the keep vote there, see README 25).
  //  - skull (Y >= -1): face v2 upsampled, convex edges / corners carved (never more than 4 of a block's 8 cells)
  //  - face (Y -5..-2): FACE2_DEPTH = front cell per column (digit = yy2, 8 = no cell in front of Y -1), FACE2_COLOR = its
  //    char; the column is filled back to yy2 7 (skin; mouth interior d; jaw underside s). Strings = x2 0..6, mirrored.
  //    eyes: brow (arch z+, tail + head drop), lid gap, lash line arched over the iris (corners lower), 2x2 iris centred in
  //    the eye with a catchlight (c) on the same side in both eyes, whites (o) both sides, lower lid shade under the iris;
  //    nose: nasion -> bridge -> lit tip (2 deep), wings (s), dark nostrils, columella; mouth: upper lip + bow peaks with
  //    the philtrum between, fuller lower lip (2 rows in the middle), dark corners, shade under the lower lip, lit chin.
  var HEAD_REGION = { bones: ['Head', 'Jaw'], box: [-3, 3, -10, 9, 59, 69] };   // centred [X0,X1, Y0,Y1, z0,z1]
  var FACE2_DEPTH = {
    19: '8888776', 18: '8888766', 17: '8876544', 16: '8865444', 15: '7643333', 14: '6532222', 13: '6522222', 12: '6522222',
    11: '5422222', 10: '5422221', 9: '5422221', 8: '5422220', 7: '8832210', 6: '8832221', 5: '8832222', 4: '8832222',
    3: '8843222', 2: '8843222', 1: '8844233', 0: '8854322'
  };
  var FACE2_COLOR = {
    19: 'aaaaaaa', 18: 'aaaaaaa', 17: 'aaaaall', 16: 'aaaaall', 15: 'aaaalll', 14: 'aaabbbl', 13: 'aabaaba', 12: 'aaabbaa',
    11: 'aabeeba', 10: 'aaoeeoa', 9: 'llassaa', 8: 'lllaaaa', 7: 'aaffasl', 6: 'aaafsda', 5: 'aaaaapa', 4: 'aaaaspp',
    3: 'aassdpp', 2: 'aassasp', 1: 'aaaaaas', 0: 'aaaaall'
  };
  // cells behind the front [x2, zr, yy2, char] (mirrored): the brow tail wrapping the temple (visible) and hidden interior
  // cells that steer the downsample majority (brow row b, forehead l, nose-wing s, cheek apple f, jaw side s, chin l)
  var FACE2_CELLS = [
    [2, 13, 3, 'b'], [2, 13, 4, 'b'], [3, 12, 3, 'b'], [3, 13, 3, 'b'], [3, 12, 4, 'b'], [3, 13, 4, 'b'], [3, 12, 5, 'b'], [3, 13, 5, 'b'],
    [4, 12, 3, 'b'], [5, 12, 3, 'b'], [4, 13, 3, 'b'], [5, 13, 3, 'b'],
    [4, 14, 3, 'l'], [5, 14, 3, 'l'], [6, 14, 3, 'l'], [6, 16, 5, 'l'], [6, 17, 5, 'l'],
    [5, 7, 2, 's'], [4, 6, 3, 's'], [5, 6, 3, 's'], [4, 7, 3, 's'], [5, 7, 3, 's'], [6, 7, 1, 'l'],
    [3, 6, 3, 'f'], [3, 7, 3, 'f'],
    [3, 2, 4, 's'], [3, 2, 5, 's'], [3, 3, 4, 's'], [3, 3, 5, 's'], [6, 0, 3, 'l']
  ];
  // left ear, side view: per layer (x2 0 = the outer skin, x2 1 = under it) rows zr 11..6, strings yy2 10..13 (front ->
  // back); helix rim f (top + back, standing free of the skull behind it), antihelix s, scapha s, deep concha d, tragus,
  // lobe f. Mirrored to x2 13 / 12.
  var EAR2 = {
    0: { 11: '.ff.', 10: 'f.sf', 9: 'a.sf', 8: 's..f', 7: '.fff', 6: '.f..' },
    1: { 11: 'aaa.', 10: 'ass.', 9: 'sds.', 8: 'sdd.', 7: 'aff.', 6: '.f..' }
  };
  var CATCH2 = [[4, 11], [10, 11]];   // [x2, zr] catchlight on the upper iris cell, same side in both eyes (not mirrored)

  // ===================================================================================================================
  // 5. BONES: joint (centred coords, continuous) + box (centred, INCLUSIVE cell ranges [X0,X1, Y0,Y1, z0,z1]).
  //    Right side listed; Left mirrors X. First match in skeleton order wins.
  // ===================================================================================================================
  var CENTER_BONES = {
    Hips:  { joint: [0, 0.3, 36.0],  box: [-7, 7, -10, 9, 34, 40] },
    Spine: { joint: [0, 0.0, 41.0],  box: [-7, 7, -10, 9, 41, 47] },
    Chest: { joint: [0, 0.0, 48.0],  box: [-6, 6, -10, 9, 48, 57] },
    Neck:  { joint: [0, 0.8, 58.0],  box: [-2, 2, -1, 9, 58, 61] },
    Head:  { joint: [0, 0.5, 62.0],  box: [-3, 3, -10, 9, 62, 69] },
    Jaw:   { joint: [0, -0.5, 63.0], box: [-3, 3, -10, -2, 59, 61] }
  };
  var SIDE_BONES = {   // right side, X >= 0
    Shoulder: { joint: [1.0, -1.5, 56.5], box: [3, 8, -10, 9, 57, 58] },
    UpperArm: { joint: [7.6, 0.3, 56.0],  box: [6, 16, -10, 9, 43, 58] },
    LowerArm: { joint: [12.2, 0.8, 43.0], box: [6, 16, -10, 9, 34, 42] },
    Hand:     { joint: [12.6, 0.0, 34.0], box: [6, 16, -10, 9, 24, 33] },
    UpperLeg: { joint: [4.5, 0.0, 35.0],  box: [1, 9, -10, 9, 20, 33] },
    LowerLeg: { joint: [4.2, -0.4, 19.8], box: [1, 9, -10, 9, 4, 19] },
    Foot:     { joint: [4.3, 1.0, 3.6],   box: [1, 9, -4, 9, 0, 3] },
    Toes:     { joint: [4.8, -4.5, 0.6],  box: [1, 9, -10, -5, 0, 3] }
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
  // 6. BUILD THE BASE m_avg
  // ===================================================================================================================
  function buildBase() {
    var N = SX * SY * SZ, G = new Array(N), LOCK = new Uint8Array(N), X, Y, z, k, s, i;
    for (i = 0; i < N; i++) G[i] = '.';
    function put(X, Y, z, ch, lock) { var q = idx(X, Y, z); if (q < 0) return; if (LOCK[q] && !lock) return; G[q] = ch; if (lock) LOCK[q] = 1; }
    function occ(X, Y, z) { var q = idx(X, Y, z); return q >= 0 && G[q] !== '.'; }

    for (z = 0; z < SZ; z++) {
      var zc = z + 0.5;
      // torso (superellipse n 2.4)
      var t = lerpKeys(TORSO, zc);
      if (t) for (X = -9; X <= 9; X++) for (Y = -9; Y <= 9; Y++) {
        var dy = Y - t[3];
        if (inSuper(X / t[0], dy / (dy < 0 ? t[1] : t[2]), 2.4)) put(X, Y, z, 'a');
      }
      // neck (n 2.2)
      var nk = lerpKeys(NECK, zc);
      if (nk) for (X = -3; X <= 3; X++) for (Y = -4; Y <= 5; Y++) {
        var dn = Y - nk[3];
        if (inSuper(X / nk[0], dn / (dn < 0 ? nk[1] : nk[2]), 2.2)) put(X, Y, z, 'a');
      }
      // legs (n 2.2)
      var lg = lerpKeys(LEG, zc);
      if (lg) for (s = -1; s <= 1; s += 2) for (X = 0; X <= 10; X++) for (Y = -6; Y <= 6; Y++) {
        var dl = Y - lg[1];
        if (inSuper((X - lg[0]) / lg[2], dl / (dl < 0 ? lg[3] : lg[4]), 2.2)) put(s * X, Y, z, 'a');
      }
      // arms (ellipse) rows 34..55
      var am = lerpKeys(ARM, zc);
      if (am) for (s = -1; s <= 1; s += 2) for (X = 5; X <= 16; X++) for (Y = -5; Y <= 5; Y++) {
        if (inSuper((X - am[0]) / am[2], (Y - am[1]) / am[3], 2)) put(s * X, Y, z, 'a');
      }
      // deltoids (ellipsoid)
      for (s = -1; s <= 1; s += 2) for (X = 5; X <= 11; X++) for (Y = -4; Y <= 4; Y++) {
        var ex = (X - DELTOID.c[0]) / DELTOID.r[0], ey = (Y - DELTOID.c[1]) / DELTOID.r[1], ez = (zc - DELTOID.c[2]) / DELTOID.r[2];
        if (ex * ex + ey * ey + ez * ez <= 1) put(s * X, Y, z, 'a');
      }
    }
    // feet (rows 0..2): sole + toes (z 0), instep (z 1), ankle / Achilles (z 2); arch cut on the inner sole
    for (s = -1; s <= 1; s += 2) for (Y = -6; Y <= 3; Y++) {
      var xc = footXc(Y), hw = FOOT_HW[Y];
      for (X = 0; X <= 9; X++) {
        var ax = Math.abs(X - xc);
        if (ax <= hw) {
          var arch = Y >= -2 && Y <= 1 && X < xc - 0.6, bigToe = Y === -6 && X > xc + 0.2;
          if (!arch && !bigToe) put(s * X, Y, 0, Y === 3 ? 'f' : 'a', true);
        }
        if (Y >= -4 && ax <= hw * 0.95) put(s * X, Y, 1, Y === 3 ? 'f' : 'a', true);
        if (Y >= -2 && Y <= 2 && ax <= hw * 0.8) put(s * X, Y, 2, 'a', true);
      }
      // nails / toe tips: big toe nail (inner tip), the little toes' row a touch warmer, creases
      put(s * 4, -6, 0, 'n', true); put(s * 5, -6, 0, 'a', true);
      put(s * 4, -5, 0, 's', true); put(s * 6, -5, 0, 'f', true);
    }
    // hands
    HAND.forEach(function (c) { for (var sd = -1; sd <= 1; sd += 2) put(sd * c[0], c[1], c[2], c[3], true); });
    // head
    for (z = 60; z <= 69; z++) {
      var rows = HEAD[z];
      for (var yy = 0; yy < 10; yy++) for (var xx = 0; xx < 7; xx++) {
        var ch = rows[yy].charAt(xx);
        if (ch !== '.') put(xx - 3, yy - 5, z, ch, true);
      }
    }

    // ---- anatomy cues (only on unlocked skin) ----
    function front(X, z) { for (var y = -9; y <= 9; y++) if (occ(X, y, z)) return y; return null; }
    function back(X, z) { for (var y = 9; y >= -9; y--) if (occ(X, y, z)) return y; return null; }
    function cue(X, z, ch, side) { var y = side < 0 ? front(X, z) : back(X, z); if (y !== null) put(X, y, z, ch); }
    for (X = -4; X <= 4; X++) if (X) cue(X, 56, 'l', -1);                 // collarbones
    cue(0, 56, 's', -1);                                                   // sternal notch
    for (z = 49; z <= 52; z++) cue(0, z, 's', -1);                         // sternum between the pecs
    for (X = -5; X <= 5; X++) if (X) cue(X, 48, 's', -1);                  // lower pec line
    cue(-3, 50, 'f', -1); cue(3, 50, 'f', -1);                             // nipples
    cue(0, 46, 's', -1); cue(0, 44, 's', -1);                              // linea alba
    cue(0, 42, 'd', -1);                                                   // navel
    cue(-3, 41, 's', -1); cue(3, 41, 's', -1);                             // iliac lines
    for (z = 39; z <= 55; z++) cue(0, z, 's', 1);                          // spine groove
    for (X = -4; X <= 4; X++) if (Math.abs(X) >= 2) cue(X, 53, 'l', 1);    // shoulder blades
    for (s = -1; s <= 1; s += 2) {
      cue(s * 12, 43, 'f', 1); cue(s * 11, 43, 'f', 1);                    // elbow point
      cue(s * 12, 43, 's', -1);                                            // elbow crease
      cue(s * 12, 39, 'v', -1);                                            // a forearm vein
      for (X = 3; X <= 6; X++) cue(s * X, 19, X === 4 || X === 5 ? 'l' : 'a', -1); // kneecap
      for (X = 3; X <= 6; X++) cue(s * X, 18, 's', 1);                     // back of the knee
      cue(s * 4, 20, 'f', -1);
      cue(s * 8, 54, 'l', -1); cue(s * 8, 56, 'l', 1);                     // deltoid tops catch the light
      // ankle bones (malleoli): the outermost / innermost cell at row 3
      var y3 = 1, xo = null, xi = null;
      for (X = 1; X <= 9; X++) if (occ(s * X, y3, 3)) { if (xi === null) xi = X; xo = X; }
      if (xi !== null) { put(s * xi, y3, 3, 'l'); put(s * xo, y3, 3, 'l'); }
    }

    // broad, anatomical shading only (face v2, owner 2026-10-10): the v1 random 7.5 cm flush / light patches read as
    // noisy vertical stripes over the whole body, so they are gone; the skin stays the base tone and the cues above plus
    // these few broad ones carry the variation (the renderer's light does the rest)
    for (s = -1; s <= 1; s += 2) { cue(s * 3, 51, 'l', -1); cue(s * 4, 51, 'l', -1); }   // pec crowns catch the light
    for (X = -2; X <= 2; X++) cue(X, 59, 's', -1);                                         // throat in the chin's shadow

    // ---- underwear: undyed linen braies, waist (z 40) to mid-thigh (z 28) ----
    for (z = 28; z <= 40; z++) for (Y = -CY; Y < SY - CY; Y++) for (X = -8; X <= 8; X++) {
      k = idx(X, Y, z);
      if (G[k] === '.' || LOCK[k]) continue;
      var nb = vnoise(X + 11, Y + 23, z, 2, 41);
      G[k] = (z === 40 || z === 28) ? 'U' : nb < 0.2 ? 'U' : nb > 0.76 ? 'k' : 'u';
    }
    for (z = 33; z <= 36; z++) { var yf = front(0, z); if (yf !== null) G[idx(0, yf, z)] = 'U'; }   // front seam
    for (s = -1; s <= 1; s += 2) { var yb = back(s * 4, 33); if (yb !== null) G[idx(s * 4, yb, 33)] = 'U'; } // seat fold

    // ---- layers ----
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

  // the 1.25 cm head block (see HEAD_REGION / FACE2_* above): layers[z][y] = string of x, block cells, origin = box min
  function buildHeadL2() {
    var W = 14, NY = 20, NZ = 20, g = new Array(W * NY * NZ), x, y, z, i, k;
    for (i = 0; i < g.length; i++) g[i] = '.';
    function at(xx, yy, zz) { return xx + W * (yy + NY * zz); }
    function v1(X, Y, Z) { return (Z < 60 || Z > 69 || X < -3 || X > 3 || Y < -5 || Y > 4) ? '.' : HEAD[Z][Y + 5].charAt(X + 3); }
    // an open side of a level-1 head cell; the underside of z 62 sits on the Neck (main grid), so it never counts
    function open(X, Y, Z, dx, dy, dz) { return !(dz < 0 && Z === 62) && v1(X + dx, Y + dy, Z + dz) === '.'; }
    var DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    // 1. skull (yy2 >= 8): carve a sub-cell when 2-3 of its own outward sides are open (blocks open on >= 4 sides stay whole)
    for (z = 0; z < NZ; z++) for (y = 8; y < NY; y++) for (x = 0; x < W; x++) {
      var X = (x >> 1) - 3, Y = (y >> 1) - 5, Z = (z >> 1) + 60, c = v1(X, Y, Z);
      if (c === '.') continue;
      var nOpen = 0;
      for (k = 0; k < 6; k++) if (open(X, Y, Z, DIRS[k][0], DIRS[k][1], DIRS[k][2])) nOpen++;
      var sx = (x & 1) ? 1 : -1, sy = (y & 1) ? 1 : -1, sz = (z & 1) ? 1 : -1;
      var nSub = (open(X, Y, Z, sx, 0, 0) ? 1 : 0) + (open(X, Y, Z, 0, sy, 0) ? 1 : 0) + (open(X, Y, Z, 0, 0, sz) ? 1 : 0);
      if (nOpen < 4 && nSub >= 2) continue;
      g[at(x, y, z)] = c;
    }
    // 2. face (yy2 0..7): front cell + fill back to yy2 7
    for (z = 0; z < NZ; z++) for (x = 0; x < W; x++) {
      var hx = x < 7 ? x : 13 - x, d = +FACE2_DEPTH[z].charAt(hx);
      for (y = d; y < 8; y++) {
        var ch = 'a';
        if (y === d) ch = FACE2_COLOR[z].charAt(hx);
        else if (y >= 4 && y <= 5 && z >= 2 && z <= 5 && x >= 4 && x <= 9) ch = 'd';   // mouth interior (seen when the Jaw opens)
        else if (y >= 6 && z <= 1) ch = 's';                                           // jaw underside
        g[at(x, y, z)] = ch;
      }
    }
    // 3. cells behind the front (only where filled)
    FACE2_CELLS.forEach(function (q) {
      [q[0], 13 - q[0]].forEach(function (xx) { var j = at(xx, q[2], q[1]); if (g[j] !== '.') g[j] = q[3]; });
    });
    // 4. ears (x2 0..1 and 12..13, yy2 10..13, zr 6..11 are replaced as a whole)
    [0, 1].forEach(function (layer) {
      for (var ez = 6; ez <= 11; ez++) for (var ey = 10; ey <= 13; ey++) {
        var e = EAR2[layer][ez].charAt(ey - 10);
        g[at(layer, ey, ez)] = e; g[at(13 - layer, ey, ez)] = e;
      }
    });
    // 5. catchlights on the iris front cell
    CATCH2.forEach(function (q) { var hx2 = q[0] < 7 ? q[0] : 13 - q[0]; g[at(q[0], +FACE2_DEPTH[q[1]].charAt(hx2), q[1])] = 'c'; });
    // 6. emit the region block (box x 2); the working grid starts at Y -5, z 60 (x starts at the box min X -3)
    var B = gridBox(HEAD_REGION.box), SXb = (B[3] - B[0] + 1) * 2, SYb = (B[4] - B[1] + 1) * 2, SZb = (B[5] - B[2] + 1) * 2;
    var oy = (-5 + CY - B[1]) * 2, oz = (60 - B[2]) * 2, layers = [];
    for (z = 0; z < SZb; z++) {
      var L = [], wz = z - oz;
      for (y = 0; y < SYb; y++) {
        var row = '', wy = y - oy;
        for (x = 0; x < SXb; x++) row += (wy >= 0 && wy < NY && wz >= 0 && wz < NZ && x < W) ? g[at(x, wy, wz)] : '.';
        L.push(row);
      }
      layers.push(L);
    }
    return layers;
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
  function buildHumanKit(P) {
    var CG = P.chargen;
    if (!CG) throw new Error('human_kit: palette.chargen missing (load design/palette.js v1.54+)');
    var bones = boneTable();
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
            head_top: mount(0, -0.3, 69.5),
            eyes: mount(0, -4.0, 65.5),
            mouth: mount(0, -4.5, 61.5),
            hand_r: mount(12.0, -0.5, 30.5),
            hand_l: mount(-12.0, -0.5, 30.5),
            back: mount(0, 4.5, 51.0),
            belt: mount(0, -4.0, 40.5)
          },
          // height (-4..4): CHARGEN-05 (engine/chargen/height.js) duplicates / deletes |height| rows picked evenly
          // over this sorted list. 6 shin rows + 2 waist rows (arch Batch 9): z 37 (hips / braies beside both
          // forearms) and z 45 (belly beside both upper arms) - clear of the wrists (34), waistband (40), navel /
          // elbows (42-43), the linea-alba cues (44, 46) and every hand box. So a tall man grows in legs AND
          // torso (+4 = 3 shin rows + 1 waist row), and the arms grow with the torso, the fingertips staying at mid-thigh.
          stretchRows: [7, 9, 10, 12, 13, 15, 37, 45],
          layers: buildBase(),
          // CHARGEN-23: the head at 1.25 cm (level 2 of region head; level 1 = the face v2 cells in `layers`)
          detail: { head: { '2': { layers: buildHeadL2() } } }
        }
      },
      shells: [],
      attachments: [],
      clips: {},
      defaults: {
        v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'medium', eyes: 'brown',
        hair: null, beard: null, top: null, legs: null, feet: null, outer: null, hat: null
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
    version: 1, KIT_ID: KIT_ID, CELL: CELL, SKELETON: SKELETON, PART_MAP: PART_MAP, MAX_PARTS: MAX_PARTS,
    STRETCH_BONES: STRETCH_BONES, ARM_STRETCH: ARM_STRETCH,
    buildHumanKit: buildHumanKit, stringifyKit: stringifyKit, decodeBase: decodeBase, resolveMat: resolveMat,
    countQuads: countQuads, checkKit: checkKit, decodeDetail: decodeDetail, downsample2: downsample2
  };
  A.chargenKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
