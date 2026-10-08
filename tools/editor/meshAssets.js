// ED-MESH-01 discovery step: mesh entries are separate from placeable models.
const ICON_PREFIX = '@mesh/';
export const meshIconKey = key => ICON_PREFIX + key;
export const meshKeyFromIcon = key => key.startsWith(ICON_PREFIX) ? key.slice(ICON_PREFIX.length) : null;
export function iconAsset(assets, key) {
  const meshKey = meshKeyFromIcon(key);
  return meshKey === null ? assets.model(key) : assets.mesh(meshKey);
}
export function listMeshAssetGroups(assets, query = '') {
  const search = query.trim().toLowerCase(), groups = new Map();
  for (const key of assets.keys('mesh').sort()) {
    const pack = key.includes('/') ? key.split('/')[0] : 'Other';
    const label = pack[0].toUpperCase() + pack.slice(1);
    if (search && !(key + ' mesh ' + label).toLowerCase().includes(search)) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(key);
  }
  return Array.from(groups, ([pack, keys]) => ({ pack, keys }));
}
