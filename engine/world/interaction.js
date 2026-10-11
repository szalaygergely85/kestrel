// engine/world/interaction.js (US-012, D-006/D-008). Generic interaction
// targeting + firing. The engine has no idea what a lantern, a lever or a
// beacon is - it only knows `world.interactables` and named behaviours
// (`engine/core/behaviours.js`). Normative API: docs/architecture.md 7.4.
//
// `world.interactables` is built by `World.load` from every placed
// structure's `def.interactables`, and extended at runtime through
// `World.addInteractable(spec)` / `World.removeInteractable(key)` (US-079b0,
// architecture.md 37.16.1 item 2) - corpses, NPCs, chests. The game goes
// through that seam (never pushes into `world.interactables` itself), and it
// re-adds on every `world:loaded` because `World.load`/`deserialize` rebuild
// the list from content. `rec.x/y/z` may be rewritten by the owner at any
// time: `findInteractTarget` reads them LIVE (no captured copy).
//
// Allocation rule (9): `findInteractTarget` runs every fixed step (7.4 item
// 5) and must not allocate. `world.interactables[i].usedKey` is precomputed
// once in `World.load` so the hot loop never concatenates a string.
import { gridLocal } from './gridLocal.js';

/**
 * @typedef {{key:string, structId:string|null, id?:string, name:string, x:number,
 *   y:number, z:number, radius:number, prompt:string, once:boolean,
 *   requires:string|null, propId:string|null, def?:Object, usedKey:string|null}} InteractableRec
 *   World coords. `structId`/`id` are set only by `World.load` (level data);
 *   a runtime rec from `World.addInteractable` has `structId: null`, `usedKey:
 *   null`, `once: false` and no `id`. `x/y/z` are LIVE - the owner may rewrite
 *   them after add and `findInteractTarget` reads the current values.
 */

/** @typedef {{targetKey:string|null, prompt:string, dist:number, angleDeg:number}} InteractionState */

const DEFAULT_REACH = 1.8;
const DEFAULT_CONE_DEG = 22; // OB-052: forgiving aim (was 20); OB-063: 40 was too wide (owner saw a prompt 25 deg off), now 22 h / 35 v
export const HYST_CONE_DEG = 8;  // the current target survives this far outside the cone
export const HYST_REACH = 0.3;   // ...and this much beyond reach
const DIST_WEIGHT = 15;          // score = angleDeg + dist * 15: 1 m of distance costs 15 deg of aim
const KEEP_BONUS = 5;            // a challenger must beat the current target's score by 5 to replace it
export const DEFAULT_NEAR_DIST = 0.7; // DOOR-CLOSE-01: inside this range the cone widens
export const DEFAULT_NEAR_CONE_DEG = 70;
const DEFAULT_HEIGHT = 0.8;       // OB-052b: vertical extent of an interactable (rec.height overrides)
const VERT_RATIO = 1.6;          // vertical tolerance = 35/22 of the horizontal one (OB-063)
const MIN_COS_VIEW = 0.5;        // OB-063: the aim point must lie in front, within 60 deg of the view direction
const LOS_STEP = 0.1;
const LOS_MAX_SAMPLES = 20;
const losGrid = { x: 0, y: 0, z: 0 }; // gridLocal scratch (rule 9)

/**
 * One grid-sector sample of `hasLineOfSight` (also used by `World.raySegment`
 * on grid physics): true if the world point is inside solid / below the floor
 * / above a numeric ceiling. Pure, zero allocation.
 */
export function pointBlocked(world, x, y, z) {
  const s = world.structureAt(x, y);
  let floorH, ceilH, solid;
  if (s) {
    const g = gridLocal(s, x, y, losGrid);
    const sector = s.level.sectorAt(g.x, g.y);
    if (!sector) return true;
    solid = sector.solid;
    floorH = sector.floorH + g.z;
    ceilH = typeof sector.ceilH === 'number' ? sector.ceilH + g.z : sector.ceilH;
  } else {
    // MESH-PHYS-02: LOS only needs floor/solid; `outsideSector` also computes the ground normal (4 more groundAt) + type + material.
    // `outsideFloorH` answers undefined when unavailable (not a World, or `outsideSector` overridden) -> the full query.
    const f = world.outsideFloorH ? world.outsideFloorH(x, y) : undefined;
    if (f !== undefined) return f === null || z < f; // null = no terrain = solid outside; ceiling is 'sky'
    const sector = world.outsideSector(x, y);
    solid = sector.solid;
    floorH = sector.floorH;
    ceilH = sector.ceilH;
  }
  if (solid) return true;
  if (z < floorH) return true;
  if (typeof ceilH === 'number' && z > ceilH) return true;
  return false;
}

