/*
 * design/chargen/human_kit.js - CHARGEN-01 Human kit GENERATOR (designer script, architecture 38.29 items 1-3).
 *
 * The kit JSON `content/chargen/human.charkit.json` is the ONLY source the core / app / game read. This file just
 * writes it (node tools/chargen-build-kit.mjs) and is loaded by the preview design/preview/chargen_kit.html,
 * which checks that the JSON on disk equals what this script builds.
 *
 * BASE m_avg v4 (OB-025, owner 2026-10-11 "look how detailed the bear is ... the human should be like that too; a bigger
 * model, a bit more realistic"; style-guide section 0: realistic shapes from voxels, nothing boxy):
 *   - same grid 37 x 20 x 72 (cellM 0.025, 70 body rows = 1.75 m + 2 rows of hair room), same 22 bones / partMap /
 *     slots / shell ids / attachment ids / anchors names / looks / defaults - only the SHAPE, the bone boxes, joints,
 *     stretch rows and the decal coordinates changed. New: kit.clips `idle` (breath) + `walk`, kit.looks.fen.
 *   - realistic adult proportions: head 10 rows (z 60-69 = 0.25 m -> 7 heads), shoulders 21 cells over the deltoids
 *     (0.525 m, ~2 heads), chest 13-15 wide / 9 deep with pecs and shoulder blades, waist 11, hips 15 with a seat and a
 *     lumbar hollow, crotch z 33 (0.83 m: legs = half the height), knee z 20, elbow z 45, wrist z 35, fingertips z 27
 *     (mid-thigh). Every cross-section is a ROUNDED rectangle (circular corner test, radius 2-3) and tapers in 2-4 row
 *     steps: deltoid caps, biceps, forearm swelling under the elbow, thin wrists, thigh > knee > calf bulge > ankle,
 *     a plantigrade foot with a heel and toes.
 *   - head built as a PROFILE: sloping forehead, brow ridge (Y -4) over recessed eye sockets (Y -3) with the iris `e`
 *     set in them, lit nose bridge and a tip 1 cell out (Y -5), cheekbones, nostrils, a philtrum, lips `p` on the jaw
 *     with a dark mouth interior, chin forward, jaw narrowing to the chin, ears at X +-4 (helix, hole, flushed lobe),
 *     rounded occiput. The 1.25 cm head (detail.head["2"]) is the 2x upsample REFINED: eyes become white-iris-white
 *     under a dark lid line, thinner angled brows, lips 2 thin rows with corners, nostril openings, a half-cell nose tip,
 *     an ear hole, softer blush, a chin dimple, a rounder jaw.
 *   - skin in 4 tones + accents: base `a`, lit planes `l` (forehead, nose bridge, cheekbones, shoulder tops, collar
 *     bones, pec tops, kneecaps, shin ridge, backs of the hands, knuckles), shade `s` (sockets, nose wings, cheek hollow,
 *     under the chin, throat, armpits, under the pecs, inner thighs, behind the knees, palms, forearm undersides),
 *     deep `d` (nostrils, mouth, navel, spine groove, gluteal cleft, armpit core, crotch), flush `f` (cheeks, ear lobes,
 *     elbow points), nails `n`, veins `v` (back of the hand, forearm).
 *   - hair `short`: one cell thick over the skull in 3 tones cut into locks (dark `K` hairline rim and partings, `g`
 *     base, `G` lit crown and upper locks), a crown volume (z 70-71), temples, sideburns, nape. Beard `full`: jaw,
 *     chin, under-chin, cheeks, moustache over the upper lip (lower lip stays visible), wavy 3-tone strands.
 *   - clothing shells re-fitted to the new bones (collar below the neck, rolled sleeves, boots to mid-shin, belt rows,
 *     tabard skirt above the knee); relief for folds: belt-buckle bump, rolled-cuff rings, boot-top rim, kneecaps,
 *     calf bulge, sole welt; the `heraldry` / `mended` decals (seams, trims, patches, laces, buckles) re-targeted.
 *   - rest pose: standing, arms down in a slight A (gap >= 3 cells from the torso below z 46), knees 3 cells apart.
 *
 * Bone boxes are axis-aligned and resolved FIRST-MATCH in skeleton order (38.29 item 3): Chest takes z 48-58 (ribcage,
 * shoulder tops, the lower neck rows 57-58), Neck is the z 59 ring, Jaw z 60-61 (lower lip + chin, full width),
 * Head z 62-71 (hair room), Shoulder = the deltoid caps X 8-16 z 55-58, UpperArm z 45-54, LowerArm z 35-44, Hand z 27-34.
 * Budget knobs (if `node tools/chargen-build-kit.mjs` reports the dressed default over ~3600 quads or body 1 / head 2
 * over 4096): DETAIL.hairLocks false (flat hair tones), DETAIL.headL2 false (plain 2x upsample), DETAIL.skinZones false.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  var SX = 37, SY = 20, SZ = 72, CX = 18, CY = 10, CELL = 0.025;
  var KIT_ID = 'kestrel.chargen.human';
  var DETAIL = { hairLocks: true, headL2: true, skinZones: true };

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

  // in-game collapse (38.29 item 1): the engine's array form (engine/chargen/collapse.js HUMANOID_PART_MAP)
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
  var MAX_PARTS = 8;

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
    c: { fixed: 'linen_light', keep: 8 },
    G: { group: 'hair', shade: 'light' }, g: { group: 'hair', shade: 'base' }, K: { group: 'hair', shade: 'dark' },
    1:{ group: 'top', shade: 'light' }, 2: { group: 'top', shade: 'base' }, 3: { group: 'top', shade: 'dark' },
    4: { group: 'legs', shade: 'light' }, 5: { group: 'legs', shade: 'base' }, 6: { group: 'legs', shade: 'dark' },
    7: { group: 'feet', shade: 'light' }, 8: { group: 'feet', shade: 'base' }, 9: { group: 'feet', shade: 'dark' },
    W: { group: 'outer', shade: 'light' }, w: { group: 'outer', shade: 'base' }, m: { group: 'outer', shade: 'dark' },
    H: { group: 'hat', shade: 'light' }, h: { group: 'hat', shade: 'base' }, j: { group: 'hat', shade: 'dark' },
    x: { group: 'hands', shade: 'light' }, z: { group: 'hands', shade: 'base' }, t: { group: 'hands', shade: 'dark' },
    B: { group: 'belt', shade: 'light' }, N: { group: 'belt', shade: 'base' }, O: { group: 'belt', shade: 'dark' },
    C: { group: 'cloak', shade: 'light' }, D: { group: 'cloak', shade: 'base' }, E: { group: 'cloak', shade: 'dark' },
    P: { fixed: 'hair_black_dark', keep: 9 },
    i: { fixed: 'iron_light', keep: 9 },
    q: { fixed: 'iron_light' }, r: { fixed: 'dye_gall_light' },
    R: { fixed: 'gore_red' }, y: { fixed: 'dye_weld_light' }
  };
  function firstThen(obj, first) {
    var o = {}, k;
    if (obj[first]) o[first] = obj[first];
    for (k in obj) if (k !== first) o[k] = obj[k];
    return o;
  }
  function buildRamps(CG) {
    var r = { skin: {}, lips: {}, eyes: {}, hair: {}, top: {}, legs: {}, feet: {}, outer: {}, hat: {}, hands: {}, belt: {}, cloak: {} };
    var id, g;
    for (id in CG.skin) {
      var s = CG.skin[id];
      r.skin[id] = { light: s.light, base: s.base, shade: s.shade, deep: s.deep, flush: s.flush, nail: s.nail, vein: s.vein };
      r.lips[id] = { lip: s.flush };
    }
    for (id in CG.eyes) r.eyes[id] = { iris: CG.eyes[id].iris };
    var hair = firstThen(CG.hair, 'darkbrown');
    for (id in hair) r.hair[id] = { light: hair[id].light, base: hair[id].base, dark: hair[id].dark, brow: hair[id].dark };
    ['top', 'legs', 'feet', 'outer', 'hat', 'hands', 'belt', 'cloak'].forEach(function (grp) {
      var dyes = firstThen(CG.dyes, grp === 'feet' ? 'walnut' : 'undyed');
      for (g in dyes) r[grp][g] = { light: dyes[g].light, base: dyes[g].base, dark: dyes[g].dark };
    });
    return r;
  }
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
  // circular corner test for a rounded rectangle (ea / eb = distance to the nearest edge on each axis); r <= 1 = sharp
  function keep(ea, eb, r) {
    if (r <= 1) return true;
    var da = Math.max(0, r - 0.5 - ea), db = Math.max(0, r - 0.5 - eb);
    return da * da + db * db <= (r - 0.5) * (r - 0.5) + 0.3;
  }

  // ===================================================================================================================
  // 4. HEAD (centred cells; z 60-69), ears at X +-4, built as a profile
  // ===================================================================================================================
  function headHalf(z) {
    if (z === 69) return 2;
    if (z >= 61 && z <= 68) return 3;
    if (z === 60) return 2;
    return -1;
  }
  // front-most Y per column (X, z)
  function headFront(X, z) {
    var ax = Math.abs(X), h = headHalf(z);
    if (h < 0 || ax > h) return null;
    if (z === 69) return ax === 2 ? 0 : -1;
    if (z === 68) return ax === 3 ? -1 : ax === 2 ? -2 : -3;
    if (z === 67 || z === 66) return ax === 3 ? -3 : -4;          // forehead + brow ridge, temples set back
    if (z === 65) return X === 0 ? -4 : -3;                        // eye sockets recessed, nose bridge out
    if (z === 64) return X === 0 ? -5 : -4;                        // nose tip one cell out, cheekbones
    if (z === 63) return -4;                                       // nostrils, cheeks
    if (z === 62 || z === 61) return ax === 3 ? -3 : -4;           // cheek hollow, lips
    return ax === 2 ? -3 : -4;                                     // chin (z 60)
  }
  // back-most Y per column
  function headBack(X, z) {
    var ax = Math.abs(X);
    if (z === 69) return ax === 2 ? 1 : 2;
    if (z === 68 || z === 67) return ax === 3 ? 2 : 3;
    if (z >= 63 && z <= 66) return ax <= 1 ? 4 : 3;                // occiput
    if (z === 62) return ax === 3 ? 2 : 3;
    if (z === 61) return 2;
    return ax === 2 ? 1 : 2;
  }
  // paint of the FRONT cell of each column, X -3..3 ('.' = no such column / plain skin)
  var FACE = {
    69: 'aaaaaaa', 68: 'aaaaaaa',
    67: 'sallals',   // temples shaded, lit forehead
    66: 'sbbabbs',   // brows on the ridge, glabella
    65: 'seslses',   // eye sockets: iris in a shaded socket, lit bridge
    64: 'laslsal',   // cheekbones lit, nose wings shaded, lit tip
    63: 'fadsdaf',   // blush, nostrils, shadow under the septum
    62: 'saasaas',   // cheek hollow, philtrum
    61: 'sapppas',   // jaw sides, lower lip (Jaw)
    60: '.salas.'    // chin: lit point, shaded underside edges
  };
  // ears (X +-4): keyed 'Y,z' - helix top, lit back rim, dark hole, flushed lobe
  var EAR = { '0,65': 'a', '1,65': 'l', '0,64': 'd', '1,64': 'a', '0,63': 'f' };
  function headChar(X, Y, z) {
    var ax = Math.abs(X), f, c;
    if (ax === 4) return (z >= 63 && z <= 65) ? (EAR[Y + ',' + z] || null) : null;
    f = headFront(X, z);
    if (f === null || Y < f || Y > headBack(X, z)) return null;
    if ((z === 61 || z === 62) && Y === -3 && ax <= 1) return 'd';     // mouth interior behind the lips
    if (Y === f && FACE[z]) { c = FACE[z].charAt(X + 3); return c === '.' ? 'a' : c; }
    return 'a';
  }
  function skullAt(X, Y, z) { return Math.abs(X) <= 3 && headChar(X, Y, z) !== null; }   // skull only (not the ears)
  function nearSkull(X, Y, z) {
    return skullAt(X + 1, Y, z) || skullAt(X - 1, Y, z) || skullAt(X, Y + 1, z) || skullAt(X, Y - 1, z) ||
           skullAt(X, Y, z + 1) || skullAt(X, Y, z - 1);
  }

  // short hair: one cell thick on the skull inside the hair zone + a crown volume
  var HAIR_BOX = { X0: -5, Y0: -5, z0: 60, w: 11, d: 11, h: 12 };
  function hairZone(X, Y, z) {
    var ax = Math.abs(X);
    if (z >= 70) return true;
    if (z >= 68) return true;                                         // all round the top of the skull (hairline on the forehead top)
    if (z === 67) return ax === 4 ? Y >= -2 : Y >= 3;                 // temples + the back
    if (z >= 64) return ax === 4 ? Y >= -1 : Y >= 3;                  // sides down to the ears (sideburn in front of the ear), back
    if (z >= 62) return ax === 4 ? Y >= 2 : Y >= 3;                   // behind the ears, nape
    if (z === 61) return ax <= 2 && Y >= 3;                           // nape hairline
    return false;
  }
  function isHair(X, Y, z) {
    if (z === 71) return Math.abs(X) <= 1 && Y >= -1 && Y <= 0 && isHair(X, Y, 70);   // crown tuft
    if (headChar(X, Y, z) !== null || !hairZone(X, Y, z)) return false;
    return nearSkull(X, Y, z);
  }
  function hairChar(X, Y, Z) {
    var ax = Math.abs(X), u, m, lit;
    if (!DETAIL.hairLocks) return Z >= 68 ? 'g' : (isHair(X, Y, Z - 1) ? 'g' : 'K');
    if (Z < 69 && !isHair(X, Y, Z - 1) && !skullAt(X, Y, Z - 1)) return 'K';   // hairline rim / nape / lower edge
    if (Z >= 70) {
      if (ax <= 2 && Y >= -2 && Y <= 1) return ((X + 2 * Y + 9) % 3 === 0) ? 'g' : 'G';   // lit crown with base strands
      return ((X + Y + 11) % 3 === 0) ? 'K' : 'g';
    }
    if (X === -2 && Y <= 1 && Z >= 68) return 'K';                              // side parting
    u = (ax >= 4 ? Y : X) + 21 + ((Z >> 1) & 1);                                 // waving locks down the sides / back
    m = u % 3; lit = Math.floor(u / 3) % 2 === 0;
    if (m === 0) return 'K';
    if (Z >= 66) return lit ? 'G' : 'g';
    return (!lit && m === 2 && Z <= 63) ? 'K' : 'g';
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
  // full beard + moustache (beard slot, hair ramp, bone Jaw): empty cells touching the lower skull
  var BEARD_BOX = { X0: -5, Y0: -6, z0: 59, w: 11, d: 8, h: 5 };
  function beardZone(X, Y, z) {
    var ax = Math.abs(X);
    if (Y > 1) return false;
    if (z === 59) return Y <= -3 && ax <= 2;                          // under the chin (clear of the neck ring)
    if (z === 60) return ax <= 3;                                     // chin front + jaw sides
    if (z === 61) return !(ax <= 1 && Y <= -4);                       // beside the mouth, jaw sides; lower lip stays visible
    if (z === 62) return ax <= 2 ? Y <= -4 : true;                    // moustache over the upper lip, cheeks
    if (z === 63) return ax >= 3 && Y <= 0;                           // cheek beard up to the cheekbones, sideburns
    return false;
  }
  function isBeard(X, Y, z) {
    if (headChar(X, Y, z) !== null || !beardZone(X, Y, z)) return false;
    return nearSkull(X, Y, z);
  }
  function beardChar(X, Y, Z) {
    var ax = Math.abs(X), u = ax + ((Z >> 1) & 1), m = u % 3;
    if (Z === 59) return m === 1 ? 'g' : 'K';
    if (Z === 62 && ax <= 2 && Y <= -4) return ax === 0 ? 'g' : 'G';   // lit moustache, split at the philtrum
    if (Z === 63) return m === 0 ? 'K' : 'G';
    if (m === 0) return 'K';
    return (Z >= 61 && m === 2) ? 'G' : 'g';
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

  // head region (38.34): Head box U Jaw box + beard room, centred [X0,X1, Y0,Y1, z0,z1]
  var HEAD_REGION = { bones: ['Head', 'Jaw'], box: [-5, 5, -10, 9, 59, 71] };

  // ===================================================================================================================
  // 5. BONES: joint (centred coords, continuous) + box (centred, INCLUSIVE cell ranges [X0,X1, Y0,Y1, z0,z1]).
  // ===================================================================================================================
  var CENTER_BONES = {
    Hips:  { joint: [0, 0.5, 34.0],  box: [-7, 7, -10, 9, 33, 40] },
    Spine: { joint: [0, 0.0, 41.0],  box: [-7, 7, -10, 9, 41, 47] },
    Chest: { joint: [0, 0.0, 48.0],  box: [-7, 7, -10, 9, 48, 58] },
    Neck:  { joint: [0, 0.5, 59.0],  box: [-2, 2, -2, 2, 59, 59] },
    Head:  { joint: [0, 0.5, 61.0],  box: [-5, 5, -10, 9, 62, 71] },
    Jaw:   { joint: [0, 1.5, 62.0],  box: [-4, 4, -10, 9, 60, 61] }
  };
  var SIDE_BONES = {   // right side, X >= 0
    Shoulder: { joint: [4.0, 0.5, 57.0],  box: [8, 16, -10, 9, 55, 58] },
    UpperArm: { joint: [10.0, 0.5, 55.5], box: [8, 16, -10, 9, 45, 54] },
    LowerArm: { joint: [12.5, 0.5, 45.0], box: [8, 16, -10, 9, 35, 44] },
    Hand:     { joint: [12.5, -0.5, 35.0], box: [8, 16, -10, 9, 27, 34] },
    UpperLeg: { joint: [4.5, 0.0, 33.0],  box: [1, 9, -10, 9, 20, 32] },
    LowerLeg: { joint: [4.0, 0.0, 20.0],  box: [1, 9, -10, 9, 3, 19] },
    Foot:     { joint: [4.0, 0.0, 3.0],   box: [1, 9, -3, 9, 0, 2] },
    Toes:     { joint: [4.0, -4.5, 0.5],  box: [1, 9, -10, -4, 0, 2] }
  };
  function gridJoint(j) { return [r3(j[0] + CX + 0.5), r3(j[1] + CY + 0.5), r3(j[2])]; }
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
  // 6. BUILD THE BASE m_avg (rounded slices, anatomy zones of skin tone)
  // ===================================================================================================================
  // torso rows: [z0, z1, half width, front Y, back Y, corner radius]
  var TORSO = [
    [33, 33, 7, -3, 3, 3],   // pelvis floor (crotch)
    [34, 36, 7, -4, 4, 3],   // pelvis + seat
    [37, 37, 7, -4, 3, 3],
    [38, 40, 6, -4, 3, 3],   // hip crest, lower belly
    [41, 43, 5, -3, 2, 2],   // waist, lumbar hollow
    [44, 44, 5, -3, 3, 2],
    [45, 47, 6, -4, 3, 3],   // lower ribs
    [48, 49, 6, -4, 4, 3],   // ribcage
    [50, 54, 6, -4, 4, 3],   // chest (pecs in front, blades behind)
    [55, 56, 7, -4, 3, 3],   // upper chest, collar bones
    [57, 57, 6, -3, 3, 3],   // shoulder tops (trapezius)
    [58, 58, 3, -2, 3, 2]    // neck base
  ];
  // one-side limb slices (right side, X >= 0): [z0, z1, X0, X1, Y0, Y1, r]
  var ARM = [
    [57, 57, 7, 9, -2, 2, 2],     // deltoid cap (acromion)
    [55, 56, 7, 10, -3, 3, 2],    // deltoid bulge
    [53, 54, 8, 11, -3, 2, 2],    // deltoid insertion
    [47, 52, 9, 13, -2, 2, 2],    // biceps / triceps
    [45, 46, 10, 14, -2, 2, 2],   // elbow
    [40, 44, 10, 14, -2, 2, 2],   // forearm swelling under the elbow
    [36, 39, 11, 14, -2, 1, 2],   // forearm
    [35, 35, 11, 13, -2, 1, 0]    // wrist (flat oval)
  ];
  var LEG = [
    [29, 32, 2, 7, -3, 3, 3],     // upper thigh
    [25, 28, 2, 7, -3, 2, 3],     // mid thigh
    [21, 24, 2, 6, -2, 2, 2],     // lower thigh
    [19, 20, 2, 6, -3, 2, 2],     // knee (cap forward)
    [15, 18, 2, 6, -2, 3, 2],     // calf (bulge back)
    [11, 14, 3, 6, -2, 2, 2],     // lower calf
    [8, 10, 3, 6, -2, 1, 2],      // above the ankle
    [3, 7, 3, 5, -2, 1, 0]        // ankle
  ];

  function buildBase() {
    var N = SX * SY * SZ, G = new Array(N), X, Y, z, i;
    for (i = 0; i < N; i++) G[i] = '.';
    function put(X, Y, z, ch) { var q = idx(X, Y, z); if (q >= 0) G[q] = ch; }
    function get(X, Y, z) { var q = idx(X, Y, z); return q < 0 ? '.' : G[q]; }
    function slab(z, X0, X1, Y0, Y1, r, ch) {
      for (var yy = Y0; yy <= Y1; yy++) for (var xx = X0; xx <= X1; xx++) {
        if (!keep(Math.min(xx - X0, X1 - xx), Math.min(yy - Y0, Y1 - yy), r)) continue;
        put(xx, yy, z, ch || 'a');
      }
    }
    function slabPair(z, X0, X1, Y0, Y1, r, ch) { slab(z, X0, X1, Y0, Y1, r, ch); slab(z, -X1, -X0, Y0, Y1, r, ch); }
    function pp(X, Y, z, ch) { put(X, Y, z, ch); put(-X, Y, z, ch); }
    // tint only an existing skin cell (never adds geometry)
    function tint(X, Y, z, ch) { var q = idx(X, Y, z); if (q >= 0 && G[q] === 'a') G[q] = ch; }
    function tintPair(X, Y, z, ch) { tint(X, Y, z, ch); tint(-X, Y, z, ch); }

    // ---- torso
    TORSO.forEach(function (r) { for (z = r[0]; z <= r[1]; z++) slab(z, -r[2], r[2], r[3], r[4], r[5]); });
    for (z = 50; z <= 53; z++) {                                                  // pecs: one cell in front of the chest plane
      var pX0 = (z === 50 || z === 53) ? 2 : 1, pX1 = (z === 50 || z === 53) ? 4 : 5;
      for (X = pX0; X <= pX1; X++) pp(X, -5, z, 'a');
    }
    // ---- neck ring (z 57-59; 57-58 sit inside the torso slices)
    for (z = 57; z <= 59; z++) slab(z, -2, 2, -2, 2, 2);
    // ---- arms (both sides)
    ARM.forEach(function (r) { for (z = r[0]; z <= r[1]; z++) slabPair(z, r[2], r[3], r[4], r[5], r[6]); });
    pp(12, 3, 45, 'a');                                                           // elbow point (olecranon)
    // ---- hands: palm 2 thick (X 12-13) z 31-34, fingers along Y (index -2 .. little 1), 2 thick at the base, 1 at the tips
    for (z = 31; z <= 34; z++) for (Y = -2; Y <= 1; Y++) { pp(12, Y, z, 'a'); pp(13, Y, z, 'a'); }
    var FINGER_TOP = { '-2': 28, '-1': 27, '0': 28, '1': 29 };                    // lowest row of each finger
    for (Y = -2; Y <= 1; Y++) for (z = FINGER_TOP[String(Y)]; z <= 30; z++) { pp(13, Y, z, 'a'); if (z >= 29) pp(12, Y, z, 'a'); }
    for (Y = -2; Y <= 1; Y++) pp(13, Y, FINGER_TOP[String(Y)], 'n');              // nails on the fingertips
    pp(12, -3, 32, 'a'); pp(13, -3, 32, 'a'); pp(12, -3, 33, 'a'); pp(13, -3, 33, 'a');   // thumb base, pointing forward
    pp(13, -4, 32, 'a'); pp(13, -4, 31, 'n');                                       // thumb tip + nail
    // ---- legs
    LEG.forEach(function (r) { for (z = r[0]; z <= r[1]; z++) slabPair(z, r[2], r[3], r[4], r[5], r[6]); });
    // ---- feet: instep, foot with heel, sole with toes (toes Y <= -4 = the Toes bone)
    slabPair(2, 2, 6, -4, 2, 2);
    slabPair(1, 2, 6, -6, 3, 2);
    slabPair(0, 2, 6, -7, 3, 2);
    // ---- relief for the clothes (outer / front / back only; the arm + thigh gaps stay)
    slabPair(42, 15, 15, -1, 1, 0); for (X = 11; X <= 14; X++) { pp(X, -3, 42, 'a'); pp(X, 3, 42, 'a'); }   // rolled-cuff ring
    slabPair(10, 7, 7, -2, 1, 0); for (X = 3; X <= 6; X++) { pp(X, -3, 10, 'a'); pp(X, 2, 10, 'a'); }       // boot-top rim
    for (X = -1; X <= 1; X++) { put(X, -5, 39, 'a'); put(X, -5, 40, 'a'); }                                 // belt-buckle bump
    slabPair(0, 7, 7, -5, 2, 0); for (X = 3; X <= 5; X++) { pp(X, -8, 0, 'a'); pp(X, 4, 0, 'a'); }         // sole welt
    // ---- head (profile-built, see headChar)
    for (z = 60; z <= 69; z++) for (Y = -6; Y <= 5; Y++) for (X = -4; X <= 4; X++) {
      var hc = headChar(X, Y, z);
      if (hc) put(X, Y, z, hc);
    }
    // ---- skin zones
    if (DETAIL.skinZones) {
      // throat + under the chin
      for (z = 57; z <= 59; z++) for (X = -2; X <= 2; X++) tint(X, -2, z, 's');
      tint(0, -2, 58, 'a'); tint(0, -2, 59, 'a');
      // shoulder tops, collar bones, pec tops
      for (X = 7; X <= 9; X++) tintPair(X, -1, 57, 'l'), tintPair(X, 0, 57, 'l');
      for (X = 1; X <= 5; X++) tintPair(X, -4, 56, 'l');
      for (X = 2; X <= 4; X++) tintPair(X, -5, 53, 'l');
      for (X = 1; X <= 5; X++) tintPair(X, -4, 49, 's');                    // under the pecs
      // armpits (torso sides under the deltoids) + the core
      for (z = 50; z <= 53; z++) for (Y = -2; Y <= 2; Y++) tintPair(6, Y, z, 's');
      tintPair(6, 0, 52, 'd');
      // navel, spine groove, gluteal cleft, crotch shadow
      tint(0, -3, 41, 'd');
      for (z = 41; z <= 47; z++) tint(0, headBackTorso(z), z, 'd');
      for (z = 48; z <= 54; z++) tint(0, 4, z, 'd');
      for (z = 34; z <= 36; z++) tint(0, 4, z, 'd');
      for (z = 31; z <= 32; z++) for (Y = -1; Y <= 1; Y++) tintPair(2, Y, z, 'd');
      for (z = 20; z <= 30; z++) for (Y = -2; Y <= 2; Y++) tintPair(2, Y, z, 's');   // inner thighs
      for (z = 19; z <= 20; z++) for (X = 3; X <= 5; X++) { tintPair(X, -3, z, 'l'); tintPair(X, 2, z, 's'); }   // kneecap, back of the knee
      tintPair(4, -3, 19, 'f');
      for (z = 8; z <= 14; z++) tintPair(4, -2, z, 'l');                     // shin ridge
      tintPair(5, 0, 3, 'l'); tintPair(3, 0, 4, 'l');                         // ankle bones
      for (X = 3; X <= 5; X++) { tintPair(X, -4, 2, 'l'); tintPair(X, -3, 2, 'l'); }   // top of the foot
      for (Y = -4; Y <= 3; Y++) for (X = 2; X <= 7; X++) tintPair(X, Y, 0, 's');     // sole
      for (X = 3; X <= 5; X++) tintPair(X, -8, 0, 's');
      tintPair(4, -7, 0, 'd'); tintPair(4, -7, 1, 'd');                      // between the toes
      // arms: inner sides shaded, outer top lit, elbow flushed, veins
      for (z = 47; z <= 52; z++) for (Y = -1; Y <= 1; Y++) tintPair(9, Y, z, 's');
      for (z = 36; z <= 44; z++) for (Y = -1; Y <= 1; Y++) tintPair(z >= 40 ? 10 : 11, Y, z, 's');
      for (z = 40; z <= 44; z++) tintPair(14, 0, z, 'l');
      tintPair(12, 3, 45, 'f'); tintPair(14, -1, 39, 'v');
      // hands: palm shaded, back of the hand lit with knuckles and a vein, thumb crease
      for (z = 31; z <= 33; z++) for (Y = -2; Y <= 1; Y++) tintPair(12, Y, z, 's');
      for (Y = -2; Y <= 1; Y++) { tintPair(13, Y, 32, 'l'); tintPair(13, Y, 31, 'l'); }
      tintPair(13, -1, 33, 'v'); tintPair(12, -3, 33, 's');
    }
    // ---- underwear: plain undyed linen braies, hip top (z 40) to mid-thigh (z 26); waistband + hem in linen_dark
    for (z = 26; z <= 40; z++) for (Y = -CY; Y < SY - CY; Y++) for (X = -8; X <= 8; X++) {
      var q = idx(X, Y, z);
      if (q >= 0 && G[q] !== '.') G[q] = (z === 40 || z === 26) ? 'U' : 'u';
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
  // back Y of the torso at row z (for the spine groove)
  function headBackTorso(z) {
    for (var i = 0; i < TORSO.length; i++) if (z >= TORSO[i][0] && z <= TORSO[i][1]) return TORSO[i][4];
    return 0;
  }

  // the 1.25 cm head block (38.34 detail.head["2"]): a straight 2x upsample of the level-1 cells owned by Head / Jaw
  // (first-match bone box), origin = the region box min, size = box extent x 2 - then REFINED (DETAIL.headL2): repaints
  // and a few carves / adds that stay inside the Head / Jaw boxes x 2 and never sit over a level-1 cell of another bone.
  function buildHeadL2(layers, bones) {
    var B = gridBox(HEAD_REGION.box), ex = B[3] - B[0] + 1, ey = B[4] - B[1] + 1, ez = B[5] - B[2] + 1;
    var order = SKELETON.map(function (b) { return b.name; }), own = {};
    function ownerOf(x, y, z) {
      var key = x + ',' + y + ',' + z;
      if (own[key] !== undefined) return own[key];
      var r = null;
      if (x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ && layers[z][y].charAt(x) !== '.') {
        for (var i = 0; i < order.length; i++) {
          var q = bones[order[i]].box;
          if (x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5]) { r = order[i]; break; }
        }
      }
      own[key] = r;
      return r;
    }
    function inRegion(x, y, z) { var o = ownerOf(x, y, z); return o !== null && HEAD_REGION.bones.indexOf(o) >= 0; }
    var W = ex * 2, Hh = ey * 2, Dz = ez * 2, F = new Array(W * Hh * Dz), fx, fy, fz;
    for (fz = 0; fz < Dz; fz++) for (fy = 0; fy < Hh; fy++) for (fx = 0; fx < W; fx++) {
      var gx = B[0] + (fx >> 1), gy = B[1] + (fy >> 1), gz = B[2] + (fz >> 1);
      F[fx + W * (fy + Hh * fz)] = inRegion(gx, gy, gz) ? layers[gz][gy].charAt(gx) : '.';
    }
    if (DETAIL.headL2) {
      // edit(X, Y, z, dx, dy, dz, ch): centred level-1 cell + half picks ('*' = both); ch '.' carves; a paint on an empty
      // fine cell ADDS it only when the level-1 cell is empty (seam rule) and lies in the Head / Jaw box
      function edit(X, Y, z, dx, dy, dz, ch) {
        var x = X + CX, y = Y + CY, owner = ownerOf(x, y, z);
        var okAdd = owner === null && inBox(bones.Head.box, x, y, z) || inBox(bones.Jaw.box, x, y, z) && owner === null;
        var dxs = dx === '*' ? [0, 1] : [dx], dys = dy === '*' ? [0, 1] : [dy], dzs = dz === '*' ? [0, 1] : [dz];
        dxs.forEach(function (a) { dys.forEach(function (b) { dzs.forEach(function (c) {
          var qx = (x - B[0]) * 2 + a, qy = (y - B[1]) * 2 + b, qz = (z - B[2]) * 2 + c;
          if (qx < 0 || qy < 0 || qz < 0 || qx >= W || qy >= Hh || qz >= Dz) return;
          var k = qx + W * (qy + Hh * qz);
          if (ch === '.') { F[k] = '.'; return; }
          if (F[k] === '.' && !okAdd) return;
          F[k] = ch;
        }); }); });
      }
      function inBox(q, x, y, z) { return x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5]; }
      [1, -1].forEach(function (s) {
        var inner = s > 0 ? 0 : 1, outer = 1 - inner;
        // eyes: dark lid line over white - iris - white (3 fine cells = 3.75 cm), set in the socket plane (Y -3)
        edit(2 * s, -3, 65, '*', 0, 1, 'd'); edit(s, -3, 65, outer, 0, 1, 'd');
        edit(2 * s, -3, 65, inner, 0, 0, 'e'); edit(2 * s, -3, 65, outer, 0, 0, 'c'); edit(s, -3, 65, outer, 0, 0, 'c');
        // brows: the upper half only, thicker at the inner end, the tail on the temple
        edit(2 * s, -4, 66, '*', 0, 0, 'a'); edit(s, -4, 66, outer, 0, 0, 'a');
        edit(3 * s, -3, 66, inner, 0, 1, 'b');
        // nostril openings (upper half), nose wings
        edit(s, -4, 63, '*', 0, 0, 'a'); edit(s, -4, 63, inner, 0, 1, 'd'); edit(s, -4, 63, outer, 0, 1, 's');
        // softer blush, mouth corners, lips: upper lip = lower half of z 62, lower lip = upper half of z 61
        edit(3 * s, -4, 63, '*', 0, 0, 'a');
        edit(s, -4, 62, outer, 0, 0, 'd'); edit(s, -4, 61, outer, 0, 1, 'd');
        edit(s, -4, 62, inner, 0, 0, 'p'); edit(s, -4, 62, '*', 0, 1, 'a');
        edit(s, -4, 61, inner, 0, 1, 'p'); edit(s, -4, 61, '*', 0, 0, 'a');
        // ears: lit helix rim on top, a small hole, a flushed lobe; rounder jaw corners
        edit(4 * s, 0, 65, '*', '*', 1, 'l'); edit(4 * s, 0, 64, '*', 1, '*', 's');
        for (var jy = -3; jy <= 1; jy++) edit(2 * s, jy, 60, outer, '*', 0, '.');
      });
      edit(0, -4, 62, '*', 0, 0, 'p'); edit(0, -4, 62, '*', 0, 1, 's');          // upper lip centre, philtrum
      edit(0, -4, 61, '*', 0, 1, 'p'); edit(0, -4, 61, '*', 0, 0, 's');          // lower lip centre, shadow under it
      edit(0, -4, 63, '*', 0, 0, 'a');                                             // under the nose: shadow only at the top
      edit(0, -6, 64, '*', 1, '*', 'l');                                           // nose tip half a cell further out
      edit(0, -5, 64, '*', '*', 0, 'a');                                           // the underside of the tip
      edit(0, -4, 60, '*', 0, 1, 's');                                             // chin dimple
      edit(0, -4, 60, '*', 0, 0, 'l');
      [-1, 0, 1].forEach(function (X) { edit(X, -4, 60, '*', 0, 0, '.'); });     // rounder chin bottom
    }
    var out = [];
    for (fz = 0; fz < Dz; fz++) {
      var L = [];
      for (fy = 0; fy < Hh; fy++) {
        var row = '';
        for (fx = 0; fx < W; fx++) row += F[fx + W * (fy + Hh * fz)];
        L.push(row);
      }
      out.push(L);
    }
    return out;
  }
  // the chin carve above removes the FRONT lower half of the chin cells, but `edit(2s, '*', 60, ...)` carves the outer
  // lower half of the jaw edge columns at every Y - both keep every remaining fine cell inside the Jaw box.

  // 38.34 downsample2 (preview / check twin of engine/chargen/downsample.js)
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
  function sides(bone, t0, t1) { return SIDES.map(function (S) { return { bone: S + bone, t0: t0, t1: t1 }; }); }
  // Chest t 0.1-1 = from the shoulder tops (z 57) down: the neck rows 58-59 stay bare (a collar line, not a turtle neck)
  function buildShells() {
    return [
      // linen shirt, rolled sleeves (LowerArm t < 0.3 = z 42-44, the cuff ring at z 42)
      { id: 'shirt', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Chest', t0: 0.1, t1: 1 }]
          .concat(sides('Shoulder', 0, 1), sides('UpperArm', 0, 1), sides('LowerArm', 0, 0.3)), thick: 0, paint: '2' },
      // trousers: hips to ankle (the boots cover the lower shin)
      { id: 'trousers', slot: 'legs', regions: [{ bone: 'Hips', t0: 0, t1: 1 }].concat(sides('UpperLeg', 0, 1), sides('LowerLeg', 0, 1)),
        thick: 0, paint: '5' },
      // leather boots: foot + toes + the lower 45 % of the shin (z 3-10, flared over the rim at z 10), one cell thick
      { id: 'boots', slot: 'feet', regions: sides('LowerLeg', 0.55, 1).concat(sides('Foot', 0, 1), sides('Toes', 0, 1)), thick: 1, paint: '9' },
      // belt: the top two hip rows (z 39-40) over the buckle bump, one cell thick
      { id: 'belt', slot: 'outer', regions: [{ bone: 'Hips', t0: 0, t1: 0.25 }], thick: 1, paint: 'm' },
      // ---- knight pieces (CHARGEN-26, kit.looks.knight); checker / trim / emblem come from the `heraldry` decal
      { id: 'mail', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Chest', t0: 0, t1: 1 }]
          .concat(sides('Shoulder', 0, 1), sides('UpperArm', 0, 1), sides('LowerArm', 0, 1)), thick: 0, paint: 'q' },
      { id: 'mail_legs', slot: 'legs', regions: [{ bone: 'Hips', t0: 0, t1: 1 }].concat(sides('UpperLeg', 0, 1), sides('LowerLeg', 0, 1)),
        thick: 0, paint: 'q' },
      { id: 'boots_gloves', slot: 'feet', regions: sides('LowerLeg', 0.55, 1).concat(sides('Foot', 0, 1), sides('Toes', 0, 1), sides('Hand', 0, 1)),
        thick: 1, paint: '9' },
      // white tabard: chest (below the neck), waist, hips and a split skirt to above the knee (UpperLeg t < 0.75 = z 23-32)
      { id: 'tabard', slot: 'outer', regions: [{ bone: 'Chest', t0: 0.1, t1: 1 }, { bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Hips', t0: 0, t1: 1 }]
          .concat(sides('UpperLeg', 0, 0.75)), thick: 1, paint: 'k' },
      // ---- CH1-D3 Fen: long wool tunic - sleeves to just above the wrist (LowerArm t < 0.8 = z 37-44), skirt to z 29
      { id: 'tunic', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }, { bone: 'Chest', t0: 0.1, t1: 1 }, { bone: 'Hips', t0: 0, t1: 1 }]
          .concat(sides('Shoulder', 0, 1), sides('UpperArm', 0, 1), sides('LowerArm', 0, 0.8), sides('UpperLeg', 0, 0.3)), thick: 0, paint: '2' },
      // ---- EQ-05 gear shells
      { id: 'gloves', slot: 'hands', regions: sides('Hand', 0, 1), thick: 1, paint: 'z' },
      { id: 'girdle', slot: 'belt', regions: [{ bone: 'Hips', t0: 0, t1: 0.25 }], thick: 1, paint: 'N' },
      { id: 'cloak', slot: 'cloak', regions: [{ bone: 'Chest', t0: 0.1, t1: 1 }, { bone: 'Spine', t0: 0, t1: 1 }].concat(sides('Shoulder', 0, 1)),
        thick: 1, paint: 'D' }
    ];
  }
  var RANDOM = {
    hair: { none: 0.3 }, beard: { none: 2, full: 1, mended: 0 }, hat: { none: 1, heraldry: 0, staff: 0 },
    legs: { none: 0, trousers: 1, mail_legs: 0 }, feet: { none: 0.2, boots: 1, boots_gloves: 0 },
    top: { shirt: 3, mail: 0, tunic: 0 }, outer: { belt: 2, tabard: 0 }
  };
  function knightLook() {
    return {
      v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'medium', eyes: 'brown',
      hair: { id: 'short', ramp: 'black' }, beard: { id: 'full', ramp: 'black' },
      top: { id: 'mail', ramp: 'undyed' }, legs: { id: 'mail_legs', ramp: 'undyed' }, feet: { id: 'boots_gloves', ramp: 'gall' },
      outer: { id: 'tabard', ramp: 'undyed' }, hat: { id: 'heraldry', ramp: 'undyed' }
    };
  }
  function fenLook() {
    return {
      v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'warm', eyes: 'grey',
      hair: { id: 'short', ramp: 'brown' }, beard: { id: 'mended', ramp: 'brown' },
      top: { id: 'tunic', ramp: 'lincoln' }, legs: { id: 'trousers', ramp: 'gall' }, feet: { id: 'boots', ramp: 'walnut' },
      outer: { id: 'belt', ramp: 'walnut' }, hat: { id: 'staff', ramp: 'walnut' }
    };
  }
  // attachment record: box in centred cells, offset computed from the base anchor (box origin - anchor)
  function attachment(base, id, slot, bone, anchor, box, layers, extra) {
    var anc = base.anchors[anchor];
    var a = { id: id, slot: slot, bone: bone, anchor: anchor,
              offset: [r3(box.X0 + CX - anc[0]), r3(box.Y0 + CY - anc[1]), r3(box.z0 - anc[2])],
              box: [box.w, box.d, box.h] };
    if (extra) for (var k in extra) a[k] = extra[k];
    a.layers = layers;
    return a;
  }
  // paint map -> rigid paintOnly decal anchored on `belt`
  function decal(base, id, slot, S, paint) {
    var z0 = SZ, z1 = -1, z, y, x, key;
    for (key in paint) { z = Math.floor(+key / (S[0] * S[1])); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
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
    return attachment(base, id, slot, 'Chest', 'belt', { X0: -CX, Y0: -CY, z0: z0, w: S[0], d: S[1], h: z1 - z0 + 1 }, layers, { paintOnly: true });
  }
  // red cross on gold (rows z 55 down to 47, X -3..3)
  var EMBLEM = ['..RRR..', '..RyR..', 'RRRyRRR', 'RyyyyyR', 'RRRyRRR', '..RyR..', '..RyR..', '..RyR..', '..RRR..'];
  function buildHeraldry(kit) {
    var rc = knightLook(); rc.hat = null;
    var C = composePreview(kit, 'm_avg', rc), S = C.size, paint = {}, x, y, z, k, c, X;
    for (z = 0; z < S[2]; z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      k = x + S[0] * (y + S[1] * z); c = C.ch[k]; X = x - CX;
      var aX = Math.abs(X);
      if (c === 'q' && ((aX >= 10 && z <= 36) || (aX <= 8 && (z === 11 || z === 12)))) paint[k] = 'r';   // solid mail hems
      else if (c === 'q' && ((x + y + z) & 1)) paint[k] = 'r';                                           // checker
      else if (c === 'k' && (z >= 56 || z === 40 || z === 41 || z === 23 || (z >= 23 && z <= 32 && aX <= 1))) paint[k] = 'R';   // trim, sash, hem, split
      else if (c === 'k' && z >= 24 && z <= 32 && aX === 4) paint[k] = 'u';                            // skirt folds
      else if (c === '9' && z >= 34 && z <= 35 && aX >= 9) paint[k] = '8';                             // glove cuffs
      else if (c === '9' && z === 31 && aX >= 14) paint[k] = '7';                                      // glove knuckles
      else if (c === 'k' && z >= 52 && z <= 55 && aX >= 7) paint[k] = 'R';                             // armhole trim
      else if (c === 'k' && z >= 41 && z <= 51 && aX === 7 && (z & 1)) paint[k] = 'u';                 // dotted side seams
      else if (c === 'k' && z >= 24 && z <= 55 && X === 0 && y - CY >= 3 && (z & 1) && C.ch[k + S[0]] === '.') paint[k] = 'u';   // back seam
    }
    var BUCKLE = { 41: 'yyy', 40: 'yRy', 39: 'yyy' };
    for (z = 39; z <= 41; z++) for (var bj = 0; bj < 3; bj++) {
      x = bj - 1 + CX;
      for (y = 0; y < S[1]; y++) {
        k = x + S[0] * (y + S[1] * z);
        if (C.ch[k] === '.') continue;
        if (C.ch[k] === 'k') paint[k] = BUCKLE[z].charAt(bj);
        break;
      }
    }
    EMBLEM.forEach(function (rowS, r) {
      z = 55 - r;
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
    return decal(kit.bases.m_avg, 'heraldry', 'hat', S, paint);
  }
  // the staff (hat slot, bone RightHand): 2 x 2 shaft X 12-13 / Y -5..-4 in front of the fist (z 31-33 wraps it)
  var STAFF_BOX = { X0: 11, Y0: -6, z0: 0, w: 4, d: 4, h: 67 };
  function staffChar(X, Y, z) {
    var sh = X >= 12 && X <= 13 && Y >= -5 && Y <= -4;
    if (z >= 31 && z <= 33 && !sh) {
      var ring = Y === -6 || (X === 14 && Y >= -5) || (X === 11 && Y <= -4);
      if (!ring) return null;
      if (Y === -6 && (X === 11 || X === 14) && z !== 32) return null;
      if (X === 11 && Y === -5 && z === 32) return 'n';
      if (z === 31) return 's';
      if (z === 33 && Y === -6) return X === 12 ? 'l' : 's';
      return 'a';
    }
    if (z >= 61 && z <= 64) {
      if ((X === 11 || X === 14) && (Y === -6 || Y === -3)) return null;
      if (z === 61) return 'j';
      if (z === 64) return (X === 11 || Y === -3) ? 'h' : 'H';
      return (X === 14 || Y === -6) ? 'H' : (X === 11 || Y === -3) ? 'j' : 'h';
    }
    if (z === 65) return sh ? (X === 13 && Y === -5 ? 'H' : 'h') : null;
    if (z === 66) return X === 13 && Y === -5 ? 'H' : null;
    if (!sh) {
      if (X === 14 && Y === -5 && z >= 55 && z <= 59) return 'U';
      if (X === 14 && Y === -5 && z === 54) return 'y';
      if ((z === 12 && X === 14 && Y === -5) || (z === 42 && X === 11 && Y === -4) || (z === 50 && X === 14 && Y === -4)) return 'j';
      return null;
    }
    if (z === 0) return 'r';
    if (z <= 2) return X === 13 && Y === -5 ? 'q' : 'r';
    if (z === 59 || z === 60) return 'U';
    if ((z >= 34 && z <= 36) || (z >= 28 && z <= 30)) return (z & 1) ? 'm' : 'w';   // grip wrap above + below the fist
    if (X === 13 && Y === -5) return z % 7 === 3 ? 'h' : 'H';
    if (X === 12 && Y === -4) return 'j';
    return z % 9 === 4 ? 'j' : 'h';
  }
  function buildStaff(base) {
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
    return attachment(base, 'staff', 'hat', 'RightHand', 'hand_r', STAFF_BOX, layers);
  }
  // the `mended` decal (beard slot, paintOnly): stubble, patches, bag strap, ragged hem, worn boots, laces, buckle, seams
  function buildMended(kit) {
    var rc = fenLook(); rc.beard = null; rc.hat = null;
    var C = composePreview(kit, 'm_avg', rc), S = C.size, paint = {}, x, y, z, k, c, X, Y, u;
    var HEAD = C.names.indexOf('Head'), JAW = C.names.indexOf('Jaw');
    function key(xx, yy, zz) { return xx + S[0] * (yy + S[1] * zz); }
    function proj(face, uu, zz) {
      var n = face === 'right' ? S[0] : S[1], i, kk;
      for (i = 0; i < n; i++) {
        kk = face === 'front' ? key(uu + CX, i, zz) : face === 'back' ? key(uu + CX, S[1] - 1 - i, zz) : key(S[0] - 1 - i, uu + CY, zz);
        if (kk >= 0 && kk < C.ch.length && C.ch[kk] !== '.') return kk;
      }
      return -1;
    }
    // stubble on the jaw and the lower face (never the lips, eyes or nose paint)
    for (z = 60; z <= 64; z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      k = key(x, y, z); c = C.ch[k]; X = x - CX; Y = y - CY;
      if ((c !== 'a' && c !== 's' && c !== 'l') || Y > 1) continue;
      if (C.bone[k] === JAW) paint[k] = ((x + z) & 1) ? 'g' : 'K';
      else if (C.bone[k] === HEAD && ((x + y + z) & 1) && (z === 62 || (Math.abs(X) >= 3 && Y >= -3))) paint[k] = 'K';
    }
    var PATCHES = [
      ['front', -5, -2, 49, 52, '2', 'U', '3'],    // left chest
      ['back', -5, -2, 50, 53, '2', '4', '3'],     // left shoulder blade
      ['right', -1, 2, 43, 46, '2', 'U', '3'],     // right elbow, outer side
      ['back', -14, -11, 43, 46, '2', '4', '3'],   // left elbow, back
      ['front', 3, 6, 18, 21, '5', '1', '6'],      // right knee
      ['front', -6, -3, 24, 27, '5', 'U', '6']     // left thigh
    ];
    PATCHES.forEach(function (p) {
      for (z = p[3]; z <= p[4]; z++) for (u = p[1]; u <= p[2]; u++) {
        k = proj(p[0], u, z);
        if (k < 0 || C.ch[k] !== p[5]) continue;
        var edge = u === p[1] || u === p[2] || z === p[3] || z === p[4];
        paint[k] = edge && ((u + z) & 1) ? p[7] : p[6];
      }
    });
    for (z = 41; z <= 56; z++) {                                                   // bag strap, right shoulder to the left hip
      var sx = Math.round(6 - (56 - z) * 12 / 15);
      ['front', 'back'].forEach(function (f) {
        for (u = sx - 1; u <= sx; u++) { k = proj(f, u, z); if (k >= 0 && C.ch[k] === '2' && !paint[k]) paint[k] = 'm'; }
      });
    }
    var hem = SZ, bootTop = -1;
    for (k = 0; k < C.ch.length; k++) {
      z = Math.floor(k / (S[0] * S[1]));
      if (C.ch[k] === '2' && z < 35) hem = Math.min(hem, z);
      if (C.ch[k] === '9') bootTop = Math.max(bootTop, z);
    }
    for (z = 0; z < S[2] && z <= Math.max(hem + 1, bootTop); z++) for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      k = key(x, y, z); c = C.ch[k]; Y = y - CY;
      if (c === '2' && (z === hem && x % 3 === 0 || z === hem + 1 && x % 6 === 0)) paint[k] = '3';      // ragged hem
      else if (c === '9' && z === bootTop) paint[k] = '8';                                                // folded cuff
      else if (c === '9' && z === 4 && Y < 0 && (x & 1)) paint[k] = '8';                                  // ankle crease
      else if (c === '9' && z >= 1 && z <= 2 && Y <= -5 && (x + z) % 3 === 0) paint[k] = '7';             // scuffed toe caps
      else if (c === '9' && z === 0) paint[k] = '9';
    }
    for (z = 3; z <= 9; z++) for (u = -6; u <= 6; u++) {                                                    // criss-cross laces
      if (Math.abs(u) < 2) continue;
      k = proj('front', u, z);
      if (k >= 0 && C.ch[k] === '9') paint[k] = ((z + Math.abs(u)) & 1) ? '7' : '9';
    }
    for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) { k = key(x, y, 1); if (C.ch[k] === '9' && !paint[k]) paint[k] = '8'; }   // upper band
    var BUCKLE = { 40: 'qqq', 39: 'qmq' };
    for (z = 39; z <= 40; z++) for (u = -1; u <= 1; u++) { k = proj('front', u, z); if (k >= 0 && C.ch[k] === 'm') paint[k] = BUCKLE[z].charAt(u + 1); }
    for (y = 0; y < S[1]; y++) for (x = 0; x < S[0]; x++) {
      X = x - CX;
      k = key(x, y, 57); if (C.ch[k] === '2' && Math.abs(X) <= 3 && !paint[k]) paint[k] = '3';            // collar band
      k = key(x, y, 37); if (C.ch[k] === '2' && Math.abs(X) >= 10 && !paint[k]) paint[k] = '3';           // sleeve hems
      for (z = 53; z <= 57; z++) { k = key(x, y, z); if (C.ch[k] === '2' && Math.abs(X) === 8 && ((y + z) & 1) && !paint[k]) paint[k] = '3'; }   // shoulder seams
    }
    for (z = 54; z <= 56; z++) { k = proj('front', 0, z); if (k >= 0 && C.ch[k] === '2' && !paint[k]) paint[k] = '3'; }   // neck slit
    for (u = -6; u <= 6; u++) { if (Math.abs(u) < 2) continue; k = proj('front', u, 20); if (k >= 0 && C.ch[k] === '5' && !paint[k] && (u & 1)) paint[k] = '6'; }   // knee creases
    return decal(kit.bases.m_avg, 'mended', 'beard', S, paint);
  }

  // ---- clips (engine/chargen/clip.js: degrees Rz*Ry*Rx, keys sorted by t, durations multiples of 50 ms; rx + = tilt
  // forward / jaw open, ry - on the right arm = swing out; Hips pos in cells). In-game the 8-part collapse keeps the root
  // bone of each part (knees / elbows are lost there, the 22-bone glb plays them).
  function buildClips() {
    return {
      // standing breath: chest rises and the head sways a little, the arms drift, the hips bob 0.3 cell
      idle: { duration: 4000, loop: true, keys: [
        { t: 0, rot: { Chest: [0, 0, 0], Head: [0, 0, 0] }, pos: { Hips: [0, 0, 0] } },
        { t: 1000, rot: { Chest: [-0.8, 0, 0], Spine: [-0.4, 0, 0], Head: [0.5, 0, 1.5], RightUpperArm: [0, -0.8, 0], LeftUpperArm: [0, 0.8, 0] }, pos: { Hips: [0, 0, 0.15] } },
        { t: 2000, rot: { Chest: [-1.6, 0, 0], Spine: [-0.8, 0, 0], Head: [1.0, 0, 0], RightUpperArm: [0, -1.5, 0], LeftUpperArm: [0, 1.5, 0], RightLowerArm: [-1, 0, 0], LeftLowerArm: [-1, 0, 0] }, pos: { Hips: [0, 0, 0.3] } },
        { t: 3000, rot: { Chest: [-0.8, 0, 0], Spine: [-0.4, 0, 0], Head: [0.5, 0, -1.5], RightUpperArm: [0, -0.8, 0], LeftUpperArm: [0, 0.8, 0] }, pos: { Hips: [0, 0, 0.15] } }
      ] },
      // walk ~1.1 m/s: legs swing +-25, knees bend on the swing, arms counter-swing, torso counter-rotates, a 0.4 cell bob
      walk: { duration: 800, loop: true, keys: [
        { t: 0, rot: { LeftUpperLeg: [-24, 0, 0], LeftLowerLeg: [6, 0, 0], RightUpperLeg: [22, 0, 0], RightLowerLeg: [20, 0, 0], RightFoot: [-10, 0, 0],
                       RightUpperArm: [-20, 0, 0], RightLowerArm: [-14, 0, 0], LeftUpperArm: [22, 0, 0], LeftLowerArm: [-6, 0, 0],
                       Spine: [2, 0, 5], Chest: [0, 0, -3], Head: [-1, 0, -2] }, pos: { Hips: [0, 0, -0.4] } },
        { t: 200, rot: { LeftUpperLeg: [-4, 0, 0], LeftLowerLeg: [4, 0, 0], RightUpperLeg: [2, 0, 0], RightLowerLeg: [38, 0, 0], RightFoot: [-6, 0, 0],
                         RightUpperArm: [0, 0, 0], RightLowerArm: [-10, 0, 0], LeftUpperArm: [0, 0, 0], LeftLowerArm: [-10, 0, 0],
                         Spine: [2, 0, 0], Chest: [0, 0, 0], Head: [-1, 0, 0] }, pos: { Hips: [0, 0, 0] } },
        { t: 400, rot: { LeftUpperLeg: [22, 0, 0], LeftLowerLeg: [20, 0, 0], LeftFoot: [-10, 0, 0], RightUpperLeg: [-24, 0, 0], RightLowerLeg: [6, 0, 0],
                         RightUpperArm: [22, 0, 0], RightLowerArm: [-6, 0, 0], LeftUpperArm: [-20, 0, 0], LeftLowerArm: [-14, 0, 0],
                         Spine: [2, 0, -5], Chest: [0, 0, 3], Head: [-1, 0, 2] }, pos: { Hips: [0, 0, -0.4] } },
        { t: 600, rot: { LeftUpperLeg: [2, 0, 0], LeftLowerLeg: [38, 0, 0], LeftFoot: [-6, 0, 0], RightUpperLeg: [-4, 0, 0], RightLowerLeg: [4, 0, 0],
                         RightUpperArm: [0, 0, 0], RightLowerArm: [-10, 0, 0], LeftUpperArm: [0, 0, 0], LeftLowerArm: [-10, 0, 0],
                         Spine: [2, 0, 0], Chest: [0, 0, 0], Head: [-1, 0, 0] }, pos: { Hips: [0, 0, 0] } }
      ] }
    };
  }

  function buildHumanKit(P /*, opts (unused since v4) */) {
    var CG = P.chargen;
    if (!CG) throw new Error('human_kit: palette.chargen missing (load design/palette.js v1.54+)');
    var bones = boneTable(), layers = buildBase();
    function mount(X, Y, z) { return gridJoint([X, Y, z]); }
    var base = {
      label: 'Man, average build (1.75 m)',
      heightM: 1.75,
      size: [SX, SY, SZ],
      anchor: [CX + 0.5, CY + 0.5, 0],
      bones: bones,
      anchors: {
        head_top: mount(0, -0.5, 69.5),
        eyes: mount(0, -3.0, 65.5),
        mouth: mount(0, -4.0, 61.5),
        hand_r: mount(12.5, -0.5, 31.5),
        hand_l: mount(-12.5, -0.5, 31.5),
        back: mount(0, 3.5, 50.0),
        belt: mount(0, -4.0, 38.5)
      },
      // height (-4..4): 4 lower-shin rows z 4-7 (LowerLeg only, inside the boots) + 3 waist rows z 42-44 (Spine beside
      // both forearms) - clear of every hand box (z 27-34) and the head region (z 59+)
      stretchRows: [4, 5, 6, 7, 42, 43, 44],
      layers: layers,
      detail: { head: { '2': { layers: buildHeadL2(layers, bones) } } }
    };
    var kit = {
      kind: 'charkit',
      schema: 1,
      id: KIT_ID,
      name: 'Kestrel human kit v4 (OB-025)',
      cellM: CELL,
      axes: 'cells; x = east (the character\'s right), y = south (the character faces north, -y), z = up; ' +
            'layers[z][y] = string of x; joints / anchors / mount positions are continuous cell coordinates',
      skeleton: SKELETON,
      partMap: PART_MAP,
      regions: { head: { bones: HEAD_REGION.bones.slice(), box: gridBox(HEAD_REGION.box) } },
      resLevels: { body: [1], head: [1, 2] },
      slots: SLOTS,
      ramps: buildRamps(CG),
      handTint: CG.handTint,
      bases: { m_avg: base },
      shells: buildShells(),
      attachments: [
        attachment(base, 'short', 'hair', 'Head', 'head_top', HAIR_BOX, buildHair()),
        attachment(base, 'full', 'beard', 'Jaw', 'mouth', BEARD_BOX, buildBeard())
      ],
      clips: buildClips(),
      random: RANDOM,
      defaults: {
        v: 1, kit: KIT_ID, base: 'm_avg', height: 0, age: 'adult', skin: 'medium', eyes: 'brown',
        hair: { id: 'short', ramp: 'darkbrown' }, beard: null,
        top: { id: 'shirt', ramp: 'undyed' }, legs: { id: 'trousers', ramp: 'walnut' }, feet: { id: 'boots', ramp: 'walnut' },
        outer: { id: 'belt', ramp: 'walnut' }, hat: null
      },
      looks: { knight: knightLook(), fen: fenLook() }
    };
    kit.attachments.push(buildHeraldry(kit));
    kit.attachments.push(buildStaff(base));
    kit.attachments.push(buildMended(kit));
    return kit;
  }

  function stringifyKit(kit) {
    return JSON.stringify(kit, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, function (m, inner) {
      return '[' + inner.replace(/,\s+/g, ', ') + ']';
    }) + '\n';
  }

  // ===================================================================================================================
  // 8. PREVIEW / TEST HELPERS (twins of engine/chargen; unchanged since CHARGEN-26)
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
  var SHELL_SLOTS = ['legs', 'feet', 'top', 'hands', 'belt', 'outer', 'cloak'], ATTACH_SLOTS = ['hair', 'beard', 'hat'];
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
  function checkKit(kit, P, DP) {
    var errors = [], warnings = [], stats = {};
    var names = kit.skeleton.map(function (b) { return b.name; });
    if (names.length !== 22) errors.push('skeleton has ' + names.length + ' bones, want 22');
    kit.skeleton.forEach(function (b, i) {
      if (b.parent !== null && names.indexOf(b.parent) < 0) errors.push('bone ' + b.name + ': unknown parent ' + b.parent);
      if (b.parent !== null && names.indexOf(b.parent) > i) errors.push('bone ' + b.name + ': parent listed later');
    });
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
    // clips: durations multiples of 50, keys sorted, known bones
    for (var cn in kit.clips || {}) {
      var cl = kit.clips[cn];
      if (!(cl.duration > 0) || cl.duration % 50) errors.push('clip ' + cn + ': duration must be a positive multiple of 50 ms');
      if (!Array.isArray(cl.keys) || !cl.keys.length) errors.push('clip ' + cn + ': keys missing');
      else cl.keys.forEach(function (kf, ki) {
        if (ki && kf.t <= cl.keys[ki - 1].t) errors.push('clip ' + cn + ': keys not sorted');
        if (kf.t >= cl.duration) errors.push('clip ' + cn + ': key t ' + kf.t + ' >= duration');
        for (var bn in kf.rot || {}) if (names.indexOf(bn) < 0) errors.push('clip ' + cn + ': unknown bone ' + bn);
        for (bn in kf.pos || {}) if (bn !== 'Hips') errors.push('clip ' + cn + ': pos only on Hips');
      });
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
    version: 4, KIT_ID: KIT_ID, knightLook: knightLook, fenLook: fenLook, CELL: CELL, SKELETON: SKELETON, PART_MAP: PART_MAP, MAX_PARTS: MAX_PARTS,
    STRETCH_BONES: STRETCH_BONES, ARM_STRETCH: ARM_STRETCH, DETAIL: DETAIL,
    buildHumanKit: buildHumanKit, stringifyKit: stringifyKit, decodeBase: decodeBase, resolveMat: resolveMat,
    countQuads: countQuads, checkKit: checkKit, decodeDetail: decodeDetail, downsample2: downsample2,
    composePreview: composePreview
  };
  A.chargenKit = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
