// tools/editor/pick.js - US-032 (docs/architecture.md 24.6). Browser-only
// half of picking: turns a click's `(col,row)` into a `PickResult` by
// reading the surface under the cursor (GPU readback or `fb.gbuf` on
// `?gpu=0`) and falling back to ray/cylinder entity picking (ray.js, pure,
// Node-tested). Never called per frame (24.6/24.14: "click pick <= 5 ms",
// "do not call readbackGeometry outside a click").
//
// Imports only engine/index.js + ray.js (the editor boundary rule).
import { KIND_TERRAIN } from '../../engine/index.js';
import {
  unprojectCell, rayPoint, projectPoint, decodePlaneId, rayPickEntities,
  KIND_WALL, KIND_STEP, KIND_UPPER,
} from './ray.js';

// Shared scratch for the uint32<->float32 bit-cast the Depth readback needs
// (same trick as engine/render/gpu/gpuCompare.js's `u32ToF32`) - no per-call allocation.
const _bitBuf = new ArrayBuffer(4);
const _f32 = new Float32Array(_bitBuf);
const _u32 = new Uint32Array(_bitBuf);
function u32ToF32(u) { _u32[0] = u >>> 0; return _f32[0]; }

// Reused every call (rule 9) - `collectEntities` below.
const _entityScratch = [];

/**
 * Reads one cell's surface sample: GPU `readbackGeometry()` (24.6, the
 * documented click-only exemption) or the CPU `fb.gbuf`/`fb.depth` on
 * `?gpu=0`.
 * @param {number} col @param {number} row
 * @param {{cols:number, gpuActive:boolean, gpuPipeline:Object|null, fb:Object}} ctx
 */
export function readSurface(col, row, ctx) {
  const { cols, gpuActive, gpuPipeline, fb } = ctx;
  const i = row * cols + col;
  if (gpuActive && gpuPipeline) {
    const { GI, Depth } = gpuPipeline.readbackGeometry();
    const gi1 = GI[i * 4 + 1];
    return {
      kind: gi1 & 0xff,
      face: (gi1 >>> 8) & 0xf,
      mat: gi1 >>> 16,
      planeId: GI[i * 4] | 0,
      depth: u32ToF32(Depth[i * 4]),
    };
  }
  const gbuf = fb.gbuf;
  return { kind: gbuf.kind[i], face: gbuf.face[i], mat: gbuf.mat[i], planeId: gbuf.planeId[i], depth: fb.depth.depth[i] };
}

/** Every live entity with `components.sprite`/`components.voxel` (ray-cylinder candidates, 24.6). */
function collectEntities(world) {
  _entityScratch.length = 0;
  world.forEachEntity((e) => {
    if (e.components && (e.components.sprite || e.components.voxel)) _entityScratch.push(e);
  });
  return _entityScratch;
}

/** First entity whose voxel component + exact transform match a `voxelPool.list[]` instance (24.6). Warns on >1 coincident match. */
function findEntityForVoxelInstance(world, inst) {
  let found = null;
  let count = 0;
  world.forEachEntity((e) => {
    const v = e.components && e.components.voxel;
    if (!v || v.model !== inst.modelKey) return;
    if (e.transform.x === inst.x && e.transform.y === inst.y && e.transform.z === inst.z) {
      count++;
      if (!found) found = e.id;
    }
  });
  if (count > 1) {
    console.warn(`pick.js: ${count} entities coincide with a voxel instance (${inst.modelKey} @ ${inst.x},${inst.y},${inst.z}) - picking the first`);
  }
  return found;
}

/**
 * @typedef {{ kind:'sky'|'terrain'|'surface'|'entity', col:number, row:number, depth:number,
 *   world:{x:number,y:number,z:number}|null, structureId:string|null, cell:{x:number,y:number}|null,
 *   face:number, planeId:number, entityId:string|null }} PickResult
 */

