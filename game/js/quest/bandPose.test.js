// MAP-13: band at any pose for load / travel / respawn (fake world), polygon fallback to the relay, ?grid=1 variant. Run: node game/js/quest/bandPose.test.js
import assert from 'node:assert/strict';
import { ensureBand, bandReady, placeLoaded, outsidePolygon, gridEnabled, gridVariant, GRID_DEF } from './bandPose.js';
import { createTravel } from './travel.js';

const poly = { shape: 'polygon', pts: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] };
// fake world: zone = floor(x/512); ensureBandFor is synchronous and leaves no pending bake
const fake = () => { const w = { terrainBands: [{}, {}], _bandPend: -1, get bandPending() { return this._bandPend; }, bounds: poly, cur: 0, calls: [], ensureBandFor(x, y) { this.calls.push([x, y]); this.cur = Math.floor(x / 512); } }; return w; };

{ const w = fake(); const p = { x: 900, y: 40, z: 5, yawDeg: 0 };
  assert.equal(ensureBand(w, p), p); assert.deepEqual(w.calls, [[900, 40]]); assert.equal(w.cur, 1);
  assert.equal(ensureBand({}, p), p); assert.equal(ensureBand(w, null), null); assert.equal(w.calls.length, 1); }
{ const w = fake(); assert.equal(bandReady(w), true); w._bandPend = 1; assert.equal(bandReady(w), false); assert.equal(bandReady({}), true); assert.equal(bandReady(null), true); }
{ // load: a saved pose anywhere inside loads at that pose and its band
  const w = fake(), t = { x: 950, y: 500, z: 1, yawDeg: 3 };
  assert.equal(placeLoaded(w, t, () => ({ x: 10, y: 10, z: 0, yawDeg: 0 })), false); assert.deepEqual([t.x, t.y], [950, 500]); assert.equal(w.cur, 1); }
{ // load: outside the polygon -> the last woken relay, band for the relay
  const w = fake(), t = { x: 5000, y: 500, z: 1, yawDeg: 3 };
  assert.equal(outsidePolygon(w, 5000, 500), true);
  assert.equal(placeLoaded(w, t, () => ({ x: 40, y: 60, z: 7, yawDeg: 90 })), true);
  assert.deepEqual([t.x, t.y, t.z, t.yawDeg], [40, 60, 7, 90]); assert.deepEqual(w.calls, [[40, 60]]); assert.equal(w.cur, 0);
  const t2 = { x: -9, y: 5, z: 1, yawDeg: 0 }; assert.equal(placeLoaded(fake(), t2, () => null), false); } // no relay: pose kept
{ const w = fake(); delete w.bounds; assert.equal(outsidePolygon(w, 1e9, 1e9), false); w.bounds = { shape: 'union', parts: [] }; assert.equal(outsidePolygon(w, 1e9, 1e9), false); }
{ // travel to a far zone: teleport ensures the band, fade-in waits while the band is pending, then proceeds
  const w = fake(), log = [];
  const tr = createTravel({ canTravel: () => true, anchorOf: () => ({ x: 950, y: 900, z: 2, yawDeg: 0 }), playerPos: () => ({ x: 10, y: 10, z: 0 }),
    teleport: (pose) => { ensureBand(w, pose); w._bandPend = 1; log.push('tp'); }, bandReady: () => bandReady(w), arrive: () => log.push('arrive') });
  tr.request('b'); for (let i = 0; i < 60; i++) tr.step(0.05);
  assert.deepEqual(log, ['tp', 'arrive']); assert.equal(w.cur, 1);
  assert.equal(tr.phase, 'in'); w._bandPend = -1; for (let i = 0; i < 60; i++) tr.step(0.05); assert.equal(tr.phase, 'idle'); }
{ // variant: grid replaces bands, polygon replaces the capsule bounds, input untouched; flag default OFF
  const def = Object.freeze({ name: 'x', terrainBands: [{ id: 'east' }], bounds: { shape: 'union', parts: [] } });
  const geo = { bounds: poly }, v = gridVariant(def, geo);
  assert.equal(v.terrainBands, undefined); assert.deepEqual(v.terrainGrid, GRID_DEF); assert.equal(v.bounds.shape, 'polygon'); assert.notEqual(v.bounds.pts, poly.pts);
  assert.equal(def.terrainBands.length, 1); assert.equal(gridVariant(def, null).bounds.shape, 'union');
  assert.equal(gridEnabled(new URLSearchParams('')), false); assert.equal(gridEnabled(new URLSearchParams('grid=1')), true); }
console.log('bandPose: ok');
