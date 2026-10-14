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
export const HYST_REACH = 0.3;   // the held target survives this far beyond reach
export const PICK_PAD = 0.06;    // OB-066: every pick volume is inflated by this (OB-088: was 0.15 - a note prompted from the wall above it)
export const HYST_PAD = 0.06;    // ...and the held target's volume by this much more (OB-088: was 0.1)
const DEFAULT_HALF_W = 0.15;     // default pick volume: 0.3 m wide (OB-088: was 0.5; a wall note is flat paper - a deep box stuck out of the wall),
const DEFAULT_HEIGHT = 0.4;      // ...0.4 m tall (OB-088: was 0.8; rec.height overrides), centred on rec.x/y/z
const INSIDE_COS = Math.cos(35 * Math.PI / 180); // OB-084: eye inside a pick box -> the box centre must be within 35 deg of the crosshair
const LOS_BACKOFF = 0.05;       // LOS is checked to just in front of the hit point (a note sits flush on a wall)
const LOS_STEP = 0.1;
const LOS_MAX_SAMPLES = 20;
const losRay = new Float64Array(6); // scratch for the scalar-arg hasLineOfSight wrapper
const losGrid = { x: 0, y: 0, z: 0 }; // gridLocal scratch (rule 9)

/**
 * One grid-sector sample of `hasLineOfSight` (also used by `World.raySegment`
 * on grid physics): true if the world point is inside solid / below the floor
 * / above a numeric ceiling. Pure, zero allocation.
 */
/**
 * OB-084: a level item on a prop picks on the prop's whole collider box. Resolved here (World.load after the props spawn,
 * addInteractable, and whenever a prop moves via rebuildPropColliders), never inside findInteractTarget's hot loop.
 */
export function resolvePropPicks(world) {
  const list = world.interactables;
  if (!list || !world.propPickBox) return;
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (rec.propId && !rec.bodyId) { rec.pick = world.propPickBox(rec.propId) || null; rec.pickShapes = (world.propPickShapes && world.propPickShapes(rec.propId)) || null; }
  }
}

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
  const r = losRay; r[0] = ax; r[1] = ay; r[2] = az; r[3] = bx; r[4] = by; r[5] = bz;
  return hasLineOfSightRay(world, r);
}

/**
 * NAV-ALLOC-01: `hasLineOfSight` for a per-tick caller. `r` = Float64Array [ax,ay,az,bx,by,bz] (caller-owned; 7 double args box at the
 * call boundary, arch 38.61 2b). Identical sampling and answers to `hasLineOfSight`.
 */
export function hasLineOfSightRay(world, r) {
  const ax = r[0], ay = r[1], az = r[2];
  const dx = r[3] - ax, dy = r[4] - ay, dz = r[5] - az;
  const lq = world._lq || null;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-9) return true;
  let steps = Math.ceil(dist / LOS_STEP);
  if (steps > LOS_MAX_SAMPLES) steps = LOS_MAX_SAMPLES;
  if (steps < 1) steps = 1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;

    let b = 0;
    if (lq) { // NAV-ALLOC-01: World fast path on scratch (no boxed double args)
      lq[0] = x; lq[1] = y; lq[2] = z;
      b = world.losPointQ();
      if (b === 1) return false;
      if (b === 0) continue;
    }
    if (b === -1 && world._gridStructures) { // inside a structure bbox: same answer as pointBlocked, reading the lq scratch (pointBlocked boxes its 3 double args per sample)
      const sb = structureBlockedQ(world, lq);
      if (sb !== -1) { if (sb === 1) return false; continue; }
    }
    if (pointBlocked(world, x, y, z)) return false;
  }
  return true;
}

/** pointBlocked for a point inside a grid structure, no boxed args. 1 blocked, 0 free, -1 = not in a structure (caller falls back). */
function structureBlockedQ(world, q) {
  const x = q[0], y = q[1], z = q[2];
  const gs = world._gridStructures();
  for (let i = 0; i < gs.length; i++) {
    const st = gs[i], bb = st.bbox;
    if (!(x >= bb.x0 && x < bb.x1 && y >= bb.y0 && y < bb.y1)) continue;
    const o = st.origin, sector = st.level.sectorAt(Math.floor(x - o.x), Math.floor(y - o.y)); // integers -> Smi args, sectorAt floors again (idempotent)
    if (!sector) return 1;
    if (sector.solid) return 1;
    if (z < sector.floorH + o.z) return 1;
    const c = sector.ceilH;
    if (typeof c === 'number' && z > c + o.z) return 1;
    return 0;
  }
  return -1;
}

