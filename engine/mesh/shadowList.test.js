// engine/mesh/shadowList.test.js (ME-15a, docs/architecture.md 27.9a item 4, ACs 3 and 5).
// Zero-allocation gate is hard: when `global.gc` is missing this file re-runs itself with `--expose-gc`.
// Run: node engine/mesh/shadowList.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DrawList, DRAW_STATIC, LevelMeshCache, MeshDrawCache, addStructures, MAX_DRAW_ITEMS } from './DrawList.js';
import { buildShadowList, createShadowList, shadowWorldZ, trimShadowList, meshShadowBudget } from './shadowList.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { createSunShadowMatrix, shadowSunMatrix, SUN_SHADOW_DEFAULTS } from '../render/shadowSun.js';
import { dirFromAzEl } from '../core/transform.js';
import { makeOk } from '../test/assert.js';
import fs from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { InstanceGroups, writeUnitInstance } from './instances.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function fakeLevel(name) {
  const legend = { f: { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false, start: true } };
  return { name, width: 1, height: 1, legend, sectorAt(x, y) { return (x >= 0 && x < 1 && y >= 0 && y < 1) ? legend.f : null; } };
}
function struct(i, x, y) {
  return { id: `s${i}`, level: fakeLevel(`l${i}`), origin: { x, y, z: 0 }, bbox: { x0: x, y0: y, x1: x + 1, y1: y + 1 }, structSeq: i & 7, packed: { version: 1 } };
}

const OPTS = { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 192 };
const sunDir = dirFromAzEl(135, 40, new Float64Array(3));
const grid = { cols: 240, rows: 90 };
const cam = { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }; // forward = -y

function cameraPlanes() {
  const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
  projTerms(cam, grid, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  return planes;
}

// ---- AC 3: caster behind the camera -----------------------------------------
{
  const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 300, 0)], structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const camList = new DrawList(16);
  camList.begin();
  addStructures(camList, world, cam, cache, 2000);
  camList.cull(cameraPlanes());
  const inCamera = (s) => { for (let i = 0; i < camList.count; i++) if (camList.items[i].objectId === s) return true; return false; };

  const centre = [0, -64, 0];
  const sm = createSunShadowMatrix();
  const z = shadowWorldZ(world, cache, { min: 0, max: 0 });
  shadowSunMatrix(sunDir, centre, OPTS, z, sm);
  const sl = createShadowList();
  const n = buildShadowList(sl, camList, world, sm.planes, { centre: { x: centre[0], y: centre[1], z: centre[2] }, cache });
  const inShadow = (s) => { for (let i = 0; i < sl.count; i++) if (sl.items[i].objectId === s) return true; return false; };
  ok('structure ahead of the camera is in the camera list', inCamera(0));
  ok('structure behind the camera (y=+30) is NOT in the camera list', !inCamera(1));
  ok('structure behind the camera IS in the shadow list', inShadow(1), `shadow count=${n}`);
  ok('structure ahead is in the shadow list too', inShadow(0));
  ok('structure 300 m away (outside the box) is culled from the shadow list', !inShadow(2));
  ok('shadowWorldZ covers the floor quads', z.min <= 0 && z.max >= 0, `${z.min}..${z.max}`);
}

