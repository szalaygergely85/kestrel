// OB-019 RIVER-02 (architecture.md 38.45 (2)): the river ribbon mesh + JS twin - mesh counts, chunk LOD / runs, clip, texel packing,
// streaks, alpha, foam, allocation. Node ESM, no framework.
// Run: node --expose-gc engine/render/riverRibbon.test.js
import { World } from '../world/World.js';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { GBuffer } from './GBuffer.js';
import { bindShading, bindLevel } from './MaterialTable.js';
import { renderWorld } from './compositor.js';
import { makeLightBuffer } from './lighting.js';
import { buildRiverMesh, packRiverTexel, RIVER_COLS, RIVER_CHUNK_ROWS } from '../mesh/waterMesh.js';
import { selectWater, createWaterSelection, renderWaterJS, RIVER_RUNS_MAX, RIVER_RUNS_STRIDE, WATER_RIVER_SLOT0 } from './water.js';
import { allocProbe } from '../../tools/allocProbe.mjs';
import { createWater, collectWaterDefs } from '../world/water.js';
import { projTerms, shearProjection, unprojectCell } from './projection.js';
import { frustumPlanes } from '../mesh/culling.js';
import {
  resolveWaterLooks, defaultWaterLooks, fillWaterSlotTable, riverStreakHit, riverAlpha, WL_TABLE_SLOTS, WL_STRIDE, packRiverLook,
} from './waterLook.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const mkWorld = (list) => ({ water: createWater(collectWaterDefs({ water: list }, [])) });
const rect = (id, r, z, extra) => ({ id, shape: 'rect', rect: r, z, ...extra });

// 1 km fixture along +x: z 20 -> 10, halfW 4, speed 1.5
const km = { id: 'km', shape: 'river', path: Array.from({ length: 21 }, (_, i) => [i * 50, 0, 20 - i * 0.5, 4, 1.5]), feather: 1.5 };
// passes everything: 6 axis planes with d = 1e9
const PASS = new Float64Array(24);
for (let i = 0; i < 6; i++) { PASS[i * 4 + (i % 3)] = i < 3 ? 1 : -1; PASS[i * 4 + 3] = 1e9; }
const boxDist = (c, x0, y0, z0, x1, y1, z1) => {
  const f = (v, a, b) => (v < a ? a - v : v > b ? v - b : 0);
  return Math.hypot(f(c.x, x0, x1), f(c.y, y0, y1), f(c.z, z0, z1));
};
/** Index ranges of a selection's river slot k -> per-chunk coverage flags for (lod0, lod1). */
function coverage(sel, k, mesh) {
  const ro = k * RIVER_RUNS_STRIDE, nr = sel.riverRuns[ro];
  const cov = mesh.chunks.map(() => [false, false]);
  for (let r = 0; r < nr; r++) {
    const a = sel.riverRuns[ro + 1 + 2 * r], b = a + sel.riverRuns[ro + 2 + 2 * r];
    mesh.chunks.forEach((c, i) => {
      if (a <= c.lod0Start && c.lod0Start + c.lod0Count <= b && c.lod0Count > 0) cov[i][0] = true;
      if (a <= c.lod1Start && c.lod1Start + c.lod1Count <= b && c.lod1Count > 0) cov[i][1] = true;
    });
  }
  return cov;
}

