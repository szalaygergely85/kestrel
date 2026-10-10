// @ts-check
// engine/mesh/terrainMesh.js - ME-05 (docs/backlog.md, docs/architecture.md
// 27.4, 27.8, 27.15.5 - normative). Turns the near band (`Terrain.near`,
// US-026a) and the far 8 m grid (`Terrain.farHDraw`) into indexed
// `MeshData` (ME-01) chunks the rasteriser (ME-03) can draw through the same
// `DrawList`/`rasterJS` path as levels and voxel props - so terrain and
// structures share one depth buffer with no seam at the tower foot.
//
// Per 27.15.5: "US-026b S1 is not a blocker." This codes against TODAY'S
// `terrain.near` contract - `{x0, y0, w, h, cell, height, type, hDraw,
// minH, maxH, version}` - and detects a band flip by OBJECT IDENTITY (a
// flip = a new `near` object). `Terrain.js` is read-only here: never edited,
// never monkey-patched.
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (27.15.0) - never a caster (Terrain.js's sibling
// terrainCaster.js), gpu/*, game/ or design/. The "analytic normal" formula
// and the near/far type-pick rule below are therefore literal, independent
// copies of `terrainCaster.js`'s `terrainNormal`/`castTerrain` logic, not
// imports of it (that file is off-limits per the "Do not" list below).
//
// Do not: edit Terrain.js/terrainCaster.js; sample `heightAt` for vertices
// inside the band; rebuild inside a fixed step or inside `rasterDrawList`;
// give terrain per-cell planeIds; enable `DRAW_FLAG_DEPTH_BIAS` by default.
import { packNormalOct } from '../voxel/octNormal.js';
import { DRAW_TERRAIN } from './DrawList.js';

/** Far tile size in 8 m quads (32 quads = 256 m per tile). */
export const FAR_TILE_QUADS = 32;
/** LOD1 far tiles keep every 4th vertex column/row (32 m effective spacing). */
export const FAR_LOD1_STEP = 4;
/** Far tiles within this 2D distance of the eye draw at LOD0 (8 m); beyond it, LOD1. */
export const RING0_M = 512;

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ---------------------------------------------------------------------------
// Small geometry helpers (module-level scratch where the hot path uses them)
// ---------------------------------------------------------------------------

/** `(-(hR-hL)/(2c), -(hU-hD)/(2c), 1)` normalised - the far grid's analytic
 * normal (c = 8 m on `terrain._farGridDraw`, falling back to the smooth
 * analytic `heightAt` past the grid edge). Literal copy of
 * `terrainCaster.js`'s `terrainNormal(terrain, x, y, false, out)` - that
 * file cannot be imported (27.15.0 import allow-list), so this is
 * independently maintained; `terrain.groundNormalAt` already covers the
 * NEAR (c = 2, `groundAt` fallback) case for near-band vertices below. */
function farNormalAt(terrain, x, y, out) {
  const c = 8;
  const grid = terrain._farGridDraw;
  const gh = terrain.util.gridHeight;
  let hL = gh(grid, x - c, y); if (hL === null) hL = terrain.heightAt(x - c, y);
  let hR = gh(grid, x + c, y); if (hR === null) hR = terrain.heightAt(x + c, y);
  let hD = gh(grid, x, y - c); if (hD === null) hD = terrain.heightAt(x, y - c);
  let hU = gh(grid, x, y + c); if (hU === null) hU = terrain.heightAt(x, y + c);
  const dhdx = (hR - hL) / (2 * c), dhdy = (hU - hD) / (2 * c);
  const len = Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
  out.x = -dhdx / len; out.y = -dhdy / len; out.z = 1 / len;
  return out;
}

/** `Array.from`-free inclusive index list at `step` (always includes both `start` and `end`). */
function stepIndices(start, end, step) {
  const arr = [];
  for (let i = start; i < end; i += step) arr.push(i);
  if (arr.length === 0 || arr[arr.length - 1] !== end) arr.push(end);
  return arr;
}

/** Ordered perimeter of a `cols x rows` grid (position indices into `cols`/`rows`, not world coords), starting at the min corner, +x, +y, -x, -y. */
function perimeterPosList(nc, nr) {
  const list = [];
  for (let cp = 0; cp < nc; cp++) list.push([cp, 0]);
  for (let rp = 1; rp < nr; rp++) list.push([nc - 1, rp]);
  for (let cp = nc - 2; cp >= 0; cp--) list.push([cp, nr - 1]);
  for (let rp = nr - 2; rp > 0; rp--) list.push([0, rp]);
  return list;
}

/** Same shape as `perimeterPosList` but over explicit global (i, j) integer ranges (used by the near/far stitch loops). */
function perimeterIJList(iMin, iMax, jMin, jMax) {
  const list = [];
  for (let i = iMin; i <= iMax; i++) list.push([i, jMin]);
  for (let j = jMin + 1; j <= jMax; j++) list.push([iMax, j]);
  for (let i = iMax - 1; i >= iMin; i--) list.push([i, jMax]);
  for (let j = jMax - 1; j > jMin; j--) list.push([iMin, j]);
  return list;
}

// ---------------------------------------------------------------------------
// Near band chunks
// ---------------------------------------------------------------------------

/** Static grid index buffer (2 triangles per quad), shared by front/back chunk MeshData of the same shape (topology never changes). */
function buildGridIndex(cols, rows) {
  const nq = (cols - 1) * (rows - 1);
  const idx = new Uint32Array(nq * 6);
  let o = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = i + j * cols, b = (i + 1) + j * cols, c = (i + 1) + (j + 1) * cols, d = i + (j + 1) * cols;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = a; idx[o++] = c; idx[o++] = d;
    }
  }
  return idx;
}

/** @typedef {import('./MeshData.js').MeshData & {_origin: {x:number,y:number,z:number}}} NearChunkMesh */

/** @returns {NearChunkMesh} */
function makeNearChunkMesh(id, cols, rows, idxBuf) {
  const vCount = cols * rows;
  return {
    version: /** @type {1} */ (1), id, layout: /** @type {'terrain'} */ ('terrain'),
    pos: new Float32Array(vCount * 3),
    uv: new Float32Array(0),
    nrm: new Uint32Array(vCount),
    flat: new Uint32Array(0),
    aux: new Float32Array(0),
    idx: idxBuf,
    triCount: idxBuf.length / 3,
    bbox: new Float64Array(6),
    ranges: [{ start: 0, count: idxBuf.length / 3 }],
    matKeys: [], matsResolved: true, meshVersion: 1,
    _origin: { x: 0, y: 0, z: 0 },
  };
}

