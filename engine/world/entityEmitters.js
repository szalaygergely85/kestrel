// engine/world/entityEmitters.js (US-053a, docs/architecture.md 32.1).
//
// Attaches particle emitters to entities: `components.emitters: [{preset,
// offset:{right,fwd,up}, on}]` (JSON; `on` is saved, handles are not). The
// pair list (entity, entry, handle) is preallocated (max 64) and rebuilt
// lazily on the next sync() after world:loaded / entity:added / entity:removed
// (allocation is fine there). sync() runs once per step before particles.step():
// it writes transform + yaw-rotated offset and copies `on`. Existing pairs keep
// their emitter handle across rebuilds so live particles/accumulators survive.
import { forwardOf, rightOf } from '../core/transform.js';

export const MAX_ENTITY_EMITTERS = 64;

/**
 * @param {*} world        World (or null; follows world:loaded)
 * @param {*} particles    engine.particles
 * @param {*} events       engine Events (or null)
 * @param {(preset:string)=>number} defIdOf  preset key -> defId (-1 = unknown, skipped)
 */
export function createEntityEmitters(world, particles, events, defIdOf) {
  let w = world;
  let dirty = true;
  let n = 0;
  const ents = new Array(MAX_ENTITY_EMITTERS).fill(null);
  const entries = new Array(MAX_ENTITY_EMITTERS).fill(null);
  const handles = new Int32Array(MAX_ENTITY_EMITTERS).fill(-1);
  const fwd = [0, 0], right = [0, 0];

  function rebuild() {
    dirty = false;
    const oldN = n;
    const oldEnt = ents.slice(0, oldN), oldEntry = entries.slice(0, oldN);
    const oldH = Array.from(handles.subarray(0, oldN));
    const keep = new Uint8Array(oldN);
    n = 0;
    if (w) {
      w.forEachEntity((e) => {
        const list = e.components && e.components.emitters;
        if (!Array.isArray(list)) return;
        for (const entry of list) {
          if (n >= MAX_ENTITY_EMITTERS) return;
          let h = -1;
          for (let i = 0; i < oldN; i++) {
            if (oldEnt[i] === e && oldEntry[i] === entry) { h = oldH[i]; keep[i] = 1; break; }
          }
          if (h < 0 || !particles.isValid(h)) {
            const d = defIdOf(entry.preset);
            if (d < 0) continue;
            h = particles.createEmitter(d, e.transform.x, e.transform.y, e.transform.z);
            if (h < 0) continue;
          }
          ents[n] = e; entries[n] = entry; handles[n] = h; n++;
        }
      });
    }
    for (let i = 0; i < oldN; i++) if (!keep[i]) particles.release(oldH[i]);
    for (let i = n; i < MAX_ENTITY_EMITTERS; i++) { ents[i] = null; entries[i] = null; handles[i] = -1; }
  }

  const offs = [];
  if (events) {
    offs.push(events.on('world:loaded', (p) => {
      // old pairs stay: rebuild() releases the ones the new world no longer has
      if (p && p.world) w = p.world;
      dirty = true;
    }));
    offs.push(events.on('entity:added', () => { dirty = true; }));
    offs.push(events.on('entity:removed', () => { dirty = true; }));
  }

  return {
    get count() { return n; },
    /** Force a rebuild at the next sync (e.g. after editing components.emitters). */
    invalidate() { dirty = true; },
    sync() {
      if (dirty) rebuild();
      for (let i = 0; i < n; i++) {
        const e = ents[i], entry = entries[i], t = e.transform;
        const o = entry.offset;
        let x = t.x, y = t.y, z = t.z;
        if (o) {
          forwardOf(t.yawDeg || 0, fwd); rightOf(t.yawDeg || 0, right);
          const r = o.right || 0, f = o.fwd || 0;
          x += right[0] * r + fwd[0] * f;
          y += right[1] * r + fwd[1] * f;
          z += o.up || 0;
        }
        particles.setEmitterPos(handles[i], x, y, z);
        particles.setOn(handles[i], entry.on !== false);
      }
    },
    dispose() { for (const off of offs) off(); },
  };
}
