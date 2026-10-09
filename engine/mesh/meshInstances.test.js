// engine/mesh/meshInstances.test.js (TREES-LP-b: InstanceGroups.meshGroup, `meshDraw` arg, shadow branch).
// Run: node engine/mesh/meshInstances.test.js  (re-spawns itself with --expose-gc for the zero-alloc gate)
import { readMeshJSON } from '../test/meshFile.test.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, DRAW_INSTANCED, DRAW_FLAG_ONE_PART, instancedRanges, MeshDrawCache, LevelMeshCache, addMeshStructures } from './DrawList.js';
import { InstanceGroups, writeUnitInstance, compactGroup, resolveGroupLod1 } from './instances.js';
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

const load = (n) => meshFromJSON(readMeshJSON(new URL(`../../content/meshes/kenney/${n}.mesh.json`, import.meta.url)));
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
  ok('masked range accepted (ALPHA-01f host b lifted the guard)', !threw);
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

// ---- WG-4a: meshDraw.gpu hook - an accepted group is not compacted on the CPU and pushes no item; a refusing hook = unchanged path --------
{
  const ig = new InstanceGroups(); const g = mkGroup(ig);
  const seen = []; const accept = (grp, m0, m1) => { seen.push([grp, m0, m1]); return true; };
  const l = new DrawList(); l.begin();
  g.drawCount[0] = 0;
  ig.addToDrawList(l, null, planes, 10, M, ROWS, { cache: new MeshDrawCache(), idFor, gpu: { accept } });
  ok('gpu hook accepted: no item, no CPU compaction', l.count === 0 && g.drawCount[0] === 0 && seen.length === 1 && seen[0][0] === g && !!seen[0][1] && seen[0][2] === null);
  const l2 = new DrawList(); l2.begin();
  ig.addToDrawList(l2, null, planes, 11, M, ROWS, { cache: new MeshDrawCache(), idFor, gpu: { accept: () => false } });
  ok('gpu hook refusing: CPU path as before', l2.count === 1 && g.drawCount[0] > 0);
}