// ---------------------------------------------------------------------------
// Far tiles (LOD0 8 m + LOD1 32 m, each with its own skirt)
// ---------------------------------------------------------------------------

/** One LOD level's vertex layout for a far tile: `cols`/`rows` are GLOBAL far-grid indices (step 1 for LOD0, `FAR_LOD1_STEP` for LOD1), `perim` is the position-index perimeter loop over them (skirt order). */
function buildFarLodLayout(desc, step) {
  const cols = stepIndices(desc.colStart, desc.colEnd, step);
  const rows = stepIndices(desc.rowStart, desc.rowEnd, step);
  const perim = perimeterPosList(cols.length, rows.length);
  return { cols, rows, perim };
}

/** Fills one LOD level's vertices + main-quad/skirt indices at the given typed-array offsets. Returns `{minH}` (tile's own min height on this level's sampled vertices - close enough to a full 8 m tile scan for the skirt floor). */
function fillFarLevel(terrain, level, cell, pos, nrm, idx, vertBase, idxMainOff, idxSkirtOff, scratchN) {
  const { cols, rows, perim } = level;
  const nc = cols.length, nr = rows.length;
  let minH = Infinity;
  for (let rp = 0; rp < nr; rp++) {
    const j = rows[rp];
    for (let cp = 0; cp < nc; cp++) {
      const i = cols[cp];
      const vi = vertBase + cp + rp * nc;
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      const z = terrain.farHDraw[i + j * terrain.mapW];
      pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
      farNormalAt(terrain, x, y, scratchN);
      nrm[vi] = packNormalOct(scratchN.x, scratchN.y, scratchN.z);
      if (z < minH) minH = z;
    }
  }
  let qo = idxMainOff;
  for (let rp = 0; rp < nr - 1; rp++) {
    for (let cp = 0; cp < nc - 1; cp++) {
      const a = vertBase + cp + rp * nc, b = vertBase + (cp + 1) + rp * nc;
      const c = vertBase + (cp + 1) + (rp + 1) * nc, d = vertBase + cp + (rp + 1) * nc;
      idx[qo++] = a; idx[qo++] = b; idx[qo++] = c;
      idx[qo++] = a; idx[qo++] = c; idx[qo++] = d;
    }
  }
  const bottomBase = vertBase + nc * nr;
  const skirtZ = minH - 1;
  for (let k = 0; k < perim.length; k++) {
    const cp = perim[k][0], rp = perim[k][1];
    const i = cols[cp], j = rows[rp];
    const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
    const topI = vertBase + cp + rp * nc;
    const bi = bottomBase + k;
    pos[bi * 3] = x; pos[bi * 3 + 1] = y; pos[bi * 3 + 2] = skirtZ;
    nrm[bi] = nrm[topI];
  }
  let so = idxSkirtOff;
  const perimLen = perim.length;
  for (let k = 0; k < perimLen; k++) {
    const k2 = (k + 1) % perimLen;
    const t0 = vertBase + perim[k][0] + perim[k][1] * nc;
    const t1 = vertBase + perim[k2][0] + perim[k2][1] * nc;
    const b0 = bottomBase + k, b1 = bottomBase + k2;
    idx[so++] = t0; idx[so++] = t1; idx[so++] = b1;
    idx[so++] = t0; idx[so++] = b1; idx[so++] = b0;
  }
  return { minH };
}

/** @typedef {{cols: number[], rows: number[], perim: number[][]}} FarLodLayout */
/** @typedef {import('./MeshData.js').MeshData & {_desc: Object, _lod0: FarLodLayout, _lod1: FarLodLayout}} FarTileMesh */

/** Fills a far tile's whole vertex/index/bbox data (both LODs) into caller-owned arrays - shared by the first build and the in-place re-fill in `markNearDirty`. */
function fillFarTile(terrain, lod0, lod1, pos, nrm, idx, bb) {
  const cell = terrain.mapCell;
  const nc0 = lod0.cols.length, nr0 = lod0.rows.length, perim0 = lod0.perim.length;
  const nc1 = lod1.cols.length, nr1 = lod1.rows.length, perim1 = lod1.perim.length;
  const vCount0 = nc0 * nr0 + perim0, vCount1 = nc1 * nr1 + perim1;
  const totalV = vCount0 + vCount1;
  const mainCap0 = (nc0 - 1) * (nr0 - 1) * 6, skirtCap0 = perim0 * 6;
  const mainCap1 = (nc1 - 1) * (nr1 - 1) * 6;
  const OFF_MAIN0 = 0, OFF_SKIRT0 = mainCap0;
  const OFF_MAIN1 = mainCap0 + skirtCap0, OFF_SKIRT1 = OFF_MAIN1 + mainCap1;
  const scratchN = { x: 0, y: 0, z: 1 };
  fillFarLevel(terrain, lod0, cell, pos, nrm, idx, 0, OFF_MAIN0, OFF_SKIRT0, scratchN);
  fillFarLevel(terrain, lod1, cell, pos, nrm, idx, vCount0, OFF_MAIN1, OFF_SKIRT1, scratchN);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let v = 0; v < totalV; v++) {
    const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
    if (px < x0) x0 = px; if (py < y0) y0 = py; if (pz < z0) z0 = pz;
    if (px > x1) x1 = px; if (py > y1) y1 = py; if (pz > z1) z1 = pz;
  }
  bb[0] = x0; bb[1] = y0; bb[2] = z0; bb[3] = x1; bb[4] = y1; bb[5] = z1;
}

/** Builds one far tile's MeshData (LOD0 + LOD1, both with skirts) once. Index layout is FIXED forever (`ranges` never change size): band-under exclusion (`applyFarExclusion`) only ever rewrites LOD0 main-quad index VALUES in place (real quad <-> degenerate 0,0,0 triangle), never resizes anything.
 * @returns {FarTileMesh} */
