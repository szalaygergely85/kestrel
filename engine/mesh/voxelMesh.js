// @ts-check
// engine/mesh/voxelMesh.js - ME-07 (docs/backlog.md, docs/architecture.md
// 27.4, 27.7 item 4, 27.15.6 - normative). Converts a PackedVoxelModel
// (engine/voxel/voxelPack.js's `packVoxelModel` output, mats already
// resolved to MaterialTable ids) into ONE MeshData with one draw `range`
// per part, via greedy meshing of exposed voxel faces - so a voxel prop
// renders through the same rasteriser as levels/terrain (ME-03) with rigid
// per-part animation (the part transforms come from `voxelPose.js`'s
// `computeVoxelPose`/`FORWARD`, never re-derived here - 27.15.6's AC 2).
//
// Mesh-local space = the model's OWN voxel-grid units (the same space as
// `parts[].box`/`pivot`, NOT multiplied by cellM) - `cellM`, yaw and the
// instance translation live in the per-part world matrix (`FORWARD`,
// `addVoxelInstances` below), not in these vertices.
//
// engine/mesh/* may import only engine/core/*, engine/render/GBuffer.js,
// engine/render/projection.js and engine/voxel/{octNormal,voxelPose,
// VoxelModel}.js (27.15.0) - never a caster (voxelMarch.js), gpu/*, game/
// or design/. Tests may import voxelMarch.js as the oracle.
import { KIND_MODEL, FACE_N, FACE_E, FACE_S, FACE_W, FACE_U, FACE_D } from '../render/GBuffer.js';
import { StaticMeshBuilder, packFlat1, AO_NONE } from './MeshData.js';
import { PART_STRIDE, MAX_VOX_PARTS } from '../voxel/VoxelModel.js';
import { computeVoxelPose, FORWARD } from '../voxel/voxelPose.js';
import { DRAW_VOXEL } from './DrawList.js';

// ME-22 (architecture.md 28.12 item 3): the quad budget is checked here,
// where the mesh is actually built, not in the (cheap/pure) validator.
// MeshBuffers.js already switches to a u32 index automatically above
// 16384 quads (quadCount*4 > 65536) - no change needed there.
export const MESH_ONLY_MAX_QUADS = 32768;

/** @typedef {import('./MeshData.js').MeshData} MeshData */
/** @typedef {import('./DrawList.js').DrawList} DrawList */
/**
 * The shape `packVoxelModel` (engine/voxel/voxelPack.js) returns - that
 * module has no exported typedef of its own, so this is a local mirror
 * (fields this file actually reads only).
 * @typedef {Object} PackedVoxelModel
 * @property {number} sx @property {number} sy @property {number} sz
 * @property {number} cellM
 * @property {number} partCount
 * @property {Float64Array} parts - partCount * PART_STRIDE, see VoxelModel.js
 * @property {Uint8Array} vox - the voxel atlas (local mat index per cell, 0 = empty)
 * @property {Uint16Array} matIds - local mat index -> resolved MaterialTable id
 */

/**
 * Reads one solid voxel's LOCAL material index (0 = empty/out of part p's
 * own box - the march "only sees part p's atlas", 27.15.6) at absolute
 * model-grid coordinates (x, y, z).
 * @param {PackedVoxelModel} pm
 * @param {number} x0 @param {number} y0 @param {number} z0
 * @param {number} x1 @param {number} y1 @param {number} z1
 * @param {number} atlasOff @param {number} bx @param {number} by
 * @param {number} x @param {number} y @param {number} z
 * @returns {number}
 */
function localMatAt(pm, x0, y0, z0, x1, y1, z1, atlasOff, bx, by, x, y, z) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1 || z < z0 || z >= z1) return 0;
  return pm.vox[atlasOff + (x - x0) + bx * ((y - y0) + by * (z - z0))];
}

/**
 * Greedy-merges a 2D exposure mask (`domA` x `domB` cells, `valueAt(a, b)` =
 * local mat id or 0 = not exposed/empty) into maximal same-mat rectangles.
 * Scan order + merge rule per 27.15.6 ("scan b ascending then a ascending;
 * extend a, then extend b while the whole run matches; mark visited").
 * Build-time only - may allocate (StaticMeshBuilder's own contract).
 * @param {number} domA @param {number} domB
 * @param {(a: number, b: number) => number} valueAt
 * @returns {{a0: number, a1: number, b0: number, b1: number, mat: number}[]}
 */
