// engine/mesh/meshInstances.test.js (TREES-LP-b: InstanceGroups.meshGroup, `meshDraw` arg, shadow branch).
// Run: node engine/mesh/meshInstances.test.js  (re-spawns itself with --expose-gc for the zero-alloc gate)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, DRAW_INSTANCED, DRAW_FLAG_ONE_PART, MeshDrawCache, LevelMeshCache, addMeshStructures } from './DrawList.js';
import { InstanceGroups, writeUnitInstance } from './instances.js';
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

const load = (n) => meshFromJSON(JSON.parse(fs.readFileSync(new URL(`../../content/meshes/kenney/${n}.mesh.json`, import.meta.url), 'utf8')));
const oak = load('tree_oak');
const idFor = () => 1;
const COLS = 240, ROWS = 90, rt = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 };
const cam = { x: 0, y: 14, z: 1.7, yawDeg: 0, pitchDeg: 0 };
const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
projTerms(cam, rt, terms); shearProjection(terms, M); frustumPlanes(M, planes);

const spots = [[-7, 0, 0], [-3.5, 1, 40], [0, 0, 90], [3.5, -1, 135], [7, 0, 200], [1, -4, 300]];
const w = { structures: [], renderVersion: 0, structVersion: 0, events: null };
spots.forEach(([x, y, yaw], i) => World.prototype.placeMesh.call(w, oak, { x, y, z: 0 }, `t${i}`, yaw));
const rast = (l) => { const t = createRasterTarget(COLS, ROWS, 1, {}); rasterDrawList(l, t, { M, terms, snap: true }); return t; };
const mkGroup = (ig, n = spots.length) => {
  const g = ig.meshGroup(oak, n);
  for (let i = 0; i < n; i++) writeUnitInstance(g.ib, g.count++, spots[i][0], spots[i][1], 0, spots[i][2], 0xA000 | i, 0);
  return g;
};
const emptyWorld = { structures: [], renderVersion: 0, structVersion: 0, events: null };
const sm = createSunShadowMatrix();
shadowSunMatrix(dirFromAzEl(135, 40, new Float64Array(3)), new Float64Array(3), { ...SUN_SHADOW_DEFAULTS, res: 512, boxM: 400 }, { min: -1, max: 14 }, sm);

// ---- 1. parity: group of N == N static placements --------------------------------------------
{
  const a = new DrawList(); a.begin();
  addMeshStructures(a, w, cam, new MeshDrawCache(), idFor, 2000);
  a.cull(planes);
  const ig = new InstanceGroups(); mkGroup(ig);
  const b = new DrawList(); b.begin();
  ig.addToDrawList(b, null, planes, 1, M, ROWS, { cache: new MeshDrawCache(), idFor });
  b.cull(planes);
  ok('static: 6 items; group: 1 DRAW_INSTANCED + ONE_PART', a.count === 6 && b.count === 1 && b.items[0].type === DRAW_INSTANCED && (b.items[0].flags & DRAW_FLAG_ONE_PART) !== 0, `${a.count} -> ${b.count}`);
  const ta = rast(a), tb = rast(b);
  let cov = 0, kD = 0, idD = 0, mD = 0, dD = 0, nD = 0;
  for (let i = 0; i < COLS * ROWS; i++) {
    if (ta.kind[i] === 0 && tb.kind[i] === 0) continue;
    cov++;
    if (ta.kind[i] !== tb.kind[i]) { kD++; continue; }
    if (ta.objectId[i] !== tb.objectId[i]) idD++;
    if (ta.mat[i] !== tb.mat[i]) mD++;
    if (Math.abs(ta.depth[i] - tb.depth[i]) > 1e-3 * ta.depth[i]) dD++;
    if (ta.nrm[i] !== tb.nrm[i]) nD++;
  }
  console.log(`  parity: ${cov} covered, kind ${kD}, objectId ${idD}, mat ${mD}, depth ${dD}, nrm ${nD}`);
  ok('scene covered', cov > 300, `cov ${cov}`);
  ok('kind / objectId / mat identical', kD === 0 && idD === 0 && mD === 0, `kind ${kD} id ${idD} mat ${mD}`);
  ok('depth within f32 (<= 0.2 % cells off)', dD <= cov * 0.002, `dD ${dD}`);
  ok('normal bits identical (<= 0.2 %)', nD <= cov * 0.002, `nD ${nD}`);
}

