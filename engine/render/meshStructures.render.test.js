// ME-14c1 (docs/architecture.md 37.1): mesh structures next to a level in the JS frame path, plus the
// DrawList side (MeshDrawCache, addMeshStructures). Re-runs itself with --expose-gc (zero-alloc gate).
// Run: node engine/render/meshStructures.render.test.js
import { readMeshJSON } from '../test/meshFile.test.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON, createHasher } from '../index.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer, KIND_MESH } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
import { DrawList, DRAW_STATIC, MeshDrawCache, addMeshStructures, addStructures, LevelMeshCache, frameMatrix12 } from '../mesh/DrawList.js';
import { buildWorldColliders } from '../world/colliders.js';
import { KIND_MESH as KIND_MESH_GLTF } from '../mesh/gltf.js';
import { flatMat } from '../mesh/MeshData.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
const { assets: baseAssets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// Committed Ruins mesh via the content path (.mesh.json -> meshFromJSON), with a mats map for its one material.
const json = readMeshJSON(new URL('../../content/meshes/ruins/Fences/Line.mesh.json', import.meta.url));
const lineMesh = meshFromJSON(json);
lineMesh.mats = { [lineMesh.matKeys[0]]: 'stone' };
const assets = baseAssets;
assets._meshes[lineMesh.id] = lineMesh; // the registry's own table (test only)

ok('KIND_MESH single source (GBuffer.js == gltf.js re-export == 9)', KIND_MESH === 9 && KIND_MESH_GLTF === KIND_MESH);
ok('Ruins uv is metres (planar re-import): Line uv span > 0.5', (() => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < lineMesh.uv.length; i += 2) { lo = Math.min(lo, lineMesh.uv[i]); hi = Math.max(hi, lineMesh.uv[i]); }
  return hi - lo > 0.5;
})());

const towerDef = { id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 } };
const meshPl = (id, x, y, yaw) => ({ id, mesh: lineMesh.id, origin: { x, y, z: 0 }, yawDeg: yaw });
const mk = (structures, opts = {}) => World.load({ terrain: null, structures, entities: [] }, assets, opts);

// ---- 1. Mesh JS frame path: level + mesh structures render in either placement order ----
const COLS = 60, ROWS = 24;
function makeFb(world) {
  const fb = {
    rt: new CellBuffer(COLS, ROWS), depth: new DepthBuffer(COLS, ROWS),
    palette: baseAssets.palette, gbuf: new GBuffer(COLS, ROWS), matTable: bindShading(baseAssets.palette, baseAssets.detailPass, 1),
    detailPass: null, lights: null, light: makeLightBuffer(COLS, ROWS), timeSec: 0, loop: { stats: {} },
  };
  for (const s of world.structures) if (s.kind !== 'mesh') bindLevel(fb.matTable, s.level);
  return fb;
}
function frameHash(world, cam) {
  const fb = makeFb(world);
  renderWorld(fb, world, cam);
  const h = createHasher();
  for (let i = 0; i < COLS * ROWS; i++) {
    h.u32(fb.rt.glyphIdx[i]);
    for (let k = 0; k < 4; k++) { h.u32(fb.rt.fg[i * 4 + k]); h.u32(fb.rt.bg[i * 4 + k]); }
  }
  let meshCells = 0, levelCells = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (fb.gbuf.kind[i] === KIND_MESH) meshCells++;
    else if (fb.gbuf.kind[i] !== 0) levelCells++;
  }
  return { hash: h.value(), meshCells, levelCells };
}
{
  const start = baseAssets.level('tower').start;
  const cam = { x: towerDef.origin.x + start.x, y: towerDef.origin.y + start.y, z: 1.6, yawDeg: 40, pitchDeg: -5 };
  const plain = mk([towerDef]);
  const mixed = mk([towerDef, meshPl('m1', cam.x + 2, cam.y + 1, 20)]);
  const mixedFirst = mk([meshPl('m1', cam.x + 2, cam.y + 1, 20), towerDef]);
  let threw = null, h0, h1, h2;
  try { h0 = frameHash(plain, cam); h1 = frameHash(mixed, cam); h2 = frameHash(mixedFirst, cam); } catch (e) { threw = e; }
  ok('compositor frame with a mesh structure does not throw', !threw, threw && threw.stack);
  ok('mesh CPU frame retains tower geometry with a nearby mesh placement', !threw && h0.levelCells > 0 && h1.levelCells > 0 && h2.levelCells > 0, JSON.stringify([h0, h1, h2]));
  ok('mesh-before/after-tower: identical cell output and geometry counts', !threw && h1.hash === h2.hash && h1.meshCells === h2.meshCells && h1.levelCells === h2.levelCells, JSON.stringify([h1, h2]));
  ok('mesh-before-tower: level keeps structSeq 0', mixedFirst.structures.find((s) => s.id === 'tower').structSeq === 0);
}