// ---- 1. mesh ----
{
  const w = mkWorld([km]); const rv = w.water.rivers[0];
  const m = buildRiverMesh(rv);
  ok('mesh: 8 verts per sample row', m.vertCount === rv.n * RIVER_COLS && m.verts.length === m.vertCount * 8, `${m.vertCount}`);
  ok('mesh: LOD0 = (rows-1) * 7 quads * 2 tris', m.lod0Tris === (rv.n - 1) * 14, `${m.lod0Tris}`);
  ok('mesh: chunks of 32 rows share boundary rows', m.chunks.length === Math.ceil((rv.n - 1) / RIVER_CHUNK_ROWS) && m.chunks.every((c, i) => i === 0 ? c.r0 === 0 : c.r0 === m.chunks[i - 1].r1) && m.chunks[m.chunks.length - 1].r1 === rv.n - 1);
  ok('mesh: LOD1 tris < LOD0 / 6', m.lod1Tris < m.lod0Tris / 6 && m.lod1Tris > 0, `${m.lod1Tris} vs ${m.lod0Tris}`);
  // budget (38.45): a 1.7 km river ~6.8k verts / ~12k tris (LOD0); ours is 1 km
  const w2 = mkWorld([{ ...km, path: Array.from({ length: 35 }, (_, i) => [i * 50, 0, 20 - i * 0.3, 4]) }]);
  const m2 = buildRiverMesh(w2.water.rivers[0]);
  ok('mesh: 1.7 km river within budget (<= 7000 verts, <= 12500 tris)', m2.vertCount <= 7000 && m2.lod0Tris <= 12500, `${m2.vertCount} / ${m2.lod0Tris}`);
  // every river sample is covered: cols 3/4 straddle the centre line, cols 0/7 sit at +-(hw+feather), e = 0 / feather at the edges
  let cover = true, widthOk = true, eOk = true;
  for (let i = 0; i < rv.n; i++) {
    const v = (c) => (i * RIVER_COLS + c) * 8;
    const mx = (m.verts[v(3)] + m.verts[v(4)]) / 2 + m.ox, my = (m.verts[v(3) + 1] + m.verts[v(4) + 1]) / 2 + m.oy;
    if (Math.abs(mx - rv.x[i]) > 1e-3 || Math.abs(my - rv.y[i]) > 1e-3) cover = false;
    const wd = Math.hypot(m.verts[v(0)] - m.verts[v(7)], m.verts[v(0) + 1] - m.verts[v(7) + 1]);
    if (Math.abs(wd - 2 * (rv.hw[i] + rv.feather)) > 1e-3) widthOk = false;
    if (m.verts[v(0) + 4] !== 0 || Math.abs(m.verts[v(1) + 4] - rv.feather) > 1e-5 || m.verts[v(7) + 4] !== 0) eOk = false;
  }
  ok('mesh: ribbon covers every river sample (centre line between cols 3/4)', cover);
  ok('mesh: outer width = 2 (hw + feather) on every row', widthOk);
  ok('mesh: e = 0 at the outer edge, feather at the bank', eOk);
  // chunk AABBs contain their vertices; all triangles CCW from above
  let boxOk = true;
  for (const c of m.chunks) for (let r = c.r0; r <= c.r1; r++) for (let q = 0; q < RIVER_COLS; q++) {
    const o = (r * RIVER_COLS + q) * 8, x = m.ox + m.verts[o], y = m.oy + m.verts[o + 1], z = m.verts[o + 2];
    if (x < c.x0 - 1e-6 || x > c.x1 + 1e-6 || y < c.y0 - 1e-6 || y > c.y1 + 1e-6 || z < c.z0 - 1e-6 || z > c.z1 + 1e-6) boxOk = false;
  }
  ok('mesh: chunk AABBs contain their vertices', boxOk);
  const ccw = (mesh) => {
    let bad = 0;
    for (let t = 0; t < mesh.index.length; t += 3) {
      const a = mesh.index[t] * 8, b = mesh.index[t + 1] * 8, c = mesh.index[t + 2] * 8, V = mesh.verts;
      if ((V[b] - V[a]) * (V[c + 1] - V[a + 1]) - (V[b + 1] - V[a + 1]) * (V[c] - V[a]) <= 0) bad++;
    }
    return bad;
  };
  ok('mesh: every triangle (LOD0 + LOD1) is CCW from above', ccw(m) === 0);
  const wc = mkWorld([{ id: 'c', shape: 'river', path: [[0, 0, 5, 3], [30, 0, 4.8, 3], [60, 25, 4.5, 3], [90, 25, 4.2, 3], [120, 0, 4, 3]] }]);
  ok('mesh: curved river triangles CCW too', ccw(buildRiverMesh(wc.water.rivers[0])) === 0);
  // rapids + normal: a 0.5-slope drop gives rapid 1 and a tilted normal; flat stretch 0
  const ws = mkWorld([{ id: 's', shape: 'river', path: [[0, 0, 10, 3, 1], [20, 0, 10, 3, 1], [40, 0, 0, 3, 1], [60, 0, 0, 3, 1]] }]);
  const rs = ws.water.rivers[0], ms = buildRiverMesh(rs);
  const mid = rs.s.findIndex((s) => s >= 30), flat = 2;
  ok('mesh: rapid = 1 on the steep drop, 0 on the flat; nx points downhill-ish', ms.verts[(mid * 8 + 3) * 8 + 7] === 1 && ms.verts[(flat * 8 + 3) * 8 + 7] === 0 && ms.verts[(mid * 8 + 3) * 8 + 5] > 0.2);
}

