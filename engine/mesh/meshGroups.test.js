// engine/mesh/meshGroups.test.js (MESH-INST-01: CPU batching of repeated placed kind-9 meshes).
// Run: node engine/mesh/meshGroups.test.js  (re-spawns itself with --expose-gc for the zero-alloc gate)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, DRAW_STATIC, DRAW_INSTANCED, DRAW_FLAG_ONE_PART, MeshDrawCache, LevelMeshCache, addMeshStructures } from './DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched, meshIsSolid, MAX_GROUPED_INSTANCES } from './meshGroups.js';
import { rasterDrawList, createRasterTarget } from './rasterJS.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { buildShadowList, createShadowList, meshShadowBudget } from './shadowList.js';
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

const load = (n) => meshFromJSON(JSON.parse(fs.readFileSync(new URL(`../../content/meshes/quaternius/${n}.mesh.json`, import.meta.url), 'utf8')));
const grass = load('Grass_Common_Tall');
const rockA = load('Rock_Medium_1'), rockB = load('Rock_Medium_2'), tree = load('DeadTree_1');
const idFor = () => 1;

function mkWorld() { return { structures: [], renderVersion: 0, structVersion: 0, events: null }; }
const place = (w, m, x, y, yaw = 0, over) => World.prototype.placeMesh.call(w, m, { x, y, z: 0 }, `m${w.structures.length}`, yaw, over);

// ---- 1. grouping: draw items == distinct meshes (+ singles) --------------------------------
{
  const w = mkWorld();
  for (let i = 0; i < 5; i++) place(w, rockA, -6 + i * 3, 0);
  for (let i = 0; i < 3; i++) place(w, rockB, -4 + i * 4, 4, 30);
  place(w, tree, 0, -4);
  const cam = { x: 0, y: 14, z: 1.7 };
  const cache = new MeshDrawCache(), groups = new MeshGroupSet();
  const before = new DrawList(); before.begin(); addMeshStructures(before, w, cam, cache, idFor, 2000);
  const after = new DrawList(); after.begin(); addMeshStructuresBatched(after, w, cam, cache, idFor, 2000, groups, null);
  ok('before: one item per placement (9)', before.count === 9);
  ok('after: 2 instanced groups + 1 single (3 items)', after.count === 3, `count=${after.count}`);
  const types = []; for (let i = 0; i < after.count; i++) types.push(after.items[i].type);
  ok('single first (near->far feed), then groups', types.join() === [DRAW_STATIC, DRAW_INSTANCED, DRAW_INSTANCED].join(), types.join());
  const inst = after.items.slice(0, after.count).filter((it) => it.type === DRAW_INSTANCED);
  ok('instance counts 5 and 3', inst.map((it) => it.instCount).join() === '5,3');
  ok('lone mesh stays a single draw with its old object id', after.items[0].objectId === (0xA000 | 8) && after.items[0].mesh.id === tree.id);
  // ID stability: instance words carry 0xA000|structureIndex, in placement order
  const ids = []; for (let j = 0; j < inst[0].instCount; j++) ids.push(inst[0].instBuf.u32[j * 16 + 12]);
  ok('instance object ids = 0xA000|structure index', ids.join() === [0, 1, 2, 3, 4].map((i) => 0xA000 | i).join());
  ok('instances use the same resolved draw copy as the single path', inst[0].mesh === cache.get(rockA, idFor));
  ok('group items carry DRAW_FLAG_ONE_PART (one GL draw per group, 3 mesh ranges merged)', inst.every((it) => (it.flags & DRAW_FLAG_ONE_PART) !== 0 && it.mesh.ranges.length === 3));
  ok('stats', groups.stats.groups === 2 && groups.stats.members === 8 && groups.stats.kept === 8);
}

