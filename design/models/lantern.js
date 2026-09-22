/*
 * ASCII Quest - US-011 lantern (3x4): unlit on its hook (2-frame brass glint), lit, and the empty hook.
 * Format: design/README.md section 4. Sets ASSETS.models.lantern.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var N = ['.f.', 'lur', 'lfr', 'lfr'];

  A.models.lantern = {
    name: 'lantern',
    desc: 'Brass lantern hanging on an iron hook at 1.3 m. The unlit one glints so it reads as "take me".',
    size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, world: { w: 0.25, h: 0.45 },
    directions: ['S'], billboard: true,
    keys: {
      j: { c: 'iron' },
      b: { c: 'brass' }, B: { c: 'brassLight' }, D: { c: 'brassDark' },
      g: { c: 'ironDark' },                  // dark glass / cold wick
      W: { c: 'white', e: true },            // glint (emissive so it pops even in shade)
      L: { c: 'lantern', e: true },          // lit glass glow
      c: { c: 'flameCore', e: true }, m: { c: 'flameMid', e: true }
    },
    variants: ['unlit', 'lit', 'hookEmpty'],
    animations: {
      // unlit, on the hook: long rest, short glint (per-frame durations in ms)
      unlit: { loop: true, durations: [2200, 260], frames: [
        { S: { glyphs: [' j ', '/^\\', '[o]', "'-'"], fg: [' j ', 'bBb', 'bgb', 'DDD'], n: N } },
        { S: { glyphs: [' j ', '/*\\', '[o]', "'-'"], fg: [' j ', 'bWb', 'bgB', 'DDD'], n: N } }
      ] },
      // lit (US-012 carried light / optional first-person view model), flame flicker
      lit: { fps: 8, loop: true, frames: [
        { S: { glyphs: [' j ', '/^\\', '[*]', "'-'"], fg: [' j ', 'BBB', 'LcL', 'DDD'], n: N } },
        { S: { glyphs: [' j ', '/^\\', '[+]', "'-'"], fg: [' j ', 'BBB', 'LmL', 'DDD'], n: N } }
      ] },
      // after pickup: the hook stays on the wall, empty
      hookEmpty: { fps: 1, loop: true, frames: [
        { S: { glyphs: [' j ', '   ', '   ', '   '], fg: [' j ', '   ', '   ', '   '], n: N } }
      ] }
    },
    lods: {
      half: { size: { w: 3, h: 2 }, anchor: { x: 1, y: 1 }, animations: {
        unlit: { loop: true, durations: [2200, 260], frames: [
          { S: { glyphs: ['/o\\', "'-'"], fg: ['bgb', 'DDD'] } },
          { S: { glyphs: ['/*\\', "'-'"], fg: ['bWb', 'DDD'] } }
        ] },
        lit: { fps: 8, loop: true, frames: [
          { S: { glyphs: ['/*\\', "'-'"], fg: ['LcL', 'DDD'] } },
          { S: { glyphs: ['/+\\', "'-'"], fg: ['LmL', 'DDD'] } }
        ] },
        hookEmpty: { fps: 1, loop: true, frames: [{ S: { glyphs: [' j ', '   '], fg: [' j ', '   '] } }] }
      } }
    },
    interact: { prompt: '[E] Take lantern', radius: 1.8 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
