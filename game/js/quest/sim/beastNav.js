// game/js/quest/sim/beastNav.js (US-079a, architecture.md 29.1). Load-time only (may allocate) - same shape as
// game/js/rts/sim/navSetup.js, over the content world's `nav` block instead of a hard-coded PLAY_AREA.
import { NavGrid, createAStar } from '../../../../engine/index.js';

/**
 * Builds a NavGrid + A* over `navCfg` (the content world's `nav` block:
 * `{area:{x0,y0,w,h}, cell, maxSlopeDeg, maxStepM, blockedTypes}`) and the real `world` (terrain + structures).
 * @param {any} world engine World
 * @param {{area:{x0:number,y0:number,w:number,h:number}, cell?:number, maxSlopeDeg?:number, maxStepM?:number, blockedTypes?:string[]}} navCfg
 */
export function buildBeastNav(world, navCfg) {
  const a = navCfg.area;
  const grid = new NavGrid({ x0: a.x0, y0: a.y0, w: a.w, h: a.h, cell: navCfg.cell ?? 1 });
  grid.buildFromWorld(world, {
    maxSlopeDeg: navCfg.maxSlopeDeg ?? 30,
    maxStepM: navCfg.maxStepM ?? Infinity,
    blockedTypes: navCfg.blockedTypes ?? ['water'],
  });
  const astar = createAStar(grid);
  return { grid, astar };
}
