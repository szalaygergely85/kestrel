// engine/content/prefabFile.js - PREFAB-SEAM (docs/architecture.md 38.11 / 37.11): `prefab` content kind.
// Pure (imports only core/transform + ContentError). A prefab is a set of plain prop/light items in
// prefab-local metres (pivot 0,0,0, yaw 0, z up). The game never reads prefabs; the editor stamps them.
// The engine never writes prefab files (the editor does, via stringifyContent).
import { rotateVec2, wrapDeg } from '../core/transform.js';
import { ContentError } from './ContentError.js';

export const PREFAB_ITEM_TYPES = ['prop', 'light'];
const FORBIDDEN_KEYS = ['group', 'prefab', 'structId', 'prop', 'light', 'flameProp'];
const MAX_ITEMS = 256;
const PREFAB_ID_RE = /^[a-z][a-z0-9_]*$/;

const fail = (field, reason) => { throw new ContentError('(prefab)', field, reason); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

/**
 * Validates a prefab file object and returns a frozen deep copy `{id, title, items}`.
 * Throws ContentError whose `field` is the path (e.g. `items[2].x`).
 */
export function prefabFromJSON(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('kind', 'prefab file is not an object');
  if (obj.kind !== 'prefab') fail('kind', `not a prefab file (kind must be "prefab", got ${JSON.stringify(obj.kind)})`);
  if (typeof obj.id !== 'string' || !PREFAB_ID_RE.test(obj.id)) fail('id', `bad or missing id ${JSON.stringify(obj.id)} (lowercase_underscore)`);
  if (obj.title !== undefined && typeof obj.title !== 'string') fail('title', 'title must be a string');
  const items = obj.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) fail('items', `items must be an array of 1..${MAX_ITEMS} objects`);
  items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) fail(p, 'item must be an object');
    if (!PREFAB_ITEM_TYPES.includes(it.type)) fail(`${p}.type`, `type must be one of ${PREFAB_ITEM_TYPES.join(', ')}, got ${JSON.stringify(it.type)}`);
    for (const k of ['x', 'y']) {
      if (!finite(it[k])) fail(`${p}.${k}`, `${k} must be a finite number`);
      if (Math.abs(it[k]) > 64) fail(`${p}.${k}`, `|${k}| must be <= 64 m, got ${it[k]}`);
    }
    if (!finite(it.z)) fail(`${p}.z`, 'z must be a finite number');
    if (it.z < -16 || it.z > 64) fail(`${p}.z`, `z must be within -16..64 m, got ${it.z}`);
    for (const k of ['facing', 'yawDeg']) if (it[k] !== undefined && !finite(it[k])) fail(`${p}.${k}`, `${k} must be a finite number`);
    if (it.type === 'prop' && (typeof it.model !== 'string' || !it.model)) fail(`${p}.model`, 'a prop needs a non-empty string model');
    for (const k of FORBIDDEN_KEYS) if (k in it) fail(`${p}.${k}`, `key "${k}" is not allowed in a prefab item (refs/ids are stripped at save)`);
  });
  return deepFreeze({ id: obj.id, title: obj.title === undefined ? obj.id : obj.title, items: structuredClone(items) });
}

/**
 * Stamps a prefab at a world pose. Returns `{type, item}[]` in world metres (ids dropped; the caller
 * mints fresh ones). Same convention as groupOps.updateGroupTransform, so place(yaw) == group-rotate(yaw).
 * Never mutates `prefab`.
 * @param {{items:object[]}} prefab
 * @param {{x:number,y:number,z:number,yawDeg:number}} at
 */
export function placePrefabItems(prefab, at) {
  const v = [0, 0];
  const yaw = at.yawDeg || 0;
  return prefab.items.map((src) => {
    const item = structuredClone(src);
    const { type } = item;
    delete item.type;
    delete item.id;
    rotateVec2(yaw, src.x, src.y, v);
    item.x = at.x + v[0];
    item.y = at.y + v[1];
    item.z = at.z + src.z;
    if (src.facing !== undefined) item.facing = wrapDeg(src.facing + yaw);
    if (src.yawDeg !== undefined) item.yawDeg = wrapDeg(src.yawDeg + yaw);
    return { type, item };
  });
}