// ---- 2. MeshDrawCache ----
const idFor = (key) => (key === 'stone' ? 7 : 3);
{
  const cache = new MeshDrawCache();
  const before = lineMesh.flat.slice();
  const a = cache.get(lineMesh, idFor), b = cache.get(lineMesh, idFor);
  ok('cache: same object twice', a === b);
  ok('cache: copy mat id == idFor(stone)', flatMat(a.flat[1]) === 7);
  ok('cache: registry mesh flat bytes + matsResolved unchanged', lineMesh.matsResolved === false && lineMesh.flat.every((v, i) => v === before[i]));
  const c = cache.get(lineMesh, () => 9);
  ok('cache: rebuilt when idFor changes', c !== a && flatMat(c.flat[1]) === 9);
  const bad = { ...lineMesh, mats: {} };
  let msg = '';
  try { new MeshDrawCache().get(bad, idFor); } catch (e) { msg = e.message; }
  ok('cache: missing mats entry throws naming mesh + material', msg.includes(lineMesh.id) && msg.includes(lineMesh.matKeys[0]), msg);
}

// ---- 3. addMeshStructures ----
{
  const world = mk([towerDef, meshPl('a', 1500, 1040, 0), meshPl('b', 1510, 1040, 37)], { physics: 'mesh' });
  const cache = new MeshDrawCache();
  const list = new DrawList();
  list.begin();
  addMeshStructures(list, world, { x: 1500, y: 1040, z: 1.6 }, cache, idFor, 2000);
  ok('2 placements -> 2 items', list.count === 2);
  // MESH-PHYS-01: placed meshes share one merged collider now; build each placement alone to get its own AABB.
  const solo = (id) => buildWorldColliders({ structures: [world.structures.find((x) => x.id === id)], assets: world.assets })[0];
  const colA = solo('a'), colB = solo('b');
  // The collider keeps only its BVH: transform the mesh by the item matrix and compare world AABBs (same matrix => same box).
  const worldBox = (m, pos) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < pos.length; v += 3) {
      const x = pos[v], y = pos[v + 1], z = pos[v + 2];
      const w = [m[0] * x + m[1] * y + m[2] * z + m[9], m[3] * x + m[4] * y + m[5] * z + m[10], m[6] * x + m[7] * y + m[8] * z + m[11]];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
    return { lo, hi };
  };
  let eq = true;
  for (const [it, col] of [[list.items[0], colA], [list.items[1], colB]]) {
    const bx = worldBox(it.matrix, lineMesh.pos);
    for (let k = 0; k < 3; k++) if (Math.abs(bx.lo[k] - col.min[k]) > 1e-9 || Math.abs(bx.hi[k] - col.max[k]) > 1e-9) eq = false;
  }
  ok('item matrix reproduces the ME-14b collider world AABB (yaw 0 and 37)', eq);
  const i0 = list.items[0], i1 = list.items[1];
  ok('type/objectId/planeIdOr/range', i0.type === DRAW_STATIC && i0.objectId === (0xA000 | 1) && i1.objectId === (0xA000 | 2)
    && i0.planeIdOr === 0 && i1.planeIdOr === (1 << 20) && i0.rangeFirst === 0 && i0.rangeCount === lineMesh.triCount && i0.zBase === 0);
  ok('items use the resolved copy, not the registry mesh', i0.mesh !== lineMesh && i0.mesh.matsResolved === true);
  const l2 = new DrawList(); l2.begin();
  addStructures(l2, world, { x: 1490, y: 1030, z: 1.6 }, new LevelMeshCache(), 2000);
  const l3 = new DrawList(); l3.begin();
  addStructures(l3, mk([towerDef]), { x: 1490, y: 1030, z: 1.6 }, new LevelMeshCache(), 2000);
  ok('addStructures skips mesh structures (same count as tower-only)', l2.count === l3.count && l2.count > 0);
  ok('frameMatrix12 returns out', frameMatrix12(world.structures[1].frame, new Float64Array(12)).length === 12);
}
{
  const pls = [];
  for (let i = 0; i < 70; i++) pls.push(meshPl('p' + i, 100 + i * 3, 0, 0));
  const world = mk(pls);
  const list = new DrawList(); list.begin();
  addMeshStructures(list, world, { x: 100, y: 0, z: 1.6 }, new MeshDrawCache(), idFor, 5000);
  ok('70 placements -> nearest 64', list.count === 64);
  const idx = []; for (let i = 0; i < list.count; i++) idx.push(list.items[i].objectId & 0xFFF);
  ok('nearest 64 are the first 64, near -> far', idx.every((x, i) => x === i));
  const cache = new MeshDrawCache();
  const cam = { x: 100, y: 0, z: 1.6 };
  const frame = () => { list.begin(); addMeshStructures(list, world, cam, cache, idFor, 5000); };
  for (let i = 0; i < 1000; i++) frame(); // Warm JIT before measuring retained heap.
  global.gc(); const b0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc(); const grew = process.memoryUsage().heapUsed - b0;
  ok('addMeshStructures: no heap growth over 1000 frames', grew < 64 * 1024, `grew=${grew}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
