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
 * @param {StaticMeshBuilder} builder
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
 * @param {StaticMeshBuilder} builder
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
  const builder = new StaticMeshBuilder(opts.id);
  for (let p = 0; p < pm.partCount; p++) {
    builder.beginRange(opts.partNames[p]);
    emitPartFaces(builder, pm, p, pm.cellM);
  }
  const mesh = builder.build();
  mesh.matsResolved = true;
  return mesh;
}

let _buildSeq = 1;

/**
 * Builds-once, caches-by-`pm`-identity MeshData for voxel models (a repack,
 * e.g. a hot content reload, gives a new `pm` object and so a fresh build -
 * 27.15.6).
 */
export class VoxelMeshCache {
  constructor() {
    /** @type {WeakMap<object, MeshData>} */
    this._map = new WeakMap();
  }

  /**
   * @param {PackedVoxelModel} pm
   * @param {string} modelKey
   * @param {string[]} partNames
   * @returns {MeshData}
   */
  get(pm, modelKey, partNames) {
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
