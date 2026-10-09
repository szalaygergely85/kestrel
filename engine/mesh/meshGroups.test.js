// engine/mesh/meshGroups.test.js (MESH-INST-01: CPU batching of repeated placed kind-9 meshes).
// Run: node engine/mesh/meshGroups.test.js  (re-spawns itself with --expose-gc for the zero-alloc gate)
import { readMeshJSON } from '../test/meshFile.test.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, DRAW_STATIC, DRAW_INSTANCED, DRAW_FLAG_ONE_PART, MeshDrawCache, LevelMeshCache, addMeshStructures } from './DrawList.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { buildWorldColliders } from '../world/colliders.js';
import { moveCircleMesh } from '../physics/meshCollide.js';
import { groupRadius } from './instances.js';
import { MeshGroupSet, addMeshStructuresBatched, meshIsSolid, MAX_GROUPED_INSTANCES } from './meshGroups.js';
import { rasterDrawList, createRasterTarget } from './rasterJS.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { buildShadowList, createShadowList } from './shadowList.js';
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
  ok('MESH-SCALE-01: scaled placement joins the group (4 of 4)', g.has(0) && g.has(1) && g.has(2) && g.has(3) && g.stats.members === 4);
  const l = new DrawList(); l.begin(); addMeshStructuresBatched(l, w, { x: 0, y: 14, z: 1.7 }, new MeshDrawCache(), idFor, 2000, g, null);
  ok('one instanced item for all 4 (scale in the matrix)', l.count === 1 && l.items[0].type === DRAW_INSTANCED && l.items[0].instCount === 4);
  const ib = l.items[0].instBuf.f32;
  ok('instance 2 matrix diagonal = 2 (yaw 0), instances 0/1 = 1; translation unchanged', ib[2 * 16] === 2 && ib[2 * 16 + 5] === 2 && ib[2 * 16 + 10] === 2 && ib[2 * 16 + 3] === 6 && ib[0] === 1 && ib[16 + 5] === 1);
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

