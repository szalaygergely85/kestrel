// tools/editor/ray.js - US-032 (docs/architecture.md 24.6). Pure cell<->ray
// maths, planeId decode and ray/cylinder intersection - no DOM, no GPU, no
// World; Node-tested (ray.test.mjs). `pick.js` is the browser-only half that
// wires this to a real click, a GPU readback or `fb.gbuf`, and the world.
//
// Imports only engine/index.js (the editor boundary rule); `KIND_WALL..
// KIND_CEIL` (1..6) are NOT exported from engine/index.js today (24.12 item
// 4) - hard-coded here per that note's own instruction, with the source
// comment pointing at the real definition so a future export swap is a
// one-line diff.
import { HFOV_DEG, KIND_TERRAIN, KIND_MODEL } from '../../engine/index.js';

const DEG2RAD = Math.PI / 180;
const TAN_HALF_HFOV = Math.tan((HFOV_DEG * DEG2RAD) / 2);

// engine/render/GBuffer.js KIND_* (0 none/sky, 1 wall, 2 step, 3 upper, 4 floor, 5 top, 6 ceil, 7 terrain, 8 model)
export const KIND_NONE = 0;
export const KIND_WALL = 1;
export const KIND_STEP = 2;
export const KIND_UPPER = 3;
export const KIND_FLOOR = 4;
export const KIND_TOP = 5;
export const KIND_CEIL = 6;

/** Compass yaw 0 = N = -y, clockwise (same convention as camera.js). */
export function cameraBasis(cam) {
  const yawRad = cam.yawDeg * DEG2RAD;
  const dirX = Math.sin(yawRad);
  const dirY = -Math.cos(yawRad);
  const rightX = -dirY;
  const rightY = dirX;
  return { dirX, dirY, rightX, rightY };
}

/**
 * The camera-plane constants the casters/sprite projection share (24.6):
 * `screenAspect = (cols*pxCellW)/(rows*pxCellH)`, `planeDistY`, and the
 * pitched `horizonRow`.
 */
export function planeGeometry(cols, rows, pxCellW, pxCellH, pitchDeg) {
  const screenAspect = (cols * pxCellW) / (rows * pxCellH);
  const planeDistY = ((rows / 2) * screenAspect) / TAN_HALF_HFOV;
  const horizonRow = rows / 2 + Math.tan(pitchDeg * DEG2RAD) * planeDistY;
  return { screenAspect, planeDistY, horizonRow };
}

/**
 * Cell -> ray (24.6). Returns a plain-data ray `{ ox, oy, oz, dx, dy, dz }`
 * such that `rayPoint(ray, d)` at perpendicular depth `d` gives the world
 * point that cell projects to.
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} cam
 */
export function unprojectCell(cam, cols, rows, pxCellW, pxCellH, col, row) {
  const { dirX, dirY, rightX, rightY } = cameraBasis(cam);
  const { planeDistY, horizonRow } = planeGeometry(cols, rows, pxCellW, pxCellH, cam.pitchDeg);
  const a = ((2 * (col + 0.5)) / cols - 1) * TAN_HALF_HFOV;
  const dz = (horizonRow - (row + 0.5)) / planeDistY;
  return { ox: cam.x, oy: cam.y, oz: cam.z, dx: dirX + rightX * a, dy: dirY + rightY * a, dz };
}

/** Point on `ray` at perpendicular depth `d` (along-`dir` distance, per 24.6). */
export function rayPoint(ray, d) {
  return { x: ray.ox + d * ray.dx, y: ray.oy + d * ray.dy, z: ray.oz + d * ray.dz };
}

/**
 * World point -> screen cell + depth (the exact inverse of `unprojectCell`,
 * same equations `sprites.js`/the casters use). Used by the round-trip test
 * and by `select.js`'s highlight-rect projection.
 */
export function projectPoint(cam, cols, rows, pxCellW, pxCellH, point) {
  const { dirX, dirY, rightX, rightY } = cameraBasis(cam);
  const { planeDistY, horizonRow } = planeGeometry(cols, rows, pxCellW, pxCellH, cam.pitchDeg);
  const relX = point.x - cam.x;
  const relY = point.y - cam.y;
  const depth = relX * dirX + relY * dirY;
  const lateral = relX * rightX + relY * rightY;
  const colCenter = (lateral / (depth * TAN_HALF_HFOV) + 1) * (cols / 2);
  const rowCenter = horizonRow - ((point.z - cam.z) / depth) * planeDistY;
  return { col: colCenter - 0.5, row: rowCenter - 0.5, depth };
}

