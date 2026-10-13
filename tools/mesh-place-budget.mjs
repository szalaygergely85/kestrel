#!/usr/bin/env node
// MESH-PLACE-01: triangle budget of the world_m1 mesh STRUCTURES (hand-placed + roadL + meadow mdw rows) in view at the gate poses,
// in Node. mesh-tri-budget.mjs only counts the instanced tree scatter; this adds the placed props on top.
//   node tools/mesh-place-budget.mjs [--pose hillside|roadSouth|breach] [--json]
// Frustum cull only (engine/mesh/culling.js classifyAABB on the mesh bbox grown by yaw), no distance/fog cull, no LOD (props have none).
// Prints, per pose: in-view props + triangles for the "before" set (mdw rows removed), the "after" set (all rows), and the delta.
globalThis.window = globalThis.window || globalThis;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { frustumPlanes, classifyAABB, CULL_OUT } from '../engine/mesh/culling.js';
import { frameMatrix } from '../engine/render/projection.js';
import { GRID } from './mesh-tri-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POSES = ['roadSouth', 'hillside', 'breach'];

/** Pure core: structures [{id, mesh, origin, yawDeg}], tris/bbox by mesh key, cam -> { props, tris, byClass }. */
export function budgetAt(structures, meshInfo, cam, grid = GRID) {
  const M = new Float64Array(16), planes = new Float64Array(24);
  frameMatrix(cam, grid, M, 'mesh'); frustumPlanes(M, planes);
  let props = 0, tris = 0;
  for (const s of structures) {
    const m = meshInfo[s.mesh]; if (!m) continue;
    const b = m.bbox, r = Math.max(Math.hypot(b[0], b[1]), Math.hypot(b[3], b[4]), Math.hypot(b[0], b[4]), Math.hypot(b[3], b[1]));   // yaw-safe radius
    const o = s.origin;
    if (classifyAABB(planes, o.x - r, o.y - r, o.z + b[2], o.x + r, o.y + r, o.z + b[5], 0) === CULL_OUT) continue;
    props++; tris += m.tris;
  }
  return { props, tris };
}

async function main() {
  const args = process.argv.slice(2);
  const which = args.includes('--pose') ? args[args.indexOf('--pose') + 1] : null;
  for (const f of ['palette', 'detail-pass', 'levels/overworld_far', ...['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'menu_ui', 'notes', 'brazier'].map((m) => 'models/' + m)]) await import(pathToFileURL(path.join(ROOT, 'design', f + '.js')).href);
  const { loadTestAssets } = await import('./testing/content-node.mjs');
  const { GATE_POSES } = await import('../content/dev-poses.js');
  const { assets } = await loadTestAssets();
  const wd = assets.world('world_m1');
  const meshes = {};
  for (const s of wd.structures) if (s.mesh && !meshes[s.mesh]) {
    const m = assets.mesh(s.mesh); meshes[s.mesh] = { bbox: Array.from(m.bbox), tris: m.triCount };
  }
  const { World } = await import('../engine/index.js');
  const world = World.load(wd, assets, {}); world.terrain.bakeFarSync();
  const all = wd.structures.filter((s) => s.mesh), before = all.filter((s) => !/^mdw\d+$/.test(s.id));
  const res = {};
  for (const slug of POSES) {
    if (which && which !== slug) continue;
    const p = GATE_POSES.find((q) => q.slug === slug).cam;
    const cam = { x: p.x, y: p.y, z: p.groundEye ? world.terrain.groundAt(p.x, p.y) + p.z : p.z, yawDeg: p.yawDeg, pitchDeg: p.pitchDeg };
    const a = budgetAt(before, meshes, cam), b = budgetAt(all, meshes, cam);
    res[slug] = { before: a, after: b, delta: { props: b.props - a.props, tris: b.tris - a.tris } };
  }
  if (args.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else for (const [k, v] of Object.entries(res)) console.log(`${k.padEnd(10)} props ${v.before.props} -> ${v.after.props} (+${v.delta.props})   tris ${v.before.tris} -> ${v.after.tris} (+${v.delta.tris})`);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
