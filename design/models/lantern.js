/*
 * Kestrel - US-012 "brass lamp" (D-011 reskin of the US-011 lantern, 3x4): the Kestrel's gondola lamp, salvaged.
 * Unlit on its hook (2-frame brass glint), lit, and the empty hook.
 * The model KEY stays `lantern` (and size 3x4, animations unlit / lit / hookEmpty, 2 frames each) so level data,
 * US-012 wiring and the sprite parity tests keep working; only the art and text changed.
 * Format: design/README.md section 4. Sets ASSETS.models.lantern.
 *
 * Look: a Ferrum ship's lamp. Brass cap with a band  /=\ , a round brass cage { } around the glass (the old
 * lantern had square [ ] iron-style bars), a brass fuel font \_/ at the foot. Machine accent = brass only.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var N = ['.f.', 'lur', 'lfr', 'lfr'];

  A.models.lantern = {
    name: 'lantern',
    displayName: 'brass lamp',
    desc: 'The Kestrel\'s brass lamp, hanging on its hook at 1.3 m. Brass cap, round brass cage, fuel font. ' +
          'The unlit one glints so it reads as "take me".',
    size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, world: { w: 0.25, h: 0.45 },
    directions: ['S'], billboard: true,
    keys: {
      j: { c: 'iron' },                      // hook
      b: { c: 'brass' }, B: { c: 'brassLight' }, D: { c: 'brassDark' }, H: { c: 'brassHot' },
      g: { c: 'ironDark' },                  // dark glass / cold wick
      W: { c: 'white', e: true },            // glint (emissive so it pops even in shade)
      L: { c: 'lantern', e: true },          // lit glass glow through the cage
      c: { c: 'flameCore', e: true }, m: { c: 'flameMid', e: true }
    },
    variants: ['unlit', 'lit', 'hookEmpty'],
    animations: {
      // unlit, on the hook: long rest, short glint on the cap (per-frame durations in ms)
      unlit: { loop: true, durations: [2200, 260], frames: [
        { S: { glyphs: [' j ', '/=\\', '{o}', '\\_/'], fg: [' j ', 'bHb', 'bgb', 'DbD'], n: N } },
        { S: { glyphs: [' j ', '/*\\', '{o}', '\\_/'], fg: [' j ', 'bWb', 'bgB', 'DbD'], n: N } }
      ] },
      // lit (US-012 carried light / optional first-person view model), flame flicker
      lit: { fps: 8, loop: true, frames: [
        { S: { glyphs: [' j ', '/=\\', '{*}', '\\_/'], fg: [' j ', 'BHB', 'LcL', 'DBD'], n: N } },
        { S: { glyphs: [' j ', '/=\\', '{+}', '\\_/'], fg: [' j ', 'BHB', 'LmL', 'DBD'], n: N } }
      ] },
      // after pickup: the hook stays, empty
      hookEmpty: { fps: 1, loop: true, frames: [
        { S: { glyphs: [' j ', '   ', '   ', '   '], fg: [' j ', '   ', '   ', '   '], n: N } }
      ] }
    },
    lods: {
      half: { size: { w: 3, h: 2 }, anchor: { x: 1, y: 1 }, animations: {
        unlit: { loop: true, durations: [2200, 260], frames: [
          { S: { glyphs: ['/=\\', '{o}'], fg: ['bHb', 'bgb'] } },
          { S: { glyphs: ['/*\\', '{o}'], fg: ['bWb', 'bgb'] } }
        ] },
        lit: { fps: 8, loop: true, frames: [
          { S: { glyphs: ['/=\\', '{*}'], fg: ['BHB', 'LcL'] } },
          { S: { glyphs: ['/=\\', '{+}'], fg: ['BHB', 'LmL'] } }
        ] },
        hookEmpty: { fps: 1, loop: true, frames: [{ S: { glyphs: [' j ', '   '], fg: [' j ', '   '] } }] }
      } }
    },
    interact: { prompt: '[E] Take lamp', radius: 1.8,
                note: 'D-011: level data (tower.js interactables) still says "[E] Take lantern"; see models/wreckage.js levelPatch' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
