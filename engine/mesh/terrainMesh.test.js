// engine/mesh/terrainMesh.test.js (ME-05, docs/architecture.md 27.15.5).
// Headless Node ESM, no framework. Run: node engine/mesh/terrainMesh.test.js
// Zero-allocation gate re-runs itself with --expose-gc (DrawList.test.js
// pattern) when missing.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Terrain } from '../world/Terrain.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { TerrainMeshSet, FAR_TILE_QUADS, FAR_LOD1_STEP, RING0_M } from './terrainMesh.js';
import { DrawList, DRAW_TERRAIN } from './DrawList.js';
import { rasterDrawList, createRasterTarget, clearRasterTarget } from './rasterJS.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { makeOk, approxEqual as approxEqualCore } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

function approxEqual(a, b, eps = 1e-6) { return approxEqualCore(a, b, eps); }

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

globalThis.window = globalThis.window || globalThis;
terrainDef; // runs the IIFE, sets window.ASSETS.levels.overworld_far
const recipe = globalThis.ASSETS.levels.overworld_far;

function makeTerrain() {
  const t = new Terrain(recipe);
  t.bakeFarSync();
  const towerCx = Math.floor(recipe.tower.x / t.chunkSize), towerCy = Math.floor(recipe.tower.y / t.chunkSize);
  t.bakeNearBand(towerCx, towerCy);
  return { terrain: t, towerCx, towerCy };
}

function stepUntilDone(set, maxCalls = 500) {
  let n = 0;
  while (set.step(2) && n++ < maxCalls);
  return n;
}

// ---------------------------------------------------------------------------
// 1. Construction preconditions.
// ---------------------------------------------------------------------------
{
  const { terrain } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  ok('constructs against a live band without throwing', !!set);
  ok('pending starts true (a near band already exists at construction)', set.pending === true);

  let threw = false;
  try {
    const bad = new Terrain(recipe);
    bad.bakeFarSync();
    bad.near = { x0: 1, y0: 0, w: 192, h: 192, cell: 2, hDraw: new Float32Array(192 * 192), type: new Uint8Array(192 * 192), minH: 0, maxH: 1, version: 1 };
    bad.nearReady = true;
    new TerrainMeshSet(bad);
  } catch (e) { threw = true; }
  ok('throws when near.x0 is not a multiple of the far cell', threw);
}

// ---------------------------------------------------------------------------
// 2. Near chunk vertex heights == band values; chunk edges share positions.
// ---------------------------------------------------------------------------
{
  const { terrain } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  ok('build finishes (pending -> false)', set.pending === false);

  const g = terrain.near;
  let allMatch = true, worst = 0;
  for (let ky = 0; ky < 3; ky++) {
    for (let kx = 0; kx < 3; kx++) {
      const i9 = ky * 3 + kx;
      const mesh = set.near[i9];
      const cc = set._chunkCol[kx].count, rc = set._chunkRow[ky].count;
      const colStart = set._chunkCol[kx].start, rowStart = set._chunkRow[ky].start;
      for (let lj = 0; lj < rc; lj += 7) {
        for (let li = 0; li < cc; li += 11) {
          const gi = colStart + li, gj = rowStart + lj;
          const expected = g.hDraw[gi + gj * g.w];
          const got = mesh.pos[(li + lj * cc) * 3 + 2];
          if (!approxEqual(got, expected, 1e-5)) { allMatch = false; worst = Math.max(worst, Math.abs(got - expected)); }
        }
      }
    }
  }
  ok('near chunk vertex z == band hDraw exactly (sampled)', allMatch, `worst diff=${worst}`);

  // Architect fix (ME-06): band vertex (i, j) is at the CELL CENTRE
  // `x0 + (i + 0.5) cell` (27.15.5) - the point `util.gridHeight`'s
  // bilinear, the far tiles and the stitch ring all use. A corner
  // placement was a 1 m shift of the whole band vs the DDA oracle.
  let centreOk = true, worstXY = 0;
  for (let ky = 0; ky < 3; ky++) {
    for (let kx = 0; kx < 3; kx++) {
      const mesh = set.near[ky * 3 + kx];
      const cc = set._chunkCol[kx].count, rc = set._chunkRow[ky].count;
      const colStart = set._chunkCol[kx].start, rowStart = set._chunkRow[ky].start;
      for (let lj = 0; lj < rc; lj += 5) {
        for (let li = 0; li < cc; li += 5) {
          const wx = mesh._origin.x + mesh.pos[(li + lj * cc) * 3], wy = mesh._origin.y + mesh.pos[(li + lj * cc) * 3 + 1];
          const ex = g.x0 + (colStart + li + 0.5) * g.cell, ey = g.y0 + (rowStart + lj + 0.5) * g.cell;
          const d = Math.max(Math.abs(wx - ex), Math.abs(wy - ey));
          if (d > 1e-6) { centreOk = false; worstXY = Math.max(worstXY, d); }
        }
      }
    }
  }
  ok('near chunk vertex world xy == band cell centre x0 + (i + 0.5) cell', centreOk, `worst=${worstXY}`);

  // Shared boundary column between chunk (0,0) and (1,0): world positions equal.
  const m00 = set.near[0], m10 = set.near[1];
  const cc0 = set._chunkCol[0].count;
  const rc0 = set._chunkRow[0].count;
  let edgeOk = true;
  for (let lj = 0; lj < rc0; lj++) {
    const v00 = (cc0 - 1) + lj * cc0; // last column of chunk (0,0)
    const v10 = 0 + lj * cc0;          // first column of chunk (1,0) - same row count (ky=0 shared)
    const worldX00 = m00._origin.x + m00.pos[v00 * 3];
    const worldX10 = m10._origin.x + m10.pos[v10 * 3];
    const z00 = m00.pos[v00 * 3 + 2], z10 = m10.pos[v10 * 3 + 2];
    if (!approxEqual(worldX00, worldX10, 1e-6) || !approxEqual(z00, z10, 1e-6)) edgeOk = false;
  }
  ok('shared chunk boundary column is watertight (identical world pos/z)', edgeOk);
}

