// TELEGRAPH-WIRE-01 part 1 (lane B1): beastSim state -> per-entity tint component (engine setTint).
// beastSim emits no windup/hurt events, so `step(nowMs)` polls state[]/hurtT[] once per frame and detects transitions
// 'hit' on charge end dropped (fired on wall ends too, unreadable): tint only windup + boar-hurt-by-sword.
// (zero alloc: preallocated prev arrays). windup start -> 'windup', damage
// taken (hurtT reset to 0) -> 'hurt'. Part 2 (kestrel-3) reads the tint component via fillEntityTints.
import { setTint } from '../../../engine/index.js';

const STATE_WINDUP = 3; // = beastSim STATE_* (kept local: sim is lane C, read only)
const MAX = 64;

export function telegraphsEnabled(params, captureLike) {
  return !captureLike && params.get('capture') !== '1' && params.get('fx') !== '0';
}

/** @returns {{step(nowMs:number):void, dispose():void}|null} null when disabled / no sim. */
export function wireTelegraphs(events, world, beastSim, enabled = true) {
  if (!enabled || !beastSim || !beastSim.entities) return null;
  const prevState = new Uint8Array(MAX), prevHurt = new Int32Array(MAX).fill(9999);
  const off = events && events.on ? events.on('beasts:reset', () => { prevState.fill(0); prevHurt.fill(9999); }) : null;
  return {
    step(nowMs) {
      const n = Math.min(beastSim.count, MAX), st = beastSim.state, hu = beastSim.hurtT, ents = beastSim.entities;
      for (let i = 0; i < n; i++) {
        const s = st[i], ps = prevState[i], h = hu[i];
        if (h < prevHurt[i]) setTint(ents[i], 'hurt', nowMs);                               // damage landed on the boar
        // OWNER 2026-10-09: no charge/windup tint (it painted the whole boar a flat orange blob up close); the windup CLIP is the telegraph.
        prevState[i] = s; prevHurt[i] = h;
      }
    },
    dispose() { if (typeof off === 'function') off(); },
  };
}