// ---- 2. selection: LOD, far cull, runs ----
{
  const w = mkWorld([km]); const rv = w.water.rivers[0]; const sel = createWaterSelection();
  const cam = { x: 500, y: 0, z: 40 };
  selectWater(w, cam, PASS, sel);
  const mesh = rv.mesh;
  ok('select: one river in slot 12, regions untouched', sel.riverCount === 1 && sel.count === 0 && sel.u[WATER_RIVER_SLOT0 * 16] === 3 && sel.region[WATER_RIVER_SLOT0] === 0);
  const nr = sel.riverRuns[0];
  ok('select: 1 km river visible end to end -> <= 8 runs', nr >= 1 && nr <= RIVER_RUNS_MAX, `${nr}`);
  const cov = coverage(sel, 0, mesh);
  let nearOk = true, farOk = true;
  mesh.chunks.forEach((c, i) => {
    const d = boxDist(cam, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1);
    if (d < 192 - 1e-6 && !cov[i][0]) nearOk = false;
    if (d > 192 + 1e-6 && (cov[i][0] || !cov[i][1])) farOk = false;
  });
  ok('select: chunks < 192 m are LOD0, beyond are LOD1 (all within riverFarM covered)', nearOk && farOk);
  selectWater(w, { x: -1000, y: 0, z: 40 }, PASS, sel);
  const cov2 = coverage(sel, 0, mesh);
  let farCull = true;
  mesh.chunks.forEach((c, i) => {
    const d = boxDist({ x: -1000, y: 0, z: 40 }, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1);
    if (d > 1200 && (cov2[i][0] || cov2[i][1])) farCull = false;
    if (d < 1200 - 1e-6 && !cov2[i][1]) farCull = false;
  });
  ok('select: culled beyond look.riverFarM (1200 m), LOD1 only at 1 km', sel.riverCount === 1 && farCull && cov2.filter((c) => c[1]).length < mesh.chunks.length);
  selectWater(w, { x: -2500, y: 0, z: 40 }, PASS, sel);
  ok('select: whole river beyond riverFarM -> not selected', sel.riverCount === 0);
  const wf = mkWorld([km]);
  selectWater(wf, cam, PASS, sel, resolveWaterLooks({ river: { riverFarM: 100 } }));
  ok('select: look riverFarM is honoured', sel.riverCount === 1 && coverage(sel, 0, wf.water.rivers[0].mesh).filter((c) => c[0] || c[1]).length <= 4);
  // frustum: a plane that removes x > 300 (inside if x <= 300)
  const half = PASS.slice(); half[0] = -1; half[3] = 300; half[4] = 0; half[5] = 0; half[6] = 0;
  const w3 = mkWorld([km]); selectWater(w3, { x: 250, y: 0, z: 40 }, half, sel);
  const cov3 = coverage(sel, 0, w3.water.rivers[0].mesh);
  ok('select: frustum-culled chunks are skipped', cov3.some((c) => c[0]) && w3.water.rivers[0].mesh.chunks.every((c, i) => c.x0 > 300 + 1 ? !(cov3[i][0] || cov3[i][1]) : true));
  // serpentine (12 legs of 600 m): many separate visible pieces -> merged into <= 8 runs, near chunks still covered
  const pts = []; let zz = 50;
  for (let j = 0; j < 12; j++) {
    const y = 60 * j, sgn = j % 2 === 0 ? 1 : -1, X = (x) => (sgn > 0 ? x : 600 - x);
    for (let k = 0; k <= 10; k++) pts.push([X(k * 60), y, (zz -= 0.01), 2]);
    if (j < 11) for (const a of [-60, 0, 60]) pts.push([X(600 + 30 * Math.cos(a * Math.PI / 180)), y + 30 + 30 * Math.sin(a * Math.PI / 180), (zz -= 0.01), 2]);
  }
  const ws = mkWorld([{ id: 'snake', shape: 'river', path: pts }]);
  const lk = resolveWaterLooks({ river: { riverFarM: 300 } });
  const camS = { x: 300, y: 330, z: 40 };
  selectWater(ws, camS, PASS, sel, lk);
  const mS = ws.water.rivers[0].mesh, covS = coverage(sel, 0, mS);
  let need = true, anyVis = 0;
  mS.chunks.forEach((c, i) => {
    const d = boxDist(camS, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1);
    if (d < 192 - 1e-6) { anyVis++; if (!covS[i][0]) need = false; } else if (d < 300 - 1e-6 && !(covS[i][1] || covS[i][0])) need = false;
  });
  ok('select: serpentine river -> <= 8 runs and every visible chunk is drawn (gaps merged)', sel.riverRuns[0] <= RIVER_RUNS_MAX && sel.riverRuns[0] >= 2 && need && anyVis > 4, `runs ${sel.riverRuns[0]} vis ${anyVis}`);
  // draw:false regions and rect regions are not river slots; a world without rivers leaves slots 12..13 alone
  const wn = mkWorld([rect('a', [0, 0, 10, 10], 0), rect('hidden', [0, 20, 10, 30], 0, { draw: false })]);
  selectWater(wn, { x: 5, y: 5, z: 10 }, PASS, sel);
  ok('select: no rivers -> riverCount 0; draw:false region not selected', sel.riverCount === 0 && sel.count === 1 && sel.region[0] === 0);
}

