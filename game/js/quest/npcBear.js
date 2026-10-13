// game/js/quest/npcBear.js (NPC-BEAR-01, architecture.md 38.28). Turn-to-player for talking NPCs (Burl the bear).
// A calm wild bear (BEAR-FOLLOW-01): he does NOT track a passing player. He turns toward the player only while talking
// or when the player is within NEAR_M and standing still (speed < STILL_MPS); once neither holds he keeps the facing for
// RETURN_DELAY_S, then eases back to his home yaw. Presentation only: writes transform.yawDeg, never x/y/z.
// Zero allocation per step (one state object per NPC, made at bind time).
import { yawFromDelta } from '../../../engine/index.js';

export const NEAR_M = 2.5;
export const STILL_MPS = 0.5;
export const MAX_DEG_S = 120;
export const RETURN_DELAY_S = 2.0;

const wrap180 = (d) => { d %= 360; return d > 180 ? d - 360 : d <= -180 ? d + 360 : d; };

/**
 * @param {{get:(id:string)=>any}} world
 * @param {string} id NPC entity id
 * @returns {{step:(dt:number, px:number, py:number, talking?:boolean)=>void, homeYaw:number, mode:number, paused:boolean}|null} null when the entity is missing
 */
export function createNpcTurn(world, id) {
  const h = world.get(id), t = h && h.data && h.data.transform;
  if (!t) return null;
  let lpx = NaN, lpy = NaN;
  const st = {
    homeYaw: t.yawDeg || 0,
    mode: 0,       // 0 = home/idle, 1 = facing the player
    holdT: 0,      // seconds since the facing condition last held
    paused: false, // CH1-07: set while Burl walks (npcWalk owns the yaw); the home yaw follows where he ends up
    step(dt, px, py, talking) {
      if (st.paused) { st.mode = 0; st.holdT = 0; lpx = px; lpy = py; st.homeYaw = t.yawDeg || 0; return; }
      const dx = px - t.x, dy = py - t.y, d2 = dx * dx + dy * dy;
      const mx = px - lpx, my = py - lpy; lpx = px; lpy = py;
      const still = !(mx * mx + my * my > (STILL_MPS * dt) * (STILL_MPS * dt)); // NaN on the first step counts as still
      if (talking || (d2 <= NEAR_M * NEAR_M && still)) { st.mode = 1; st.holdT = 0; }
      else if (st.mode === 1) { st.holdT += dt; if (st.holdT >= RETURN_DELAY_S) st.mode = 0; }
      const cur = t.yawDeg || 0;
      // facing: follow the player while the condition holds, hold the yaw during the return delay
      const target = st.mode === 0 ? st.homeYaw : st.holdT > 0 || d2 < 1e-6 ? cur : yawFromDelta(dx, dy);
      const err = wrap180(target - cur);
      const maxStep = MAX_DEG_S * dt;
      t.yawDeg = wrap180(cur + (err > maxStep ? maxStep : err < -maxStep ? -maxStep : err));
    },
  };
  return st;
}
