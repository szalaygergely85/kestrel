// ED-MESH-1g (architecture.md 38.26): the async mesh click as one testable unit. Click -> guard.begin ->
// `await pickAt` (frame.readSurface + resolveMeshPick, structure id never from a GI objectId) -> stale? drop.
// Returns the decision; main.js applies it to the selection/undo model (this module touches neither).
import { pickAt } from './pick.js';

/** @returns {Promise<{action:'stale'}|{action:'mesh',structureId:string,world:Object,result:Object}|{action:'clear',result:Object}|{action:'other',result:Object}>} */
export async function resolveMeshClick(guard, col, row, ctx, tok = guard.begin()) { // tok: reuse the caller's token (main.js begins one at mousedown)
  const result = await pickAt(col, row, ctx);
  if (guard.isStale(tok)) return STALE;
  if (result.kind === 'meshStructure' && result.structureId) return { action: 'mesh', structureId: result.structureId, world: result.world, result };
  if (result.kind === 'sky') return { action: 'clear', result }; // empty sky clears the selection (box-select start)
  return { action: 'other', result };
}
const STALE = { action: 'stale' };