function greedyRects(domA, domB, valueAt) {
  const visited = new Uint8Array(domA * domB);
  const rects = [];
  for (let b = 0; b < domB; b++) {
    for (let a = 0; a < domA; a++) {
      const idx = b * domA + a;
      if (visited[idx]) continue;
      const mat = valueAt(a, b);
      if (mat === 0) { visited[idx] = 1; continue; }

      let aEnd = a + 1;
      while (aEnd < domA && !visited[b * domA + aEnd] && valueAt(aEnd, b) === mat) aEnd++;

      let bEnd = b + 1;
      outer: while (bEnd < domB) {
        for (let ai = a; ai < aEnd; ai++) {
          if (visited[bEnd * domA + ai] || valueAt(ai, bEnd) !== mat) break outer;
        }
        bEnd++;
      }

      for (let bb = b; bb < bEnd; bb++) {
        for (let ai = a; ai < aEnd; ai++) visited[bb * domA + ai] = 1;
      }
      rects.push({ a0: a, a1: aEnd, b0: b, b1: bEnd, mat });
    }
  }
  return rects;
}

/**
 * Emits one greedy quad for `face` at `layer` (27.15.6's plane/uv/winding
 * rules). `x0, y0, z0` = the part's own box min (absolute model-grid
 * coords); `a0..b1` are BOX-LOCAL indices (already offset from the box min,
 * so `uv = a * cellM` needs no further subtraction). Winding: every
 * triangle's `cross(p1-p0, p2-p0)` is parallel to the given face normal
 * (MeshData.js's builder invariant, checked by `MeshData.test.js`/ours).
 * @param {StaticMeshBuilder|ScaledMeshBuilder} builder
 * @param {PackedVoxelModel} pm
 * @param {number} face
 * @param {number} x0 @param {number} y0 @param {number} z0
 * @param {number} layer
 * @param {number} a0 @param {number} a1 @param {number} b0 @param {number} b1
 * @param {number} mat - LOCAL mat index (flat1 gets `pm.matIds[mat]`)
 * @param {number} cellM
 * @param {number} partIndex
 */
function emitFaceQuad(builder, pm, face, x0, y0, z0, layer, a0, a1, b0, b1, mat, cellM, partIndex) {
  const uvA0 = a0 * cellM, uvA1 = a1 * cellM, uvB0 = b0 * cellM, uvB1 = b1 * cellM;
  /** @type {number[]} */ let p12;
  /** @type {number[]} */ let uv8;
  let nx = 0, ny = 0, nz = 0;

  if (face === FACE_W || face === FACE_E) {
    const X = face === FACE_W ? x0 + layer : x0 + layer + 1;
    const yA = y0 + a0, yB = y0 + a1, zA = z0 + b0, zB = z0 + b1;
    if (face === FACE_W) {
      p12 = [X, yA, zA, X, yA, zB, X, yB, zB, X, yB, zA];
      uv8 = [uvA0, uvB0, uvA0, uvB1, uvA1, uvB1, uvA1, uvB0];
      nx = -1;
    } else {
      p12 = [X, yA, zA, X, yB, zA, X, yB, zB, X, yA, zB];
      uv8 = [uvA0, uvB0, uvA1, uvB0, uvA1, uvB1, uvA0, uvB1];
      nx = 1;
    }
  } else if (face === FACE_N || face === FACE_S) {
    const Y = face === FACE_N ? y0 + layer : y0 + layer + 1;
    const xA = x0 + a0, xB = x0 + a1, zA = z0 + b0, zB = z0 + b1;
    if (face === FACE_N) {
      p12 = [xA, Y, zA, xB, Y, zA, xB, Y, zB, xA, Y, zB];
      uv8 = [uvA0, uvB0, uvA1, uvB0, uvA1, uvB1, uvA0, uvB1];
      ny = -1;
    } else {
      p12 = [xA, Y, zA, xA, Y, zB, xB, Y, zB, xB, Y, zA];
      uv8 = [uvA0, uvB0, uvA0, uvB1, uvA1, uvB1, uvA1, uvB0];
      ny = 1;
    }
  } else {
    const Z = face === FACE_D ? z0 + layer : z0 + layer + 1;
    const xA = x0 + a0, xB = x0 + a1, yA = y0 + b0, yB = y0 + b1;
    if (face === FACE_U) {
      p12 = [xA, yA, Z, xB, yA, Z, xB, yB, Z, xA, yB, Z];
      uv8 = [uvA0, uvB0, uvA1, uvB0, uvA1, uvB1, uvA0, uvB1];
      nz = 1;
    } else {
      p12 = [xA, yA, Z, xA, yB, Z, xB, yB, Z, xB, yA, Z];
      uv8 = [uvA0, uvB0, uvA0, uvB1, uvA1, uvB1, uvA1, uvB0];
      nz = -1;
    }
  }

  // flat0 (27.15.6): (0xF<<28) instance bits reserved for the DrawItem's own
  // `planeIdOr` (ME-03's `(flat0 | item.planeIdOr)`, NOT baked in here - a
  // mesh is shared by every instance of the model); layer kept so greedy
  // quads still outline at voxel steps.
  const flat0 = ((0xF << 28) | ((partIndex & 7) << 21) | ((face & 7) << 18) | (layer & 0x3FFFF)) | 0;
  const flat1 = packFlat1(KIND_MODEL, face, pm.matIds[mat]);
  const aux8 = [0, AO_NONE, 0, 0, 0, 0, 0, 0];
  builder.addQuad(p12, uv8, nx, ny, nz, flat0, flat1, aux8);
}

