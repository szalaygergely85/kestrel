// tools/probe-ob155.mjs (OB-155): lists world_m1 entities (+ content/local/placements.json overlay structures) whose base z is
// > 0.25 m above or > 0.4 m below the support under them (terrain, or a placed mesh top under the footprint); and bare quest anchors.
//   node tools/probe-ob155.mjs [--world world_m1]      exit 1 if anything is found
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { World } from '../engine/index.js';
import { getAssets } from './coplanar-lint.mjs';
import { supportBoxes } from './prop-ground-lint.mjs';

export const UP = 0.25, DOWN = 0.4;
/** support height under (x,y) for an object whose base is at z: terrain, or the highest mesh box top at most 0.6 m above z. */
export function supportAt(x, y, z, groundAt, boxes) {
  let s = groundAt(x, y);
  for (const b of boxes) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && b.z1 <= z + 0.6 && b.z1 > s) s = b.z1;
  return s;
}
export async function probe(worldId = 'world_m1') {
  globalThis.window = globalThis.window || globalThis;
  await import('../design/palette.js'); await import('../design/levels/overworld_far.js'); await import('../design/levels/world_geo.js');
  globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
  const { bundle, assets } = await getAssets();
  const w = World.load(assets.world(worldId), assets, { physics: 'mesh' });
  const g = (x, y) => w.terrain.groundAt(x, y), wd = bundle.worlds[worldId];
  let structs = wd.structures || [];
  try { const o = JSON.parse(await readFile(new URL('../content/local/placements.json', import.meta.url), 'utf8')); if (o.world === worldId) structs = structs.concat(o.structures || []); } catch { /* no overlay */ }
  const boxes = supportBoxes(structs, bundle.meshes), out = [];
  for (const e of wd.entities || []) {
    if (e.type === 'player' || typeof e.x !== 'number') continue;
    w.ensureBandFor(e.x, e.y);
    const v = e.components && e.components.voxel, model = v && v.model;
    if (typeof e.z !== 'number') { if (e.z !== 'ground' && e.z !== undefined) out.push({ id: e.id, kind: 'badz', msg: 'z=' + e.z }); continue; }
    const lv = (w.structures || []).find((st) => st.kind !== 'mesh' && st.bbox && e.x >= st.bbox.x0 && e.x <= st.bbox.x1 && e.y >= st.bbox.y0 && e.y <= st.bbox.y1); // inside a grid level (tower): its floor, not the terrain
    if (lv) continue;
    const sup = supportAt(e.x, e.y, e.z, g, boxes), d = +(e.z - sup).toFixed(2);
    if (d > UP || d < -DOWN) out.push({ id: e.id, kind: d > 0 ? 'float' : 'sunk', msg: `${e.type}/${model || '-'} (${e.x}, ${e.y}) z ${e.z} support ${sup.toFixed(2)} d ${d}` });
  }
  return out;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--world');
  const res = await probe(i > 0 ? process.argv[i + 1] : 'world_m1');
  for (const r of res) console.log(r.kind.padEnd(8), r.id.padEnd(22), r.msg);
  console.log(`probe-ob155: ${res.length} finding(s)`);
  process.exit(res.length ? 1 : 0);
}
