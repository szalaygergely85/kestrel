// Local-only content overlay (owner 2026-10-07): third-party assets whose licence forbids
// redistribution (e.g. Synty) live in the git-ignored `content/local/` and are merged into the
// content bundle on this PC only. Absent folder = silent no-op, so a fresh clone runs unchanged.
//   content/local/manifest.json   - a normal content manifest listing the local mesh files
//   content/local/placements.json - {"world": "world_m1", "structures": [ ...same shape as world structures... ]}
// Skipped with `?nolocal=1` and in `?gpucompare=1` (gates must see the committed content only).
import { loadContentPack } from '../../engine/index.js';

/**
 * @param {any} bundle - result of loadContentPack for the main manifest (mutated)
 * @param {URLSearchParams} params
 * @param {string} [base] - URL of the local folder, relative to the page
 * @param {{lazyMeshes?: boolean}} [opts] - MESH-LOAD-01: same lazy setting as the main pack
 * @returns {Promise<boolean>} true when something was merged
 */
export async function applyLocalOverlay(bundle, params, base = '../content/local/', opts = {}) {
  if (params.get('nolocal') === '1' || params.get('gpucompare')) return false;
  let local;
  try {
    local = await loadContentPack(base + 'manifest.json', { lazyMeshes: !!opts.lazyMeshes });
  } catch (e) {
    return false; // no local folder on this PC
  }
  for (const id of Object.keys(local.meshes || {})) {
    bundle.meshes[id] = local.meshes[id];
    if (local.meta && local.meta.mesh && local.meta.mesh[id]) bundle.meta.mesh[id] = local.meta.mesh[id];
  }
  let placed = 0;
  try {
    const res = await fetch(base + 'placements.json');
    if (res.ok) {
      const p = await res.json();
      const world = bundle.worlds && bundle.worlds[p.world];
      if (world && Array.isArray(p.structures)) {
        world.structures = [...(world.structures || []), ...p.structures];
        placed = p.structures.length;
      }
    }
  } catch (e) {
    console.warn('[local] placements.json unreadable:', e.message);
  }
  console.info(`[local] overlay: ${Object.keys(local.meshes || {}).length} mesh(es), ${placed} placement(s) (content/local, not in git; ?nolocal=1 to disable)`);
  return true;
}