// 38.9 ONEPART-a: instancedRanges helper + every caller uses it
{
  const mesh = { ranges: [{ start: 0, count: 1 }, { start: 1, count: 11 }], triCount: 12 };
  const r1 = instancedRanges({ mesh, flags: DRAW_FLAG_ONE_PART });
  ok('instancedRanges ONE_PART: one range {0, triCount}', r1.length === 1 && r1[0].start === 0 && r1[0].count === 12);
  ok('instancedRanges without the flag: mesh.ranges', instancedRanges({ mesh, flags: 0 }) === mesh.ranges);
  global.gc(); const h0 = process.memoryUsage().heapUsed; let sink = 0;
  for (let i = 0; i < 1000; i++) sink += instancedRanges({ mesh, flags: DRAW_FLAG_ONE_PART }).length;
  ok('instancedRanges: no per-call allocation', process.memoryUsage().heapUsed - h0 < 100000 && sink === 1000);
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const files = ['./rasterJS.js', '../render/gpu/wg/passRaster.js']; // WG-5b: GL pipeline deleted
  for (const f of files) ok(`${f} calls instancedRanges, no _oneRange copy`, /instancedRanges\(item\)/.test(src(f)) && !/_oneRange\s*[=\[]/.test(src(f)));
}

// ---- 7. QUAT-LOD-01 part 2: LOD1 mesh group (resolveGroupLod1 + compactGroup cap/hysteresis) --------------------------
{
  const lod1 = { ...oak, id: 'oak_lod1' }; // distinct identity so draw copies differ
  const lazyLod1 = { ...oak, id: 'oak_lod1_lazy', lazy: { store: null } };
  const lodOak = { ...oak, lods: [{ mesh: 'oak_lod1', ratio: 0.3, tris: 10 }] };
  const resolver = (id) => (id === 'oak_lod1' ? lod1 : id === 'oak_lod1_lazy' ? lazyLod1 : undefined);

  // 7a. selection through addToDrawList with a crafted viewProj (cw = ty + 1, so cw scales 3001x from ty=0 to ty=3000 -
  // robust to the unknown oak-mesh R): near (ty=0) -> LOD0, far (ty=3000) -> LOD1.
  {
    const vpSel = new Float64Array(16); vpSel[5] = 1; vpSel[7] = 1; vpSel[15] = 1;
    const ig = new InstanceGroups(); ig.bindMeshResolver(resolver);
    const g = ig.meshGroup(lodOak, 2); g.lodCells = 8;
    writeUnitInstance(g.ib, g.count++, 0, 0, 0, 0, 0xA000, 0);
    writeUnitInstance(g.ib, g.count++, 0, 3000, 0, 0, 0xA001, 0);
    const l = new DrawList(); l.begin();
    ig.addToDrawList(l, null, null, 30, vpSel, ROWS, { cache: new MeshDrawCache(), idFor });
    ok('near -> LOD0, far -> LOD1 (1 each)', g.drawCount[0] === 1 && g.drawCount[1] === 1, `${g.drawCount[0]} ${g.drawCount[1]}`);
    ok('2 DRAW_INSTANCED items, different meshes (LOD0 draw != LOD1 draw)', l.count === 2 && l.items[0].mesh !== l.items[1].mesh);
  }
  // 7b. resolveGroupLod1: no `lods` -> null forever; unloaded (lazy) LOD1 -> null (LOD0 fallback) until it reports ready.
  {
    const ig = new InstanceGroups(); ig.bindMeshResolver(resolver);
    const gPlain = ig.meshGroup(oak, 1);
    ok('no `lods`: resolveGroupLod1 -> null', resolveGroupLod1(gPlain, ig._meshLookup) === null && gPlain._mesh1 === null);
    const lazyOak = { ...oak, lods: [{ mesh: 'oak_lod1_lazy' }] };
    const gLazy = ig.meshGroup(lazyOak, 1);
    ok('unloaded LOD1 (mesh.lazy truthy) -> null (LOD0 fallback, no pop to nothing)', resolveGroupLod1(gLazy, ig._meshLookup) === null && gLazy._mesh1 === lazyLod1);
    delete lazyLod1.lazy; // payload "arrives"
    ok('resolveGroupLod1 re-checks readiness (no re-resolution) -> now ready', resolveGroupLod1(gLazy, ig._meshLookup) === lazyLod1);
    lazyLod1.lazy = { store: null }; // restore for any later use
  }
  // 7c. compactGroup directly: deterministic vp so `cells` is controlled by ty alone (cw = 1 + ty/D, k = R*rows).
  // Hysteresis: lo=180, hi=220 (lodCells=200). ty=0 -> cells=1000 (>hi, LOD0). ty=90000 -> cells=100 (<lo, LOD1).
  // ty=10000 -> cells≈909 (ambiguous only relative to a much larger lodCells; used below at a tuned lodCells instead).
  {
    const D = 10000, vp = new Float64Array(16); vp[5] = 1; vp[7] = 1 / D; vp[15] = 1;
    const mkG = (n) => { const ig = new InstanceGroups(); return ig.meshGroup(oak, n); };
    const put = (g, i, ty) => { const o = i * 16; g.ib.f32[o + 3] = 0; g.ib.f32[o + 7] = ty; g.ib.f32[o + 11] = 0; g.ib.u32[o + 12] = i; g.ib.u32[o + 13] = 0; };
    // hysteresis: lodCells=1000 -> lo=900, hi=1100. ty=0 gives cells=1000*rows/D... use R=1, rows=1 so k=1, cells=1/(1+ty/D).
    // Pick ty so cells lands exactly mid-band (ambiguous), then move it and confirm lodPrev sticks.
    {
      const g = mkG(1); g.count = 1; g.lodCells = 1000; const lo = 900, hi = 1100;
      const R = 2000; // k = R*1*1 = 2000; cells(ty) = R/(1+ty/D)
      // Solve ty for a target cells value c: c = R/(1+ty/D) -> ty = D*(R/c - 1)
      const tyFor = (c) => D * (R / c - 1);
      put(g, 0, tyFor(1000)); // exactly lodCells -> ambiguous, lodPrev (initial 0) decides -> LOD0
      let kept = compactGroup(g, null, R, vp, 1, 0);
      ok('hysteresis: ambiguous cells, lodPrev initially 0 -> LOD0', kept === 1 && g.drawCount[0] === 1 && g.drawCount[1] === 0);
      put(g, 0, tyFor(950)); // still inside [lo,hi]: lodPrev (0) holds -> stays LOD0
      compactGroup(g, null, R, vp, 1, 0);
      ok('hysteresis: still ambiguous -> sticks at LOD0 (lodPrev)', g.drawCount[0] === 1 && g.drawCount[1] === 0);
      put(g, 0, tyFor(800)); // below lo -> LOD1, lodPrev flips to 1
      compactGroup(g, null, R, vp, 1, 0);
      ok('below lo -> LOD1', g.drawCount[0] === 0 && g.drawCount[1] === 1);
      put(g, 0, tyFor(1000)); // back to the ambiguous band: lodPrev (1) holds -> stays LOD1
      compactGroup(g, null, R, vp, 1, 0);
      ok('hysteresis: ambiguous again, lodPrev 1 -> sticks at LOD1', g.drawCount[0] === 0 && g.drawCount[1] === 1);
    }
    // cap: 5 instances all naturally LOD0 (clearly above hi); lod0Cap=2 keeps the 2 nearest (largest cells = smallest ty).
    {
      const g = mkG(5); g.count = 5; g.lodCells = 10; g.lod0Cap = 2; const R = 20; // cells(ty<=50) ~= 20/(1+ty/D) stays > hi=11 for all 5 (natural LOD0)
      const tys = [50, 10, 40, 5, 30]; // ty=5 and ty=10 are nearest (largest cells)
      for (let i = 0; i < 5; i++) put(g, i, tys[i]);
      compactGroup(g, null, R, vp, 1, 0);
      ok('cap: 5 natural LOD0, lod0Cap=2 -> drawCount[0]=2, drawCount[1]=3', g.drawCount[0] === 2 && g.drawCount[1] === 3, `${g.drawCount[0]} ${g.drawCount[1]}`);
      const kept0 = new Set(); for (let j = 0; j < g.drawCount[0]; j++) kept0.add(g.drawIb[0].u32[j * 16 + 12]);
      ok('cap keeps the 2 nearest game slots (3 and 1, i.e. ty=5,10)', kept0.has(3) && kept0.has(1) && kept0.size === 2, [...kept0].join());
      ok('cap: within the cap (lod0Cap=10 >= 5) -> all 5 stay LOD0, no demotion', (() => {
        const g2 = mkG(5); g2.count = 5; g2.lodCells = 10; g2.lod0Cap = 10;
        for (let i = 0; i < 5; i++) put(g2, i, tys[i]);
        compactGroup(g2, null, R, vp, 1, 0);
        return g2.drawCount[0] === 5 && g2.drawCount[1] === 0;
      })());
    }
    // no `lods` / lodCells 0: byte-identical to the pre-LOD path (plain compaction, no cap scratch touched).
    {
      const g = mkG(2); g.count = 2; put(g, 0, 0); put(g, 1, 100000);
      const before0 = g.ib.u32.slice(), kept = compactGroup(g, null, 1, vp, 1, 0);
      ok('lodCells=0 (default): everything LOD0, unchanged ib', kept === 2 && g.drawCount[0] === 2 && g.drawCount[1] === 0 && g.ib.u32.every((v, i) => v === before0[i]));
    }
  }
  // 7d. zero allocation over 1000 frames with LOD + cap both active.
  {
    const ig = new InstanceGroups(); ig.bindMeshResolver(resolver);
    const g = ig.meshGroup(lodOak, 6); g.lodCells = 8; g.lod0Cap = 2;
    for (let i = 0; i < 6; i++) writeUnitInstance(g.ib, g.count++, 0, (i % 2) ? 3000 : i * 2, 0, 0, 0xA000 | i, 0);
    const md = { cache: new MeshDrawCache(), idFor };
    const list = new DrawList();
    let f = 0;
    const frame = () => { list.begin(); ig.addToDrawList(list, null, null, ++f, M, ROWS, md); };
    for (let i = 0; i < 2000; i++) frame();
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) frame();
    global.gc(); const grew = process.memoryUsage().heapUsed - h0;
    ok('0 allocation over 1000 frames (LOD + cap mesh group)', grew < 32 * 1024, `grew ${grew}`);
  }
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((m) => console.error('FAIL:', m)); process.exit(1); }
console.log('ALL PASS');
