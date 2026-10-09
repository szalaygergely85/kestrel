// BINDINGS-WIRE-01: resolves the shipped keyboard binding table (quest/input/bindings.js) once into
// flat key-code fields for the per-frame input path. No per-frame lookups, no allocation.
import { createBindings } from './quest/input/bindings.js';

/** createBindings that never throws: an invalid/conflicting/unknown saved snapshot falls back to defaults. */
export function createSafeBindings(saved) {
  if (saved) { try { return createBindings(saved); } catch { /* fall through to defaults */ } }
  return createBindings();
}

/** Flat key codes for every gameplay action main.js reads (first bound code; run keeps both Shift codes).
 * An unbound action resolves to '' (never pressed). Rebuild after a settings change. */
export function resolveGameKeys(bindings) {
  const k = (a, i = 0) => bindings.get('keyboard', a)[i] || '';
  return Object.freeze({
    forward: k('forward'), backward: k('backward'), left: k('left'), right: k('right'),
    run: k('run', 0), run2: k('run', 1), jump: k('jump'), interact: k('interact'),
    useLeft: k('useLeft'), useRight: k('useRight'), swapHands: k('swapHands'),
    map: k('map'), mute: k('mute'),
  });
}
