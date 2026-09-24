/*
 * Kestrel - US-012 "brass lamp" (D-011 reskin of the US-011 lantern, 3x4): the Kestrel's gondola lamp, salvaged.
 * Unlit on its bracket (2-frame brass glint), lit, and the empty bracket (`empty`, alias `hookEmpty`).
 * Rework (US-011 CR): the brass bracket plate `=j=` is drawn in the unlit and empty states, so it visibly stays.
 * The model KEY stays `lantern` (and size 3x4, animations unlit / lit / empty (+ hookEmpty alias)) so level data,
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
  var N = ['fff', 'lur', 'lfr', 'lfr'];
  // empty bracket (after pickup): row 0 = brass bracket plate with the iron hook, row 1 = soot mark; rows 2-3 empty
  var EMPTY   = { S: { glyphs: ['=j=', " ' ", '   ', '   '], fg: ['DjD', ' g ', '   ', '   '], n: ['fff', '.f.', '...', '...'] } };
  var EMPTY_H = { S: { glyphs: ['=j=', '   '], fg: ['DjD', '   '] } };

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
    // variant name = animation name. `empty` is the canonical post-pickup state (US-012 `lantern.take` sets
    // sprite.variant = 'empty'); `hookEmpty` is kept as an alias with the same frames for older data.
    variants: ['unlit', 'lit', 'empty', 'hookEmpty'],
    animations: {
      // unlit, on the hook: long rest, short glint on the cap (per-frame durations in ms)
      unlit: { loop: true, durations: [2200, 260], frames: [
        { S: { glyphs: ['=j=', '/=\\', '{o}', '\\_/'], fg: ['DjD', 'bHb', 'bgb', 'DbD'], n: N } },
        { S: { glyphs: ['=j=', '/*\\', '{o}', '\\_/'], fg: ['DjD', 'bWb', 'bgB', 'DbD'], n: N } }
      ] },
      // lit (US-012 carried light / optional first-person view model), flame flicker
      lit: { fps: 8, loop: true, frames: [
        { S: { glyphs: [' j ', '/=\\', '{*}', '\\_/'], fg: [' j ', 'BHB', 'LcL', 'DBD'], n: N } },
        { S: { glyphs: [' j ', '/=\\', '{+}', '\\_/'], fg: [' j ', 'BHB', 'LmL', 'DBD'], n: N } }
      ] },
      // after pickup (variant 'empty'): the bracket stays - iron hook plus a brass bracket plate, a soot mark where
      // the lamp hung, nothing below it. Same 3x4 size and anchor, so the swap never moves the sprite.
      empty: { fps: 1, loop: true, frames: [EMPTY] },
      hookEmpty: { fps: 1, loop: true, frames: [EMPTY] }
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
        empty: { fps: 1, loop: true, frames: [EMPTY_H] },
        hookEmpty: { fps: 1, loop: true, frames: [EMPTY_H] }
      } }
    },
    interact: { prompt: '[E] Take lamp', radius: 1.8,
                note: 'D-011: level data (tower.js interactables) still says "[E] Take lantern"; see models/wreckage.js levelPatch' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
