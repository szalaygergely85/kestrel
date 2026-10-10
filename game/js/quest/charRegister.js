// RIG-03w: register rigged .glb characters (bundle.models, from ?pack= packages) as ordinary 'char.<id>' models.
// Must run BEFORE VoxelPool.bind. A bad glb is reported (ContentError naming the id) and skipped: the game still boots.
import { ContentError, riggedFromGlb, collapseRig, riggedModelDef, HUMANOID_PART_MAP } from '../../../engine/index.js';

/**
 * @param {{add:Function}} registry
 * @param {Object<string,{kind:string,model:Object}>} [models] bundle.models
 * @param {(e:Error)=>void} [onError]
 * @returns {string[]} registered model keys
 */
export function registerRiggedChars(registry, models, onError = (e) => console.warn('[char] ' + e.message)) {
  const keys = [];
  for (const [id, entry] of Object.entries(models || {})) {
    if (!entry || entry.kind !== 'rigged') continue; // static entries are not characters
    const key = 'char.' + id;
    try {
      const partMap = (entry.model.extras && entry.model.extras.partMap) || HUMANOID_PART_MAP;
      registry.add('model', key, riggedModelDef(collapseRig(riggedFromGlb(entry.model), partMap)));
      keys.push(key);
    } catch (e) {
      onError(new ContentError(`model:${id}`, 'rigged', e && e.message ? e.message : String(e)));
    }
  }
  return keys;
}
