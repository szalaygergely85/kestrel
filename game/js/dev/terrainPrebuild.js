// game/js/dev/terrainPrebuild.js - dev helper (engine/dev.js may only be imported from game/js/dev/**, main.js, tools/).
// Builds the terrain mesh (near band + far tiles) synchronously, like the gpucompare poses do, so a dev page that
// has no streaming budget to hide the build (game/rts-test.html) shows the ground on frame 1.
import { terrainMeshSetFor } from '../../../engine/dev.js';

/** @param {any} terrain a baked engine Terrain (farReady) */
export function prebuildTerrainMesh(terrain) {
  const set = terrainMeshSetFor(terrain);
  while (set.step(1000)) { /* until the near band is published */ }
}