// ---------------------------------------------------------------------------
// 3. Normals within tolerance of terrain.groundNormalAt (near) and the
//    independent far-normal formula (far tiles).
// ---------------------------------------------------------------------------
{
  const { terrain } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  const g = terrain.near;
  let worst = 0;
  const outA = { x: 0, y: 0, z: 1 };
  for (let ky = 0; ky < 3; ky++) {
    for (let kx = 0; kx < 3; kx++) {
      const i9 = ky * 3 + kx;
      const mesh = set.near[i9];
      const colStart = set._chunkCol[kx].start, rowStart = set._chunkRow[ky].start;
      const cc = set._chunkCol[kx].count, rc = set._chunkRow[ky].count;
      for (let lj = 4; lj < rc - 4; lj += 13) {
        for (let li = 4; li < cc - 4; li += 17) {
          const gi = colStart + li, gj = rowStart + lj;
          const x = g.x0 + (gi + 0.5) * g.cell, y = g.y0 + (gj + 0.5) * g.cell;
          terrain.groundNormalAt(x, y, outA);
          const packed = mesh.nrm[li + lj * cc];
          const n = [0, 0, 0];
          unpackNormalOct(packed, n);
          const d = Math.hypot(n[0] - outA.x, n[1] - outA.y, n[2] - outA.z);
          if (d > worst) worst = d;
        }
      }
    }
  }
  ok('near vertex normals match groundNormalAt within 0.02 (interior points)', worst < 0.02, `worst=${worst}`);
}