function buildFarTileMesh(terrain, desc) {
  const lod0 = buildFarLodLayout(desc, 1);
  const lod1 = buildFarLodLayout(desc, FAR_LOD1_STEP);
  const nc0 = lod0.cols.length, nr0 = lod0.rows.length, perim0 = lod0.perim.length;
  const nc1 = lod1.cols.length, nr1 = lod1.rows.length, perim1 = lod1.perim.length;
  const vCount0 = nc0 * nr0 + perim0, vCount1 = nc1 * nr1 + perim1;
  const totalV = vCount0 + vCount1;

  const mainCap0 = (nc0 - 1) * (nr0 - 1) * 6, skirtCap0 = perim0 * 6;
  const mainCap1 = (nc1 - 1) * (nr1 - 1) * 6, skirtCap1 = perim1 * 6;
  const OFF_MAIN0 = 0, OFF_SKIRT0 = mainCap0;
  const OFF_MAIN1 = mainCap0 + skirtCap0, OFF_SKIRT1 = OFF_MAIN1 + mainCap1;
  const idxCap = OFF_SKIRT1 + skirtCap1;

  const pos = new Float32Array(totalV * 3);
  const nrm = new Uint32Array(totalV);
  const idx = new Uint32Array(idxCap);
  const bb = new Float64Array(6);
  fillFarTile(terrain, lod0, lod1, pos, nrm, idx, bb);

  /** @type {FarTileMesh} */
  const mesh = {
    version: /** @type {1} */ (1), id: `terrain:far${desc.tileIndex}`, layout: /** @type {'terrain'} */ ('terrain'),
    pos, uv: new Float32Array(0), nrm, flat: new Uint32Array(0), aux: new Float32Array(0),
    idx, triCount: idxCap / 3,
    bbox: bb,
    ranges: [
      { start: OFF_MAIN0 / 3, count: (mainCap0 + skirtCap0) / 3 },
      { start: OFF_MAIN1 / 3, count: (mainCap1 + skirtCap1) / 3 },
    ],
    matKeys: [], matsResolved: true, meshVersion: 1,
    _desc: desc, _lod0: lod0, _lod1: lod1,
  };
  return mesh;
}

/** Sets far tile `mesh`'s LOD0 main quad `(qx, qy)` (tile-local, 0-based) real or degenerate (0,0,0 - zero area, `rasterFanTri`'s `A2 === 0` skips it for free). */
function setFarMainQuad0(mesh, qx, qy, real) {
  const nc0 = mesh._lod0.cols.length;
  const o = (qy * (nc0 - 1) + qx) * 6;
  if (!real) { for (let k = 0; k < 6; k++) mesh.idx[o + k] = 0; return; }
  const a = qx + qy * nc0, b = (qx + 1) + qy * nc0, c = (qx + 1) + (qy + 1) * nc0, d = qx + (qy + 1) * nc0;
  mesh.idx[o] = a; mesh.idx[o + 1] = b; mesh.idx[o + 2] = c;
  mesh.idx[o + 3] = a; mesh.idx[o + 4] = c; mesh.idx[o + 5] = d;
}

/** Sets far tile `mesh`'s LOD0 skirt segment `k` (perimeter edge k -> k+1, same index layout as `fillFarLevel`) real or degenerate. */
function setFarSkirt0(mesh, k, real) {
  const lod0 = mesh._lod0;
  const nc0 = lod0.cols.length, nr0 = lod0.rows.length, perim = lod0.perim, perimLen = perim.length;
  const o = (nc0 - 1) * (nr0 - 1) * 6 + k * 6;
  if (!real) { for (let m = 0; m < 6; m++) mesh.idx[o + m] = 0; return; }
  const k2 = (k + 1) % perimLen;
  const t0 = perim[k][0] + perim[k][1] * nc0, t1 = perim[k2][0] + perim[k2][1] * nc0;
  const b0 = nc0 * nr0 + k, b1 = nc0 * nr0 + k2;
  mesh.idx[o] = t0; mesh.idx[o + 1] = t1; mesh.idx[o + 2] = b1;
  mesh.idx[o + 3] = t0; mesh.idx[o + 4] = b1; mesh.idx[o + 5] = b0;
}

/** True iff far quad `(i, j)` (world rect `[8i+4, 8i+12] x [8j+4, 8j+12]`) intersects the near band's OPEN surface rectangle. */
function farQuadUnderBand(cell, i, j, bandRect) {
  const qx0 = cell * i + cell / 2, qx1 = cell * (i + 1) + cell / 2;
  const qy0 = cell * j + cell / 2, qy1 = cell * (j + 1) + cell / 2;
  return qx0 < bandRect.x1 && qx1 > bandRect.x0 && qy0 < bandRect.y1 && qy1 > bandRect.y0;
}

/** Rewrites `mesh`'s LOD0 main-quad index values to match `bandRect` (or fully restores every quad when `bandRect` is null - the tile no longer intersects the band). Only ever touches tiles the caller already knows are candidates (cheap AABB test in `_updateFarExclusion`). */
function applyFarExclusion(terrain, mesh, bandRect) {
  const lod0 = mesh._lod0;
  const nc0 = lod0.cols.length, nr0 = lod0.rows.length;
  const cell = terrain.mapCell;
  for (let qy = 0; qy < nr0 - 1; qy++) {
    for (let qx = 0; qx < nc0 - 1; qx++) {
      const i = lod0.cols[qx], j = lod0.rows[qy];
      const under = bandRect && farQuadUnderBand(cell, i, j, bandRect);
      setFarMainQuad0(mesh, qx, qy, !under);
    }
  }
  // ME-06: the LOD0 skirt goes with its quad - a skirt segment whose one
  // adjacent main quad is under the band is blanked too, otherwise its top
  // edge (the far surface) pokes up through the near-band ground wherever
  // the 8 m far heights sit above the 2 m near ones (seen at outsideNear).
  const perim = lod0.perim, perimLen = perim.length;
  for (let k = 0; k < perimLen; k++) {
    const p0 = perim[k], p1 = perim[(k + 1) % perimLen];
    const qx = Math.min(p0[0], p1[0], nc0 - 2), qy = Math.min(p0[1], p1[1], nr0 - 2);
    const under = bandRect && farQuadUnderBand(cell, lod0.cols[qx], lod0.rows[qy], bandRect);
    setFarSkirt0(mesh, k, !under);
  }
  mesh.meshVersion++;
}

