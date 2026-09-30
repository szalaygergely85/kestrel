// engine/nav/NavGrid.test.js (RE-05, docs/architecture.md 28.2). No world
// import (leaf-module rule) - fixtures fake the duck-typed `world.terrain`
// shape by hand. Run: node engine/nav/NavGrid.test.js
import { NavGrid } from './NavGrid.js';
import { pathCrossesRect } from './astar.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- cell <-> world round trip, including a negative origin ---------------
{
  for (const [x0, y0, cell] of [[0, 0, 1], [-50, -30, 1], [-12.5, 7.5, 2]]) {
    const grid = new NavGrid({ x0, y0, w: 10, h: 10, cell });
    for (const [x, y] of [[x0 + 0.1, y0 + 0.1], [x0 + 3.7 * cell, y0 + 6.2 * cell], [x0 + 9.9 * cell, y0 + 9.9 * cell]]) {
      const cx = grid.cellX(x);
      const cy = grid.cellY(y);
      const centerX = grid.cellCenterX(cx);
      const centerY = grid.cellCenterY(cy);
      const okX = Math.abs(x - centerX) <= cell / 2 + 1e-9;
      const okY = Math.abs(y - centerY) <= cell / 2 + 1e-9;
      ok(`round trip x (x0=${x0},cell=${cell}) x=${x}`, okX, `cx=${cx} center=${centerX}`);
      ok(`round trip y (y0=${y0},cell=${cell}) y=${y}`, okY, `cy=${cy} center=${centerY}`);
    }
  }
}

// ---- buildFromArrays: slope/type/mask drive walkability, from opts --------
{
  const w = 4, h = 1, n = w * h;
  const height = new Float32Array(n);
  const slopeOk = new Uint8Array([1, 0, 1, 1]); // cell 1 too steep
  const type = new Uint8Array([0, 0, 1, 0]); // 0=grass, 1=water
  const grid = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  grid.buildFromArrays(height, slopeOk, type, {
    typeNames: ['grass', 'water'],
    blockedTypes: ['water'],
    typeCost: { grass: 1, water: 99 },
  });
  ok('cell 0 (grass, flat) walkable cost 1', grid.cost[0] === 1, `cost=${grid.cost[0]}`);
  ok('cell 1 (too steep) unwalkable', grid.cost[1] === 0, `cost=${grid.cost[1]}`);
  ok('cell 2 (water) unwalkable regardless of slope', grid.cost[2] === 0, `cost=${grid.cost[2]}`);
  ok('cell 3 (grass, flat) walkable cost 1', grid.cost[3] === 1, `cost=${grid.cost[3]}`);
  ok('minCost is the smallest non-zero cost', grid.minCost === 1, `minCost=${grid.minCost}`);

  // A different opts.maxSlopeDeg-equivalent (the caller's own slopeOk) must
  // change the result (AC 3: no literal threshold baked into NavGrid).
  const grid2 = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  const slopeOkAllPass = new Uint8Array([1, 1, 1, 1]);
  grid2.buildFromArrays(height, slopeOkAllPass, type, {
    typeNames: ['grass', 'water'], blockedTypes: ['water'], typeCost: { grass: 1, water: 99 },
  });
  ok('AC3: relaxing the slope test (caller-driven) changes walkability', grid2.cost[1] === 1, `cost=${grid2.cost[1]}`);

  // mask overrides everything.
  const grid3 = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  grid3.buildFromArrays(height, slopeOkAllPass, type, {
    typeNames: ['grass', 'water'], blockedTypes: ['water'], typeCost: { grass: 1, water: 99 },
    mask: new Uint8Array([0, 1, 0, 0]),
  });
  ok('mask blocks a cell that would otherwise be walkable', grid3.cost[1] === 0, `cost=${grid3.cost[1]}`);
  ok('mask does not affect other cells', grid3.cost[0] === 1 && grid3.cost[3] === 1);

  // typeCost multiplier carried through for a walkable non-default type.
  const grid4 = new NavGrid({ x0: 0, y0: 0, w, h, cell: 1 });
  const typeForest = new Uint8Array([0, 2, 0, 0]);
  grid4.buildFromArrays(height, slopeOkAllPass, typeForest, {
    typeNames: ['grass', 'water', 'forest'], blockedTypes: ['water'], typeCost: { grass: 1, forest: 3 },
  });
  ok('typeCost multiplier applied (forest=3)', grid4.terrainCost[1] === 3, `terrainCost=${grid4.terrainCost[1]}`);
  ok('minCost picks the smaller of the two costs present', grid4.minCost === 1, `minCost=${grid4.minCost}`);
}

