// engine/nav/NavGrid.test.js (RE-05, docs/architecture.md 28.2). No world
// import (leaf-module rule) - fixtures fake the duck-typed `world.terrain`
// shape by hand. Run: node engine/nav/NavGrid.test.js
import { NavGrid } from './NavGrid.js';
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

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
