// game/js/rts/sim/navSetup.js - RTS-01a/b nav grid over the hillside (28.8). Load time only (may allocate).
import { NavGrid } from '../../../../engine/index.js';

/** Hillside play area (world_m1 bounds circle: centre 1496.5, 1024.5, r 96). 1 m cells. */
export const PLAY_AREA = { x0: 1400, y0: 928, w: 192, h: 192 };

/**
 * NavGrid over PLAY_AREA: unwalkable = slope > maxSlopeDeg, water, placed structures (the tower footprint,
 * via `world.structureAt`). RTS-01b may add dynamic blockers through `nav.blockWorldRect`.
 * @param {any} world engine World (terrain + structures)
 * @param {{maxSlopeDeg?:number, area?:{x0:number,y0:number,w:number,h:number}}} [opts]
 */
export function buildNavGrid(world, opts = {}) {
  const a = opts.area || PLAY_AREA;
  const nav = new NavGrid({ x0: a.x0, y0: a.y0, w: a.w, h: a.h, cell: 1 });
  nav.buildFromWorld(world, { maxSlopeDeg: opts.maxSlopeDeg ?? 30 });
  return nav;
}