// ---- 3. texel packing + alpha + streaks ----
{
  let rt = true;
  for (const e of [0, 0.0004, 0.5, 1.5, 1.2345, 7.3333, 30.001, 65.5]) {
    const w = packRiverTexel(13, 1, 200, e);
    if (Math.abs((w >>> 16) / 1000 - e) > 0.00051 || (w & 15) !== 13 || ((w >> 4) & 1) !== 1 || (w & 64) === 0 || ((w >>> 8) & 255) !== 200) rt = false;
  }
  ok('texel w: slot / back / ribbon bit / rapidQ / e round-trip to 1 mm', rt);
  ok('texel w: e saturates at 65.535 m', (packRiverTexel(12, 0, 0, 1000) >>> 16) === 65535);
  ok('alpha: 0 at e = 0 and at col = 0, 1 inside', riverAlpha(1, 0, 5, 1.5, 0.15) === 0 && riverAlpha(1, 3, 0, 1.5, 0.15) === 0 && riverAlpha(0.8, 3, 5, 1.5, 0.15) === 0.8 && Math.abs(riverAlpha(1, 0.75, 5, 1.5, 0.15) - 0.5) < 1e-12);
  ok('look: river keys validate', (() => { try { packRiverLook('x', { shoreFade: 0 }); return false; } catch (e) { return /shoreFade/.test(e.message); } })() && packRiverLook('ok', null)[3] === 1200);
  // streaks: the pattern in (tau, e) shifts by dt in tau (= v*dt metres of arc) per tick, downstream
  const w = mkWorld([km]); const sel = createWaterSelection();
  selectWater(w, { x: 500, y: 0, z: 40 }, PASS, sel);
  const table = new Float32Array(WL_TABLE_SLOTS * WL_STRIDE), lb = WATER_RIVER_SLOT0 * WL_STRIDE;
  const pattern = (t, e) => { fillWaterSlotTable(sel, w, defaultWaterLooks(), table, t); const out = []; for (let k = 0; k < 2000; k++) out.push(riverStreakHit(table, lb, 10 + k * 0.01, e)); return out; };
  const dt = 0.4, shift = Math.round(dt / 0.01);
  let match = 0, total = 0, hits = 0;
  for (const e of [1.7, 2.6, 3.9, 5.2]) {
    const p0 = pattern(5, e), p1 = pattern(5 + dt, e);
    for (let k = shift + 5; k < 2000 - 5; k++) { total++; if (p1[k] === p0[k - shift]) match++; if (p0[k]) hits++; }
  }
  ok('streaks: pattern at t+dt == pattern at t shifted by dt in tau (moves downstream at v*dt = 0.6 m)', match / total > 0.995 && hits / total > 0.1 && hits / total < 0.9, `${match}/${total} hits ${hits}`);
  ok('streaks: row carries mode 3, feather, streakT, shoreFade', table[lb + 32] === 3 && table[lb + 30] === 1.5 && Math.abs(table[lb + 29] - 0.8) < 1e-6 && Math.abs(table[lb + 31] - 0.15) < 1e-6 && table[lb + 51] === 3);
}

