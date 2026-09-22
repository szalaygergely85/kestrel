/*
 * ASCII Quest - US-015 title logo, subtitle, and UI text styling (hints, prompts, crosshair, end text, pause).
 * Format: design/README.md section 4 (sprite models) + section 5 (UI styles).
 * Sets ASSETS.models.title, ASSETS.models.subtitle, ASSETS.uiStyle. All UI text is ASCII 32-126.
 * UI art is drawn at full palette color (emissive: not lit, not fogged); fades use the glyph-ramp rule below.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // ---- block font, 6 rows (Q has a 7th tail row) ----
  var FONT = {
    A: [' #### ', '##  ##', '##  ##', '######', '##  ##', '##  ##'],
    S: [' #####', '##    ', ' #### ', '    ##', '    ##', '##### '],
    C: [' #####', '##    ', '##    ', '##    ', '##    ', ' #####'],
    I: ['####', ' ## ', ' ## ', ' ## ', ' ## ', '####'],
    Q: [' #### ', '##  ##', '##  ##', '##  ##', '## ###', ' #####', '     \\'],
    U: ['##  ##', '##  ##', '##  ##', '##  ##', '##  ##', ' #### '],
    E: ['######', '##    ', '##### ', '##    ', '##    ', '######'],
    T: ['######', '  ##  ', '  ##  ', '  ##  ', '  ##  ', '  ##  ']
  };
  var TEXT = 'ASCII QUEST', GAP = 1, WORD = 3, W = 68, H = 8;
  var ROWKEY = ['a', 'b', 'b', 'c', 'd', 'e'];       // gold-white top -> gold -> flame mid -> outer -> ember bottom

  var G = [], K = [], x, y, i;
  for (y = 0; y < H; y++) { G.push(new Array(W + 1).join(' ').split('')); K.push(new Array(W + 1).join(' ').split('')); }
  var cx = 0;
  for (i = 0; i < TEXT.length; i++) {
    var ch = TEXT.charAt(i);
    if (ch === ' ') { cx += WORD - GAP; continue; }
    var L = FONT[ch], lw = L[0].length;
    for (y = 0; y < L.length; y++) for (x = 0; x < lw; x++) {
      var g = L[y].charAt(x); if (g === ' ') continue;
      G[y][cx + x] = g;
      K[y][cx + x] = y < 6 ? ROWKEY[y] : 'e';          // Q tail in ember
    }
    cx += lw + GAP;
  }
  // drop shadow: one cell right + down, only onto empty cells
  for (y = H - 2; y >= 0; y--) for (x = W - 2; x >= 0; x--) {
    if (G[y][x] === '#' && G[y + 1][x + 1] === ' ') { G[y + 1][x + 1] = ':'; K[y + 1][x + 1] = 's'; }
  }
  // flourish under the logo (row 7), centred
  var FL = '-----====<[ * ]>====-----';   // '-' brassDark, '=' brass, brackets brassLight, '*' flame core
  var fx = Math.floor((cx - GAP - FL.length) / 2);
  for (i = 0; i < FL.length; i++) {
    var fg = FL.charAt(i);
    G[7][fx + i] = fg; K[7][fx + i] = fg === ' ' ? ' ' : (fg === '*' ? 'f' : fg === '-' ? 'D' : fg === '=' ? 'B' : 'L');
  }
  var glyphs = G.map(function (r) { return r.join(''); }), fgRows = K.map(function (r) { return r.join(''); });

  A.models.title = {
    name: 'title',
    desc: 'ASCII QUEST logo, 68x8 (max 70x9). Warm gold into ember orange, ember drop shadow, brass flourish.',
    size: { w: W, h: H }, anchor: { x: 34, y: 7 },
    ui: true,
    keys: {
      a: { c: 'flameCore', e: true }, b: { c: 'gold', e: true }, c: { c: 'flameMid', e: true },
      d: { c: 'flameOuter', e: true }, e: { c: 'ember', e: true }, s: { c: 'emberDark', e: true },
      D: { c: 'brassDark', e: true }, B: { c: 'brass', e: true }, L: { c: 'brassLight', e: true }, f: { c: 'flameCore', e: true }
    },
    animations: { show: { fps: 1, loop: true, frames: [{ S: { glyphs: glyphs, fg: fgRows } }] } },
    // "alive" during the 3 s hold: a diagonal shine band sweeps left -> right once per 2.2 s
    shine: { period: 2.2, width: 3, slope: 2, color: 'white', amount: 0.55,
             rule: 'cell lit if 0 <= (x - slope*y - pos) < width, pos sweeps -16 .. w+16; fg = lerp(fg, white, amount); only on "#" cells' },
    layout: { grid: { w: 160, h: 60 }, top: 18, centerX: 80 }
  };

  // ---- subtitle "The Awakening", letter-spaced, brass brackets ----
  var ST = 'T h e   A w a k e n i n g', SUB = '-=[  ' + ST + '  ]=-';
  var SK = 'DBL  ' + ST.replace(/[^ ]/g, 't') + '  LBD';
  A.models.subtitle = {
    name: 'subtitle',
    desc: 'Subtitle under the logo: letter-spaced, warm off-white, brass bracket ends.',
    size: { w: SUB.length, h: 1 }, anchor: { x: Math.floor(SUB.length / 2), y: 0 },
    ui: true,
    keys: { t: { c: 'uiText', e: true }, D: { c: 'brassDark', e: true }, B: { c: 'brass', e: true }, L: { c: 'brassLight', e: true } },
    animations: { show: { fps: 1, loop: true, frames: [{ S: { glyphs: [SUB], fg: [SK] } }] } },
    layout: { belowTitle: 1 }        // rows between the logo's last row and the subtitle
  };

  // ---- UI text styling (US-005 / US-012 / US-015 / US-017) ----
  A.uiStyle = {
    // Fade rule for every UI element (title card, hints, end text): glyphs dim DOWN the ramp, not by alpha.
    // At fade level a (0..1): glyph g with density index i in ramps.default becomes ramps.default[round(a*i)]
    // (letters/digits count as index 9), fg = fg * (0.25 + 0.75*a); a = 0 -> nothing drawn.
    fade: { ramp: 'default', letterIndex: 9, minGain: 0.25 },
    titleCard: { fadeIn: 1.0, hold: 3.0, fadeOut: 1.0 },

    hint: {
      anchor: 'bottom-left', x: 2, yFromBottom: 2, stackUp: true, lineGap: 1,
      prefix: '> ', prefixColor: 'uiDim', text: 'uiHint', key: 'gold',
      plate: { pad: 1, bgMul: 0.35, note: 'cells under and 1 around the text: scene bg multiplied by 0.35 (a soft dark plate, no box drawing)' },
      fadeIn: 0.3, fadeOut: 0.5, timeout: 8.0
    },
    hints: [
      { id: 'move', text: 'WASD move - Mouse look', keys: ['WASD', 'Mouse'], when: 'after the title card' },
      { id: 'run', text: 'Shift run', keys: ['Shift'], when: 'after 10 s of walking' },
      { id: 'jump', text: '[Space] Jump', keys: ['[Space]'], when: 'within 2 m of the gap edge (level marker gapEdge)' },
      { id: 'capture', text: 'Click to capture mouse', keys: ['Click'], when: 'pointer not locked' }
    ],

    crosshair: { glyph: '+', idle: 'uiDim', active: 'gold', note: 'screen centre; no plate' },
    prompt: { rowsBelowCrosshair: 2, align: 'center', key: 'gold', text: 'uiText', plate: { pad: 1, bgMul: 0.35 },
              examples: ['[E] Take lantern', '[E] Pull lever', '[E] Light the beacon'] },

    endText: {
      align: 'center', top: 24, lineGap: 1, cps: 30, text: 'uiText', dim: 'uiHint', key: 'gold', cursor: { glyph: '_', blinkHz: 2 },
      lines: [
        { text: 'The beacons are dark.', alt: 'One beacon burns. The others are dark.', color: 'uiText' },
        { text: 'The world waits.', color: 'uiText' },
        { text: '- to be continued -', color: 'uiHint', delay: 1.5 },
        { text: '[R] Wake again', color: 'uiText', keys: ['[R]'] }
      ]
    },
    pause: { text: 'Click to resume', color: 'uiText', align: 'center', row: 30, plate: { pad: 2, bgMul: 0.3 } },

    // wake sequence eyelid look (US-015 programmer AC: rows open from the centre line outward)
    blink: { edgeGlyph: '-', edgeColor: 'emberDark', edgeRows: 1,
             curve: [[0, 0], [0.6, 0.6], [0.9, 0.25], [1.5, 1.0]],
             note: 'curve = [time s, open fraction]; rows with |row - centre| > open*centre are black; the row just inside the lid gets edgeGlyph in edgeColor at 50%' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