/**
 * Greedy-meshes every exposed face of part `p` into `builder` (27.15.6).
 * @param {StaticMeshBuilder|ScaledMeshBuilder} builder - RE-15b: a plain
 *   `StaticMeshBuilder` for LOD0, or a `ScaledMeshBuilder` proxy (same
 *   `addQuad`/`beginRange` surface) for LOD1's 2x-scaled emit.
 * @param {PackedVoxelModel} pm
 * @param {number} p
 * @param {number} cellM
 */
function emitPartFaces(builder, pm, p, cellM) {
  const base = p * PART_STRIDE;
  const x0 = pm.parts[base], y0 = pm.parts[base + 1], z0 = pm.parts[base + 2];
  const x1 = pm.parts[base + 3], y1 = pm.parts[base + 4], z1 = pm.parts[base + 5];
  const atlasOff = pm.parts[base + 10];
  const bx = pm.parts[base + 11], by = pm.parts[base + 12], bz = pm.parts[base + 13];

  const matAt = (x, y, z) => localMatAt(pm, x0, y0, z0, x1, y1, z1, atlasOff, bx, by, x, y, z);

  // W/E: layer = x - x0, mask (a, b) = (y, z) box-local.
  for (let layer = 0; layer < bx; layer++) {
    const X = x0 + layer;
    const rectsW = greedyRects(by, bz, (a, b) => {
      const m = matAt(X, y0 + a, z0 + b);
      return m !== 0 && matAt(X - 1, y0 + a, z0 + b) === 0 ? m : 0;
    });
    for (const r of rectsW) emitFaceQuad(builder, pm, FACE_W, x0, y0, z0, layer, r.a0, r.a1, r.b0, r.b1, r.mat, cellM, p);

    const rectsE = greedyRects(by, bz, (a, b) => {
      const m = matAt(X, y0 + a, z0 + b);
      return m !== 0 && matAt(X + 1, y0 + a, z0 + b) === 0 ? m : 0;
    });
    for (const r of rectsE) emitFaceQuad(builder, pm, FACE_E, x0, y0, z0, layer, r.a0, r.a1, r.b0, r.b1, r.mat, cellM, p);
  }

  // N/S: layer = y - y0, mask (a, b) = (x, z) box-local.
  for (let layer = 0; layer < by; layer++) {
    const Y = y0 + layer;
    const rectsN = greedyRects(bx, bz, (a, b) => {
      const m = matAt(x0 + a, Y, z0 + b);
      return m !== 0 && matAt(x0 + a, Y - 1, z0 + b) === 0 ? m : 0;
    });
    for (const r of rectsN) emitFaceQuad(builder, pm, FACE_N, x0, y0, z0, layer, r.a0, r.a1, r.b0, r.b1, r.mat, cellM, p);

    const rectsS = greedyRects(bx, bz, (a, b) => {
      const m = matAt(x0 + a, Y, z0 + b);
      return m !== 0 && matAt(x0 + a, Y + 1, z0 + b) === 0 ? m : 0;
    });
    for (const r of rectsS) emitFaceQuad(builder, pm, FACE_S, x0, y0, z0, layer, r.a0, r.a1, r.b0, r.b1, r.mat, cellM, p);
  }

  // U/D: layer = z - z0, mask (a, b) = (x, y) box-local.
  for (let layer = 0; layer < bz; layer++) {
    const Z = z0 + layer;
    const rectsU = greedyRects(bx, by, (a, b) => {
      const m = matAt(x0 + a, y0 + b, Z);
      return m !== 0 && matAt(x0 + a, y0 + b, Z + 1) === 0 ? m : 0;
    });
    for (const r of rectsU) emitFaceQuad(builder, pm, FACE_U, x0, y0, z0, layer, r.a0, r.a1, r.b0, r.b1, r.mat, cellM, p);

    const rectsD = greedyRects(bx, by, (a, b) => {
      const m = matAt(x0 + a, y0 + b, Z);
      return m !== 0 && matAt(x0 + a, y0 + b, Z - 1) === 0 ? m : 0;
    });
    for (const r of rectsD) emitFaceQuad(builder, pm, FACE_D, x0, y0, z0, layer, r.a0, r.a1, r.b0, r.b1, r.mat, cellM, p);
  }
}