// ---------------------------------------------------------------------------
// 4. Far tiles: skirt vertices at tileMinH - 1; far cells under the band
//    excluded (degenerate LOD0 triangles under the near band).
// ---------------------------------------------------------------------------
{
  const { terrain } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  ok('far tiles built', set._farBuilt === true);
  ok('at least one far tile carved by the band', set._excludedTileSet.size > 0);

  // Skirt check on an unexcluded tile (tile 0, far from the tower).
  const tile0 = set.far[0];
  const lod0 = tile0._lod0;
  const nc0 = lod0.cols.length, nr0 = lod0.rows.length;
  let minH = Infinity;
  for (let v = 0; v < nc0 * nr0; v++) minH = Math.min(minH, tile0.pos[v * 3 + 2]);
  const bottomBase = nc0 * nr0;
  const perimLen = 2 * nc0 + 2 * nr0 - 4;
  let skirtOk = true;
  for (let k = 0; k < perimLen; k++) {
    const z = tile0.pos[(bottomBase + k) * 3 + 2];
    if (!(z <= minH - 1 + 1e-6)) skirtOk = false;
  }
  ok('far tile LOD0 skirt vertices are at/below tileMinH - 1', skirtOk);

  // Under-band exclusion: every far-tile LOD0 triangle whose world footprint
  // is fully inside the band's open rectangle must be degenerate (0,0,0).
  const bandRect = set._bandRect;
  let exclusionOk = true, checked = 0;
  for (const k of set._excludedTileSet) {
    const mesh = set.far[k];
    const l0 = mesh._lod0;
    const cell = terrain.mapCell;
    for (let qy = 0; qy < l0.rows.length - 1; qy++) {
      for (let qx = 0; qx < l0.cols.length - 1; qx++) {
        const i = l0.cols[qx], j = l0.rows[qy];
        const qx0 = cell * i + cell / 2, qx1 = cell * (i + 1) + cell / 2;
        const qy0 = cell * j + cell / 2, qy1 = cell * (j + 1) + cell / 2;
        const under = qx0 < bandRect.x1 && qx1 > bandRect.x0 && qy0 < bandRect.y1 && qy1 > bandRect.y0;
        const o = (qy * (l0.cols.length - 1) + qx) * 6;
        const isDeg = mesh.idx[o] === 0 && mesh.idx[o + 1] === 0 && mesh.idx[o + 2] === 0;
        checked++;
        if (under !== isDeg) exclusionOk = false;
      }
    }
  }
  ok('far LOD0 quads under the band are degenerate, others real', exclusionOk, `checked=${checked}`);

  // ME-06: no real LOD0 skirt triangle may stand inside the band's open
  // rectangle (its top edge poked up through the near ground at outsideNear).
  let skirtInside = 0, skirtChecked = 0, skirtKept = 0;
  for (const k of set._excludedTileSet) {
    const mesh = set.far[k];
    const l0 = mesh._lod0;
    const o0 = (l0.cols.length - 1) * (l0.rows.length - 1) * 6;
    for (let s = 0; s < l0.perim.length; s++) {
      const o = o0 + s * 6;
      skirtChecked++;
      if (mesh.idx[o] === 0 && mesh.idx[o + 1] === 0 && mesh.idx[o + 2] === 0) continue;
      skirtKept++;
      const a = mesh.idx[o], b = mesh.idx[o + 1];
      const mx = (mesh.pos[a * 3] + mesh.pos[b * 3]) / 2, my = (mesh.pos[a * 3 + 1] + mesh.pos[b * 3 + 1]) / 2;
      if (mx > bandRect.x0 && mx < bandRect.x1 && my > bandRect.y0 && my < bandRect.y1) skirtInside++;
    }
  }
  ok('no real far LOD0 skirt segment inside the band rectangle', skirtInside === 0, `inside=${skirtInside} kept=${skirtKept}/${skirtChecked}`);
  ok('skirt segments outside the band stay real', skirtKept > 0, `kept=${skirtKept}`);
}

// ---------------------------------------------------------------------------
// 5. Stitch: positive area, cross z > 0, loop lengths sane.
// ---------------------------------------------------------------------------
{
  const { terrain } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  const s = set.stitch;
  ok('stitch has triangles', s.triCount > 0, `triCount=${s.triCount}`);
  let allPositive = true;
  for (let t = 0; t < s.triCount; t++) {
    const a = s.idx[t * 3], b = s.idx[t * 3 + 1], c = s.idx[t * 3 + 2];
    const ax = s.pos[a * 3], ay = s.pos[a * 3 + 1];
    const bx = s.pos[b * 3], by = s.pos[b * 3 + 1];
    const cx = s.pos[c * 3], cy = s.pos[c * 3 + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross <= 0) allPositive = false;
  }
  ok('every stitch triangle has positive xy area (cross z > 0)', allPositive);
}

// ---------------------------------------------------------------------------
// 6. typeAt matches castTerrain's near/far pick rule.
// ---------------------------------------------------------------------------
{
  const { terrain, towerCx, towerCy } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  const g = terrain.near;
  const insideX = g.x0 + g.w * g.cell * 0.5, insideY = g.y0 + g.h * g.cell * 0.5;
  ok('typeAt inside the band matches terrain._nearGridType', set.typeAt(insideX, insideY) === terrain._nearGridType(insideX, insideY));
  const farX = 10, farY = 10; // well outside the tower band
  const ix = Math.floor(farX / terrain.mapCell), iy = Math.floor(farY / terrain.mapCell);
  ok('typeAt outside the band matches nearest farType', set.typeAt(farX, farY) === terrain.farType[iy * terrain.mapW + ix]);
}