// ---- 4. JS twin raster ----
const COLS = 160, ROWS = 60, grid = { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 2 };
const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
function frame(cam) {
  projTerms(cam, grid, terms); shearProjection(terms, M); frustumPlanes(M, planes);
  return { gbuf: { cols: COLS, rows: ROWS }, depth: { depth: new Float32Array(COLS * ROWS).fill(Infinity) }, water: null };
}
const river100 = { id: 'r', shape: 'river', path: [[0, 0, 0.4, 3, 1.5], [50, 0, 0.3, 3, 1.5], [100, 0, 0.2, 3, 1.5]] };
function seeRiver(world) {
  for (const yaw of [0, 90, 180, 270]) {
    for (const pos of [{ x: 50, y: -30 }, { x: 50, y: 30 }, { x: -30, y: 0 }, { x: 130, y: 0 }]) {
      const cam = { ...pos, z: 14, yawDeg: yaw, pitchDeg: -35 };
      const fb = frame(cam), t = renderWaterJS(fb, world, cam, M, planes, true);
      let n = 0; if (t) for (let i = 0; i < t.kind.length; i++) if (t.kind[i] && (t.objectId[i] & 64)) n++;
      if (n > 200) return { cam, fb, t, n };
    }
  }
  return null;
}
{
  const world = mkWorld([river100]);
  const seen = seeRiver(world);
  ok('raster: the ribbon draws into the water target', !!seen, 'no camera saw it');
  if (seen) {
    const { t, cam } = seen;
    let slotOk = true, backs = 0, eMax = 0, eBad = 0, multi = 0, flat = true, bad = 0;
    for (let i = 0; i < t.kind.length; i++) {
      if (t.writes[i] > 1) multi++;
      if (!t.kind[i] || !(t.objectId[i] & 64)) continue;
      const w = t.objectId[i];
      if ((w & 15) !== 12) slotOk = false;
      if (w & 16) backs++;
      const e = (w >>> 16) / 1000; eMax = Math.max(eMax, e);
      if (e > 4.5 + 0.01) eBad++;
      if (!(t.z[i] >= 0 && t.z[i] <= 100 / 1.5 + 1)) bad++;
      if (!(t.depth[i] > 0)) flat = false;
    }
    ok('raster: slot 12, seen from above, e within 0..hw+feather, tau within the river', slotOk && backs === 0 && eBad === 0 && eMax > 3 && bad === 0 && flat, `backs ${backs} eMax ${eMax} bad ${bad}`);
    ok('raster: every ribbon pixel written exactly once (no seams between rows / chunks)', multi === 0, `${multi}`);
    // tau is the arc-time: monotone with the unprojected world x
    const P = [0, 0, 0]; let mono = true, lastX = -Infinity, n = 0;
    const samples = [];
    for (let i = 0; i < t.kind.length; i++) if (t.kind[i] && (t.objectId[i] & 64)) { unprojectCell(terms, i % COLS, (i / COLS) | 0, t.depth[i], P); samples.push([P[0], t.z[i]]); }
    for (const [x, tau] of samples) if (Math.abs(tau - x / 1.5) > 0.35) mono = false;
    ok('raster: tau per texel = x / speed (flow time along the river)', mono && samples.length > 100, `${samples.length}`);
  }
  // clip: a lake region on top of the river; draw:false so only the clip decides
  const lakeRegion = rect('lake', [40, -20, 60, 20], 0.35, { draw: false });
  const wClip = mkWorld([{ ...river100, clip: ['lake'] }, lakeRegion]);
  const wFree = mkWorld([river100, lakeRegion]);
  const s2 = seeRiver(wFree);
  if (s2) {
    const countIn = (world) => {
      const fb = frame(s2.cam), t = renderWaterJS(fb, world, s2.cam, M, planes, false);
      const P = [0, 0, 0]; let inLake = 0, outLake = 0;
      for (let i = 0; i < t.kind.length; i++) if (t.kind[i] && (t.objectId[i] & 64)) {
        unprojectCell(terms, i % COLS, (i / COLS) | 0, t.depth[i], P);
        if (P[0] > 40.2 && P[0] < 59.8 && P[1] > -20 && P[1] < 20) inLake++; else outLake++;
      }
      return [inLake, outLake];
    };
    const [inFree, outFree] = countIn(wFree), [inClip, outClip] = countIn(wClip);
    ok('clip: ribbon cells inside the clip region are discarded, the rest stays', inFree > 20 && inClip === 0 && outClip > 20 && Math.abs(outClip - outFree) <= 16, `free ${inFree}/${outFree} clip ${inClip}/${outClip}`);
  }
}

