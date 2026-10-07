// ED-MESH-01b: placement data contract (architecture.md 37.20).
import { mintId } from './doc.js';
import { classifyPlacement } from './panel.js';

export const LIFT = Object.freeze({ tree: 0.2, rock: 0.15, rockpath: -0.02, pebble: -0.01, grass: 0, mushroom: 0, other: 0 });
export const SHADOW = Object.freeze({ tree: true, rock: true, rockpath: false, pebble: false, grass: false, mushroom: false, other: true });

export function meshClass(key) {
  const name = key.split('/').at(-1);
  return /Tree/.test(name) ? 'tree' : /^Rock_/.test(name) ? 'rock' : /^RockPath/.test(name) ? 'rockpath'
    : /^Pebble/.test(name) ? 'pebble' : /^Grass/.test(name) ? 'grass' : /^Mushroom/.test(name) ? 'mushroom' : 'other';
}
export const roundMeshPosition = v => +v.toFixed(2);
export const meshYaw = v => ((Math.round(v) % 360) + 360) % 360;

/** Highest of the centre and four footprint samples; a courtyard gap is never a surface. */
export function snapMeshOrigin(world, mesh, key, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  x = roundMeshPosition(x); y = roundMeshPosition(y);
  const b = mesh.bbox, e = 0.25 * Math.max(b[3] - b[0], b[4] - b[1]);
  let highest = -Infinity;
  for (const [sx, sy] of [[x, y], [x + e, y], [x - e, y], [x, y + e], [x, y - e]]) {
    if (classifyPlacement(world, { x: sx, y: sy }).zone === 'gap') return null;
    const z = world.floorAt(sx, sy);
    if (!Number.isFinite(z)) return null;
    highest = Math.max(highest, z);
  }
  return { x, y, z: roundMeshPosition(highest + LIFT[meshClass(key)]) };
}

/** Errors follow validateItem's field-prefixed form. siblingIds excludes the edited item. */
export function validateMeshStructure(item, { assets, siblingIds = new Set(), nextId }) {
  const errors = [];
  if (typeof item.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.id)) errors.push('id: use letters, digits, underscore or hyphen; start with a letter');
  if (siblingIds.has(item.id)) errors.push('id: already used in structures');
  const suffix = typeof item.id === 'string' && /_(\d+)$/.exec(item.id);
  if (suffix && !(Number(suffix[1]) < nextId)) errors.push('id: minted suffix must be below nextId');
  if (typeof item.mesh !== 'string' || !assets.has('mesh', item.mesh)) errors.push('mesh: unknown registered mesh');
  for (const axis of ['x', 'y', 'z']) if (!Number.isFinite(item.origin?.[axis])) errors.push(`origin.${axis}: must be finite`);
  if (!Number.isInteger(item.yawDeg) || item.yawDeg < 0 || item.yawDeg > 359) errors.push('yawDeg: must be an integer from 0 to 359');
  for (const field of ['castShadow', 'collide']) if (field in item && typeof item[field] !== 'boolean') errors.push(`${field}: must be boolean`);
  const allowed = new Set(['id', 'mesh', 'origin', 'yawDeg', 'castShadow', 'collide', 'note']);
  for (const field of Object.keys(item)) if (!allowed.has(field)) errors.push(`${field}: unsupported mesh placement field`);
  if (item.origin && Object.keys(item.origin).some(k => !['x', 'y', 'z'].includes(k))) errors.push('origin: only x, y and z are supported');
  return errors;
}

export function validateMeshRename(id) {
  return /_\d+$/.test(id) ? ['id: numeric suffixes are reserved for minted ids'] : [];
}

/** Build + validate before minting. Does not insert into doc or mutate the runtime world. */
export function createMeshPlacement(file, key, pt, { assets, world, yawDeg = 0, snapStep = 0 }) {
  if (!assets.has('mesh', key)) return { item: null, errors: ['mesh: unknown registered mesh'], warnings: [] };
  const snap = v => snapStep > 0 ? Math.round(v / snapStep) * snapStep : v;
  const origin = snapMeshOrigin(world, assets.mesh(key), key, snap(pt.x), snap(pt.y));
  if (!origin) return { item: null, errors: ['origin: no floor or courtyard gap under mesh footprint'], warnings: [] };
  const item = { id: 'meshPreview', mesh: key, origin, yawDeg: meshYaw(yawDeg) };
  if (!SHADOW[meshClass(key)]) item.castShadow = false;
  const errors = validateMeshStructure(item, { assets, nextId: file.meta.nextId });
  if (errors.length) return { item: null, errors, warnings: [] };
  const siblingIds = new Set((file.def.structures || []).map(s => s.id));
  do { item.id = mintId(file, 'mesh'); } while (siblingIds.has(item.id));
  const nearby = (file.def.structures || []).filter(s => s.mesh && s.origin && Math.hypot(s.origin.x - origin.x, s.origin.y - origin.y) <= 64).length;
  return { item, errors: [], warnings: nearby + 1 > 60 ? ['More than 60 meshes within 64 m of this placement'] : [] };
}