// ---------------------------------------------------------------------------
// 7. Flip: bakeNearBand at a neighbour chunk, step to completion; meshVersion
//    bumps only on the swap; result matches a fresh TerrainMeshSet built
//    directly on the new band.
// ---------------------------------------------------------------------------
{
  const { terrain, towerCx, towerCy } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  const meshesBefore = set.near.slice(); // object identities of the published (front) set
  const versionsBefore = set.near.map((m) => m.meshVersion);

  let identityChangedMidway = false;
  terrain.bakeNearBand(towerCx + 1, towerCy);
  let calls = 0;
  // Architect (ME-06): a 0.2 ms budget here, not the production 2 ms - the
  // assertion is "row-granular", and a fast machine finished all 192 rows
  // inside one 2 ms call (the "flip took more than one step call" flake).
  while (set.step(0.2)) {
    calls++;
    if (set.near.some((m, i) => m !== meshesBefore[i])) identityChangedMidway = true;
    if (calls > 1000) break;
  }
  ok('flip took more than one step call (row-granular)', calls > 1, `calls=${calls}`);
  ok('front set identity does not change until the final swap call', !identityChangedMidway);
  ok('front set swaps to the other buffer once the flip completes', set.near.every((m, i) => m !== meshesBefore[i]));
  ok('each swapped-in chunk mesh has a bumped meshVersion (>= 2, was fully rebuilt)', set.near.every((m) => m.meshVersion >= 2));
  // Architect fix (ME-06): front/back share ids (the MeshBuffers cache key),
  // so versions must be unique ACROSS both sets, not per mesh - a second
  // flip used to hand the GPU cache "version 2" twice (stale buffer).
  ok('swapped-in meshVersion is strictly greater than the previous front version (shared id, one counter)',
    set.near.every((m, i) => m.meshVersion > versionsBefore[i]));
  terrain.bakeNearBand(towerCx, towerCy);
  const versionsMid = set.near.map((m) => m.meshVersion);
  stepUntilDone(set);
  ok('second flip: versions strictly increase again', set.near.every((m, i) => m.meshVersion > versionsMid[i]));

  const fresh = new TerrainMeshSet(terrain);
  stepUntilDone(fresh);
  let byteEqual = true;
  for (let i = 0; i < 9; i++) {
    if (set.near[i].pos.length !== fresh.near[i].pos.length) { byteEqual = false; continue; }
    for (let k = 0; k < set.near[i].pos.length; k++) if (set.near[i].pos[k] !== fresh.near[i].pos[k]) byteEqual = false;
  }
  ok('flipped result byte-equal to a fresh TerrainMeshSet built on the new band', byteEqual);
}