/**
 * Click-only pick (24.6). `ctx`: `{ cam, cols, rows, pxCellW, pxCellH, world,
 * assets, fb, gpuPipeline, gpuActive, voxelPool }`.
 * @returns {PickResult}
 */
export function pickAt(col, row, ctx) {
  const { cam, cols, rows, pxCellW, pxCellH, world, assets, voxelPool } = ctx;
  const surf = readSurface(col, row, ctx);
  const decoded = decodePlaneId(surf.kind, surf.planeId);
  const ray = unprojectCell(cam, cols, rows, pxCellW, pxCellH, col, row);

  /** @type {PickResult} */
  const result = {
    kind: decoded.type, col, row, depth: surf.depth, world: null,
    structureId: null, cell: null, face: surf.face, planeId: surf.planeId, entityId: null,
  };

  if (decoded.type === 'sky') {
    result.depth = Infinity;
  } else if (decoded.type === 'terrain') {
    result.world = rayPoint(ray, surf.depth);
  } else if (decoded.type === 'voxel') {
    result.world = rayPoint(ray, surf.depth);
    const inst = voxelPool && voxelPool.list[decoded.slot];
    if (inst) {
      const entId = findEntityForVoxelInstance(world, inst);
      if (entId) { result.kind = 'entity'; result.entityId = entId; }
    }
  } else if (decoded.type === 'structure') {
    const s = world.structures[decoded.structSeq];
    result.kind = 'surface';
    const isWall = surf.kind === KIND_WALL || surf.kind === KIND_STEP || surf.kind === KIND_UPPER;
    const point = rayPoint(ray, surf.depth + (isWall ? 0.01 : 0));
    result.world = point;
    if (s) {
      result.structureId = s.id;
      result.cell = { x: Math.floor(point.x - s.origin.x), y: Math.floor(point.y - s.origin.y) };
    }
  }

  // Entity ray-cylinder fallback (24.6 priority: voxel-slot hit already
  // handled above > ray-cylinder > surface): never behind the surface hit.
  if (result.kind !== 'entity' && decoded.type !== 'sky') {
    const maxDepth = Number.isFinite(surf.depth) ? surf.depth - 0.05 : 1e6;
    const hit = rayPickEntities(ray, collectEntities(world), assets, maxDepth);
    if (hit) {
      result.kind = 'entity';
      result.entityId = hit.id;
      result.depth = hit.depth;
      result.world = rayPoint(ray, hit.depth);
    }
  }

  return result;
}

/**
 * Marker pick (lights, interactables - 24.6): the closest marker whose
 * projected cell is within 1 cell of `(col,row)` and whose depth is less
 * than the surface depth there (so a marker behind a wall isn't picked).
 * Circle/cells-shaped triggers and the player spawn have no single "closest
 * point" cheap enough for this pass - the outliner (24.7) is the fallback
 * for those, same as the architecture note's own "only way to select
 * triggers with cells".
 * @returns {{fileId:string, collection:string, id:string}|null}
 */
export function pickMarkers(col, row, ctx) {
  const { cam, cols, rows, pxCellW, pxCellH, world } = ctx;
  const surf = readSurface(col, row, ctx);
  let best = null;
  const consider = (fileId, collection, id, x, y, z) => {
    const proj = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x, y, z });
    if (!(proj.depth > 0) || proj.depth >= surf.depth) return;
    if (Math.abs(proj.col - col) > 1 || Math.abs(proj.row - row) > 1) return;
    if (!best || proj.depth < best.depth) best = { fileId, collection, id, depth: proj.depth };
  };
  for (const s of world.structures) {
    const def = s.level.def;
    for (const l of def.lights || []) consider(`level/${s.level.name}`, 'lights', l.id, l.x + s.origin.x, l.y + s.origin.y, l.z + s.origin.z);
    for (const it of def.interactables || []) consider(`level/${s.level.name}`, 'interactables', it.id, it.x + s.origin.x, it.y + s.origin.y, it.z + s.origin.z);
  }
  return best ? { fileId: best.fileId, collection: best.collection, id: best.id } : null;
}
