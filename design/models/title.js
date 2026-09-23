/*
 * Kestrel - US-015 / US-017 title logo, subtitle, map card (Crown sky-chart) and UI text styling
 * (hints, story hints, prompts, crosshair, end text, pause). D-011 reskin (v1.9): was "ASCII QUEST / The Awakening".
 * Format: design/README.md section 4 (sprite models) + section 5 (UI styles).
 * Sets ASSETS.models.title, ASSETS.models.subtitle, ASSETS.models.mapCard, ASSETS.uiStyle. All UI text is ASCII 32-126.
 * UI art is drawn at full palette color (emissive: not lit, not fogged); fades use the glyph-ramp rule below.
 * All layout numbers are in the fixed 160x60 UI grid (uiStyle.uiGrid); the UI is a scaled text layer over the
 * scene grid (uiStyle.uiScale), so text keeps its pixel size at 240x90 and 320x120 (D-009 amendment).
 * Text source: docs/story.md section 5 (writer).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // ---- block font, 6 rows ----
  var FONT = {
    K: ['##  ##', '## ## ', '####  ', '####  ', '## ## ', '##  ##'],
    E: ['######', '##    ', '##### ', '##    ', '##    ', '######'],
    S: [' #####', '##    ', ' #### ', '    ##', '    ##', '##### '],
    T: ['######', '  ##  ', '  ##  ', '  ##  ', '  ##  ', '  ##  '],
    R: ['##### ', '##  ##', '##### ', '## ## ', '##  ##', '##  ##'],
    L: ['##    ', '##    ', '##    ', '##    ', '##    ', '######']
  };
  var TEXT = 'KESTREL', GAP = 1, H = 8;
  // Row colours: the airship's brass name board, bright top step -> brass -> copper at the foot (a = top).
  var ROWKEY = ['a', 'b', 'c', 'c', 'd', 'e'];

  // width = letters + gaps + 1 column for the drop shadow
  var W = 0, i, x, y;
  for (i = 0; i < TEXT.length; i++) W += FONT[TEXT.charAt(i)][0].length + (i ? GAP : 0);
  W += 1;
  function blank(w) { return new Array(w + 1).join(' ').split(''); }
  var G = [], K = [];
  for (y = 0; y < H; y++) { G.push(blank(W)); K.push(blank(W)); }
  var cx = 0;
  for (i = 0; i < TEXT.length; i++) {
    var L = FONT[TEXT.charAt(i)], lw = L[0].length;
    for (y = 0; y < L.length; y++) for (x = 0; x < lw; x++) {
      var g = L[y].charAt(x); if (g === ' ') continue;
      G[y][cx + x] = g; K[y][cx + x] = ROWKEY[y];
    }
    cx += lw + GAP;
  }
  // drop shadow: one cell right + down, only onto empty cells
  for (y = H - 3; y >= 0; y--) for (x = W - 2; x >= 0; x--) {
    if (G[y][x] === '#' && G[y + 1][x + 1] === ' ') { G[y + 1][x + 1] = ':'; K[y + 1][x + 1] = 's'; }
  }
  // Row 7 flourish: brass ends + the SOS signal ( 3 short, 3 long, 3 short ) in aether teal, centred.
  // Each mark ('.' or '-') gets its own key char '0'..'8' so the pulse animation can light them in order.
  var FL = '=-=-o  . . . - - - . . .  o-=-=';
  var fx = Math.floor((W - 1 - FL.length) / 2), mark = 0, MARKS = [];
  for (i = 0; i < FL.length; i++) {
    var fc = FL.charAt(i), kx = fx + i, kk;
    if (fc === ' ') continue;
    if ((fc === '.' || fc === '-') && i > 5 && i < FL.length - 5) { kk = String(mark); MARKS.push({ x: kx, kind: fc === '.' ? 'short' : 'long' }); mark++; }
    else kk = fc === 'o' ? 'L' : fc === '=' ? 'B' : 'D';
    G[7][kx] = fc; K[7][kx] = kk;
  }
  var glyphs = G.map(function (r) { return r.join(''); }), fgBase = K.map(function (r) { return r.join(''); });

  // Pulse frames: frame n (0..8) lights mark n (aetherCore), the others sit at aetherDim; frame 9 = all dim (rest).
  // Keys 'p' = lit mark, 'q' = dim mark. Durations: short 180 ms, long 480 ms, rest 1200 ms (3 short 3 long 3 short).
  var SOS_MS = { short: 180, long: 480, rest: 1200 };
  function pulseFrame(n) {
    var fg = fgBase.map(function (r) { return r.replace(/[0-8]/g, function (d) { return +d === n ? 'p' : 'q'; }); });
    return { S: { glyphs: glyphs, fg: fg } };
  }
  var tFrames = [], tDur = [];
  for (i = 0; i < 9; i++) { tFrames.push(pulseFrame(i)); tDur.push(SOS_MS[MARKS[i].kind]); }
  tFrames.push(pulseFrame(-1)); tDur.push(SOS_MS.rest);

  A.models.title = {
    name: 'title',
    desc: 'KESTREL logo (the airship name board, D-011): brass block letters, bright brass top into copper at the foot, ' +
          'brass-shadow drop shadow, a brass flourish carrying the SOS signal in aether teal (the one magic colour on the card).',
    size: { w: W, h: H }, anchor: { x: Math.floor(W / 2), y: H - 1 },
    ui: true,
    keys: {
      a: { c: 'brassHot', e: true }, b: { c: 'brassLight', e: true }, c: { c: 'brass', e: true },
      d: { c: 'copperLight', e: true }, e: { c: 'copper', e: true }, s: { c: 'brassShadow', e: true },
      D: { c: 'brassDark', e: true }, B: { c: 'brass', e: true }, L: { c: 'brassLight', e: true },
      p: { c: 'aetherCore', e: true }, q: { c: 'aetherDim', e: true }
    },
    // 'show' loops the SOS pulse (10 frames, durations in ms). Frame 9 (all marks dim) is the calm state for fades.
    animations: { show: { loop: true, durations: tDur, frames: tFrames } },
    signal: { marks: MARKS, row: 7, pattern: '3 short, 3 long, 3 short', ms: SOS_MS,
              note: 'same pattern the P2 signal-tower pulse uses (story.md proposal 2)' },
    // "alive" during the 3 s hold: a diagonal shine band sweeps left -> right once per 2.2 s
    shine: { period: 2.2, width: 3, slope: 2, color: 'white', amount: 0.55,
             rule: 'cell lit if 0 <= (x - slope*y - pos) < width, pos sweeps -16 .. w+16; fg = lerp(fg, white, amount); only on "#" cells' },
    layout: { grid: { w: 160, h: 60 }, top: 18, centerX: 80 }   // UI-grid cells (uiStyle.uiGrid), not scene cells
  };

  // ---- subtitle "SOMEONE IS CALLING" (story.md 5), letter-spaced, brass bracket ends ----
  var ST = 'S O M E O N E   I S   C A L L I N G', SUB = '-=[  ' + ST + '  ]=-';
  var SK = 'DBL  ' + ST.replace(/[^ ]/g, 't') + '  LBD';
  A.models.subtitle = {
    name: 'subtitle',
    desc: 'Subtitle under the logo: SOMEONE IS CALLING, letter-spaced, warm off-white, brass bracket ends.',
    size: { w: SUB.length, h: 1 }, anchor: { x: Math.floor(SUB.length / 2), y: 0 },
    ui: true,
    keys: { t: { c: 'uiText', e: true }, D: { c: 'brassDark', e: true }, B: { c: 'brass', e: true }, L: { c: 'brassLight', e: true } },
    animations: { show: { fps: 1, loop: true, frames: [{ S: { glyphs: [SUB], fg: [SK] } }] } },
    layout: { belowTitle: 1 }        // rows between the logo's last row and the subtitle
  };

  // ---- US-015 map card: the Crown sky-chart with Wick's pencil (story.md 5, text VERBATIM) ----
  var MAP = [
    '      CROWN SKY-CHART  -  your pencil',
    '  FERRUM [#]                          * SIGNAL',
    '   (wall)   \\                        /',
    '             x HOLLOW TOWER --o---o---o',
    '               (you are here)   old relays',
    '  Crown print: "BEYOND THE WALL: NOTHING"',
    '  Your pencil: "Then who is blinking?"',
    '  Your pencil: "Follow the old towers."',
    '        - any key -'
  ];
  // Colour spans per line: [substring, key, {char: key} overrides inside the span]. Everything else = line default.
  //   e chartEdge  c chartInk (Crown print)  p pencil  h uiHint (labels)  t uiText  f ferrum  F ferrumDim
  //   S signal star (pulses)  s aether (SIGNAL word)  x gold (you are here)  r aetherDim (dead relays)  d uiDim
  var SPANS = [
    { def: 'p', spans: [['CROWN SKY-CHART', 'c'], ['  -  ', 'd']] },   // the separator dash, not the one in SKY-CHART
    { def: 'p', spans: [['FERRUM', 'f'], ['[#]', 'F', { '#': 'f' }], ['*', 'S'], ['SIGNAL', 's']] },
    { def: 'p', spans: [['(wall)', 'c']] },
    { def: 'p', spans: [['x', 'x'], ['HOLLOW TOWER', 't'], ['--o---o---o', 'p', { o: 'r' }]] },
    { def: 'p', spans: [] },
    { def: 'c', spans: [['Crown print:', 'h']] },
    { def: 'p', spans: [['Your pencil:', 'h']] },
    { def: 'p', spans: [['Your pencil:', 'h']] },
    { def: 'd', spans: [] }
  ];
  var IW = 0; MAP.forEach(function (l) { if (l.length > IW) IW = l.length; });
  var MW = IW + 6, MH = MAP.length + 4;           // border + 2 margin cols each side; border + 1 blank row top and bottom
  function padTo(s, w) { while (s.length < w) s += ' '; return s.slice(0, w); }
  function colourLine(line, spec) {
    var k = line.replace(/[^ ]/g, spec.def).split('');
    spec.spans.forEach(function (sp) {
      var at = line.indexOf(sp[0]); if (at < 0) return;
      for (var j = 0; j < sp[0].length; j++) {
        var ch = sp[0].charAt(j); if (ch === ' ') continue;
        k[at + j] = (sp[2] && sp[2][ch]) || sp[1];
      }
    });
    return k.join('');
  }
  // torn chart edge: irregular top / bottom, alternating | : sides (deterministic pattern, no randomness)
  function edgeRow(top) {
    var s = '', k = '', j;
    for (j = 0; j < MW; j++) {
      var c = j === 0 || j === MW - 1 ? (top ? '.' : "'") : '-~--~---~-~--'.charAt(j % 13);
      s += c; k += 'e';
    }
    return { g: s, k: k };
  }
  var mg = [], mk = [], er = edgeRow(true);
  mg.push(er.g); mk.push(er.k);
  function body(line, keys, n) {
    var side = n % 3 === 1 ? ':' : '|';
    mg.push(side + '  ' + padTo(line, IW) + '  ' + side);
    mk.push('e  ' + padTo(keys, IW) + '  e');
  }
  body('', '', 0);
  MAP.forEach(function (l, n) { body(l, colourLine(l, SPANS[n]), n + 1); });
  body('', '', MAP.length + 1);
  er = edgeRow(false); mg.push(er.g); mk.push(er.k);
  // star pulse: 'S' lit (aetherCore) / 'Z' dim (aetherDim) in the SOS rhythm: on/off pairs
  var starOn = mk, starOff = mk.map(function (r) { return r.replace(/S/g, 'Z'); });
  var mFrames = [], mDur = [], P9 = ['short', 'short', 'short', 'long', 'long', 'long', 'short', 'short', 'short'];
  P9.forEach(function (kind) {
    mFrames.push({ S: { glyphs: mg, fg: starOn } }); mDur.push(SOS_MS[kind]);
    mFrames.push({ S: { glyphs: mg, fg: starOff } }); mDur.push(150);
  });
  mDur[mDur.length - 1] = SOS_MS.rest;

  A.models.mapCard = {
    name: 'mapCard',
    desc: 'US-015 map card (D-011): the Crown sky-chart with Wick\'s pencil course. Crown print in faded red, pencil in warm ' +
          'grey, Ferrum amber, the SIGNAL star pulsing SOS in aether teal, dead relays dim teal, "you are here" x in gold.',
    size: { w: MW, h: MH }, anchor: { x: Math.floor(MW / 2), y: 0 },   // anchor = top-centre (UI card, placed by layout.top)
    ui: true,
    keys: {
      e: { c: 'chartEdge', e: true }, c: { c: 'chartInk', e: true }, p: { c: 'pencil', e: true }, h: { c: 'uiHint', e: true },
      t: { c: 'uiText', e: true }, f: { c: 'ferrum', e: true }, F: { c: 'ferrumDim', e: true },
      S: { c: 'aetherCore', e: true }, Z: { c: 'aetherDim', e: true }, s: { c: 'aether', e: true },
      x: { c: 'gold', e: true }, r: { c: 'aetherDim', e: true }, d: { c: 'uiDim', e: true }
    },
    text: MAP,                                            // the verbatim story.md lines (for tests / localisation)
    animations: { show: { loop: true, durations: mDur, frames: mFrames } },
    layout: { top: Math.floor((60 - MH) / 2), centerX: 80 }   // UI-grid cells
  };

  // ---- UI text styling (US-005 / US-012 / US-015 / US-017) ----
  A.uiStyle = {
    // ---- UI grid + scale (D-009 amendment: scene grid 160x60 / 240x90 / 320x120) ----
    // Every layout number in uiStyle and in title.layout / subtitle.layout / mapCard.layout is in the fixed
    // 160x60 UI GRID, never in scene cells. The UI is a separate text layer over the scene; its cell = screen / 160x60,
    // so one UI glyph covers cellScale x cellScale scene cells (2.0 at 320x120, 1.5 at 240x90, 1.0 at 160x60) and text
    // stays 12x18 px at 1920x1080 on every grid. A scene-cell UI at 320x120 would be 6x9 px: not readable.
    uiGrid: { cols: 160, rows: 60 },
    uiScale: {
      mode: 'layer',                                   // 'layer' = separate text layer at uiGrid (recommended); 'cells' = 1 scene cell per glyph (CPU 160x60 only)
      rule: 'cellScale = sceneCols / uiGrid.cols; the layer is drawn after the scene, transparent bg, glyph + fg only',
      plate: 'a plate on UI cells [ux, ux+w) x [uy, uy+h) darkens SCENE cells floor(ux*s) .. ceil((ux+w)*s)-1 (same for rows), s = cellScale; the plate stays in the scene pass so it gets fogged/lit with the picture',
      blink: 'the eyelid mask (blink) is a SCENE effect: it stays in scene rows, never on the UI layer',
      crosshair: 'centre of the UI grid (80, 30); the prompt is measured in UI rows below it',
      minGlyphPx: { w: 8, h: 12 },                     // below this the text is not readable; layer mode never goes below 12x18 at 1920x1080
      fallback: 'if the presenter cannot draw a second layer, use mode "cells" and multiply every layout number by s (rounded), keeping glyphs 1 cell: only acceptable at 160x60'
    },
    // Fade rule for every UI element (title card, hints, map card, end text): glyphs dim DOWN the ramp, not by alpha.
    // At fade level a (0..1): glyph g with density index i in ramps.default becomes ramps.default[round(a*i)]
    // (letters/digits count as index 9), fg = fg * (0.25 + 0.75*a); a = 0 -> nothing drawn.
    fade: { ramp: 'default', letterIndex: 9, minGain: 0.25 },
    titleCard: { fadeIn: 1.0, hold: 3.0, fadeOut: 1.0, pulse: 'title.animations.show loops during the hold; fades use frame 9 (all marks dim)' },

    // ---- US-015 map card (D-011 scope change): static overlay, shown once after the title card, M re-opens ----
    mapCard: {
      model: 'mapCard',
      showOnce: 'after the title card fades out (before the first hint)',
      dismiss: 'any key or click', reopenKey: 'M', closeKeys: 'any key (M included)',
      fadeIn: 0.4, fadeOut: 0.25,
      plate: { pad: 1, bgMul: 0.18, note: 'scene cells under the card (+1) multiplied by 0.18: a dark sheet, the 3D view still ghosts through' },
      input: 'PO call: suggested = movement / look ignored while the card is open; the world keeps running (burner, relay)',
      afterFirstClose: 'show story hint "chart" (Press M to read the chart.)',
      rows: 'mapCard.size.h UI rows, centred: layout.top / layout.centerX'
    },

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
    // story.md 5 narrative hints (writer). Same hint style; `when` is a suggestion for the PO.
    storyHints: [
      { id: 'burner', text: 'The burner still glows. Take what light you can.', keys: [], when: 'after the map card closes the first time' },
      { id: 'climb', text: 'Climb. You cannot see the signal from down here.', keys: [], when: 'lamp taken, first step onto the stair' },
      { id: 'chart', text: 'Press M to read the chart.', keys: ['M'], when: 'right after the first map card closes' }
    ],

    crosshair: { glyph: '+', idle: 'uiDim', active: 'gold', note: 'screen centre; no plate' },
    prompt: { rowsBelowCrosshair: 2, align: 'center', key: 'gold', text: 'uiText', plate: { pad: 1, bgMul: 0.35 },
              examples: ['[E] Take lamp', '[E] Pull lever', '[E] Wake the relay'] },

    // US-017: D-011 asks for NEW end-card text; story.md has none yet (writer). Old lines kept as placeholders.
    endText: {
      align: 'center', top: 24, lineGap: 1, cps: 30, text: 'uiText', dim: 'uiHint', key: 'gold', cursor: { glyph: '_', blinkHz: 2 },
      placeholder: true,
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
