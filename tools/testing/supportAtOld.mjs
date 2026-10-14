// NAV-ALLOC-01 golden oracle: the frozen pre-change scalar World.supportAt body (git 1b6038a1^:engine/world/World.js).
import { probeSupport, meshSupportSector } from '../../engine/dev.js';
const sc = {}, sec = {}, nrm = {};
export function supportAtOld(world, x, y, footZ, grounded, opts) {
  probeSupport(world.colliders, world.colliders.length, x, y, footZ, grounded, opts, sc);
  let terrainZ = NaN, tnx = 0, tny = 0, tnz = 0;
  if (world.terrain && !world.structureAt(x, y)) {
    terrainZ = world.terrain.groundAt(x, y);
    if (terrainZ >= sc.floorZ) { const n = world.terrain.groundNormalAt(x, y, nrm); tnx = n.x; tny = n.y; tnz = n.z; }
  }
  return meshSupportSector(sc, terrainZ, tnx, tny, tnz, sec);
}
