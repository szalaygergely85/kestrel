// WAYSTONE-01w (D-050 seam): wires the shipped waystone sim (quest/sim/waystone.js) onto gameHooks.
// prop:touched {id:'waystone'} -> sim.touch = heal + ONE requestSave + two HUD toast lines; onRespawn -> the touched stone's anchor.
// No coordinates here: the anchor is the player's pose at the touch (a known-safe spot beside the stone), the initial
// spawn fallback is the pose at boot (the wake spawn). Before any touch onRespawn returns null = today's spawn/save point.
// OWNER: anchors A/B pending (A = keep today's wake spawn and boars; nothing here depends on the choice).
// Toast text: docs/story.md `toast.waystone.saved` / `toast.waystone.healed`. Per step: no allocation.
import { createWaystone } from '../sim/waystone.js';

export const TOAST_SAVED = 'Saved. The stone will remember.';
export const TOAST_HEALED = 'Warmth in the hands. Hearts full.';
export const TOAST_SEC = 3.5;
const FG = [236, 226, 190], BG = [10, 11, 16];

export function createWaystoneWire(opts = {}) {
  const toastSec = opts.toastSec ?? TOAST_SEC;
  let ctx = null, sim = null, left = 0;
  const lines = [TOAST_SAVED, TOAST_HEALED];

  function put(ui, x, y, code) { if (x >= 0 && x < ui.cols) ui.setCellRGB(x, y, code - 32, FG[0], FG[1], FG[2], BG[0], BG[1], BG[2]); }

  return {
    get sim() { return sim; },
    get toastLeft() { return left; },
    onBoot(c) {
      ctx = c; sim = null; left = 0;
      const p = c.player;
      if (!p || !p.transform || !p.components || !p.components.health || !c.world || !c.world.state) return;
      const t = p.transform;
      try {
        sim = createWaystone(c.world, p, {
          waystones: [], requestSave: c.requestSave,
          spawn: { x: t.x, y: t.y, z: t.z, yawDeg: Number.isFinite(t.yawDeg) ? t.yawDeg : 0 },
        });
      } catch (e) { sim = null; }
    },
    onEvent(name, d) {
      if (name !== 'prop:touched' || !d || d.id !== 'waystone' || !ctx || !sim) return;
      const t = ctx.player.transform;
      const yaw = Number.isFinite(ctx.state.playerYawDeg) ? ctx.state.playerYawDeg : (t.yawDeg || 0);
      // Touch happens once per walk-in (the seam re-arms only after leaving), so building the 1-point sim here is a one-off.
      const touch = createWaystone(ctx.world, ctx.player, {
        waystones: [{ id: 'waystone', pos: { x: t.x, y: t.y, z: t.z, yawDeg: yaw } }],
        spawn: sim.snapshot().pos, requestSave: ctx.requestSave,
      });
      if (touch.touch('waystone')) { sim = touch; left = toastSec; }
    },
    onTick(dt) { if (left > 0) left -= dt; },
    drawHud(ui) {
      if (left <= 0) return;
      for (let i = 0; i < 2; i++) {
        const s = lines[i], y = 3 + i;
        for (let j = -1; j <= s.length; j++) put(ui, 2 + j, y, 32);
        for (let j = 0; j < s.length; j++) put(ui, 2 + j, y, s.charCodeAt(j));
      }
    },
    onRespawn() { return sim && sim.snapshot().waystoneId ? sim.onDeath() : null; },
  };
}
