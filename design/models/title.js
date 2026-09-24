/*
 * Kestrel - US-015 / US-017 title logo, subtitle, map card (Crown sky-chart) and UI text styling
 * (hints, story hints, prompts, crosshair, end text, pause). D-011 reskin (v1.9): was "ASCII QUEST / The Awakening".
 * Format: design/README.md section 4 (sprite models) + section 5 (UI styles).
 * Sets ASSETS.models.title, ASSETS.models.subtitle, ASSETS.models.mapCard, ASSETS.uiStyle and ASSETS.levelPatch.towerHints
 * (the US-015 hint zones for tower.js). All UI text is ASCII 32-126.
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
  // Line 8 is the "W." signature (D-013, PO CR 2026-09-23): pencil, right-aligned under the two `Your pencil:` notes
  // (ends in the same column as the longer note). It is the only place the hero's initial appears in M1.
  var SIG = '- W.', NOTE2 = '  Your pencil: "Follow the old towers."';
  var SIG_LINE = new Array(NOTE2.length - SIG.length + 1).join(' ') + SIG;
  var MAP = [
    '      CROWN SKY-CHART  -  your pencil',
    '  FERRUM [#]                          * SIGNAL',
    '   (wall)   \\                        /',
    '             x HOLLOW TOWER --o---o---o',
    '               (you are here)   old relays',
    '  Crown print: "BEYOND THE WALL: NOTHING"',
    '  Your pencil: "Then who is blinking?"',
    NOTE2,
    SIG_LINE,
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
    { def: 'p', spans: [] },                                            // "- W." signature, all pencil
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
    text: MAP,                                            // the verbatim story.md lines + the "- W." signature line (for tests / localisation)
    signature: { line: MAP.indexOf(SIG_LINE), text: SIG, align: 'right', under: 'the two "Your pencil:" notes', key: 'p',
                 note: 'D-013: the notes are signed "W."; the hero name appears nowhere else in M1' },
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
    // `sec` = the US-017 end fade duration (3D view + sprites, 1 -> 0); game/js/quest/end.js readEndTimings reads uiStyle.fade.sec.
    fade: { ramp: 'default', letterIndex: 9, minGain: 0.25, sec: 2.0 },
    titleCard: { fadeIn: 1.0, hold: 3.0, fadeOut: 1.0, pulse: 'title.animations.show loops during the hold; fades use frame 9 (all marks dim)' },

    // ---- US-015 map card (D-011 scope change): generic engine/ui "panel" overlay (model + style + dim), opened from game/ ----
    // Numbers per the US-015 programmer ACs; fadeIn/fadeOut are the PO-accepted card values (CR 2026-09-23).
    mapCard: {
      model: 'mapCard',
      showOnce: { after: 'titleCard fade-out', delaySec: 0.5, stateKey: 'ui.mapCard.shown',
                  note: 'first show only; restart (US-017 deserialize) resets the state key, so it shows again after the wake' },
      fadeIn: 0.4, fadeOut: 0.25,                       // ramp-step fade rule (uiStyle.fade)
      minShowSec: 1.0,                                  // first show: no dismiss before 1.0 s on screen
      dismiss: { first: 'any key or mouse click after minShowSec', consumeKey: true,
                 note: 'the dismissing key/click is consumed: it does not also move, jump or interact' },
      reopenKey: 'M',                                   // the binding lives in game/, not in the engine
      reopen: { from: 'first dismissal', until: 'end trigger (quest.endT >= 0)', never: ['wake', 'titleCard', 'end sequence', 'end screen'],
                toggle: true, timeout: null, closeKeys: 'M, Esc or any other key', stateKey: 'ui.mapCard.opened',
                note: 'no minShowSec on re-open; stateKey is set true the first time M opens the card (the chart hint reads it)' },
      sceneDim: { bgMul: 0.35, note: 'the whole scene behind the card: bg (and fg) x 0.35 while the card is up (fades with the card)' },
      plate: { pad: 1, bgMul: 0.18, note: 'scene cells under the card (+1) multiplied by 0.18 instead of the 0.35 dim: a dark sheet, the 3D view still ghosts through' },
      input: 'movement and look input ignored while open; the world keeps animating (burner flicker); pointer lock kept; physics not paused',
      afterFirstClose: ['hint "move" starts (hints[0])', 'story hint "chart" 20 s timer starts (storyHints chart.on)'],
      rows: 'mapCard.size.h UI rows, centred: layout.top / layout.centerX'
    },

    // Standard hint rules (US-015): bottom-left, ONE hint on screen at a time, later hints wait in a FIFO queue.
    hint: {
      anchor: 'bottom-left', x: 2, yFromBottom: 2, maxOnScreen: 1, queue: 'fifo', lineGap: 1,
      prefix: '> ', prefixColor: 'uiDim', text: 'uiHint', key: 'gold',
      plate: { pad: 1, bgMul: 0.35, note: 'cells under and 1 around the text: scene bg multiplied by 0.35 (a soft dark plate, no box drawing)' },
      fadeIn: 0.3, fadeOut: 0.5, timeout: 8.0,
      doneRule: 'a hint disappears when its action is performed (doneOn) or after timeout; a hint whose action was already performed is never shown',
      stateKey: 'hints.shown (world_m1 state array of hint ids, so restart resets them)'
    },
    hints: [
      { id: 'move', text: 'WASD move - Mouse look', keys: ['WASD', 'Mouse'], when: 'after the first map-card dismissal (not after the title)',
        on: { type: 'event', event: 'mapCard.firstDismiss' }, doneOn: 'move or look input' },
      { id: 'run', text: 'Shift run', keys: ['Shift'], when: 'after 10 s of walking', on: { type: 'walkTime', sec: 10 }, doneOn: 'run input' },
      { id: 'jump', text: '[Space] Jump', keys: ['[Space]'], when: 'on entering hintJump (tower.js triggers, r 2 m round markers.gapEdge, zMin 2.0)',
        on: { type: 'zone', zone: 'hintJump' }, doneOn: 'jump input' },
      { id: 'capture', text: 'Click to capture mouse', keys: ['Click'], when: 'pointer not locked', on: { type: 'pointerUnlocked' }, doneOn: 'pointer locked' }
    ],
    // story.md 5 narrative hints (writer), same hint style. `when` = the US-015 programmer AC wording; `on` = the same rule as data.
    // Zones: levelPatch.towerHints below (append to tower.js triggers[]). `skipIfState`: never shown if that world.state key is true.
    storyHints: [
      { id: 'burner', text: 'The burner still glows. Take what light you can.', keys: [],
        when: 'once, on entering hintBurner while the lamp is not taken',
        on: { type: 'zone', zone: 'hintBurner', skipIfState: 'tower.lantern.taken' }, doneOn: 'lantern.take (lamp taken)' },
      { id: 'climb', text: 'Climb. You cannot see the signal from down here.', keys: [],
        when: 'once, on entering hintClimb',
        on: { type: 'zone', zone: 'hintClimb' }, doneOn: 'timeout only' },
      { id: 'chart', text: 'Press M to read the chart.', keys: ['M'],
        when: 'once, 20 s after the first map-card dismissal; never if M was already pressed; removed when M is pressed',
        on: { type: 'timer', after: 'mapCard.firstDismiss', sec: 20, skipIfState: 'ui.mapCard.opened' }, doneOn: 'M pressed' },
      // BUG-OWN-005 (PO row 25j / Fable sprint-1 review item 4): two more one-time story hints so the M1 ending
      // reads as a deliberate exit, not a respawn - (a) the grate opens 1.5 s after the lever pull and can be out
      // of view, so a hint calls it out at the moment of the pull (game/js/quest/lever.js calls hints.request
      // directly - the interaction itself is the trigger, no zone needed); (b) first stepping onto the summit
      // tells the player the way out ends the chapter, before they reach the breach (tower.js hintExit zone).
      { id: 'grate', text: 'Something rattles above.', keys: [],
        when: 'once, right when the lever is pulled', on: { type: 'event', event: 'lever.pull' }, doneOn: 'timeout only' },
      { id: 'exit', text: 'Out there. Step through the breach.', keys: [],
        when: 'once, on first entering the summit (z >= 6.0), before the breach',
        on: { type: 'zone', zone: 'hintExit' }, doneOn: 'timeout only' }
    ],

    crosshair: { glyph: '+', idle: 'uiDim', active: 'gold', note: 'screen centre; no plate' },
    prompt: { rowsBelowCrosshair: 2, align: 'center', key: 'gold', text: 'uiText', plate: { pad: 1, bgMul: 0.35 },
              examples: ['[E] Take lamp', '[E] Pull lever', '[E] Wake the relay'] },

    // US-017 end card (re-check AC moved into US-015). Everything game/js/ui/endCard.js + game/js/quest/end.js hard-code today:
    // strings (incl. the woken variant), colours, cursor, layout rows and the walk / gap / cps timings (fade: uiStyle.fade.sec).
    // Timeline (endT = world.state['quest.endT'] s): walk 0..walkSec, scene fade walkSec..walkSec+fade.sec, then the `typed`
    // lines type on at cps one after the other; gapSec after the last typed char, `continue` and `restart` appear together,
    // the cursor blinks after `[R] Wake again`, and R restarts only from then on.
    endText: {
      align: 'center', walkSec: 1.5, gapSec: 1.5, cps: 30,
      text: 'uiText', dim: 'uiHint', key: 'gold',
      cursor: { glyph: '_', color: 'uiText', periodSec: 1.0, duty: 0.5, line: 'restart',
                note: 'drawn right after the restart line text, visible for the first half of each 1 s period (= endCard.js floor(endT*2)%2)' },
      placeholder: false,
      source: 'D-011 PO text from the US-017 ACs (the lines endCard.js ships), rewritten by the BUG-OWN-005 PO ' +
              'decision (docs/backlog.md row 25j, 2026-09-24): "continue"/"restart" no longer read like a respawn ' +
              '("wake again"). docs/story.md has no end-card section yet; if the writer adds one, only these strings change',
      // row = UI-grid row (160x60, uiStyle.uiGrid). BUG-OWN-005 adds one row ("thanks") between continue and restart.
      lines: [
        { id: 'signal', row: 29, typed: true, color: 'uiText',
          text: 'The signal is still calling.',
          alt: 'One relay wakes. The signal is still calling.', altWhen: 'tower.beacon.lit',
          note: 'first line depends on the relay state (D-003, D-011); default and without US-022 = text' },
        { id: 'someone', row: 30, typed: true, color: 'uiText', text: 'Someone is out there.' },
        { id: 'continue', row: 32, typed: false, color: 'uiHint', text: '- End of Chapter One: The Tower -', afterGap: true },
        { id: 'thanks', row: 33, typed: false, color: 'uiDim', text: 'Thank you for playing.', afterGap: true },
        { id: 'restart', row: 35, typed: false, color: 'uiText', text: '[R] Play again from the wreck', keys: ['[R]'],
          afterGap: true, cursor: true, enablesRestart: true }
      ]
    },
    pause: { text: 'Click to resume', color: 'uiText', align: 'center', row: 30, plate: { pad: 2, bgMul: 0.3 } },

    // wake sequence eyelid look (US-015 programmer AC: rows open from the centre line outward)
    blink: { edgeGlyph: '-', edgeColor: 'emberDark', edgeRows: 1,
             curve: [[0, 0], [0.6, 0.6], [0.9, 0.25], [1.5, 1.0]],
             note: 'curve = [time s, open fraction]; rows with |row - centre| > open*centre are black; the row just inside the lid gets edgeGlyph in edgeColor at 50%' }
  };

  // ---- US-015 hint zones: the story-hint part of the tower levelPatch (PO CR 2026-09-23 item 2) ----
  // Kept here, not in models/wreckage.js levelPatch.tower, because wreckage.js and levels/tower.js are in the US-011
  // pass right now. Same rule as levelPatch.tower: NO runtime applier (architecture.md 7.5); the US-015 programmer
  // appends `triggers.append` to design/levels/tower.js `triggers[]` by hand, after the existing `hintJump`.
  // Coordinates are tower-local metres (engine/world/triggers.js adds the structure origin), same shape as hintJump.
  A.levelPatch = A.levelPatch || {};
  A.levelPatch.towerHints = {
    story: 'US-015', target: 'levels.tower.triggers', op: 'append',
    triggers: { append: [
      { id: 'hintBurner', type: 'hint', hint: 'burner', shape: 'circle', x: 18.5, y: 6.5, r: 3.0, once: true, trigger: 'hint.show',
        note: 'r 3 m round the Kestrel burner (props.brazier / lights.brazier at 18.5, 6.5). The wake spot (17.0, 9.5) is 3.35 m ' +
              'away, so it fires on the first steps toward the warm light, not while lying down; the lamp bracket (19.9, 6.5) is inside. ' +
              'The hint is skipped if tower.lantern.taken (uiStyle.storyHints burner.on.skipIfState)' },
      { id: 'hintClimb', type: 'hint', hint: 'climb', shape: 'circle', x: 15.3, y: 3.3, r: 1.5, once: true, trigger: 'hint.show',
        note: 'r 1.5 m on the stair base cell s (15, 3), tag stairBase; centre 0.2 m NW of the cell centre so the circle stays clear of ' +
              'hintBurner (4.53 m apart > 3.0 + 1.5), i.e. the two story hints can never fire from one step. Covers the base, step 1 and the top of the slope apron. ' +
              'It can fire while the boulder still sits on the base (the hint then reads as "get past this"); no zMin, all ground level' },
      // BUG-OWN-005 (PO row 25j, 2026-09-24): centred on markers.breach (6.5, 7.0, z 6.0), r 6.0 covers both the
      // doorway 'd' (11, 7) - 5.02 m away - and the whole summit walkway ring, so it fires the moment the player's
      // feet reach summit height (zMin) anywhere on the approach, well before the breach itself.
      { id: 'hintExit', type: 'hint', hint: 'exit', shape: 'circle', x: 6.5, y: 7.0, r: 6.0, zMin: 5.9, once: true, trigger: 'hint.show',
        note: 'fires on first entering the summit (z >= 5.9, just under the 6.0 summit floorH), before the breach' }
    ] },
    checks: 'design/preview/title.html "Hint zones" (loads levels/tower.js read-only): ids unique vs tower.js triggers, centres on the ' +
            'burner / stairBase cells, spawn outside hintBurner, lamp inside, the two circles do not overlap'
  };
})(typeof window !== 'undefined' ? window : globalThis);