/**
 * OB-088: entry distance of the view ray into ONE oriented collider shape {cx,cy,cz,hx,hy,hz,c,s} (c/s = cos/sin of its yaw),
 * inflated by `pad`; -1 = miss within maxT. The eye inside the shape gives 0. Allocation-free.
 */
function shapeEntry(sh, ex, ey, ez, vx, vy, vz, pad, maxT) {
  const dx = ex - sh.cx, dy = ey - sh.cy, c = sh.c, s = sh.s;
  const ox = c * dx + s * dy, oy = -s * dx + c * dy, oz = ez - sh.cz; // world -> shape local (rotate by -yaw about z)
  const lx = c * vx + s * vy, ly = -s * vx + c * vy, lz = vz;
  let tn = 0, tf = maxT;
  const hx = sh.hx + pad, hy = sh.hy + pad, hz = sh.hz + pad;
  if (lx > -1e-9 && lx < 1e-9) { if (ox < -hx || ox > hx) return -1; }
  else { let t0 = (-hx - ox) / lx, t1 = (hx - ox) / lx; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } if (t0 > tn) tn = t0; if (t1 < tf) tf = t1; if (tn > tf) return -1; }
  if (ly > -1e-9 && ly < 1e-9) { if (oy < -hy || oy > hy) return -1; }
  else { let t0 = (-hy - oy) / ly, t1 = (hy - oy) / ly; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } if (t0 > tn) tn = t0; if (t1 < tf) tf = t1; if (tn > tf) return -1; }
  if (lz > -1e-9 && lz < 1e-9) { if (oz < -hz || oz > hz) return -1; }
  else { let t0 = (-hz - oz) / lz, t1 = (hz - oz) / lz; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } if (t0 > tn) tn = t0; if (t1 < tf) tf = t1; if (tn > tf) return -1; }
  return tn;
}

/**
 * Finds the interaction target by CROSSHAIR RAY (OB-066, replaces the angular cone). Each candidate (not used,
 * `requires` met) has a pick volume: `rec.pick` {x0,y0,z0,x1,y1,z1} (world AABB, e.g. a prop's collider box) or a
 * default box (0.5 m wide, rec.height tall, centred on rec.x/y/z), inflated by PICK_PAD (+HYST_PAD when it is the
 * held target). The target is the nearest volume the view ray enters within min(rec.radius, reach) (+HYST_REACH for the
 * held one) that has line of sight to the hit point. Fills and returns `out` - never allocates. Reads rec.x/y/z LIVE.
 * @param {import('./World.js').World} world
 * @param {{x:number,y:number,z:number,yawDeg:number,pitchDeg:number}} eye
 * @param {{reach?:number}} [cfg]
 * @param {InteractionState} out
 * @returns {InteractionState}
 */