// ---- buildFromWorld: fake world, slope/type/structure/mask all from opts --
{
  function fakeWorld({ heightFn, normalZFn, typeFn, structureFn }) {
    return {
      terrain: {
        heightAt: (x, y) => heightFn(x, y),
        normalAt: (x, y, out) => { out.x = 0; out.y = 0; out.z = normalZFn(x, y); },
        typeAt: (x, y) => typeFn(x, y),
        typeName: (id) => (id === 1 ? 'water' : 'grass'),
      },
      structureAt: structureFn || (() => false),
    };
  }

  // A 3x1 strip: cell 0 flat grass, cell 1 steep grass (normal.z low), cell 2 flat water.
  const world = fakeWorld({
    heightFn: () => 0,
    normalZFn: (x) => (Math.floor(x) === 1 ? 0.5 : 1), // cos(60deg)=0.5 -> "steep" at x in [1,2)
    typeFn: (x) => (Math.floor(x) === 2 ? 1 : 0),
  });
  const grid = new NavGrid({ x0: 0, y0: 0, w: 3, h: 1, cell: 1 });
  grid.buildFromWorld(world, { maxSlopeDeg: 30, blockedTypes: ['water'], typeCost: { grass: 1 } });
  ok('flat grass cell walkable', grid.cost[0] === 1, `cost=${grid.cost[0]}`);
  ok('steep cell (normal.z=0.5 < cos(30deg)) unwalkable at maxSlopeDeg=30', grid.cost[1] === 0, `cost=${grid.cost[1]}`);
  ok('water cell unwalkable', grid.cost[2] === 0, `cost=${grid.cost[2]}`);

  // AC 3: raising maxSlopeDeg past 60 makes the same normal.z=0.5 cell walkable.
  const grid2 = new NavGrid({ x0: 0, y0: 0, w: 3, h: 1, cell: 1 });
  grid2.buildFromWorld(world, { maxSlopeDeg: 61, blockedTypes: ['water'], typeCost: { grass: 1 } });
  ok('AC3: maxSlopeDeg from opts changes the outcome for the same terrain', grid2.cost[1] === 1, `cost=${grid2.cost[1]}`);

  // Structures block regardless of slope/type.
  const world2 = fakeWorld({
    heightFn: () => 0, normalZFn: () => 1, typeFn: () => 0,
    structureFn: (x) => Math.floor(x) === 1,
  });
  const grid3 = new NavGrid({ x0: 0, y0: 0, w: 3, h: 1, cell: 1 });
  grid3.buildFromWorld(world2, { typeCost: { grass: 1 } });
  ok('structureAt blocks a cell', grid3.cost[1] === 0, `cost=${grid3.cost[1]}`);
  ok('structure does not affect neighbours', grid3.cost[0] === 1 && grid3.cost[2] === 1);

  // opts.mask blocks in buildFromWorld too.
  const world3 = fakeWorld({ heightFn: () => 0, normalZFn: () => 1, typeFn: () => 0 });
  const grid4 = new NavGrid({ x0: 0, y0: 0, w: 3, h: 1, cell: 1 });
  grid4.buildFromWorld(world3, { typeCost: { grass: 1 }, mask: new Uint8Array([0, 1, 0]) });
  ok('opts.mask blocks in buildFromWorld', grid4.cost[1] === 0, `cost=${grid4.cost[1]}`);

  // height array captured (info only).
  const world4 = fakeWorld({ heightFn: (x) => x * 2, normalZFn: () => 1, typeFn: () => 0 });
  const grid5 = new NavGrid({ x0: 0, y0: 0, w: 3, h: 1, cell: 1 });
  grid5.buildFromWorld(world4, { typeCost: { grass: 1 } });
  ok('height array captures terrain.heightAt at the cell centre', Math.abs(grid5.height[1] - 3) < 1e-6, `height[1]=${grid5.height[1]}`);
}

// ---- blockCount is present (RE-10 layout) and cost = terrainCost when 0 ---
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 2, h: 2, cell: 1 });
  ok('blockCount array allocated', grid.blockCount instanceof Uint16Array && grid.blockCount.length === 4);
  ok('blockCount starts at 0 everywhere', grid.blockCount.every((c) => c === 0));
  grid.terrainCost.set([1, 2, 3, 4]);
  grid._recomputeCost();
  ok('cost mirrors terrainCost when blockCount is 0', grid.cost.join(',') === '1,2,3,4', grid.cost.join(','));
}

