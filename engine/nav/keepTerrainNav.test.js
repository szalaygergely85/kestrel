// UNDER-00b (arch 38.75 item 1c): ground nav stays walkable on keepTerrain cells.
import assert from 'node:assert/strict';
import { AssetRegistry } from '../core/assets.js';
import { World } from '../world/World.js';
import { NavGrid } from './NavGrid.js';

let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };
const base = { floorH: 0, ceilH: 2.5, topH: 2.8, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false };
const rows = ['######', '#....#', '#....#', '#....#', '#....#', '######'];
const def = (keep) => ({ name: 'under', version: 1, cellSize: 1, size: { w: 6, h: 6 }, rows,
  legend: { '#': { ...base, solid: true, floorH: 2.8 }, '.': { ...base, ...(keep ? { keepTerrain: true } : {}) } },
  sun: { azimuthDeg: 30, elevationDeg: 45 }, start: { x: 2.5, y: 2.5, facingDeg: 0 }, props: [], interactables: [], triggers: [] });
const t = { groundAt: (x) => 6 + 0.1 * x, groundNormalAt: (x, y, o) => { o.x = -0.0995; o.y = 0; o.z = 0.995; return o; } };
const mk = (keep) => {
  const w = World.load({ name: 'w', structures: [{ id: 'u', level: 'under', origin: { x: 10, y: 20, z: 0 } }] },
    new AssetRegistry({ palette: { rgb: {} }, levels: { under: def(keep) } }), { physics: 'mesh' });
  w.terrain = t;
  return w;
};
const navOf = (w) => {
  const grid = new NavGrid({ x0: 10, y0: 20, w: 6, h: 6, cell: 1 });
  grid.buildFromWorld({ terrain: { heightAt: (a) => t.groundAt(a), normalAt: (a, b, o) => t.groundNormalAt(a, b, o), typeAt: () => 0, typeName: () => 'grass' },
    structureAt: (a, b) => w.structureAt(a, b), keepTerrainAt: (a, b) => w.keepTerrainAt(a, b) });
  return grid;
};
const nOn = navOf(mk(true)), nOff = navOf(mk(false));
ok(nOff.terrainCost[nOff.index(2, 2)] === 0, 'no flag: structure cell blocked');
ok(nOn.terrainCost[nOn.index(2, 2)] > 0, 'keepTerrain cell walkable');
ok(nOn.terrainCost[nOn.index(0, 0)] === 0, 'unflagged wall cell stays blocked');
console.log(`keepTerrainNav.test: ${checks} checks OK`);