/**
 * Builds one static MeshData for a whole voxel model, one draw `range` per
 * part (27.15.0 item 7: "one MeshData per part" is met via ranges, not
 * separate MeshData objects - `uPart[8]`/one draw per instance per part).
 * `pm` must already have resolved MaterialTable ids in `matIds` (the
 * returned mesh sets `matsResolved = true` directly - no `matKeys`/
 * `resolveMats` step, since a voxel model's materials are always known at
 * pack time).
 * @param {PackedVoxelModel} pm
 * @param {{id: string, partNames: string[]}} opts
 * @returns {MeshData}
 */
export function buildVoxelMesh(pm, opts) {
  if (pm.rig) return buildRiggedMesh(pm, opts); // RIG-02b (38.32)
  const builder = new StaticMeshBuilder(opts.id);
  for (let p = 0; p < pm.partCount; p++) {
    builder.beginRange(opts.partNames[p]);
    emitPartFaces(builder, pm, p, pm.cellM);
  }
  const mesh = builder.build();
  mesh.matsResolved = true;
  const quadCount = mesh.triCount / 2;
  if (quadCount > MESH_ONLY_MAX_QUADS) {
    throw new Error(`buildVoxelMesh: model '${opts.id}' has ${quadCount} quads, exceeds MESH_ONLY_MAX_QUADS (${MESH_ONLY_MAX_QUADS})`);
  }
  if (quadCount > 16384 && typeof console !== 'undefined' && console.warn) {
    console.warn(`buildVoxelMesh: model '${opts.id}' has ${quadCount} quads (> 16384) - u32 index path`);
  }
  return mesh;
}

/**
 * RIG-02b (38.32 item 4): mesh of a rigged model from its prebuilt quads (pm.rig), emitted through the SAME
 * emitFaceQuad as a native voxel model so winding, uv, flat0 (part/face/layer) and flat1 match. Positions are
 * integer local cells (>= 0); each quad must be one axis-aligned rectangle on one plane.
 */
