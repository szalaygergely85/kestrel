// LIFE-HOOKS-01: game wiring for the living world (wolf raids). Keeps main.js small; every piece is plain-data testable.
// Gate: the raid quest's accept never lands in world.state (`q.<id>.accept` is a dialogue ACTION key -> questBook.actKey), so
// raids.json `requires` reads a state flag this module mirrors from the book (status >= ACTIVE).
import { createRaids } from './raids.js';

export const DAY_KEY = 'clock.day'; // whole game days elapsed (saved in world.state; the clock itself only stores the hour)
const ACTIVE = 2;

/** Mirror quest status into the raids' `requires` flags: defs[i].requires = 'life.gate.<questId>' -> state flag. */
export function syncGates(book, state, gates) {
  for (const key in gates) state[key] = !!book && book.statusOf(gates[key]) >= ACTIVE;
}

/** @returns {{step(hour:number):void, dispose():void, raids:object, sync():void}} one object for main.js */
export function createLifeWire({ defs, gates, sim, events, state, world, book }) {
  const anchors = {};
  for (const d of defs) { const e = world.entity ? world.entity(d.target) : null; if (e && e.transform) anchors[d.target] = [e.transform.x, e.transform.y]; }
  const npcPos = (id, out) => { const e = world.entity ? world.entity(id) : null; if (!e || !e.transform) return false; out.x = e.transform.x; out.y = e.transform.y; return true; };
  const raids = createRaids({ defs, sim, events, state, anchors, npcPos });
  let lastHour = state['clock.hour'] === undefined ? -1 : state['clock.hour'], syncT = 0;
  const sync = () => syncGates(typeof book === 'function' ? book() : book, state, gates);
  sync();
  return {
    raids, sync,
    /** once per sim step, after the clock ticked */
    step(hour) {
      if (hour < lastHour - 12) state[DAY_KEY] = (state[DAY_KEY] | 0) + 1; // midnight wrap (hour dropped from ~24 to ~0)
      lastHour = hour;
      if (++syncT >= 60) { syncT = 0; sync(); } // ~1 Hz is plenty for a quest gate
      raids.step(state[DAY_KEY] | 0, hour);
    },
    dispose() { raids.dispose(); },
  };
}

/** raids.json -> { defs, gates }: each `requires: "q.<questId>.accept"` becomes the state flag `life.gate.<questId>`. */
export function prepareRaidDefs(json) {
  const gates = {};
  const defs = (json.raids || []).map((r) => {
    const m = r.requires && /^q\.(.+)\.accept$/.exec(r.requires);
    if (!m) return { ...r };
    const key = 'life.gate.' + m[1]; gates[key] = m[1];
    return { ...r, requires: key };
  });
  return { defs, gates };
}
