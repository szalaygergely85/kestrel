// ENV-01-WIRE: parseDecorMode (garbage -> default), densityQ8For, buildDecorConfig on the real overworld_far recipe shape.
import assert from 'node:assert/strict';
import { parseDecorMode, densityQ8For, buildDecorConfig } from './decorHost.js';
import { DEFAULT_DENSITY_Q8, packDecorLayers } from '../../engine/index.js';

assert.equal(parseDecorMode('cpu', true), false);
assert.equal(parseDecorMode(' CPU ', true), false);
for (const g of [null, undefined, '', 'banana', '1', '0']) assert.equal(parseDecorMode(g, true), false, String(g)); // OB-119: opt-in
assert.equal(parseDecorMode('gpu', true), true);
assert.equal(parseDecorMode(' GPU ', true), true);
for (const g of [null, 'cpu', 'gpu']) assert.equal(parseDecorMode(g, false), false);
assert.equal(densityQ8For(1), DEFAULT_DENSITY_Q8);
assert.equal(densityQ8For(0.5), 128);
assert.equal(densityQ8For(0), 0);
for (const g of [NaN, -1, 2, undefined, 'x']) assert.equal(densityQ8For(g), 256);

const sp = (mesh, w = 1) => ({ mesh, weight: w, maxDistM: 45, grassLike: true });
const cfg = { layers: [
  { name: 'trees', seed: 1, cellM: 3, jitter: 1, drawM: 40, ground: { grass: [sp('t')] } },
  { name: 'reeds', gpu: true, seed: 38417, cellM: 3.5, jitter: 1.4, drawM: 60, ground: { fen: [sp('a', 3), sp('b')], reeds: [sp('a', 3), sp('b')] } },
  { name: 'peb', gpu: true, seed: 5, cellM: 5, jitter: 2, drawM: 40, ground: { sand: [{ mesh: 'p', weight: 1 }] } }] };
const meshes = { a: { id: 'a', radius: 1.5, lods: [{ mesh: 'a1' }] }, a1: { id: 'a1' }, b: { id: 'b' }, p: { id: 'p' } };
const warns = [];
const r = buildDecorConfig(cfg, (id) => meshes[id], { density: 0.5, carpetRadiusM: 12, warn: (m) => warns.push(m) });
assert.deepEqual(r.names, ['reeds', 'peb']);
assert.equal(r.cfg.packed.nLayers, 2);
assert.equal(r.cfg.layers[0].species.length, 2);
assert.equal(r.cfg.layers[0].species[0].meshes[1], meshes.a1);
assert.equal(r.cfg.layers[0].species[1].meshes[1], null);
assert.deepEqual(Array.from(r.cfg.layers[0].fadeCm), [4500, 4500]);
assert.deepEqual(Array.from(r.cfg.layers[1].fadeCm), [4000]); // species without maxDistM = layer drawM
assert.equal(r.cfg.carpetRadiusM, 12);
assert.equal(r.cfg.radiusM, 1.5);
assert.equal(warns.length, 0);
assert.equal(buildDecorConfig({ layers: [cfg.layers[0]] }, () => null), null);
assert.throws(() => buildDecorConfig(cfg, () => null), /unknown mesh/);
// ENV-01c per-species sway + sinkM reach the packed words (same words as packing the expected species directly)
{ const L = (extra) => ({ layers: [{ name: 'x', gpu: true, seed: 3, cellM: 4, jitter: 1, drawM: 40, ground: { g: [{ mesh: 'b', weight: 1, ...extra }, { mesh: 'p', weight: 1 }] } }] });
  const got = buildDecorConfig(L({ sway: true, sinkM: 0.12 }), (id) => meshes[id], {}).cfg.packed.words;
  const sps = (a) => [{ weight: 1, lodM: 40, maxDistM: 40, grassLike: false, scaleMin: 1, scaleMax: 1, ...a }, { weight: 1, lodM: 40, maxDistM: 40, grassLike: false, scaleMin: 1, scaleMax: 1 }];
  const want = (a) => packDecorLayers({ layers: [{ seed: 3, cellM: 4, jitterM: 1, drawM: 40, densityQ8: 256, species: sps(a) }] }).words;
  assert.deepEqual(Array.from(got), Array.from(want({ sway: true, sinkM: 0.12 })));
  const plain = buildDecorConfig(L({}), (id) => meshes[id], {}).cfg.packed.words;
  assert.deepEqual(Array.from(plain), Array.from(want({})));
  assert.notDeepEqual(Array.from(got), Array.from(plain)); }
const diff = JSON.parse(JSON.stringify(cfg)); diff.layers[1].ground.reeds = [sp('b')];
const w2 = []; buildDecorConfig(diff, (id) => meshes[id], { warn: (m) => w2.push(m) });
assert.equal(w2.length, 1);
console.log('decorHost: OK');
