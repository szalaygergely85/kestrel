/*
 * ASCII Quest - US-011 brazier (7x9) + shared flame unit + US-022 beacon fire (12x4)
 * Format: design/README.md section 4 (sprite models). Plain script: sets ASSETS.models.brazier / .beaconFire.
 *
 * The flame is authored ONCE as a 5x4 "flame unit" (6 frames, 10 fps), each cell with a heat level
 * 1..4 (tip red -> outer orange -> mid yellow-orange -> core yellow-white). All flame cells are EMISSIVE.
 * The brazier uses the unit directly; the beacon fire tiles 3 units across 12 columns with phase
 * offsets (max-heat compositing), so the big fire is literally the brazier flame frames scaled out (D-003).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // ---- flame unit 5x4 : g = glyphs, h = heat (' ' = empty) ----
  var FLAME = [
    { g: ["  '  ", " '^. ", " ^*^ ", "^***^"], h: ["  1  ", " 121 ", " 232 ", "23432"] },
    { g: [" .   ", " ^'  ", "^*^. ", "^***^"], h: [" 1   ", " 21  ", "2321 ", "23432"] },
    { g: ["  ^  ", " '*' ", " ^*^ ", "^*^*^"], h: ["  1  ", " 121 ", " 343 ", "23432"] },
    { g: ["   . ", "  '^ ", " .^*^", "^***^"], h: ["   1 ", "  12 ", " 1232", "23432"] },
    { g: ["     ", " . ' ", "'^*^'", "^***^"], h: ["     ", " 1 1 ", "12321", "23432"] },
    { g: [" '  .", " ^ ^ ", "^*^*'", "*^*^*"], h: [" 1  1", " 2 2 ", "23231", "34343"] }
  ];
  // half-scale flame unit 3x2 (for the half LOD)
  var FLAME_HALF = [
    { g: [" ' ", "^*^"], h: [" 1 ", "232"] },
    { g: ["'  ", "^*^"], h: ["1  ", "232"] },
    { g: [" ^ ", "***"], h: [" 1 ", "343"] },
    { g: ["  '", "^*^"], h: ["  1", "232"] },
    { g: ["   ", "'*'"], h: ["   ", "131"] },
    { g: ["' '", "^*^"], h: ["1 1", "232"] }
  ];

  var FLAME_KEYS = {
    '1': { c: 'flameTip', e: true },
    '2': { c: 'flameOuter', e: true },
    '3': { c: 'flameMid', e: true },
    '4': { c: 'flameCore', e: true }
  };
  function keys(extra) { var k, o = {}; for (k in FLAME_KEYS) o[k] = FLAME_KEYS[k]; for (k in extra) o[k] = extra[k]; return o; }

  // ---- brazier body (rows 4..8), coals flicker between two states ----
  var BODY_G = [null, ' \\===/ ', '  |H|  ', '  /|\\  ', ' /_|_\\ '];
  var BODY_C = [null, ' diiid ', '  iIi  ', '  idi  ', ' idIdi '];
  var COALS = [{ g: '\\#*#*#/', c: 'iEeEeEi' }, { g: '\\*#*#*/', c: 'ieEeEei' }];
  var N_FULL = ['.......', '.......', '.......', '.......', 'luuuuur', ' lfffr ', '  lfr  ', '  lfr  ', ' lfffr '];

  function brazierFrame(f) {
    var u = FLAME[f], coal = COALS[f % 2], g = [], c = [], r;
    for (r = 0; r < 4; r++) { g.push(' ' + u.g[r] + ' '); c.push(' ' + u.h[r] + ' '); }
    g.push(coal.g); c.push(coal.c);
    for (r = 1; r < 5; r++) { g.push(BODY_G[r]); c.push(BODY_C[r]); }
    return { S: { glyphs: g, fg: c, n: N_FULL } };
  }
  function brazierHalf(f) {
    var u = FLAME_HALF[f], coal = f % 2 ? { g: '\\#*#/', c: 'iEeEi' } : { g: '\\*#*/', c: 'ieEei' };
    return { S: {
      glyphs: [' ' + u.g[0] + ' ', ' ' + u.g[1] + ' ', coal.g, ' \\=/ ', ' /|\\ '],
      fg:     [' ' + u.h[0] + ' ', ' ' + u.h[1] + ' ', coal.c, ' did ', ' idi '],
      n:      ['.....', '.....', 'luuur', ' lfr ', ' lfr ']
    } };
  }
  var full = [], half = [], i;
  for (i = 0; i < 6; i++) { full.push(brazierFrame(i)); half.push(brazierHalf(i)); }

  A.models.brazier = {
    name: 'brazier',
    desc: 'Iron brazier on the stone ring (the ring is sector geometry). Burning; the torch light source.',
    size: { w: 7, h: 9 }, anchor: { x: 3, y: 8 }, world: { w: 0.9, h: 1.4 },
    directions: ['S'], billboard: true,
    keys: keys({
      i: { c: 'iron' }, I: { c: 'ironLight' }, d: { c: 'ironDark' },
      e: { c: 'ember', e: true }, E: { c: 'emberDark', e: true }
    }),
    light: { preset: 'torch', offset: { x: 0, y: 0, z: 0.7 }, note: 'point light 0.7 m above the anchor (ring top 0.5 -> z 1.2)' },
    animations: {
      burn: { fps: 10, loop: true, frames: full }
    },
    lods: {
      half: { size: { w: 5, h: 5 }, anchor: { x: 2, y: 4 }, animations: { burn: { fps: 10, loop: true, frames: half } } }
    },
    flameUnit: { size: { w: 5, h: 4 }, frames: FLAME, half: FLAME_HALF, keys: FLAME_KEYS,
                 note: 'shared by brazier and beaconFire; heat 1..4 = color key, all emissive' }
  };

  // ---- US-022 beacon fire: 12x4, composed from the flame unit ----
  // Tiles: unit placed at column x with a frame phase offset; 'mirror' flips it horizontally.
  // Compositing: per cell, the HIGHER heat wins (glyph and color from that tile).
  var TILES = [{ x: 0, phase: 0, mirror: false }, { x: 4, phase: 3, mirror: true }, { x: 7, phase: 1, mirror: false }];
  var TILES_HALF = [{ x: 0, phase: 0, mirror: false }, { x: 3, phase: 2, mirror: true }];
  function compose(units, tiles, w, h, f) {
    var G = [], H = [], r, c, t;
    for (r = 0; r < h; r++) { G.push(new Array(w + 1).join(' ').split('')); H.push(new Array(w + 1).join(' ').split('')); }
    for (t = 0; t < tiles.length; t++) {
      var T = tiles[t], u = units[(f + T.phase) % units.length], uw = u.g[0].length;
      for (r = 0; r < h; r++) for (c = 0; c < uw; c++) {
        var sc = T.mirror ? uw - 1 - c : c, hc = u.h[r].charAt(sc), x = T.x + c;
        if (hc === ' ' || x >= w) continue;
        if (H[r][x] === ' ' || +hc > +H[r][x]) { H[r][x] = hc; G[r][x] = u.g[r].charAt(sc); }
      }
    }
    return { S: { glyphs: G.map(function (a) { return a.join(''); }), fg: H.map(function (a) { return a.join(''); }) } };
  }
  var bf = [], bfh = [];
  for (i = 0; i < 6; i++) { bf.push(compose(FLAME, TILES, 12, 4, i)); bfh.push(compose(FLAME_HALF, TILES_HALF, 6, 2, i)); }

  A.models.beaconFire = {
    name: 'beaconFire',
    desc: 'US-022 beacon fire on the 12x4 bowl, built from the brazier flame unit (3 tiles, phases 0/3/1, middle mirrored).',
    size: { w: 12, h: 4 }, anchor: { x: 6, y: 3 }, world: { w: 2.2, h: 1.2 },
    directions: ['S'], billboard: true,
    keys: FLAME_KEYS,
    mountOn: { model: 'beaconBowl', mount: 'fire' },
    tiles: TILES,
    // grow-in (0 -> 1 over 1.0 s): at growth g, a cell at rowFromBottom r (0 = bottom) with heat h is shown
    // only if r < ceil(g * 4); its heat is reduced by round((1 - g) * 2) and hidden if that drops below 1.
    grow: { duration: 1.0, rule: 'rowFromBottom < ceil(g*h); heat -= round((1-g)*2); hide if heat < 1' },
    animations: { burn: { fps: 10, loop: true, frames: bf } },
    lods: { half: { size: { w: 6, h: 2 }, anchor: { x: 3, y: 1 }, animations: { burn: { fps: 10, loop: true, frames: bfh } } } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
