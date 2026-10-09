// game/js/mapFogHook.js (S8-B1-16 MAP-01d wiring). Feeds the player's position into lane C's coarse
// visited-cell mask (quest/mapFog.js, S8-C-15) every tick through the gameHooks seam (D-050) ONLY -
// mapFog.js/mapCard.js are not touched, same precedent as chestHook.js. Registered once via
// `gameHooks.register(createMapFogHook(bounds))` (main.js); `onBoot` makes a fresh fog instance every
// world load/restart (same lifecycle as saveRelay's handlers()), restoring the save byte stream when
// present/compatible so the explored mask + pencil route survive a save/load round trip.
//
// Save plumbing: no new code in saveRelay.js/saveState.js. `world.state` is serialized/deserialized
// verbatim by the engine's own WorldState (see collectSave -> serialize(world)), exactly like the
// existing `ui.mapCard.dismissed`/`quest.endT` keys - this hook just keeps `world.state['ui.mapFog']`
// (a plain JSON byte array, mapFog.js's own versioned little-endian codec) in sync with the live fog,
// per the ARCH note in docs/lanes/pc-c.md batch 16. A save made before this story (no key, or bytes
// that no longer match the current chart bounds/grid) falls back to a blank mask rather than failing
// the load - `restore()` is atomic and this hook never lets it throw out of `onBoot`.
import { createMapFog } from './quest/mapFog.js';

export const MAP_FOG_SAVE_KEY = 'ui.mapFog';

/**
 * @param {{x0:number,y0:number,x1:number,y1:number}} bounds - MUST equal the baked chart's own
 *   `chart.bounds` (mapCard.js's createChartCard throws on a fog/chart bounds mismatch).
 * @param {{cols?:number, rows?:number}} gridOpts - coarse mask size, mapFog.js defaults (64x64).
 */
export function createMapFogHook(bounds, gridOpts = {}) {
  let fog = null, ctx = null;

  function restoredFog(world) {
    const bytes = world.state[MAP_FOG_SAVE_KEY];
    if (!Array.isArray(bytes)) return null;
    try { return createMapFog(bounds, { ...gridOpts, bytes }); }
    catch (e) { console.warn('[mapFogHook] saved fog mask incompatible, starting blank:', e && e.message); return null; }
  }

  return {
    /** main.js reads this right after `gameHooks.boot(...)` to build the map card's `chartOptions.fog`. */
    get fog() { return fog; },
    onBoot(c) {
      ctx = c;
      fog = restoredFog(ctx.world) || createMapFog(bounds, gridOpts);
      ctx.world.state[MAP_FOG_SAVE_KEY] = Array.from(fog.save()); // field present from the very first save, fresh or restored
    },
    onTick() {
      if (!fog || !ctx || !ctx.player) return;
      const t = ctx.player.transform;
      if (fog.visit(t.x, t.y)) ctx.world.state[MAP_FOG_SAVE_KEY] = Array.from(fog.save());
    },
  };
}
