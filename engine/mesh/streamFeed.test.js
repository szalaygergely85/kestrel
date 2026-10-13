// engine/mesh/streamFeed.test.js - STREAM-01b (docs/architecture.md 38.51): the placement-grid feeds.
// AC1 reachPerM Infinity == old path bit-identical (batched + single, camera + shadow); AC2 streaming on: items within minM identical;
// AC3 a lazy load / evict rebuilds exactly 1 group, full builds stay flat over a 600-frame walk; AC4 0 alloc per frame.
// Run: node engine/mesh/streamFeed.test.js  (re-spawns itself with --expose-gc)
import { readMeshJSON } from '../test/meshFile.test.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, MeshDrawCache, addMeshStructures } from './DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from './meshGroups.js';
import { PlacementGrid } from '../world/placementGrid.js';
import { buildShadowList, createShadowList } from './shadowList.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { createSunShadowMatrix, shadowSunMatrix, SUN_SHADOW_DEFAULTS } from '../render/shadowSun.js';
import { dirFromAzEl } from '../core/transform.js';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const load = (n) => meshFromJSON(readMeshJSON(new URL(`../../content/meshes/quaternius/${n}.mesh.json`, import.meta.url)));
const meshes = [load('Rock_Medium_1'), load('Rock_Medium_2'), load('DeadTree_1'), load('Grass_Common_Tall')];
const idFor = () => 1;

/** Synthetic world with the World methods the feeds use; `opts` -> PlacementGrid. */
function mkWorld(opts, n = 120, spanM = 900) {
  const w = /** @type {any} */ ({ structures: [], renderVersion: 0, structVersion: 0, events: null, streaming: { enabled: true } });
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) World.prototype.placeMesh.call(w, meshes[i % 4], { x: rnd() * spanM - 100, y: rnd() * 200 - 100, z: 0 }, `m${i}`, (i * 37) % 360);
  w.placementGrid = new PlacementGrid(w.structures, opts); w._placementGridVersion = w.structVersion;
  w.refreshPlacementGrid = World.prototype.refreshPlacementGrid;
  return w;
}
/** Order-sensitive digest of a list: type, object id, mesh id, matrix, instance rows (compacted words). */
function digest(list) {
  const out = [];
  for (let i = 0; i < list.count; i++) {
    const it = list.items[i];
    let s = `${it.type}|${it.objectId}|${it.mesh && it.mesh.id}|${it.planeIdOr}|${Array.from(it.matrix).join(',')}`;
    if (it.instBuf) { const u = it.instBuf.u32; for (let k = 0; k < it.instCount * 16; k++) s += ',' + u[k]; }
    out.push(s);
  }
  return out.join('\n');
}
const planesFor = (cam) => { const terms = {}, M = new Float64Array(16), pl = new Float64Array(24); projTerms(cam, { cols: 240, rows: 90, pxCellW: 1, pxCellH: 1 }, terms); shearProjection(terms, M); frustumPlanes(M, pl); return pl; };
const camAt = (x, y) => ({ x, y, z: 1.7, yawDeg: 0, pitchDeg: 0 });
const poses = [[0, 0], [150, 20], [400, -30], [700, 60], [-90, 90]];

// ---- AC1: reachPerM Infinity == streaming off, bit-identical -----------------------------------
{
  const w = mkWorld({ reachPerM: Infinity });
  for (const batched of [false, true]) {
    let same = true, nItems = 0;
    for (const [x, y] of poses) {
      const cam = camAt(x, y), pl = planesFor(cam);
      const run = (on) => {
        w.streaming.enabled = on; w.placementGrid = new PlacementGrid(w.structures, { reachPerM: Infinity }); w._placementGridVersion = w.structVersion;
        const l = new DrawList(); l.begin(); const cache = new MeshDrawCache();
        if (batched) addMeshStructuresBatched(l, w, cam, cache, idFor, 2000, new MeshGroupSet(), pl); else addMeshStructures(l, w, cam, cache, idFor, 2000, false, null, null, pl);
        return l;
      };
      const a = run(false), b = run(true);
      nItems += a.count;
      if (digest(a) !== digest(b)) same = false;
    }
    ok(`AC1 ${batched ? 'batched' : 'single'}: DrawList bit-identical (${nItems} items over ${poses.length} poses)`, same && nItems > 0);
  }
  // shadow feed
  const sm = createSunShadowMatrix(), sunDir = dirFromAzEl(135, 40, new Float64Array(3));
  let sameS = true;
  for (const [x, y] of poses.slice(0, 3)) {
    const c = { x, y, z: 0 }, run = (on) => {
      w.streaming.enabled = on; w.placementGrid = new PlacementGrid(w.structures, { reachPerM: Infinity }); w._placementGridVersion = w.structVersion;
      shadowSunMatrix(sunDir, new Float64Array([x, y, 0]), { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 400 }, { min: -1, max: 10 }, sm); const pl = sm.planes;
      const l = createShadowList(); buildShadowList(l, null, w, pl, { centre: c, cache: null, meshCache: new MeshDrawCache(), meshIdFor: idFor, eye: c });
      return l;
    };
    if (digest(run(false)) !== digest(run(true))) sameS = false;
  }
  ok('AC1 shadow feed: bit-identical', sameS);
}

