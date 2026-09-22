/*
 * ASCII Quest - US-016 far overworld seen from the summit breach (design data v1)
 * Owner: Designer. Companion: design/levels/overworld_far.md. Preview: design/preview/overworld.html
 * Plain script: sets ASSETS.levels.overworld_far.
 *
 * UNITS / FRAME: metres. x grows EAST, y grows SOUTH (same axes as design/levels/tower.js),
 * z = metres relative to the tower ground floor (level z). far = level + origin.
 * The recipe is deterministic (seeded hash noise). util.generate() is the REFERENCE generator:
 * the engine may bake it once at load (256x256 = 65k cells, a few ms) or port it; results must match.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.levels = A.levels || {};

  var DEF = {
    name: 'overworld_far',
    version: 1,
    map: { w: 256, h: 256, cell: 8 },                 // 2048 m x 2048 m
    origin: { x: 1480, y: 1018 },                     // level (0,0) -> far (1480, 1018)
    seed: 7331,

    // key positions (far coordinates)
    tower:  { x: 1496.5, y: 1024.5, note: 'our Hollow Watchtower centre (level 16.5, 6.5)' },
    breach: { x: 1486.5, y: 1025.0, z: 7.6, yaw: 270, note: 'eye at the breach: level (6.5, 7.0), walkway 6.0 + eye 1.6, looking W' },

    // ---- terrain recipe (all heights in m) ----
    recipe: {
      home:    { top: 2.4, drop: 70, radius: 300, note: 'our hilltop: 2.4 m at the tower (matches the level\'s outside grass), falls ~70 m away' },
      hill2:   { height: 58, radius: 170, note: 'hill under the far tower (centred on farTower)' },
      rolling: { scale: 520, octaves: 5, gain: 0.5, lacunarity: 2, amp: 34, flatNearHome: 150, flatNearTower2: 120,
                 note: 'fbm rolling hills, faded out on both hilltops so the towers sit on clean crowns' },
      river:   { base: 1120, a1: 110, p1: 260, a2: 45, p2: 95, ph2: 1.3, halfWidth: 10, carve: 2.0,
                 note: 'centre line x_r(y) = base + a1*sin(y/p1) + a2*sin(y/p2 + ph2): meanders N-S through the valley ~450 m west' },
      valley:  { depth: 22, width: 160, note: 'extra carve around the river: -depth * exp(-((x - x_r)/width)^2)' },
      ridge:   { height: 30, x0: 700, x1: 150, scale: 300, note: 'far western hills: + height * smoothstep(x0 -> x1) * (0.6 + 0.4*fbm), stay below the horizon from the breach' },
      path:    { halfWidth: 3.0, points: [[1480, 1025], [1420, 1032], [1350, 1050], [1260, 1045], [1180, 1062], [1090, 1070], [1000, 1066]],
                 note: 'dirt path from the outcrop down the hill to a ford over the river: the way out' },
      forest:  { scale: 280, octaves: 3, threshold: 0.55, maxSlope: 0.5, riverClear: 30, pathClear: 12, homeClear: 110, canopy: 10,
                 note: 'forest where fbm > threshold on gentle ground, away from river, path and our bare hilltop; drawn 10 m taller (canopy)' },
      rock:    { slope: 0.42, scale: 90, threshold: 0.78, minHomeDist: 60, note: 'rock on steep ground or as crags where fbm > threshold' }
    },

    // ---- per-type look (colors = palette keys dark / mid / light; glyphs by distance band) ----
    bands: { near: 150, mid: 600 },                   // m: < near = near set, < mid = mid set, else far set
    terrain: {
      grass:  { id: 0, colors: ['grassDark', 'grass', 'grassLight'], glyphs: { near: '"\',;', mid: ",'.", far: '.,' }, albedo: 0.85 },
      forest: { id: 1, colors: ['forestDark', 'forest', 'grassDark'], glyphs: { near: '&%@', mid: '%&', far: '%:' }, albedo: 0.70 },
      water:  { id: 2, colors: ['river', 'river', 'riverLight'], glyphs: { near: '~-', mid: '~-', far: '-~' }, albedo: 0.90,
                glint: { hz: 1.5, amount: 0.35, note: 'animated: glyph toggles ~/- and fg lerps toward riverLight on a moving hash' } },
      rock:   { id: 3, colors: ['stoneDark', 'rock', 'stoneLight'], glyphs: { near: '#%', mid: '%#', far: '%' }, albedo: 0.80 },
      path:   { id: 4, colors: ['strawDark', 'strawDark', 'straw'], glyphs: { near: '.:', mid: '.', far: '.' }, albedo: 0.70 }
    },
    lighting: {
      ambient: 'palette timeOfDay ambient', sun: 'level sun (elev 60, from ESE): the breach looks W, so the view is front-lit',
      rule: 'b = ambientI + sunI * max(0, N.L), N from the height grid (central differences); color index = b < 0.45 ? 0 : b < 0.8 ? 1 : 2 ' +
            '(then +-1 by a per-cell hash for variation); fg = rgb * (fgMin + (1-fgMin)*min(b,1)^fgGamma); bg = fg * 0.3'
    },
    fog: {
      preset: 'far',                                    // palette fog.far: start 50 m, full 1500 m, curve 0.7
      rule: 'f = util.fogFactor(dist, "far"); fogColor = lerp(fogFarNear, fogFar, f); fg = lerp(fg, fogColor, f); ' +
            'bg = lerp(bg, fogColor, min(1, f*1.1)); glyph = " " when f > 0.85 (pure haze). Out of map = horizon haze.',
      horizonIs: 'fogFar = skyHorizon, so terrain melts into the sky with no seam'
    },

    // ---- the distant second beacon tower: dark, cold, no light ----
    farTower: {
      x: 713.8, y: 1232.1, azimuthFromBreach: 255, distance: 800,
      baseZ: -8, height: 42, width: 14,
      color: 'farTower', lit: false, emissive: false, fogMax: 0.40,
      note: 'Readability over realism: fog on the tower is capped at 0.40 so it stays a clearly DARK notch against the pale horizon. ' +
            'Drawn as a billboard at its world size, never smaller than sprite.min (3x4 cells). US-022 does not change it.',
      sprite: {
        min:    { glyphs: ['n n', '|#|', '|#|', '/#\\'], fg: ['ttt', 'ttt', 'ttt', 'ttt'] },
        detail: { glyphs: [' n_n ', ' |#| ', ' |#| ', ' |:| ', ' |#| ', ' |#| ', ' /#\\ ', '/###\\'],
                  fg:     [' ttt ', ' ttt ', ' ttt ', ' tkt ', ' ttt ', ' ttt ', ' ttt ', 'ttttt'] },
        keys: { t: { c: 'farTower' }, k: { c: 'black' } }
      }
    },

    // ---- how the far pass should sample it (US-016 programmer; D-002 heightmap projection) ----
    render: {
      nearStart: 8, maxDist: 2000, step0: 0.5, stepGrow: 0.015,
      note: 'Per screen column: march distance z from nearStart, z += step0 + stepGrow*z (~260 samples to 2 km), sample height ' +
            '(bilinear) + canopy, project row = horizonRow - (h - eyeZ) / z * focalRows, fill from the lowest drawn row upward ' +
            '(y-buffer). Uses the SAME horizonRow and focalRows as the sector raycaster, so the horizons match at every pitch. ' +
            'Draw only where the sector pass left "sky"/out-of-map cells. Budget <= 4 ms.'
    }
  };

  // ---------------- reference generator ----------------
  function hash(ix, iy, s) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct, gain, lac) {
    var sum = 0, amp = 1, norm = 0;
    for (var i = 0; i < oct; i++) { sum += amp * vnoise(x, y, s + i * 101); norm += amp; amp *= gain; x *= lac; y *= lac; }
    return sum / norm;                                  // 0..1
  }
  function smooth(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function riverX(R, y) { return R.base + R.a1 * Math.sin(y / R.p1) + R.a2 * Math.sin(y / R.p2 + R.ph2); }
  function segDist(px, py, pts) {
    var best = 1e9;
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1], dx = bx - ax, dy = by - ay;
      var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy); t = t < 0 ? 0 : t > 1 ? 1 : t;
      var qx = ax + dx * t - px, qy = ay + dy * t - py, d = Math.sqrt(qx * qx + qy * qy);
      if (d < best) best = d;
    }
    return best;
  }

  function generate() {
    var D = DEF, R = D.recipe, W = D.map.w, H = D.map.h, C = D.map.cell, s = D.seed;
    var height = new Float32Array(W * H), type = new Uint8Array(W * H), riverD = new Float32Array(W * H), pathD = new Float32Array(W * H);
    var T = D.tower, T2 = D.farTower, i, j;
    for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
      var x = (i + 0.5) * C, y = (j + 0.5) * C, k = i + j * W;
      var d0 = Math.hypot(x - T.x, y - T.y), dt = Math.hypot(x - T2.x, y - T2.y);
      var home = R.home.top - R.home.drop * (1 - Math.exp(-Math.pow(d0 / R.home.radius, 2)));
      var hill2 = R.hill2.height * Math.exp(-Math.pow(dt / R.hill2.radius, 2));
      var roll = (fbm(x / R.rolling.scale, y / R.rolling.scale, s, R.rolling.octaves, R.rolling.gain, R.rolling.lacunarity) - 0.5) * R.rolling.amp *
                 (1 - Math.exp(-Math.pow(dt / R.rolling.flatNearTower2, 2))) * (1 - Math.exp(-Math.pow(d0 / R.rolling.flatNearHome, 2)));
      var dr = Math.abs(x - riverX(R.river, y));
      var valley = -R.valley.depth * Math.exp(-Math.pow(dr / R.valley.width, 2));
      var ridge = R.ridge.height * smooth(R.ridge.x0, R.ridge.x1, x) * (0.6 + 0.4 * fbm(x / R.ridge.scale, y / R.ridge.scale, s + 7, 3, 0.5, 2));
      var h = home + hill2 + roll + valley + ridge, t = 0;
      var pd = segDist(x, y, R.path.points);
      if (dr < R.river.halfWidth) { t = 2; h -= R.river.carve; }
      else if (pd < R.path.halfWidth) t = 4;
      height[k] = h; type[k] = t; riverD[k] = dr; pathD[k] = pd;
    }
    // second pass: slope -> rock / forest
    for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
      var kk = i + j * W; if (type[kk] !== 0) continue;
      var hx = (height[Math.min(W - 1, i + 1) + j * W] - height[Math.max(0, i - 1) + j * W]) / (2 * C);
      var hy = (height[i + Math.min(H - 1, j + 1) * W] - height[i + Math.max(0, j - 1) * W]) / (2 * C);
      var slope = Math.sqrt(hx * hx + hy * hy), xx = (i + 0.5) * C, yy = (j + 0.5) * C;
      var dh = Math.hypot(xx - T.x, yy - T.y), F = R.forest, K = R.rock;
      if (slope > K.slope || (dh > K.minHomeDist && fbm(xx / K.scale, yy / K.scale, s + 29, 2, 0.5, 2) > K.threshold)) type[kk] = 3;
      else if (fbm(xx / F.scale + 17, yy / F.scale - 9, s + 13, F.octaves, 0.5, 2) > F.threshold && slope < F.maxSlope &&
               riverD[kk] > F.riverClear && pathD[kk] > F.pathClear && dh > F.homeClear) type[kk] = 1;
    }
    return { w: W, h: H, cell: C, height: height, type: type, TYPES: ['grass', 'forest', 'water', 'rock', 'path'] };
  }
  function heightAt(G, x, y) {        // bilinear, metres; out of map -> null
    var fx = x / G.cell - 0.5, fy = y / G.cell - 0.5, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= G.w - 1 || j >= G.h - 1) return null;
    var u = fx - i, v = fy - j, W = G.w, H0 = G.height;
    var a = H0[i + j * W], b = H0[i + 1 + j * W], c = H0[i + (j + 1) * W], d = H0[i + 1 + (j + 1) * W];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  DEF.util = { generate: generate, heightAt: heightAt, hash: hash, fbm: fbm, riverX: function (y) { return riverX(DEF.recipe.river, y); } };
  A.levels.overworld_far = DEF;
})(typeof window !== 'undefined' ? window : globalThis);
