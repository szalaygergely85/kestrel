// SCENE-INTERIOR: 'interior' | 'outdoor' for the biome atmosphere + post stack.
// Signal = the engine roof map (a finite sector ceiling above the player = indoors).
// Hysteresis: the raw reading must differ from the current scene for HOLD seconds
// (doorway jitter = no flicker). 0 alloc per call (roof map rebuilt only on a version change, throttled).
import { buildRoofMap, outdoorAt } from '../../../engine/index.js';

export const HOLD = 0.5;      // seconds the raw reading must persist before the scene flips
const EYE = 1.0;               // sample height above the player's feet (z)

/** scratch = {} reused across calls; fields: scene, roof, f, tick. */
export function sceneOf(world, p, scratch, dt = 1 / 60) {
  if (scratch.scene === undefined) { scratch.scene = 'outdoor'; scratch.roof = null; scratch.f = new Float64Array(1); scratch.tick = 0; }
  if ((scratch.tick++ & 15) === 0 && world) scratch.roof = buildRoofMap(world, scratch.roof); // version check; allocates only when a structure changed
  const raw = outdoorAt(scratch.roof, p.x, p.y, p.z + EYE) ? 'outdoor' : 'interior';
  if (raw === scratch.scene) scratch.f[0] = 0;
  else { scratch.f[0] += dt; if (scratch.f[0] >= HOLD) { scratch.scene = raw; scratch.f[0] = 0; } } // Float64Array: no boxed-double allocs
  return scratch.scene;
}