// ---- AC2: streaming on (real reach): every item within minM identical --------------------------
{
  const opts = { reachPerM: 400, minM: 160 };
  const w = mkWorld(opts);
  let allSame = true, total = 0, dropped = 0;
  for (const [x, y] of poses) {
    const cam = camAt(x, y), pl = planesFor(cam);
    const ids = (on) => {
      w.streaming.enabled = on; w.placementGrid = new PlacementGrid(w.structures, opts); w._placementGridVersion = w.structVersion;
      const l = new DrawList(); l.begin(); addMeshStructures(l, w, cam, new MeshDrawCache(), idFor, 2000, false, null, null, pl);
      const m = new Map(); for (let i = 0; i < l.count; i++) m.set(l.items[i].objectId, 1); return m;
    };
    const off = ids(false), on = ids(true);
    for (const id of off.keys()) {
      const b = w.structures[id & 0xFFF].bbox; // meshObjectId = 0xA000 | structure index
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1);
      total++;
      if (Math.hypot(dx, dy) <= opts.minM && !on.has(id)) allSame = false;
    }
    dropped += off.size - on.size;
  }
  ok(`AC2: all items within minM present with streaming on (${total} off-items, ${dropped} streamed out beyond reach)`, allSame && total > 0);
}

// ---- AC3 + AC4: lazy load/evict = 1 group build; flat full-build count over a 600-frame walk; 0 alloc -----
{
  const w = mkWorld({}, 120, 900);
  const cache = new MeshDrawCache(), groups = new MeshGroupSet(), list = new DrawList();
  const fakeLazy = { store: { request() {} } };
  let x = 0;
  const frame = (f) => {
    const cam = camAt(x, 0), pl = planesFor(cam);
    list.begin(); addMeshStructuresBatched(list, w, cam, cache, idFor, 2000, groups, pl); list.cull(pl);
  };
  for (let f = 0; f < 5; f++) frame(f);
  const builds0 = groups.stats.builds, gb0 = groups.stats.groupBuilds;
  ok('start: one full build, one group per mesh (4)', builds0 === 1 && groups.stats.groups === 4 && groups.slots.length === 4, `groups ${groups.stats.groups}`);
  const t = meshes[1];
  for (let f = 0; f < 600; f++) {
    x = f * 1.5;
    if (f === 100) { t.lazy = fakeLazy; const gb = groups.stats.groupBuilds; frame(f); ok('AC3: evict rebuilds 0 groups (slot emptied, others untouched)', groups.stats.groupBuilds === gb && groups.stats.groups === 3, `groupBuilds +${groups.stats.groupBuilds - gb}`); continue; }
    if (f === 300) { delete t.lazy; const gb = groups.stats.groupBuilds; frame(f); ok('AC3: load rebuilds exactly 1 group (spy)', groups.stats.groupBuilds === gb + 1 && groups.stats.groups === 4, `groupBuilds +${groups.stats.groupBuilds - gb}`); continue; }
    frame(f);
  }
  ok('AC3: full build count flat over 600 frames', groups.stats.builds === builds0, `builds ${groups.stats.builds}`);
  ok('AC3: only the load rebuilt a group', groups.stats.groupBuilds === gb0 + 1, `groupBuilds ${groups.stats.groupBuilds - gb0}`);
  // AC4: 0 alloc per frame (streaming on, grid moving)
  for (let f = 0; f < 600; f++) { x = f * 1.5; frame(f); }
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let f = 0; f < 1000; f++) { x = (f % 600) * 1.5; frame(f); }
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  ok('AC4: 0 allocation over 1000 streamed feeds', grew < 32 * 1024, `grew ${grew}`);
  const g = w.placementGrid;
  console.log(`STREAM-01b synthetic: ${g.memberCount} members, ${g.cellCount} cells, classCells ${Array.from(g.classCells).join('/')}, active ${g.activeCount}, warm ${g.warmCount}`);
}

