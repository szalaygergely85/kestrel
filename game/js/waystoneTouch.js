// WAYSTONE-TOUCH-01 (lane B1): emits prop:touched {id:'waystone', kind:'waystone', x, y, z} on the gameHooks seam.
// Touch = walking into the stone's radius (re-arms after leaving radius + hysteresis) OR pressing E within reach.
// Lane C's waystone wire (WAYSTONE-01w) listens for it. No new input path: uses the gated interactPressed edge.
export const WAYSTONE_ID = 'waystone';
export const TOUCH_R = 2.5, USE_R = 3, REARM_R = 3.2;

export function createWaystoneTouch(hooks, opts = {}) {
  const touchR2 = (opts.touchR ?? TOUCH_R) ** 2, useR2 = (opts.useR ?? USE_R) ** 2, rearmR2 = (opts.rearmR ?? REARM_R) ** 2;
  const entityId = opts.entityId || 'endMarker';
  // WS1-06a: list-driven. Every entity with components.waystone.kind === 'stone' is a walk-in/E point (relays wake via their
  // own interactable). Fallback for data without the component: the 'endMarker' entity as id 'waystone'.
  let stones = [], c = null;
  const add = (id, tr) => stones.push({ id, tr, inside: false, pos: { x: tr.x, y: tr.y, z: tr.z || 0 } });
  return {
    onBoot(ctx) {
      c = ctx; stones = [];
      const w = ctx.world;
      if (w && w.forEachEntity) w.forEachEntity((e) => {
        const g = e && e.components && e.components.waystone;
        if (g && g.kind === 'stone' && typeof g.id === 'string' && e.transform) add(g.id, e.transform);
      });
      if (!stones.length) {
        const h = w && w.get && w.get(entityId);
        if (h && h.data.transform) add(WAYSTONE_ID, h.data.transform);
      }
    },
    onTick() {
      if (!stones.length || !c || !c.player) return;
      const t = c.player.transform, walkable = !c.state.ending; // never during the ending
      for (let i = 0; i < stones.length; i++) {
        const s = stones[i], dx = t.x - s.tr.x, dy = t.y - s.tr.y, d2 = dx * dx + dy * dy;
        s.pos.x = s.tr.x; s.pos.y = s.tr.y; s.pos.z = s.tr.z || 0;
        if (s.inside) { if (d2 > rearmR2) s.inside = false; }
        else if (d2 <= touchR2 && walkable) { s.inside = true; hooks.emitSimple('prop:touched', s.id, 'waystone', s.pos); return; }
        if (c.state.interactPressed && d2 <= useR2) { hooks.emitSimple('prop:touched', s.id, 'waystone', s.pos); return; }
      }
    },
  };
}
