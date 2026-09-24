/*
 * ASCII Quest - US-011 rubble blocks (3 variants), straw pallet, beacon bowl (12x4).
 * Static props (one frame each). Format: design/README.md section 4.
 * Sets ASSETS.models.rubble (variants[]), ASSETS.models.pallet, ASSETS.models.beaconBowl.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  function still(g, c, n) { return { idle: { fps: 1, loop: true, frames: [{ S: { glyphs: g, fg: c, n: n } }] } }; }

  // ART-OWN-001: the old rubble used the wall/floor texture glyphs (# % & @) in the floor's own colours, so it vanished
  // into the rubble floor it lies on. Now each variant is a CUT BLOCK drawn as a box (top edge _ , top face /___/ ,
  // front face |___| , shadow side | / ): light stoneLight top, mid front, dark stoneDark side = one clear light
  // direction, plus a few pebbles / a moss patch. No texture glyphs. `fill` + `outline` (engine pending, BUG-OWN-003).
  //   C stoneLight edges   T stoneLight top face   M stoneMid front   D stoneDark side   s rubble pebble   m moss
  var RK = { C: { c: 'stoneLight' }, T: { c: 'stoneLight' }, M: { c: 'stoneMid' }, D: { c: 'stoneDark' },
             s: { c: 'rubble' }, m: { c: 'moss' }, O: { c: 'stoneMid' } };
  var FILL = { k: 0.45 }, OUTLINE = { k: 0.4 };
  function nrm(g) {   // top rows u, then l / f / r by silhouette
    return g.map(function (row, r) {
      var o = '', first = -1, last = -1, c;
      for (c = 0; c < row.length; c++) if (row.charAt(c) !== ' ') { if (first < 0) first = c; last = c; }
      for (c = 0; c < row.length; c++) o += row.charAt(c) === ' ' ? '.' : r < 2 ? 'u' : c === first ? 'l' : c === last ? 'r' : 'f';
      return o;
    });
  }
  // opaque-space placeholder '`' -> glyph ' ' (front-face plate, key M)
  function blk(g, k) { var gg = g.map(function (r) { return r.replace(/`/g, ' '); }); return still(gg, k, nrm(g)); }

  // Rubble: every variant is a full model; the level picks one with props[].variant (0..2).
  A.models.rubble = {
    name: 'rubble',
    desc: 'Fallen cut blocks and a few pebbles lying on the rubble heap cells (r/R/z/g, 0.3-0.9 m).',
    variants: [
      // rubble0 10x3: one low block + pebbles
      { name: 'rubble0', size: { w: 10, h: 3 }, anchor: { x: 4, y: 2 }, world: { w: 0.9, h: 0.35 },
        directions: ['S'], billboard: true, keys: RK, fill: FILL, outline: OUTLINE,
        animations: blk(['  ______  ', ' /_____/| ', '|_____|/o.'],
                        ['  CCCCCC  ', ' CTTTTTCD ', 'CMMMMMCDOs']),
        lods: { half: { size: { w: 5, h: 2 }, anchor: { x: 2, y: 1 }, animations: blk([' /_/|', '|__|/'], [' CTCD', 'CMMCD']) } } },
      // rubble1 12x5: a big block with a moss patch on its face + a pebble
      { name: 'rubble1', size: { w: 12, h: 5 }, anchor: { x: 5, y: 4 }, world: { w: 1.1, h: 0.6 },
        directions: ['S'], billboard: true, keys: RK, fill: FILL, outline: OUTLINE,
        animations: blk(['  ________  ', ' /_______/| ', '|%```````|| ', '|````````||o', '|________|/O'],
                        ['  CCCCCCCC  ', ' CTTTTTTTCD ', 'CmMMMMMMMCD ', 'CMMMMMMMMCDs', 'CMMMMMMMMCDO']),
        lods: { half: { size: { w: 6, h: 2 }, anchor: { x: 3, y: 1 }, animations: blk([' /__/|', '|__|/o'], [' CTTCD', 'CMMCDs']) } } },
      // rubble2 8x3: a small broken chunk + pebbles
      { name: 'rubble2', size: { w: 8, h: 3 }, anchor: { x: 3, y: 2 }, world: { w: 0.6, h: 0.3 },
        directions: ['S'], billboard: true, keys: RK, fill: FILL, outline: OUTLINE,
        animations: blk(['  .--.  ', ' /__/|o ', '|__|/oO.'],
                        ['  CCCC  ', ' CTTCDs ', 'CMMCDmOs']),
        lods: { half: { size: { w: 4, h: 2 }, anchor: { x: 2, y: 1 }, animations: blk([' /_/', '|_|o'], [' CTC', 'CMCs']) } } }
    ]
  };

  A.models.pallet = {
    name: 'pallet',
    desc: 'Straw pallet on a low wooden frame, 2 m long. The player wakes lying on it.',
    size: { w: 9, h: 2 }, anchor: { x: 4, y: 1 }, world: { w: 2.0, h: 0.3 },
    directions: ['S'], billboard: true,
    keys: { y: { c: 'straw' }, Y: { c: 'strawLight' }, z: { c: 'strawDark' }, w: { c: 'wood' }, h: { c: 'woodDark' } },
    animations: still(['.,;"\'";,.', '[=======]'], ['zyYYyYYyz', 'hwwwwwwwh'], ['uuuuuuuuu', 'fffffffff']),
    lods: { half: { size: { w: 5, h: 1 }, anchor: { x: 2, y: 0 }, animations: still(['["\'"]'], ['hYyYh']) } }
  };

  A.models.beaconBowl = {
    name: 'beaconBowl',
    desc: 'The cold beacon: a large iron bowl on short legs, heaped with grey ash. Stands on the 0.6 m stone plinth.',
    size: { w: 12, h: 4 }, anchor: { x: 6, y: 3 }, world: { w: 2.2, h: 1.0 },
    directions: ['S'], billboard: true,
    keys: { a: { c: 'ash' }, A: { c: 'ashLight' }, z: { c: 'ashDark' }, i: { c: 'iron' }, I: { c: 'ironLight' }, d: { c: 'ironDark' } },
    // US-022: the beaconFire sprite (12x4) is drawn with ITS anchor on bowl cell (6,0) -> fire bottom row covers the ash row
    mounts: { fire: { x: 6, y: 0 } },
    animations: still(
      ['   .,:;,.   ', '\\==:;::;:==/', ' \\#o####o#/ ', '  /\\    /\\  '],
      ['   zaAAaz   ', 'iIIaAaaAaIIi', ' idIddddIdi ', '  ii    ii  '],
      ['   uuuuuu   ', 'uuuuuuuuuuuu', ' lffffffffr ', '  ff    ff  ']),
    lods: { half: { size: { w: 6, h: 2 }, anchor: { x: 3, y: 1 }, mounts: { fire: { x: 3, y: 0 } },
      animations: still(['\\:;;:/', ' \\##/ '], ['iaAAai', ' iddi ']) } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
