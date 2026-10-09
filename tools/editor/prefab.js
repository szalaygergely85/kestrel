// ED-GROUP-1c: selection snapshots and ordinary command batches; no DOM.
import { prefabFromJSON, placePrefabItems, localYawToWorld, worldYawToLocal, wrapDeg, MAX_LIGHTS } from '../../engine/index.js';
import { worldToItem, fileKey, mintId } from './doc.js';
import { groupSnapshot } from './groupOps.js';
import { classifyPlacement, validateItem, countLights } from './panel.js';
import { makeInsertRecord } from './commands.js';

export function prefabSlug(title) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : `prefab_${slug || 'selection'}`;
}

export function selectionToPrefab(doc, world, selections, title, id = prefabSlug(title)) {
  const snapshot = groupSnapshot(doc, world, selections);
  const items = snapshot.members.map((m, i) => {
    const item = structuredClone(m.before);
    const type = m.item.collection === 'lights' ? 'light' : 'prop';
    if (m.item.collection === 'entities') {
      if (Object.keys(item.components || {}).some(k=>k !== 'voxel')) throw new Error('prefabs support visual props only; select a plain voxel prop');
      const voxel = item.components?.voxel;
      if (voxel) {
        item.model = voxel.model;
        for (const key of ['scale', 'castShadow', 'collide']) if (key in voxel) item[key] = voxel[key];
      }
      delete item.components;
    }
    for (const key of ['id', 'type', 'group', 'prefab', 'structId', 'prop', 'light', 'flameProp', 'behaviours']) delete item[key];
    item.id = `item_${i + 1}`;
    item.type = type;
    item.x = m.point.x - snapshot.pivot.x;
    item.y = m.point.y - snapshot.pivot.y;
    item.z = m.point.z - snapshot.pivot.z;
    if (type === 'prop') {
      const yaw = m.before.facing ?? m.before.yawDeg ?? 0;
      item.facing = m.frame ? localYawToWorld(m.frame, yaw) : wrapDeg(yaw);
      delete item.yawDeg;
    }
    return item;
  });
  const obj = {kind:'prefab', schema:1, id, nextId:items.length + 1, title:title.trim() || id, items};
  prefabFromJSON(obj);
  return obj;
}

/** Validate each stamp before minting; refused members are reported, not inserted. */
export function prefabPlacement(doc, world, assets, prefab, at) {
  const batch = [], selections = [], errors = [], siblings = new Map();
  let group = null;
  const usedGroups = new Set([...doc.files.values()].flatMap(f=>Object.values(f.def).filter(Array.isArray).flat().map(it=>it.group).filter(Boolean)));
  let lights = countLights(doc);
  for (const {type, item: source} of placePrefabItems(prefab, at)) {
    const {zone, structure:s} = classifyPlacement(world, source);
    if (zone === 'gap' || (!s && type === 'light')) {
      errors.push(`${type}: ${zone === 'gap' ? 'no floor here' : 'must be inside a structure'}`); continue;
    }
    if (type === 'light' && lights >= MAX_LIGHTS) { errors.push('light: MAX_LIGHTS reached'); continue; }
    const fid = s ? fileKey('level', s.level.name) : fileKey('world', doc.worldId);
    const file = doc.files.get(fid);
    if (!file) { errors.push(`${type}: no open target file`); continue; }
    const collection = s ? (type === 'light' ? 'lights' : 'props') : 'entities';
    const item = structuredClone(source), yaw = source.facing ?? source.yawDeg ?? 0;
    Object.assign(item, worldToItem(s?.frame || null, source.x, source.y, source.z));
    if (type === 'prop') {
      delete item.facing; delete item.yawDeg;
      if (s) item.facing = worldYawToLocal(s.frame, yaw);
      else {
        item.type = 'prop'; item.yawDeg = wrapDeg(yaw);
        item.components = {voxel:{model:item.model}}; delete item.model;
      }
    }
    // Temporary valid ID only for validation; IDs are consumed solely for accepted items.
    item.id = 'prefab_candidate';
    const invalid = validateItem(s ? type : 'entity', item, {assets, palette:assets.palette});
    if (type === 'light' && typeof item.preset !== 'string') invalid.push('preset: required');
    if (invalid.length) { errors.push(`${type}: ${invalid.join('; ')}`); continue; }
    if (!siblings.has(fid)) siblings.set(fid, new Set(Object.values(file.def).filter(Array.isArray).flat().map(it=>it.id).filter(Boolean)));
    const used = siblings.get(fid);
    const fresh = prefix => { let id; do { id=mintId(file,prefix); } while (used.has(id)); used.add(id); return id; };
    if (!group) { do { group=fresh('group'); } while (usedGroups.has(group)); }
    item.id = fresh(type); item.group = group; item.prefab = prefab.id;
    batch.push(makeInsertRecord(fid, collection, item));
    selections.push({fileId:fid, collection, id:item.id, structId:s?.id || null});
    if (type === 'light') lights++;
  }
  return {record:batch.length ? {label:`place prefab ${prefab.id}`, batch} : null,
    selection:{items:selections, primary:selections.length ? 0 : -1}, errors};
}
