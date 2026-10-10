/*
 * Kestrel - GOLDEN POCKET COMPASS (HUD, bottom-right). COMPASS-D1, owner request D-061 (docs/decisions.md).
 * Owner: Designer. Format: design/README.md section 26 (+ section 5 UI rules). Preview: design/preview/compass.html.
 *
 * WHAT THIS FILE SETS (append-only: no existing uiStyle key or value is changed)
 *   ASSETS.uiStyle.compass   a small brass pocket compass with teal-tinted glass: face (glyph / fg / bg rows), a needle in
 *                            16 direction states (8-dir subset listed), a rotating N mark, the distance line, anchor,
 *                            visibility, animation timings. Pure data; the HUD module (programmer) draws it.
 *
 * NEEDLE MEANING (designer pick): the needle shows the target RELATIVE TO WHERE THE PLAYER LOOKS.
 *   up = straight ahead, right = turn right, down = behind you. dir index = round(rel / 22.5 deg) mod 16, clockwise,
 *   rel = wrap(bearingToTarget - cameraYaw) (both measured the same way, clockwise from the same zero).
 *   The small dim `N` on the glass is the true north and rides round the face with camera yaw (same formula, target =
 *   world north). So the needle answers "where do I walk", the N answers "where am I facing". The N is optional.
 *
 * GRID: every number is a cell of the FIXED 160x60 UI layer (uiStyle.uiGrid), so the compass is cell-identical at
 * 160x60 / 240x90 / 400x150 scene grids (12 x 18 px per glyph at 1920x1080: the small face is 132 x 126 px, round).
 * A UI cell is 12 x 18 px, so 1 row ~ 1.5 cols: the needle is 2 rows tall but 3 cols wide on purpose.
 *
 * COLOURS: fg = EXISTING palette.js keys (no palette edit); `hex` repeats them for hex-drawing callers (checked against
 * palette.js by the preview). bg = literal RGB (same convention as uiStyle.vitals / uiStyle.menu.bgRgb).
 * Hue families: brass/gold (case, needle head), teal glass (bg only + one verdigris glint), steel grey (needle tail) = 3.
 *
 * LOADING (classic script): AFTER models/title.js (title.js assigns ASSETS.uiStyle = {...}).
 *   game/index.html: <script src="../design/models/compass_ui.js"></script>
 *
 * SMALL FACE (11 x 7, default) + distance line          LARGE FACE (15 x 9, option)
 *
 *   c  0123456789A                                        c  0123456789ABCDE
 *   r0   _.-o-._     crown / bow knuckle 'o'              r0     _.-o-._
 *   r1  /   ^   \    (needle N state shown)               r1   .'   ^   '.
 *   r2 |    |    |                                        r2  /     |     \
 *   r3 |-   o   -|   hub 'o' = pivot (5,3)                r3 |      |      |
 *   r4 |    |    |   tail = steel                         r4 |-     o     -|   hub (7,4)
 *   r5  \   .   /                                         r5 |      |      |
 *   r6   `-===-'     '===' = the lid hinge barrel         r6  \           /
 *   r7     42 m      distance line (centred on the hub)   r7   '.   .   .'
 *                                                         r8     `-===-'
 *                                                         r9       42 m
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.uiStyle = A.uiStyle || {};

  // palette keys used (all exist in design/palette.js) and their hex
  var HEX = {
    brassHot: '#fff0b4', brassLight: '#f0d27a', brass: '#c9a04a', brassDark: '#7a5e28', brassShadow: '#4a3716',
    gold: '#ffd24a', uiText: '#e8e2d0', uiHint: '#a9a390', uiDim: '#6a6a78', verdigrisLight: '#80caa8'
  };
  // literal backgrounds (opaque UI cells: every drawn cell carries its own bg)
  var BG = {
    rim:     [34, 25, 9],    // dark brass body behind the rim glyphs (bg <= 30 % of the brass fg)
    rimLow:  [22, 16, 6],    // the shadowed bottom rim / hinge barrel
    glass:   [6, 21, 23],    // teal-tinted glass over a dark dial (the relay teal, but only as a deep bg tint)
    plate:   [10, 11, 16]    // distance line strip (= uiStyle.vitals textBg / menu plate)
  };
  // fg key per face fg-map char
  var FG_KEYS = { H: 'brassHot', L: 'brassLight', B: 'brass', D: 'brassDark', S: 'brassShadow', t: 'brassDark',
                  h: 'brassLight', g: 'verdigrisLight' };
  // bg per face bg-map char (' ' = not drawn: the scene shows through the corners)
  var BG_KEYS = { r: 'rim', R: 'rimLow', g: 'glass' };

  // needle cell = [dx, dy, glyph, role] relative to the hub; role: 'b' body, 't' tip, 'x' tail. Hub drawn last.
  // dir 0 = straight ahead (up), clockwise in 22.5 deg steps.
  var NEEDLE_SMALL = [
    /* 0 N   */ [[0, -1, '|', 'b'], [0, -2, '^', 't'], [0, 1, '|', 'x']],
    /* 1 NNE */ [[0, -1, '|', 'b'], [1, -2, '/', 't'], [0, 1, '|', 'x']],
    /* 2 NE  */ [[1, -1, '/', 'b'], [2, -2, '/', 't'], [-1, 1, '/', 'x']],
    /* 3 ENE */ [[1, 0, '-', 'b'], [2, -1, '-', 'b'], [3, -1, '>', 't'], [-1, 0, '-', 'x']],
    /* 4 E   */ [[1, 0, '-', 'b'], [2, 0, '-', 'b'], [3, 0, '>', 't'], [-1, 0, '-', 'x']],
    /* 5 ESE */ [[1, 0, '-', 'b'], [2, 1, '-', 'b'], [3, 1, '>', 't'], [-1, 0, '-', 'x']],
    /* 6 SE  */ [[1, 1, '\\', 'b'], [2, 2, '\\', 't'], [-1, -1, '\\', 'x']],
    /* 7 SSE */ [[0, 1, '|', 'b'], [1, 2, '\\', 't'], [0, -1, '|', 'x']],
    /* 8 S   */ [[0, 1, '|', 'b'], [0, 2, 'v', 't'], [0, -1, '|', 'x']],
    /* 9 SSW */ [[0, 1, '|', 'b'], [-1, 2, '/', 't'], [0, -1, '|', 'x']],
    /* 10 SW */ [[-1, 1, '/', 'b'], [-2, 2, '/', 't'], [1, -1, '/', 'x']],
    /* 11 WSW*/ [[-1, 0, '-', 'b'], [-2, 1, '-', 'b'], [-3, 1, '<', 't'], [1, 0, '-', 'x']],
    /* 12 W  */ [[-1, 0, '-', 'b'], [-2, 0, '-', 'b'], [-3, 0, '<', 't'], [1, 0, '-', 'x']],
    /* 13 WNW*/ [[-1, 0, '-', 'b'], [-2, -1, '-', 'b'], [-3, -1, '<', 't'], [1, 0, '-', 'x']],
    /* 14 NW */ [[-1, -1, '\\', 'b'], [-2, -2, '\\', 't'], [1, 1, '\\', 'x']],
    /* 15 NNW*/ [[0, -1, '|', 'b'], [-1, -2, '\\', 't'], [0, 1, '|', 'x']]
  ];
  var NEEDLE_LARGE = [
    /* 0 N   */ [[0, -1, '|', 'b'], [0, -2, '|', 'b'], [0, -3, '^', 't'], [0, 1, '|', 'x']],
    /* 1 NNE */ [[0, -1, '|', 'b'], [1, -2, '/', 'b'], [2, -3, '/', 't'], [0, 1, '|', 'x']],
    /* 2 NE  */ [[1, -1, '/', 'b'], [2, -2, '/', 'b'], [3, -3, '/', 't'], [-1, 1, '/', 'x']],
    /* 3 ENE */ [[1, 0, '-', 'b'], [2, 0, '-', 'b'], [3, -1, '-', 'b'], [4, -1, '>', 't'], [-1, 0, '-', 'x']],
    /* 4 E   */ [[1, 0, '-', 'b'], [2, 0, '-', 'b'], [3, 0, '-', 'b'], [4, 0, '-', 'b'], [5, 0, '>', 't'],
                 [-1, 0, '-', 'x'], [-2, 0, '-', 'x']],
    /* 5 ESE */ [[1, 0, '-', 'b'], [2, 0, '-', 'b'], [3, 1, '-', 'b'], [4, 1, '>', 't'], [-1, 0, '-', 'x']],
    /* 6 SE  */ [[1, 1, '\\', 'b'], [2, 2, '\\', 'b'], [3, 3, '\\', 't'], [-1, -1, '\\', 'x']],
    /* 7 SSE */ [[0, 1, '|', 'b'], [1, 2, '\\', 'b'], [2, 3, '\\', 't'], [0, -1, '|', 'x']],
    /* 8 S   */ [[0, 1, '|', 'b'], [0, 2, '|', 'b'], [0, 3, 'v', 't'], [0, -1, '|', 'x']],
    /* 9 SSW */ [[0, 1, '|', 'b'], [-1, 2, '/', 'b'], [-2, 3, '/', 't'], [0, -1, '|', 'x']],
    /* 10 SW */ [[-1, 1, '/', 'b'], [-2, 2, '/', 'b'], [-3, 3, '/', 't'], [1, -1, '/', 'x']],
    /* 11 WSW*/ [[-1, 0, '-', 'b'], [-2, 0, '-', 'b'], [-3, 1, '-', 'b'], [-4, 1, '<', 't'], [1, 0, '-', 'x']],
    /* 12 W  */ [[-1, 0, '-', 'b'], [-2, 0, '-', 'b'], [-3, 0, '-', 'b'], [-4, 0, '-', 'b'], [-5, 0, '<', 't'],
                 [1, 0, '-', 'x'], [2, 0, '-', 'x']],
    /* 13 WNW*/ [[-1, 0, '-', 'b'], [-2, 0, '-', 'b'], [-3, -1, '-', 'b'], [-4, -1, '<', 't'], [1, 0, '-', 'x']],
    /* 14 NW */ [[-1, -1, '\\', 'b'], [-2, -2, '\\', 'b'], [-3, -3, '\\', 't'], [1, 1, '\\', 'x']],
    /* 15 NNW*/ [[0, -1, '|', 'b'], [-1, -2, '\\', 'b'], [-2, -3, '\\', 't'], [0, 1, '|', 'x']]
  ];

  A.uiStyle.compass = {
    story: 'COMPASS-D1 (D-061); programmer story: the pure HUD module + mount',
    hex: HEX,
    bgRgb: BG,
    fgKeys: FG_KEYS,
    bgKeys: BG_KEYS,
    meaning: {
      needle: 'relative to the view: up = ahead, clockwise; dir = round(wrap(bearingToTarget - cameraYaw) / (360 / dirs)) mod dirs',
      nMark: 'true north relative to the view, same formula with bearing = world north; rides round the glass',
      hysteresis: { steps: 0.15, note: 'change dir only when rel is more than 0.5 + 0.15 steps away from the shown dir ' +
                    'centre (no flicker while the player looks along a border)' }
    },
    dirs: 16,
    dirs8: [0, 2, 4, 6, 8, 10, 12, 14],   // the 8-direction subset (use if 16 reads too busy; owner pick)
    names: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],

    // ---- faces (rows of glyph / fg-map / bg-map, 1 char per cell) ----
    face: 'small',                         // default on every grid (layer mode); 'large' = option (see scale)
    faces: {
      small: {
        w: 11, h: 7, hub: { x: 5, y: 3 },
        glyphs: [
          '  _.-o-._  ',
          ' /   \'   \\ ',
          '|         |',
          '|-   o   -|',
          '|         |',
          ' \\   .   / ',
          '  `-===-\'  '
        ],
        fg: [
          '  LLLHBDD  ',
          ' L   t   D ',
          'L         D',
          'Lt   h   tD',
          'B         D',
          ' B   t   S ',
          '  BDDDDSS  '
        ],
        bg: [
          '  rrrrrrr  ',
          ' rgggggggr ',
          'rgggggggggr',
          'rgggggggggr',
          'rgggggggggr',
          ' rgggggggr ',
          '  RRRRRRR  '
        ],
        glint: { x: 3, y: 1, glyph: '\'', fg: 'g', optional: true,
                 note: 'one cool glass highlight, top-left (light from top-left like every UI piece); drawn under the needle' },
        needle: NEEDLE_SMALL,
        nMark: { positions8: [[0, -2], [2, -2], [3, 0], [2, 2], [0, 2], [-2, 2], [-3, 0], [-2, -2]] }
      },
      large: {
        w: 15, h: 9, hub: { x: 7, y: 4 },
        glyphs: [
          '    _.-o-._    ',
          '  .\'   \'   \'.  ',
          ' /           \\ ',
          '|             |',
          '|-     o     -|',
          '|             |',
          ' \\           / ',
          '  \'.   .   .\'  ',
          '    `-===-\'    '
        ],
        fg: [
          '    LLLHBDD    ',
          '  LL   t   DD  ',
          ' L           D ',
          'L             D',
          'Lt     h     tD',
          'B             D',
          ' B           S ',
          '  BD   t   SS  ',
          '    BDDDDSS    '
        ],
        bg: [
          '    rrrrrrr    ',
          '  rrgggggggrr  ',
          ' rgggggggggggr ',
          'rgggggggggggggr',
          'rgggggggggggggr',
          'rgggggggggggggr',
          ' rgggggggggggr ',
          '  rrgggggggrr  ',
          '    RRRRRRR    '
        ],
        glint: { x: 4, y: 2, glyph: '\'', fg: 'g', optional: true, note: 'as small' },
        needle: NEEDLE_LARGE,
        nMark: { positions8: [[0, -3], [3, -3], [5, 0], [3, 3], [0, 3], [-3, 3], [-5, 0], [-3, -3]] }
      }
    },
    parts: {
      crown: 'the "o" in the top rim (brassHot) = the bow / winding knuckle of a pocket compass',
      hinge: 'the bottom "-===-" (dark brass on rimLow) = the lid hinge barrel; the lid is folded back out of sight',
      ticks: 'the dim brassDark marks at the 4 sides of the glass are neutral bezel ticks, NOT compass points (N moves)'
    },

    // ---- needle colours ----
    needleStyle: {
      tip:  { fg: 'gold', pulseTo: 'brassHot', periodSec: 1.4,
              note: 'tip = the goal end, warm gold (color language: warm = goal). fg lerps gold -> brassHot -> gold' },
      body: { fg: 'brassLight' },
      tail: { fg: 'uiDim', note: 'steel tail, cool and dim, so a diagonal "/" never reads both ways' },
      hub:  { glyph: 'o', fg: 'brassLight', near: { glyph: '*', fg: 'brassHot' } },
      drawOrder: ['face', 'glint', 'nMark', 'needle tail', 'needle body', 'needle tip', 'hub'],
      cellBg: 'needle cells keep the face bg under them (glass)'
    },
    nMark: { enabled: true, optional: true, glyph: 'N', fg: 'brassDark', dirs: 8,
             note: 'index = round(relNorth / 45 deg) mod 8 into face.nMark.positions8; the needle draws over it' },

    // ---- distance line ----
    distance: {
      rowsBelowFace: 0, align: 'hub', note: 'first row under the face, text centred on the hub column',
      format: { underKm: '{m} m', km: '{km} km', kmFrom: 1000, kmDecimals: 1,
                rule: 'm = round(horizontal distance); >= 1000 m -> km with 1 decimal (1.2 km)' },
      number: { fg: 'uiText' }, unit: { fg: 'uiHint' },
      kindMark: { giverHas: '!', giverReady: '?', step: null, fg: 'gold', gap: 1,
                  note: 'D-061: target = active step target, or a giver showing ! / ?: that glyph before the number' },
      height: { up: '^', down: 'v', fromM: 4, fg: 'uiHint', gap: 1, optional: true,
                note: 'after the unit when |target z - player z| >= 4 m (tower tops, cellars)' },
      here: { withinM: 3, text: 'here', fg: 'gold', note: 'replaces the number + unit at <= 3 m' },
      bg: 'plate', pad: 1, note: 'plate cells = text + 1 cell each side (opaque strip, reads on bright sky)',
      examples: ['42 m', '! 128 m', '? 9 m', '1.2 km', '37 m ^', 'here']
    },

    // ---- placement ----
    anchor: {
      corner: 'bottom-right', marginRight: 2, marginBottom: 1,
      rule: 'distance row y = 60 - 1 - marginBottom; face bottom row = that - 1; face right col = 160 - 1 - marginRight',
      small: { x: 147, y: 51, distanceRow: 58 },
      large: { x: 143, y: 49, distanceRow: 58 },
      note: 'UI-grid cells. Free corner: vitals top-left, hints bottom-left, toast top-centre, prompt under the crosshair. ' +
            'Long distance text grows left from the hub centre; it never reaches the hint column'
    },
    scale: {
      rule: 'layer mode (uiStyle.uiScale): the same small face on 160x60, 240x90 and 400x150 - same 132 x 126 px at ' +
            '1920x1080, because the UI layer is always 160x60. Do NOT scale it with the scene grid',
      large: 'option only: a "Compass size: large" setting or a UI scale > 1 picks faces.large (15 x 9 + distance row)',
      cellsFallback: 'uiScale.mode "cells" (CPU 160x60 only): small face, 1 scene cell per glyph, same numbers'
    },

    // ---- life ----
    visibleRule: 'D-061: shown only while a target is tracked; hidden on title / map card / menus / pack / notes / ' +
                 'dialogue / item-get card / death and end cards / capture modes (same gate as vitals + more)',
    fadeIn: 0.20, fadeOut: 0.20, fadeRule: 'uiStyle.fade (ramp-step dim, no alpha)',
    newTarget: { ms: 180, rimTo: 'brassHot', note: 'target changed: every L / B rim cell flashes brassHot for 180 ms ' +
                 '(a little "ping" of the brass), then normal' },
    swing: { minSteps: 3, overshootSteps: 1, overshootMs: 90,
             note: 'follow-through: when dir jumps by >= 3 steps (new target, fast turn) show dir + 1 step past the ' +
                   'new value (same turning sense) for 90 ms, then settle. Smaller changes snap' },
    near: { withinM: 3, tipPeriodSec: 0.5, note: 'within 3 m: hub becomes "*", tip pulse speeds up, distance says "here"' }
  };

  if (typeof module === 'object' && module && module.exports) module.exports = A.uiStyle.compass;
})(typeof window !== 'undefined' ? window : globalThis);