// ---------------------------------------------------------------------------
// Stitch (near <-> kept far boundary ring)
// ---------------------------------------------------------------------------

/** Bridges two closed vertex loops (`A`, `B`, `{x,y,z,nx,ny,nz}` each) into `nA + nB` triangles by advancing whichever loop's next vertex is closer along the shared `[0,4)` perimeter parameter (uniform per loop since both are built by `perimeterIJList`/`perimeterPosList` - equal vertex spacing per side); ties advance `B` (27.15.5). Winding fixed up per triangle (`cross.z < 0` -> swap) so every triangle has positive xy area. */
function zipLoops(A, B) {
  const nA = A.length, nB = B.length;
  const tris = [];
  if (nA === 0 || nB === 0) return tris;
  let ca = 0, cb = 0;
  while (ca < nA || cb < nB) {
    const tANext = ca < nA ? ((ca + 1) / nA) * 4 : Infinity;
    const tBNext = cb < nB ? ((cb + 1) / nB) * 4 : Infinity;
    const vA = A[ca % nA], vB = B[cb % nB];
    if (ca < nA && tANext < tBNext) {
      const vA2 = A[(ca + 1) % nA];
      tris.push(fixWinding(vA, vA2, vB));
      ca++;
    } else {
      const vB2 = B[(cb + 1) % nB];
      tris.push(fixWinding(vA, vB2, vB));
      cb++;
    }
  }
  return tris;
}

function fixWinding(v0, v1, v2) {
  const ax = v1.x - v0.x, ay = v1.y - v0.y, bx = v2.x - v0.x, by = v2.y - v0.y;
  return (ax * by - ay * bx) < 0 ? [v0, v2, v1] : [v0, v1, v2];
}

/** Unrolled-into-an-indexed-mesh stitch build (each triangle keeps its own 3 unique vertices - no cross-triangle vertex sharing, which the zip's independently-computed triangles don't need).
 * @returns {import('./MeshData.js').MeshData} */
function buildStitchMesh(tris) {
  const vCount = tris.length * 3;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Uint32Array(vCount);
  const idx = new Uint32Array(vCount);
  let x0 = 0, y0 = 0, z0 = 0, x1 = 0, y1 = 0, z1 = 0;
  if (tris.length) {
    x0 = y0 = z0 = Infinity; x1 = y1 = z1 = -Infinity;
  }
  for (let t = 0; t < tris.length; t++) {
    for (let c = 0; c < 3; c++) {
      const v = tris[t][c], vi = t * 3 + c;
      pos[vi * 3] = v.x; pos[vi * 3 + 1] = v.y; pos[vi * 3 + 2] = v.z;
      nrm[vi] = packNormalOct(v.nx, v.ny, v.nz);
      idx[vi] = vi;
      if (v.x < x0) x0 = v.x; if (v.y < y0) y0 = v.y; if (v.z < z0) z0 = v.z;
      if (v.x > x1) x1 = v.x; if (v.y > y1) y1 = v.y; if (v.z > z1) z1 = v.z;
    }
  }
  return {
    version: /** @type {1} */ (1), id: 'terrain:stitch', layout: /** @type {'terrain'} */ ('terrain'),
    pos, uv: new Float32Array(0), nrm, flat: new Uint32Array(0), aux: new Float32Array(0),
    idx, triCount: tris.length,
    bbox: new Float64Array([x0, y0, z0, x1, y1, z1]),
    ranges: [{ start: 0, count: tris.length }],
    matKeys: [], matsResolved: true, meshVersion: 1,
  };
}

// ---------------------------------------------------------------------------
// DrawList feed
// ---------------------------------------------------------------------------

function identity12(m) {
  m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = 1; m[5] = 0; m[6] = 0; m[7] = 0; m[8] = 1;
  m[9] = 0; m[10] = 0; m[11] = 0;
}

function pushTerrainItem(list, mesh, ox, oy, oz, objectId, rangeIdx) {
  const item = list.push(mesh, DRAW_TERRAIN);
  identity12(item.matrix);
  item.matrix[9] = ox; item.matrix[10] = oy; item.matrix[11] = oz;
  item.zBase = 0;
  item.planeIdOr = 0;
  item.objectId = objectId;
  const r = mesh.ranges[rangeIdx || 0];
  item.rangeFirst = r.start; item.rangeCount = r.count;
  const b = mesh.bbox;
  item.aabb[0] = b[0] + ox; item.aabb[1] = b[1] + oy; item.aabb[2] = b[2] + oz;
  item.aabb[3] = b[3] + ox; item.aabb[4] = b[4] + oy; item.aabb[5] = b[5] + oz;
  return item;
}

function distToRectXY(cx, cy, x0, y0, x1, y1) {
  const nx = Math.min(Math.max(cx, x0), x1);
  const ny = Math.min(Math.max(cy, y0), y1);
  return Math.hypot(cx - nx, cy - ny);
}

// ---------------------------------------------------------------------------
// TerrainMeshSet
// ---------------------------------------------------------------------------

/**
 * @typedef {import('./MeshData.js').MeshData} MeshData
 */

/**
 * Turns a `Terrain` (engine/world/Terrain.js) into drawable `MeshData`: 9
 * near-band chunks (double-buffered, rebuilt row by row on a band flip), one
 * stitch mesh closing the ring to the far grid, and a fixed set of far tiles
 * (LOD0/LOD1, band-under quads carved out). See docs/architecture.md 27.15.5
 * for the full spec this is built against.
 */
