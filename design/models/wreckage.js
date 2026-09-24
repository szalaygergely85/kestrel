/*
 * Kestrel - the wreck of the Kestrel (D-011, US-010 / US-011 reskin): the airship Wick stole, shot down by the
 * wall-ballistae, crashed through the tower's broken crown.
 * Format: design/README.md section 4 (+ 4.2). Plain script. Sets:
 *   ASSETS.models.gondola        brass gondola with the KESTREL name board, snapped rigging (sways)      34x9  (half 17x5)
 *   ASSETS.models.envelopeDrape  torn canvas hanging from a beam (stairwell), sways, burnt tear         10x8  (half 5x4)
 *   ASSETS.models.envelopeHeap   crumpled envelope on the ground (seen from the summit, snagged below)   14x4  (half 7x2)
 *   ASSETS.models.burner         the Kestrel's copper burner: flame + embers, brass gauge (@)           13x11 (half 7x6)
 *                                (replaces the iron `brazier` in the level; same `burn` anim name, same torch light)
 *   ASSETS.models.rigging        a coil of rope and a snapped line on the floor                          14x4  (half 7x2)
 *   ASSETS.models.canvasHeap     the wake spot: crumpled envelope canvas                                  20x4  (half 10x2)
 *   ASSETS.models.rope           2 hanging snapped stays (variants)                                       3x16  (half 3x8)
 *   ASSETS.models.strut          bent brass gondola strut                                                 12x4  (half 6x2)
 *   ASSETS.levelPatch.tower      PROPOSED edits to design/levels/tower.js (not applied: US-010 is in review)
 *
 * ART-OWN-001 (owner walk test: "can't identify ground objects"): the old art (2-6 rows) was drawn 3-6x enlarged at
 * the real view distance (nearest sampling), so glyphs became blocks of repeats and the props read as wall/floor
 * texture. Every ground prop is now authored near its real on-screen size at 2-5 m (scale ~1-2.5 at 160x60): clear
 * outer contour glyphs (light top edge, dark base), quiet plate interiors, one or two identifying details
 * (KESTREL board, gauge, eyelet, knot). World sizes (metres) and anchors-as-placement-points are unchanged.
 *
 * BUG-OWN-003 (architecture.md 7.7, engine support pending): models carry `fill` (solid plate behind each cell) and,
 * for small ground props, `outline` (1-cell dark rim). Authoring: a '`' or '$' in a source row is an OPAQUE SPACE
 * (glyph ' ' + a real key -> a solid plate once `fill` lands; a hole with today's cutout rule). Keys with
 * `fill: false` (ropes, flame tips) stay glyph-only.
 *
 * Colour rule (D-011): brass / copper only on the machine; canvas + rope are the wreck's soft parts; max 3 hue
 * families per prop (gondola = brass + wood/rope + ash debris; burner = copper/brass + fire).
 * All fg rows are generated from the glyph rows by a glyph -> key map (`paint`), so glyph and colour rows can never
 * drift out of line; `n` (normal) rows are generated the same way (`autoN`).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  function pad(s, w) { while (s.length < w) s += ' '; return s.slice(0, w); }
  // glyph rows -> fg rows. map: glyph -> key (default); rowMaps[r]: glyph -> key for that row; letters -> map.letter
  function paint(g, map, rowMaps) {
    return g.map(function (row, r) {
      var o = '', c, ch, m = (rowMaps && rowMaps[r]) || {};
      for (c = 0; c < row.length; c++) {
        ch = row.charAt(c);
        if (ch === ' ') { o += ' '; continue; }
        o += m[ch] || map[ch] || (/[A-Z]/.test(ch) && (m.letter || map.letter)) || map.other;
      }
      return o;
    });
  }
  // normals: first cell l, last cell r, rows in `up` -> u, rows in `down` -> d, else f; '.' for empty / flat rows
  function autoN(g, up, down, flat) {
    return g.map(function (row, r) {
      var o = '', first = -1, last = -1, c;
      for (c = 0; c < row.length; c++) if (row.charAt(c) !== ' ') { if (first < 0) first = c; last = c; }
      for (c = 0; c < row.length; c++) {
        if (row.charAt(c) === ' ' || (flat && flat.indexOf(r) >= 0)) { o += '.'; continue; }
        o += (up && up.indexOf(r) >= 0) ? 'u' : (down && down.indexOf(r) >= 0) ? 'd' : c === first ? 'l' : c === last ? 'r' : 'f';
      }
      return o;
    });
  }
  // opaque-space placeholders ('`', '$') -> glyph ' ' (their key comes from the map, see the header)
  function glyphsOf(g) { return g.map(function (r) { return r.replace(/[`$]/g, ' '); }); }
  function frame(g, map, rowMaps, n) { return { S: { glyphs: glyphsOf(g), fg: paint(g, map, rowMaps), n: n } }; }
  function fix(rows, w) { return rows.map(function (r) { return pad(r, w); }); }
  // a row of width w with strings placed at columns: mk(34, [[2, 'o'], [3, '====']])
  function mk(w, parts) {
    var a = new Array(w + 1).join(' ').split('');
    parts.forEach(function (p) { for (var i = 0; i < p[1].length; i++) a[p[0] + i] = p[1].charAt(i); });
    return a.join('');
  }
  function rep(ch, n) { return new Array(n + 1).join(ch); }

  // =====================================================================================================
  // GONDOLA 34x9 (ART-OWN-001, was 18x6): snapped stays (rows 0-1, sway), bright brass rail with posts (row 2), the
  // dark inside of the basket seen between the posts (row 3, opaque brassShadow plate - was see-through), the band
  // with the KESTREL name board (row 4), riveted brass hull (rows 5-6), brassDark underside (row 7), keel in ash (row 8).
  // =====================================================================================================
  var GW = 34;
  function setAt(s, col, str) { return s.slice(0, col) + str + s.slice(col + str.length); }
  function railRow(w, x0, x1, posts, end, mid, post) {
    var s = mk(w, [[x0, rep(mid, x1 - x0 + 1)]]);
    s = setAt(setAt(s, x0, end), x1, end);
    posts.forEach(function (p) { s = setAt(s, p, post); });
    return s;
  }
  var G_ROPE_A0 = mk(GW, [[5, '\\'], [12, "'"], [17, '|'], [22, "'"], [28, '/']]);
  var G_ROPE_A1 = mk(GW, [[6, '\\'], [12, "'"], [17, '|'], [22, "'"], [27, '/']]);
  var G_ROPE_B1 = mk(GW, [[7, '\\'], [13, "'"], [17, '|'], [21, "'"], [26, '/']]);
  var G_BODY = [
    railRow(GW, 2, 31, [8, 14, 20, 26], 'o', '=', '+'),                                        // 2 rail
    railRow(GW, 2, 31, [8, 14, 20, 26], '|', '$', '|'),                                        // 3 posts, dark inside
    mk(GW, [[2, '|'], [3, rep('=', 8)], [11, '[`KESTREL`]'], [22, rep('=', 9)], [31, '|']]),  // 4 band + name board
    setAt(setAt(setAt(mk(GW, [[2, '|' + rep('`', 28) + '|']]), 5, 'o'), 28, 'o'), 16, '%%'),   // 5 hull, rivets, verdigris dent
    setAt(setAt(mk(GW, [[3, '\\' + rep('`', 26) + '/']]), 6, 'o'), 27, 'o'),                   // 6 hull taper
    mk(GW, [[4, '\\' + rep('`', 24) + '/']]),                                                  // 7 underside (brassDark)
    mk(GW, [[1, ",.;'\\"], [6, rep('_', 22)], [28, "/'.,;"]])                                  // 8 keel in ash and grit
  ];
  var G_MAP = { o: 'H', '=': 'B', '+': 'H', '|': 'b', '%': 'v', '[': 'w', ']': 'w', '\\': 'D', '/': 'D', '_': 'D',
                '`': 'p', '$': 'x', letter: 'K', other: 'b' };
  var G_ROWS = { 0: { '/': 'r', '\\': 'r', '|': 'r', "'": 'R' }, 1: { '/': 'r', '\\': 'r', '|': 'r', "'": 'R' },
                 3: { '|': 'B' }, 4: { '`': 'w' }, 7: { '`': 'D' }, 8: { ',': 'a', '.': 'a', ';': 's', "'": 'a' } };
  var gA = [G_ROPE_A0, G_ROPE_A1].concat(G_BODY), gB = [G_ROPE_A0, G_ROPE_B1].concat(G_BODY);
  var G_N = autoN(gA, [2], [], [0, 1]);
  var GH_ROWS = [
    railRow(17, 1, 15, [4, 8, 12], 'o', '=', '+'),
    railRow(17, 1, 15, [4, 8, 12], '|', '$', '|'),
    mk(17, [[1, '|=='], [4, '[KESTREL]'], [13, '==|']]),
    setAt(setAt(mk(17, [[2, '\\' + rep('`', 11) + '/']]), 4, 'o'), 12, 'o'),
    mk(17, [[1, ','], [3, '\\' + rep('_', 9) + '/'], [15, '.']])
  ];
  var GH_MAP_ROWS = { 1: { '|': 'B' }, 4: { ',': 'a', '.': 'a' } };

  A.models.gondola = {
    name: 'gondola',
    desc: 'The Kestrel\'s brass gondola, crashed upright on the tower floor: bright rail with posts, the dark basket inside, ' +
          'riveted hull plates, a verdigris dent, the KESTREL name board (wood, brass letters), snapped rigging that sways, ash and grit round the keel.',
    size: { w: GW, h: 9 }, anchor: { x: 17, y: 8 }, world: { w: 2.6, h: 1.3 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: {
      r: { c: 'rope', fill: false }, R: { c: 'ropeDark', fill: false },
      H: { c: 'brassHot' }, B: { c: 'brassLight' }, b: { c: 'brass' }, D: { c: 'brassDark' }, v: { c: 'verdigris' },
      w: { c: 'woodDark' }, K: { c: 'brassLight' },
      p: { c: 'brass' },                                   // hull plate (opaque space)
      x: { c: 'brassShadow' },                             // basket inside between the rail posts (opaque space)
      a: { c: 'ash', fill: false }, s: { c: 'rubble', fill: false }
    },
    nameBoard: { row: 4, x0: 13, x1: 19, text: 'KESTREL', half: { row: 2, x0: 5, x1: 11 },
                 note: 'the airship name; also the game title (D-011 amendment 2). Readable in both LODs' },
    animations: {
      // the snapped stays sway slowly (long hold, short swing). Stillness first: only row 1 moves.
      idle: { loop: true, durations: [1800, 900], frames: [frame(gA, G_MAP, G_ROWS, G_N), frame(gB, G_MAP, G_ROWS, G_N)] }
    },
    lods: {
      half: { size: { w: 17, h: 5 }, anchor: { x: 8, y: 4 }, animations: {
        idle: { loop: true, durations: [1800, 900], frames: [frame(GH_ROWS, G_MAP, GH_MAP_ROWS), frame(GH_ROWS, G_MAP, GH_MAP_ROWS)] }
      } }
    },
    collide: 'none (M1: billboard only; the tower floor under it stays walkable)'
  };

  // =====================================================================================================
  // ENVELOPE DRAPE 10x8: torn canvas hanging from a beam; folds ) (, seam ~, a burnt tear, tattered hem sways
  // =====================================================================================================
  var DW = 10;
  var D_ROWS = fix([
    '-==o==o==-',
    ')~)(~)(~)(',
    ')~)( )(~)(',
    ')~)/  \\~)(',
    ')~)(\\/)~)(',
    ')~)( )(~) ',
    ")~/ ')(\\  ",
    "/' ' \\( ' "
  ], DW);
  var D_MAP = { ')': 'C', '(': 'k', '~': 'c', '/': 'k', '\\': 'k', "'": 's', '-': 'r', '=': 'r', o: 'b', other: 'c' };
  function shiftRows(rows, from, d) {
    return rows.map(function (r, i) {
      if (i < from) return r;
      return d < 0 ? r.slice(1) + ' ' : ' ' + r.slice(0, -1);
    });
  }
  var D_N = autoN(D_ROWS, [0], [], []);
  var dFrames = [D_ROWS, shiftRows(D_ROWS, 6, -1), D_ROWS, shiftRows(D_ROWS, 6, 1)].map(function (g) { return frame(g, D_MAP, null, D_N); });
  var DH = fix(['-=o=-', ')~(~)', ')/ \\(', "/' '\\"], 5);
  var dhFrames = [DH, shiftRows(DH, 3, -1), DH, shiftRows(DH, 3, 1)].map(function (g) { return frame(g, D_MAP); });

  A.models.envelopeDrape = {
    name: 'envelopeDrape',
    desc: 'A torn panel of the Kestrel\'s envelope hanging from a beam in the stairwell: pale ochre canvas, light folds ), ' +
          'dark folds (, seams ~, a burnt tear you can see the wall through, tattered hem that sways in the draught.',
    size: { w: DW, h: 8 }, anchor: { x: 5, y: 7 }, world: { w: 1.4, h: 1.9 },
    directions: ['S'], billboard: true,
    // BUG-OWN-003: solid canvas; the burnt tear (space KEYS, rows 2-5) stays the only see-through part (intended)
    fill: { k: 0.45 },
    keys: { C: { c: 'canvasLight' }, c: { c: 'canvas' }, k: { c: 'canvasDark' }, s: { c: 'canvasScorch' },
            r: { c: 'rope', fill: false }, b: { c: 'brassDark' } },
    hangs: { note: 'anchor = the hem (bottom row). Place z = beam height - world.h (the top row is the rope hem on the beam)' },
    animations: { sway: { loop: true, durations: [900, 700, 900, 700], frames: dFrames } },
    lods: { half: { size: { w: 5, h: 4 }, anchor: { x: 2, y: 3 }, animations: { sway: { loop: true, durations: [900, 700, 900, 700], frames: dhFrames } } } }
  };

  // =====================================================================================================
  // ENVELOPE HEAP 14x4: the crumpled envelope snagged below the tower (seen from the summit breach)
  // =====================================================================================================
  // ART-OWN-001: same 14x4, fewer inner marks: light contour on top, quiet canvas plate ('`'), two folds, the rope
  // band + eyelet as the one detail, dark scorched hem on the ground.
  var P_ROWS = fix([
    '    .-~~-.    ',
    " .-'``)```'-. ",
    '(``(``=o=``)`)',
    "'-~~-'~~'-~~-,"
  ], 14);
  var P_MAP = { '.': 'C', '-': 'C', '~': 'C', "'": 'C', ')': 'k', '(': 'k', '=': 'r', o: 'b', '`': 'c', ',': 'a', other: 'c' };
  var P_ROWS_MAP = { 3: { '-': 'k', '~': 'k', "'": 's' } };
  var PH = fix([' .-~-. ', '(``o``)'], 7);
  A.models.envelopeHeap = {
    name: 'envelopeHeap',
    desc: 'The bulk of the Kestrel\'s envelope, collapsed and snagged on the hillside below the tower: a pale ochre ' +
          'mound of folds with a rope band and a brass eyelet. The hook shot from the summit breach (D-011).',
    size: { w: 14, h: 4 }, anchor: { x: 7, y: 3 }, world: { w: 5.0, h: 1.6 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 },
    keys: { C: { c: 'canvasLight' }, c: { c: 'canvas' }, k: { c: 'canvasDark' }, s: { c: 'canvasScorch' },
            r: { c: 'rope' }, b: { c: 'brassDark' }, a: { c: 'ash', fill: false } },
    animations: { idle: { fps: 1, loop: true, frames: [frame(P_ROWS, P_MAP, P_ROWS_MAP, autoN(P_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 7, h: 2 }, anchor: { x: 3, y: 1 }, animations: { idle: { fps: 1, loop: true, frames: [frame(PH, P_MAP)] } } } }
  };

  // =====================================================================================================
  // BURNER 13x11 (ART-OWN-001, was 9x7): a real FIRE on top (4 rows, flame tongues wide at the base, emissive), the
  // wide ember mouth (row 4), a copper can with bright copperLight edges and a quiet copper plate, ONE brass pressure
  // gauge (@), a coil band ))), a verdigris spot, two legs on the stone ring.
  // =====================================================================================================
  var BW = 13;
  // flame unit 9x4 (6 frames, 10 fps): glyphs + heat 1..4 (tip red -> core yellow-white), all emissive
  var FL = [
    { g: ['    ^    ', "   ^*^ ' ", '  ^*#*^  ', ' ^*###*^ '], h: ['    1    ', '   232 1 ', '  23432  ', ' 2344432 '] },
    { g: ['   ^     ', '  ^*^    ', ' ^*#*^ . ', ' ^*###*^ '], h: ['   1     ', '  232    ', ' 23432 1 ', ' 2344432 '] },
    { g: ['    ^ .  ', '   ^#^   ', '  ^*#*^  ', ' *^###^* '], h: ['    1 1  ', '   242   ', '  23432  ', ' 3244423 '] },
    { g: ['     ^   ', '    ^*^  ', ' . ^*#*^ ', ' ^*###*^ '], h: ['     1   ', '    232  ', ' 1 23432 ', ' 2344432 '] },
    { g: ["  '   '  ", '   ^^^   ', '  ^*#*^  ', ' ^*###*^ '], h: ['  1   1  ', '   212   ', '  23432  ', ' 2344432 '] },
    { g: ["   ' ^   ", '   ^*^^  ', "  ^*#*^' ", ' ^#*#*#^ '], h: ['   1 1   ', '   2322  ', '  234321 ', ' 2434342 '] }
  ];
  // half flame 5x2
  var FLH = [
    { g: [" '^' ", '^*#*^'], h: [' 121 ', '23432'] },
    { g: ["^'   ", '^*#*^'], h: ['21   ', '23432'] },
    { g: ['  ^  ', '*^#^*'], h: ['  1  ', '32423'] },
    { g: ["   '^", '^*#*^'], h: ['   12', '23432'] },
    { g: [" ' ' ", '^*#*^'], h: [' 1 1 ', '23432'] },
    { g: [" ^ ' ", '^#*#^'], h: [' 1 1 ', '24342'] }
  ];
  var MOUTH = [{ g: ' (=*#*#*#*=) ', k: ' CCEyEyEyECC ' }, { g: ' (=#*#*#*#=) ', k: ' CCyEyEyEyCC ' }];
  var BODY = [
    { g: '  |```````|  ', k: '  CcccccccC  ' },
    { g: '  |``(@)``|  ', k: '  CccbHbccC  ' },
    { g: '  |)))))))|  ', k: '  CCCCCCCCC  ' },
    { g: '  |`%`````|  ', k: '  CcvcccccC  ' },
    { g: '  \\_______/  ', k: '  CdddddddC  ' },
    { g: '   /|   |\\   ', k: '   dd   dd   ' }
  ];
  function burnerFrame(f) {
    var u = FL[f], m = MOUTH[f % 2], g = [], k = [], i;
    for (i = 0; i < 4; i++) { g.push('  ' + u.g[i] + '  '); k.push('  ' + u.h[i] + '  '); }
    g.push(m.g); k.push(m.k);
    BODY.forEach(function (b) { g.push(b.g); k.push(b.k); });
    return { S: { glyphs: glyphsOf(g), fg: k, n: autoN(g, [4], [], [0, 1, 2, 3]) } };
  }
  function burnerHalf(f) {
    var u = FLH[f], odd = f % 2;
    var g = [' ' + u.g[0] + ' ', ' ' + u.g[1] + ' ', odd ? '(#*#*#)' : '(*#*#*)', ' |(@)| ', ' |)))| ', ' /___\\ '];
    var k = [' ' + u.h[0] + ' ', ' ' + u.h[1] + ' ', odd ? 'CyEyEyC' : 'CEyEyEC', ' CbHbC ', ' CCCCC ', ' CdddC '];
    return { S: { glyphs: g, fg: k, n: autoN(g, [2], [], [0, 1]) } };
  }
  var bFull = [], bHalf = [], i;
  for (i = 0; i < 6; i++) { bFull.push(burnerFrame(i)); bHalf.push(burnerHalf(i)); }

  A.models.burner = {
    name: 'burner',
    desc: 'The Kestrel\'s copper burner, thrown clear in the crash and still burning on the stone ring: a fire on top, ' +
          'an ember mouth, a copper can with a brass pressure gauge (@), a coil band, verdigris, two legs. The M1 torch light source.',
    size: { w: BW, h: 11 }, anchor: { x: 6, y: 10 }, world: { w: 1.15, h: 1.1 },
    directions: ['S'], billboard: true,
    // BUG-OWN-003: solid can; flame TIPS stay glyph-only (fill: false), the flame body and embers get a glow plate
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: {
      '1': { c: 'flameTip', e: true, fill: false }, '2': { c: 'flameOuter', e: true, fill: false },
      '3': { c: 'flameMid', e: true }, '4': { c: 'flameCore', e: true },
      c: { c: 'copper' }, C: { c: 'copperLight' }, d: { c: 'copperDark' }, v: { c: 'verdigris' },
      b: { c: 'brass' }, B: { c: 'brassLight' }, H: { c: 'brassHot' },
      E: { c: 'emberHot', e: true }, y: { c: 'emberDim', e: true }
    },
    light: { preset: 'torch', offset: { x: 0, y: 0, z: 0.6 }, note: 'D-011: same preset as the brazier; point light at the mouth (ring top 0.5 -> z 1.1)' },
    replaces: 'brazier',
    animations: { burn: { fps: 10, loop: true, frames: bFull } },
    lods: { half: { size: { w: 7, h: 6 }, anchor: { x: 3, y: 5 }, animations: { burn: { fps: 10, loop: true, frames: bHalf } } } }
  };

  // =====================================================================================================
  // RIGGING 14x4 (ART-OWN-001, was 7x2): a fat rope COIL seen from the side (stacked loops = ropeLight, dark ends
  // ( ) ) and the snapped stay trailing off to the right on the flagstones (glyph-only line, `l`, fill: false).
  // Explicit key rows (the coil and the tail share glyphs).
  // =====================================================================================================
  var R_G = ['   .-==-.     ', '  (=-==-=)    ', '  (=-==-=)-~. ', "   '-==-'   '~"];
  var R_K = ['   rrLLrr     ', '  RLrLLrLR    ', '  RLrLLrLRlll ', '   rrLLrr   ll'];
  var R_HG = [' .-=-. ', "'-=-'~."], R_HK = [' rrLrr ', 'rrLrrll'];
  A.models.rigging = {
    name: 'rigging',
    desc: 'Rope from the Kestrel: a fat coil of rope and a snapped stay trailing across the flagstones.',
    size: { w: 14, h: 4 }, anchor: { x: 7, y: 3 }, world: { w: 0.9, h: 0.25 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: { r: { c: 'rope' }, R: { c: 'ropeDark' }, L: { c: 'ropeLight' }, l: { c: 'rope', fill: false } },
    animations: { idle: { fps: 1, loop: true, frames: [{ S: { glyphs: R_G, fg: R_K, n: autoN(R_G, [0], [], []) } }] } },
    lods: { half: { size: { w: 7, h: 2 }, anchor: { x: 3, y: 1 }, animations: { idle: { fps: 1, loop: true, frames: [{ S: { glyphs: R_HG, fg: R_HK } }] } } } }
  };

  // =====================================================================================================
  // CANVAS HEAP 20x4 (ART-OWN-001, was 9x2; reskin of the straw pallet = the wake spot): a low MOUND of crumpled
  // envelope canvas - bright canvasLight contour on top (one tall fold, a long slope), quiet canvas plate inside,
  // two dark folds ( ), a brass eyelet, a dark wavy hem on the floor, scorched ends. Anchor = bottom centre; the
  // world size (2.0 x 0.3 m) and the placement point are the pallet's, so the start pose and wake camera do not change.
  // =====================================================================================================
  var CH_ROWS = fix([
    '       .-~~~-.      ',
    "  .-~-'```)```'-.   ",
    ' (```)``o``(```)``\\ ',
    "'-~~-'~~-~~-'~~-~~-'"
  ], 20);
  var CH_MAP = { '.': 'C', '-': 'C', '~': 'C', "'": 'C', ')': 'k', '(': 'k', '\\': 'k', '`': 'c', o: 'b', other: 'c' };
  var CH_ROWS_MAP = { 3: { '-': 'k', '~': 'k', "'": 's' } };
  var CH_HALF = fix(['  .-~~-.  ', "(``)o(``)'"], 10);
  var CH_HALF_MAP = { 1: { "'": 's' } };
  A.models.canvasHeap = {
    name: 'canvasHeap',
    desc: 'The wake spot: a torn panel of the Kestrel\'s envelope, crumpled into a low mound on the flagstones. Bright ' +
          'pale-ochre top edge, dark folds ( ), a brass eyelet o, a dark wavy hem with scorched ends. Walk-over (no collision).',
    size: { w: 20, h: 4 }, anchor: { x: 10, y: 3 }, world: { w: 2.0, h: 0.3 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: { C: { c: 'canvasLight' }, c: { c: 'canvas' }, k: { c: 'canvasDark' }, s: { c: 'canvasScorch' },
            b: { c: 'brassDark' } },
    replaces: 'pallet',
    animations: { idle: { fps: 1, loop: true, frames: [frame(CH_ROWS, CH_MAP, CH_ROWS_MAP, autoN(CH_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 10, h: 2 }, anchor: { x: 5, y: 1 }, animations: { idle: { fps: 1, loop: true, frames: [frame(CH_HALF, CH_MAP, CH_HALF_MAP)] } } } }
  };

  // =====================================================================================================
  // ROPES 3x16 (ART-OWN-001, was 1x6; 2 variants, rubble-style `variants[]`, picked by props[].variant 0..1): snapped
  // stays hanging from the beam / step edge. The rope is the centre column; the side columns are room for the sway
  // (the lower end swings one column, with a \ or / bend). Twist = alternating ropeLight ) / rope ( so it reads as
  // rope, not as a painted line. Glyph-only (`fill: false` keys): a rope is thin.
  //   0 = knotted stay (@ knot at the top and half-way, : fibres, ' frayed end)
  //   1 = eyelet stay (o brass eyelet, : fibres, , frayed tuft)
  // The anchor is the frayed END (bottom row): place z = attach height - world.h.
  // =====================================================================================================
  var ROPE_MAP = { '@': 'R', '|': 'r', ')': 'L', '(': 'r', ':': 'L', "'": 'R', ',': 'R', o: 'b', '\\': 'r', '/': 'r', other: 'r' };
  var ROPE_KEYS = { r: { c: 'rope', fill: false }, R: { c: 'ropeDark', fill: false }, L: { c: 'ropeLight', fill: false },
                    b: { c: 'brassDark', fill: false } };
  // column list -> 3-wide rows; `shift` moves rows >= from to column col, the first shifted row takes `bend`
  function ropeRows(list, from, col, bend) {
    return list.map(function (g, r) {
      var c = 1;
      if (from != null && r >= from) { c = col; if (r === from) g = bend; }
      return mk(3, [[c, g]]);
    });
  }
  function ropeN(rows) { return rows.map(function (r) { return r.replace(/[^ ]/g, 'f').replace(/ /g, '.'); }); }
  function ropeModel(nm, list, hlist, dir, dur) {
    var bend = dir > 0 ? '\\' : '/', col = 1 + dir;
    var a = ropeRows(list), b = ropeRows(list, 10, col, bend), ha = ropeRows(hlist), hb = ropeRows(hlist, 5, col, bend);
    return { name: nm, size: { w: 3, h: 16 }, anchor: { x: 1, y: 15 }, world: { w: 0.12, h: 1.8 },
      directions: ['S'], billboard: true, keys: ROPE_KEYS,
      hangs: { note: 'anchor = the frayed end (bottom row, centre column). Place z = attach height - world.h (1.8 m)' },
      animations: { sway: { loop: true, durations: dur, frames: [frame(a, ROPE_MAP, null, ropeN(a)), frame(b, ROPE_MAP, null, ropeN(b))] } },
      lods: { half: { size: { w: 3, h: 8 }, anchor: { x: 1, y: 7 }, animations: {
        sway: { loop: true, durations: dur, frames: [frame(ha, ROPE_MAP), frame(hb, ROPE_MAP)] } } } } };
  }
  A.models.rope = {
    name: 'rope',
    desc: 'Snapped rigging of the Kestrel hanging in the stairwell: a knotted stay and an eyelet stay. Rope colours only ' +
          '(brassDark eyelet), twisted ) ( so it reads as rope, the lower end sways slowly.',
    variants: [
      ropeModel('rope0', ['@', '|', ')', '(', ')', '(', '@', '|', ')', '(', ')', '(', ')', '(', ':', "'"],
                         ['@', '|', ')', '(', '@', ')', '(', "'"], 1, [2000, 800]),
      ropeModel('rope1', ['o', '|', ')', '(', ')', '(', ')', '(', '|', ')', '(', ')', '(', ')', ':', ','],
                         ['o', '|', ')', '(', ')', '(', ':', ','], -1, [1500, 700])
    ]
  };

  // =====================================================================================================
  // BENT STRUT 12x4 (ART-OWN-001, was 4x3): a gondola frame bar lying on the rubble, bent up at a verdigris kink.
  // Two-cell-thick diagonal // so the bend reads at any scale; riveted end caps o=o; brass plates (fill) under it.
  //          o=o     row 0  upper end cap
  //         //       row 1
  //       //         row 2
  //   o=====%/       row 3  lower arm on the rubble, verdigris kink %
  // =====================================================================================================
  var ST_ROWS = fix(['         o=o', '        //  ', '      //    ', 'o=====%/    '], 12);
  var ST_MAP = { o: 'H', '=': 'b', '/': 'B', '%': 'v', other: 'b' };
  var ST_HALF = fix(['    /o', 'o==%/ '], 6);
  A.models.strut = {
    name: 'strut',
    desc: 'A bent brass strut from the Kestrel\'s gondola frame, lying on the rubble heap: riveted ends, a verdigris kink.',
    size: { w: 12, h: 4 }, anchor: { x: 3, y: 3 }, world: { w: 1.0, h: 0.5 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: { H: { c: 'brassHot' }, B: { c: 'brassLight' }, b: { c: 'brass' }, v: { c: 'verdigris' } },
    animations: { idle: { fps: 1, loop: true, frames: [frame(ST_ROWS, ST_MAP, null, autoN(ST_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 6, h: 2 }, anchor: { x: 1, y: 1 }, animations: { idle: { fps: 1, loop: true, frames: [frame(ST_HALF, ST_MAP)] } } } },
    collide: 'none (placed on the existing rubble cell R (14,8), 0.6 m)'
  };

  // =====================================================================================================
  // PROPOSED tower.js patch (D-011 reskin list). NOT applied: the game loads design/levels/tower.js; the swaps land
  // with the US-011 programmer pass. Positions are world metres in tower.js space; checked live in preview/tower.html.
  // =====================================================================================================
  A.levelPatch = A.levelPatch || {};
  A.levelPatch.tower = {
    status: 'APPLIED (US-011 programmer pass, 2026-09-24, design/levels/tower.js) - EXCEPT the `interactables` swap below ' +
      '(architect tech notes 7.5 item 5: "not in US-011 scope except: the relay spawns dead, and the preset swap must load" - ' +
      'the `beacon` interactable keeps its US-010 prompt/behaviour name (`beacon.light`, still a stub) until US-022).',
    loadModels: ['models/wreckage.js', 'models/relay.js', 'models/lantern.js (reskinned in place)', 'models/lever.js (gear housing, same key)'],
    props: {
      replace: [
        { id: 'brazier', set: { model: 'burner' }, note: 'same position (18.5, 6.5, 0.5), same torch light, same `burn` anim' },
        { id: 'pallet', set: { model: 'canvasHeap' }, wakeSpot: true,
          note: 'same position (17.0, 9.5, 0.0) and facing: the wake spot. Walk-over like the pallet (no collision)' },
        { id: 'beaconBowl', set: { model: 'relay', variant: 'dead' }, note: 'same position (9.0, 7.0, 6.6) on the O plinth; US-022 glow = relay.mounts.glow' }
      ],
      add: [
        { id: 'gondola', model: 'gondola', x: 15.4, y: 8.7, z: 0.0, facing: 90,
          note: 'beside the wake spot, NOT on it: 1.7 m west-north-west of the heap centre, keel on the flagstones by the R rubble. ' +
                'Seen front-left from the start pose. Non-colliding. The lamp stays on its own bracket at the old lantern position ' +
                '(19.9, 6.5, 1.3: US-012 data and tests unchanged)' },
        { id: 'rigging', model: 'rigging', x: 15.3, y: 9.5, z: 0.0, facing: 0, note: 'rope coil at the gondola stern, west of the heap' },
        { id: 'strut', model: 'strut', x: 14.4, y: 8.2, z: 0.6, facing: 90, note: 'on the existing rubble cell R (14,8), 0.6 m, beside the gondola' },
        { id: 'ropeA', model: 'rope', variant: 0, x: 14.1, y: 8.4, z: 3.3, facing: 90,
          note: 'hangs off the upper-step edge H (5.1 m): z = 5.1 - 1.8. Bottom 3.3 m above the floor: overhead' },
        { id: 'ropeB', model: 'rope', variant: 1, x: 15.2, y: 7.3, z: 3.6, facing: 90,
          note: 'hangs beside the canvas drape from the same beam (5.4 m): z = 5.4 - 1.8. Overhead' },
        { id: 'canvasDrape', model: 'envelopeDrape', x: 14.5, y: 7.4, z: 3.5, facing: 90,
          note: '"canvas hangs in the stairwell": off the upper stair edge (I, 5.4 m) into the room. Overhead (hem at 3.5 m)' },
        { id: 'envelopeHeap', model: 'envelopeHeap', x: 3.0, y: 6.5, z: 'ground', facing: 90,
          note: 'outside the broken west wall, below the summit breach: the hook view. z = terrain height there; not on the route' }
      ],
      remove: ['beaconFire mount (the relay has its own glow, relay.mounts.glow; no fire on the summit)']
    },
    // CR item 5: no new prop sits on the wake -> burner -> stair path or on the boulder's roll line.
    pathCheck: {
      result: 'PASS (designer, 2026-09-24; recomputed live in preview/tower.html, check "D-011 levelPatch props")',
      method: 'Ground-floor BFS (8-neighbour, corner rule, rise <= 1.0, the burner ring * excluded). Corridor = every cell on ANY ' +
              'shortest path: leg 1 wake (17,9) -> a cell next to the burner ring; leg 2 from the leg-1 arrival cells -> stair base (15,3). ' +
              'Roll line = every cell the boulder can reach from its start (stair base, slope apron, hollow). A prop is checked on its ' +
              'anchor cell; a prop whose bottom is >= 2.0 m above that floor counts as overhead (clear). The wake-spot heap is exempt.',
      corridor: { leg1: ['17,9', '16,8', '17,8', '18,8', '17,7', '18,7', '19,7'],
                  leg2: ['17,7', '18,7', '16,6', '17,6', '16,5', '15,5', '15,4', '14,4', '15,3'] },
      rollLine: 'stairBase / slope / hollow cells (13..15, 3..5)',
      props: { gondola: '15,8 clear', rigging: '15,9 clear', strut: '14,8 rubble, clear', ropeA: '14,8 overhead 3.3 m', ropeB: '15,7 overhead 3.6 m',
               canvasDrape: '14,7 overhead 3.5 m', envelopeHeap: '3,6 outside, off the route', canvasHeap: 'wake spot (exempt)' }
    },
    lights: [
      { id: 'beacon', set: { preset: 'relay', z: 7.7 }, note: 'off until the relay wakes (US-022), then grows over 1.0 s' }
    ],
    interactables: [
      { id: 'lantern', set: { prompt: '[E] Take lamp' }, note: 'lantern.take sets sprite.variant = "empty" -> lantern.animations.empty (bracket stays)' },
      { id: 'beacon', set: { prompt: '[E] Wake the relay', interact: 'relay.wake' }, note: 'behaviour name change is a programmer call' }
    ],
    materials: [
      { legend: '!', set: { wallMat: 'stone_ivy' }, note: 'west wall broken low beside the summit: ivy where the Kestrel came through' },
      { legend: 'P', set: { floorMat: 'moss_top' }, note: 'summit parapet tops' },
      { legend: '& $ %', set: { floorMat: 'moss_top' }, note: 'solid wall tops (seen from the summit) - moss on stone tops' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