function buildRiggedMesh(pm, opts) {
  const r = pm.rig;
  const builder = new StaticMeshBuilder(opts.id);
  for (let p = 0; p < pm.partCount; p++) {
    builder.beginRange(opts.partNames[p]);
    const { start, count } = r.ranges[p];
    for (let q = start; q < start + count; q++) emitRigQuad(builder, pm, r, q, p);
  }
  const mesh = builder.build();
  mesh.matsResolved = true;
  const quadCount = mesh.triCount / 2;
  if (quadCount > MESH_ONLY_MAX_QUADS) {
    throw new Error(`buildVoxelMesh: model '${opts.id}' has ${quadCount} quads, exceeds MESH_ONLY_MAX_QUADS (${MESH_ONLY_MAX_QUADS})`);
  }
  return mesh;
}

function emitRigQuad(builder, pm, r, q, p) {
  const P = r.pos, o = 12 * q;
  const bad = (why) => { throw new Error(`buildRiggedMesh: quad ${q} (part ${p}) ${why}`); };
  const nx = r.nrm[o], ny = r.nrm[o + 1], nz = r.nrm[o + 2];
  // axis of the normal (0 x, 1 y, 2 z) and sign
  const ax = nx ? 0 : ny ? 1 : 2, sg = (nx || ny || nz) > 0 ? 1 : -1;
  if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) !== 1) bad('normal is not an axis unit vector');
  const plane = P[o + ax];
  const u = ax === 0 ? 1 : 0, v = ax === 2 ? 1 : 2; // in-plane axes: W/E (y,z), N/S (x,z), U/D (x,y)
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (let c = 0; c < 4; c++) {
    if (P[o + 3 * c + ax] !== plane) bad('corners are not on one plane');
    const a = P[o + 3 * c + u], b = P[o + 3 * c + v];
    if (a !== (a | 0) || b !== (b | 0) || plane !== (plane | 0) || plane < 0 || a < 0 || b < 0) bad('has off-grid or negative coordinates');
    if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
  }
  if (!(a1 > a0 && b1 > b0)) bad('is degenerate');
  for (let c = 0; c < 4; c++) { // every corner must be a rectangle corner
    const a = P[o + 3 * c + u], b = P[o + 3 * c + v];
    if ((a !== a0 && a !== a1) || (b !== b0 && b !== b1)) bad('is not an axis-aligned rectangle');
  }
  let face, layer;
  if (ax === 0) { face = sg < 0 ? FACE_W : FACE_E; layer = sg < 0 ? plane : plane - 1; }
  else if (ax === 1) { face = sg < 0 ? FACE_N : FACE_S; layer = sg < 0 ? plane : plane - 1; }
  else { face = sg < 0 ? FACE_D : FACE_U; layer = sg < 0 ? plane : plane - 1; }
  emitFaceQuad(builder, pm, face, 0, 0, 0, layer, a0, a1, b0, b1, r.mat[q], pm.cellM, p);
}

let _buildSeq = 1;

// ---------------------------------------------------------------------------
// RE-15b (architecture.md 28.13 point 5): LOD1 = a 2x2x2-downsampled voxel
// grid, greedy-meshed with the SAME `emitPartFaces` as LOD0 (one mesher in
// the codebase), vertices kept in LOD0's part-local space by scaling the
// emitted quad corners by 2 (`ScaledMeshBuilder` below) rather than
// reimplementing position math. `parts`/part names/ranges are identical to
// LOD0 - only the atlas + box dims differ (downsampled), so `emitPartFaces`
// needs no changes at all.
// ---------------------------------------------------------------------------

/**
 * Thin `StaticMeshBuilder` proxy that scales only the position corners
 * (`p12`) of every quad by `scale`, leaving uv/normal/flat/aux untouched.
 * Lets LOD1 reuse `emitPartFaces` unmodified while still landing vertices in
 * LOD0's part-local grid units (half-res box-local index i -> LOD0 index 2i,
 * via boxes already halved before this runs - see `downsamplePart`).
 * Build-time only - may allocate (one `sp` array per quad).
 */
class ScaledMeshBuilder {
  constructor(builder, scale) {
    this._b = builder;
    this._s = scale;
  }

  beginRange(name) { this._b.beginRange(name); }

