// WM-05 (38.59 dec. 1, D-076/D-077): world_m1 ships terrainGrid (pins = the 5 authored zones) + ONE simple walk polygon (<= 128 verts) that
// contains the spawn, every ex:1 site, every relay site and the relay line; sea side = coast + 110 m; ?grid=0 = legacy bands. Node only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { outsidePolygon, gridEnabled, legacyVariant, gridVariant, LEGACY_BANDS, GRID_DEF } from './bandPose.js';
import geoMod from '../../../design/levels/world_geo.js';

geoMod;
const geo = globalThis.ASSETS.levels.world_geo;
const def = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));

// shipped def: grid + polygon, no bands, polygon identical to the designer's trace
assert.equal(def.terrainBands, undefined); assert.equal(def.terrainBand, undefined);
assert.deepEqual(def.terrainGrid, GRID_DEF);
assert.equal(def.bounds.shape, 'polygon'); assert.deepEqual(def.bounds.pts, geo.bounds.pts);
assert.ok(def.bounds.pts.length >= 3 && def.bounds.pts.length <= 128, 'verts ' + def.bounds.pts.length);
{ // simple polygon: no two non-adjacent edges intersect (the engine re-validates at World.load: bounds.test / mapBounds.test)
  const P = def.bounds.pts, n = P.length, o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const X = (a, b, c, d) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; assert.ok(!X(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n]), `edges ${i},${j} cross`); }
}

// pins = the 5 authored zones
const G = def.terrainGrid, ni = Math.ceil((G.cx1 - G.cw - G.ox) / G.stepX) + 1;
assert.equal(G.pin.length, 5);
LEGACY_BANDS.forEach((b, k) => { const [i, j] = G.pin[k]; assert.ok(i < ni); assert.deepEqual([Math.min(G.ox + i * G.stepX, G.cx1 - G.cw), Math.min(G.oy + j * G.stepY, G.cy1 - G.ch)], [b.cx0, b.cy0], b.id); });

// containment: spawn, every ex:1 site, every relay site + relay line (the Wall gate point x > 1880 is the killing-ground edge, by design)
const w = { bounds: def.bounds };
const inside = (x, y) => !outsidePolygon(w, x, y);
const pl = def.entities.find((e) => e.type === 'player'), tower = def.structures.find((s) => s.id === 'tower');
assert.ok(inside(tower.origin.x + 17, tower.origin.y + 9.5), 'spawn');
for (const s of geo.sites) if (s.ex === 1 || s.t === 'L') assert.ok(inside(s.x, s.y), `site ${s.n} (${s.x},${s.y})`);
for (const [x, y] of geo.relayLine) if (x <= 1880) assert.ok(inside(x, y), `relayLine ${x},${y}`);
// the polygon is not a wall in front of the sea: coast + 110 m is inside, +130 m is outside; north foot/east edge as designed
const cp = geo.coast.pts; let minOff = 1e9;
for (let k = 0; k < cp.length - 1; k++) { const x = cp[k][0]; if (x < 40 || x > 1860) continue; assert.ok(inside(x, cp[k][1] + 100), `coast+100 @${x}`); assert.ok(!inside(x, cp[k][1] + 175), `coast+175 @${x}`); minOff = Math.min(minOff, 1); }
assert.ok(!inside(1900, 1000) && inside(1870, 1000) && !inside(600, 60) && inside(600, 100));

// legacy ?grid=0 and defaults
assert.equal(gridEnabled(new URLSearchParams('')), true); assert.equal(gridEnabled(new URLSearchParams('grid=0')), false);
assert.equal(gridEnabled(new URLSearchParams('grid=1')), true); assert.equal(gridEnabled(new URLSearchParams('grid=320x120')), true);
const lv = legacyVariant(def);
assert.equal(lv.terrainGrid, undefined); assert.equal(lv.terrainBands.length, 5); assert.equal(lv.bounds.shape, 'union'); assert.equal(lv.bounds.parts.length, 15);
assert.equal(def.terrainGrid.pin.length, 5, 'input untouched');
assert.deepEqual(gridVariant(lv, geo).terrainGrid, GRID_DEF); // round trip: legacy -> grid variant
console.log('worldBounds: ok');
