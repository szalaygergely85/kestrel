/*
 * Kestrel - cloth presets + reference cloth blocks (CLOTH-1b4, docs/architecture.md 33.5 / 33.6).
 * Owner: Designer. Format: design/README.md section 9. Preview: design/preview/cloth.html (runs the REAL engine
 * cloth system, engine/world/cloths.js + engine/physics/cloth.js, with these presets).
 *
 * LOADING (classic script, no dependency; game/index.html after palette.js / detail-pass.js):
 *   <script src="../design/cloth.js"></script>
 *   World.load reads `assets.clothPresets` (engine/world/cloths.js): main.js must hand `window.ASSETS.clothPresets`
 *   to the asset object World.load receives (the AssetRegistry has no getter for it yet - 1b5 / main session).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.clothPresets.<key>   NUMBERS ONLY, merged per key OVER the engine defaults (DEFAULT_CLOTH_PRESETS in
 *                               engine/world/cloths.js) at load. Keys = the three the engine knows: silk, canvas,
 *                               banner. Fields = createCloth sim keys (33.2): substeps, shearCompliance,
 *                               bendCompliance, damping, gravity, drag, lift, flutter, maxSpeed, thickness.
 *   ASSETS.clothLooks.<key>     reference `cloths` content blocks (33.5 JSON shape) for the content step (1b5) and the
 *                               preview: preset + mat + grid + size + pins + the FRAY / TEAR hole pattern, with the
 *                               placement notes. origin / yawDeg / colliders are preview values: 1b5 sets the real
 *                               ones in the level (local frame). Hand-copied, never read by the engine.
 *   Materials (mat keys)        live in palette.js (v1) + detail-pass.js (v2), same key in both:
 *                               cloth.canvas, cloth.banner, cloth.flag, cloth.linen. Glyph sets clothFace / bannerFace.
 *
 * LOOK RULES (style-guide 7d)
 *   - The fold is drawn by LIGHT: smooth per-vertex normals (33.5) make a lit crest and a dark valley on every fold;
 *     the material's glyph set walks `. ' ~ - ) ( = %` with that brightness, so folds read as `)~(` ridges over
 *     `.'` troughs. No glyph-by-slope op (a new detail-shader op would be ASK ARCHITECT; not needed).
 *   - Pattern = world-anchored on the CLOTH (uv = rest-space metres), so stripes / gores / pales bend with the folds:
 *     that is what sells "cloth" at 160x60. Every cloth has one: canvas gores, banner pales, flag stripes, linen weave.
 *   - Fray / tear = HOLES (removed quads, 33.1 item 5) along the free edges: a ragged hem never a straight cut, plus a
 *     soot / stain overlay on the canvas and banner.
 *   - Motion: canvas billows (low bend stiffness, more lift), banner swings heavy and slow (more damping, less lift,
 *     still enough drag to flutter in the ambient wind), silk snaps and ripples (high drag + lift + flutter).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};

  // XPBD compliances: bigger = softer (alpha in m/N). damping 1/s (keep >= 2: the 1a settle / rest ACs were measured
  // at 2.5; below ~1.5 the cloth swings > 6 s). drag / lift = accelerations per m/s of relative wind (1/s).
  A.clothPresets = {
    // big light canvas (the torn balloon envelope in the stairwell): billows, rolls, slow travelling wave
    canvas: { substeps: 4, shearCompliance: 1e-6, bendCompliance: 2e-4, damping: 2.2, drag: 1.4, lift: 0.30, flutter: 0.30, thickness: 0.03 },
    // heavy wool banner on a ruin: weighty swing, soft deep folds, keeps fluttering at the hem in a 2-4 m/s breeze
    banner: { substeps: 4, shearCompliance: 1e-7, bendCompliance: 6e-4, damping: 2.6, drag: 1.1, lift: 0.18, flutter: 0.30, thickness: 0.03 },
    // silk flag / pennant: fast ripples running to the fly end, snaps in gusts
    silk:   { substeps: 4, shearCompliance: 1e-6, bendCompliance: 5e-4, damping: 2.0, drag: 1.6, lift: 0.40, flutter: 0.40, thickness: 0.02 }
  };

  // Reference blocks. pins / holes are [col, row]; holes are QUADS (col < cols-1, row < rows-1).
  function topRow(cols, every) {
    var p = [], c;
    for (c = 0; c < cols; c += every) p.push([c, 0]);
    if (p[p.length - 1][0] !== cols - 1) p.push([cols - 1, 0]);
    return p;
  }
  function leftCol(rows) { var p = [], r; for (r = 0; r < rows; r++) p.push([0, r]); return p; }

  A.clothLooks = {
    // 1b5 #1: the torn balloon canvas in the tower stairwell, hung from the broken spar at 3 points, its lower-right
    // corner torn away, a rip through the middle and a ragged hem (16 x 12 = 192 nodes, 2.4 x 1.8 m, 15 cm spacing).
    stairwellCanvas: {
      id: 'stairwell.canvas', preset: 'canvas', mat: 'cloth.canvas', cols: 16, rows: 12, size: [2.4, 1.8],
      plane: 'vertical', pins: [[0, 0], [6, 0], [15, 0]], seed: 7, castShadow: true, sleepDist: 40,
      holes: [
        [7, 5], [7, 6], [8, 6], [8, 7],                                 // the rip (a short diagonal slit, centre-right)
        [14, 7], [13, 8], [14, 8], [12, 9], [13, 9], [14, 9],          // the torn-away lower-right corner
        [11, 10], [12, 10], [13, 10], [14, 10],
        [0, 10], [3, 10], [4, 10], [8, 10]                              // ragged hem
      ],
      note: 'Pins on the spar / breach edge. The hem must clear the stair treads (or add a stair floor box >= 0.2 m, ' +
            '33.5 amendment: World.groundAt is terrain-only). Wall box behind the sheet (>= 0.2 m thick). The first pin ' +
            'is the wind anchor: put it on the breach side so the breach wind is sampled there.'
    },
    // 1b5 #2: the ruin banner (woad + three ochre pales, swallowtail hem), 12 x 16 = 192 nodes, 1.1 x 2.2 m.
    ruinBanner: {
      id: 'ruin.banner', preset: 'banner', mat: 'cloth.banner', cols: 12, rows: 16, size: [1.1, 2.2],
      plane: 'vertical', pins: topRow(12, 2), seed: 11, castShadow: true, sleepDist: 40,
      holes: [
        [4, 14], [5, 14], [6, 14], [5, 13],                             // swallowtail notch
        [0, 14], [10, 14], [2, 14], [8, 14]                             // frayed tips
      ],
      note: 'Width MUST stay 1.1 m (pales at u 0 / 0.5 / 1.0, 0.1 m wide = both edges + the centre). Pinned along a pole ' +
            'sleeve at the top; wall box right behind it (0.2+ m thick, its front face 0.05-0.1 m behind the cloth).'
    },
    // spare: a silk flag on a pole (pinned down the hoist), 14 x 9 = 126 nodes, 1.2 x 0.8 m (stripes at v 0 / .36 / .72)
    watchFlag: {
      id: 'watch.flag', preset: 'silk', mat: 'cloth.flag', cols: 14, rows: 9, size: [1.2, 0.8],
      plane: 'vertical', pins: leftCol(9), seed: 5, castShadow: true, sleepDist: 60,
      holes: [[12, 1], [12, 4], [11, 7], [12, 7]],                     // tattered fly end
      note: 'Height MUST stay 0.8 m (3 stripes). Hoist = col 0 on the pole; the fly flies free.'
    },
    // spare: a linen doorway curtain the player walks through, 10 x 14 = 140 nodes, 1.0 x 2.0 m
    doorCurtain: {
      id: 'door.curtain', preset: 'canvas', mat: 'cloth.linen', cols: 10, rows: 14, size: [1.0, 2.0],
      plane: 'vertical', pins: topRow(10, 1), seed: 3, castShadow: true, sleepDist: 30,
      holes: [[2, 12], [7, 12]],
      note: 'Hang 0.1 m above the floor; the player capsule (setBody) parts it. Jamb boxes either side.'
    }
  };

  // Self-check (preview). [] = OK.
  A.clothLooks.validate = function (palette, detailPass) {
    var errs = [], k, L, i;
    var simKeys = { substeps: 1, shearCompliance: 1, bendCompliance: 1, damping: 1, gravity: 1, drag: 1, lift: 1, flutter: 1, maxSpeed: 1, thickness: 1 };
    for (k in A.clothPresets) {
      for (i in A.clothPresets[k]) {
        if (!simKeys[i]) errs.push('clothPresets.' + k + '.' + i + ': not a cloth sim key');
        if (typeof A.clothPresets[k][i] !== 'number') errs.push('clothPresets.' + k + '.' + i + ': numbers only');
      }
    }
    for (k in A.clothLooks) {
      L = A.clothLooks[k];
      if (typeof L !== 'object' || !L.cols) continue;
      if (!A.clothPresets[L.preset]) errs.push(k + ': unknown preset ' + L.preset);
      if (palette && !palette.materials[L.mat]) errs.push(k + ': mat ' + L.mat + ' missing in palette.materials');
      if (detailPass && !detailPass.materials[L.mat]) errs.push(k + ': mat ' + L.mat + ' missing in detailPass.materials');
      if (L.cols * L.rows > 384 || L.cols > 24 || L.rows > 16) errs.push(k + ': grid over 24 x 16');
      for (i = 0; i < L.holes.length; i++) {
        if (L.holes[i][0] >= L.cols - 1 || L.holes[i][1] >= L.rows - 1) errs.push(k + ': hole ' + L.holes[i] + ' outside the quad grid');
      }
    }
    return errs;
  };
  if (typeof module === 'object' && module && module.exports) module.exports = { clothPresets: A.clothPresets, clothLooks: A.clothLooks };
})(typeof window !== 'undefined' ? window : globalThis);