  addQuad(p12, uv8, nx, ny, nz, flat0, flat1, aux8) {
    const s = this._s;
    const sp = [
      p12[0] * s, p12[1] * s, p12[2] * s,
      p12[3] * s, p12[4] * s, p12[5] * s,
      p12[6] * s, p12[7] * s, p12[8] * s,
      p12[9] * s, p12[10] * s, p12[11] * s,
    ];
    this._b.addQuad(sp, uv8, nx, ny, nz, flat0, flat1, aux8);
  }

  build() { return this._b.build(); }
}

/**
 * Downsamples one part's box + atlas 2x2x2, ALIGNED TO THE GLOBAL EVEN GRID
 * (28.13 point 5, RE-15b fix): `x0L = floor(x0/2)`, `x1L = ceil(x1/2)`,
 * `bxL = x1L - x0L` (same pattern for y, z). Without this alignment, a part
 * whose box min is odd gets its downsample shifted by one cell relative to
 * neighbouring parts/world space, since "box-local cell i covers LOD0 cells
 * 2i..2i+1 of the BOX" silently assumed the box min itself sits on an even
 * boundary. A LOD1 block is solid if ANY of its (up to 8) covered LOD0 cells
 * is solid; its local mat = the most frequent solid mat among them, ties
 * broken by the lowest local mat id. Because the even-grid window can extend
 * outside the original box (when x0 is odd, or bx is odd), each sampled
 * box-local source cell is bounds-checked (`cx < 0 || cx >= bx`, same for
 * y/z) and skipped (treated as empty) when out of range - this is what
 * prevents a LOD1 block from reading stale/out-of-bounds atlas data or
 * being marked solid purely from the alignment padding.
 * @param {PackedVoxelModel} pm
 * @param {number} p
 * @returns {{x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,bx:number,by:number,bz:number,vox:Uint8Array,atlasOff:number}}
 */
export function downsamplePart(pm, p) {
  const base = p * PART_STRIDE;
  const x0 = pm.parts[base], y0 = pm.parts[base + 1], z0 = pm.parts[base + 2];
  const x1 = pm.parts[base + 3], y1 = pm.parts[base + 4], z1 = pm.parts[base + 5];
  const atlasOff = pm.parts[base + 10];
  const bx = pm.parts[base + 11], by = pm.parts[base + 12], bz = pm.parts[base + 13];

  const x0L = Math.floor(x0 / 2), y0L = Math.floor(y0 / 2), z0L = Math.floor(z0 / 2);
  const x1L = Math.ceil(x1 / 2), y1L = Math.ceil(y1 / 2), z1L = Math.ceil(z1 / 2);
  const bxL = x1L - x0L, byL = y1L - y0L, bzL = z1L - z0L;
  const vox = new Uint8Array(bxL * byL * bzL);

  // Local-mat histogram scratch, reused per block (0 unused: 0 = empty).
  const counts = new Uint16Array(256);
  for (let lz = 0; lz < bzL; lz++) {
    for (let ly = 0; ly < byL; ly++) {
      for (let lx = 0; lx < bxL; lx++) {
        let any = 0, touched = 0;
        const touchedIds = [];
        for (let dz = 0; dz < 2; dz++) {
          const cz = 2 * (z0L + lz) + dz - z0;
          if (cz < 0 || cz >= bz) continue;
          for (let dy = 0; dy < 2; dy++) {
            const cy = 2 * (y0L + ly) + dy - y0;
            if (cy < 0 || cy >= by) continue;
            for (let dx = 0; dx < 2; dx++) {
              const cx = 2 * (x0L + lx) + dx - x0;
              if (cx < 0 || cx >= bx) continue;
              const m = pm.vox[atlasOff + cx + bx * (cy + by * cz)];
              if (m === 0) continue;
              any = 1;
              if (counts[m] === 0) touchedIds.push(m);
              counts[m]++;
              touched++;
            }
          }
        }
        if (any) {
          // Most-frequent local mat, tie -> lowest id. `touchedIds` is tiny
          // (<= 8 entries), so a linear scan is cheap and keeps determinism
          // independent of iteration order.
          let bestMat = 0, bestCount = -1;
          for (const m of touchedIds) {
            const c = counts[m];
            if (c > bestCount || (c === bestCount && m < bestMat)) { bestMat = m; bestCount = c; }
          }
          vox[lx + bxL * (ly + byL * lz)] = bestMat;
          for (const m of touchedIds) counts[m] = 0;
        }
      }
    }
  }
  return { x0: x0L, y0: y0L, z0: z0L, x1: x0L + bxL, y1: y0L + byL, z1: z0L + bzL, bx: bxL, by: byL, bz: bzL, vox, atlasOff: 0 };
}

