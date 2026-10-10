// engine/chargen/cache.js (EQ-05, docs/architecture.md 38.40 item 6): createCharCache(kit, max = 4) -> {get(recipe), size, stats}.
// A recipe (look + gear picks) is composed once: compose -> mesh -> collapse -> riggedModelDef (<= 50 ms on a miss),
// then served from an LRU keyed by fnv1a32 of the recipe's canonical JSON (sorted keys). Never call per frame: a hit is a Map lookup.
import { composeCharacter } from './compose.js';
import { meshCharacter } from './mesh.js';
import { collapseRig, HUMANOID_PART_MAP } from './collapse.js';
import { riggedModelDef } from './rigModel.js';
import { CHAR_GAME_MAX_QUADS } from './recipe.js';

/** JSON with object keys sorted, undefined dropped (same recipe -> same string whatever the key order). */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function createCharCache(kit, max = 4) {
  const map = new Map(); // key -> {json, def}; insertion order = LRU order (oldest first)
  const stats = { hits: 0, misses: 0, lastMs: 0 };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return {
    /** @returns the RiggedVoxelDef ({voxel: ...}); the same recipe returns the same object. */
    get(recipe) {
      const json = canonicalJson(recipe);
      const key = fnv1a32(json);
      const e = map.get(key);
      if (e && e.json === json) { map.delete(key); map.set(key, e); stats.hits++; return e.def; }
      const t0 = now();
      const part = collapseRig(meshCharacter(composeCharacter(kit, recipe)), kit.partMap || HUMANOID_PART_MAP);
      if (part.mesh.quads > CHAR_GAME_MAX_QUADS) throw new Error(`charCache: ${part.mesh.quads} quads > CHAR_GAME_MAX_QUADS ${CHAR_GAME_MAX_QUADS}`);
      const def = riggedModelDef(part);
      stats.lastMs = now() - t0;
      stats.misses++;
      map.delete(key);
      map.set(key, { json, def });
      while (map.size > max) map.delete(map.keys().next().value);
      return def;
    },
    get size() { return map.size; },
    stats,
  };
}
