// WAYSTONE-TOUCH-01 (lane B1): emits prop:touched {id:'waystone', kind:'waystone', x, y, z} on the gameHooks seam.
// Touch = walking into the stone's radius (re-arms after leaving radius + hysteresis) OR pressing E within reach.
// Lane C's waystone wire (WAYSTONE-01w) listens for it. No new input path: uses the gated interactPressed edge.
export const WAYSTONE_ID = 'waystone';
export const TOUCH_R = 2.5, USE_R = 3, REARM_R = 3.2;

export function createWaystoneTouch(hooks, opts = {}) {
  const touchR2 = (opts.touchR ?? TOUCH_R) ** 2, useR2 = (opts.useR ?? USE_R) ** 2, rearmR2 = (opts.rearmR ?? REARM_R) ** 2;
  const entityId = opts.entityId || 'endMarker';
  let stone = null, inside = false, c = null;
  const pos = { x: 0, y: 0, z: 0 };
  const fire = () => hooks.emitSimple('prop:touched', WAYSTONE_ID, 'waystone', pos);
  return {
    onBoot(ctx) {
      c = ctx;
      const h = ctx.world && ctx.world.get && ctx.world.get(entityId);
      stone = h ? h.data.transform : null; inside = false;
      if (stone) { pos.x = stone.x; pos.y = stone.y; pos.z = stone.z || 0; }
    },
    onTick() {
      if (!stone || !c || !c.player) return;
      const t = c.player.transform, dx = t.x - stone.x, dy = t.y - stone.y, d2 = dx * dx + dy * dy;
      const walkable = !c.state.ending; // never during the ending
      if (inside) { if (d2 > rearmR2) inside = false; }
      else if (d2 <= touchR2 && walkable) { inside = true; fire(); return; }
      if (c.state.interactPressed && d2 <= useR2) fire();
    },
  };
}
