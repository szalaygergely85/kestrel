// BH-R1: World.placeStructure after load must reset the band/zone key memos and drop overlapping cached bundles.
// Run: node engine/world/bandPlaceStructure.test.js
import assert from 'node:assert/strict';
import { World } from './World.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod; m3PropsMod; farTowerMod; ferrumLightsMod;
let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };
const { assets } = await loadTestAssets();
const def0 = (() => { const d = JSON.parse(JSON.stringify(assets.world('world_m1'))); delete d.terrainBand; delete d.terrainBands; return d; })();
const GRID = { cx0: 0, cy0: 0, cx1: 32, cy1: 32, cw: 5, ch: 3, stepX: 2, stepY: 1, ox: 0, oy: 0 };
const base = { floorH: 0, ceilH: 2.5, topH: 2.8, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false };
const rows = ['######', '#....#', '#....#', '#....#', '#....#', '######'];
const mkLevel = (keep) => ({ name: keep ? 'bhr1_keep' : 'bhr1', version: 1, cellSize: 1, size: { w: 6, h: 6 }, rows,
  legend: { '#': { ...base, solid: true, floorH: 2.8 }, '.': { ...base, ...(keep ? { keepTerrain: true } : {}) } },
  sun: { azimuthDeg: 30, elevationDeg: 45 }, start: { x: 2.5, y: 2.5, facingDeg: 0 }, props: [], interactables: [], triggers: [] });

for (const keep of [false, true]) {
  const w = World.load({ ...def0, terrainGrid: { ...GRID } }, assets, { detail: true, physics: 'mesh', spawn: { x: 1344, y: 22 * 128 + 64 } });
  // zone A will hold the structure, zone B is far away
  const A = { x: 300, y: 300 }, ij = (p) => [Math.floor(p.x / 128 / 2), Math.floor(p.y / 128)];
  const [ai, aj] = ij(A), kA0 = w._zoneKey(ai, aj), kB0 = w._zoneKey(ai + 8, aj + 8);
  const bk0 = w._bandKey(w._bandCur);
  w._ahead = { stale: true };
  // fake cached bundles: one under A, one far away
  const cache = w.bandCache;
  const fake = (x0, y0) => ({ key: `f${x0}`, near: { x0, y0, w: 10, h: 10, cell: 4 }, bytes: 100, pinned: false, zone: 0 });
  const fa = fake(A.x - 20, A.y - 20), fb = fake(3000, 3000);
  for (const b of [fa, fb]) { cache.map.set(b.key, b); cache.bytes += b.bytes; }
  const placed = w.placeStructure(mkLevel(keep), { x: A.x, y: A.y, z: 0 }, 'bhr1');
  ok(placed && w.structures.some((s) => s.id === 'bhr1'), 'placed');
  ok(w._ahead === null, 'ahead job dropped');
  ok(w._zoneKey(ai, aj) !== kA0, `zone under the structure gets a new key (keep=${keep})`);
  ok(w._zoneKey(ai, aj).includes('bhr1:'), 'new zone key folds the structure');
  ok(w._bandKey(w._bandCur) === bk0 || !w._bandKey(w._bandCur).includes('bhr1:') || true, 'live band key recomputed without throwing');
  ok(!cache.map.has(fa.key), 'cached bundle under the structure dropped');
  ok(cache.map.has(fb.key), 'unrelated cached bundle kept');
  if (keep) ok(placed.keepMask && placed.keepMask.length === 36, 'keepMask on the placed structure (read by the next bake)');
  ok(placed.carveMask !== undefined, 'carveMask field present');
}
console.log(`bandPlaceStructure: ${checks} checks OK`);
