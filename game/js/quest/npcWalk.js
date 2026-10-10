// game/js/quest/npcWalk.js (CH1-07, architecture.md 38.37 item 5). Generic walking NPC (Burl's escort/departure, Fen's entrance).
// Polylines are authored in world data: entity.components.walks = { name: [[x,y],...] } and optional
// components.walkBarks = { name: { "<wpIndex>": "<barkId>" } }. Movement = engine createPathFollower; z from terrain.groundAt;
// clip walk/idle; the kinematic collider follows via world.setEntityCollider. Zero allocation per step (start() allocates).
import { createPathFollower, yawFromDelta } from '../../../engine/index.js';

export const WAIT_FAR_M = 10, RESUME_NEAR_M = 6, BARK_NEAR_M = 8, WALK_SPEED = 1.6, TURN_DEG_S = 240;
const HIDE_Z = -500; // parked collider depth (no setEntityCollider "remove" exists)

/**
 * @param {object} world World-like: get(id) -> {data:{transform,components}}, terrain.groundAt, setEntityCollider
 * @param {string} id
 * @param {{barks?:{play:(id:string,who?:any)=>boolean}, removeInteractable?:(id:string)=>void, emit?:(n:string,a?:any)=>void}} [ctx]
 */
export function createNpcWalk(world, id, ctx = {}) {
  const h = world.get(id), d = h && h.data;
  if (!d || !d.transform) return null;
  const t = d.transform, comps = d.components || {}, v = comps.voxel || null;
  let f = null, pts = null, name = '', opts = null;
  let barkIdx = null, barkIds = null, barkDone = null; // parallel arrays, filled at start()
  const api = {
    active: false, done: false, waiting: false, hidden: false,
    get wp() { return f ? f.seg : 0; },
    get walking() { return api.active && !api.waiting; },
    /** Begins walking `walkName`. opts: lead, waitFar, resumeNear, speed, fromWp, hideAtEnd, onArrive(), barks {idx:id}. */
    start(walkName, o = {}) {
      const poly = comps.walks && comps.walks[walkName];
      if (!poly || poly.length < 2) return false;
      pts = new Float64Array(poly.length * 2);
      for (let i = 0; i < poly.length; i++) { pts[i * 2] = poly[i][0]; pts[i * 2 + 1] = poly[i][1]; }
      name = walkName; opts = o;
      f = createPathFollower(pts, { speed: o.speed || WALK_SPEED, arriveR: 0.4, turnRate: 180,
        waitFar: o.lead ? (o.waitFar || WAIT_FAR_M) : Infinity, resumeNear: o.lead ? (o.resumeNear || RESUME_NEAR_M) : Infinity });
      f.reset(o.fromWp | 0);
      const bm = o.barks || (comps.walkBarks && comps.walkBarks[walkName]) || null;
      barkIdx = []; barkIds = []; barkDone = [];
      if (bm) for (const k of Object.keys(bm)) { barkIdx.push(+k); barkIds.push(bm[k]); barkDone.push(+k <= f.seg); } // already-passed barks never replay
      const nx = pts[(f.seg + (f.done ? 0 : 1)) * 2], ny = pts[(f.seg + (f.done ? 0 : 1)) * 2 + 1];
      if (!f.done) f.yawDeg = yawFromDelta(nx - f.x, ny - f.y);
      api.active = !f.done; api.done = f.done; api.waiting = false; api.hidden = false;
      place();
      if (f.done) finish();
      return true;
    },
    /** Puts the NPC on waypoint `wp` (default last) of `walkName` without walking. */
    place(walkName, wp) {
      const poly = comps.walks && comps.walks[walkName];
      if (!poly) return false;
      const k = wp == null || wp >= poly.length ? poly.length - 1 : wp | 0;
      t.x = poly[k][0]; t.y = poly[k][1];
      if (k > 0) t.yawDeg = yawFromDelta(poly[k][0] - poly[k - 1][0], poly[k][1] - poly[k - 1][1]);
      snap(); api.active = false; api.done = true; api.waiting = false;
      if (v) { v.anim = 'idle'; v.hidden = false; }
      return true;
    },
    /** Gone: hidden, collider parked, no interactable. */
    hide() { api.active = false; api.done = true; api.waiting = false; hideNow(); },
    /** Fixed step. (px,py) = the player. */
    step(dt, px, py) {
      if (!api.active) return;
      const lead = opts.lead;
      const moved = f.step(dt, 1, lead ? px : NaN, lead ? py : NaN);
      api.waiting = f.waiting;
      if (moved) {
        t.x = f.x; t.y = f.y; t.yawDeg = f.yawDeg; snap();
      } else if (f.waiting) { // stopped for the player: turn toward them
        const want = yawFromDelta(px - t.x, py - t.y);
        let diff = want - t.yawDeg; diff -= 360 * Math.round(diff / 360);
        const m = TURN_DEG_S * dt;
        t.yawDeg += diff > m ? m : diff < -m ? -m : diff;
      }
      if (v) { const a = moved ? 'walk' : 'idle'; if (v.anim !== a) v.anim = a; }
      // barks: when waypoint idx is reached and the player is near; kept pending until the player is near
      for (let i = 0; i < barkIdx.length; i++) {
        if (barkDone[i] || f.seg < barkIdx[i]) continue;
        const dx = px - t.x, dy = py - t.y;
        if (dx * dx + dy * dy <= BARK_NEAR_M * BARK_NEAR_M && ctx.barks && ctx.barks.play(barkIds[i], id) !== false) barkDone[i] = true;
      }
      if (f.done) finish();
    },
  };
  function snap() {
    const z = world.terrain ? world.terrain.groundAt(t.x, t.y) : t.z;
    t.z = z;
    if (comps.collider && comps.collider.kinematic) world.setEntityCollider(id, t.x, t.y, z);
  }
  function place() { t.x = f.x; t.y = f.y; t.yawDeg = f.yawDeg; snap(); if (v) { v.hidden = false; v.anim = 'idle'; } }
  function hideNow() {
    api.hidden = true;
    if (v) v.hidden = true;
    if (comps.collider && comps.collider.kinematic) world.setEntityCollider(id, t.x, t.y, HIDE_Z);
    if (ctx.removeInteractable) ctx.removeInteractable(id);
  }
  function finish() {
    api.active = false; api.done = true; api.waiting = false;
    if (v) v.anim = 'idle';
    if (opts.hideAtEnd) hideNow();
    if (opts.onArrive) opts.onArrive(name);
    if (ctx.emit) ctx.emit('npc:walked', { id, walk: name });
  }
  return api;
}