// ---- RE-10: block/unblock restore cost/blockCount byte-equal -------------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 5, h: 5, cell: 1 });
  grid.terrainCost.fill(1);
  grid.terrainCost[12] = 3; // centre cell, distinct cost
  grid._recomputeCost();
  const costBefore = grid.cost.slice();
  const blockCountBefore = grid.blockCount.slice();
  const versionBefore = grid.version;

  grid.block(1, 1, 1, 4, 4);
  ok('block sets cost 0 in the rect', grid.cost[12] === 0 && grid.cost[6] === 0);
  ok('block increments blockCount in the rect', grid.blockCount[12] === 1);
  ok('block leaves cells outside the rect untouched', grid.cost[0] === 1 && grid.blockCount[0] === 0);
  ok('block bumps version by exactly 1', grid.version === versionBefore + 1, `version=${grid.version}`);

  grid.unblock(1);
  ok('unblock restores cost byte-equal', grid.cost.join(',') === costBefore.join(','), grid.cost.join(','));
  ok('unblock restores blockCount byte-equal', grid.blockCount.join(',') === blockCountBefore.join(','), grid.blockCount.join(','));
  ok('unblock restores minCost', grid.minCost === 1, `minCost=${grid.minCost}`);

  let threw = false;
  try { grid.unblock(1); } catch (e) { threw = true; }
  ok('unblock on a non-blocked owner throws', threw);
}

// ---- RE-10: overlapping footprints -----------------------------------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 4, h: 1, cell: 1 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();

  grid.block(1, 0, 0, 2, 1); // covers cells 0,1
  grid.block(2, 1, 0, 3, 1); // covers cells 1,2 (overlaps owner 1 at cell 1)
  ok('overlap: cell 1 has blockCount 2', grid.blockCount[1] === 2, `blockCount[1]=${grid.blockCount[1]}`);
  ok('overlap: cost is 0 while any owner blocks it', grid.cost[1] === 0);

  let threw = false;
  try { grid.block(1, 3, 0, 4, 1); } catch (e) { threw = true; }
  ok('re-blocking an already-blocked owner throws', threw);

  grid.unblock(1); // cell 0 clears, cell 1 still blocked by owner 2
  ok('cell 0 restored after owner 1 unblocks', grid.cost[0] === 1 && grid.blockCount[0] === 0);
  ok('cell 1 still blocked by remaining owner', grid.cost[1] === 0 && grid.blockCount[1] === 1);

  grid.unblock(2);
  ok('all cells restored once every owner unblocks', grid.cost.join(',') === '1,1,1,1', grid.cost.join(','));
}

// ---- RE-10: blockWorldRect covers cells overlapped by > 1e-6 m --------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 5, h: 5, cell: 1 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();

  // Rect exactly [1,3) x [1,3): must cover cells (1,1)..(2,2) only, not
  // the neighbours at x=3/y=3 (zero-width overlap at the boundary).
  grid.blockWorldRect(9, 1, 1, 3, 3);
  ok('blockWorldRect covers the interior cells', grid.cost[grid.index(1, 1)] === 0 && grid.cost[grid.index(2, 2)] === 0);
  ok('blockWorldRect does not pull in a cell touched only at the boundary', grid.cost[grid.index(3, 1)] === 1 && grid.cost[grid.index(1, 3)] === 1);
  grid.unblock(9);
}

// ---- RE-10: masked footprint only blocks flagged cells -----------------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 2, h: 2, cell: 1 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  // 2x2 rect, mask blocks only the diagonal cells (0,0) and (1,1).
  grid.block(1, 0, 0, 2, 2, new Uint8Array([1, 0, 0, 1]));
  ok('masked cell (0,0) blocked', grid.cost[grid.index(0, 0)] === 0);
  ok('masked cell (1,1) blocked', grid.cost[grid.index(1, 1)] === 0);
  ok('unmasked cell (1,0) stays walkable', grid.cost[grid.index(1, 0)] === 1);
  ok('unmasked cell (0,1) stays walkable', grid.cost[grid.index(0, 1)] === 1);
  grid.unblock(1);
  ok('unblocking a masked footprint restores every cell', grid.cost.join(',') === '1,1,1,1');
}