// ---- 2. cull + compaction (stable order) ---------------------------------------------------
{
  const ig = new InstanceGroups();
  const g = ig.meshGroup(oak, 4);
  [-5, 400, 0, -400].forEach((x, i) => writeUnitInstance(g.ib, g.count++, x, 0, 0, 0, 0xA000 | i, 0));
  const l = new DrawList(); l.begin();
  const md = { cache: new MeshDrawCache(), idFor };
  ig.addToDrawList(l, null, planes, 7, M, ROWS, md);
  ok('compaction keeps 2 survivors, stable order', g.drawCount[0] === 2 && g.drawIb[0].u32[12] === 0xA000 && g.drawIb[0].u32[16 + 12] === 0xA002, `${g.drawCount[0]} ${g.drawIb[0].u32[12]}`);
  ok('stats culled = 2', ig.stats.instances === 2 && ig.stats.instancesCulled === 2);
  const before = l.count;
  ig.addToDrawList(l, null, planes, 7, M, ROWS, md); // memo: same frameNo
  ok('same frameNo re-pushes without recompute', ig.stats.instances === 2 && l.count === before + 1);
}

// ---- 3. meshDraw null / idFor null -> skipped; masked / missing throw --------------------------
{
  const ig = new InstanceGroups(); mkGroup(ig);
  const l = new DrawList(); l.begin();
  ig.addToDrawList(l, null, planes, 1, M, ROWS, null);
  ig.addToDrawList(l, null, planes, 2, M, ROWS);
  ig.addToDrawList(l, null, planes, 3, M, ROWS, { cache: new MeshDrawCache(), idFor: null });
  ok('meshDraw null/omitted/idFor null -> no items, no throw', l.count === 0);
  let threw = false;
  try { ig.meshGroup({ layout: 'static', ranges: [{ mask: 1 }] }, 2); } catch { threw = true; }
  ok('masked range throws', threw);
  threw = false;
  try { ig.meshGroup(null, 2); } catch { threw = true; }
  ok('missing mesh throws', threw);
}

// ---- 4. shadow list branch + castShadow false ---------------------------------------------------
{
  const ig = new InstanceGroups(); const g = mkGroup(ig);
  const mc = new MeshDrawCache();
  const mk = (extra) => ({ centre: { x: 0, y: 0, z: 0 }, cache: new LevelMeshCache(), instances: ig, meshCache: mc, meshIdFor: idFor, ...extra });
  const sl = createShadowList();
  buildShadowList(sl, null, emptyWorld, sm.planes, mk({ eye: { x: 0, y: 0 } }));
  ok('shadow list holds the group: 1 instanced item, 6 casters, ONE_PART', sl.count === 1 && sl.items[0].type === DRAW_INSTANCED && sl.items[0].instCount === 6 && (sl.items[0].flags & DRAW_FLAG_ONE_PART) !== 0, `count ${sl.count}`);
  buildShadowList(sl, null, emptyWorld, sm.planes, mk({}));
  ok('shadow list without eye: full buffer', sl.count === 1 && sl.items[0].instCount === 6);
  buildShadowList(sl, null, emptyWorld, sm.planes, mk({ eye: { x: 200, y: 200 } }));
  ok('shadow list: groups beyond instCastM drop', sl.count === 0, `count ${sl.count}`);
  buildShadowList(sl, null, emptyWorld, sm.planes, mk({ eye: { x: 0, y: 0 }, meshCache: undefined }));
  ok('shadow list without meshCache skips mesh groups', sl.count === 0);
  g.castShadow = false;
  buildShadowList(sl, null, emptyWorld, sm.planes, mk({ eye: { x: 0, y: 0 } }));
  ok('castShadow false -> not in shadow list', sl.count === 0);
}

// ---- 5. zero allocation -----------------------------------------------------------------------
{
  const ig = new InstanceGroups(); mkGroup(ig);
  const md = { cache: new MeshDrawCache(), idFor };
  const list = new DrawList(), sl = createShadowList();
  const src = { centre: { x: 0, y: 0, z: 0 }, cache: new LevelMeshCache(), instances: ig, meshCache: md.cache, meshIdFor: idFor, eye: { x: 0, y: 0 } };
  let f = 0;
  const frame = () => { list.begin(); ig.addToDrawList(list, null, planes, ++f, M, ROWS, md); list.cull(planes); buildShadowList(sl, null, emptyWorld, sm.planes, src); };
  for (let i = 0; i < 2000; i++) frame();
  global.gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 1000; i++) frame();
  global.gc(); const grew = process.memoryUsage().heapUsed - h0;
  ok('0 allocation over 1000 frames (camera + shadow feeds)', grew < 32 * 1024, `grew ${grew}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((m) => console.error('FAIL:', m)); process.exit(1); }
console.log('ALL PASS');
