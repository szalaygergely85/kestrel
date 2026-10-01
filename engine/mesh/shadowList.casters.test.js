// engine/mesh/shadowList.casters.test.js (ME-15c, docs/architecture.md 27.9a amendment, caster gaps a + b).
// (a) RE-06 instanced groups enter the shadow list with their FULL instance buffer, even when the camera pass
//     culled every instance; (b) `VoxelPool.projectShadow()` poses props the screen cull dropped (behind the camera).
// Run: node engine/mesh/shadowList.casters.test.js
import { VoxelPool } from '../render/voxelPool.js';
import { DrawList, DRAW_INSTANCED, DRAW_VOXEL, LevelMeshCache } from './DrawList.js';
import { VoxelMeshCache } from './voxelMesh.js';
import { InstanceGroups, writeUnitInstance } from './instances.js';
import { buildShadowList, createShadowList } from './shadowList.js';
import { createSunShadowMatrix, shadowSunMatrix, SUN_SHADOW_DEFAULTS } from '../render/shadowSun.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { dirFromAzEl } from '../core/transform.js';
import { makeOk } from '../test/assert.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/models/voxel_props.js';
import '../../design/models/voxel_tower.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const VM = globalThis.ASSETS.voxelModels;
const KEYS = ['lever'];
const registry = { keys: (k) => (k === 'model' ? KEYS : []), model: (k) => ({ voxel: VM[k].voxel }) };
const idMap = new Map();
const table = { idFor(key) { if (!idMap.has(key)) idMap.set(key, idMap.size + 1); return idMap.get(key); } };
const pool = new VoxelPool();
pool.bind(registry, table);
const meshCache = new VoxelMeshCache();

const OPTS = { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 192 };
const sunDir = dirFromAzEl(135, 40, new Float64Array(3));
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }; // looks toward -y
const grid = { cols: 240, rows: 90 };
const world = { structures: [], structVersion: 1, terrain: null };
const centre = { x: 0, y: -64, z: 0 };

const sm = createSunShadowMatrix();
shadowSunMatrix(sunDir, [centre.x, centre.y, centre.z], OPTS, { min: 0, max: 5 }, sm);
const camPlanes = new Float64Array(24);
{ const t = {}, M = new Float64Array(16); projTerms(cam, grid, t); shearProjection(t, M); frustumPlanes(M, camPlanes); }

// ---- (a) instanced group behind the camera ----------------------------------
{
  const groups = new InstanceGroups();
  groups.bindPool(pool);
  const g = groups.group('lever', 4);
  for (let i = 0; i < 3; i++) writeUnitInstance(g.ib, i, -2 + i * 2, 30, 0, 0, 0x10000 + i, 0); // y = +30: behind the camera (looks -y)
  g.count = 3;
  const camList = new DrawList(32);
  camList.begin();
  groups.addToDrawList(camList, meshCache, camPlanes, 1);
  camList.cull(camPlanes);
  let camInst = 0;
  for (let i = 0; i < camList.count; i++) if (camList.items[i].type === DRAW_INSTANCED) camInst++;
  ok('camera list drops the group behind the camera', camInst === 0, `camera instanced items ${camInst}`);

  const sl = createShadowList();
  buildShadowList(sl, camList, world, sm.planes, { centre, cache: new LevelMeshCache(), voxelMeshCache: meshCache, instances: groups });
  let item = null;
  for (let i = 0; i < sl.count; i++) if (sl.items[i].type === DRAW_INSTANCED) item = sl.items[i];
  ok('shadow list has the instanced group', !!item);
  ok('... with the FULL buffer (count 3, the group ib itself)', !!item && item.instCount === 3 && item.instBuf === g.ib);
  const empty = createShadowList();
  buildShadowList(empty, camList, world, sm.planes, { centre, cache: new LevelMeshCache(), voxelMeshCache: meshCache });
  let none = 0;
  for (let i = 0; i < empty.count; i++) if (empty.items[i].type === DRAW_INSTANCED) none++;
  ok('no `instances` source -> no instanced items (15b behaviour)', none === 0);
}

// ---- (b) voxel prop behind the camera ---------------------------------------
{
  pool.beginFrame();
  pool.pushInstance('lever', 40, -10, 0, 0); // 76 deg off the view axis: the screen cull drops it, the sun box (96 m half-size) keeps it
  pool.pushInstance('lever', 0, -10, 0, 0);  // in front
  pool.project({ ...cam, projection: 'shear' }, { cols: grid.cols, rows: grid.rows, pxCellW: 1, pxCellH: 1 }, 'mesh');
  ok('project() screen-culls the prop off to the side', pool.list.length === 1, `list ${pool.list.length}`);
  const n = pool.projectShadow();
  ok('projectShadow() keeps both props (no screen cull)', n === 2 && pool.shadowList.length === 2 && pool.shadowView.list === pool.shadowList);
  const sl = createShadowList();
  buildShadowList(sl, null, world, sm.planes, { centre, cache: new LevelMeshCache(), voxelPool: pool.shadowView, voxelMeshCache: meshCache });
  let vox = 0;
  for (let i = 0; i < sl.count; i++) if (sl.items[i].type === DRAW_VOXEL) vox++;
  ok('shadow list holds both props (the screen-culled one still casts)', vox === 2, `voxel items ${vox}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