/**
 * 0.1 m samples (<= 20, capped), WORLD heights (2026-09-24 review fix):
 * inside a structure footprint use that structure's level sector with
 * floorH/ceilH offset by the structure's origin.z (a null sector, or a
 * solid one, blocks); outside any footprint use `world.outsideSector`
 * (terrain floor + sky, or solid with no terrain). Blocked if solid,
 * `z < floor`, or a numeric ceiling `< z`. Pure, no allocation (reused
 * later by AI) - `outsideSector` writes into a scratch object.
 */
export function hasLineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-9) return true;
  let steps = Math.ceil(dist / LOS_STEP);
  if (steps > LOS_MAX_SAMPLES) steps = LOS_MAX_SAMPLES;
  if (steps < 1) steps = 1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;

    if (pointBlocked(world, x, y, z)) return false;
  }
  return true;
}

/**
 * Finds the interaction target (a candidate is: not used, `requires` met,
 * `|p - eye| <= min(rec.radius, reach)`, `angle(viewDir, p - eye) <= coneDeg`,
 * has line of sight). Winner (OB-052): lowest score = angleDeg + 15 * dist, then
 * array order. Hysteresis: the previous target (`out.targetKey` on entry) keeps
 * a 5 point bonus and a wider gate (cone + 15 deg, reach + 0.3 m). Fills and returns `out` - never allocates. Reads `rec.x/y/z`
 * LIVE (a runtime rec may be moved by its owner after add, US-079b0).
 * @param {import('./World.js').World} world
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} eye
 * @param {{reach?:number, coneDeg?:number, nearDist?:number, nearConeDeg?:number}} [cfg]
 * @param {InteractionState} out
 * @returns {InteractionState}
 */