/**
 * Builds the LOD1 PackedVoxelModel-shaped object (downsampled parts/vox,
 * SAME `matIds` - downsampling only picks among existing local mat ids, it
 * never invents one) and then its mesh via `emitPartFaces` (unchanged),
 * scaled 2x so vertices land in LOD0's part-local space. Pure function of
 * `pm` (the already-packed grid) - never reads the ModelDef (28.13 point 5/7).
 * @param {PackedVoxelModel} pm
 * @param {{id: string, partNames: string[]}} opts
 * @returns {MeshData}
 */
export function buildVoxelMeshLod1(pm, opts) {
  const partCount = pm.partCount;
  const downs = new Array(partCount);
  let atlasTotal = 0;
  for (let p = 0; p < partCount; p++) {
    const d = downsamplePart(pm, p);
    downs[p] = d;
    d.atlasOff = atlasTotal;
    atlasTotal += d.bx * d.by * d.bz;
  }
  const vox = new Uint8Array(atlasTotal);
  const parts = new Float64Array(partCount * PART_STRIDE);
  for (let p = 0; p < partCount; p++) {
    const d = downs[p];
    vox.set(d.vox, d.atlasOff);
    const base = p * PART_STRIDE;
    parts[base] = d.x0; parts[base + 1] = d.y0; parts[base + 2] = d.z0;
    parts[base + 3] = d.x1; parts[base + 4] = d.y1; parts[base + 5] = d.z1;
    // Pivot/parent (base+6..9) copied from LOD0 - unused by emitPartFaces,
    // kept only so this pm-shaped object stays self-consistent.
    parts[base + 6] = pm.parts[base + 6]; parts[base + 7] = pm.parts[base + 7]; parts[base + 8] = pm.parts[base + 8];
    parts[base + 9] = pm.parts[base + 9];
    parts[base + 10] = d.atlasOff;
    parts[base + 11] = d.bx; parts[base + 12] = d.by; parts[base + 13] = d.bz;
  }
  const pmLod1 = {
    parts, vox, matIds: pm.matIds, partCount, cellM: pm.cellM * 2,
    // sx/sy/sz: unused by emitPartFaces/localMatAt (only part-local box
    // bounds and the shared vox atlas are read) - half-res values kept only
    // so this stays a structurally complete PackedVoxelModel.
    sx: Math.ceil(pm.sx / 2), sy: Math.ceil(pm.sy / 2), sz: Math.ceil(pm.sz / 2),
  };

  const realBuilder = new StaticMeshBuilder(opts.id);
  const builder = new ScaledMeshBuilder(realBuilder, 2);
  for (let p = 0; p < partCount; p++) {
    builder.beginRange(opts.partNames[p]);
    emitPartFaces(builder, pmLod1, p, pmLod1.cellM);
  }
  const mesh = realBuilder.build();
  mesh.matsResolved = true;
  const quadCount = mesh.triCount / 2;
  // Same budget as LOD0 (ME-22): LOD1 is always <= LOD0's quad count (a
  // downsample never adds detail), so this should never actually trip, but
  // the check is cheap and keeps the invariant explicit rather than assumed.
  if (quadCount > MESH_ONLY_MAX_QUADS) {
    throw new Error(`buildVoxelMeshLod1: model '${opts.id}' has ${quadCount} quads, exceeds MESH_ONLY_MAX_QUADS (${MESH_ONLY_MAX_QUADS})`);
  }
  return mesh;
}

/**
 * Builds-once, caches-by-`pm`-identity MeshData for voxel models (a repack,
 * e.g. a hot content reload, gives a new `pm` object and so a fresh build -
 * 27.15.6). RE-15b (28.13 point 5): `lod = 1` lazily builds + caches a
 * separate downsampled mesh per `pm`, in its own WeakMap, id `vox:<key>@1`.
 */
