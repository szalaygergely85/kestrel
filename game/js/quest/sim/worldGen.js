// WMP-09/WMP-04 shared generation order (authored -> regional herds -> far camps). Pure in (geo, terrain, seed, authored homes):
// ids generated earlier (`<species>.<key>.n`, `gobF.*`) are never in `avoid`, so a fresh world and one restored from a save give identical defs.
// Used by main.js, tools/far-camps-dump.mjs, tools/region-save-sweep.mjs. Spawning stays with spawnRegionalBeasts / goblinWire.addFarCamps (add missing ids only).
import { generateRegionalBeasts, authoredHomes, safeSpots } from './regionalBeasts.js';
import { generateFarCamps } from '../../life/farCamps.js';

export { authoredHomes };

/** @returns {{herd:Array, camps:Array}} call after the authored goblin camps are in the world (their homes are authored avoid points). */
export function planWorldLife(world, geo, seed = 12) {
  const authored = authoredHomes(world);
  const herd = generateRegionalBeasts({ geo, terrain: world.terrain, seed, avoid: authored, safe: safeSpots(world) });
  const camps = generateFarCamps({ geo, terrain: world.terrain, seed, avoid: authored.concat(herd.map((b) => [b.x, b.y])) });
  return { herd, camps };
}
