/*
 * Kestrel - the wreck of the Kestrel (D-011, US-010 / US-011 reskin): the airship Wick stole, shot down by the
 * wall-ballistae, crashed through the tower's broken crown.
 * Format: design/README.md section 4 (+ 4.2). Plain script. Sets:
 *   ASSETS.models.gondola        brass gondola with the KESTREL name board, snapped rigging (sways)      18x6
 *   ASSETS.models.envelopeDrape  torn canvas hanging from a beam (stairwell), sways, burnt tear         10x8
 *   ASSETS.models.envelopeHeap   crumpled envelope on the ground (seen from the summit, snagged below)   14x4
 *   ASSETS.models.burner         the Kestrel's copper burner, smoldering: low flame + embers, gauge (@)  9x7
 *                                (replaces the iron `brazier` in the level; same `burn` anim name, same torch light)
 *   ASSETS.models.rigging        a coil of rope and a snapped line on the floor                          7x2
 *   ASSETS.levelPatch.tower      PROPOSED edits to design/levels/tower.js (not applied: US-010 is in review)
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
  function frame(g, map, rowMaps, n) { return { S: { glyphs: g, fg: paint(g, map, rowMaps), n: n } }; }
  function fix(rows, w) { return rows.map(function (r) { return pad(r, w); }); }

  // =====================================================================================================
  // GONDOLA 18x6: rail with posts, hull plates with rivets, the KESTREL name board, tapered keel in debris
  // =====================================================================================================
  var GW = 18;
  var G_ROPE_A = pad("  /   '    |   \\  ", GW);
  var G_ROPE_B = pad("   /  '    |  \\   ", GW);
  var G_BODY = fix([
    ' o====+====+====o ',
    ' |%=[KESTREL]=o.| ',
    ' |o==-==o==-==o=| ',
    '  \\=o==%%==o==./  ',
    ' ,.\\__________/;.,'
  ], GW);
  var G_MAP = { o: 'H', '=': 'b', '+': 'B', '|': 'D', '%': 'v', '[': 'w', ']': 'w', '-': 'D', '.': 'D',
                '\\': 'D', '/': 'D', '_': 'D', letter: 'K', other: 'b' };
  var G_ROWS = { 0: { '/': 'r', '\\': 'r', '|': 'r', "'": 'R' }, 5: { ',': 'a', '.': 'a', ';': 's' } };
  var gA = [G_ROPE_A].concat(G_BODY), gB = [G_ROPE_B].concat(G_BODY);
  var G_N = autoN(gA, [1], [], [0]);
  var GH_ROWS = fix(['o==+=+==o', '|=o=%=o=|', ' \\_____/ '], 9);

  A.models.gondola = {
    name: 'gondola',
    desc: 'The Kestrel\'s brass gondola, crashed upright on the tower floor: rail with posts, riveted hull plates, ' +
          'verdigris, a dent, the KESTREL name board (wood, brass letters), snapped rigging that sways, ash and grit round the keel.',
    size: { w: GW, h: 6 }, anchor: { x: 9, y: 5 }, world: { w: 2.6, h: 1.3 },
    directions: ['S'], billboard: true,
    keys: {
      r: { c: 'rope' }, R: { c: 'ropeDark' },
      H: { c: 'brassHot' }, B: { c: 'brassLight' }, b: { c: 'brass' }, D: { c: 'brassDark' }, v: { c: 'verdigris' },
      w: { c: 'woodDark' }, K: { c: 'brassLight' },
      a: { c: 'ash' }, s: { c: 'rubble' }
    },
    nameBoard: { row: 2, x0: 5, x1: 11, text: 'KESTREL', note: 'the airship name; also the game title (D-011 amendment 2)' },
    animations: {
      // the snapped stays sway slowly (long hold, short swing). Stillness first: only row 0 moves.
      idle: { loop: true, durations: [1800, 900], frames: [frame(gA, G_MAP, G_ROWS, G_N), frame(gB, G_MAP, G_ROWS, G_N)] }
    },
    lods: {
      half: { size: { w: 9, h: 3 }, anchor: { x: 4, y: 2 }, animations: {
        idle: { loop: true, durations: [1800, 900], frames: [frame(GH_ROWS, G_MAP), frame(GH_ROWS, G_MAP)] }
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
    keys: { C: { c: 'canvasLight' }, c: { c: 'canvas' }, k: { c: 'canvasDark' }, s: { c: 'canvasScorch' },
            r: { c: 'rope' }, b: { c: 'brassDark' } },
    hangs: { note: 'anchor = the hem (bottom row). Place z = beam height - world.h (the top row is the rope hem on the beam)' },
    animations: { sway: { loop: true, durations: [900, 700, 900, 700], frames: dFrames } },
    lods: { half: { size: { w: 5, h: 4 }, anchor: { x: 2, y: 3 }, animations: { sway: { loop: true, durations: [900, 700, 900, 700], frames: dhFrames } } } }
  };

  // =====================================================================================================
  // ENVELOPE HEAP 14x4: the crumpled envelope snagged below the tower (seen from the summit breach)
  // =====================================================================================================
  var P_ROWS = fix([
    '    .-~~-.    ',
    ' .-~)(~~)(~-. ',
    "(~)(~=o=~)(~)'",
    "'-~~-'~~'-~~-,"
  ], 14);
  var P_MAP = { '.': 'c', '-': 'k', '~': 'c', ')': 'C', '(': 'k', '=': 'r', o: 'b', "'": 's', ',': 'a', other: 'c' };
  var PH = fix([' .~~~. ', "(~)(~)'"], 7);
  A.models.envelopeHeap = {
    name: 'envelopeHeap',
    desc: 'The bulk of the Kestrel\'s envelope, collapsed and snagged on the hillside below the tower: a pale ochre ' +
          'mound of folds with a rope band and a brass eyelet. The hook shot from the summit breach (D-011).',
    size: { w: 14, h: 4 }, anchor: { x: 7, y: 3 }, world: { w: 5.0, h: 1.6 },
    directions: ['S'], billboard: true,
    keys: { C: { c: 'canvasLight' }, c: { c: 'canvas' }, k: { c: 'canvasDark' }, s: { c: 'canvasScorch' },
            r: { c: 'rope' }, b: { c: 'brassDark' }, a: { c: 'ash' } },
    animations: { idle: { fps: 1, loop: true, frames: [frame(P_ROWS, P_MAP, null, autoN(P_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 7, h: 2 }, anchor: { x: 3, y: 1 }, animations: { idle: { fps: 1, loop: true, frames: [frame(PH, P_MAP)] } } } }
  };

  // =====================================================================================================
  // BURNER 9x7: copper can with a coil, brass pressure gauge (@), ember mouth, low smoldering flame
  // =====================================================================================================
  var BW = 9;
  // smolder flame unit 5x2 (6 frames, 10 fps): glyphs + heat 1..4 (tip red -> core yellow-white), all emissive
  var FL = [
    { g: ["  '  ", ' ^*^ '], h: ['  1  ', ' 232 '] },
    { g: [' .   ', "'^*^ "], h: [' 1   ', '1232 '] },
    { g: ['   . ', " ^*^'"], h: ['   1 ', ' 2321'] },
    { g: ['  ^  ', ' *#* '], h: ['  1  ', ' 343 '] },
    { g: ['     ', "'^*^."], h: ['     ', '12321'] },
    { g: [" ' ' ", ' ^*^ '], h: [' 1 1 ', ' 232 '] }
  ];
  var FLH = [
    { g: ' ^*^ ', h: ' 232 ' }, { g: " '*^ ", h: ' 132 ' }, { g: " ^*' ", h: ' 231 ' },
    { g: ' *#* ', h: ' 343 ' }, { g: " '^' ", h: ' 121 ' }, { g: ' ^ ^ ', h: ' 2 2 ' }
  ];
  var MOUTH = [{ g: ' (=*#*=) ', k: ' cCEyECc ' }, { g: ' (=#*#=) ', k: ' cCyEyCc ' }];
  var BODY = [
    { g: ' |)))))| ', k: ' dcCcCcd ' },
    { g: ' |=(@)=| ', k: ' dcbBbcd ' },
    { g: ' |%=o=%| ', k: ' dvcHcvd ' },
    { g: ' /_+_+_\\ ', k: ' ddCdCdd ' }
  ];
  var B_N = fix(['.........', '.........', ' uuuuuuu ', ' lfffffr ', ' lfffffr ', ' lfffffr ', ' lfffffr '], BW);
  function burnerFrame(f) {
    var u = FL[f], m = MOUTH[f % 2], g = [], k = [], i;
    for (i = 0; i < 2; i++) { g.push('  ' + u.g[i] + '  '); k.push('  ' + u.h[i] + '  '); }
    g.push(m.g); k.push(m.k);
    BODY.forEach(function (b) { g.push(b.g); k.push(b.k); });
    return { S: { glyphs: g, fg: k, n: B_N } };
  }
  function burnerHalf(f) {
    var u = FLH[f], odd = f % 2;
    return { S: {
      glyphs: [u.g, odd ? '(#*#)' : '(*#*)', '|(@)|', '/_+_\\'],
      fg:     [u.h, odd ? 'cyEyc' : 'cEyEc', 'dbBbd', 'ddCdd'],
      n:      ['.....', 'uuuuu', 'lfffr', 'lfffr']
    } };
  }
  var bFull = [], bHalf = [], i;
  for (i = 0; i < 6; i++) { bFull.push(burnerFrame(i)); bHalf.push(burnerHalf(i)); }

  A.models.burner = {
    name: 'burner',
    desc: 'The Kestrel\'s copper burner, thrown clear in the crash and smoldering on the stone ring: copper can with a ' +
          'coil, a brass pressure gauge (@), rivets, verdigris, embers in the mouth, a low flame. The M1 torch light source.',
    size: { w: BW, h: 7 }, anchor: { x: 4, y: 6 }, world: { w: 1.15, h: 1.1 },
    directions: ['S'], billboard: true,
    keys: {
      '1': { c: 'flameTip', e: true }, '2': { c: 'flameOuter', e: true }, '3': { c: 'flameMid', e: true }, '4': { c: 'flameCore', e: true },
      c: { c: 'copper' }, C: { c: 'copperLight' }, d: { c: 'copperDark' }, v: { c: 'verdigris' },
      b: { c: 'brass' }, B: { c: 'brassLight' }, H: { c: 'brassHot' },
      E: { c: 'emberHot', e: true }, y: { c: 'emberDim', e: true }
    },
    light: { preset: 'torch', offset: { x: 0, y: 0, z: 0.6 }, note: 'D-011: same preset as the brazier; point light at the mouth (ring top 0.5 -> z 1.1)' },
    replaces: 'brazier',
    animations: { burn: { fps: 10, loop: true, frames: bFull } },
    lods: { half: { size: { w: 5, h: 4 }, anchor: { x: 2, y: 3 }, animations: { burn: { fps: 10, loop: true, frames: bHalf } } } }
  };

  // =====================================================================================================
  // RIGGING 7x2: rope coil (@) and a snapped line on the floor near the gondola
  // =====================================================================================================
  var R_ROWS = fix([' .-~-. ', "(@)=~-'"], 7);
  var R_MAP = { '.': 'r', '-': 'r', '~': 'L', '(': 'R', ')': 'R', '@': 'L', '=': 'r', "'": 'R', other: 'r' };
  A.models.rigging = {
    name: 'rigging',
    desc: 'Rope from the Kestrel: a coil (@) and a snapped stay lying on the flagstones.',
    size: { w: 7, h: 2 }, anchor: { x: 3, y: 1 }, world: { w: 0.9, h: 0.25 },
    directions: ['S'], billboard: true,
    keys: { r: { c: 'rope' }, R: { c: 'ropeDark' }, L: { c: 'ropeLight' } },
    animations: { idle: { fps: 1, loop: true, frames: [frame(R_ROWS, R_MAP, null, autoN(R_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 4, h: 1 }, anchor: { x: 2, y: 0 }, animations: { idle: { fps: 1, loop: true, frames: [frame(['(@)~'], R_MAP)] } } } }
  };

  // =====================================================================================================
  // CANVAS HEAP 9x2 (reskin of the straw pallet = the wake spot): torn envelope canvas, pale ochre ~ ), same
  // footprint / anchor / world size as the pallet, so the start pose and the wake camera do not change.
  // =====================================================================================================
  var CH_ROWS = fix(['.~)~~(~).', "'(~)o(~),"], 9);
  var CH_MAP = { '.': 'c', '~': 'c', ')': 'C', '(': 'k', "'": 's', ',': 'a', o: 'b', other: 'c' };
  var CH_HALF = fix(['(~)~)'], 5);
  A.models.canvasHeap = {
    name: 'canvasHeap',
    desc: 'The wake spot: a torn panel of the Kestrel\'s envelope, crumpled into a low bed on the flagstones. Pale ochre ' +
          'folds ) (, seams ~, a brass eyelet o, a scorched torn edge \' and ash , at the ends. Walk-over (no collision).',
    size: { w: 9, h: 2 }, anchor: { x: 4, y: 1 }, world: { w: 2.0, h: 0.3 },
    directions: ['S'], billboard: true,
    keys: { C: { c: 'canvasLight' }, c: { c: 'canvas' }, k: { c: 'canvasDark' }, s: { c: 'canvasScorch' },
            b: { c: 'brassDark' }, a: { c: 'ash' } },
    replaces: 'pallet',
    animations: { idle: { fps: 1, loop: true, frames: [frame(CH_ROWS, CH_MAP, null, autoN(CH_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 5, h: 1 }, anchor: { x: 2, y: 0 }, animations: { idle: { fps: 1, loop: true, frames: [frame(CH_HALF, CH_MAP)] } } } }
  };

  // =====================================================================================================
  // ROPES 1x6 (2 variants, rubble-style `variants[]`, picked by props[].variant 0..1): snapped stays hanging from
  // the beam / step edge. Slow 2-frame sway of the lower half (long hold, short swing), like the gondola stays.
  //   0 = knotted stay (@ knot, : twist, ' frayed end)      1 = eyelet stay (o brass eyelet, , frayed tuft)
  // The anchor is the frayed END (bottom row): place z = attach height - world.h.
  // =====================================================================================================
  var ROPE_MAP = { '@': 'R', '|': 'r', ')': 'r', '(': 'r', ':': 'L', "'": 'R', ',': 'R', o: 'b', other: 'r' };
  var ROPE_KEYS = { r: { c: 'rope' }, R: { c: 'ropeDark' }, L: { c: 'ropeLight' }, b: { c: 'brassDark' } };
  var ROPE_N = ['f', 'f', 'f', 'f', 'f', 'f'];
  function ropeModel(nm, a, b, ha, hb, dur) {
    return { name: nm, size: { w: 1, h: 6 }, anchor: { x: 0, y: 5 }, world: { w: 0.12, h: 1.8 },
      directions: ['S'], billboard: true, keys: ROPE_KEYS,
      hangs: { note: 'anchor = the frayed end (bottom row). Place z = attach height - world.h (1.8 m)' },
      animations: { sway: { loop: true, durations: dur, frames: [frame(a, ROPE_MAP, null, ROPE_N), frame(b, ROPE_MAP, null, ROPE_N)] } },
      lods: { half: { size: { w: 1, h: 3 }, anchor: { x: 0, y: 2 }, animations: {
        sway: { loop: true, durations: dur, frames: [frame(ha, ROPE_MAP), frame(hb, ROPE_MAP)] } } } } };
  }
  A.models.rope = {
    name: 'rope',
    desc: 'Snapped rigging of the Kestrel hanging in the stairwell: a knotted stay and an eyelet stay. Rope colours only ' +
          '(brassDark eyelet), 1 cell wide, sways slowly.',
    variants: [
      ropeModel('rope0', ['@', '|', ':', '|', '|', "'"], ['@', '|', ':', ')', ')', "'"], ['@', '|', "'"], ['@', ')', "'"], [2000, 800]),
      ropeModel('rope1', ['o', '|', '|', ':', '|', ','], ['o', '|', '|', ':', '(', ','], ['o', '|', ','], ['o', '(', ','], [1500, 700])
    ]
  };

  // =====================================================================================================
  // BENT STRUT 4x3: a gondola frame member, bent at a verdigris kink, lying on the rubble. Brass (machine part).
  //   row 0 "  =o"  upper end, rivet end cap      row 1 " /% "  bend + verdigris kink      row 2 "o=, "  lower end, grit
  // =====================================================================================================
  var ST_ROWS = fix(['  =o', ' /% ', 'o=, '], 4);
  var ST_MAP = { o: 'B', '=': 'b', '/': 'D', '%': 'v', ',': 'a', other: 'b' };
  var ST_HALF = fix([' o', '=/'], 2);
  A.models.strut = {
    name: 'strut',
    desc: 'A bent brass strut from the Kestrel\'s gondola frame, lying on the rubble heap: riveted ends, a verdigris kink.',
    size: { w: 4, h: 3 }, anchor: { x: 1, y: 2 }, world: { w: 1.0, h: 0.5 },
    directions: ['S'], billboard: true,
    keys: { B: { c: 'brassLight' }, b: { c: 'brass' }, D: { c: 'brassDark' }, v: { c: 'verdigris' }, a: { c: 'ash' } },
    animations: { idle: { fps: 1, loop: true, frames: [frame(ST_ROWS, ST_MAP, null, autoN(ST_ROWS, [0], [], []))] } },
    lods: { half: { size: { w: 2, h: 2 }, anchor: { x: 1, y: 1 }, animations: { idle: { fps: 1, loop: true, frames: [frame(ST_HALF, ST_MAP)] } } } },
    collide: 'none (placed on the existing rubble cell R (14,8), 0.6 m)'
  };

  // =====================================================================================================
  // PROPOSED tower.js patch (D-011 reskin list). NOT applied: the game loads design/levels/tower.js; the swaps land
  // with the US-011 programmer pass. Positions are world metres in tower.js space; checked live in preview/tower.html.
  // =====================================================================================================
  A.levelPatch = A.levelPatch || {};
  A.levelPatch.tower = {
    status: 'PROPOSED (designer, v1.9 rework 2026-09-24). Apply with the US-011 programmer pass (prop spawn).',
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