// ---- overflow: farthest-from-centre dropped first, deterministic -------------
{
  const structs = [];
  for (let i = 0; i < 8; i++) structs.push(struct(i, i * 2, 0));
  const world = { structures: structs, structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const sl = createShadowList(2048);
  const sm = createSunShadowMatrix();
  shadowSunMatrix(sunDir, [0, 0, 0], OPTS, { min: 0, max: 0 }, sm);
  // Fill up with fake extras via the builder's own feed: 8 structures x 1 mesh = 8 items; shrink the cap by pushing manually is not
  // possible, so check ordering/determinism instead and that count never exceeds MAX_DRAW_ITEMS.
  const src = { centre: { x: 0, y: 0, z: 0 }, cache };
  const n1 = buildShadowList(sl, null, world, sm.planes, src);
  const ids1 = [];
  for (let i = 0; i < sl.count; i++) ids1.push(sl.items[i].objectId);
  const n2 = buildShadowList(sl, null, world, sm.planes, src);
  const ids2 = [];
  for (let i = 0; i < sl.count; i++) ids2.push(sl.items[i].objectId);
  ok('deterministic across rebuilds', n1 === n2 && ids1.join() === ids2.join(), `${ids1} / ${ids2}`);
  ok('never exceeds MAX_DRAW_ITEMS', n1 <= MAX_DRAW_ITEMS);
  ok('near -> far order kept (structSeq ascending by distance)', ids1.join() === '0,1,2,3,4,5,6,7', ids1.join());
}

// ---- overflow trim: farthest-from-centre dropped first ---------------------
{
  const l = new DrawList(400);
  l.begin();
  for (let i = 0; i < MAX_DRAW_ITEMS + 5; i++) {
    const it = l.push(null, DRAW_STATIC);
    it.objectId = i;
    const x = i === 10 ? 5000 : i; // item 10 is by far the farthest
    it.aabb[0] = x; it.aabb[3] = x; // y = 0
  }
  trimShadowList(l, 0, 0);
  const ids = new Set();
  for (let i = 0; i < l.count; i++) ids.add(l.items[i].objectId);
  ok('trim keeps MAX_DRAW_ITEMS', l.count === MAX_DRAW_ITEMS, 'count=' + l.count);
  ok('trim drops the farthest first (item 10, then ids 257..260)', !ids.has(10) && !ids.has(257) && !ids.has(258) && !ids.has(259) && !ids.has(260) && ids.has(256) && ids.has(9));
  ok('trim keeps relative order', (() => { let prev = -1; for (let i = 0; i < l.count; i++) { if (l.items[i].objectId < prev) return false; prev = l.items[i].objectId; } return true; })());
}

// ---- ENV-01a2: per-group shadow opt-out preserves default casters -----------
{
  const groups = new InstanceGroups();
  const pm = {};
  groups.bindPool({ models: new Map([['detail', pm]]), partNamesFor: () => [] });
  const defaults = groups.group('detail', 2), grass = groups.group('detail', 1), rock = groups.group('detail', 1);
  grass.castShadow = false;
  rock.castShadow = true;
  for (const g of groups.groups) {
    g.parts.count = 1;
    g.parts.m[0] = g.parts.m[4] = g.parts.m[8] = 1;
    g.parts.flags[0] = 1;
    g.count = g.ib.capacity;
    for (let i = 0; i < g.count; i++) writeUnitInstance(g.ib, i, i, 0, 0, 0, 0x40000 | i, 0);
  }
  const mesh = { bbox: new Float64Array([-0.5, -0.5, 0, 0.5, 0.5, 1]) };
  let gets = 0;
  const src = { centre: { x: 0, y: 0, z: 0 }, cache: new LevelMeshCache(), instances: groups,
    voxelMeshCache: { get() { gets++; return mesh; } } };
  const sl = createShadowList();
  buildShadowList(sl, null, { structures: [], structVersion: 1, terrain: null }, new Float64Array(24), src);
  ok('castShadow false: group absent, no mesh lookup', sl.count === 2 && gets === 2 && sl.items[0].instBuf === defaults.ib && sl.items[1].instBuf === rock.ib);
  ok('default and explicit true groups keep full instance buffers', sl.items[0].instCount === 2 && sl.items[1].instCount === 1);
  grass.castShadow = true;
  buildShadowList(sl, null, { structures: [], structVersion: 1, terrain: null }, new Float64Array(24), src);
  ok('re-enabling castShadow restores the group in registry order', sl.count === 3 && sl.items[1].instBuf === grass.ib);
}

// ---- ME-15f: instanced casters banded by eye distance (27.9a amendment 5) -------
{
  const groups = new InstanceGroups();
  groups.bindPool({ models: new Map([['tree', {}]]), partNamesFor: () => [] });
  const g = groups.group('tree', 8);
  g.parts.count = 1; g.parts.m[0] = g.parts.m[4] = g.parts.m[8] = 1; g.parts.flags[0] = 1;
  const meshes = { 0: { bbox: new Float64Array([-0.5, -0.5, 0, 0.5, 0.5, 4]), id: 'm0' }, 1: { bbox: new Float64Array([-0.5, -0.5, 0, 0.5, 0.5, 4]), id: 'm1' } };
  const vmc = { get(pm, key, names, lod = 0) { return meshes[lod]; } };
  const eye = { x: 0, y: 0 };
  const src = { centre: { x: 0, y: 0, z: 0 }, cache: new LevelMeshCache(), instances: groups, voxelMeshCache: vmc, eye, meshLod0M: 25, instCastM: 48 };
  const world = { structures: [], structVersion: 1, terrain: null };
  const sl = createShadowList();
  const all = new Float64Array(24); // no plane constraint (all zeros keeps everything)
  const setX = (xs) => { g.count = xs.length; xs.forEach((x, i) => writeUnitInstance(g.ib, i, x, 0, 0, 0, 0x40000 | i, 0)); };
  const counts = () => { let a = 0, b = 0; for (let i = 0; i < sl.count; i++) { const it = sl.items[i]; if (it.mesh === meshes[0]) a += it.instCount; else if (it.mesh === meshes[1]) b += it.instCount; } return [a, b]; };
  const camCopy = g.drawIb[0].u32.slice(); const camCount = [g.drawCount[0], g.drawCount[1]];

  setX([5, 10, 24, 30, 47, 60, 100, 200]);
  buildShadowList(sl, null, world, all, src);
  ok('bands: 3 LOD0 (<=25), 2 LOD1 (<=48), 3 none', counts().join() === '3,2', counts().join());
  // compacted rows bit-equal to source rows (order kept)
  const u = g.shadowIb[0].u32, su = g.ib.u32;
  let eq = true; for (let i = 0; i < 3; i++) for (let c = 0; c < 16; c++) if (u[i * 16 + c] !== su[i * 16 + c]) eq = false;
  const u1 = g.shadowIb[1].u32; for (let i = 0; i < 2; i++) for (let c = 0; c < 16; c++) if (u1[i * 16 + c] !== su[(3 + i) * 16 + c]) eq = false;
  ok('compacted rows are bit-equal to the source rows', eq);
  ok('camera drawIb/drawCount untouched', g.drawCount[0] === camCount[0] && g.drawCount[1] === camCount[1] && g.drawIb[0].u32.every((v, i) => v === camCopy[i]));
  // hysteresis: instance at 26 m after being LOD0 stays LOD0; at 27.5 -> LOD1; coming back to 24 stays LOD1, 22.5 -> LOD0
  setX([24]); buildShadowList(sl, null, world, all, src);
  setX([26]); buildShadowList(sl, null, world, all, src);
  ok('hysteresis: 24 -> 26 m stays LOD0', counts().join() === '1,0', counts().join());
  setX([27.5]); buildShadowList(sl, null, world, all, src);
  ok('27.5 m (> 25 + 2) -> LOD1', counts().join() === '0,1', counts().join());
  setX([24]); buildShadowList(sl, null, world, all, src);
  ok('hysteresis: 27.5 -> 24 m stays LOD1', counts().join() === '0,1', counts().join());
  setX([22.5]); buildShadowList(sl, null, world, all, src);
  ok('22.5 m (< 25 - 2) -> LOD0', counts().join() === '1,0', counts().join());
  setX([49]); buildShadowList(sl, null, world, all, src);
  ok('hysteresis at 48: LOD0 -> 49 m jumps to LOD1 (not past cast range)', counts().join() === '0,1', counts().join());
  setX([51]); buildShadowList(sl, null, world, all, src);
  ok('51 m (> 48 + 2) -> none', counts().join() === '0,0' && sl.count === 0, counts().join());
  setX([47]); buildShadowList(sl, null, world, all, src);
  ok('hysteresis: none -> 47 m stays none', sl.count === 0);
  setX([45]); buildShadowList(sl, null, world, all, src);
  ok('45 m (< 48 - 2) -> LOD1 again', counts().join() === '0,1', counts().join());
  // shadow-plane cull: a box far to +x excludes instances at x=5..10 and keeps x=-5
  {
    const sm = createSunShadowMatrix();
    shadowSunMatrix(sunDir, [-5, 0, 0], { ...OPTS, boxM: 8 }, { min: 0, max: 4 }, sm);
    setX([-5, 30, 40, -4]);
    eye.x = -5;
    buildShadowList(sl, null, world, sm.planes, src);
    ok('instances outside the shadow planes are dropped', counts().join() === '2,0', counts().join());
    eye.x = 0;
  }
  // no eye -> old behaviour (full g.ib at LOD0)
  setX([5, 100]); const srcNoEye = { ...src, eye: undefined };
  buildShadowList(sl, null, world, all, srcNoEye);
  ok('without src.eye: full buffer at LOD0 (old path)', sl.count === 1 && sl.items[0].instBuf === g.ib && sl.items[0].instCount === 2);
  // zero allocation over 1000 builds
  setX([5, 10, 24, 30, 47, 60, 100, 200]);
  for (let i = 0; i < 3000; i++) buildShadowList(sl, null, world, all, src);
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) { eye.x = (i % 7) * 3; buildShadowList(sl, null, world, all, src); }
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  ok('0 allocation over 1000 banded builds', grew < 32 * 1024, `grew ${grew}`);
  eye.x = 0;
  g.castShadow = false; buildShadowList(sl, null, world, all, src);
  ok('castShadow false: still absent with bands', sl.count === 0);
}

