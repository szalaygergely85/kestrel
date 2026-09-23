/*
 * ASCII Quest - DETAIL PASS v2 (PROPOSED)                           design/detail-pass.js
 * Owner: Designer. Spec + engine requests: design/detail-pass.md. Preview: design/preview/detail_pass.html
 *
 * STATUS: PROPOSAL. The game does NOT load this file. Nothing in `ASSETS.palette` (materials, ramps,
 * shading, lights, fog) was changed for it, so the US-004b checksum baseline and `?shadetest=1` are
 * unaffected. The only palette.js change is some extra named colors (section 1, "detail pass v2" block),
 * which no live material references.
 *
 * LOADING (classic script, after palette.js):
 *   <script src="../palette.js"></script>
 *   <script src="../detail-pass.js"></script>
 *   const DP = window.ASSETS.detailPass;
 *
 * WHAT IT ADDS OVER v1 (see detail-pass.md for the exact engine requests):
 *   - glyph SETS chosen by texel CLASS (joint / face / band / overlay / speckle), not by brightness only;
 *     brightness picks the density LEVEL inside the set, a world-anchored hash picks one of the
 *     equal-density ALTERNATES, so one brightness no longer means one glyph
 *   - analytic joint GRID (blocks, bricks, slabs, boards): joints are 1-cell lines found by a footprint
 *     crossing test, drawn with an ORIENTED line glyph (_ - / \ |) that follows the line on screen
 *   - per-block TONES (2 to 4 color variants per material) + per-detail-texel value jitter
 *   - FACE factors per surface normal (N/E/S/W walls, floor, ceiling) + seam AO
 *   - readability LIFT: the glyph level never collapses to '.' under ambient light only
 *   - EDGE pass over the finished cells: silhouettes, convex/concave corners, floor/ceiling seams, step nosings
 *   - FOG v2: cool haze that shifts glyph DENSITY (stipple) and COLOR (lighter glyphs, darker bg), not just darkness
 *   - LOD tiers by distance (near / mid / far glyph sets) with hashed dither. Since US-028 "far still flat" the
 *     far tiers keep the near variety (3-4 alternates, full tones / jitter / bevel / overlay); only speckle is near-only
 *
 * The functions in `util` are the REFERENCE implementation (clarity over speed), same rule as palette.js:
 * the engine may re-implement them (G-buffer, typed arrays, LUTs) as long as the output matches.
 */
