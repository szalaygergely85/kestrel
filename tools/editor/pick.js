// tools/editor/pick.js - US-032 (docs/architecture.md 24.6). Browser-only
// half of picking: turns a click's `(col,row)` into a `PickResult` by
// reading the surface under the cursor (GPU readback or `fb.gbuf` on
// `?gpu=0`) and falling back to ray/cylinder entity picking (ray.js, pure,
// Node-tested). Never called per frame (24.6/24.14: "click pick <= 5 ms",
// "do not call readbackGeometry outside a click").
//
// Imports only engine/index.js + ray.js (the editor boundary rule).
import { KIND_TERRAIN, localToWorld, worldToLocal } from '../../engine/index.js';
import { resolveMeshPick } from './meshPick.js';
import {
  unprojectCell, rayPoint, projectPoint, decodePlaneId, rayPickEntities, resolveVoxelSlot,
  KIND_WALL, KIND_STEP, KIND_UPPER,
} from './ray.js';

// Reused every call (rule 9) - `collectEntities` below.
const _entityScratch = [];

/**
 * Reads one cell's surface sample (24.6, the documented click-only exemption): `ctx.readSurface` (the engine frame renderer's
 * async G-buffer/geometry readback, ED-WG-01b) or, without it, the CPU `fb.gbuf`/`fb.depth`.
 * @param {number} col @param {number} row
 * @param {{cols:number, fb:Object, readSurface?:Function}} ctx
 * @returns {Promise<{kind:number,face:number,mat:number,planeId:number,depth:number}>}
 */
export async function readSurface(col, row, ctx) {
  if (ctx.readSurface) return ctx.readSurface(col, row);
  const i = row * ctx.cols + col;
  const { gbuf } = ctx.fb;
  return { kind: gbuf.kind[i], face: gbuf.face[i], mat: gbuf.mat[i], planeId: gbuf.planeId[i], depth: ctx.fb.depth.depth[i] };
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
 * assets, fb, readSurface, voxelPool }`.
 * @returns {Promise<PickResult>}
 */
export async function pickAt(col, row, ctx) {
  const { cam, cols, rows, pxCellW, pxCellH, world, assets, voxelPool, renderer } = ctx;
  const surf = await readSurface(col, row, ctx);
  const decoded = decodePlaneId(surf.kind, surf.planeId);
  const ray = unprojectCell(cam, cols, rows, pxCellW, pxCellH, col, row, renderer);

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
    // 31.4c: >16 instances alias the 4-bit slot -> accept only a rect-contained candidate.
    const idx = voxelPool ? resolveVoxelSlot(voxelPool.list, decoded.slot, result.world) : -1;
    const inst = idx >= 0 ? voxelPool.list[idx] : null;
    if (inst) {
      const entId = findEntityForVoxelInstance(world, inst);
      if (entId) { result.kind = 'entity'; result.entityId = entId; }
    }
  } else if (decoded.type === 'mesh' || decoded.type === 'cloth') {
    result.world = rayPoint(ray, surf.depth);
    if (decoded.type === 'mesh') {
      result.structureId = resolveMeshPick(world, ray, surf.depth);
      result.kind = result.structureId ? 'meshStructure' : 'surface';
    } else result.kind = 'surface';
  } else if (decoded.type === 'structure') {
    const s = world.structures[decoded.structSeq];
    result.kind = 'surface';
    const isWall = surf.kind === KIND_WALL || surf.kind === KIND_STEP || surf.kind === KIND_UPPER;
    const point = rayPoint(ray, surf.depth + (isWall ? 0.01 : 0));
    result.world = point;
    if (s) {
      result.structureId = s.id;
      // CO-7: the local cell of the placed structure's own frame (was `point - s.origin`).
      const local = worldToLocal(s.frame, point.x, point.y, point.z, { x: 0, y: 0, z: 0 });
      result.cell = { x: Math.floor(local.x), y: Math.floor(local.y) };
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
 * @returns {{fileId:string, collection:string, id:string, structId:string}|null}
 */
export async function pickMarkers(col, row, ctx) {
  const { cam, cols, rows, pxCellW, pxCellH, world, renderer } = ctx;
  const surf = await readSurface(col, row, ctx);
  let best = null;
  const consider = (fileId, collection, id, structId, x, y, z) => {
    const proj = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x, y, z }, renderer);
    if (!(proj.depth > 0) || proj.depth >= surf.depth) return;
    if (Math.abs(proj.col - col) > 1 || Math.abs(proj.row - row) > 1) return;
    if (!best || proj.depth < best.depth) best = { fileId, collection, id, structId, depth: proj.depth };
  };
  // CO-7: each marker's world position comes from ITS OWN placement's frame
  // (was `+ s.origin`) - two placements of one level each convert through
  // their own structure, never mixed up (docs/coordinates.md section 10 item 7).
  for (const s of world.structures) {
    if (!s.level) continue; // mesh/road structures have no level markers
    const def = s.level.def;
    for (const l of def.lights || []) {
      const p = localToWorld(s.frame, l.x, l.y, l.z, { x: 0, y: 0, z: 0 });
      consider(`level/${s.level.name}`, 'lights', l.id, s.id, p.x, p.y, p.z);
    }
    for (const it of def.interactables || []) {
      const p = localToWorld(s.frame, it.x, it.y, it.z, { x: 0, y: 0, z: 0 });
      consider(`level/${s.level.name}`, 'interactables', it.id, s.id, p.x, p.y, p.z);
    }
  }
  return best ? { fileId: best.fileId, collection: best.collection, id: best.id, structId: best.structId } : null;
}