export function findInteractTarget(world, eye, cfg, out) {
  const reach = (cfg && typeof cfg.reach === 'number') ? cfg.reach : DEFAULT_REACH;
  const coneDeg = (cfg && typeof cfg.coneDeg === 'number') ? cfg.coneDeg : DEFAULT_CONE_DEG;
  const nearDist = (cfg && typeof cfg.nearDist === 'number') ? cfg.nearDist : DEFAULT_NEAR_DIST;
  const nearConeDeg = (cfg && typeof cfg.nearConeDeg === 'number') ? cfg.nearConeDeg : DEFAULT_NEAR_CONE_DEG;

  const yawRad = eye.yawDeg * Math.PI / 180;
  const pitchRad = eye.pitchDeg * Math.PI / 180;
  const cosPitch = Math.cos(pitchRad);
  // Compass convention (7.4): 0 = N = -y, clockwise.
  const vx = Math.sin(yawRad) * cosPitch;
  const vy = -Math.cos(yawRad) * cosPitch;
  const vz = Math.sin(pitchRad);

  const list = world.interactables;
  const prevKey = out.targetKey;
  let bestIdx = -1, bestAngle = Infinity, bestDist = Infinity, bestScore = Infinity;
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (rec.usedKey && world.state[rec.usedKey]) continue;
    if (rec.requires && !world.state[rec.requires]) continue;

    const dx = rec.x - eye.x, dy = rec.y - eye.y, dz = rec.z - eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const isPrev = prevKey !== null && rec.key === prevKey;
    const maxReach = (rec.radius < reach ? rec.radius : reach) + (isPrev ? HYST_REACH : 0);
    if (dist > maxReach) continue;

    // OB-052b: aim at the object's vertical extent, not one point. Closest point on the vertical segment
    // [rec.z - h/2, rec.z + h/2] to the view ray (line-line closest approach, clamped), so looking a bit up/down still hits.
    const hh = (typeof rec.height === 'number' ? rec.height : DEFAULT_HEIGHT) * 0.5;
    const dot = dx * vx + dy * vy + dz * vz;
    const denom = 1 - vz * vz;
    let s = denom > 1e-6 ? (vz * dot - dz) / denom : 0;
    if (s > hh) s = hh; else if (s < -hh) s = -hh;
    const az = dz + s; // aim point (relative to the eye)
    const hd = Math.sqrt(dx * dx + dy * dy);
    const aimDist = Math.sqrt(hd * hd + az * az);
    let cosAngle = aimDist < 1e-9 ? 1 : (dx * vx + dy * vy + az * vz) / aimDist;
    if (cosAngle > 1) cosAngle = 1; else if (cosAngle < -1) cosAngle = -1;
    const angleDeg = Math.acos(cosAngle) * 180 / Math.PI;
    // Elliptical gate on the yaw/pitch components: horizontal = cone, vertical = cone * VERT_RATIO.
    // DOOR-CLOSE-01: within nearDist the cone widens to nearConeDeg.
    if (cosAngle < MIN_COS_VIEW) continue;
    const lim = (dist < nearDist && coneDeg < nearConeDeg ? nearConeDeg : coneDeg) + (isPrev ? HYST_CONE_DEG : 0);
    let dyawDeg = 0;
    if (hd > 1e-6) {
      dyawDeg = Math.atan2(dx, -dy) * 180 / Math.PI - eye.yawDeg;
      dyawDeg -= 360 * Math.round(dyawDeg / 360);
    }
    const dpitchDeg = Math.atan2(az, hd) * 180 / Math.PI - eye.pitchDeg;
    const ey2 = dpitchDeg / (lim * VERT_RATIO), ex2 = dyawDeg / lim;
    if (ex2 * ex2 + ey2 * ey2 > 1) continue;

    if (!hasLineOfSight(world, eye.x, eye.y, eye.z, rec.x, rec.y, eye.z + az) &&
        !hasLineOfSight(world, eye.x, eye.y, eye.z, rec.x, rec.y, rec.z)) continue;

    const score = angleDeg + dist * DIST_WEIGHT - (isPrev ? KEEP_BONUS : 0);
    if (score < bestScore - 1e-9) {
      bestScore = score;
      bestAngle = angleDeg;
      bestDist = dist;
      bestIdx = i;
    }
  }

  if (bestIdx === -1) {
    out.targetKey = null;
    out.prompt = '';
    out.dist = 0;
    out.angleDeg = 0;
  } else {
    const rec = list[bestIdx];
    out.targetKey = rec.key;
    out.prompt = rec.prompt;
    out.dist = bestDist;
    out.angleDeg = bestAngle;
  }
  return out;
}

const INTERACT_CFG = { reach: DEFAULT_REACH, coneDeg: DEFAULT_CONE_DEG, nearDist: DEFAULT_NEAR_DIST, nearConeDeg: DEFAULT_NEAR_CONE_DEG }; // reused (rule 9)

function findRecByKey(world, key) {
  const list = world.interactables;
  for (let i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}

/**
 * Fills `world.interaction` (reused) with the current target, and - on a
 * usePressed edge with a target - fires it: `world.fireInteraction(rec.name,
 * {engine, def, entity, actor})`, the used flag (only when the behaviour
 * returns anything but `false`), `'interaction:fired' {key, name}`, then the
 * prop handle's `'interact'` listeners (10.1).
 * @param {import('./World.js').World} world
 * @param {import('../core/engine.js').Engine} engine
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} eye
 * @param {boolean} usePressed
 */
export function updateInteraction(world, engine, eye, usePressed) {
  const out = world.interaction;
  findInteractTarget(world, eye, INTERACT_CFG, out);
  if (!usePressed || !out.targetKey) return;

  const rec = findRecByKey(world, out.targetKey);
  if (!rec) return;

  const actor = world.get('player');
  const entity = rec.propId ? world.get(rec.propId) : null;
  const result = world.fireInteraction(rec.name, { engine, def: rec.def, entity, actor, structId: rec.structId });

  if (result !== false && rec.usedKey) world.state[rec.usedKey] = true;
  if (world.events) world.events.emit('interaction:fired', { key: rec.key, name: rec.name });
  if (rec.propId) world._emit(rec.propId, 'interact', { key: rec.key, name: rec.name });
}
