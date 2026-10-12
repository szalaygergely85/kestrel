// game/js/quest/nubFollow.js (NUB-01). Nub, Burl's cub: wanders 3-8 m around her, idles (sniff / lookUp / lie), now and then gets
// stuck (stuckWiggle 3-5 s), trots after her when she walks. No dialogue, no collider, no save (respawns near Burl on load).
// Deterministic: fixed step + a seeded mulberry32 (no Math.random). Pure of the DOM; the world is injected.
import { yawFromDelta } from '../../../engine/index.js';

export const NEAR_MIN_M = 3, NEAR_MAX_M = 8, WALK_SPEED = 0.5, TROT_SPEED = 2.0, TURN_DEG_S = 360;
export const STUCK_MIN_S = 60, STUCK_MAX_S = 120, STUCK_DUR_MIN_S = 3, STUCK_DUR_MAX_S = 5, RESPAWN_M = 30;
const IDLES = ['idle', 'sniff', 'lookUp', 'lie']; // 'lie' = lieDown once, lie loop, getUp once
const LIE_DOWN_S = 0.9, GET_UP_S = 0.6;

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * @param {{handle:{data:{transform:object,components:object},play?:(a:string)=>void}, groundAt:(x:number,y:number)=>number,
 *   isWater:(x:number,y:number)=>boolean, burl:{x:()=>number,y:()=>number,walking:()=>boolean,hidden?:()=>boolean}, seed?:number}} o
 */
export function createNubFollow(o) {
  const h = o.handle, t = h.data.transform, v = (h.data.components && h.data.components.voxel) || {};
  const rand = rng(o.seed == null ? 0x4e7562 : o.seed);
  const between = (a, b) => a + (b - a) * rand();
  let mode = 'idle', anim = '', timer = 0, tx = 0, ty = 0, speed = WALK_SPEED, lieStage = 0, stuckIn = between(STUCK_MIN_S, STUCK_MAX_S);
  const setAnim = (a) => { if (a === anim) return; anim = a; if (h.play) h.play(a); else v.anim = a; };
  const water = (x, y) => o.isWater(x, y);
  // the straight line to (x,y) must stay dry (1 m samples)
  function dry(x, y) {
    const dx = x - t.x, dy = y - t.y, n = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 1; i <= n; i++) if (water(t.x + dx * i / n, t.y + dy * i / n)) return false;
    return true;
  }
  function place(x, y) { t.x = x; t.y = y; t.z = o.groundAt(x, y); }
  // a dry spot 3-8 m from Burl (falls back to a ring walk, then to staying put)
  const pickOut = [0, 0]; // review 12d: one reused pair (no array per 60 Hz step)
  function pick(rMin, rMax) {
    const bx = o.burl.x(), by = o.burl.y();
    for (let k = 0; k < 8; k++) {
      const a = rand() * Math.PI * 2, r = between(rMin, rMax), x = bx + Math.cos(a) * r, y = by + Math.sin(a) * r;
      if (!water(x, y) && (k > 5 || dry(x, y))) { pickOut[0] = x; pickOut[1] = y; return pickOut; }
    }
    return null;
  }
  function respawn() {
    const p = pick(NEAR_MIN_M, NEAR_MAX_M + 0.01);
    place(p ? p[0] : o.burl.x() + 1.5, p ? p[1] : o.burl.y()); mode = 'idle'; timer = 1; setAnim('idle');
  }
  function goTo(x, y, sp) { tx = x; ty = y; speed = sp; mode = 'move'; setAnim(sp > WALK_SPEED ? 'trot' : 'walk'); }
  function idle() {
    mode = 'idle'; lieStage = 0;
    const a = IDLES[(rand() * IDLES.length) | 0];
    if (a === 'lie') { mode = 'lie'; lieStage = 1; timer = LIE_DOWN_S; setAnim('lieDown'); return; }
    setAnim(a); timer = between(2.5, 6);
  }
  function turn(dt, yaw) {
    let d = yaw - t.yawDeg; d -= 360 * Math.round(d / 360);
    const m = TURN_DEG_S * dt; t.yawDeg += d > m ? m : d < -m ? -m : d;
  }
  const api = {
    get mode() { return mode; }, get anim() { return anim; },
    /** Fixed step. */
    step(dt) {
      if (o.burl.hidden && o.burl.hidden()) { v.hidden = true; return; }
      if (v.hidden) { v.hidden = false; respawn(); }
      const bx = o.burl.x(), by = o.burl.y(), dxb = bx - t.x, dyb = by - t.y, db = Math.hypot(dxb, dyb);
      if (db > RESPAWN_M) { respawn(); return; }
      stuckIn -= dt;
      if (mode !== 'stuck' && stuckIn <= 0 && !o.burl.walking() && db <= NEAR_MAX_M) { // stuck only while Burl stays put
        mode = 'stuck'; timer = between(STUCK_DUR_MIN_S, STUCK_DUR_MAX_S); setAnim('stuckWiggle'); stuckIn = between(STUCK_MIN_S, STUCK_MAX_S);
      }
      if (mode === 'stuck') { timer -= dt; if (timer <= 0) idle(); return; }
      // Burl on the move or Nub too far: trot back to her
      if ((o.burl.walking() && db > NEAR_MIN_M) || db > NEAR_MAX_M) {
        if (mode === 'lie') lieStage = 0;
        const p = o.burl.walking() ? (pickOut[0] = bx, pickOut[1] = by, pickOut) : pick(NEAR_MIN_M, NEAR_MIN_M + 1.5);
        if (p && (mode !== 'move' || speed !== TROT_SPEED || o.burl.walking())) goTo(p[0], p[1], TROT_SPEED);
      }
      if (mode === 'move') {
        const dx = tx - t.x, dy = ty - t.y, d = Math.hypot(dx, dy);
        if (d < 0.3 || (speed === TROT_SPEED && o.burl.walking() && db <= NEAR_MIN_M)) { idle(); return; }
        const s = Math.min(d, speed * dt), nx = t.x + dx / d * s, ny = t.y + dy / d * s;
        if (water(nx, ny)) { idle(); return; } // never wades
        turn(dt, yawFromDelta(dx, dy)); t.x = nx; t.y = ny; t.z = o.groundAt(nx, ny);
        return;
      }
      timer -= dt;
      if (mode === 'lie') {
        if (lieStage === 1 && timer <= 0) { lieStage = 2; timer = between(5, 10); setAnim('lie'); }
        else if (lieStage === 2 && timer <= 0) { lieStage = 3; timer = GET_UP_S; setAnim('getUp'); }
        else if (lieStage === 3 && timer <= 0) { mode = 'idle'; lieStage = 0; setAnim('idle'); timer = 0.5; }
        return;
      }
      if (timer <= 0) {
        if (rand() < 0.55) { const p = pick(NEAR_MIN_M, NEAR_MAX_M); if (p) { goTo(p[0], p[1], WALK_SPEED); return; } }
        idle();
      }
    },
  };
  respawn();
  return api;
}
