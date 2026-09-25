/*
 * Kestrel - US-012 "brass lamp" (D-011 reskin of the US-011 lantern, 3x4): the Kestrel's gondola lamp, salvaged.
 * OWN-REQ-006: the lamp hangs LIT on its bracket by default (`lit`, flame in the cage, no glint - the flame and its
 * light are the "take me" cue now); `unlit` (2-frame brass glint) is kept as a spare state; the empty bracket
 * (`empty`, alias `hookEmpty`). Also sets ASSETS.models.lampFlame = the small flame billboard for the VOXEL lamp.
 * Rework (US-011 CR): the brass bracket plate `=j=` is drawn in the unlit and empty states, so it visibly stays.
 * The model KEY stays `lantern` (and size 3x4, animations unlit / lit / empty (+ hookEmpty alias)) so level data,
 * US-012 wiring and the sprite parity tests keep working; only the art and text changed.
 * Format: design/README.md section 4. Sets ASSETS.models.lantern.
 *
 * Look: a Ferrum ship's lamp. Brass cap with a band  /=\ , a round brass cage ( ) around a pale glass bulb O
 * (ART-OWN-001: was { } round a dark glass o), a brass fuel font \_/ at the foot. Machine accent = brass only.
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.models = A.models || {};
  var N = ['fff', 'lur', 'lfr', 'lfr'];
  // empty bracket (after pickup): row 0 = brass bracket plate with the iron hook, row 1 = soot mark; rows 2-3 empty
  var EMPTY   = { S: { glyphs: ['=j=', " ' ", '   ', '   '], fg: ['DjD', ' g ', '   ', '   '], n: ['fff', '.f.', '...', '...'] } };
  var EMPTY_H = { S: { glyphs: ['=j=', '   '], fg: ['DjD', '   '] } };

  // ART-OWN-001: size stays 3x4 / 3x2 (engine/render/gpu/sprites.test.js pins the lamp's rects). Readability comes from
  // value: bright brassLight cage ( ) and cap, a PALE GLASS bulb O (mirror) instead of the old dark ironDark glass
  // that vanished on the wall, dark brassDark fuel font at the bottom; `fill` + `outline` (engine pending, BUG-OWN-003).
  A.models.lantern = {
    name: 'lantern',
    displayName: 'brass lamp',
    desc: 'The Kestrel\'s brass lamp, hanging on its hook at 1.3 m. Bright brass cap and round cage, pale glass bulb, ' +
          'dark fuel font. It hangs lit (OWN-REQ-006): the flame in the cage and its warm light say "take me".',
    size: { w: 3, h: 4 }, anchor: { x: 1, y: 3 }, world: { w: 0.25, h: 0.45 },
    directions: ['S'], billboard: true,
    fill: { k: 0.45 }, outline: { k: 0.4 },
    keys: {
      j: { c: 'iron' },                      // hook
      b: { c: 'brass' }, B: { c: 'brassLight' }, D: { c: 'brassDark' }, H: { c: 'brassHot' },
      g: { c: 'mirror' },                    // cold glass bulb: pale, reads against stone (was ironDark)
      W: { c: 'white', e: true },            // glint (emissive so it pops even in shade)
      L: { c: 'lantern', e: true },          // lit glass glow through the cage
      c: { c: 'flameCore', e: true }, m: { c: 'flameMid', e: true }
    },
    // variant name = animation name. `empty` is the canonical post-pickup state (US-012 `lantern.take` sets
    // sprite.variant = 'empty'); `hookEmpty` is kept as an alias with the same frames for older data.
    variants: ['unlit', 'lit', 'empty', 'hookEmpty'],
    animations: {
      // unlit, on the hook: long rest, short glint on the cap (per-frame durations in ms)
      unlit: { loop: true, durations: [1800, 260], frames: [
        { S: { glyphs: ['=j=', '/=\\', '(O)', '\\_/'], fg: ['DjD', 'BHB', 'BgB', 'DbD'], n: N } },
        { S: { glyphs: ['=j=', '/*\\', '(O)', '\\_/'], fg: ['DjD', 'BWB', 'BgH', 'DbD'], n: N } }
      ] },
      // lit = the DEFAULT hanging state (OWN-REQ-006): bracket plate =j= drawn like unlit/empty, flame flicker in the
      // cage (this billboard fallback carries its own flame; do NOT also spawn lampFlame on it). No glint.
      lit: { fps: 8, loop: true, frames: [
        { S: { glyphs: ['=j=', '/=\\', '(*)', '\\_/'], fg: ['DjD', 'BHB', 'LcL', 'DBD'], n: N } },
        { S: { glyphs: ['=j=', '/=\\', '(+)', '\\_/'], fg: ['DjD', 'BHB', 'LmL', 'DBD'], n: N } }
      ] },
      // after pickup (variant 'empty'): the bracket stays - iron hook plus a brass bracket plate, a soot mark where
      // the lamp hung, nothing below it. Same 3x4 size and anchor, so the swap never moves the sprite.
      empty: { fps: 1, loop: true, frames: [EMPTY] },
      hookEmpty: { fps: 1, loop: true, frames: [EMPTY] }
    },
    lods: {
      half: { size: { w: 3, h: 2 }, anchor: { x: 1, y: 1 }, animations: {
        unlit: { loop: true, durations: [1800, 260], frames: [
          { S: { glyphs: ['/=\\', '(O)'], fg: ['BHB', 'BgB'] } },
          { S: { glyphs: ['/*\\', '(O)'], fg: ['BWB', 'BgB'] } }
        ] },
        lit: { fps: 8, loop: true, frames: [
          { S: { glyphs: ['/=\\', '(*)'], fg: ['BHB', 'LcL'] } },
          { S: { glyphs: ['/=\\', '(+)'], fg: ['BHB', 'LmL'] } }
        ] },
        empty: { fps: 1, loop: true, frames: [EMPTY_H] },
        hookEmpty: { fps: 1, loop: true, frames: [EMPTY_H] }
      } }
    },
    interact: { prompt: '[E] Take lamp', radius: 1.8,
                note: 'D-011: level data (tower.js interactables) still says "[E] Take lantern"; see models/wreckage.js levelPatch' }
  };

  // ---- OWN-REQ-006 D1: lampFlame = the flame inside the VOXEL lamp's open cage (ASSETS.voxelModels.lantern) ----
  // Anchored (bottom centre) at the voxel lantern mount `flame` [4,4,5] (burner top). The cage opening is 4 voxels
  // (0.125 m) wide and 5 voxels (0.156 m) tall under the hood, so the flame is 0.09 x 0.13 m: it sits inside, the near
  // brass posts cut it (depth test). Heat keys = the brazier flame unit (1 tip .. 4 core), ALL cells emissive.
  // Calmer than the brazier: the white-yellow core at the foot never moves, only the tips sway (4 frames, 9 fps).
  // About 3x4 cells at 2 m on 160x60 (the half LOD 1x2 takes over from ~4 m / on small grids).
  var FL_KEYS = { '1': { c: 'flameTip', e: true }, '2': { c: 'flameOuter', e: true },
                  '3': { c: 'flameMid', e: true }, '4': { c: 'flameCore', e: true } };
  function fl(g, h) { return { S: { glyphs: g, fg: h } }; }
  A.models.lampFlame = {
    name: 'lampFlame',
    desc: 'OWN-REQ-006: small steady brass-lamp flame in the voxel lamp cage (emissive core, swaying glyph tips).',
    size: { w: 3, h: 3 }, anchor: { x: 1, y: 2 }, world: { w: 0.09, h: 0.13 },
    directions: ['S'], billboard: true,
    keys: FL_KEYS,
    mountOn: { model: 'lantern', mount: 'flame', clip: 'lit',
               note: 'spawn only while the VOXEL lamp shows `lit`; remove on lanternTake (clip -> empty)' },
    animations: { burn: { fps: 9, loop: true, frames: [
      fl([" ' ", ' ^ ', "'*'"], [' 1 ', ' 3 ', '242']),
      fl([' . ', " ^'", "'*'"], [' 1 ', ' 31', '242']),
      fl([" ' ", ' * ', "^*'"], [' 1 ', ' 3 ', '342']),
      fl(['  .', "'^ ", "'*'"], ['  1', '13 ', '242'])
    ] } },
    lods: { half: { size: { w: 1, h: 2 }, anchor: { x: 0, y: 1 }, animations: { burn: { fps: 9, loop: true, frames: [
      fl(["'", '*'], ['2', '4']), fl(['^', '*'], ['3', '4']), fl(['.', '*'], ['1', '4']), fl(['^', '*'], ['2', '4'])
    ] } } } }
  };
})(typeof window !== 'undefined' ? window : globalThis);
