// engine/chargen/random.js (CHARGEN-05, docs/architecture.md 38.29 item 4): randomRecipe(kit, seed) -> CharRecipe.
// xorshift32 stream, so the same kit + seed gives the same recipe on every platform. Optional kit.random weights:
//   {base:{id:w}, age:{young:w,..}, height:{"-4":w,..}, skin:{ramp:w}, eyes:{ramp:w}, <slot>:{none:w, <itemId>:w},
//    ramp:{<group>:{ramp:w}}}   a missing entry weighs 1 (height: bell-shaped default, slots: "none" weighs 1).
import { SLOTS, dyeGroupOf } from './kit.js';
import { slotItems, AGES, HEIGHT_MIN, HEIGHT_MAX } from './recipe.js';

const HEIGHT_DEFAULT = [1, 2, 4, 6, 8, 6, 4, 2, 1]; // -4..4

function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { // xorshift32 -> [0, 1)
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Weighted choice among `options` (strings); weights = table[opt] ?? dflt(opt). */
function choose(next, options, table, dflt = () => 1) {
  const w = options.map((o) => Math.max(0, table && table[o] !== undefined ? table[o] : dflt(o)));
  let total = 0;
  for (const x of w) total += x;
  if (!(total > 0)) return options[Math.floor(next() * options.length)];
  let r = next() * total;
  for (let i = 0; i < options.length; i++) { r -= w[i]; if (r < 0) return options[i]; }
  return options[options.length - 1];
}

export function randomRecipe(kit, seed) {
  const next = rng(seed);
  for (let i = 0; i < 4; i++) next(); // decorrelate small seeds
  const W = kit.random || {};
  const ramps = kit.ramps || {};
  const heights = [];
  for (let h = HEIGHT_MIN; h <= HEIGHT_MAX; h++) heights.push(String(h));
  const r = {
    v: 1,
    kit: kit.id,
    base: choose(next, Object.keys(kit.bases), W.base),
    height: 0,
    age: choose(next, AGES, W.age),
    skin: choose(next, Object.keys(ramps.skin || {}), W.skin),
    eyes: choose(next, Object.keys(ramps.eyes || {}), W.eyes),
  };
  r.height = Number(choose(next, heights, W.height, (h) => HEIGHT_DEFAULT[Number(h) - HEIGHT_MIN]));
  for (const slot of SLOTS) {
    const ids = [...new Set(slotItems(kit, slot).map((i) => i.id))];
    const id = choose(next, ['none', ...ids], W[slot]);
    const g = dyeGroupOf(slot);
    const rampIds = Object.keys(ramps[g] || {});
    // the ramp is always drawn so the stream stays aligned whether or not the slot is filled
    const ramp = rampIds.length ? choose(next, rampIds, W.ramp && W.ramp[g]) : '';
    r[slot] = id === 'none' ? null : { id, ramp };
  }
  r.seed = seed >>> 0;
  return r;
}