// ---- 5. full composite: edge feather, foam by column, GPU twin untouched without rivers ----
{
  const { assets } = await loadTestAssets();
  const R_COLS = 80, R_ROWS = 40;
  const makeFb = (world) => {
    const matTable = bindShading(assets.palette, assets.detailPass, 1);
    if (world.structures[0]) bindLevel(matTable, world.structures[0].level);
    return { rt: new CellBuffer(R_COLS, R_ROWS), depth: new DepthBuffer(R_COLS, R_ROWS), palette: assets.palette, gbuf: new GBuffer(R_COLS, R_ROWS), matTable, detailPass: null, lights: null, light: makeLightBuffer(R_COLS, R_ROWS), timeSec: 0, loop: { stats: {} }, renderer: 'mesh' };
  };
  const roomDef = (water) => ({ terrain: null, structures: [{ id: 'test_room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [], water });
  const CAM = { x: 5.5, y: 5.5, z: 1.6, yawDeg: 40, pitchDeg: -25, projection: 'shear' };
  const run = (water) => { const world = World.load(roomDef(water), assets, {}); const fb = makeFb(world); for (let k = 0; k < 2; k++) renderWorld(fb, world, CAM); if (fb.water) { fb.wk = fb.water.kind.slice(); fb.wo = fb.water.objectId.slice(); } return fb; }; // the water target is a shared module scratch: copy it
  const base = run([]);
  const deep = run([{ id: 'rv', shape: 'river', path: [[1.5, 5.5, 0.6, 1.5, 1], [10, 5.5, 0.6, 1.5, 1]] }]);
  const shallow = run([{ id: 'rv', shape: 'river', path: [[1.5, 5.5, 0.12, 1.5, 1], [10, 5.5, 0.12, 1.5, 1]] }]);
  const cells = (fb) => fb.rt.cells || fb.rt;
  const cb = cells(base), cd = cells(deep), cs = cells(shallow);
  let rib = 0, edgeBad = 0, edgeN = 0, inner = 0, innerChanged = 0;
  const wt = deep.wk ? { kind: deep.wk, objectId: deep.wo } : null;
  for (let i = 0; wt && i < R_COLS * R_ROWS; i++) {
    if (!wt.kind[i] || !(wt.objectId[i] & 64)) continue;
    rib++;
    const e = (wt.objectId[i] >>> 16) / 1000;
    if (e < 0.04) { // alpha <= 0.027: the cell must equal the river-less render (bg within 8, glyph unchanged)
      edgeN++;
      for (let c = 0; c < 3; c++) if (Math.abs(cd.bg[i * 4 + c] - cb.bg[i * 4 + c]) > 8) edgeBad++;
      if (cd.glyphIdx[i] !== cb.glyphIdx[i]) edgeBad++;
    }
    if (e > 2.4) { inner++; if (cd.glyphIdx[i] !== cb.glyphIdx[i] || Math.abs(cd.bg[i * 4] - cb.bg[i * 4]) > 8) innerChanged++; }
  }
  ok('composite: ribbon cells exist in the full scene', rib > 30 && inner > 5, `${rib} / ${inner}`);
  ok('composite: alpha ~0 at the outer edge (cell == river-less render)', edgeN === 0 || edgeBad === 0, `${edgeBad}/${edgeN}`);
  ok('composite: the deep middle is water (cells changed)', inner > 5 && innerChanged / inner > 0.8, `${innerChanged}/${inner}`);
  const foam = new Set([...'*o.'].map((c) => c.charCodeAt(0) - 32));
  let foamShallow = 0, foamDeep = 0, nShallow = 0, nDeep = 0;
  const ws = shallow.wk ? { kind: shallow.wk, objectId: shallow.wo } : null;
  for (let i = 0; ws && i < R_COLS * R_ROWS; i++) if (ws.kind[i] && (ws.objectId[i] & 64) && ((ws.objectId[i] >>> 16) / 1000) > 2.4) { nShallow++; if (foam.has(cs.glyphIdx[i])) foamShallow++; }
  for (let i = 0; wt && i < R_COLS * R_ROWS; i++) if (wt.kind[i] && (wt.objectId[i] & 64) && ((wt.objectId[i] >>> 16) / 1000) > 2.4) { nDeep++; if (foam.has(cd.glyphIdx[i])) foamDeep++; }
  ok('composite: foam where the column is shallow (stone / bank), none in deep water', nShallow > 3 && foamShallow / nShallow > 0.9 && foamDeep / Math.max(1, nDeep) < 0.25, `shallow ${foamShallow}/${nShallow} deep ${foamDeep}/${nDeep}`);
}

// ---- 6. allocation + perf ----
{
  const world = mkWorld([river100, rect('sea', [-300, -300, -200, -200], 0)]);
  const seen = seeRiver(world);
  const cam = seen ? seen.cam : { x: 50, y: -30, z: 14, yawDeg: 0, pitchDeg: -35 };
  const fb = frame(cam), sel = createWaterSelection();
  const looks = defaultWaterLooks();
  const run = (n) => { for (let i = 0; i < n; i++) { selectWater(world, cam, planes, sel, looks); renderWaterJS(fb, world, cam, M, planes, false); } };
  run(1500);
  if (globalThis.gc) {
    // chunked + min of 5 windows (NODE24-ALLOC: a single run(100) per window is boxed in Maglev/OSR on Node 24)
    const grown = allocProbe(run, { n: 100, chunk: 10, warm: 4, settle: 30, limit: 655 }).bytes;
    ok('zero allocation: 100 select + JS-twin frames with a river grow the heap < 64 KB', grown < 65536, `${grown} B`);
  } else console.log('(run with --expose-gc for the allocation check)');
  const t0 = process.hrtime.bigint(); run(20);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  console.log(`perf: select + JS twin, 160x60, 100 m river: ${ms.toFixed(2)} ms/frame`);
  if (ms > 2) console.log('WARN: river JS twin above 2 ms (38.45 budget, warn only)');
}

console.log(`\nriverRibbon.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL: ' + f); process.exit(1); }
