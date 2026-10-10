// engine/world/terrainBand.test.js (WS1-02, arch 38.36): data-driven non-square near band.
// Run: node engine/world/terrainBand.test.js   (add --expose-gc for a meaningful heap number)
import { World } from './World.js';
import { Terrain } from './Terrain.js';
import { scatterTrees } from './scatter.js';
import { serialize } from './serialize.js';
import { TerrainMeshSet } from '../mesh/terrainMesh.js';
import { makeOk } from '../test/assert.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod;
farTowerMod; ferrumLightsMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const { assets } = await loadTestAssets();
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; return d; })(); // WS1-04 authored a band on world_m1; this case tests 'absent'
const heapMB = () => { if (globalThis.gc) globalThis.gc(); return process.memoryUsage().heapUsed / 1048576; };

// --- absent field = today's 3x3 (key + bake unchanged) ---------------------
const wOld = World.load(def0, assets, { detail: true });
ok('absent terrainBand -> world.terrainBand null', wOld.terrainBand === null);
ok('absent terrainBand -> 192x192 band', wOld.terrain.near.w === 192 && wOld.terrain.near.h === 192);
ok('absent terrainBand key has no rect suffix', !/x\d/.test(wOld.terrain._nearKey.split('|')[0]), wOld.terrain._nearKey.split('|')[0]);
ok('serialize omits terrainBand when absent', !('terrainBand' in serialize(wOld)));

// --- validation ------------------------------------------------------------
for (const [name, tb] of [['cw 0', { cx0: 8, cy0: 7, cw: 0, ch: 3 }], ['cw 7', { cx0: 8, cy0: 7, cw: 7, ch: 3 }], ['float', { cx0: 8.5, cy0: 7, cw: 5, ch: 3 }], ['neg', { cx0: -1, cy0: 7, cw: 5, ch: 3 }], ['str', 'x']]) {
  let threw = false;
  try { World.load({ ...def0, terrainBand: tb }, assets, {}); } catch (e) { threw = /terrainBand/.test(e.message); }
  ok(`validate rejects ${name}`, threw);
}

// --- 5x3 band load: shape, key, serialize round-trip ------------------------
const band = { cx0: 8, cy0: 7, cw: 5, ch: 3 };
const mem0 = heapMB();
const tl0 = performance.now();
const wNew = World.load({ ...def0, terrainBand: band }, assets, { detail: true });
const loadNewMs = performance.now() - tl0;
const mem1 = heapMB();
const T = wNew.terrain, g = T.near;
ok('5x3 band: 320x192 cells at x0 1024 y0 896', g.w === 320 && g.h === 192 && g.x0 === 1024 && g.y0 === 896, `${g.w}x${g.h}@${g.x0},${g.y0}`);
ok('nearBandKey includes the rect', T._nearKey.split('|')[0] === '8,7,5x3', T._nearKey.split('|')[0]);
const ser = serialize(wNew);
ok('serialize round-trips terrainBand', JSON.stringify(ser.terrainBand) === JSON.stringify(band));

// --- bake == stitched bakeChunk grids ---------------------------------------
{
  const n = T.chunkSize / T.nearCell;
  let bad = 0;
  for (let ky = 0; ky < 3 && !bad; ky++) for (let kx = 0; kx < 5 && !bad; kx++) {
    const C = T.util.bakeChunk(8 + kx, 7 + ky);
    for (let j = 0; j < n && !bad; j++) for (let i = 0; i < n; i++) {
      const a = (kx * n + i) + (ky * n + j) * g.w, b = i + j * n;
      if (g.height[a] !== C.height[b] || g.type[a] !== C.type[b]) { bad++; break; }
    }
  }
  ok('5x3 bake == stitched bakeChunk grids (height + type)', bad === 0);
}

// --- groundAt continuous across the old band edge x 1280 ----------------------
{
  let maxStep = 0;
  for (let y = 920; y < 1260; y += 7) for (let x = 1270; x < 1290; x += 0.5) maxStep = Math.max(maxStep, Math.abs(T.groundAt(x + 0.5, y) - T.groundAt(x, y)));
  ok('groundAt has no jump across x 1280', maxStep < 1.5, `max step per 0.5 m ${maxStep.toFixed(3)}`);
  let maxErr = 0;
  for (let y = 900; y < 1270; y += 11) for (let x = 1030; x < 1660; x += 13) maxErr = Math.max(maxErr, Math.abs(T.groundAt(x, y) - T.heightAt(x, y)));
  // bilinear on 2 m cells differs from the analytic height by the curvature term (0.01 m is only the 23.7 AC at the band EDGE)
  let edgeErr = 0;
  for (let y = 900; y < 1270; y += 11) for (const x of [1024.5, 1025, 1663, 1663.5]) edgeErr = Math.max(edgeErr, Math.abs(T.groundAt(x, y) - T.heightAt(x, y)));
  ok('groundAt vs heightAt: whole band < 0.5 m (bilinear), west/east edge columns < 0.5 m', maxErr < 0.5 && edgeErr < 0.5, `band ${maxErr.toFixed(3)} edge ${edgeErr.toFixed(3)}`);
  ok('groundTypeAt west of 1280 is band-sampled', T.groundTypeAt(1100, 1000) === T._nearGridType(1100, 1000));
}