(function (root) {
  'use strict';
  var ASSETS = root.ASSETS = root.ASSETS || {};
  var P = ASSETS.palette;
  // Node (CommonJS, or ESM via default import / createRequire): pull palette.js in if nobody loaded it yet.
  if (!P && typeof module === 'object' && module && module.exports && typeof require === 'function') {
    P = ASSETS.palette = require('./palette.js');
  }
  if (!P) throw new Error('design/detail-pass.js: load design/palette.js first');
  var rgb = P.rgb;

  // ---------------------------------------------------------------------------
  // 1. SHADING CONSTANTS (v2)
  // ---------------------------------------------------------------------------
  var shading = {
    cutoff: 0.03,      // b below this -> space (same as v1)
    lift: 0.12,        // glyph level uses gb = lift + (1-lift)*min(b,1): ambient-only stone lands on level 3 of 8, not 1
    gamma: 0.70,       // level curve: level = 1 + floor(gb^gamma * N)  (N = levels in the set)
    fgMin: 0.55,       // fg gain at b = 0 (v1: 0.32). Ambient stone fg ~ #3e4045 instead of #242831
    fgGamma: 0.75,
    fgMaxGain: 1.2,
    tint: 0.60,        // light hue tint (v1: 0.85). Material hue survives under the blue ambient
    overbright: 0.6, overbrightMax: 0.5,
    cellAspect: 2.0    // cell height / cell width in pixels, used to classify line directions (engine: pxCellH/pxCellW)
  };

  // Face factor by surface normal. Walls: the compass direction the face LOOKS toward.
  // U = floors and solid tops, D = ceilings and lintel undersides. Multiplies brightness (like fake sky-light).
  var faceShade = { E: 1.00, S: 0.90, W: 0.80, N: 0.72, U: 0.94, D: 0.62 };

  // Seam ambient occlusion: brightness * lerp(k, 1, smoothstep(0, r, aoD)), aoD = metres to the nearest concave seam.
  var ao = { r: 0.30, k: 0.60 };

  // ---------------------------------------------------------------------------
  // 2. FOG v2 (interior)
  // ---------------------------------------------------------------------------
  var fog = {
    color: 'fogV2',            // bg goes toward this (dark cool)
    glyph: 'fogV2Glyph',       // fg goes toward this (LIGHTER than bg: aerial haze, glyphs stay visible)
    start: 10, full: 45, curve: 1.0,   // US-028 LOD feedback: was 6 / 36
    // US-028 "far still flat": fog shifts colour / haze first; glyph variety survives to f 0.6 (~31 m).
    stipple: [0.60, 0.92],     // (was 0.45 / 0.85) from f = 0.6 a growing share of cells (hash) switch to the fog set ...
    sparse: 0.90,              // ... ':' / '.' haze; above f = sparse (~42 m) the sparser level (with spaces). Was hard-coded 0.8
    set: 'fog'
  };

  // Max LOD tier (0 near, 1 mid, 2 far) at which each face feature is still applied. Data, not code, so
  // the owner's "far as lively as near" can be tuned without engine changes. Before US-028 "far still flat"
  // these were hard-coded as bevel 1, band 1, overlay 1, speckle 0.
  var lodGates = {
    bevel: 2,      // block top / bottom shade bands
    band: 2,       // beam glyph set inside a band (tone / shade apply at every tier regardless)
    overlay: 2,    // moss / soot / dust
    speckle: 0     // chips / knots / tufts: the finest speckle, near only
  };

  // ---------------------------------------------------------------------------
  // 3. EDGE PASS (runs after shading, over the whole cell grid; needs depth + planeId + kind per cell)
  // ---------------------------------------------------------------------------
  var edges = {
    depthRatio: 1.18, depthAbs: 0.35,  // neighbour is "farther" if n.dist > d*ratio + abs (and a different plane, or sky)
    fogMax: 0.85,                      // no edge glyphs in cells with fog factor above this
    rules: {
      cap:       { glyph: '=', gain: 1.45, desc: 'top edge of a surface against something farther (wall top vs sky, platform lip from above)' },
      lip:       { glyph: '_', gain: 0.55, desc: 'bottom edge against something farther (lintel / roof-slab underside at an opening)' },
      side:      { glyph: '|', gain: 1.30, desc: 'left/right silhouette of a vertical surface (wall end, pillar)' },
      convex:    { glyph: '|', gain: 1.35, desc: 'outside corner between two wall planes (arris catches light)' },
      concave:   { glyph: '|', gain: 0.55, desc: 'inside corner (crease, dark)' },
      seamFloor: { glyph: '_', gain: 0.60, desc: 'lowest wall row where it meets the floor (skirting shadow)' },
      seamCeil:  { glyph: '-', gain: 0.60, desc: 'highest wall row under a ceiling' },
      nosing:    { glyph: '=', gain: 1.25, desc: 'top row of a step riser (lit step edge)' }
    }
  };

  // ---------------------------------------------------------------------------
  // 4. GLYPH SETS
  //   Array set: sets[k][level-1] = string of equal-density ALTERNATES for that level (level 0 = space, implicit).
  //   Oriented set: { orient: 'u'|'v', dark: [...levels], fam: { h, v, d1, d2 : [...levels] } }
  //     = grain / beam glyphs that follow the on-screen direction of the lines of constant `orient`
  //     (h = horizontal - _ ~ =, v = vertical | !, d1 = '/', d2 = '\'). Levels: dark first, then fam.
  //   ASCII 32..126 only. Letters only where they read as shapes (o O x v w).
  // ---------------------------------------------------------------------------
  var sets = {
    stoneFace:  [".'", ".,`", ",:;", ":;,", ";+:", "+x=", "x%#", "%#&"],
    // US-028 "far still flat": mid AND far sets = the near vocabulary with 3-4 alternates per level (same
    // densities, no reduced sets). Far = mid. Only the speckle layer (chips / knots / tufts) stays near-only.
    // Blank-share rule kept: no '.' at level 3 (floor sets: level 3 and 4).
    stoneMid:   [".'`", ".,`'", ",:;'", ":;,+", ";+:x", "+x=%", "x%#+", "%#&x"],
    stoneFar:   [".'`", ".,`'", ",:;'", ":;,+", ";+:x", "+x=%", "x%#+", "%#&x"],
    chip:       [".", "'", "'`", "`'", "\"'", "%'", "%&", "&%"],
    moss:       [".", ",", ",'", "\",", "\";", "\"%", "%&", "&@"],
    // US-028 D2 (blank share): with lift 0.12 + gamma 0.70 an 8-level set never lands below level 3 when
    // b >= cutoff, so level 3 (and floor level 4) must not contain '.': soot, floor* and woodFar L2 lost their dots.
    soot:       [".", ".", ",'", ",:", ":;", ";%", "%#", "#&"],
    brickFace:  [".", ".,", ",:", ":=", "=:", "=+", "#=", "#%"],
    brickMid:   [".'`", ".,'", ",:;'", ":=;,", "=:+;", "=+:x", "#=+%", "#%=&"],
    brickFar:   [".'`", ".,'", ",:;'", ":=;,", "=:+;", "=+:x", "#=+%", "#%=&"],
    floorFace:  [".", ".'", ",`'", ",`:'", ",:;", ":;=", ";=+", "=+*"],
    floorMid:   [".`'", ".',`", ",`'", ",`:'", ",:;'", ":;=,", ";=+:", "=+*;"],
    floorFar:   [".`'", ".',`", ",`'", ",`:'", ",:;'", ":;=,", ";=+:", "=+*;"],
    dust:       [".", "'", "'`", "'\"", "\"'", "\"^", "^*", "*"],
    gap:        [".", ".", ",", ",", ",.", ";", ";", ":"],
    rubbleFace: [".", ".,", ",:o", ":;o", "oO;", "O%o", "%#O", "#&@"],
    rubbleMid:  [".,'", ".,:", ",:o;", ":;o,", "oO;:", "O%o;", "%#O&", "#&@%"],
    rubbleFar:  [".,'", ".,:", ",:o;", ":;o,", "oO;:", "O%o;", "%#O&", "#&@%"],
    grassFace:  [".", ",'", "',\"", "\";,", "\"v;", "v\";", "vw\"", "wv\""],
    grassMid:   [".,'", ",'.", "',\";", "\";,'", "\"v;,", "v\";w", "vw\";", "wv\"v"],
    grassFar:   [".,'", ",'.", "',\";", "\";,'", "\"v;,", "v\";w", "vw\";", "wv\"v"],
    tuft:       ["'", "\"", "\"v", "v\"", "vw", "wv", "w", "w"],
    knot:       [".", "o", "o", "o", "@", "@", "@"],
    woodFar:    [".,", "-,", "-_", "=-", "=_", "=#", "#="],   // no longer referenced (wood / ceiling far = grain sets); kept for old exports
    fog:        [". ", ".:"],     // fog stipple: [0] sparse (f > 0.8), [1] haze
    grainU: { orient: 'u', dark: ["."], fam: {
      h:  ["-", "-", "-~", "~=", "=", "="],
      v:  ["!", "|", "|", "|!", "|", "|"],
      d1: ["/", "/", "/", "/", "/", "/"],
      d2: ["\\", "\\", "\\", "\\", "\\", "\\"] } },
    grainV: { orient: 'v', dark: ["."], fam: {
      h:  ["-", "-", "-~", "~=", "=", "="],
      v:  ["!", "|", "|", "|!", "|", "|"],
      d1: ["/", "/", "/", "/", "/", "/"],
      d2: ["\\", "\\", "\\", "\\", "\\", "\\"] } },
    beam: { orient: 'v', dark: ["."], fam: {
      h:  ["-", "=", "=", "=", "#=", "#"],
      v:  ["|", "|", "|", "|", "#", "#"],
      d1: ["/", "/", "/", "/", "#", "#"],
      d2: ["\\", "\\", "\\", "\\", "#", "#"] } }
  };

  // ---------------------------------------------------------------------------
  // 5. MATERIALS v2
  //   Coordinates are the v1 ones (README 1.6): walls u = along-wall m, v = height m (up);
  //   floors / ceilings u = world x, v = world y.
  //   tones:   [[colorKey, weight], ...] one is picked PER BLOCK (grid cell) by hash; jitter = +- value noise per detail texel
  //   detail:  detail texels per metre, world-anchored. US-028a: with a grid, the alternate glyph, jitter, overlay
  //            and speckle hashes are per BLOCK (bix, course); without one, per texel one octave coarser
  //   grid:    analytic joints. Blocks u x v m, every odd course shifted by stagger*u.
  //            Joints = lines at v = k*grid.v (bed) and u' = k*grid.u (head). A joint is drawn in a cell only if the
  //            line passes through the cell's texture footprint, and only while the footprint is < maxCover * period;
  //            if not, retried as every 2nd line (2x period), then every 4th (4x), then dropped (US-028 D1).
  //            kind 'line' (default) = oriented line glyph; kind 'gap' = glyph set `set` (rubble gaps).
  //            tie: true = head joints disappear together with bed joints (walls). lines: false = tones only.
  //   face:    set (near), mid (lod.mid..lod.far), far (> lod.far). bevel = shade bands at the top/bottom of a block.
  //   band:    analytic stripe (beams): axis, period, width, set, tone, shade; its two borders are line joints.
  //   overlay: moss / soot / dust. chance per detail texel = (joint|face) * bandFactor(band, z). On a joint it only
  //            tints (the joint line stays); on a face it swaps the set too.
  //   speckle: rare chips / knots / tufts on faces (near tier only).
  // ---------------------------------------------------------------------------
  var STONE = {
    albedo: 0.85, bgK: 0.28, seed: 11, detail: 18, jitter: 0.08,
    tones: [['stoneMid', 4], ['stoneCool', 3], ['stoneWarm', 2], ['stoneDeep', 1]],
    grid: { u: 0.8, v: 0.4, stagger: 0.5, shade: 0.55, tint: 'mortar', amount: 0.5, bgK: 0.16, cross: '|', maxCover: 0.25, tie: true },
    face: { set: 'stoneFace', mid: 'stoneMid', far: 'stoneFar',
            bevel: { top: 0.05, topShade: 1.15, bottom: 0.05, bottomShade: 0.80 } },
    speckle: { set: 'chip', chance: 0.05, shade: 0.72 },
    lod: { mid: 12, far: 25, dither: 3 }
  };
  function ext(base, extra) {
    var o = {}, k;
    for (k in base) o[k] = base[k];
    for (k in extra) o[k] = extra[k];
    return o;
  }

  var materials = {
    stone: ext(STONE, {
      v1: 'stone',
      desc: 'Tower wall: coursed ashlar 0.8 x 0.4 m, half bond. Mortar = 1-cell lines ( _ | ) at every distance up to ~12 m, ' +
            'every block its own tone (4 greys: mid, cool, warm, deep), rough face : ; , + x, rare chips.'
    }),
    stone_moss: ext(STONE, {
      v1: 'stone_moss', seed: 12,
      desc: 'Stone with moss: green in the joints first, then patches on the faces, only near the floor (band 1.0 -> 2.2 m).',
      overlay: { set: 'moss', tints: ['moss', 'mossDark', 'mossLight'], amount: 0.85, shade: 0.95,
                 band: { full: 1.0, zero: 2.2 }, joint: 0.90, face: 0.35 }
    }),
    stone_scorched: ext(STONE, {
      v1: 'stone_scorched', seed: 13,
      desc: 'Stone above the brazier: soot in the joints and in blotches, fading out with height (0.8 -> 2.5 m).',
      overlay: { set: 'soot', tints: ['scorch'], amount: 0.75, shade: 0.60,
                 band: { full: 0.8, zero: 2.5 }, joint: 0.90, face: 0.55 }
    }),
    brick: {
      v1: 'stone', seed: 21,
      desc: 'Brick courses 0.3 x 0.1 m (future houses, chimneys). Light mortar, classic |___|___| at mid range.',
      albedo: 0.80, bgK: 0.26, detail: 20, jitter: 0.10,
      tones: [['brick', 4], ['brickDark', 2], ['brickLight', 2]],
      grid: { u: 0.3, v: 0.1, stagger: 0.5, shade: 0.85, tint: 'ash', amount: 0.55, bgK: 0.16, cross: '|', maxCover: 0.25, tie: true },
      face: { set: 'brickFace', mid: 'brickMid', far: 'brickFar' },
      lod: { mid: 10, far: 22, dither: 3 }
    },
    floor: {
      v1: 'floor', seed: 31,
      desc: 'Flagstone floor: slabs 0.75 x 0.5 m (world x, y), running bond, dark grout that collects ash. ' +
            'Sparser, lower-sitting glyphs than walls ( . , \' ` ). Receding grout lines turn into / and \\.',
      albedo: 0.75, bgK: 0.26, detail: 14, jitter: 0.08,
      tones: [['flagstone', 4], ['flagWarm', 2], ['flagCool', 2], ['flagDark', 2]],
      grid: { u: 0.75, v: 0.5, stagger: 0.5, shade: 0.50, tint: 'mortar', amount: 0.5, bgK: 0.14, cross: '+', maxCover: 0.25 },
      face: { set: 'floorFace', mid: 'floorMid', far: 'floorFar' },
      overlay: { set: 'dust', tints: ['ash', 'ashLight'], amount: 0.45, shade: 1.05, joint: 0.30, face: 0.07 },
      speckle: { set: 'chip', chance: 0.03, shade: 0.70 },
      lod: { mid: 12, far: 25, dither: 3 }
    },
    ceiling_timber: {
      v1: 'stone', seed: 41,
      desc: 'Timber ceiling (the underside of the floor above): boards 0.25 m wide running north-south with grain lines, ' +
            'heavy beams 0.22 m every 1.0 m running east-west ( = # ). Warm brown and dark, so it never reads as floor.',
      // US-028 tuning: albedo 0.70 -> 0.74, grid.shade 0.45 -> 0.75, band.edgeShade 0.5 -> 0.75. At ambient only
      // (Lm 0.12, ceiling face 0.62) the old joint / beam-edge b was 0.023-0.026 < cutoff 0.03 = a blank cell on every
      // board joint and beam edge. Joints keep their darkness through the woodDark tint (0.6) and bgK 0.12, not through b.
      // US-028 D2: albedo 0.74 -> 0.78 so boards in the full seam-AO zone (k 0.60, jitter -10 %) stay >= cutoff.
      albedo: 0.78, bgK: 0.22, detail: 20, jitter: 0.10,
      tones: [['wood', 3], ['woodDark', 2], ['woodLight', 1]],
      grid: { u: 0.25, v: 2.0, stagger: 0.5, shade: 0.75, tint: 'woodDark', amount: 0.6, bgK: 0.12, maxCover: 0.25 },
      face: { set: 'grainU', mid: 'grainU', far: 'grainU' },
      band: { axis: 'v', period: 1.0, width: 0.22, set: 'beam', tone: 'woodDark', shade: 0.85, bgK: 0.14, edgeShade: 0.75 },
      speckle: { set: 'knot', chance: 0.012, shade: 0.7 },
      lod: { mid: 12, far: 25, dither: 3 }
    },
    wood: {
      v1: 'wood', seed: 51,
      desc: 'Planks on a vertical face (pallet, lever post, doors): 0.2 m planks, butt joints every 1.2 m, grain along the plank, knots.',
      albedo: 0.70, bgK: 0.22, detail: 22, jitter: 0.10,
      tones: [['wood', 3], ['woodLight', 2], ['woodDark', 1]],
      grid: { u: 1.2, v: 0.2, stagger: 0.33, shade: 0.45, tint: 'woodDark', amount: 0.6, bgK: 0.12, maxCover: 0.25 },
      face: { set: 'grainV', mid: 'grainV', far: 'grainV' },
      speckle: { set: 'knot', chance: 0.02, shade: 0.7 },
      lod: { mid: 12, far: 25, dither: 3 }
    },
    rubble: {
      v1: 'rubble', seed: 61,
      desc: 'Fallen blocks and gravel: irregular stones ~0.3 m with dark gaps ( , ; ) instead of lines, round o O pebbles.',
      albedo: 0.80, bgK: 0.26, detail: 18, jitter: 0.14,
      tones: [['rubble', 3], ['stoneDeep', 2], ['stoneCool', 2], ['stoneLight', 1]],
      grid: { u: 0.3, v: 0.22, stagger: 0.5, kind: 'gap', set: 'gap', shade: 0.40, bgK: 0.10, maxCover: 0.6 },
      face: { set: 'rubbleFace', mid: 'rubbleMid', far: 'rubbleFar' },
      lod: { mid: 12, far: 25, dither: 3 }
    },
    grass: {
      v1: 'grass', seed: 71,
      desc: 'Hill turf: patches of 3 greens (0.7 m, tones only, no lines), tufts " v w, sparse at a distance.',
      albedo: 0.80, bgK: 0.24, detail: 16, jitter: 0.12,
      tones: [['grass', 3], ['grassDark', 2], ['grassLight', 2]],
      grid: { u: 0.7, v: 0.7, stagger: 0.5, lines: false },
      face: { set: 'grassFace', mid: 'grassMid', far: 'grassFar' },
      speckle: { set: 'tuft', chance: 0.05, shade: 1.15 },
      lod: { mid: 12, far: 25, dither: 3 }
    }
  };

  // v1 material key -> v2 key. v1 materials not listed (iron, grate, ash, rock, sky) keep the v1 shader for now.
  var remap = {
    stone: 'stone', stone_moss: 'stone_moss', stone_scorched: 'stone_scorched',
    floor: 'floor', wood: 'wood', rubble: 'rubble', grass: 'grass'
  };
  // Proposed level data changes (NOT applied: game/js/world/levels/test_room.js belongs to the programmer).
  // kind -> { v1 key -> v2 key }. test_room ceilings are 'stone' today, identical to its walls.
  var levelOverrides = {
    test_room: { ceil: { stone: 'ceiling_timber' } }
  };

  // ---------------------------------------------------------------------------
  // 6. REFERENCE IMPLEMENTATION
  // ---------------------------------------------------------------------------
  // Integer hash -> [0,1). World-anchored (texel / block coordinates), so it is stable while the camera moves.
  function hash(x, y, s) {
    var h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) | 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smoothstep(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function pick(str, h) { return str.charAt(Math.min(str.length - 1, Math.floor(h * str.length))); }

  // Level 0..n for n levels (0 = space). Same shape as v1 rampIndex with len = n + 1.
  function level(n, gb) {
    if (!(gb >= shading.cutoff)) return 0;
    var i = Math.floor(Math.pow(gb > 1 ? 1 : gb, shading.gamma) * n);
    return 1 + (i > n - 1 ? n - 1 : i);
  }

  // Direction class of the on-screen line along which coordinate c is constant.
  // cx = dc/dcol, cy = dc/drow (per screen cell). Returns 'h' | 'v' | 'd1' ('/') | 'd2' ('\').
  function orientClass(cx, cy) {
    var gx = cx, gy = cy / shading.cellAspect;        // gradient in pixel space (up to a common factor)
    var dx = -gy, dy = gx;                             // line direction = perpendicular to the gradient
    if (dx === 0 && dy === 0) return 'h';
    var a = Math.atan2(dy, dx) * 57.29578;
    if (a < 0) a += 180;
    if (a >= 180) a -= 180;
    if (a < 22 || a > 158) return 'h';
    if (a > 68 && a < 112) return 'v';
    return (dx * dy > 0) ? 'd2' : 'd1';                 // screen y grows down: right-and-down = '\'
  }
  // Oriented line glyph. fr = where the line crosses the cell, 0 = top, 1 = bottom (for horizontal lines).
  function lineGlyph(cx, cy, fr) {
    var k = orientClass(cx, cy);
    if (k === 'h') return fr >= 0.5 ? '_' : '-';
    return k === 'v' ? '|' : k === 'd1' ? '/' : '\\';
  }
  // Footprint crossing test. Does a line c = offset + k*period pass through this cell?
  // Returns -1 if not, else fr (0 top .. 1 bottom) of the crossing inside the cell.
  function crossLine(c, cx, cy, period, offset) {
    var hw = 0.5 * (Math.abs(cx) + Math.abs(cy));
    if (!(hw > 1e-7)) hw = 1e-7;
    var k = Math.floor((c + hw - offset) / period);
    var line = offset + k * period;
    if (line < c - hw) return -1;
    var fr = Math.abs(cy) > 1e-9 ? 0.5 + (line - c) / cy : 0.5;
    return fr < 0 ? 0 : fr > 1 ? 1 : fr;
  }
  function cover(cx, cy) { return Math.abs(cx) + Math.abs(cy); }
  function bandFactor(band, z) {
    if (!band || z == null) return 1;
    if (z <= band.full) return 1;
    if (z >= band.zero) return 0;
    return 1 - (z - band.full) / (band.zero - band.full);
  }
  function pickTone(m, h) {
    var t = m.tones, tot = 0, i;
    for (i = 0; i < t.length; i++) tot += t[i][1];
    var x = h * tot;
    for (i = 0; i < t.length; i++) { x -= t[i][1]; if (x < 0) return t[i][0]; }
    return t[t.length - 1][0];
  }
  function fogFactor(dist) {
    if (dist <= fog.start) return 0;
    if (dist >= fog.full) return 1;
    return Math.pow((dist - fog.start) / (fog.full - fog.start), fog.curve);
  }

  // Glyph from a set at brightness gb. alt = use the hashed alternate (near tier) else the first one (calm).
  function setGlyph(S, gb, h, alt, s) {
    var n, lv, str;
    if (S.orient) {
      var nd = S.dark.length, nf = S.fam.h.length;
      lv = level(nd + nf, gb);
      if (lv === 0) return ' ';
      if (lv <= nd) str = S.dark[lv - 1];
      else {
        var cls = S.orient === 'u' ? orientClass(s.dudx, s.dudy) : orientClass(s.dvdx, s.dvdy);
        str = S.fam[cls][lv - nd - 1];
      }
    } else {
      n = S.length;
      lv = level(n, gb);
      if (lv === 0) return ' ';
      str = S[lv - 1];
    }
    return alt ? pick(str, h) : str.charAt(0);
  }

  var OCT_POW2 = [0.125, 0.25, 0.5, 1, 2, 4];   // 2^oct for oct = -3 .. +2 (index oct + 3)
  // Coverage fallback octaves (US-028 D1): a line whose footprint test fails at its own period is retried
  // at 2x the period (every 2nd line), then 4x (every 4th), before it is dropped. Returns the period or -1.
  function fallbackPeriod(cov, maxCover, period) {
    if (cov < maxCover * period) return period;
    if (cov < maxCover * period * 2) return period * 2;
    if (cov < maxCover * period * 4) return period * 4;
    return -1;
  }

  var ALL_ON = { lift: true, tones: true, joints: true, faces: true, ao: true, sets: true, detail: true, overlay: true, fog: true, edges: true };

  /*
   * Reference v2 surface shader.
   *   s   : surface sample (one G-buffer cell), see detail-pass.md "Sample":
   *         { kind, mat (v2 key), normal, u, v, dudx, dvdx, dudy, dvdy, z, aoD, dist }
   *   L   : [r,g,b] accumulated light, exactly as v1 (P.util.addLight)
   *   out : { glyph, fg:[3], bg:[3], b, f } written in place
   *   F   : feature flags (preview toggles), default all on
   */
  function shade(s, L, out, F) {
    F = F || ALL_ON;
    out = out || {};
    if (!out.fg) out.fg = [0, 0, 0];
    if (!out.bg) out.bg = [0, 0, 0];
    var m = materials[s.mat] || materials.stone;
    var dist = s.dist || 0, u = s.u, v = s.v;
    var g = m.grid;

    // --- block coordinates ---
    var course = 0, bix = 0, fv = 0.5, uo = u;
    if (g) {
      course = Math.floor(v / g.v);
      uo = u - ((course & 1) ? g.stagger * g.u : 0);
      bix = Math.floor(uo / g.u);
      fv = v / g.v - course;
    }
    // --- hashes (world-anchored) ---
    // US-028 (arch re-review 2, D1): per-cell detail OCTAVE, exactly as engine shadeDetailFast.
    // tpc = texels per screen cell (bigger of the u / v footprints) at the base density; the density is
    // halved / doubled in octaves (-3 .. +2) so near texels stay crisp and far ones stay calm, still
    // world-anchored (floor(u * ds)). hA / hC use the octave texel; hB (LOD tier dither + fog stipple)
    // keeps the BASE texel, so the tier boundary does not move with the octave.
    // US-028a F1 (anti-swim): hA / hC are keyed on the BLOCK (bix, course) when the material has a grid
    // (also grid.lines === false, e.g. grass), else on the texel one octave coarser (floor(u * ds * 0.5)),
    // so alternates / jitter / overlay / speckle no longer reroll on sub-cell camera motion. hB unchanged.
    var base = m.detail || 16;
    var tpcU = Math.abs(s.dudx) + Math.abs(s.dudy), tpcV = Math.abs(s.dvdx) + Math.abs(s.dvdy);
    var tpc = (tpcU > tpcV ? tpcU : tpcV) * base;
    var oct = tpc >= 4 ? -3 : tpc >= 2 ? -2 : tpc >= 1 ? -1 : tpc >= 0.5 ? 0 : tpc >= 0.25 ? 1 : 2;
    var ds = base * OCT_POW2[oct + 3];
    var ax, ay;
    if (g) { ax = bix; ay = course; }
    else { ax = Math.floor(u * ds * 0.5); ay = Math.floor(v * ds * 0.5); }
    var btx = Math.floor(u * base), bty = Math.floor(v * base);
    var hA = hash(ax, ay, m.seed), hB = hash(btx, bty, m.seed + 7), hC = hash(ax, ay, m.seed + 13);
    var hBlock = hash(bix, course, m.seed + 3);

    // --- tone (per block) ---
    var toneKey = F.tones ? pickTone(m, hBlock) : m.tones[0][0];
    var c0 = rgb[toneKey], cr = c0[0], cg = c0[1], cb = c0[2];

    // --- LOD tier (0 near, 1 mid, 2 far), dithered by hash so there is no hard ring ---
    var tier = 0;
    if (m.lod) {
      var dd = dist + (hB - 0.5) * (m.lod.dither || 0);
      tier = dd < m.lod.mid ? 0 : dd < m.lod.far ? 1 : 2;
    }
    if (!F.sets) tier = 2;
    var set = tier === 0 ? m.face.set : tier === 1 ? (m.face.mid || m.face.set) : (m.face.far || m.face.set);
    var shadeK = 1, tint = null, tintAmt = 0, bgK = m.bgK, lineG = null, onJoint = false, inBand = false;

    // --- bevel (block top / bottom rows) ---
    if (g && m.face.bevel && tier <= lodGates.bevel && F.sets) {
      var bv = m.face.bevel, yv = fv * g.v;
      if (g.v - yv < bv.top) shadeK *= bv.topShade;
      else if (yv < bv.bottom) shadeK *= bv.bottomShade;
    }
    // --- band (beams) ---
    var band = m.band;
    if (band) {
      var bcoord = band.axis === 'u' ? u : v;
      var bcx = band.axis === 'u' ? s.dudx : s.dvdx, bcy = band.axis === 'u' ? s.dudy : s.dvdy;
      var pos = bcoord - Math.floor(bcoord / band.period) * band.period;
      if (pos < band.width) {
        inBand = true;
        if (tier <= lodGates.band || !F.sets) set = band.set;
        shadeK = band.shade;
        if (band.tone && F.tones) { var bt = rgb[band.tone]; cr = bt[0]; cg = bt[1]; cb = bt[2]; }
        if (band.bgK) bgK = band.bgK;
      }
      // D1: the band-edge coverage gate widens 2x, then 4x (0.5 -> 1 -> 2 x width); the edges stay at the
      // band's own period (a band has only its two borders), same as the engine.
      if (F.joints && fallbackPeriod(cover(bcx, bcy), 0.5, band.width) > 0) {
        var e0 = crossLine(bcoord, bcx, bcy, band.period, 0), e1 = crossLine(bcoord, bcx, bcy, band.period, band.width);
        var ef = e0 >= 0 ? e0 : e1;
        if (ef >= 0) { lineG = lineGlyph(bcx, bcy, ef); shadeK = band.edgeShade || 0.5; onJoint = true; }
      }
    }
    // --- joints ---
    if (g && F.joints && g.lines !== false && !inBand && !onJoint) {
      // D1: joint fallback octaves - every line, else every 2nd, else every 4th (period x2 / x4).
      var periodH = fallbackPeriod(cover(s.dvdx, s.dvdy), g.maxCover, g.v);
      var periodV = fallbackPeriod(cover(s.dudx, s.dudy), g.maxCover, g.u);
      var okH = periodH > 0;
      var okV = periodV > 0 && (!g.tie || okH);
      var fh = okH ? crossLine(v, s.dvdx, s.dvdy, periodH, 0) : -1;
      var fu = okV ? crossLine(uo, s.dudx, s.dudy, periodV, 0) : -1;
      if (fh >= 0 || fu >= 0) {
        onJoint = true;
        if (g.kind === 'gap') { set = g.set; lineG = null; }
        else if (fh >= 0 && fu >= 0 && g.cross) lineG = g.cross;
        else if (fu >= 0) lineG = lineGlyph(s.dudx, s.dudy, fu);
        else lineG = lineGlyph(s.dvdx, s.dvdy, fh);
        shadeK = g.shade;
        if (g.tint) { tint = g.tint; tintAmt = g.amount == null ? 0.5 : g.amount; }
        if (g.bgK) bgK = g.bgK;
      }
    }
    // --- overlay (moss / soot / dust) ---
    var ov = m.overlay;
    if (ov && F.overlay && tier <= lodGates.overlay) {
      var bf = ov.band ? bandFactor(ov.band, s.z) : 1;
      if (hC < (onJoint ? ov.joint : ov.face) * bf) {
        if (!onJoint) set = ov.set;
        tint = ov.tints[Math.min(ov.tints.length - 1, Math.floor(hA * ov.tints.length))];
        tintAmt = ov.amount;
        shadeK *= ov.shade;
      }
    }
    // --- speckle (chips, knots, tufts) ---
    if (m.speckle && F.sets && tier <= lodGates.speckle && !onJoint && !inBand && hC > 1 - m.speckle.chance) {
      set = m.speckle.set;
      shadeK *= m.speckle.shade;
    }

    // --- brightness ---
    var Lm = Math.max(L[0], L[1], L[2]);
    var fk = F.faces ? (faceShade[s.normal] || 1) : 1;
    var aok = 1;
    if (F.ao && s.aoD != null && s.aoD < ao.r) aok = ao.k + (1 - ao.k) * smoothstep(0, ao.r, s.aoD);
    var jit = F.tones ? 1 + (m.jitter || 0) * (hA * 2 - 1) : 1;
    var b = Lm * m.albedo * shadeK * fk * aok * jit + (m.emissive || 0);
    var lift = F.lift ? shading.lift : 0;
    var gb = b < shading.cutoff ? 0 : lift + (1 - lift) * Math.min(b, 1);

    // --- fog ---
    var f, fogBg, fogFg;
    if (F.fog) { f = fogFactor(dist); fogBg = rgb[fog.color]; fogFg = rgb[fog.glyph]; }
    else { f = P.util.fogFactor(dist, 'interior'); fogBg = fogFg = rgb[P.fog.interior.color]; gb *= (1 - f); }

    // --- glyph ---
    var glyph;
    if (gb <= 0) glyph = ' ';
    else if (lineG) glyph = lineG;
    // US-028 LOD feedback: alternates in every tier (was near only), so mid / far walls are not one glyph per level.
    else glyph = setGlyph(sets[set], gb, hA, F.detail, s);
    if (F.fog && f > fog.stipple[0] && hB < smoothstep(fog.stipple[0], fog.stipple[1], f)) {
      glyph = pick(sets[fog.set][f > fog.sparse ? 0 : 1], hA);
    }

    // --- color ---
    if (tint && tintAmt > 0) {
      var tc = rgb[tint];
      cr += (tc[0] - cr) * tintAmt; cg += (tc[1] - cg) * tintAmt; cb += (tc[2] - cb) * tintAmt;
    }
    var hr = 1, hg = 1, hb = 1;
    if (Lm > 1e-6) { hr = L[0] / Lm; hg = L[1] / Lm; hb = L[2] / Lm; }
    var k = F.lift ? shading.tint : P.shading.tint;
    var fgMin = F.lift ? shading.fgMin : P.shading.fgMin;
    var bc = b < 0 ? 0 : b;
    var gain = fgMin + (1 - fgMin) * Math.pow(bc > 1 ? 1 : bc, shading.fgGamma);
    if (bc > 1) gain = Math.min(shading.fgMaxGain, gain + (bc - 1) * 0.5);
    var r = cr * (1 + (hr - 1) * k) * gain, gg = cg * (1 + (hg - 1) * k) * gain, bl = cb * (1 + (hb - 1) * k) * gain;
    if (bc > 1) {
      var hot = Math.min(shading.overbrightMax, (bc - 1) * shading.overbright);
      r += (255 * (0.5 + 0.5 * hr) - r) * hot; gg += (255 * (0.5 + 0.5 * hg) - gg) * hot; bl += (255 * (0.5 + 0.5 * hb) - bl) * hot;
    }
    if (r > 255) r = 255; if (gg > 255) gg = 255; if (bl > 255) bl = 255;
    var xr = r * bgK, xg = gg * bgK, xb = bl * bgK;
    if (f > 0) {
      r += (fogFg[0] - r) * f; gg += (fogFg[1] - gg) * f; bl += (fogFg[2] - bl) * f;
      xr += (fogBg[0] - xr) * f; xg += (fogBg[1] - xg) * f; xb += (fogBg[2] - xb) * f;
    }
    out.glyph = glyph;
    out.fg[0] = r; out.fg[1] = gg; out.fg[2] = bl;
    out.bg[0] = xr; out.bg[1] = xg; out.bg[2] = xb;
    out.b = b; out.f = f; out.joint = onJoint;
    return out;
  }

  function isVert(s) { return s.kind === 'wall' || s.kind === 'step' || s.kind === 'upper'; }
  function isUp(s) { return s.kind === 'floor' || s.kind === 'top'; }
  function farther(s, n) {
    if (!n) return false;
    if (n.kind === 'sky') return true;
    if (n.planeId === s.planeId) return false;
    return n.dist > s.dist * edges.depthRatio + edges.depthAbs;
  }

  /*
   * Reference EDGE pass. Runs once per frame after every cell is shaded.
   *   G : array cols*rows of samples ({kind, planeId, dist, ...}; sky cells kind 'sky'), row-major
   *   C : array cols*rows of shaded cells { glyph, fg, bg, f } (modified in place)
   *   returns the rule name per cell (array, null = none) for debugging
   * Rules are decided on the unmodified input first, then applied, so edges never cascade.
   */
  function edgePass(cols, rows, G, C) {
    var R = edges.rules, out = new Array(cols * rows), x, y, i;
    for (y = 0; y < rows; y++) {
      for (x = 0; x < cols; x++) {
        i = y * cols + x;
        var s = G[i];
        if (!s || s.kind === 'sky' || !C[i] || C[i].f > edges.fogMax) continue;
        var up = y > 0 ? G[i - cols] : null, dn = y < rows - 1 ? G[i + cols] : null;
        var lf = x > 0 ? G[i - 1] : null, rt = x < cols - 1 ? G[i + 1] : null;
        var r = null;
        if (farther(s, up)) r = 'cap';
        else if (farther(s, dn)) r = 'lip';
        else if (isVert(s) && (farther(s, lf) || farther(s, rt))) r = 'side';
        else if (isVert(s) && rt && isVert(rt) && rt.planeId !== s.planeId) {
          var l2 = x > 0 ? G[i - 1] : null, r2 = x < cols - 2 ? G[i + 2] : null;
          var dl = l2 && l2.kind !== 'sky' ? l2.dist : s.dist, dr = r2 && r2.kind !== 'sky' ? r2.dist : rt.dist;
          if (s.dist <= dl && rt.dist <= dr) r = 'convex';
          else if (s.dist >= dl && rt.dist >= dr) r = 'concave';
        }
        if (!r && isVert(s) && s.kind !== 'step' && dn && isUp(dn) && dn.dist <= s.dist * 1.08) r = 'seamFloor';
        if (!r && isVert(s) && up && up.kind === 'ceil' && up.dist <= s.dist * 1.08) r = 'seamCeil';
        if (!r && s.kind === 'step' && up && isUp(up)) r = 'nosing';
        out[i] = r;
      }
    }
    for (i = 0; i < out.length; i++) {
      if (!out[i]) continue;
      var rule = R[out[i]], c = C[i];
      c.glyph = rule.glyph;
      c.fg[0] = Math.min(255, c.fg[0] * rule.gain);
      c.fg[1] = Math.min(255, c.fg[1] * rule.gain);
      c.fg[2] = Math.min(255, c.fg[2] * rule.gain);
    }
    return out;
  }

  // v1 key + surface kind (+ level) -> v2 key, or null = keep the v1 shader for this material.
  function resolve(kind, v1key, levelName) {
    var lo = levelName && levelOverrides[levelName];
    if (lo && lo[kind] && lo[kind][v1key]) return lo[kind][v1key];
    return remap[v1key] || null;
  }

  function validate() {
    var errs = [], k, m, i, j;
    function col(key, where) { if (!P.colors[key]) errs.push(where + ': unknown color "' + key + '"'); }
    function setOk(key, where) { if (!sets[key]) errs.push(where + ': unknown set "' + key + '"'); }
    function ascii(str, where) {
      for (var q = 0; q < str.length; q++) { var cc = str.charCodeAt(q); if (cc < 32 || cc > 126) errs.push(where + ': non-ASCII'); }
    }
    for (k in sets) {
      var S = sets[k];
      if (S.orient) {
        S.dark.forEach(function (x, n) { ascii(x, 'sets.' + k + '.dark' + n); });
        ['h', 'v', 'd1', 'd2'].forEach(function (f) {
          if (!S.fam[f] || S.fam[f].length !== S.fam.h.length) errs.push('sets.' + k + '.fam.' + f + ' length');
          else S.fam[f].forEach(function (x, n) { ascii(x, 'sets.' + k + '.' + f + n); });
        });
      } else {
        for (i = 0; i < S.length; i++) { if (!S[i].length) errs.push('sets.' + k + '[' + i + '] empty'); ascii(S[i], 'sets.' + k + '[' + i + ']'); }
      }
    }
    for (k in materials) {
      m = materials[k];
      for (i = 0; i < m.tones.length; i++) col(m.tones[i][0], k + '.tones');
      setOk(m.face.set, k + '.face.set');
      if (m.face.mid) setOk(m.face.mid, k + '.face.mid');
      if (m.face.far) setOk(m.face.far, k + '.face.far');
      if (m.grid && m.grid.tint) col(m.grid.tint, k + '.grid.tint');
      if (m.grid && m.grid.kind === 'gap') setOk(m.grid.set, k + '.grid.set');
      if (m.band) { setOk(m.band.set, k + '.band.set'); if (m.band.tone) col(m.band.tone, k + '.band.tone'); }
      if (m.overlay) { setOk(m.overlay.set, k + '.overlay.set'); for (j = 0; j < m.overlay.tints.length; j++) col(m.overlay.tints[j], k + '.overlay'); }
      if (m.speckle) setOk(m.speckle.set, k + '.speckle.set');
      if (m.v1 && !P.materials[m.v1]) errs.push(k + '.v1: unknown v1 material ' + m.v1);
    }
    col(fog.color, 'fog.color'); col(fog.glyph, 'fog.glyph'); setOk(fog.set, 'fog.set');
    for (k in edges.rules) ascii(edges.rules[k].glyph, 'edges.' + k);
    for (k in remap) if (!materials[remap[k]]) errs.push('remap.' + k);
    return errs;
  }

  ASSETS.detailPass = {
    version: '2-proposed',
    status: 'PROPOSAL - not loaded by the game; see design/detail-pass.md',
    shading: shading, faceShade: faceShade, ao: ao, fog: fog, edges: edges, lodGates: lodGates,
    sets: sets, materials: materials, remap: remap, levelOverrides: levelOverrides,
    util: {
      shade: shade, edgePass: edgePass, resolve: resolve, validate: validate,
      hash: hash, level: level, orientClass: orientClass, lineGlyph: lineGlyph, crossLine: crossLine,
      fogFactor: fogFactor, pickTone: pickTone, ALL_ON: ALL_ON
    }
  };
  if (typeof module === 'object' && module && module.exports) module.exports = ASSETS.detailPass;
})(typeof window !== 'undefined' ? window : globalThis);
