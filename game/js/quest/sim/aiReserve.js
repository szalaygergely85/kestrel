// ED-AI-06: reserve slots for the editor's "Drop pack here" (dev/playtest runs only). The beast sim has a fixed slot table, so
// the test creatures are real beast entities parked as reserve (brain.reserve + group, down until aiTest.dropPack wakes them).
// Ids 'aitest.<kind>.<n>' match GENERATED_ID, so they never count as authored homes. Normal play never calls this.
import { MODEL, BODY } from './regionalBeasts.js';
import { KINDS } from './beastKinds.js';

/** Kinds that can be dropped (a model exists). */
export const RESERVE_KINDS = Object.freeze(Object.keys(MODEL).filter((k) => KINDS[k]));

/** Spawns `perKind` reserve entities per kind at `home` [x,y]. Returns the number added. */
export function addAiReserve(world, perKind = 12, home = [0, 0], kinds = RESERVE_KINDS) {
  let added = 0;
  const z = world.terrain && world.terrain.heightAt ? world.terrain.heightAt(home[0], home[1]) : 0;
  for (const k of kinds) {
    for (let n = 1; n <= perKind; n++) {
      const id = `aitest.${k}.${n}`;
      if (world.get(id)) continue;
      const brain = { kind: 'beast', home: [home[0], home[1]], temperament: 'wary', reserve: true, group: `aireserve.${k}` };
      if (k !== 'boar') brain.species = k;
      world.spawn('beast', { x: home[0], y: home[1], z }, { voxel: { anim: 'idle', loop: true, model: MODEL[k] }, brain, targetable: { ...(BODY[k] || BODY.boar) } }, id);
      added++;
    }
  }
  return added;
}