// ---- 2. scale / mask / eligibility exclusions ------------------------------------------------
{
  const w = mkWorld();
  place(w, rockA, 0, 0); place(w, rockA, 3, 0); const sc = place(w, rockA, 6, 0); sc.scale = 2; place(w, rockA, 9, 0);
  const g = new MeshGroupSet(); g.update(w, new MeshDrawCache(), idFor);
  ok('scaled placement excluded (3 grouped of 4)', g.has(0) && g.has(1) && !g.has(2) && g.has(3) && g.stats.members === 3);
  const l = new DrawList(); l.begin(); addMeshStructuresBatched(l, w, { x: 0, y: 14, z: 1.7 }, new MeshDrawCache(), idFor, 2000, g, null);
  ok('scaled placement still drawn as its own single item', l.count === 2 && l.items.slice(0, 2).some((it) => it.type === DRAW_STATIC && it.objectId === (0xA000 | 2)));
  const masked = { ...rockA, id: 'masked', ranges: [{ start: 0, count: rockA.triCount, mask: { tex: 't', cutoff: 0.5 } }] };
  const w2 = mkWorld(); place(w2, masked, 0, 0); place(w2, masked, 3, 0);
  const g2 = new MeshGroupSet(); g2.update(w2, { get: () => rockA }, idFor);
  ok('masked (alpha-cutout) meshes are never grouped', g2.groups.length === 0);
  ok('solidity: rocks + tree solid, grass cards not', meshIsSolid(rockA) && meshIsSolid(rockB) && meshIsSolid(tree) && !meshIsSolid(grass));
  const wg = mkWorld(); for (let i = 0; i < 4; i++) place(wg, grass, i * 2, 0);
  const gg = new MeshGroupSet(); gg.update(wg, new MeshDrawCache(), idFor);
  const lg = new DrawList(); lg.begin(); addMeshStructuresBatched(lg, wg, { x: 0, y: 14, z: 1.7 }, new MeshDrawCache(), idFor, 2000, gg, null);
  ok('one-sided grass stays 4 single draws (back-face cull would change cells)', gg.groups.length === 0 && lg.count === 4 && lg.items[0].type === DRAW_STATIC);
  const w3 = mkWorld(); place(w3, rockA, 0, 0);
  const g3 = new MeshGroupSet(); g3.update(w3, new MeshDrawCache(), idFor);
  ok('a lone placement is not grouped', g3.groups.length === 0 && !g3.has(0));
  const w4 = mkWorld(); for (let i = 0; i < MAX_GROUPED_INSTANCES + 5; i++) place(w4, rockA, i, 0);
  const g4 = new MeshGroupSet(); g4.update(w4, new MeshDrawCache(), idFor);
  ok('over MAX_GROUPED_INSTANCES: whole mesh falls back to singles', g4.groups.length === 0);
}

// ---- 2b. the nearest-64 selection (MAX_MESH_DRAWS) is unchanged: same drawn prop set as singles -------
{
  const w = mkWorld();
  for (let i = 0; i < 90; i++) place(w, i % 2 ? rockB : rockA, (i % 30) * 2.5 - 37, Math.floor(i / 30) * 6);
  const cam = { x: 3, y: 20, z: 1.7 };
  const cache = new MeshDrawCache();
  const single = new DrawList(); single.begin(); addMeshStructures(single, w, cam, cache, idFor, 2000);
  const want = new Set(); for (let i = 0; i < single.count; i++) want.add(single.items[i].objectId);
  const bl = new DrawList(); bl.begin(); const gs = new MeshGroupSet();
  addMeshStructuresBatched(bl, w, cam, cache, idFor, 2000, gs, null);
  const got = new Set();
  for (let i = 0; i < bl.count; i++) { const it = bl.items[i]; if (it.type === DRAW_INSTANCED) for (let j = 0; j < it.instCount; j++) got.add(it.instBuf.u32[j * 16 + 12]); else got.add(it.objectId); }
  ok('90 placements: 64 drawn, 2 items instead of 64', single.count === 64 && want.size === 64 && bl.count === 2, `single ${single.count} batched items ${bl.count}`);
  ok('batched feed draws exactly the single-draw prop set (ids)', got.size === 64 && [...want].every((id) => got.has(id)));
}

// ---- 3. invalidation --------------------------------------------------------------------------
{
  const w = mkWorld(); place(w, rockA, 0, 0); place(w, rockA, 3, 0);
  const cache = new MeshDrawCache(), g = new MeshGroupSet();
  g.update(w, cache, idFor); g.update(w, cache, idFor); g.update(w, cache, idFor);
  ok('unchanged world: built once', g.stats.builds === 1);
  place(w, rockA, 6, 0); g.update(w, cache, idFor);
  ok('new placement rebuilds (3 members)', g.stats.builds === 2 && g.stats.members === 3);
  w.structures[1].frame.x += 1; g.update(w, cache, idFor);
  ok('moved placement rebuilds', g.stats.builds === 3);
  const l = new DrawList(); l.begin(); addMeshStructuresBatched(l, w, { x: 0, y: 14, z: 1.7 }, cache, idFor, 2000, g, null);
  ok('rebuilt instance carries the new x', l.items[0].instBuf.f32[1 * 16 + 3] === w.structures[1].frame.x);
  w.structures[0].frame.yawDeg = 45; g.update(w, cache, idFor);
  ok('yaw change rebuilds', g.stats.builds === 4);
  const old = w.structures[2]; w.structures[2] = { ...old, frame: { ...old.frame } }; g.update(w, cache, idFor);
  ok('replaced structure object rebuilds', g.stats.builds === 5);
  w.structures[2].scale = 3; g.update(w, cache, idFor);
  ok('scale set on a member rebuilds and excludes it', g.stats.builds === 6 && !g.has(2) && g.has(0) && g.has(1));
  g.update(w, cache, () => 2);
  ok('material resolver change rebuilds', g.stats.builds === 7);
  w.structures.pop(); g.update(w, cache, () => 2);
  ok('removed placement rebuilds (2 left -> still a group)', g.stats.builds === 8 && g.stats.members === 2);
}

