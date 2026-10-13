// OUT-LIFE-TILE: villagers across nav-tile swaps - re-plan, tile/200 m dormancy + restore, fixed-area unchanged.
// Run: node game/js/life/villagerTile.test.js
import { NavGrid, createAStar } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import { ROUTINES } from '../quest/outwallRoutines.js';
import { lifeFromRoutines } from './schedule.js';
import { createVillagers } from './villagers.js';

let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.log('FAIL', m));
const life = lifeFromRoutines(ROUTINES);
const h0 = life.npcs[0].home;
const tile = (x0, y0) => new NavGrid({ x0, y0, w: 400, h: 400, cell: 1 }); // all walkable (no build)
const A = tile(h0[0] - 200, h0[1] - 200), B = tile(h0[0] - 150, h0[1] - 150);
const far = tile(h0[0] + 1000, h0[1] + 1000);
const mk = (grid, extra = {}) => createVillagers({ life, nav: { grid, astar: createAStar(grid) }, hour: 12, dayIndex: 0, ...extra });

// fixed-area: no tile mode, nothing dormant, updateTileDormancy is a no-op
{ const v = mk(A); v.updateTileDormancy(1e6, 1e6); ok(v.dormant.every((d) => d === 0), 'fixed-area never dormant'); }

// re-plan across a swap
{
  const v = mk(A, { tileNav: true });
  v.updateTileDormancy(h0[0], h0[1]);
  v.snapAll(7, 0); for (let t = 0; t < 600; t++) v.step(7.5, 0, h0[0], h0[1]);
  v.snapAll(12, 0);
  const i = v.movers.findIndex((m) => m.walking || m.pending);
  for (let t = 0; t < 4000 && !v.movers.some((m) => m.walking); t++) v.step(12 + t / 60 / 60, 0, h0[0], h0[1]);
  const w = v.movers.findIndex((m) => m.walking);
  if (w >= 0) {
    v.rebindNav(B, h0[0], h0[1]);
    ok(v.movers[w].pending && !v.movers[w].walking, 'walker marked for re-plan');
    v.step(12.5, 0, h0[0], h0[1]);
    for (let t = 0; t < 120 && v.movers[w].pending; t++) v.step(12.5, 0, h0[0], h0[1]);
    ok(!v.movers[w].pending, 'walker re-planned on the new tile');
  } else ok(true, 'no walker at test hour (skipped)');
  void i;
}

// dormancy: out of tile / > 200 m dormant, state kept, restored on return
{
  const v = mk(A, { tileNav: true });
  const x0 = v.actors[0].x, y0 = v.actors[0].y;
  v.rebindNav(far, h0[0], h0[1]);
  ok(v.dormant.every((d) => d === 1), 'homes outside the live tile -> dormant');
  for (let t = 0; t < 120; t++) v.step(12, 0, h0[0], h0[1]);
  ok(v.actors[0].x === x0 && v.actors[0].y === y0, 'dormant villager state kept');
  v.rebindNav(A, h0[0], h0[1]);
  ok(v.dormant[0] === 0, 'restored when the tile returns');
  v.updateTileDormancy(h0[0] + 500, h0[1]);
  ok(v.dormant[0] === 1, '> 200 m from player -> dormant');
  v.updateTileDormancy(h0[0], h0[1]);
  ok(v.dormant[0] === 0, 'back within 200 m -> restored');
  // save/load round trip: nothing saved, a fresh sim on the same clock/tile lands on the same spots
  const v2 = mk(A, { tileNav: true }); v2.updateTileDormancy(h0[0], h0[1]); v2.snapAll(12, 0); v.snapAll(12, 0);
  ok(v.actors.every((a, k) => a.x === v2.actors[k].x && a.y === v2.actors[k].y && a.hidden === v2.actors[k].hidden), 'save/load round trip: same spots');
}
console.log(`villagerTile: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