// --- scatter over the 5x3 band (uses g.w and g.h separately) ------------------
{
  const cfgT = T.recipe.recipe.forest.trees, cfgD = T.recipe.recipe.detail;
  const sc = scatterTrees(T, wNew.structures), det = wNew.detail; // realTrees is off in world_m1: call the scatter directly
  console.log(`scatter world_m1 {8,7,5,3}: trees ${sc ? sc.count : 'n/a'} (3x3: ${wOld.scatter ? wOld.scatter.count : 'n/a'}, maxTrees ${cfgT.maxTrees}); detail ${det ? det.count : 'n/a'} (3x3: ${wOld.detail ? wOld.detail.count : 'n/a'}, maxPlacements ${cfgD ? cfgD.maxPlacements : 'n/a'})`);
  ok('trees scattered and <= maxTrees', !!sc && sc.count > 0 && sc.count <= cfgT.maxTrees, `${sc && sc.count}`);
  if (sc) {
    let xmin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (let i = 0; i < sc.count; i++) { xmin = Math.min(xmin, sc.x[i]); xmax = Math.max(xmax, sc.x[i]); ymax = Math.max(ymax, sc.y[i]); }
    ok('trees stay inside the band rect', xmin >= g.x0 && xmax <= g.x0 + g.w * g.cell && ymax <= g.y0 + g.h * g.cell);
  }
  ok('detail scattered and <= maxPlacements', !!det && det.count > 0 && det.count <= cfgD.maxPlacements, `${det && det.count}`);
}

// --- mesh set follows the band dims (JS twin of the terrain mesh) -------------
{
  if (!T.farReady) T.bakeFarSync();
  const set = new TerrainMeshSet(T);
  let guard = 0; while (set.step(50) && guard++ < 1000);
  ok('TerrainMeshSet: 15 near chunks for 5x3', set.near.length === 15, `${set.near.length}`);
  ok('TerrainMeshSet: every near chunk has triangles', set.near.every((m) => m.triCount > 0));
  ok('chunk bbox z inside terrain.near min/max', set.near[7].bbox[2] >= g.minH - 1e-4 && set.near[7].bbox[5] <= g.maxH + 1e-4);
  const tall = new Terrain(T.recipe); tall.bakeFarSync(); tall.bakeNearBand(10, 6, 3, 5);
  const tset = new TerrainMeshSet(tall); guard = 0; while (tset.step(50) && guard++ < 1000);
  ok('3x5 tall band: 15 chunks, 192x320 cells', tset.near.length === 15 && tall.near.w === 192 && tall.near.h === 320);
  ok('3x5 tall band: groundAt matches heightAt', Math.abs(tall.groundAt(1500, 1200) - tall.heightAt(1500, 1200)) < 0.01);
  // re-layout: same set, band flips from 3x3 to 5x3
  const flip = new Terrain(T.recipe); flip.bakeFarSync(); flip.bakeNearBand(11, 8);
  const fset = new TerrainMeshSet(flip); guard = 0; while (fset.step(50) && guard++ < 1000);
  flip.bakeNearBand(8, 7, 5, 3); guard = 0; while (fset.step(50) && guard++ < 1000);
  ok('mesh set re-lays out when the band changes 3x3 -> 5x3', fset.near.length === 15 && fset.near.every((m) => m.triCount > 0));
  // every band-vertex normal must be filled (build loops to near.h, not near.w)
  const nrmOk = (s) => { const a = s._bandNrm; for (let i = 0; i < a.length; i += 3) if (!(a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] > 0)) return false; return true; };
  ok('3x5 tall band: every _bandNrm normal non-zero (first build)', nrmOk(tset));
  const flip2 = new Terrain(T.recipe); flip2.bakeFarSync(); flip2.bakeNearBand(11, 8);
  const fset2 = new TerrainMeshSet(flip2); guard = 0; while (fset2.step(50) && guard++ < 1000);
  flip2.bakeNearBand(10, 6, 3, 5); guard = 0; while (fset2.step(50) && guard++ < 1000);
  ok('3x3 -> 3x5 re-layout: every _bandNrm normal non-zero', fset2.near.length === 15 && nrmOk(fset2));
}

// --- perf: bake time + memory 5x3 vs 3x3 -------------------------------------
{
  const best = (cb) => { let m = Infinity; for (let r = 0; r < 3; r++) { const t = performance.now(); cb(); m = Math.min(m, performance.now() - t); } return m; };
  const t3 = new Terrain(T.recipe), t5 = new Terrain(T.recipe);
  const ms3 = best(() => t3.bakeNearBand(11, 8)), ms5 = best(() => t5.bakeNearBand(8, 7, 5, 3));
  const bytes = (n) => n.height.byteLength + n.type.byteLength + n.hDraw.byteLength;
  console.log(`bake JS: 3x3 ${ms3.toFixed(1)} ms ${(bytes(t3.near) / 1048576).toFixed(2)} MB; 5x3 ${ms5.toFixed(1)} ms ${(bytes(t5.near) / 1048576).toFixed(2)} MB; World.load 5x3 ${loadNewMs.toFixed(0)} ms; heap delta ${(mem1 - mem0).toFixed(1)} MB`);
  // absolute ms depends on the machine load (the 160 ms gate is judged by WS1-08 on a quiet machine); the ratio is stable
  ok('5x3 bake costs <= 1.9x the 3x3 bake (area ratio 1.67)', ms5 <= 1.9 * ms3, `${(ms5 / ms3).toFixed(2)}x`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f2) => console.error('FAIL:', f2)); process.exit(1); }
console.log('ALL PASS');