// ---- 4. raster parity: grouped == single draws (JS twin), cells + ids ------------------------
{
  const w = mkWorld();
  const xs = [-5, -2.5, 0, 2.5, 5];
  xs.forEach((x, i) => place(w, i % 2 ? rockB : rockA, x, 0, i * 37));
  xs.forEach((x, i) => place(w, i % 2 ? rockB : rockA, x + 1, -3, i * 61 + 10));
  const cam = { x: 0, y: 12, z: 1.7, yawDeg: 0, pitchDeg: 0 };
  const COLS = 240, ROWS = 90, rt = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 };
  const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
  projTerms(cam, rt, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  const render = (groups) => {
    const l = new DrawList(); l.begin();
    addMeshStructuresBatched(l, w, cam, new MeshDrawCache(), idFor, 2000, groups, planes);
    l.cull(planes);
    const t = createRasterTarget(COLS, ROWS, 1, {});
    rasterDrawList(l, t, { M, terms, snap: true });
    return { t, items: l.count };
  };
  const a = render(null), b = render(new MeshGroupSet());
  let covered = 0, kindD = 0, idD = 0, matD = 0, depthD = 0, nrmD = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (a.t.kind[i] === 0 && b.t.kind[i] === 0) continue;
    covered++;
    if (a.t.kind[i] !== b.t.kind[i]) { kindD++; continue; }
    if (a.t.objectId[i] !== b.t.objectId[i]) idD++;
    if (a.t.mat[i] !== b.t.mat[i]) matD++;
    if (Math.abs(a.t.depth[i] - b.t.depth[i]) > 1e-3 * a.t.depth[i]) depthD++;
    if (a.t.nrm[i] !== b.t.nrm[i]) nrmD++;
  }
  console.log(`  raster parity: ${covered} covered cells, items ${a.items} -> ${b.items}, kind ${kindD}, objectId ${idD}, mat ${matD}, depth ${depthD}, nrm ${nrmD}`);
  ok('grouped feed draws fewer items', b.items < a.items && b.items === 2, `${a.items} -> ${b.items}`);
  ok('scene is covered (non-trivial)', covered > 300, `covered ${covered}`);
  ok('kind / objectId / mat identical per cell', kindD === 0 && idD === 0 && matD === 0, `kind ${kindD} id ${idD} mat ${matD}`);
  ok('depth equal within f32 (1e-3 rel)', depthD === 0, `depthD ${depthD}`);
  ok('smooth normal bits identical', nrmD <= covered * 0.002, `nrmD ${nrmD}`);
}

// ---- 5. shadow feed: groups never used, MESH-SHADOW-02 budget unchanged -----------------------
{
  const w = mkWorld();
  for (let i = 0; i < 10; i++) place(w, rockA, 2 + i * 2, 0);
  const sunDir = dirFromAzEl(135, 40, new Float64Array(3));
  const sm = createSunShadowMatrix();
  shadowSunMatrix(sunDir, new Float64Array(3), { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 400 }, { min: -1, max: 10 }, sm);
  const src = { centre: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 0 }, meshLod0M: 25, cache: new LevelMeshCache(), meshCache: new MeshDrawCache(), meshIdFor: idFor };
  const sl = createShadowList();
  const _budgetWas = meshShadowBudget.enabled; meshShadowBudget.enabled = true; // the budget is opt-in (owner 2026-10-07 hotfix): this test checks it when ON
  buildShadowList(sl, null, w, sm.planes, src);
  meshShadowBudget.enabled = _budgetWas;
  const kinds = []; for (let i = 0; i < sl.count; i++) kinds.push(sl.items[i].type);
  ok('shadow list: cap-4 single draws, no instanced items', sl.count === meshShadowBudget.cap && kinds.every((k) => k === DRAW_STATIC), `count ${sl.count}`);
  const ids = []; for (let i = 0; i < sl.count; i++) ids.push(sl.items[i].objectId & 0xFFF);
  ok('shadow casters are the 4 nearest by object id', ids.join() === '0,1,2,3', ids.join());
}

// ---- 6. zero allocation ------------------------------------------------------------------------
{
  const w = mkWorld();
  for (let i = 0; i < 40; i++) place(w, i % 3 ? rockA : rockB, (i % 10) * 3 - 14, Math.floor(i / 10) * 4);
  const cam = { x: 0, y: 14, z: 1.7, yawDeg: 0, pitchDeg: 0 };
  const rt = { cols: 240, rows: 90, pxCellW: 1, pxCellH: 1 };
  const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
  projTerms(cam, rt, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  const list = new DrawList(), cache = new MeshDrawCache(), groups = new MeshGroupSet();
  const frame = () => { list.begin(); addMeshStructuresBatched(list, w, cam, cache, idFor, 2000, groups, planes); list.cull(planes); };
  for (let i = 0; i < 2000; i++) frame();
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  ok('0 allocation over 1000 batched feeds', grew < 32 * 1024, `grew ${grew}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