export class TerrainMeshSet {
  /**
   * @param {import('../world/Terrain.js').Terrain} terrain
   * @param {{fogFullM?: number}} [opts]
   */
  constructor(terrain, opts = {}) {
    this.terrain = terrain;
    /** `typeAt` pre-bound once, for `rasterJS`'s `ctx.kind7Mat` (no per-frame bind). */
    this.typeAtFn = this.typeAt.bind(this);
    this.fogFullM = (opts && opts.fogFullM) || 1500;

    const chunkSize = terrain.chunkSize, nearCell = terrain.nearCell, farCell = terrain.mapCell;
    if (chunkSize % nearCell !== 0) throw new Error(`TerrainMeshSet: chunkSize (${chunkSize}) must be a multiple of nearCell (${nearCell})`);
    if (chunkSize % farCell !== 0) throw new Error(`TerrainMeshSet: chunkSize (${chunkSize}) must be a multiple of the far cell (${farCell})`);
    const n = chunkSize / nearCell;
    this._n = n;
    this._nearVersion = 1; // one counter for both near sets (they share ids) - see `_publishNear`
    // WS1-02: the chunk grid follows the baked band (cw x ch chunks, default 3x3); re-laid out if a later band has other dims.
    const g0 = terrain.near;
    if (g0) {
      if (g0.w % n !== 0 || g0.h % n !== 0) throw new Error(`TerrainMeshSet: terrain.near is ${g0.w}x${g0.h}, not a multiple of ${n} (chunkSize/nearCell)`);
      if (g0.x0 % farCell !== 0 || g0.y0 % farCell !== 0) throw new Error('TerrainMeshSet: terrain.near.x0/y0 must be multiples of the far cell');
    }
    this._layout(g0 ? g0.w / n : 3, g0 ? g0.h / n : 3);

    this._nearVersion = 1;

    /** @type {MeshData} */
    this.stitch = buildStitchMesh([]);

    // Far tile layout (fixed: depends only on mapW/mapH/mapCell).
    const mapW = terrain.mapW, mapH = terrain.mapH;
    const tilesX = Math.ceil((mapW - 1) / FAR_TILE_QUADS);
    const tilesY = Math.ceil((mapH - 1) / FAR_TILE_QUADS);
    this._tilesX = tilesX;
    this._farTiles = [];
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const colStart = tx * FAR_TILE_QUADS, colEnd = Math.min(colStart + FAR_TILE_QUADS, mapW - 1);
        const rowStart = ty * FAR_TILE_QUADS, rowEnd = Math.min(rowStart + FAR_TILE_QUADS, mapH - 1);
        const cell = terrain.mapCell;
        this._farTiles.push({
          tx, ty, colStart, colEnd, colCount: colEnd - colStart + 1,
          rowStart, rowEnd, rowCount: rowEnd - rowStart + 1,
          tileIndex: ty * tilesX + tx,
          worldRect: { x0: colStart * cell, y0: rowStart * cell, x1: (colEnd + 1) * cell, y1: (rowEnd + 1) * cell },
        });
      }
    }
    /** @type {(FarTileMesh|null)[]} */
    this.far = new Array(this._farTiles.length).fill(null);
    this._farBuilt = false;
    this._farBuiltVersion = -1;
    /** Tile indices currently carved by the band (kept exact so an out-of-band tile is restored fully real). */
    this._excludedTileSet = new Set();

    // Row-granular near-band build state.
    this._builtFor = null;      // the `near` object the PUBLISHED (front) set matches
    this._buildingFor = null;   // the `near` object currently being built into the back set
    this._buildRow = 0;
    this._scratchN = { x: 0, y: 0, z: 1 };
    // Far-tile scratch for _updateFarExclusion (avoids a per-call array literal).
    this._farOrder = new Int32Array(this._farTiles.length);
    this._farDist = new Float64Array(this._farTiles.length);

    this.pending = !!terrain.near; // a near band already present at construction still needs its first mesh build
  }

  // -- near band --------------------------------------------------------

  /** (Re)build the near chunk grid for a `cw x ch`-chunk band: column/row bounds, front/back chunk meshes, normal scratch. */
  _layout(cw, ch) {
    const n = this._n, bandW = cw * n, bandH = ch * n;
    this._cw = cw; this._ch = ch;
    // Chunk (kx) column bounds: [n*kx, min(n*kx+n, bandW-1)] - the shared boundary column/row is duplicated
    // across neighbours (watertight by construction: both read the SAME `hDraw`/normal value there).
    this._chunkCol = [];
    for (let k = 0; k < cw; k++) {
      const start = n * k, end = Math.min(n * k + n, bandW - 1);
      this._chunkCol.push({ start, end, count: end - start + 1 });
    }
    this._chunkRow = [];
    for (let k = 0; k < ch; k++) {
      const start = n * k, end = Math.min(n * k + n, bandH - 1);
      this._chunkRow.push({ start, end, count: end - start + 1 });
    }
    const total = cw * ch;
    /** @type {NearChunkMesh[]} */
    this._nearA = new Array(total);
    /** @type {NearChunkMesh[]} */
    this._nearB = new Array(total);
    for (let ky = 0; ky < ch; ky++) {
      for (let kx = 0; kx < cw; kx++) {
        const i9 = ky * cw + kx;
        const cc = this._chunkCol[kx].count, rc = this._chunkRow[ky].count;
        const idxBuf = buildGridIndex(cc, rc); // shared topology - same idx array reused by both buffers
        this._nearA[i9] = makeNearChunkMesh(`terrain:near${i9}`, cc, rc, idxBuf);
        this._nearB[i9] = makeNearChunkMesh(`terrain:near${i9}`, cc, rc, idxBuf);
      }
    }
    /** @type {NearChunkMesh[]} published (front) near chunks - `addToDrawList` reads this. */
    this.near = this._nearA;
    this._builtFor = null; this._buildingFor = null; this._buildRow = 0;
    this._bandNrm = new Float32Array(bandW * bandH * 3); // scratch: per-band-vertex normal, filled row by row
    // Draw-list keys: near chunks 0..total-1, stitch = total (9 for 3x3), far tiles from `_farKey0` (16 for 3x3)
    this._farKey0 = Math.max(16, total + 1);
  }

  _buildRowData(j) {
    const g = this._buildingFor;
    const w = g.w, cell = g.cell, x0 = g.x0, y0 = g.y0;
    const y = y0 + (j + 0.5) * cell;
    const rowBase = j * w;
    const sN = this._scratchN;
    for (let i = 0; i < w; i++) {
      const x = x0 + (i + 0.5) * cell;
      this.terrain.groundNormalAt(x, y, sN); // c=2 central diff, gridHeight(near)->groundAt fallback (27.15.5 formula)
      const o3 = (rowBase + i) * 3;
      this._bandNrm[o3] = sN.x; this._bandNrm[o3 + 1] = sN.y; this._bandNrm[o3 + 2] = sN.z;
    }
  }

  _publishNear(g) {
    const back = this.near === this._nearA ? this._nearB : this._nearA;
    for (let ky = 0; ky < this._ch; ky++) {
      for (let kx = 0; kx < this._cw; kx++) {
        const i9 = ky * this._cw + kx;
        const mesh = back[i9];
        const colInfo = this._chunkCol[kx], rowInfo = this._chunkRow[ky];
        const cc = colInfo.count, rc = rowInfo.count;
        const ox = g.x0 + colInfo.start * g.cell, oy = g.y0 + rowInfo.start * g.cell;
        mesh._origin.x = ox; mesh._origin.y = oy; mesh._origin.z = 0;
        let minZ = Infinity, maxZ = -Infinity;
        for (let lj = 0; lj < rc; lj++) {
          const gj = rowInfo.start + lj;
          for (let li = 0; li < cc; li++) {
            const gi = colInfo.start + li;
            const srcIdx = gi + gj * g.w;
            const z = g.hDraw[srcIdx];
            const dstV = li + lj * cc;
            // Band vertex (i, j) sits at the CELL CENTRE `x0 + (i + 0.5) cell`
            // (27.15.5) - the same sample point `util.gridHeight`'s bilinear
            // (`fx = x/cell - 0.5`), the far tiles and the stitch ring use.
            // Architect fix (ME-06): this was `li * cell` (cell corner), a
            // 1 m shift of the whole band vs the DDA oracle and the stitch.
            mesh.pos[dstV * 3] = (li + 0.5) * g.cell;
            mesh.pos[dstV * 3 + 1] = (lj + 0.5) * g.cell;
            mesh.pos[dstV * 3 + 2] = z;
            const nOff = srcIdx * 3;
            mesh.nrm[dstV] = packNormalOct(this._bandNrm[nOff], this._bandNrm[nOff + 1], this._bandNrm[nOff + 2]);
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
          }
        }
        mesh.bbox[0] = 0.5 * g.cell; mesh.bbox[1] = 0.5 * g.cell; mesh.bbox[2] = minZ;
        mesh.bbox[3] = (cc - 0.5) * g.cell; mesh.bbox[4] = (rc - 0.5) * g.cell; mesh.bbox[5] = maxZ;
        // Architect fix (ME-06): front/back chunks share one `id` (the GPU
        // cache key, MeshBuffers.js) so the version must be unique across
        // BOTH sets - a per-mesh `++` gave A and B the same numbers and the
        // second flip re-used a stale vertex buffer.
        mesh.meshVersion = ++this._nearVersion;
      }
    }
    this.near = back;
  }

  _rebuildStitch(g) {
    const terrain = this.terrain, w = g.w;
    const nearIJ = perimeterIJList(0, w - 1, 0, g.h - 1);
    const nearVerts = new Array(nearIJ.length);
    for (let k = 0; k < nearIJ.length; k++) {
      const i = nearIJ[k][0], j = nearIJ[k][1];
      const o3 = (i + j * w) * 3;
      nearVerts[k] = {
        x: g.x0 + (i + 0.5) * g.cell, y: g.y0 + (j + 0.5) * g.cell, z: g.hDraw[i + j * w],
        nx: this._bandNrm[o3], ny: this._bandNrm[o3 + 1], nz: this._bandNrm[o3 + 2],
      };
    }

    const bandRect = this._bandRectFor(g);
    const cell = terrain.mapCell;
    const iLo = Math.max(0, Math.floor(bandRect.x0 / cell) - 2), iHi = Math.min(terrain.mapW - 2, Math.ceil(bandRect.x1 / cell) + 2);
    const jLo = Math.max(0, Math.floor(bandRect.y0 / cell) - 2), jHi = Math.min(terrain.mapH - 2, Math.ceil(bandRect.y1 / cell) + 2);
    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (let j = jLo; j <= jHi; j++) {
      for (let i = iLo; i <= iHi; i++) {
        if (farQuadUnderBand(cell, i, j, bandRect)) {
          if (i < iMin) iMin = i; if (i > iMax) iMax = i;
          if (j < jMin) jMin = j; if (j > jMax) jMax = j;
        }
      }
    }
    this._bandRect = bandRect;
    if (!isFinite(iMin)) { this.stitch = buildStitchMesh([]); return; } // band excludes nothing (tiny band/huge cell) - no hole to stitch
    if (iMin - 1 < 0 || jMin - 1 < 0 || iMax + 2 > terrain.mapW || jMax + 2 > terrain.mapH) {
      console.warn('terrainMesh: stitch far loop leaves the far grid - skipping stitch this flip');
      this.stitch = buildStitchMesh([]);
      return;
    }

    const farIJ = perimeterIJList(iMin, iMax + 1, jMin, jMax + 1);
    const farVerts = new Array(farIJ.length);
    const sN = this._scratchN;
    for (let k = 0; k < farIJ.length; k++) {
      const i = farIJ[k][0], j = farIJ[k][1];
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell;
      farNormalAt(terrain, x, y, sN);
      farVerts[k] = { x, y, z: terrain.farHDraw[i + j * terrain.mapW], nx: sN.x, ny: sN.y, nz: sN.z };
    }

    const tris = zipLoops(nearVerts, farVerts);
    this.stitch = buildStitchMesh(tris);
  }

  _bandRectFor(g) {
    return { x0: g.x0 + g.cell / 2, x1: g.x0 + g.w * g.cell - g.cell / 2, y0: g.y0 + g.cell / 2, y1: g.y0 + g.h * g.cell - g.cell / 2 };
  }

  // -- far tiles ----------------------------------------------------------

  _buildFarTiles() {
    for (let k = 0; k < this._farTiles.length; k++) this.far[k] = buildFarTileMesh(this.terrain, this._farTiles[k]);
    this._farBuilt = true;
    this._farBuiltVersion = this.terrain.farVersion;
    this._excludedTileSet = new Set();
  }

  /** Recomputes which far tiles intersect `bandRect` and rewrites their LOD0 exclusion (restoring any tile that fell out of range). */
  _updateFarExclusion(bandRect) {
    const tiles = this._farTiles;
    const nextExcluded = new Set();
    for (let k = 0; k < tiles.length; k++) {
      const r = tiles[k].worldRect;
      if (r.x0 < bandRect.x1 && r.x1 > bandRect.x0 && r.y0 < bandRect.y1 && r.y1 > bandRect.y0) nextExcluded.add(k);
    }
    for (const k of this._excludedTileSet) if (!nextExcluded.has(k)) applyFarExclusion(this.terrain, this.far[k], null);
    for (const k of nextExcluded) applyFarExclusion(this.terrain, this.far[k], bandRect);
    this._excludedTileSet = nextExcluded;
    this._exclRect = bandRect; // the rect the far grid is currently carved for (test/debug: must equal the published near rect)
  }

  // -- live terrain edits (ED-TERRAIN-1b, arch 37.12) ------------------------

  /**
   * Rebuilds ONLY what a `Terrain.rebakeRect` dirtied: the near vertices/normals in the band-local sample
   * rect (`terrain.near.dirty`, or the `rect` argument), the stitch when the rect is near the band edge, and the
   * far tiles touching `terrain.farDirty`. Edits the published near chunks in place (new `meshVersion`);
   * never takes the band-flip identity path. Consumes the dirty rects. Call right after `rebakeRect`.
   * @param {{i0:number,j0:number,i1:number,j1:number}} [rect]
   */
  markNearDirty(rect) {
    const terrain = this.terrain, g = terrain.near;
    if (!g) return;
    const r = rect || g.dirty;
    const fd = terrain.farDirty;
    g.dirty = null; terrain.farDirty = null;
    if (this._builtFor !== g) { this._buildingFor = null; return; } // first/flip build pending: it reads the new data anyway
    if (r) {
      const w = g.w, cell = g.cell, sN = this._scratchN;
      for (let j = r.j0; j <= r.j1; j++) {
        const y = g.y0 + (j + 0.5) * cell;
        for (let i = r.i0; i <= r.i1; i++) {
          terrain.groundNormalAt(g.x0 + (i + 0.5) * cell, y, sN);
          const o3 = (i + j * w) * 3;
          this._bandNrm[o3] = sN.x; this._bandNrm[o3 + 1] = sN.y; this._bandNrm[o3 + 2] = sN.z;
        }
      }
      for (let ky = 0; ky < this._ch; ky++) {
        const rowInfo = this._chunkRow[ky];
        if (r.j1 < rowInfo.start || r.j0 > rowInfo.end) continue;
        for (let kx = 0; kx < this._cw; kx++) {
          const colInfo = this._chunkCol[kx];
          if (r.i1 < colInfo.start || r.i0 > colInfo.end) continue;
          this._patchNearChunk(this.near[ky * this._cw + kx], g, colInfo, rowInfo, r);
        }
      }
      const m = 20; // samples (40 m): the far ring + far normals reach ~20 m past a rect
      if (r.i0 <= m || r.j0 <= m || r.i1 >= w - 1 - m || r.j1 >= g.h - 1 - m) this._rebuildStitch(g);
    }
    if (fd && this._farBuilt) {
      const tiles = this._farTiles;
      for (let k = 0; k < tiles.length; k++) {
        const t = tiles[k];
        if (fd.i1 + 1 < t.colStart || fd.i0 - 1 > t.colEnd || fd.j1 + 1 < t.rowStart || fd.j0 - 1 > t.rowEnd) continue;
        const mesh = this.far[k]; // refilled in place (no allocation); idx is rewritten, so re-carve below
        fillFarTile(terrain, mesh._lod0, mesh._lod1, mesh.pos, mesh.nrm, mesh.idx, mesh.bbox);
        mesh.meshVersion++;
        if (this._excludedTileSet.has(k)) applyFarExclusion(terrain, mesh, this._bandRectFor(g));
      }
      this._farBuiltVersion = terrain.farVersion;
    }
  }

  _patchNearChunk(mesh, g, colInfo, rowInfo, r) {
    const cc = colInfo.count, rc = rowInfo.count;
    const li0 = Math.max(r.i0, colInfo.start) - colInfo.start, li1 = Math.min(r.i1, colInfo.end) - colInfo.start;
    const lj0 = Math.max(r.j0, rowInfo.start) - rowInfo.start, lj1 = Math.min(r.j1, rowInfo.end) - rowInfo.start;
    for (let lj = lj0; lj <= lj1; lj++) {
      const gj = rowInfo.start + lj;
      for (let li = li0; li <= li1; li++) {
        const srcIdx = colInfo.start + li + gj * g.w, dstV = li + lj * cc;
        mesh.pos[dstV * 3 + 2] = g.hDraw[srcIdx];
        const nOff = srcIdx * 3;
        mesh.nrm[dstV] = packNormalOct(this._bandNrm[nOff], this._bandNrm[nOff + 1], this._bandNrm[nOff + 2]);
      }
    }
    let minZ = Infinity, maxZ = -Infinity;
    for (let v = 0; v < cc * rc; v++) { const z = mesh.pos[v * 3 + 2]; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    mesh.bbox[2] = minZ; mesh.bbox[5] = maxZ;
    mesh.meshVersion = ++this._nearVersion;
  }

  // -- public API -----------------------------------------------------------

  /**
   * Advances mesh building by at most `msBudget` ms. Call once per RENDERED
   * frame (never per fixed step). @param {number} [msBudget]
   * @returns {boolean} true while a build is still in progress
   */
  step(msBudget = 2) {
    const terrain = this.terrain;
    const t0 = now();

    if (terrain.near && (terrain.near.dirty || terrain.farDirty)) this.markNearDirty(); // a rebakeRect nobody told us about

    if (terrain.farReady && (!this._farBuilt || this._farBuiltVersion !== terrain.farVersion)) {
      this._buildFarTiles();
      // Carve for `terrain.near` right away, even though the near chunks
      // are still all-zero until their row-by-row build publishes (a hole in
      // the ground outside for the first few frames after load). Architect
      // note (ME-06): tried "carve only once published" - worse: the 8 m far
      // grid (+ canopy) then pokes through the tower floor for those frames
      // (spawn pose kind 4 %). The hole is the lesser evil and matches the
      // DDA's own "no terrain until baked" transient.
      // WS2-03 (arch 38.38): on a band SWAP (a near mesh is already published) a far re-bake must carve for the
      // PUBLISHED band, not the pending `terrain.near` - the exclusion moves only at `_publishNear`.
      if (terrain.near) this._updateFarExclusion(this._builtFor ? this._bandRect : this._bandRectFor(terrain.near));
    }

    if (terrain.near && terrain.near !== this._builtFor) {
      const nw = terrain.near.w / this._n, nh = terrain.near.h / this._n;
      if (nw !== this._cw || nh !== this._ch) this._layout(nw, nh); // WS1-02: a band with other dims -> new chunk grid
      if (this._buildingFor !== terrain.near) { this._buildingFor = terrain.near; this._buildRow = 0; } // retarget: restart from row 0 on the newest `near`
      const h = this._buildingFor.h; // rows to build (was .w: wrong for non-square bands)
      while (this._buildRow < h) {
        this._buildRowData(this._buildRow);
        this._buildRow++;
        if (now() - t0 >= msBudget) { this.pending = true; return true; }
      }
      const g = this._buildingFor;
      this._publishNear(g);
      this._rebuildStitch(g);
      if (this._farBuilt) this._updateFarExclusion(this._bandRect);
      this._builtFor = g;
      this._buildingFor = null;
    }

    this.pending = false;
    return false;
  }

  /**
   * Pushes near chunks + stitch (always) and far tiles (LOD by distance,
   * skipped beyond `fogFullM`) into `list`.
   * @param {import('./DrawList.js').DrawList} list
   * @param {{x:number,y:number,z:number}} cam
   */
  addToDrawList(list, cam) {
    const nNear = this._cw * this._ch;
    for (let i = 0; i < nNear; i++) {
      const mesh = this.near[i];
      if (mesh.triCount === 0) continue;
      pushTerrainItem(list, mesh, mesh._origin.x, mesh._origin.y, mesh._origin.z, 0x7000 | i);
    }
    if (this.stitch.triCount > 0) pushTerrainItem(list, this.stitch, 0, 0, 0, 0x7000 | nNear);

    const tiles = this._farTiles, order = this._farOrder, dist = this._farDist;
    // US-068b2 (38.19 risk d): ortho keys ring/fade distance on the FOCUS (the ortho eye sits 500 m behind it); perspective unchanged
    const ortho = cam.projection === 'ortho' && cam.focusX !== undefined, rcx = ortho ? cam.focusX : cam.x, rcy = ortho ? cam.focusY : cam.y;
    let count = 0;
    for (let k = 0; k < tiles.length; k++) {
      const mesh = this.far[k];
      if (!mesh) continue;
      const r = tiles[k].worldRect;
      const d = distToRectXY(rcx, rcy, r.x0, r.y0, r.x1, r.y1);
      if (d > this.fogFullM) continue;
      order[count] = k; dist[count] = d; count++;
    }
    for (let i = 1; i < count; i++) { // insertion sort, near -> far (zero allocation)
      const ok = order[i], od = dist[i];
      let j = i - 1;
      while (j >= 0 && dist[j] > od) { order[j + 1] = order[j]; dist[j + 1] = dist[j]; j--; }
      order[j + 1] = ok; dist[j + 1] = od;
    }
    for (let s = 0; s < count; s++) {
      const k = order[s], mesh = this.far[k];
      const useLod0 = this._excludedTileSet.has(k) || dist[s] < RING0_M;
      const rangeIdx = useLod0 ? 0 : 1;
      if (mesh.ranges[rangeIdx].count === 0) continue;
      pushTerrainItem(list, mesh, 0, 0, 0, 0x7000 | (this._farKey0 + k), rangeIdx);
    }
  }

  /**
   * `rasterJS`'s `ctx.kind7Mat`: near nearest texel inside the band, else
   * far nearest - literal copy of `terrainCaster.js`'s `castTerrain` hit-type
   * rule (`terrain._nearGridType` then `farType` nearest). Allocation-free.
   * @param {number} x @param {number} y @returns {number}
   */
  typeAt(x, y) {
    const terrain = this.terrain;
    if (terrain.nearReady) {
      const t = terrain._nearGridType(x, y);
      if (t !== null) return t;
    }
    const ix = Math.floor(x / terrain.mapCell), iy = Math.floor(y / terrain.mapCell);
    if (ix < 0 || iy < 0 || ix >= terrain.mapW || iy >= terrain.mapH) return 0;
    return terrain.farType[iy * terrain.mapW + ix];
  }
}

