// CH1-03: Aether crystal grant (arch 38.37 item 3). When the boar quest is ready (or past it) and
// `aether.attuned` is unset: addItem('aetherCrystal'), set the flag, teal burst at the last boar, toast.
// Pure: every effect is injected. Idempotent; the flag (world.state) is the real gate, so a full pack is fine.
export const FLAG_ATTUNED = 'aether.attuned';
export const ITEM = 'aetherCrystal';
export const TOAST_KEY = 'toast.crystal.found'; // CH1-W3: "A crystal glints where the boar fell."

import { READY, DONE } from './sim/questBook.js';
const NAMES = { ready: READY, done: DONE };

/** Status of burl.boars from a number, name, or {status} / {burl:{boars:..}} / {'burl.boars':..}. */
function statusOf(q) {
  if (q && typeof q === 'object') q = q.status ?? q['burl.boars'] ?? (q.burl && q.burl.boars);
  if (q && typeof q === 'object') q = q.status;
  return typeof q === 'string' ? (NAMES[q] ?? 0) : (q | 0);
}

/**
 * @param {{world:{state:object}, addItem:(id:string)=>any, questFlag:(name:string)=>any,
 *   burst:(x:number,y:number,z:number)=>void, toast:(key:string)=>void}} deps
 */
export function createCrystalGrant({ world, addItem, questFlag, burst, toast }) {
  let lx = 0, ly = 0, lz = 0, known = false; // last boar corpse (scalars: no alloc per call)
  return {
    /** Call on every boar death/corpse so the burst lands where the last one fell. */
    noteBoar(x, y, z) { lx = x; ly = y; lz = z; known = true; },
    /** Call on quest:ready for burl.boars and once per world:loaded. Returns true when it granted. */
    check(questState) {
      if (statusOf(questState) < READY) return false;
      if (world.state[FLAG_ATTUNED]) return false;
      addItem(ITEM); // full pack: result ignored, the flag still decides
      questFlag(FLAG_ATTUNED);
      world.state[FLAG_ATTUNED] = true; // idempotent even if questFlag is async/deferred
      if (known && burst) burst(lx, ly, lz);
      if (toast) toast(TOAST_KEY);
      return true;
    },
  };
}