/**
 * Decode a G-buffer `(kind, planeId)` pair into what it points at (24.6).
 * Does NOT decode the low 24 bits for structure hits (their meaning differs
 * per plane type) - callers take the hit point from `d` instead.
 * @returns {{type:'sky'|'terrain'|'voxel'|'structure', slot?:number, structSeq?:number, tag?:number}}
 */
export function decodePlaneId(kind, planeId) {
  if (kind === KIND_NONE) return { type: 'sky' };
  if (kind === KIND_TERRAIN) return { type: 'terrain' };
  if (kind === KIND_MODEL && ((planeId >>> 28) & 0xf) === 0xf) {
    return { type: 'voxel', slot: (planeId >>> 24) & 0xf };
  }
  return { type: 'structure', structSeq: (planeId >>> 28) & 7, tag: (planeId >>> 24) & 0xf };
}

/**
 * Ray/vertical-cylinder intersection (24.6, sprite/voxel entity picking).
 * `cyl = { x, y, zMin, zMax, radius }`. Returns the smallest positive `d`
 * (perpendicular depth) with `d < maxDepth`, or `null` on a miss/occlusion.
 */
export function rayCylinderHit(ray, cyl, maxDepth) {
  const px = ray.ox - cyl.x;
  const py = ray.oy - cyl.y;
  const a = ray.dx * ray.dx + ray.dy * ray.dy;
  const b = 2 * (px * ray.dx + py * ray.dy);
  const c = px * px + py * py - cyl.radius * cyl.radius;
  let d = null;
  if (a < 1e-12) {
    if (c > 0) return null; // ray parallel to the axis, outside the radius
    d = 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const d0 = (-b - sq) / (2 * a);
    const d1 = (-b + sq) / (2 * a);
    d = d0 >= 0 ? d0 : (d1 >= 0 ? d1 : null);
    if (d == null) return null;
  }
  if (d >= maxDepth) return null;
  const z = ray.oz + d * ray.dz;
  if (z < cyl.zMin || z > cyl.zMax) return null;
  return d;
}

/**
 * Ray-pick the entities without an id channel (24.6): every entity with
 * `components.sprite` or `components.voxel`, as a vertical cylinder. Keeps
 * the nearest hit with `d < maxDepth` (the surface pick's depth minus a
 * small bias, so an entity is never picked through the wall behind it).
 * @param {Array<{id:string, transform:Object, components:Object}>} entities
 * @param {{model:(key:string)=>Object}} assets
 * @returns {{id:string, depth:number}|null}
 */
export function rayPickEntities(ray, entities, assets, maxDepth) {
  let best = null;
  for (const e of entities) {
    const t = e.transform;
    if (!t) continue;
    let radius, height;
    const comps = e.components || {};
    if (comps.sprite) {
      // US-032 fix: `assets.model()` THROWS on an unknown key (it is not a
      // `get`-shaped lookup, unlike this code's original assumption) - a
      // world entity can reference a model the loaded bundle doesn't carry
      // (e.g. `waystone` before `voxel_world.js` is wired into a page's
      // script list, docs/backlog.md row 30g/S6) and that must not crash
      // every future pick in the session. `assets.has()` guards it.
      if (!assets.has('model', comps.sprite.model)) continue;
      const m = assets.model(comps.sprite.model);
      if (!m || !m.world) continue;
      radius = m.world.w / 2;
      height = m.world.h;
    } else if (comps.voxel) {
      if (!assets.has('model', comps.voxel.model)) continue;
      const m = assets.model(comps.voxel.model);
      const v = m && m.voxel;
      if (!v) continue;
      radius = (Math.max(v.size[0], v.size[1]) * v.cellM) / 2;
      height = v.size[2] * v.cellM;
    } else {
      continue;
    }
    const cyl = { x: t.x, y: t.y, zMin: t.z, zMax: t.z + height, radius };
    const d = rayCylinderHit(ray, cyl, maxDepth);
    if (d != null && (!best || d < best.depth)) best = { id: e.id, depth: d };
  }
  return best;
}