// ---------------------------------------------------------------------------
// terrainMeshSetFor - shared cache (ME-06, 27.15.5a item 6)
// ---------------------------------------------------------------------------

/**
 * One `TerrainMeshSet` per `Terrain` instance, shared by every caller
 * (`GpuCellPipeline`'s raster pass, `renderWorld`'s `fb.renderer === 'mesh'`
 * JS-twin branch, and any Node harness/test) so the GPU and JS twins draw
 * the exact same geometry from the exact same object - never two competing
 * `TerrainMeshSet`s silently diverging (a flip mid-frame on one but not the
 * other). Built lazily on first use; never freed (matches the `Terrain`'s
 * own lifetime - one per loaded world).
 * @type {WeakMap<import('../world/Terrain.js').Terrain, TerrainMeshSet>}
 */
const _terrainMeshSets = new WeakMap();

/**
 * @param {import('../world/Terrain.js').Terrain} terrain
 * @param {{fogFullM?: number}} [opts] - only used the first time `terrain` is seen
 * @returns {TerrainMeshSet}
 */
export function terrainMeshSetFor(terrain, opts) {
  let set = _terrainMeshSets.get(terrain);
  if (!set) {
    set = new TerrainMeshSet(terrain, opts);
    _terrainMeshSets.set(terrain, set);
  }
  return set;
}

/**
 * ED-MESH-1a (31.2): builds the terrain mesh (near band + far tiles) synchronously so a page without a streaming
 * budget (rts-test, the mesh editor, the game's mesh boot) shows the ground on frame 1.
 * @param {import('../world/Terrain.js').Terrain} terrain a baked Terrain (farReady)
 */
export function prebuildTerrainMesh(terrain) {
  const set = terrainMeshSetFor(terrain);
  while (set.step(1000)) { /* until the near band is published */ }
}
