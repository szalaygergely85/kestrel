/*
 * Kestrel - THE BARE HAND + THE BURNING HAND (owner ask 2026-10-08: "a nice model for the hand, and burning - the hand
 * is burning"; owner update: "smaller cubes so fingers, knuckles, thumb and nails read; the fire must surround the whole
 * hand and wrist, embers rising, hand lit by its own fire"). Stories HAND-ART-01 (model) / HAND-BURN-01 (fire + wiring).
 * Owner: Designer. Formats: architecture.md 15.1 (VoxelModelDef), README 7.4 (view models) + README 22 (this file:
 * VARIANTS, cycle tokens, glow, particle rules), README 8 (particles). Preview: design/preview/hand.html.
 *
 * LOOK: Wick's bare left hand and forearm at cellM 0.01 (1 cm cubes, half the spell glove's 2 cm): 2-cube fingers with
 * 3 phalanges each, knuckle bumps, a thumb with its ball (thenar), palm creases (heart / head / life line), pale nails,
 * creases between the fingers, a leather wrist wrap with a rope cord and a rolled linen sleeve far back. Skin in 4 tones
 * (skin_light ridges / knuckles, skin, skin_shade creases, skin_nail). BURNING: the hand cups a white-hot core and fire
 * wraps the whole hand and wrist - a broken shell of flame cubes on every side (dense on the up side, thin licks under
 * the back of the hand), 20-30 tongues that climb the fingers, lick out between them, curl round the palm edge and rise
 * off the wrist, red breakaway tips and loose ember cubes above. Skin touched by flame turns skin_glow (emissive 0.35:
 * the hand is lit by its own fire), nails char black (skin_char). Plus the carried `handFire` light (flicker) and
 * sim-side ember / ignite / smoke particles.
 *
 * WHY "VARIANTS": the view-model layer poses the WHOLE model (one FORWARD per part, computed once at load from the
 * model's `held` clip; viewModel.js) - it has no part clips. Finger poses and flame flicker are therefore baked as
 * separate voxel models of the same hand (same anchor = the wrist), and a clip key names the variant to show from that
 * key on (step). Flame flicker = a CYCLE of 4 baked fire frames at 12 fps. ENGINE NEED (HAND-BURN-01a, architect):
 * `def.variants` + `vm.setVariant(h, name)` (load packs every variant mesh; per-frame flag write). Until then the
 * game can show ONE static variant (def.model = handBurnAL) and the light flicker + particles carry the life.
 *
 * WHAT THIS FILE SETS
 *   ASSETS.voxelModels.hand<Variant>L   15 models (authored LEFT: thumb on -x; the engine mirrors for the right hand,
 *                                       37.8a): plain open / relax / cup / fist / cast; burning burnKindle,
 *                                       burnA..burnD (cup, 4 flicker frames), burnFistA/B, burnCastA/B, burnEmber.
 *                                       One part `hand`, clip `held`, mounts wrist / palm / core / tip / knuckles.
 *                                       Record field `light: false` (EMIS-01 must not derive a 2nd light: the
 *                                       carried handFire light is the hand's light) + `stats` (voxel counts).
 *   ASSETS.viewModels.hand              README 7.4 + 22 def: hand 'left', variants, cycles, clips idle / breathe /
 *                                       cast / hold / burnStart / burnLoop / burnCast / burnOut / raise / lower,
 *                                       glow, carriedLight (handFire), castOffset, particles (emit rules).
 *   ASSETS.handFx                       particle presets handEmbers / handIgnite / handSmoke, tune, build(), rebuild(),
 *                                       attach(), validate(palette), util (rotApply, rotInv, sampleClip, mountEye).
 *   palette.js (appended): colours skinLight, skinNail, skinGlow, skinChar; materials skin_light, skin_shade,
 *                          skin_nail, skin_glow, skin_char, flame_tip; light handFire. detail-pass.js: v2 records + remap.
 *
 * LOADING (classic script, no import/export): after palette.js, detail-pass.js, models/particles.js.
 *   game/index.html: <script src="../design/models/hand.js"></script> (HAND-BURN-01b, not added here).
 *
 * AXES (15.1): x = across the hand (LEFT hand: thumb -x, pinky +x), y = palm normal (y- = back of the hand, y+ = palm
 * face), z = along the arm (z- = elbow, z+ = fingertips). The rest pose rx ~80 tips the fingers forward and the palm UP.
 * Builder works in "hand cells" (1 unit = 1 voxel) with the wrist centre at (0, 0, 0) = the anchor.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  A.voxelModels = A.voxelModels || {};
  A.viewModels = A.viewModels || {};

  var CELL = 0.01;
  var MATS = {
    a: 'skin', L: 'skin_light', s: 'skin_shade', n: 'skin_nail', g: 'skin_glow', c: 'skin_char',
    d: 'linen_dark', D: 'linen', l: 'leather', r: 'rope',
    E: 'ember_core', e: 'ember_glow', t: 'flame_tip'
  };
  var CH = { a: 97, L: 76, s: 115, n: 110, g: 103, c: 99, E: 69, e: 101, t: 116 };
  var FIRE_RANK = { 69: 3, 101: 2, 116: 1 };

  // ===================================================================================================================
  // 1. MATHS
  // ===================================================================================================================
  var DEG = Math.PI / 180;
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function ell(p, c, r) {
    var a = (p[0] - c[0]) / r[0], b = (p[1] - c[1]) / r[1], d = (p[2] - c[2]) / r[2];
    return a * a + b * b + d * d <= 1;
  }
  function hash(x, y, z, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440670441) +
             Math.imul(s | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot, = spell.js rotApply)
  function rotApply(r, v) {
    var x = v[0], y = v[1], z = v[2], c, s, t;
    c = Math.cos(r[0] * DEG); s = Math.sin(r[0] * DEG); t = c * y - s * z; z = s * y + c * z; y = t;
    c = Math.cos(r[1] * DEG); s = Math.sin(r[1] * DEG); t = c * x + s * z; z = -s * x + c * z; x = t;
    c = Math.cos(r[2] * DEG); s = Math.sin(r[2] * DEG); t = c * x - s * y; y = s * x + c * y; x = t;
    return [x, y, z];
  }
  function rotInv(r, v) {
    var x = v[0], y = v[1], z = v[2], c, s, t;
    c = Math.cos(-r[2] * DEG); s = Math.sin(-r[2] * DEG); t = c * x - s * y; y = s * x + c * y; x = t;
    c = Math.cos(-r[1] * DEG); s = Math.sin(-r[1] * DEG); t = c * x + s * z; z = -s * x + c * z; x = t;
    c = Math.cos(-r[0] * DEG); s = Math.sin(-r[0] * DEG); t = c * y - s * z; z = s * y + c * z; y = t;
    return [x, y, z];
  }

  // ===================================================================================================================
  // 2. ANATOMY (hand cells = 1 cm; wrist centre = origin). LEFT hand: thumb on -x.
  //    Palm 9 wide (x -4.1..4.7) x 3.6 thick x 11 long, fingers r ~1.0-1.1 (2 cubes across, 3 phalanges),
  //    middle finger 10 long; thumb 3 segments from the thenar; forearm z -16..0 (off-screen behind ~z -5 at rest).
  // ===================================================================================================================
  var FINGERS = [
    { id: 'index',  base: [-2.8, -0.2, 10.4], len: [4.3, 2.6, 2.0], r: [1.10, 1.02, 0.94] },
    { id: 'middle', base: [-0.7, -0.2, 10.9], len: [4.8, 3.0, 2.2], r: [1.14, 1.06, 0.97] },
    { id: 'ring',   base: [ 1.4, -0.2, 10.5], len: [4.5, 2.8, 2.1], r: [1.07, 1.00, 0.92] },
    { id: 'pinky',  base: [ 3.4, -0.3,  9.5], len: [3.5, 2.1, 1.8], r: [0.97, 0.90, 0.84] }
  ];
  var THUMB = { base: [-3.0, 0.5, 1.2], len: [4.0, 3.0, 2.4], r: [1.50, 1.22, 1.06], nailRef: [-0.85, -0.3, 0] };
  var PALM = [0.3, 1.9, 5.5];          // palm face centre (mount `palm`)
  var Z = [0, 0, 1];

  // spread (deg, + = toward +x / pinky side), curl per joint (deg, + = toward the palm), thumb segment directions
  var POSES = {
    open:  { spread: [-6, -1, 4, 10],   curl: [[10, 14, 8], [12, 16, 10], [15, 19, 12], [18, 22, 14]],
             thumb: [[-0.70, 0.40, 0.59], [-0.40, 0.45, 0.80], [-0.28, 0.42, 0.86]] },
    relax: { spread: [-5, -1, 3, 8],    curl: [[18, 24, 14], [22, 28, 16], [26, 32, 18], [30, 36, 20]],
             thumb: [[-0.66, 0.46, 0.59], [-0.32, 0.55, 0.77], [-0.18, 0.55, 0.81]] },
    cup:   { spread: [-9, -2, 5, 13],   curl: [[28, 34, 20], [30, 36, 22], [33, 39, 24], [36, 42, 26]],
             thumb: [[-0.68, 0.52, 0.52], [-0.30, 0.68, 0.67], [-0.10, 0.72, 0.68]] },
    fist:  { spread: [-3, 0, 2, 5],     curl: [[82, 98, 55], [84, 100, 55], [86, 100, 55], [88, 100, 55]],
             thumb: [[-0.45, 0.55, 0.70], [0.05, 0.62, 0.78], [0.80, 0.30, 0.52]] },
    cast:  { spread: [-15, -3, 9, 22],  curl: [[-6, 4, 2], [-5, 4, 2], [-4, 5, 3], [-3, 6, 4]],
             thumb: [[-0.88, 0.22, 0.42], [-0.80, 0.08, 0.60], [-0.70, 0.02, 0.72]] }
  };

  function fingerSegs(f, fi, spreadDeg, curls) {
    var segs = [], p = f.base.slice(), th = 0, s = spreadDeg * DEG, sS = Math.sin(s), cS = Math.cos(s), i;
    for (i = 0; i < 3; i++) {
      th += curls[i] * DEG;
      var d = [sS * Math.cos(th), Math.sin(th), cS * Math.cos(th)];
      var dors = [sS * Math.sin(th), -Math.cos(th), cS * Math.sin(th)];
      var q = add(p, mul(d, f.len[i]));
      segs.push({ a: p, b: q, r0: f.r[i], r1: i < 2 ? f.r[i + 1] : f.r[i] * 0.86, finger: fi, ph: i, dors: dors });
      p = q;
    }
    return segs;
  }
  function thumbSegs(dirs) {
    var segs = [], p = THUMB.base.slice(), i;
    for (i = 0; i < 3; i++) {
      var d = norm(dirs[i]), ref = THUMB.nailRef;
      var dors = norm(sub(ref, mul(d, dot(ref, d))));
      var q = add(p, mul(d, THUMB.len[i]));
      segs.push({ a: p, b: q, r0: THUMB.r[i], r1: i < 2 ? THUMB.r[i + 1] : THUMB.r[i] * 0.86, finger: 4, ph: i, dors: dors });
      p = q;
    }
    return segs;
  }
  function segDist(p, s) {
    var ab = sub(s.b, s.a), ap = sub(p, s.a), L2 = dot(ab, ab);
    var t = L2 > 0 ? clamp(dot(ap, ab) / L2, 0, 1) : 0, c = add(s.a, mul(ab, t));
    return { t: t, d: len(sub(p, c)), c: c };
  }
  function palmInside(p) {
    var x = p[0], y = p[1], z = p[2];
    if (z >= 0.3 && z <= 11.2) {
      var hw = z < 5 ? lerp(3.0, 4.35, smooth(0.3, 5, z)) : lerp(4.35, 4.1, smooth(8, 11.2, z));
      var ht = z < 3 ? lerp(1.9, 1.8, z / 3) : lerp(1.8, 1.45, smooth(3, 11.2, z));
      var cy = z > 8 ? lerp(0, -0.25, smooth(8, 11.2, z)) : 0;
      var u = (x - 0.3) / hw, v = (y - cy) / ht;
      if (u * u * u * u + v * v * v * v <= 1) return true;
    }
    if (ell(p, [-2.4, 0.9, 3.6], [1.9, 1.5, 2.9])) return true;     // thenar (thumb ball)
    if (ell(p, [3.0, 0.7, 4.8], [1.3, 1.2, 3.2])) return true;      // hypothenar (pinky-side pad)
    return false;
  }

  // one voxel centre -> { ch, own (1..5 finger/thumb, 6 palm, 7 arm, 8 knuckle), tip } or null
  function classify(p, segs) {
    var best = null, bd = 0, si, fi;
    for (si = 0; si < segs.length; si++) {
      var s = segs[si], r = segDist(p, s), rad = lerp(s.r0, s.r1, r.t), dd = r.d - rad;
      if (dd <= 0 && (best === null || dd < bd)) { best = { s: s, t: r.t, c: r.c, rad: rad }; bd = dd; }
    }
    if (best) {
      var s2 = best.s, dors = dot(sub(p, best.c), s2.dors) / best.rad, ch = 'a';
      if (s2.ph === 2 && best.t > 0.3 && dors > 0.42) ch = 'n';                 // nail
      else if (s2.ph < 2 && best.t < 0.2 && dors > 0.3) ch = 'L';               // knuckle top (MCP / PIP)
      else if (s2.ph > 0 && best.t < 0.12 && dors < -0.4) ch = 's';             // joint crease, palm side
      else if (dors > 0.72) ch = 'L';                                          // lit ridge along the finger back
      return { ch: ch, own: 1 + s2.finger, tip: s2.ph === 2 && best.t > 0.5 };
    }
    if (palmInside(p)) {
      var x = p[0], y = p[1], z = p[2], ch2 = 'a';
      if (y > 0.9) {
        if (Math.abs(z - (8.4 + 0.16 * x)) < 0.42 && x > -1.8) ch2 = 's';          // heart line
        else if (Math.abs(z - (6.9 - 0.12 * x)) < 0.42 && x < 2.6) ch2 = 's';      // head line
        else {
          var lr = Math.sqrt((x + 3.6) * (x + 3.6) + (z - 1.6) * (z - 1.6));
          if (Math.abs(lr - 3.7) < 0.42 && x > -3.6 && z > 1.8) ch2 = 's';         // life line round the thumb ball
        }
      } else if (y < -1.1) {                                                       // back: tendons fan to the knuckles
        for (fi = 0; fi < 4; fi++) {
          var b = FINGERS[fi].base, ax = lerp(0.3, b[0], 0.35), az = 1.0, bx = b[0], bz = b[2] - 0.8;
          var vx = bx - ax, vz = bz - az, tt = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
          var ex = x - (ax + vx * tt), ez = z - (az + vz * tt);
          if (ex * ex + ez * ez < 0.33 * 0.33 * 4) { ch2 = 'L'; break; }
        }
      }
      return { ch: ch2, own: 6, tip: false };
    }
    for (fi = 0; fi < 4; fi++) {
      var kb = FINGERS[fi].base;
      if (ell(p, [kb[0], kb[1] - 0.8, kb[2] - 0.5], [1.0, 0.95, 1.1])) return { ch: 'L', own: 8, tip: false };
    }
    var zz = p[2];
    if (zz <= 0.6 && zz >= -16) {
      var k2 = Math.max(0, -3 - zz), rx = 3.0 + k2 * 0.045, ry = 1.9 + k2 * 0.06;
      var e1 = (p[0] - 0.3) / rx, e2 = p[1] / ry, e = e1 * e1 + e2 * e2;
      if (zz < -11.6) {
        if (zz > -12.8 && e <= 1.42 * 1.42) return { ch: 'D', own: 7, tip: false };   // rolled sleeve edge
        if (e <= 1.3 * 1.3) return { ch: 'd', own: 7, tip: false };                     // sleeve
        return null;
      }
      if (zz >= -8.6 && zz <= -5.2 && e <= 1.15 * 1.15) return { ch: (zz >= -7.4 && zz <= -6.6) ? 'r' : 'l', own: 7, tip: false };
      if (e <= 1) return { ch: (zz > -0.7 && zz < -0.1 && p[1] > 1.1) ? 's' : 'a', own: 7, tip: false };
      if (ell(p, [3.0, -1.1, -1.6], [0.9, 0.8, 1.0])) return { ch: 'a', own: 7, tip: false };   // ulna knob
    }
    return null;
  }

  // ===================================================================================================================
  // 3. BUILD GRID. Work grid GN cells, origin GO (hand cells); every variant is cropped to its own bbox afterwards.
  // ===================================================================================================================
  var GO = [-18, -15, -28], GN = [44, 40, 66], SX = GN[0], SXY = GN[0] * GN[1], NCELL = GN[0] * GN[1] * GN[2];
  function gi(i, j, k) { return i + SX * (j + GN[1] * k); }
  function centre(i, j, k) { return [i + 0.5 + GO[0], j + 0.5 + GO[1], k + 0.5 + GO[2]]; }

  function buildHand(poseName) {
    var pose = POSES[poseName], segs = [], fi, i, j, k;
    for (fi = 0; fi < 4; fi++) segs = segs.concat(fingerSegs(FINGERS[fi], fi, pose.spread[fi], pose.curl[fi]));
    segs = segs.concat(thumbSegs(pose.thumb));
    var H = new Uint8Array(NCELL), own = new Uint8Array(NCELL), tip = new Uint8Array(NCELL);
    for (k = 0; k < GN[2]; k++) {
      var zc = k + 0.5 + GO[2];
      if (zc < -16.5 || zc > 24) continue;
      for (j = 0; j < GN[1]; j++) {
        var yc = j + 0.5 + GO[1];
        if (yc < -5 || yc > 10) continue;
        for (i = 0; i < GN[0]; i++) {
          var xc = i + 0.5 + GO[0];
          if (xc < -10 || xc > 10) continue;
          var res = classify([xc, yc, zc], segs);
          if (res) { var id = gi(i, j, k); H[id] = res.ch.charCodeAt(0); own[id] = res.own; tip[id] = res.tip ? 1 : 0; }
        }
      }
    }
    // creases between touching fingers (and finger / thumb): skin_shade where two different digits meet
    var mark = [], id2;
    function other(a, o) { return a >= 1 && a <= 5 && a !== o; }
    for (id2 = 0; id2 < NCELL; id2++) {
      var o = own[id2];
      if (o < 1 || o > 5 || H[id2] === CH.n) continue;
      var x = id2 % SX;
      if ((x > 0 && other(own[id2 - 1], o)) || (x < SX - 1 && other(own[id2 + 1], o)) ||
          (id2 >= SX && other(own[id2 - SX], o)) || (id2 + SX < NCELL && other(own[id2 + SX], o))) mark.push(id2);
    }
    for (i = 0; i < mark.length; i++) H[mark[i]] = CH.s;
    var mid = segs[5];   // middle finger distal segment
    return { H: H, own: own, tip: tip, tipPoint: mid.b.slice() };
  }

  // 6-neighbour distance from the hand surface (0 = hand, 1 = touching, ... capped at 4, 255 = far)
  function distField(H) {
    var D = new Uint8Array(NCELL), q = new Int32Array(NCELL), hd = 0, tl = 0, id;
    for (id = 0; id < NCELL; id++) { if (H[id]) { D[id] = 0; q[tl++] = id; } else D[id] = 255; }
    while (hd < tl) {
      id = q[hd++];
      var dd = D[id];
      if (dd >= 4) continue;
      var x = id % SX, y = ((id / SX) | 0) % GN[1], z = (id / SXY) | 0;
      if (x > 0 && D[id - 1] === 255) { D[id - 1] = dd + 1; q[tl++] = id - 1; }
      if (x < SX - 1 && D[id + 1] === 255) { D[id + 1] = dd + 1; q[tl++] = id + 1; }
      if (y > 0 && D[id - SX] === 255) { D[id - SX] = dd + 1; q[tl++] = id - SX; }
      if (y < GN[1] - 1 && D[id + SX] === 255) { D[id + SX] = dd + 1; q[tl++] = id + SX; }
      if (z > 0 && D[id - SXY] === 255) { D[id - SXY] = dd + 1; q[tl++] = id - SXY; }
      if (z < GN[2] - 1 && D[id + SXY] === 255) { D[id + SXY] = dd + 1; q[tl++] = id + SXY; }
    }
    return D;
  }

  // ===================================================================================================================
  // 4. FIRE. Everything is in model space; UP = the screen-up direction at the rest pose (computed from REST.rot), so
  //    flames rise on screen. Shell (cubes touching the skin, denser on the up side and between the fingers), tongues
  //    (walk + sideways wobble + upward lift, 1.2 -> 0.35 radius, white-hot root on the up side -> orange -> red tip,
  //    breakaway tip cube), a core ball above the palm (or in front of it for the cast jet), loose ember cubes.
  //    Underside tongues hug the surface (direction = UP projected on the tangent plane) and climb round the edges.
  // ===================================================================================================================
  var TUNE = { shell: 1.0, tongues: 26, length: 1.0, coreR: 2.4, wristTo: -7.5 };

  function addFire(H, opt, T, UP) {
    var F = new Uint8Array(NCELL), D = distField(H), lv = opt.level, sd = opt.seed, cands = [], i, j, k;
    function put(id, code) { if (!H[id] && FIRE_RANK[code] > (FIRE_RANK[F[id]] || 0)) F[id] = code; }
    function cellOf(p) {
      var a = Math.floor(p[0] - GO[0]), b = Math.floor(p[1] - GO[1]), c = Math.floor(p[2] - GO[2]);
      if (a < 0 || b < 0 || c < 0 || a >= GN[0] || b >= GN[1] || c >= GN[2]) return -1;
      return gi(a, b, c);
    }
    function sphere(p, r, code) {
      var c0 = cellOf(p);
      if (c0 >= 0) put(c0, code);
      var a0 = Math.floor(p[0] - r - GO[0]), a1 = Math.floor(p[0] + r - GO[0]);
      var b0 = Math.floor(p[1] - r - GO[1]), b1 = Math.floor(p[1] + r - GO[1]);
      var e0 = Math.floor(p[2] - r - GO[2]), e1 = Math.floor(p[2] + r - GO[2]), a, b, e;
      for (e = e0; e <= e1; e++) for (b = b0; b <= b1; b++) for (a = a0; a <= a1; a++) {
        if (a < 0 || b < 0 || e < 0 || a >= GN[0] || b >= GN[1] || e >= GN[2]) continue;
        var cc = centre(a, b, e), dx = cc[0] - p[0], dy = cc[1] - p[1], dz = cc[2] - p[2];
        if (dx * dx + dy * dy + dz * dz <= r * r) put(gi(a, b, e), code);
      }
    }
    // shell + tongue candidates
    for (k = 0; k < GN[2]; k++) for (j = 0; j < GN[1]; j++) for (i = 0; i < GN[0]; i++) {
      var id = gi(i, j, k);
      if (D[id] !== 1) continue;
      var pc = centre(i, j, k), fade = smooth(T.wristTo, T.wristTo + 5.5, pc[2]);
      if (fade <= 0) continue;
      var nr = [0, 0, 0];
      if (i > 0 && H[id - 1]) nr[0] += 1;
      if (i < GN[0] - 1 && H[id + 1]) nr[0] -= 1;
      if (j > 0 && H[id - SX]) nr[1] += 1;
      if (j < GN[1] - 1 && H[id + SX]) nr[1] -= 1;
      if (k > 0 && H[id - SXY]) nr[2] += 1;
      if (k < GN[2] - 1 && H[id + SXY]) nr[2] -= 1;
      var between = (i > 0 && H[id - 1]) && ((i < GN[0] - 1 && H[id + 1]) || (i < GN[0] - 2 && H[id + 2])) ? 1 : 0;
      var nl = len(nr), n = nl > 0.5 ? mul(nr, 1 / nl) : UP.slice(), up = dot(n, UP);
      var h = hash(i, j, k, sd);
      var p = lv * T.shell * (0.16 + 0.30 * Math.max(0, up) + between * 0.35 * (opt.betweenBoost || 0.6)) * fade;
      if (h < p) put(id, (h < p * 0.15 && up > 0.3 && lv > 0.6) ? CH.E : CH.e);
      else if (h < p + 0.05 * lv * fade && up > -0.2) put(id, CH.t);
      cands.push({ i: i, j: j, k: k, p: pc, n: n, up: up, between: between,
                   s: hash(i, j, k, sd + 101) * (0.55 + 0.45 * Math.max(0, up)) * fade + between * 0.25 });
    }
    // tongues: best-scored candidates, >= 2.5 cells apart
    cands.sort(function (a, b) { return b.s - a.s; });
    var nT = Math.round(T.tongues * (opt.tongues || 0)), starts = [], ci, si;
    for (ci = 0; ci < cands.length && starts.length < nT; ci++) {
      var cd = cands[ci], ok = true;
      for (si = 0; si < starts.length; si++) { var dv = sub(starts[si].p, cd.p); if (dot(dv, dv) < 6.25) { ok = false; break; } }
      if (ok) starts.push(cd);
    }
    for (si = 0; si < starts.length; si++) {
      var c = starts[si], h1 = hash(c.i, c.j, c.k, sd + 7), h2 = hash(c.i, c.j, c.k, sd + 13), h3 = hash(c.i, c.j, c.k, sd + 29);
      var under = c.up < -0.25, dir;
      if (opt.jet && !under) dir = norm(add(add(mul(UP, 0.55), mul(Z, 0.8)), mul(c.n, 0.3)));
      else if (under) {
        var tg = sub(UP, mul(c.n, dot(UP, c.n)));
        if (len(tg) < 0.2) tg = Z.slice();
        dir = norm(add(norm(tg), mul(c.n, 0.3)));
      } else dir = norm(add(UP, mul(c.n, 0.55)));
      dir = norm(add(dir, [(h1 - 0.5) * 0.5, (h2 - 0.5) * 0.3, (h3 - 0.5) * 0.5]));
      var side = cross(dir, c.n);
      if (len(side) < 0.2) side = cross(dir, [1, 0, 0]);
      side = norm(side);
      var L = lv * T.length * (3.0 + 6.5 * h2) * (under ? 0.7 : 1) * (opt.jet ? 1.4 : 1) * (c.between ? 0.7 : 1);
      var ph = h3 * 6.283, lift = under ? 0 : 0.035, hot = c.up > 0.2 && lv > 0.6, s;
      for (s = 0; s <= L; s += 0.5) {
        var f = L > 0 ? s / L : 1;
        var q = add(add(c.p, mul(dir, s)), mul(side, Math.sin(s * 0.9 + ph) * 0.7 * f));
        q = add(q, mul(UP, lift * s * s));
        var qc = cellOf(q);
        if (s > 0.6 && qc >= 0 && H[qc]) break;                     // never tunnel through the hand
        var r = lerp(1.2, 0.35, f) * (0.75 + 0.25 * Math.min(1, lv));
        sphere(q, r, f < 0.22 && hot ? CH.E : (f < 0.72 ? CH.e : CH.t));
      }
      if (h1 < 0.45) {
        var tp = cellOf(add(add(c.p, mul(dir, L + 1.5 + h2 * 2.0)), mul(UP, 0.6)));
        if (tp >= 0) put(tp, CH.t);
      }
    }
    // core ball
    if (opt.core) {
      var C = add(PALM, mul(UP, 3.2));
      if (opt.jet) C = add(C, mul(Z, 1.5));
      var R = T.coreR * opt.core, a, b, e;
      for (e = -4; e <= 4; e++) for (b = -4; b <= 4; b++) for (a = -4; a <= 4; a++) {
        var cid = cellOf([C[0] + a, C[1] + b, C[2] + e]);
        if (cid < 0) continue;
        var cx = cid % SX, cy = ((cid / SX) | 0) % GN[1], cz = (cid / SXY) | 0, cc2 = centre(cx, cy, cz), dd = len(sub(cc2, C));
        var hh = hash(cx, cy, cz, sd + 41);
        if (dd <= R * 0.55) put(cid, CH.E);
        else if (dd <= R && hh > 0.15) put(cid, CH.e);
        else if (dd <= R + 0.8 && hh < 0.22 * lv) put(cid, CH.t);
      }
    }
    // loose ember cubes rising above the hand
    var ei;
    for (ei = 0; ei < (opt.embers || 0); ei++) {
      var a1 = hash(ei, 3, 5, sd + 61), a2 = hash(ei, 7, 1, sd + 67), a3 = hash(ei, 2, 9, sd + 71);
      var P0 = add(add(PALM, mul(UP, 7 + a1 * 7)), [(a2 - 0.5) * 9, 0, (a3 - 0.5) * 11]);
      var eid = cellOf(P0);
      if (eid >= 0) put(eid, a1 < 0.5 ? CH.t : CH.e);
    }
    return F;
  }

  // skin touched by flame glows (skin_glow), nails char (skin_char); burnEmber also chars the fingertips and leaves
  // smouldering glow specks on the surface.
  function glowPass(H, F, opt, tip) {
    var out = H.slice(), id;
    for (id = 0; id < NCELL; id++) {
      var c = H[id];
      if (!c) continue;
      var skin = c === CH.a || c === CH.L || c === CH.s;
      if (c === CH.n) { out[id] = CH.c; continue; }
      if (!skin) continue;
      var x = id % SX, y = ((id / SX) | 0) % GN[1], z = (id / SXY) | 0;
      var nbF = (x > 0 && F[id - 1]) || (x < SX - 1 && F[id + 1]) || (y > 0 && F[id - SX]) || (y < GN[1] - 1 && F[id + SX]) ||
                (z > 0 && F[id - SXY]) || (z < GN[2] - 1 && F[id + SXY]);
      if (nbF) { out[id] = CH.g; continue; }
      if (opt.char) {
        if (tip[id]) { out[id] = CH.c; continue; }
        var open = (x > 0 && !H[id - 1]) || (x < SX - 1 && !H[id + 1]) || (y > 0 && !H[id - SX]) || (y < GN[1] - 1 && !H[id + SX]);
        if (open && hash(x, y, z, opt.seed + 3) < 0.10) out[id] = CH.g;
      }
    }
    return out;
  }

  // ===================================================================================================================
  // 5. VARIANTS (one voxel model each; same anchor = the wrist, same `core` mount = the light / cast point)
  // ===================================================================================================================
  var VARIANT_SPECS = {
    open:       { pose: 'open',  desc: 'relaxed open hand, palm up (idle / breathe)' },
    relax:      { pose: 'relax', desc: 'fingers curled a little more (idle life: a slow flex)' },
    cup:        { pose: 'cup',   desc: 'cupped palm, fingers and thumb rise round an empty bowl (before ignition / after burnOut)' },
    fist:       { pose: 'fist',  desc: 'closed fist, thumb over the index (cast: charge)' },
    cast:       { pose: 'cast',  desc: 'fingers flung wide and straight (cast: release)' },
    burnKindle: { pose: 'cup',   desc: 'ignition: a small core and short licks', fire: { level: 0.40, seed: 11, core: 0.55, tongues: 0.35, embers: 2 } },
    burnA:      { pose: 'cup',   desc: 'burning hand, flicker frame A', fire: { level: 1.0, seed: 21, core: 1.0, tongues: 1.0, embers: 4 } },
    burnB:      { pose: 'cup',   desc: 'burning hand, flicker frame B', fire: { level: 1.0, seed: 22, core: 1.0, tongues: 1.0, embers: 4 } },
    burnC:      { pose: 'cup',   desc: 'burning hand, flicker frame C', fire: { level: 1.0, seed: 23, core: 0.95, tongues: 1.0, embers: 4 } },
    burnD:      { pose: 'cup',   desc: 'burning hand, flicker frame D', fire: { level: 1.0, seed: 24, core: 1.05, tongues: 1.0, embers: 4 } },
    burnFistA:  { pose: 'fist',  desc: 'burning fist (charge): fire squeezed out between the fingers', fire: { level: 0.85, seed: 31, core: 0, tongues: 0.8, embers: 3, betweenBoost: 1.0 } },
    burnFistB:  { pose: 'fist',  desc: 'burning fist, frame B', fire: { level: 0.85, seed: 32, core: 0, tongues: 0.8, embers: 3, betweenBoost: 1.0 } },
    burnCastA:  { pose: 'cast',  desc: 'release: a forward jet off the open palm, frame A', fire: { level: 1.15, seed: 41, core: 1.25, tongues: 1.0, embers: 5, jet: true } },
    burnCastB:  { pose: 'cast',  desc: 'release jet, frame B', fire: { level: 1.15, seed: 42, core: 1.2, tongues: 1.0, embers: 5, jet: true } },
    burnEmber:  { pose: 'cup',   desc: 'burnOut: dying licks, charred fingertips, glowing specks', fire: { level: 0.22, seed: 51, core: 0.25, tongues: 0.3, embers: 3, char: true } }
  };
  function modelName(v) { return 'hand' + v.charAt(0).toUpperCase() + v.slice(1) + 'L'; }

  var REST = { pos: [-0.235, -0.44, -0.195], rot: [80, 8, 10] };
  var UP = norm(rotInv(REST.rot, Z));       // ~(-0.14, 0.97, 0.17): screen-up in model space at rest

  function pack(vname, spec, H, F, tipPoint) {
    var i, j, k, i0 = 1e9, j0 = 1e9, k0 = 1e9, i1 = -1, j1 = -1, k1 = -1, nh = 0, nf = 0, ne = 0, id;
    for (k = 0; k < GN[2]; k++) for (j = 0; j < GN[1]; j++) for (i = 0; i < GN[0]; i++) {
      id = gi(i, j, k);
      var c = H[id] || (F ? F[id] : 0);
      if (!c) continue;
      if (H[id]) nh++; else nf++;
      if (c === CH.E || c === CH.e || c === CH.t || c === CH.g) ne++;
      if (i < i0) i0 = i; if (j < j0) j0 = j; if (k < k0) k0 = k;
      if (i > i1) i1 = i; if (j > j1) j1 = j; if (k > k1) k1 = k;
    }
    var sx = i1 - i0 + 1, sy = j1 - j0 + 1, sz = k1 - k0 + 1, layers = [];
    for (k = k0; k <= k1; k++) {
      var L = [];
      for (j = j0; j <= j1; j++) {
        var row = '';
        for (i = i0; i <= i1; i++) {
          id = gi(i, j, k);
          var cc = H[id] || (F ? F[id] : 0);
          row += cc ? String.fromCharCode(cc) : '.';
        }
        L.push(row);
      }
      layers.push(L);
    }
    function g(p) { return [p[0] - GO[0] - i0, p[1] - GO[1] - j0, p[2] - GO[2] - k0]; }
    var anchor = g([0, 0, 0]), name = modelName(vname);
    return {
      name: name,
      desc: 'HAND-ART-01 / HAND-BURN-01 view model, authored LEFT (thumb -x; the engine mirrors it, 37.8a): ' + spec.desc +
            '. 1 cm voxels; variant `' + vname + '` of viewModels.hand (README 22).',
      variantOf: 'hand',
      variant: vname,
      light: false,
      voxel: {
        version: 1,
        cellM: CELL,
        size: [sx, sy, sz],
        anchor: anchor,
        mats: MATS,
        layers: layers,
        parts: { hand: { box: [0, 0, 0, sx, sy, sz], pivot: anchor.slice() } },
        animations: { held: { durations: [1000], loop: true, frames: [{}] } },
        mounts: {
          wrist:    { at: anchor.slice(), part: 'hand' },
          palm:     { at: g(PALM), part: 'hand' },
          core:     { at: g(add(PALM, mul(UP, 3.2))), part: 'hand' },     // fire core = carried light + cast point
          tip:      { at: g(tipPoint), part: 'hand' },                    // middle fingertip of this pose
          knuckles: { at: g([FINGERS[1].base[0], -1.6, FINGERS[1].base[2]]), part: 'hand' }
        }
      },
      stats: { hand: nh, fire: nf, emissive: ne, total: nh + nf, size: [sx, sy, sz] }
    };
  }

  function build(tune) {
    var T = {}, key, out = {}, handCache = {};
    for (key in TUNE) T[key] = (tune && tune[key] != null) ? tune[key] : TUNE[key];
    for (key in VARIANT_SPECS) {
      var spec = VARIANT_SPECS[key];
      var hb = handCache[spec.pose] || (handCache[spec.pose] = buildHand(spec.pose));
      var H = hb.H, F = null;
      if (spec.fire) { F = addFire(H, spec.fire, T, UP); H = glowPass(H, F, spec.fire, hb.tip); }
      var rec = pack(key, spec, H, F, hb.tipPoint);
      A.voxelModels[rec.name] = rec;
      out[key] = rec.name;
    }
    return { tune: T, models: out };
  }

  var BUILT = build(null);

  // ===================================================================================================================
  // 6. VIEW MODEL (README 7.4 + README 22). Eye space x right, y BACK (forward = -y), z up, metres. LEFT hand authored.
  //    Key field `v` = variant shown from that key on (step); '@name' = a flicker cycle (def.cycles[name]) whose frame
  //    is floor(simTime * fps) mod n, simTime-driven so a clip change never restarts the flicker.
  // ===================================================================================================================
  function k(t, pos, rot, v) { var o = { t: t, pos: pos, rot: rot }; if (v) o.v = v; return o; }
  var BREATH = { pos: [-0.234, -0.442, -0.188], rot: [81.2, 8, 9.6] };
  var HOLD = { pos: [-0.205, -0.43, -0.172], rot: [76, 13, 15] };
  var GATHER = { pos: [-0.225, -0.425, -0.20], rot: [74, 12, 14] };
  var TENSE = { pos: [-0.215, -0.418, -0.185], rot: [72, 14, 16] };
  var THRUST = { pos: [-0.20, -0.53, -0.165], rot: [92, 4, 6] };
  var FOLLOW = { pos: [-0.205, -0.55, -0.18], rot: [100, 2, 4] };
  var LOW = { pos: [-0.27, -0.33, -0.56], rot: [100, 8, 10] };

  var variants = {};
  for (var vk in BUILT.models) variants[vk] = BUILT.models[vk];

  A.viewModels.hand = {
    model: variants.open,                 // what an engine without variants loads (static); burning fallback: handBurnAL
    hand: 'left',
    space: 'eye: x right, y back (forward = -y), z up, metres; yaw-0 / pitch-0 camera frame at the eye',
    rotOrder: 'R = Rz(rz) * Ry(ry) * Rx(rx), degrees (= engine voxelPose setRot)',
    projection: 'same as the scene; view-model depth range after the scene (TORCH-01a handle, 37.8a mirror)',
    depth: { near: 0.05, far: 1.5 },
    rest: REST,
    variants: variants,
    defaultVariant: 'open',
    cycles: {
      burn:     { variants: ['burnA', 'burnC', 'burnB', 'burnD'], fps: 12 },
      burnFist: { variants: ['burnFistA', 'burnFistB'], fps: 10 },
      burnCast: { variants: ['burnCastA', 'burnCastB'], fps: 14 }
    },
    clips: {
      // plain hand: 6 s life loop = breath + a slow finger flex (open -> relax -> open) at 3.8 s
      idle: { loop: true, keys: [
        k(0, REST.pos, REST.rot, 'open'),
        k(1500, BREATH.pos, BREATH.rot),
        k(3000, REST.pos, REST.rot),
        k(3800, [-0.236, -0.441, -0.193], [80.6, 8.2, 10.3], 'relax'),
        k(4400, [-0.235, -0.441, -0.192], [80.8, 8.1, 10.1], 'open'),
        k(5200, BREATH.pos, BREATH.rot),
        k(6000, REST.pos, REST.rot)
      ] },
      // breath only (2.4 s; sword 2.2, torch 2.6, spell glove 2.0: the hands never sway in step)
      breathe: { loop: true, keys: [
        k(0, REST.pos, REST.rot, 'open'),
        k(1200, BREATH.pos, BREATH.rot),
        k(2400, REST.pos, REST.rot)
      ] },
      // plain cast: charge 0-300 (fist, pulled in), release 300-383 (fingers fling open, thrust), recover to 700
      cast: { loop: false, castAtMs: 300, holdMs: 300, charge: [0, 300], release: [300, 383], recover: [383, 700], keys: [
        k(0, REST.pos, REST.rot, 'open'),
        k(60, GATHER.pos, GATHER.rot, 'fist'),
        k(300, TENSE.pos, TENSE.rot),
        k(383, THRUST.pos, THRUST.rot, 'cast'),
        k(470, FOLLOW.pos, FOLLOW.rot),
        k(560, [-0.225, -0.47, -0.19], [86, 6, 8], 'open'),
        k(700, REST.pos, REST.rot)
      ] },
      // sustained burn: the fire presented, drawn in + up toward the view centre, a slow straining sway (1.6 s loop)
      hold: { loop: true, keys: [
        k(0, HOLD.pos, HOLD.rot, '@burn'),
        k(400, [-0.203, -0.431, -0.170], [76.8, 13.3, 15.4]),
        k(800, [-0.206, -0.429, -0.174], [75.6, 12.8, 14.7]),
        k(1200, [-0.204, -0.430, -0.171], [76.5, 13.2, 15.2]),
        k(1600, HOLD.pos, HOLD.rot)
      ] },
      // ignite (0.3 s): cup -> anticipation dip + kindle -> WHOOMP lift with the full fire -> settle at rest
      burnStart: { loop: false, keys: [
        k(0, REST.pos, REST.rot, 'open'),
        k(30, REST.pos, REST.rot, 'cup'),
        k(60, [-0.238, -0.438, -0.206], [82, 8, 10], 'burnKindle'),
        k(140, [-0.232, -0.444, -0.184], [78, 9, 11], '@burn'),
        k(300, REST.pos, REST.rot)
      ] },
      // burning at rest (2.0 s breath; the flicker is the cycle + the light)
      burnLoop: { loop: true, keys: [
        k(0, REST.pos, REST.rot, '@burn'),
        k(1000, BREATH.pos, BREATH.rot),
        k(2000, REST.pos, REST.rot)
      ] },
      // fire cast: clench the fire (burning fist) -> fling it (jet) -> fire back in the cup
      burnCast: { loop: false, castAtMs: 300, holdMs: 300, charge: [0, 300], release: [300, 383], recover: [383, 700], keys: [
        k(0, REST.pos, REST.rot, '@burn'),
        k(60, GATHER.pos, GATHER.rot, '@burnFist'),
        k(300, TENSE.pos, TENSE.rot),
        k(383, THRUST.pos, THRUST.rot, '@burnCast'),
        k(470, FOLLOW.pos, FOLLOW.rot),
        k(560, [-0.225, -0.47, -0.19], [86, 6, 8], '@burn'),
        k(700, REST.pos, REST.rot)
      ] },
      // put out (0.5 s): a shake, the flames die to embers, the cup relaxes open
      burnOut: { loop: false, keys: [
        k(0, REST.pos, REST.rot, '@burn'),
        k(120, [-0.242, -0.441, -0.197], [80.8, 8, 8.5], 'burnEmber'),
        k(200, [-0.229, -0.439, -0.193], [79.4, 8, 11.5]),
        k(280, [-0.240, -0.440, -0.203], [81.5, 8, 9.5]),
        k(380, REST.pos, REST.rot, 'cup'),
        k(500, REST.pos, REST.rot, 'open')
      ] },
      raise: { loop: false, keys: [
        k(0, LOW.pos, LOW.rot, 'open'),
        k(200, [-0.235, -0.45, -0.18], [78, 8, 9]),
        k(300, REST.pos, REST.rot)
      ] },
      lower: { loop: false, keys: [
        k(0, REST.pos, REST.rot),
        k(250, LOW.pos, LOW.rot)
      ] }
    },
    // multiplier on the handFire preset intensity per clip (0 / missing = light off). Radius never changes (37.14 rule).
    glow: {
      burnStart: { keys: [[0, 0], [60, 0.35], [140, 1.5], [300, 1.0]] },
      burnLoop:  { mul: 1.0 },
      hold:      { mul: 1.3, pulse: { amp: 0.15, hz: 3 } },
      burnCast:  { keys: [[0, 1.0], [60, 1.2], [300, 2.0], [383, 2.6], [470, 0.6], [700, 1.0]] },
      burnOut:   { keys: [[0, 1.0], [120, 0.45], [260, 0.15], [380, 0], [500, 0]] }
    },
    glowCap: 2.6,
    bob: { note: 'engine-side walk bob, same rule as the spell glove (authored LEFT, the engine mirror flips x / roll)',
           z: 0.012, x: -0.006, rollDeg: -1.0, chargeMul: 0.3 },
    castMount: 'core',
    castOffset: null,       // filled below = the core mount at rest (magnitudes, like spellHand.castOffset)
    carriedLight: { preset: 'handFire', mount: 'core', offset: null, sway: { amp: 0.01 },
                    note: 'ONE carried light per player (37.8): while this hand burns it REPLACES spellEmber / the torch ' +
                          'light in that slot (never a 2nd slot). Intensity = handFire.intensity * glow (setParams), radius ' +
                          'fixed. Off when glow is 0 or missing (plain clips).' },
    particles: {
      origin: 'sim side at eye + carriedLight.offset (37.8 rule: never from the render pose); x sign follows the hand',
      burnLoop:  [{ preset: 'handEmbers', everySteps: 6, n: 1 }],
      hold:      [{ preset: 'handEmbers', everySteps: 4, n: 1 }],
      burnStart: [{ preset: 'handIgnite', atMs: 60, n: 10 }, { preset: 'handEmbers', everySteps: 6, n: 1, fromMs: 140 }],
      burnCast:  [{ preset: 'handEmbers', everySteps: 3, n: 1, toMs: 300 }, { preset: 'handIgnite', atMs: 383, n: 12, dir: 'aim' }],
      burnOut:   [{ preset: 'handEmbers', atMs: 60, n: 3 }, { preset: 'handSmoke', atMs: 140, n: 5 }]
    }
  };

  // ===================================================================================================================
  // 7. PARTICLES (README 8 EmitterDef, colours = palette keys)
  // ===================================================================================================================
  var PRESETS = {
    // embers lifting off the burning hand: slow, drifting, 0.5-1.1 s, white-yellow -> red -> dark
    handEmbers: {
      rate: 0, burst: 1,
      life: [0.5, 1.1], speed: [0.25, 0.7],
      dir: [0, 0, 1], spreadDeg: 35, box: [0.05, 0.05, 0.03],
      accelZ: 0.9, drag: 1.2, wind: 0.4,
      maxLive: 24, killBelow: null,
      glyphs: "#*+:'.",
      colors: ['flameCore', 'flameMid', 'flameOuter', 'flameTip', 'ember', 'emberDim'],
      emissive: true, emissiveFog: 0.05, sizeM: 0.02
    },
    // the ignition / release puff: short fast sparks in a wide cone
    handIgnite: {
      rate: 0, burst: 10,
      life: [0.15, 0.35], speed: [0.6, 1.6],
      dir: [0, 0, 1], spreadDeg: 70, box: [0.03, 0.03, 0.03],
      accelZ: 0.5, drag: 3.0, wind: 0.2,
      maxLive: 16, killBelow: null,
      glyphs: "@*+'.",
      colors: ['white', 'flameCore', 'flameMid', 'flameOuter', 'ember'],
      emissive: true, emissiveFog: 0.05, sizeM: 0.02
    },
    // burnOut: a few dark puffs (lit, <= 35 % keys)
    handSmoke: {
      rate: 0, burst: 5,
      life: [0.8, 1.4], speed: [0.15, 0.4],
      dir: [0, 0, 1], spreadDeg: 40, box: [0.04, 0.04, 0.03],
      accelZ: 0.4, drag: 1.5, wind: 0.8,
      maxLive: 12, killBelow: null,
      glyphs: "o~:'.",
      colors: ['ashDark', 'ashDark', 'ironDark', 'mortar', 'scorch'],
      emissive: false, emissiveFog: 0, sizeM: 0.04
    }
  };

  // ===================================================================================================================
  // 8. UTIL, ATTACH, VALIDATE
  // ===================================================================================================================
  function mountEye(modelKey, pose, mount, mirror) {
    var V = A.voxelModels[modelKey].voxel, at = V.mounts[mount].at, an = V.anchor, cm = V.cellM;
    var q = rotApply(pose.rot, [(at[0] - an[0]) * cm, (at[1] - an[1]) * cm, (at[2] - an[2]) * cm]);
    return [(pose.pos[0] + q[0]) * (mirror ? -1 : 1), pose.pos[1] + q[1], pose.pos[2] + q[2]];
  }
  function resolveVariant(def, v, simTime) {
    if (v && v.charAt(0) === '@') {
      var cy = def.cycles[v.slice(1)], fi = Math.floor(simTime * cy.fps) % cy.variants.length;
      return { variant: cy.variants[fi < 0 ? fi + cy.variants.length : fi], model: def.variants[cy.variants[fi < 0 ? fi + cy.variants.length : fi]] };
    }
    return { variant: v, model: def.variants[v] };
  }
  function glowAt(def, clipName, t, simTime) {
    var g = def.glow[clipName], i;
    if (!g) return 0;
    if (g.keys) {
      var ks = g.keys;
      if (t <= ks[0][0]) return ks[0][1];
      for (i = 1; i < ks.length; i++) {
        if (t <= ks[i][0]) { var f = (t - ks[i - 1][0]) / ((ks[i][0] - ks[i - 1][0]) || 1); return lerp(ks[i - 1][1], ks[i][1], f); }
      }
      return ks[ks.length - 1][1];
    }
    var m = g.mul || 0;
    if (g.pulse) m *= 1 + g.pulse.amp * Math.sin(2 * Math.PI * g.pulse.hz * simTime);
    return Math.min(m, def.glowCap || 9);
  }
  // pose + variant + glow of a clip at clip time tMs (loop clips wrap) and sim time simTime (s, flicker cycles)
  function sampleClip(def, clipName, tMs, simTime) {
    var cl = def.clips[clipName], ks = cl.keys, T = ks[ks.length - 1].t, i = 0, j, n;
    var t = cl.loop ? ((tMs % T) + T) % T : clamp(tMs, 0, T);
    while (i < ks.length - 2 && t > ks[i + 1].t) i++;
    var a = ks[i], b = ks[i + 1], f = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0, pos = [], rot = [];
    for (n = 0; n < 3; n++) { pos.push(lerp(a.pos[n], b.pos[n], f)); rot.push(lerp(a.rot[n], b.rot[n], f)); }
    var v = def.defaultVariant;
    for (j = 0; j < ks.length; j++) if (ks[j].t <= t && ks[j].v) v = ks[j].v;
    var rv = resolveVariant(def, v, simTime || 0);
    return { pos: pos, rot: rot, key: v, variant: rv.variant, model: rv.model, glow: glowAt(def, clipName, t, simTime || 0), t: t };
  }

  // castOffset / carried light = the core mount at rest (identical point in every variant by construction)
  (function () {
    var def = A.viewModels.hand, e0 = mountEye(def.variants.burnA, REST, 'core', false);
    function r3(x) { return Math.round(x * 1000) / 1000; }
    def.castOffset = { right: r3(Math.abs(e0[0])), fwd: r3(-e0[1]), down: r3(-e0[2]),
                       note: 'eye frame magnitudes; the hand gives the sign of `right` (left = negative), like spellHand' };
    def.carriedLight.offset = { right: r3(e0[0]), fwd: r3(-e0[1]), down: r3(-e0[2]) };
  })();

  A.handFx = {
    version: 1,
    story: 'HAND-ART-01 (bare hand) / HAND-BURN-01 (burning hand); README 22',
    cellM: CELL,
    mats: MATS,
    poses: POSES,
    variantSpecs: VARIANT_SPECS,
    tune: BUILT.tune,
    up: UP,
    particles: PRESETS,
    lightKeys: ['handFire'],
    newMaterials: ['skin_light', 'skin_shade', 'skin_nail', 'skin_glow', 'skin_char', 'flame_tip'],
    build: build,
    // preview only: rebuild every variant with new fire numbers (the def keeps the same model keys)
    rebuild: function (tune) { var r = build(tune); A.handFx.tune = r.tune; return r; },
    util: { rotApply: rotApply, rotInv: rotInv, sampleClip: sampleClip, mountEye: mountEye, resolveVariant: resolveVariant, glowAt: glowAt }
  };

  A.handFx.attach = function attach() {
    var done = [], key;
    if (A.particles && A.particles.presets) {
      for (key in PRESETS) if (!A.particles.presets[key]) { A.particles.presets[key] = PRESETS[key]; done.push(key); }
    }
    return done;
  };

  // [] = OK. palette = ASSETS.palette (optional for the colour / light / material checks).
  A.handFx.validate = function validate(palette) {
    var errs = [], def = A.viewModels.hand, key, i, rgb = palette && palette.rgb;
    // models
    for (key in def.variants) {
      var rec = A.voxelModels[def.variants[key]];
      if (!rec) { errs.push('variant ' + key + ': model ' + def.variants[key] + ' missing'); continue; }
      var V = rec.voxel, sx = V.size[0], sy = V.size[1], sz = V.size[2], z, y, x;
      if (V.cellM !== CELL) errs.push(rec.name + ': cellM');
      if (V.layers.length !== sz) errs.push(rec.name + ': layer count');
      for (z = 0; z < V.layers.length; z++) {
        if (V.layers[z].length !== sy) { errs.push(rec.name + ': rows in layer ' + z); break; }
        for (y = 0; y < sy; y++) {
          var row = V.layers[z][y];
          if (row.length !== sx) { errs.push(rec.name + ': row length z' + z + ' y' + y); break; }
          for (x = 0; x < sx; x++) { var ch = row.charAt(x); if (ch !== '.' && !MATS[ch]) errs.push(rec.name + ': unknown voxel char ' + ch); }
        }
      }
      if (sx > 256 || sy > 256 || sz > 256) errs.push(rec.name + ': size > 256');
      for (var mn in V.mounts) {
        var at = V.mounts[mn].at;
        for (i = 0; i < 3; i++) if (!(at[i] >= 0 && at[i] <= V.size[i])) errs.push(rec.name + ': mount ' + mn + ' outside the grid');
      }
    }
    // cycles + key variants
    for (key in def.cycles) def.cycles[key].variants.forEach(function (v) { if (!def.variants[v]) errs.push('cycle ' + key + ': unknown variant ' + v); });
    var cn;
    for (cn in def.clips) {
      var ks = def.clips[cn].keys;
      for (i = 0; i < ks.length; i++) {
        if (i > 0 && !(ks[i].t > ks[i - 1].t)) errs.push(cn + ': key times must increase');
        var v = ks[i].v;
        if (v && (v.charAt(0) === '@' ? !def.cycles[v.slice(1)] : !def.variants[v])) errs.push(cn + ': unknown variant ' + v);
      }
    }
    for (cn in def.glow) if (!def.clips[cn]) errs.push('glow.' + cn + ': no such clip');
    for (cn in def.particles) if (cn !== 'origin') {
      if (!def.clips[cn]) errs.push('particles.' + cn + ': no such clip');
      def.particles[cn].forEach(function (r) { if (!PRESETS[r.preset]) errs.push('particles.' + cn + ': unknown preset ' + r.preset); });
    }
    // the core mount must be the same point in every variant (light + cast point never jump on a variant swap)
    var c0 = mountEye(def.variants.open, REST, 'core', false);
    for (key in def.variants) {
      var c1 = mountEye(def.variants[key], REST, 'core', false);
      if (Math.max(Math.abs(c1[0] - c0[0]), Math.abs(c1[1] - c0[1]), Math.abs(c1[2] - c0[2])) > 1e-9) errs.push('core mount differs in ' + key);
    }
    // core on screen (16:9, HFOV 75) in every clip except raise / lower
    var TH = Math.tan(37.5 * DEG), TV = TH * 9 / 16;
    for (cn in def.clips) {
      if (cn === 'raise' || cn === 'lower') continue;
      var cl = def.clips[cn], T = cl.keys[cl.keys.length - 1].t, t;
      for (t = 0; t <= T; t += 10) {
        var sp = sampleClip(def, cn, t, t / 1000), q = mountEye(sp.model, sp, 'core', false), s = -q[1];
        if (!(s > 0.3) || Math.abs(q[2] / s) > TV * 0.95 || Math.abs(q[0] / s) > TH * 0.95) { errs.push('core off-screen in ' + cn + ' @' + t); break; }
      }
    }
    // particles
    for (key in PRESETS) {
      var p = PRESETS[key];
      if (p.glyphs.length !== p.colors.length) errs.push(key + ': glyph / colour ramps differ in length');
      for (i = 0; i < p.glyphs.length; i++) { var cc = p.glyphs.charCodeAt(i); if (cc < 33 || cc > 126) errs.push(key + ': glyph outside 33..126'); }
      for (i = 0; i < p.colors.length; i++) {
        if (rgb && !rgb[p.colors[i]]) errs.push(key + ': unknown colour ' + p.colors[i]);
        if (rgb && !p.emissive && rgb[p.colors[i]] && Math.max.apply(null, rgb[p.colors[i]]) > 0.35 * 255) errs.push(key + ': lit colour ' + p.colors[i] + ' > 35 %');
      }
    }
    // palette: materials (v1 + v2) and the light
    if (palette) {
      for (key in MATS) {
        if (!palette.materials[MATS[key]]) errs.push('palette.materials.' + MATS[key] + ' missing');
        if (A.detailPass && !A.detailPass.materials[MATS[key]]) errs.push('detailPass.materials.' + MATS[key] + ' missing (GPU path would switch off)');
      }
      A.handFx.lightKeys.forEach(function (lk) { if (!palette.lights[lk]) errs.push('palette.lights.' + lk + ' missing'); });
    }
    return errs;
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { handFx: A.handFx, viewModel: A.viewModels.hand };
  }
})(typeof window !== 'undefined' ? window : globalThis);