// ---- MESH-SHADOW-01: per-mesh / per-placement castShadow -------------------------
{
  const load = (n) => meshFromJSON(JSON.parse(fs.readFileSync(new URL(`../../content/meshes/quaternius/${n}.mesh.json`, import.meta.url), 'utf8')));
  const pebble = load('Pebble_Round_1'), path = load('RockPath_Round_Wide'), rock = load('Rock_Medium_1'), tree = load('DeadTree_1');
  ok('import rule: pebble / path stone flagged, rock / tree not', pebble.castShadow === false && path.castShadow === false && rock.castShadow === undefined && tree.castShadow === undefined);
  const stub = { structures: [], renderVersion: 0, structVersion: 0, events: null };
  const place = (m, x, over) => World.prototype.placeMesh.call(stub, m, { x, y: 0, z: 0 }, `m${stub.structures.length}`, 0, over);
  const count = (...specs) => {
    stub.structures.length = 0;
    for (const [m, x, over] of specs) place(m, x, over);
    const sl = createShadowList(), sm = createSunShadowMatrix(), centre = new Float64Array(3);
    shadowSunMatrix(sunDir, centre, OPTS, { min: -1, max: 10 }, sm);
    return buildShadowList(sl, null, stub, sm.planes, { centre: { x: 0, y: 0, z: 0 }, cache: new LevelMeshCache(), meshCache: new MeshDrawCache(), meshIdFor: () => 1 });
  };
  ok('pebble + path stone skipped, rock + tree cast', count([pebble, 0], [path, 2], [rock, 4], [tree, 6]) === 2);
  ok('placement castShadow:true re-enables a flagged mesh', count([pebble, 0, true], [path, 2]) === 1);
  ok('placement castShadow:false disables a rock', count([rock, 0, false], [tree, 3]) === 1);
}

