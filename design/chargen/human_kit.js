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
 *   - face: recessed eyes under a brow ridge, nose bridge + tip, cheekbones, ears with concha and lobe, lips with
 *     darker corners, a dark mouth interior on the jaw seam (seen when the Jaw bone opens), chin.
 *   - hands: palm facing the thigh, thumb forward, four fingers with natural lengths (middle longest, pinky
 *     shortest), slight curl, knuckles, nails, veins. Feet: heel, arch, ball, big toe, toes, ankle bones.
 *   - skin variation: soft 7.5 cm tone patches (light / flush), plus anatomy cues (collarbones, sternum, pec line,
 *     nipples, navel, spine groove, shoulder blades, kneecaps, elbows).
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

  // in-game collapse (38.29 item 1), humanoid default: part -> bones (the first bone is the part root / pivot)
  var PART_MAP = {
    body: ['Hips', 'Spine'],
    chest: ['Chest', 'LeftShoulder', 'RightShoulder'],
    head: ['Neck', 'Head'],
    jaw: ['Jaw'],
    armL: ['LeftUpperArm', 'LeftLowerArm', 'LeftHand'],
    armR: ['RightUpperArm', 'RightLowerArm', 'RightHand'],
    legL: ['LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes'],
    legR: ['RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes']
  };

  // ===================================================================================================================
  // 2. SLOTS (layer char -> group + shade, or a fixed material) and GROUPS (which recipe field picks the ramp id)
  // ===================================================================================================================
  var SLOTS = {
    a: { group: 'skin', shade: 'base' }, l: { group: 'skin', shade: 'light' }, s: { group: 'skin', shade: 'shade' },
    d: { group: 'skin', shade: 'deep' }, f: { group: 'skin', shade: 'flush' }, n: { group: 'skin', shade: 'nail' },
    v: { group: 'skin', shade: 'vein' },
    p: { group: 'lips', shade: 'lip' },
    e: { group: 'eyes', shade: 'iris' },
    b: { group: 'hair', shade: 'brow' },
    u: { fixed: 'linen' }, U: { fixed: 'linen_dark' }, k: { fixed: 'linen_light' },
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
  // the engine's stretch rule (engine/chargen/kit.js STRETCH_BONES)
  var STRETCH_BONES = ['Hips', 'Spine', 'LeftLowerLeg', 'RightLowerLeg'];

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
  // a skin, l light, s shade, d deep, f flush, p lips, e iris, b brow
  var HEAD = {
    69: ['.......', '.......', '.......', '..aaa..', '.aaaaa.', '.aaaaa.', '.aaaaa.', '..aaa..', '.......', '.......'],
    68: ['.......', '.......', '..aaa..', '.aaaaa.', '.aaaaa.', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '.......'],
    67: ['.......', '.aalaa.', '.aaaaa.', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '.......'],
    66: ['.......', '.bblbb.', '.aaaaa.', 'saaaaas', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..'],
    65: ['.......', '.s.l.s.', '.seaes.', 'saaaaas', 'saaaaas', 'faaaaaf', 'faaaaaf', 'aaaaaaa', '.aaaaa.', '..aaa..'],
    64: ['...a...', '.laaal.', '.aaaaa.', '.aaaaa.', '.aaaaa.', 'daaaaad', 'faaaaaf', '.aaaaa.', '.aaaaa.', '..aaa..'],
    63: ['...l...', '.afsfa.', '.aaaaa.', '.aaaaa.', '.aaaaa.', 'faaaaaf', '.aaaaa.', '.aaaaa.', '.aaaaa.', '.......'],
    62: ['.......', '.aspsa.', '.addda.', '.aaaaa.', '.aaaaa.', '.aaaaa.', '.aaaaa.', '.aaaaa.', '..aaa..', '.......'],
    61: ['.......', '..apa..', '.addda.', '.aaaaa.', '.......', '.......', '.......', '.......', '.......', '.......'],
    60: ['.......', '..ala..', '.aaaaa.', '..sss..', '.......', '.......', '.......', '.......', '.......', '.......']
  };

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

    // ---- soft skin-tone patches (7.5 cm lattice): flush / light, never on authored cells ----
    for (z = 0; z < SZ; z++) for (Y = -CY; Y < SY - CY; Y++) for (X = -CX; X < SX - CX; X++) {
      k = idx(X, Y, z);
      if (G[k] !== 'a' || LOCK[k]) continue;
      var nz = vnoise(X + 40, Y + 40, z, 3, 17);
      if (nz > 0.70) G[k] = 'f'; else if (nz < 0.27) G[k] = 'l';
    }

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
          // height (-4..4): CHARGEN-05 duplicates / deletes the first |height| rows of this list. Shin rows only:
          // every waist row (z 34-47) also crosses the forearms / upper arms, which the engine's STRETCH_BONES
          // (Hips, Spine, LeftLowerLeg, RightLowerLeg) forbid. Spread over the shin so no single section stretches.
          stretchRows: [12, 9, 15, 7, 13, 10],
          layers: buildBase()
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
        for (var q2 = z * B.size[0] * B.size[1]; q2 < (z + 1) * B.size[0] * B.size[1]; q2++) {
          if (D.bone[q2] >= 0 && STRETCH_BONES.indexOf(names[D.bone[q2]]) < 0) { stretchBad.push(z + ':' + names[D.bone[q2]]); break; }
        }
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
    }
    return { errors: errors, warnings: warnings, stats: stats };
  }

  var api = {
    version: 1, KIT_ID: KIT_ID, CELL: CELL, SKELETON: SKELETON, PART_MAP: PART_MAP,
    buildHumanKit: buildHumanKit, stringifyKit: stringifyKit, decodeBase: decodeBase, resolveMat: resolveMat,
    countQuads: countQuads, checkKit: checkKit
  };
  A.chargenKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
