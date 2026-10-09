// game/js/quest/npcBear.js (NPC-BEAR-01, architecture.md 38.28). Turn-to-player for talking NPCs (Burl the bear).
// Within NEAR_M (horizontal) the NPC eases its yaw toward the player at MAX_DEG_S; beyond FAR_M it waits RETURN_DELAY_S,
// then eases back to its home yaw. Between the two radii it keeps its mode (hysteresis). Presentation only: writes
// transform.yawDeg and nothing else. Zero allocation per step (one state object per NPC, made at bind time).
import { yawFromDelta } from '../../../engine/index.js';

export const NEAR_M = 4.0;
export const FAR_M = 6.0;
export const MAX_DEG_S = 120;
export const RETURN_DELAY_S = 2.0;

const wrap180 = (d) => { d %= 360; return d > 180 ? d - 360 : d <= -180 ? d + 360 : d; };

/**
 * @param {{get:(id:string)=>any}} world
 * @param {string} id NPC entity id
 * @returns {{step:(dt:number, px:number, py:number)=>void, homeYaw:number, mode:number}|null} null when the entity is missing
 */
export function createNpcTurn(world, id) {
  const h = world.get(id), t = h && h.data && h.data.transform;
  if (!t) return null;
  const st = {
    homeYaw: t.yawDeg || 0,
    mode: 0,       // 0 = home/idle, 1 = facing the player
    farT: 0,       // seconds spent beyond FAR_M
    step(dt, px, py) {
      const dx = px - t.x, dy = py - t.y, d2 = dx * dx + dy * dy;
      if (d2 <= NEAR_M * NEAR_M) { st.mode = 1; st.farT = 0; }
      else if (d2 > FAR_M * FAR_M) { if (st.mode === 1) { st.farT += dt; if (st.farT >= RETURN_DELAY_S) st.mode = 0; } }
      else st.farT = 0; // hysteresis band: keep the mode, restart the return delay
      // facing mode tracks the player while within FAR_M; beyond it the NPC holds its yaw until the return delay ends
      const cur = t.yawDeg || 0;
      const target = st.mode === 0 ? st.homeYaw : d2 > FAR_M * FAR_M || d2 < 1e-6 ? cur : yawFromDelta(dx, dy);
      const err = wrap180(target - cur);
      const maxStep = MAX_DEG_S * dt;
      t.yawDeg = wrap180(cur + (err > maxStep ? maxStep : err < -maxStep ? -maxStep : err));
    },
  };
  return st;
}
