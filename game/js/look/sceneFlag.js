// SCENE-INTERIOR: 'interior' | 'outdoor' for the biome atmosphere + post stack.
// SCENE-INTERIOR-2: also static mesh cover (ceiling within COVER_M above the eye, >= 3 of 5 sample points) and 'underwater' (body.diving).
// Signal = the engine roof map (a finite sector ceiling above the player = indoors).
// Hysteresis: the raw reading must differ from the current scene for HOLD seconds
// (doorway jitter = no flicker). 0 alloc per call (roof map rebuilt only on a version change, throttled).
import { buildRoofMap, outdoorAt } from '../../../engine/index.js';

export const HOLD = 0.5;      // seconds the raw reading must persist before the scene flips
const EYE = 1.0;               // sample height above the player's feet (z)
export const COVER_M = 6;      // a mesh ceiling must be within this many metres above the eye
const COVER_NEED = 3, SPREAD = 1.5; // 3 of 5 points (centre + 4 at +-SPREAD m) ignore tree canopies / single thin beams
const OFS = [0, 0, SPREAD, 0, -SPREAD, 0, 0, SPREAD, 0, -SPREAD];

/** 0-alloc: true when static mesh geometry covers the player (probeSupportIo ceiling hits via World.supportAtOut). */
function meshCovered(world, p, io) {
  if (!world || !world.supportAtOut) return false;
  const eyeZ = p.z + EYE; let n = 0;
  for (let i = 0; i < 10; i += 2) {
    io[0] = p.x + OFS[i]; io[1] = p.y + OFS[i + 1]; io[2] = eyeZ;
    world.supportAtOut(false, null, io);
    const c = io[9];
    if (c === c && c - eyeZ <= COVER_M) n++;
  }
  return n >= COVER_NEED;
}

/** scratch = {} reused across calls. body (optional) = player body; body.diving -> 'underwater'. Returns 'outdoor'|'interior'|'underwater'. */
export function sceneOf(world, p, scratch, dt = 1 / 60, body = null) {
  if (scratch.scene === undefined) { scratch.scene = 'outdoor'; scratch.roof = null; scratch.f = new Float64Array(1); scratch.tick = 0; scratch.io = new Float64Array(10); scratch.cover = false; }
  if (world) scratch.world = world;
  if ((scratch.tick++ & 15) === 0 && world) scratch.roof = buildRoofMap(world, scratch.roof); // version check; allocates only when a structure changed
  if ((scratch.tick & 7) === 1) scratch.cover = meshCovered(scratch.world, p, scratch.io); // throttled: 5 upward rays
  const raw = body && body.diving ? 'underwater' : (scratch.cover || !outdoorAt(scratch.roof, p.x, p.y, p.z + EYE)) ? 'interior' : 'outdoor';
  if (raw === scratch.scene) scratch.f[0] = 0;
  else { scratch.f[0] += dt; if (scratch.f[0] >= HOLD) { scratch.scene = raw; scratch.f[0] = 0; } } // Float64Array: no boxed-double allocs
  return scratch.scene;
}