// ---- RE-10: saveBlockers / loadBlockers round trip ----------------------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 6, h: 6, cell: 1 });
  grid.terrainCost.fill(1);
  grid.terrainCost[grid.index(4, 4)] = 5;
  grid._recomputeCost();

  grid.block(20, 0, 0, 2, 2);
  grid.block(3, 3, 3, 5, 5, new Uint8Array([1, 0, 1, 0]));
  grid.block(11, 1, 4, 3, 6);

  const saved = grid.saveBlockers();
  ok('saveBlockers sorts by owner', saved.map((r) => r.owner).join(',') === '3,11,20', saved.map((r) => r.owner).join(','));
  ok('saveBlockers stores the rect', saved[1].rect.join(',') === '1,4,3,6', saved[1].rect.join(','));
  ok('saveBlockers stores the mask when present', Array.isArray(saved[0].mask) && saved[0].mask.join(',') === '1,0,1,0');
  ok('saveBlockers omits mask when the footprint has none', saved[1].mask === undefined);

  const costBefore = grid.cost.slice();
  const blockCountBefore = grid.blockCount.slice();
  grid.loadBlockers(saved);
  ok('loadBlockers restores cost byte-equal', grid.cost.join(',') === costBefore.join(','));
  ok('loadBlockers restores blockCount byte-equal', grid.blockCount.join(',') === blockCountBefore.join(','));

  const saved2 = grid.saveBlockers();
  ok('loadBlockers round trip preserves the owner set', JSON.stringify(saved2) === JSON.stringify(saved));
}

// ---- RE-10: maxBlockers overflow throws ---------------------------------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 10, h: 10, cell: 1, maxBlockers: 2 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  grid.block(1, 0, 0, 1, 1);
  grid.block(2, 1, 0, 2, 1);
  let threw = false;
  try { grid.block(3, 2, 0, 3, 1); } catch (e) { threw = true; }
  ok('block throws once maxBlockers is exceeded', threw);
}

// ---- RE-10: maxFootprintCells overflow throws (masked footprints only) --
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 10, h: 10, cell: 1, maxFootprintCells: 4 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  let threw = false;
  try { grid.block(1, 0, 0, 3, 3, new Uint8Array(9)); } catch (e) { threw = true; }
  ok('block throws when a masked footprint exceeds maxFootprintCells', threw);
}

// ---- RE-10: version + dirty ring ----------------------------------------
{
  const grid = new NavGrid({ x0: 0, y0: 0, w: 5, h: 5, cell: 1 });
  grid.terrainCost.fill(1);
  grid._recomputeCost();
  const v0 = grid.version;
  const out = new Int32Array(32);

  ok('takeDirty(current version) returns 0 (nothing new)', grid.takeDirty(v0, out) === 0);

  grid.block(1, 0, 0, 2, 2);
  const n1 = grid.takeDirty(v0, out);
  ok('takeDirty reports one dirty rect after one block', n1 === 1, `n1=${n1}`);
  ok('dirty rect matches the blocked rect', out[0] === 0 && out[1] === 0 && out[2] === 2 && out[3] === 2);
  const v1 = grid.version;

  grid.block(2, 3, 3, 5, 5);
  grid.unblock(1);
  const n2 = grid.takeDirty(v1, out);
  ok('takeDirty reports both later changes', n2 === 2, `n2=${n2}`);
  ok('dirty rects are oldest first', out[0] === 3 && out[1] === 3 && out[4] === 0 && out[5] === 0);

  // Overflow the ring (size 8) with block/unblock pairs on a fresh owner
  // range so an old watermark can no longer be replayed.
  const grid2 = new NavGrid({ x0: 0, y0: 0, w: 20, h: 20, cell: 1, maxBlockers: 64 });
  grid2.terrainCost.fill(1);
  grid2._recomputeCost();
  const vStart = grid2.version;
  for (let i = 0; i < 10; i++) {
    grid2.block(100 + i, i, 0, i + 1, 1);
    grid2.unblock(100 + i);
  }
  ok('takeDirty returns -1 once the ring has wrapped past the watermark', grid2.takeDirty(vStart, out) === -1);
  ok('takeDirty succeeds for a watermark still covered by the ring', grid2.takeDirty(grid2.version - 1, out) === 1);
}

// ---- RE-10: pathCrossesRect true/false fixtures (astar.js, RE-05) -------
{
  // Straight path along y=0, x = 0..4.
  const path = Int32Array.from([0, 1, 2, 3, 4]);
  const gridStub = { w: 5 };
  ok('pathCrossesRect true when a path cell falls inside the rect',
    pathCrossesRect(path, path.length, gridStub, { cx0: 2, cy0: 0, cx1: 3, cy1: 1 }) === true);
  ok('pathCrossesRect false when the rect is outside every path cell',
    pathCrossesRect(path, path.length, gridStub, { cx0: 0, cy0: 1, cx1: 5, cy1: 2 }) === false);
  ok('pathCrossesRect respects the half-open rect bound (cx1 exclusive)',
    pathCrossesRect(path, path.length, gridStub, { cx0: 4, cy0: 0, cx1: 4, cy1: 1 }) === false);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
