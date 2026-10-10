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
  const pose = { x: 0, y: 0, z: 0, yawDeg: 0 };
  const lines = [TOAST_SAVED, TOAST_HEALED];

  function put(ui, x, y, code) { if (x >= 0 && x < ui.cols) ui.setCellRGB(x, y, code - 32, FG[0], FG[1], FG[2], BG[0], BG[1], BG[2]); }

  function init() {
    const c = ctx, p = c && c.player;
      if (!p || !p.transform || !p.components || !p.components.health || !c.world || !c.world.state) return;
      const t = p.transform;
      try {
        // Travel points come from entity data (components.waystone); no coordinates here.
        const points = [];
        if (c.world.forEachEntity) c.world.forEachEntity((e) => {
          const w = e && e.components && e.components.waystone;
          if (w && typeof w.id === 'string') points.push({ id: w.id, label: w.label, kind: w.kind, order: w.order });
        });
        sim = createWaystone(c.world, p, {
          waystones: [], points, requestSave: c.requestSave, canWake: opts.canWake,
          spawn: { x: t.x, y: t.y, z: t.z, yawDeg: Number.isFinite(t.yawDeg) ? t.yawDeg : 0 },
        });
      } catch (e) { sim = null; console.error('[waystone] sim init failed:', e && e.message); }
  }
  return {
    get sim() { if (!sim && ctx) init(); return sim; }, // lazy: the player's health component may only exist after the first vitals step
    get toastLeft() { return left; },
    onBoot(c) { ctx = c; sim = null; left = 0; init(); },
    onEvent(name, d) {
      if (name !== 'prop:touched' || !d || !ctx) return;
      if (d.kind !== 'waystone' && d.kind !== 'relay') return;
      // The meadow stone keeps id 'waystone' (no save migration); register it when the data carries no waystone component.
      if (!sim && ctx) init();
      if (!sim) return;
      if (!sim.has(d.id)) { if (d.id !== 'waystone') return; sim.register({ id: 'waystone', label: 'Meadow stone', kind: 'stone', order: 1 }); }
      const t = ctx.player.transform;
      const yaw = Number.isFinite(ctx.state.playerYawDeg) ? ctx.state.playerYawDeg : (t.yawDeg || 0);
      pose.x = t.x; pose.y = t.y; pose.z = t.z; pose.yawDeg = yaw;
      if (sim.touch(d.id, pose)) left = toastSec;
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
