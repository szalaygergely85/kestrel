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

  var RK = { s: { c: 'rubble' }, S: { c: 'stoneLight' }, d: { c: 'stoneDark' }, m: { c: 'moss' }, t: { c: 'stoneMid' } };

  // Rubble: every variant is a full model; the level picks one with props[].variant (0..2).
  A.models.rubble = {
    name: 'rubble',
    desc: 'Fallen blocks and gravel lying on the rubble heap cells (r/R/z/g, 0.3-0.9 m).',
    variants: [
      { name: 'rubble0', size: { w: 5, h: 2 }, anchor: { x: 2, y: 1 }, world: { w: 0.9, h: 0.35 },
        directions: ['S'], billboard: true, keys: RK,
        animations: still([' ,%#.', 'o%##%'], [' tSds', 'msdsd'], [' uuuu', 'lfffr']),
        lods: { half: { size: { w: 3, h: 1 }, anchor: { x: 1, y: 0 }, animations: still(['o%#'], ['sdS']) } } },
      { name: 'rubble1', size: { w: 6, h: 3 }, anchor: { x: 3, y: 2 }, world: { w: 1.1, h: 0.6 },
        directions: ['S'], billboard: true, keys: RK,
        animations: still([' ____ ', '[#%##]', 'o%&#%o'], [' SSSS ', 'dsStSd', 'sdsmds'], [' uuuu ', 'lffffr', 'lffffr']),
        lods: { half: { size: { w: 3, h: 2 }, anchor: { x: 1, y: 1 }, animations: still(['[#]', 'o%o'], ['dSd', 'sds']) } } },
      { name: 'rubble2', size: { w: 4, h: 2 }, anchor: { x: 2, y: 1 }, world: { w: 0.6, h: 0.3 },
        directions: ['S'], billboard: true, keys: RK,
        animations: still([' o. ', 'o%&o'], [' sS ', 'sdmd'], [' uu ', 'lffr']),
        lods: { half: { size: { w: 2, h: 1 }, anchor: { x: 1, y: 0 }, animations: still(['o%'], ['sd']) } } }
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