// ---- MESH-SHADOW-02: placed-mesh caster budget (distance cut + nearest-first cap) ------------
{
  const rock = meshFromJSON(JSON.parse(fs.readFileSync(new URL('../../content/meshes/quaternius/Rock_Medium_1.mesh.json', import.meta.url), 'utf8')));
  const stub = { structures: [], renderVersion: 0, structVersion: 0, events: null };
  const eye = { x: 0, y: 0 };
  const run = (xs, opts = {}) => {
    stub.structures.length = 0;
    xs.forEach((x, i) => World.prototype.placeMesh.call(stub, rock, { x, y: 0, z: 0 }, `m${i}`, 0));
    const sl = createShadowList(), sm = createSunShadowMatrix();
    shadowSunMatrix(sunDir, new Float64Array(3), { ...OPTS, boxM: 400 }, { min: -1, max: 10 }, sm);
    const src = { centre: { x: 0, y: 0, z: 0 }, eye, meshLod0M: 25, cache: new LevelMeshCache(), meshCache: new MeshDrawCache(), meshIdFor: () => 1, ...opts };
    buildShadowList(sl, null, stub, sm.planes, src);
    const ids = []; for (let i = 0; i < sl.count; i++) ids.push(sl.items[i].objectId & 0xFFF);
    return ids;
  };
  const saved = meshShadowBudget.cap; const savedEnabled = meshShadowBudget.enabled; meshShadowBudget.enabled = true;
  meshShadowBudget.cap = 3;
  ok('distance cut: props beyond meshLod0M dropped', run([2, 10, 40, 90]).join() === '0,1');
  ok('cap keeps the 3 nearest, nearest first', run([30, 5, 20, 1, 12].map((x) => x - 0)).join() === '3,1,4', run([30, 5, 20, 1, 12]).join());
  ok('tie order by object id', run([6, 6, 6, 6, 3]).join() === '4,0,1', run([6, 6, 6, 6, 3]).join());
  ok('cap 0 drops every prop', (meshShadowBudget.cap = 0, run([1, 2]).length === 0));
  meshShadowBudget.cap = 3;
  ok('no eye: old behaviour (all, no cut, no cap)', run([2, 10, 40, 90], { eye: undefined }).length === 4);
  ok('deterministic across rebuilds', run([30, 5, 20, 1, 12]).join() === run([30, 5, 20, 1, 12]).join());
  // protected kinds: voxel structures, terrain and cloth are not budgeted (feed is untouched) - structures list stays
  stub.structures.length = 0;
  const w2 = { structures: [struct(0, 0, 0), struct(1, 60, 0)], structVersion: 1, terrain: null };
  const sl2 = createShadowList(), sm2 = createSunShadowMatrix();
  shadowSunMatrix(sunDir, new Float64Array(3), { ...OPTS, boxM: 400 }, { min: -1, max: 10 }, sm2);
  meshShadowBudget.cap = 0;
  ok('voxel structures never budgeted (cap 0, 60 m away still cast)', buildShadowList(sl2, null, w2, sm2.planes, { centre: { x: 0, y: 0, z: 0 }, eye, meshLod0M: 25, cache: new LevelMeshCache() }) === 2);
  meshShadowBudget.cap = saved; meshShadowBudget.enabled = savedEnabled;
}

// ---- AC 5: zero allocation over N frames ---------------------------------------
{
  const world = { structures: [struct(0, 0, -20), struct(1, 0, 30), struct(2, 10, 10), struct(3, -15, 5)], structVersion: 1, terrain: null };
  const cache = new LevelMeshCache();
  const sl = createShadowList();
  const sm = createSunShadowMatrix();
  const centre = new Float64Array(3);
  const zr = { min: 0, max: 0 };
  const src = { centre: { x: 0, y: 0, z: 0 }, cache };
  let sink = 0;
  const run = (k) => {
    for (let i = 0; i < k; i++) {
      centre[0] = i * 0.01; centre[1] = -64;
      src.centre.x = centre[0]; src.centre.y = centre[1];
      shadowWorldZ(world, cache, zr);
      shadowSunMatrix(sunDir, centre, OPTS, zr, sm);
      sink += buildShadowList(sl, null, world, sm.planes, src);
    }
  };
  // Warm the same workload and loop length before measuring retained heap.
  run(20000);
  global.gc();
  const before = process.memoryUsage().heapUsed;
  run(20000);
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  ok('buildShadowList + matrix: no heap growth over 20k frames', grew < 64 * 1024, `grew ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