export function findInteractTarget(world, eye, cfg, out) {
  const reach = (cfg && typeof cfg.reach === 'number') ? cfg.reach : DEFAULT_REACH;
  const yawRad = eye.yawDeg * Math.PI / 180;
  const pitchRad = eye.pitchDeg * Math.PI / 180;
  const cosPitch = Math.cos(pitchRad);
  // Compass convention (7.4): 0 = N = -y, clockwise.
  const vx = Math.sin(yawRad) * cosPitch;
  const vy = -Math.cos(yawRad) * cosPitch;
  const vz = Math.sin(pitchRad);

  const list = world.interactables;
  const prevKey = out.targetKey;
  let bestIdx = -1, bestT = Infinity;
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    if (rec.usedKey && world.state[rec.usedKey]) continue;
    if (rec.requires && !world.state[rec.requires]) continue;

    const isPrev = prevKey !== null && rec.key === prevKey;
    const maxT = (rec.radius < reach ? rec.radius : reach) + (isPrev ? HYST_REACH : 0);
    const pad = PICK_PAD + (isPrev ? HYST_PAD : 0);
    let x0, y0, z0, x1, y1, z1;
    const pk = rec.pick;
    const be = rec.bodyId ? world.entity(rec.bodyId) : null;
    if (pk) { x0 = pk.x0; y0 = pk.y0; z0 = pk.z0; x1 = pk.x1; y1 = pk.y1; z1 = pk.z1; }
    else if (be) { // OB-084: a moving body (NPC, corpse, pickup): a box around the LIVE entity, bodyR wide, bodyH tall from its feet
      const bt = be.transform, br = rec.bodyR, bh = rec.bodyH;
      x0 = bt.x - br; x1 = bt.x + br; y0 = bt.y - br; y1 = bt.y + br; z0 = bt.z; z1 = bt.z + bh;
    } else {
      const hh = (typeof rec.height === 'number' ? rec.height : DEFAULT_HEIGHT) * 0.5;
      x0 = rec.x - DEFAULT_HALF_W; x1 = rec.x + DEFAULT_HALF_W;
      y0 = rec.y - DEFAULT_HALF_W; y1 = rec.y + DEFAULT_HALF_W;
      z0 = rec.z - hh; z1 = rec.z + hh;
    }
    x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;

    // Slab test: entry distance tn along the (unit) view ray; the eye inside the box gives tn = 0.
    let tn = 0, tf = maxT;
    let o = eye.x, v = vx;
    if (v > -1e-9 && v < 1e-9) { if (o < x0 || o > x1) continue; }
    else { let t0 = (x0 - o) / v, t1 = (x1 - o) / v; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } if (t0 > tn) tn = t0; if (t1 < tf) tf = t1; if (tn > tf) continue; }
    o = eye.y; v = vy;
    if (v > -1e-9 && v < 1e-9) { if (o < y0 || o > y1) continue; }
    else { let t0 = (y0 - o) / v, t1 = (y1 - o) / v; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } if (t0 > tn) tn = t0; if (t1 < tf) tf = t1; if (tn > tf) continue; }
    o = eye.z; v = vz;
    if (v > -1e-9 && v < 1e-9) { if (o < z0 || o > z1) continue; }
    else { let t0 = (z0 - o) / v, t1 = (z1 - o) / v; if (t0 > t1) { const q = t0; t0 = t1; t1 = q; } if (t0 > tn) tn = t0; if (t1 < tf) tf = t1; if (tn > tf) continue; }
    if (tn >= bestT) continue;
    // OB-088: a prop with collider shapes picks on the shapes themselves (oriented boxes), not their union AABB (a rotated,
    // many-piece wreck made a box far bigger than the object). The AABB above is only the broadphase.
    let ccx = (x0 + x1) * 0.5, ccy = (y0 + y1) * 0.5, ccz = (z0 + z1) * 0.5;
    const shapes = pk ? rec.pickShapes : null;
    if (shapes) {
      let best = -1;
      for (let k = 0; k < shapes.length; k++) {
        const sh = shapes[k], t = shapeEntry(sh, eye.x, eye.y, eye.z, vx, vy, vz, pad, maxT);
        if (t >= 0 && (best < 0 || t < best)) { best = t; ccx = sh.cx; ccy = sh.cy; ccz = sh.cz; }
      }
      if (best < 0 || best >= bestT) continue;
      tn = best;
    }
    // OB-084: the eye INSIDE the (padded) box hits in every direction -> only when the box centre is within INSIDE_CONE of the crosshair
    if (tn === 0) {
      const cx = ccx - eye.x, cy = ccy - eye.y, cz = ccz - eye.z;
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
      if (cl > 1e-6 && (cx * vx + cy * vy + cz * vz) / cl < INSIDE_COS) continue;
    }

    if (tn > LOS_BACKOFF) {
      const tl = tn - LOS_BACKOFF;
      if (!hasLineOfSight(world, eye.x, eye.y, eye.z, eye.x + vx * tl, eye.y + vy * tl, eye.z + vz * tl)) continue;
    }
    bestT = tn;
    bestIdx = i;
  }

  if (bestIdx === -1) {
    out.targetKey = null;
    out.prompt = '';
    out.dist = 0;
    out.angleDeg = 0;
  } else {
    const rec = list[bestIdx];
    const dx = rec.x - eye.x, dy = rec.y - eye.y, dz = rec.z - eye.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let cosA = dist < 1e-9 ? 1 : (dx * vx + dy * vy + dz * vz) / dist;
    if (cosA > 1) cosA = 1; else if (cosA < -1) cosA = -1;
    out.targetKey = rec.key;
    out.prompt = rec.prompt;
    out.dist = dist;
    out.angleDeg = Math.acos(cosA) * 180 / Math.PI;
  }
  return out;
}

const INTERACT_CFG = { reach: DEFAULT_REACH }; // reused (rule 9)

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