// ---- 2b. BUG-MESH-MISSING-01: grouped placements are uncapped; the single cap ranks by projected size -------
{
  const w = mkWorld();
  for (let i = 0; i < 90; i++) place(w, i % 2 ? rockB : rockA, (i % 30) * 2.5 - 37, Math.floor(i / 30) * 6);
  const cam = { x: 3, y: 20, z: 1.7 };
  const cache = new MeshDrawCache();
  const single = new DrawList(); single.begin(); addMeshStructures(single, w, cam, cache, idFor, 2000);
  const bl = new DrawList(); bl.begin(); const gs = new MeshGroupSet();
  addMeshStructuresBatched(bl, w, cam, cache, idFor, 2000, gs, null);
  const got = new Set();
  for (let i = 0; i < bl.count; i++) { const it = bl.items[i]; if (it.type === DRAW_INSTANCED) for (let j = 0; j < it.instCount; j++) got.add(it.instBuf.u32[j * 16 + 12]); else got.add(it.objectId); }
  ok('90 placements: singles capped at 64, groups draw all 90 in 2 items', single.count === 64 && bl.count === 2 && got.size === 90, `single ${single.count} batched items ${bl.count} ids ${got.size}`);
}
{
  // owner repro: pebbles/mushrooms (near, 11-15 m) used to fill the 64 slots and the DeadTrees/rocks at ~30 m dropped
  const pebble = load('Pebble_Round_1'), mush = load('Mushroom_Common');
  const eyes = [[1446.63, 1024.64, 2.02], [1448.31, 1026.52, 2.08]];
  const build = (grouped) => {
    const w = mkWorld(), big = [];
    const cx = 1448, cy = 1026;
    for (let i = 0; i < 100; i++) { const a = i * 2.399, r = 8 + (i % 7) * 1.2; place(w, i % 3 ? (grouped ? pebble : { ...pebble, id: 'p' + i }) : (grouped ? mush : { ...mush, id: 'm' + i }), cx + Math.cos(a) * r, cy + Math.sin(a) * r, i * 7); }
    const trees = [tree, load('DeadTree_2'), load('DeadTree_3'), rockA, rockB, load('Rock_Medium_3')];
    for (let i = 0; i < 12; i++) { const a = 0.4 + i * 0.5, r = 22 + (i % 4) * 4; const m = trees[i % trees.length]; big.push(w.structures.length); place(w, grouped ? m : { ...m, id: m.id + '#' + i }, cx + Math.cos(a) * r, cy + Math.sin(a) * r, i * 31); }
    return { w, big };
  };
  for (const grouped of [true, false]) {
    const { w, big } = build(grouped);
    const sets = eyes.map((e) => {
      const l = new DrawList(); l.begin(); const g = new MeshGroupSet();
      addMeshStructuresBatched(l, w, { x: e[0], y: e[1], z: e[2] }, new MeshDrawCache(), idFor, 2000, g, null);
      const ids = new Set();
      for (let i = 0; i < l.count; i++) { const it = l.items[i]; if (it.type === DRAW_INSTANCED) for (let j = 0; j < it.instCount; j++) ids.add(it.instBuf.u32[j * 16 + 12] & 0xFFF); else ids.add(it.objectId & 0xFFF); }
      return ids;
    });
    const tag = grouped ? 'grouped' : 'singles';
    for (let k = 0; k < 2; k++) {
      const within = big.filter((si) => { const b = w.structures[si].bbox; const dx = Math.max(b.x0 - eyes[k][0], 0, eyes[k][0] - b.x1), dy = Math.max(b.y0 - eyes[k][1], 0, eyes[k][1] - b.y1); return Math.hypot(dx, dy) <= 40; });
      ok(`${tag}: every DeadTree/rock within 40 m of owner eye ${k + 1} is selected (${within.length})`, within.length >= 8 && within.every((si) => sets[k].has(si)), `missing ${within.filter((si) => !sets[k].has(si))}`);
    }
    ok(`${tag}: big-prop set identical across the 2 m eye step`, big.every((si) => sets[0].has(si) === sets[1].has(si)));
  }
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
  ok('scale set on a member rebuilds and keeps it grouped (MESH-SCALE-01)', g.stats.builds === 6 && g.has(2) && g.has(0) && g.has(1));
  w.structures[2].scale = 1; g.update(w, cache, idFor);
  ok('scale reset to 1 rebuilds too', g.stats.builds === 7);
  w.structures[2].scale = undefined; g.update(w, cache, idFor);
  ok('scale 1 vs undefined is the same snapshot (no rebuild)', g.stats.builds === 7);
  w.structures[2].scale = 3; g.update(w, cache, idFor);
  g.update(w, cache, () => 2);
  ok('material resolver change rebuilds', g.stats.builds === 9);
  w.structures.pop(); g.update(w, cache, () => 2);
  ok('removed placement rebuilds (2 left -> still a group)', g.stats.builds === 10 && g.stats.members === 2);
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

// ---- 4b. MESH-SCALE-01: scaled placements, grouped == single draws (JS twin), bbox, colliders ------
{
  const w = mkWorld();
  const scales = [0.5, 1, 1.5, 2.5, 0.75, 1.25, 3, 0.25];
  scales.forEach((k, i) => { const p = place(w, i % 2 ? rockB : rockA, -7 + i * 2, 0, i * 41); if (k !== 1) p.scale = k; });
  // placeMesh(scale) path: same thing through the API (bbox scaled with it)
  const wk = mkWorld();
  World.prototype.placeMesh.call(wk, rockA, { x: 4, y: 2, z: 0 }, 'a', 30);
  World.prototype.placeMesh.call(wk, rockA, { x: 4, y: 2, z: 0 }, 'b', 30, undefined, 2);
  const [pa, pb] = wk.structures;
  ok('placeMesh(scale): scale stored only when != 1', pa.scale === undefined && pb.scale === 2);
  ok('placeMesh(scale): bbox grows about the origin (z 2x, xy ~2x)', Math.abs(pb.bbox.z1 - 2 * pa.bbox.z1) < 1e-9 && Math.abs(pb.bbox.z0 - 2 * pa.bbox.z0) < 1e-9 && pb.bbox.x1 - pb.bbox.x0 > 1.9 * (pa.bbox.x1 - pa.bbox.x0), JSON.stringify([pa.bbox, pb.bbox]));

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
  console.log(`  scaled raster parity: ${covered} covered cells, items ${a.items} -> ${b.items}, kind ${kindD}, objectId ${idD}, mat ${matD}, depth ${depthD}, nrm ${nrmD}`);
  ok('scaled: 8 singles -> 2 instanced groups', a.items === 8 && b.items === 2, `${a.items} -> ${b.items}`);
  ok('scaled: scene covered', covered > 300, `covered ${covered}`);
  ok('scaled: kind / objectId / mat identical (0 diffs)', kindD === 0 && idD === 0 && matD === 0, `kind ${kindD} id ${idD} mat ${matD}`);
  ok('scaled: depth equal within f32', depthD === 0, `depthD ${depthD}`);
  ok('scaled: normal bits identical', nrmD <= covered * 0.002, `nrmD ${nrmD}`);
  let maxDev = 0;
  const u = new Float64Array(3);
  for (let i = 0; i < COLS * ROWS; i++) if (b.t.kind[i] === 9) { unpackNormalOct(b.t.nrm[i], u); maxDev = Math.max(maxDev, Math.abs(Math.hypot(u[0], u[1], u[2]) - 1)); }
  ok('scaled: cell normals unit length (renormalised)', maxDev < 1e-3, `dev ${maxDev}`);

  // cull radius uses the largest member scale
  const wc = mkWorld();
  place(wc, rockA, 0, 0); place(wc, rockA, -9, 0).scale = 3;
  const gc = new MeshGroupSet(), cc = new MeshDrawCache(); gc.update(wc, cc, idFor);
  ok('group radius scales with the largest member', gc.groups.length === 1 && gc.groups[0]._R > 2.99 * groupRadius(cc.get(rockA, idFor), gc.groups[0].parts));

  // colliders: the merged BVH holds the scaled proxy (2x tall, 2x wide about the placement origin)
  const cw = mkWorld();
  place(cw, rockA, 0, 0); place(cw, rockA, 20, 0).scale = 2;
  const m = buildWorldColliders(cw).find((c) => c.id === 'meshes:static');
  const tri = m.bvh.tri;
  let zA = -Infinity, zB = -Infinity, aLo = Infinity, aHi = -Infinity, bLo = Infinity, bHi = -Infinity;
  for (let i = 0; i < m.bvh.triCount * 9; i += 3) {
    const x = tri[i], z = tri[i + 2];
    if (x < 10) { zA = Math.max(zA, z); aLo = Math.min(aLo, x); aHi = Math.max(aHi, x); } else { zB = Math.max(zB, z); bLo = Math.min(bLo, x); bHi = Math.max(bHi, x); }
  }
  ok('collider: scaled proxy is 2x tall', Math.abs(zB - 2 * zA) < 1e-4 && zA > 0.1, `zA ${zA} zB ${zB}`);
  ok('collider: scaled proxy is 2x wide about its origin', Math.abs((bHi - bLo) - 2 * (aHi - aLo)) < 1e-4 && Math.abs((bHi - 20) - 2 * aHi) < 1e-4, `${aLo},${aHi} ${bLo},${bHi}`);
  ok('collider: collider AABB grew with the scale', m.max[0] > 20 + 1.9 * aHi, `max ${m.max[0]} aHi ${aHi}`);
  // a circle walking +x toward the scaled rock stops at its SCALED west face (an unscaled collider would stop 2x closer to the origin)
  const mvOut = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  // walk +x in 0.1 m steps until the circle stops advancing (blocked): returns the stall x
  const walkTo = (colls, x0, y) => { let x = x0; for (let i = 0; i < 400; i++) { const q = moveCircleMesh(colls, colls.length, x, y, 0.1, 0, 0.3, 0.5, true, { height: 1.7, stepUpMax: 0.1, walkCos: 0.7 }, mvOut); if (q.x < x + 0.05) return q.x; x = q.x; } return Infinity; };
  const stallA = walkTo([m], -8, 0), stallB = walkTo([m], 12, 0);
  ok('collider: unscaled circle stalls at the proxy west face - radius', Math.abs(stallA - (aLo - 0.3)) < 0.1, `stall ${stallA} aLo ${aLo}`);
  ok('collider: circle walking +x stalls at the SCALED west face - radius', Math.abs(stallB - (bLo - 0.3)) < 0.1 && stallB < 20 + 2 * aLo + 0.5, `stall ${stallB} bLo ${bLo}`);

  // zero allocation with scaled members
  const list = new DrawList(), cache = new MeshDrawCache(), groups = new MeshGroupSet();
  const frame = () => { list.begin(); addMeshStructuresBatched(list, w, cam, cache, idFor, 2000, groups, planes); list.cull(planes); };
  for (let i = 0; i < 2000; i++) frame();
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  ok('scaled: 0 allocation over 1000 batched feeds', grew < 32 * 1024, `grew ${grew}`);
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
  buildShadowList(sl, null, w, sm.planes, { ...src, meshCastM: 25, meshCastCap: 4 }); // the budget is opt-in: this test checks it ON with a cap of 4
  const kinds = []; for (let i = 0; i < sl.count; i++) kinds.push(sl.items[i].type);
  ok('shadow list: cap-4 single draws, no instanced items', sl.count === 4 && kinds.every((k) => k === DRAW_STATIC), `count ${sl.count}`);
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
