/*
 * ASCII Quest - boulder, mossy stone, 8 rotation frames. US-011 (5x4), ART-OWN-001 readability rework (12x8, half 6x4).
 *
 * ART-OWN-001: the old 5x4 ball was drawn ~5x enlarged at 4 m and its surface used the wall's own texture glyphs
 * (# % & @), so it read as a patch of wall. Now: a ROUND silhouette (12x8 cells = a circle in 2:3 cells) drawn with
 * contour glyphs  .-~~-.  ( )  / \  '-..-' , a moss cap on top, and a quiet stone plate inside that is lit from the
 * top (stoneLight rows 1-2 -> stoneMid rows 3-4 -> stoneDeep rows 5-6): the value ramp makes it look round.
 * Only a few surface marks (moss " , and cracks / \ -) scroll across the plate while it rolls.
 *
 * The silhouette never changes (readability); the surface marks scroll 3 columns per frame (one frame = 1/8 turn =
 * 2*pi*0.6/8 = 0.47 m, and the 12-cell front face shows half the circumference, ~0.16 m per cell).
 * Frame index INCREASES while the boulder rolls toward the viewer's LEFT (marks move left); step it backwards for
 * rolls to the right.
 * BUG-OWN-003: interior cells are OPAQUE SPACES (glyph ' ', real key) -> solid once the engine supports `fill`.
 * Format: design/README.md section 4. Sets ASSETS.models.boulder.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};

  // silhouette 12x8: contour glyphs + keys; '`' = interior (opaque space), plate key per row below
  //             0123456789AB
  var SIL_G = ['   .-~~-.   ',
               " .'``````'. ",
               '/``````````\\',
               '|``````````|',
               '|``````````|',
               '\\``````````/',
               " '.``````.' ",
               "   '-..-'   "];
  var SIL_K = ['   SmMMmS   ',
               ' SS      sd ',
               'S          d',
               'S          d',
               's          d',
               's          d',
               ' dd      dd ',
               '   dddddd   '];
  var PLATE = ['', 'S', 'S', 's', 's', 't', 't', ''];     // interior plate key per row (lit from the top)
  // surface marks: 24-long strips per interior row (period 24 = 8 frames x 3 columns); ' ' = plain plate
  var STRIP = ['',
               '  ",    \'      ",   .   ',
               '"  /    ,"    \'   \\  ", ',
               '   \'   \\     ,"    /    ',
               '  /    "     .    \\    " ',
               ' -    ,     /     ",    ',
               '   .     ,    -     \'   ',
               ''];
  var MARK = { '"': 'm', ',': 'M', '/': 'd', '\\': 'd', '-': 'd', "'": 'S', '.': 'S' };

  function normals(g) {
    return g.map(function (row, r) {
      var o = '', first = -1, last = -1, c;
      for (c = 0; c < row.length; c++) if (row.charAt(c) !== ' ') { if (first < 0) first = c; last = c; }
      for (c = 0; c < row.length; c++) {
        o += row.charAt(c) === ' ' ? '.' : r <= 1 ? 'u' : r >= 6 ? 'd' : c === first ? 'l' : c === last ? 'r' : 'f';
      }
      return o;
    });
  }
  var NROWS = normals(SIL_G);

  function rollFrame(k) {
    var g = [], fg = [], r, c;
    for (r = 0; r < SIL_G.length; r++) {
      var gr = '', kr = '', j = 0;
      for (c = 0; c < SIL_G[r].length; c++) {
        var ch = SIL_G[r].charAt(c);
        if (ch !== '`') { gr += ch; kr += SIL_K[r].charAt(c); continue; }
        var s = (STRIP[r] + '                        ').slice(0, 24), m = s.charAt((j + 3 * k + r * 5) % 24); j++;
        if (m === ' ') { gr += ' '; kr += PLATE[r]; } else { gr += m; kr += MARK[m]; }
      }
      g.push(gr); fg.push(kr);
    }
    return { S: { glyphs: g, fg: fg, n: NROWS } };
  }

  // half 6x4: same contour language, one mark per interior row, 8-long strips (1 column per frame)
  var HG = [' .~~. ', '(````)', '(````)', " '--' "];
  var HK = [' SmmS ', 'S    d', 's    d', ' dddd '];
  var HPLATE = ['', 'S', 't', ''];
  var HSTRIP = ['', ' "   /  ', '   ,   \\', ''];
  function halfFrame(k) {
    var g = [], fg = [], r, c;
    for (r = 0; r < HG.length; r++) {
      var gr = '', kr = '', j = 0;
      for (c = 0; c < HG[r].length; c++) {
        var ch = HG[r].charAt(c);
        if (ch !== '`') { gr += ch; kr += HK[r].charAt(c); continue; }
        var m = HSTRIP[r].charAt((j + k) % 8); j++;
        if (m === ' ') { gr += ' '; kr += HPLATE[r]; } else { gr += m; kr += MARK[m]; }
      }
      g.push(gr); fg.push(kr);
    }
    return { S: { glyphs: g, fg: fg } };
  }

  var frames = [], half = [], k;
  for (k = 0; k < 8; k++) { frames.push(rollFrame(k)); half.push(halfFrame(k)); }

  A.models.boulder = {
    name: 'boulder',
    desc: 'Round mossy boulder, radius 0.6 m: round contour, moss cap, a stone face lit from above. Rolls (US-013); ' +
          'sprite frame follows distance rolled.',
    size: { w: 12, h: 8 }, anchor: { x: 6, y: 7 }, world: { w: 1.2, h: 1.2 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: { s: { c: 'stoneMid' }, S: { c: 'stoneLight' }, d: { c: 'stoneDark' }, t: { c: 'stoneDeep' },
            m: { c: 'moss' }, M: { c: 'mossDark' } },
    roll: { framesPerTurn: 8, metersPerFrame: 0.471, forward: 'left' },
    placement: { note: 'US-013 visibility: the sprite anchor (bottom row) is the floor contact point. If the roller tracks the ' +
                 'sphere centre, draw the sprite at z = centre z - radius (0.6); world 1.2 x 1.2 m = the 0.6 m sphere. Spawned from the ' +
                 'tower prop `boulder` (dynamic: true) as entity tower.boulder; frame = rollFrame(rollDist).' },
    animations: { roll: { fps: 0, loop: true, frames: frames, note: 'fps 0 = driven by distance rolled, not time' } },
    lods: { half: { size: { w: 6, h: 4 }, anchor: { x: 3, y: 3 }, animations: { roll: { fps: 0, loop: true, frames: half } } } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