export class VoxelMeshCache {
  constructor() {
    /** @type {WeakMap<object, MeshData>} */
    this._map = new WeakMap();
    /** @type {WeakMap<object, MeshData>} */
    this._mapLod1 = new WeakMap();
  }

  /**
   * @param {PackedVoxelModel} pm
   * @param {string} modelKey
   * @param {string[]} partNames
   * @param {number} [lod]
   * @returns {MeshData}
   */
  get(pm, modelKey, partNames, lod = 0) {
    if (lod === 1 && !pm.rig) { // rig models: LOD1 = LOD0 (38.32; downsamplePart reads pm.vox)
      let mesh = this._mapLod1.get(pm);
      if (!mesh) {
        const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
        mesh = buildVoxelMeshLod1(pm, { id: `vox:${modelKey}@1`, partNames });
        const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        mesh.meshVersion = ++_buildSeq;
        this._mapLod1.set(pm, mesh);
        if (typeof console !== 'undefined' && console.log) {
          console.log(`VoxelMeshCache: LOD1 build '${modelKey}' ${ms.toFixed(2)} ms`);
        }
        if (ms > 5 && typeof console !== 'undefined' && console.warn) {
          console.warn(`VoxelMeshCache: LOD1 build '${modelKey}' took ${ms.toFixed(2)} ms (> 5 ms budget)`);
        }
      }
      return mesh;
    }
    let mesh = this._map.get(pm);
    if (!mesh) {
      mesh = buildVoxelMesh(pm, { id: `vox:${modelKey}`, partNames });
      // Unique per build: MeshBuffers keys GPU buffers by id + meshVersion,
      // and a repacked model reuses the id (ME-07 review item 2).
      mesh.meshVersion = ++_buildSeq;
      this._map.set(pm, mesh);
    }
    return mesh;
  }
}

/** The ONE module-level cache shared by the GPU raster pass and the JS twin. */
export const sharedVoxelMeshCache = new VoxelMeshCache();

// Scratch for the `computeVoxelPose` call `addVoxelInstances` makes purely
// to refresh the shared `FORWARD` side-channel for the CURRENT instance (the
// L_k output itself is discarded - only voxelMarch.js's raymarch needs it).
// Module-level, fixed size: zero allocation after warm-up (27.15.0).
const _poseScratch = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);

/**
 * Pushes one `DRAW_VOXEL` item per `pool.list` entry (already posed + culled
 * by `VoxelPool.project`), part matrices copied from `voxelPose.js`'s
 * `FORWARD` (computed here, never re-derived - 27.15.6, "no second pose
 * implementation"). Zero allocation once `cache` is warm.
 * @param {DrawList} list
 * @param {{list: Array<{model: object, modelKey: string, x: number, y: number, z: number, yawDeg: number, clip: number, frame: number, tMs: number, rect: {minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}}>}} pool
 * @param {VoxelMeshCache} cache
 * @param {(modelKey: string) => string[]} partNamesFor
 */
export function addVoxelInstances(list, pool, cache, partNamesFor) {
  const items = pool.list;
  for (let k = 0; k < items.length; k++) {
    const inst = items[k];
    const pm = /** @type {any} */ (inst.model);
    const partNames = partNamesFor(inst.modelKey);
    const mesh = cache.get(pm, inst.modelKey, partNames);

    computeVoxelPose(pm, inst, _poseScratch);

    const item = list.push(mesh, DRAW_VOXEL);
    const partCount = pm.partCount;
    for (let p = 0; p < partCount; p++) {
      const fbase = p * 12;
      for (let c = 0; c < 12; c++) item.partMatrices[p * 12 + c] = FORWARD[fbase + c];
      item.partFlags[p] = _poseScratch[p * PART_STRIDE + 12];
    }
    item.planeIdOr = (k & 0xF) << 24;
    item.objectId = 0x8000 | k;
    item.zBase = inst.z;
    const rect = inst.rect;
    item.aabb[0] = rect.minX; item.aabb[1] = rect.minY; item.aabb[2] = rect.minZ;
    item.aabb[3] = rect.maxX; item.aabb[4] = rect.maxY; item.aabb[5] = rect.maxZ;
  }
}