// ---- AC1 on a world_m1 pose + per-reach-class cell log (deferred from 01a) -----------------------
{
  const { loadTestAssets } = await import('../../tools/testing/content-node.mjs');
  for (const m of ['palette', 'detail-pass']) await import(`../../design/${m}.js`);
  for (const m of ['lantern', 'lever', 'voxel_props', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_world']) await import(`../../design/models/${m}.js`);
  await import('../../design/levels/overworld_far.js');
  globalThis.window = globalThis.window || globalThis;
  const { assets } = await loadTestAssets();
  const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
  const g0 = w.placementGrid;
  console.log(`STREAM-01b world_m1 cells by reach class (0..4 from minM): ${Array.from(g0.classCells).join('/')} of ${g0.cellCount}`);
  const cam = camAt(1480, 1018), pl = planesFor(cam);
  const run = (on) => {
    w.streaming.enabled = on; w.placementGrid = new PlacementGrid(w.structures, { ...g0.opts, reachPerM: Infinity }); w._placementGridVersion = w.structVersion;
    const l = new DrawList(); l.begin(); addMeshStructures(l, w, cam, new MeshDrawCache(), idFor, 2000, false, null, null, pl); return l;
  };
  const a = run(false), b = run(true);
  ok(`AC1 world_m1 tower pose: bit-identical (${a.count} items)`, digest(a) === digest(b) && a.count > 0);
}

// ---- STREAM-01b review notes: (1) grid only ever classified from the camera eye; (2) one distance metric -------
{
  const sm = createSunShadowMatrix(), sunDir = dirFromAzEl(135, 40, new Float64Array(3));
  const shadow = (w, cx, eye) => {
    shadowSunMatrix(sunDir, new Float64Array([cx, 0, 0]), { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 400 }, { min: -1, max: 10 }, sm);
    const l = createShadowList(); buildShadowList(l, null, w, sm.planes, { centre: { x: cx, y: 0, z: 0 }, cache: null, meshCache: new MeshDrawCache(), meshIdFor: idFor, eye });
    return l;
  };
  const w = mkWorld({});
  ok('review1: fresh grid not evaluated', !w.placementGrid.evaluated);
  const a = shadow(w, 700, { x: 0, y: 0, z: 0 });
  ok('review1: shadow feed on a fresh grid does not classify it', !w.placementGrid.evaluated);
  w.streaming.enabled = false; const off = shadow(w, 700, { x: 0, y: 0, z: 0 }); w.streaming.enabled = true;
  ok('review1: fresh-grid shadow feed = full list (== streaming off)', digest(a) === digest(off) && a.count > 0, `${a.count} vs ${off.count}`);
  const cam = camAt(0, 0), pl = planesFor(cam);
  const l = new DrawList(); l.begin(); addMeshStructures(l, w, cam, new MeshDrawCache(), idFor, 2000, false, null, null, pl);
  ok('review1: camera feed classifies from its own eye', w.placementGrid.evaluated && w.placementGrid.lastX === 0);
  const b1 = shadow(w, 700, { x: 0, y: 0, z: 0 }), b2 = shadow(w, 0, { x: 0, y: 0, z: 0 });
  ok('review1: evaluated grid unchanged by shadow feeds', w.placementGrid.lastX === 0 && b1.count > 0 && b2.count > 0);
}
{
  // (2) reach check and lazy warm check use the same grid xy distance: a lazy placement exactly warm is requested iff warmLazyMeshes agrees
  const w = mkWorld({}, 60, 600), g = w.placementGrid, cam = camAt(0, 0);
  const l = new DrawList(); l.begin(); addMeshStructures(l, w, cam, new MeshDrawCache(), idFor, 2000, false, null, null, null);
  // an active placement: its reach check distance equals the grid metric (bbox xy), at a pose with z far above (hypot-3D must not leak in)
  const camHigh = { ...camAt(0, 0), z: 500 };
  const l2 = new DrawList(); l2.begin(); addMeshStructures(l2, w, camHigh, new MeshDrawCache(), idFor, 2000, false, null, null, null);
  ok('review2: eye height does not change the streamed set (xy metric)', digest(l) === digest(l2) && l.count > 0);
  // every drawn placement lies within its reach by the grid metric
  let inReach = true;
  for (let i = 0; i < l.count; i++) {
    const id = l.items[i].objectId;
    const si = w.structures.findIndex((s) => s.id === id || s.objectId === id);
    if (si < 0) continue;
    const b = w.structures[si].bbox, dx = Math.max(b.x0 - 0, 0, 0 - b.x1), dy = Math.max(b.y0, 0, -b.y1);
    if (dx * dx + dy * dy > g.reach2[si] + 1e-3) inReach = false;
  }
  ok('review2: every drawn placement within grid reach (xy to AABB)', inReach);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