// ---------------------------------------------------------------------------
// 8. addToDrawList + rasterJS integration smoke test.
// ---------------------------------------------------------------------------
{
  const { terrain, towerCx, towerCy } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);

  const list = new DrawList(512);
  list.begin();
  const cam = { x: recipe.tower.x, y: recipe.tower.y - 40, z: 40, yawDeg: 0, pitchDeg: -10 };
  set.addToDrawList(list, cam);
  ok('addToDrawList pushed items', list.count > 0, `count=${list.count}`);
  ok('every pushed item is DRAW_TERRAIN', Array.from({ length: list.count }, (_, i) => list.items[i].type).every((t) => t === DRAW_TERRAIN));

  const cols = 80, rows = 30;
  const grid = { cols, rows };
  const terms = {};
  projTerms(cam, grid, terms);
  const M = new Float64Array(16);
  shearProjection(terms, M);
  const target = createRasterTarget(cols, rows, 1);
  clearRasterTarget(target);
  const ctx = { M, terms, kind7Mat: set.typeAt.bind(set) };
  rasterDrawList(list, target, ctx);
  let kind7Count = 0;
  for (let i = 0; i < target.kind.length; i++) if (target.kind[i] === 7) kind7Count++;
  ok('rasterDrawList produced kind-7 (terrain) pixels', kind7Count > 0, `kind7Count=${kind7Count}`);

  // Architect fix (ME-06): structure footprint carve - `ctx.structFoot`
  // boxes (the DDA `buildSkips` rule) leave no kind-7 fragment with world
  // (u, v) inside the box, and every fragment outside is unchanged.
  // The cam above looks north (yaw 0) from tower.y - 40 at 40 m height, pitch -10: the
  // nearest visible ground is ~90 m ahead, so put the box 80-160 m ahead of it.
  const box = new Float64Array([recipe.tower.x - 40, recipe.tower.y - 200, recipe.tower.x + 40, recipe.tower.y - 120]);
  const target2 = createRasterTarget(cols, rows, 1);
  clearRasterTarget(target2);
  rasterDrawList(list, target2, { M, terms, kind7Mat: set.typeAt.bind(set), structFoot: box, structCount: 1 });
  let inBox = 0, carved = 0, outsideChanged = 0;
  for (let i = 0; i < target2.kind.length; i++) {
    const wasIn = target.kind[i] === 7 && target.u[i] >= box[0] && target.u[i] < box[2] && target.v[i] >= box[1] && target.v[i] < box[3];
    if (target2.kind[i] === 7 && target2.u[i] >= box[0] && target2.u[i] < box[2] && target2.v[i] >= box[1] && target2.v[i] < box[3]) inBox++;
    if (wasIn) { if (target2.kind[i] !== 7 || target2.depth[i] !== target.depth[i]) carved++; }
    else if (target2.kind[i] !== target.kind[i] || target2.depth[i] !== target.depth[i]) outsideChanged++;
  }
  ok('structFoot carve: no kind-7 fragment lands inside the footprint box', inBox === 0, `inBox=${inBox}`);
  ok('structFoot carve: fragments that were inside the box changed (carved), and some existed', carved > 0, `carved=${carved}`);
  ok('structFoot carve: fragments outside the box are byte-identical', outsideChanged === 0, `outsideChanged=${outsideChanged}`);
}

// ---------------------------------------------------------------------------
// 9. Perf: near-band flip step cost (warn-only unless PERF_STRICT=1).
// ---------------------------------------------------------------------------
{
  const { terrain, towerCx, towerCy } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  terrain.bakeNearBand(towerCx + 1, towerCy + 1);
  let worst = 0;
  while (set.step(2)) {
    const t0 = process.hrtime.bigint();
    // step already ran above; measure the NEXT call instead (fresh timing).
    break;
  }
  // Re-measure properly: redo the flip with per-call timing.
  terrain.bakeNearBand(towerCx, towerCy);
  const set2 = new TerrainMeshSet(terrain);
  stepUntilDone(set2);
  terrain.bakeNearBand(towerCx + 1, towerCy + 1);
  worst = 0;
  let calls = 0;
  while (true) {
    const t0 = process.hrtime.bigint();
    const pending = set2.step(2);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (dt > worst) worst = dt;
    calls++;
    if (!pending || calls > 1000) break;
  }
  console.log(`  TerrainMeshSet flip: worst step() = ${worst.toFixed(3)} ms over ${calls} calls`);
  if (process.env.PERF_STRICT === '1') ok('step() <= 2 ms + one row on this machine', worst < 6, `worst=${worst.toFixed(3)}ms`);
  else if (!(worst < 6)) console.log('PERF WARN: step() exceeded budget on this machine (set PERF_STRICT=1 to gate)');
}

// ---------------------------------------------------------------------------
// 10. Zero allocation: steady-state (no flip) step()+addToDrawList calls.
// ---------------------------------------------------------------------------
{
  const { terrain } = makeTerrain();
  const set = new TerrainMeshSet(terrain);
  stepUntilDone(set);
  const list = new DrawList(512);
  const cam = { x: recipe.tower.x, y: recipe.tower.y - 40, z: 40 };
  let sink = 0;

  function frame() {
    set.step(2);
    list.begin();
    set.addToDrawList(list, cam);
    sink += list.count;
  }
  for (let i = 0; i < 50; i++) frame(); // warm up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) frame();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  ok('steady-state step()+addToDrawList: no significant heap growth over 2000 frames', grew < 64 * 1024, `grew ${grew} bytes (sink=${sink})`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
