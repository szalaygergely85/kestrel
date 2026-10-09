// engine/render/derivedLights.test.js - EMIS-01b (architecture.md 38.12 (1)).
//   node --expose-gc engine/render/derivedLights.test.js
import { LightSet, MAX_LIGHTS, DERIVED_HYSTERESIS } from './lighting.js';
import { VoxelPool, lightInfo } from './voxelPool.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

const rec = (intensity, radius = 3) => ({ hue: [1, 0.8, 0.4], intensity, radius, flicker: null, count: 1, n: 1 });
const placed = (ls, i) => ls.add({ x: i, y: 0, z: 0, hue: [1, 1, 1], intensity: 1, radius: 4, seed: 1000 + i, key: 'p' + i });
function frame(ls, cands, reserve, cam = [0, 0, 0]) {
  ls.beginDerived(reserve, cam[0], cam[1], cam[2]);
  for (const c of cands) ls.offerDerived(c.x, c.y || 0, c.z || 0, c.rec, c.seed);
  ls.endDerived();
}
const derivedSeeds = (ls) => { const o = []; for (let h = ls.baseCount; h < ls.count; h++) o.push(ls.dKey[h]); return o.sort((a, b) => a - b); };

// ranking + cap
{
  const ls = new LightSet();
  for (let i = 0; i < 12; i++) placed(ls, i);
  const cands = [];
  for (let i = 1; i <= 8; i++) cands.push({ x: i * 2, rec: rec(0.5), seed: i });
  frame(ls, cands, undefined);
  ok('cap = MAX_LIGHTS - placed', ls.count === MAX_LIGHTS && ls.baseCount === 12 && derivedSeeds(ls).length === 4);
  ok('nearest 4 win', derivedSeeds(ls).join() === '1,2,3,4');
  ok('placed handles untouched', ls.key[0] === 'p0' && ls.key[11] === 'p11');
  frame(ls, cands, 2);
  ok('explicit reserve caps lower', ls.count === 14 && derivedSeeds(ls).join() === '1,2');
  frame(ls, cands, 0);
  ok('reserve 0 -> none', ls.count === 12);
}

// hysteresis: holder keeps its slot unless the challenger beats 1.25x
{
  const ls = new LightSet();
  frame(ls, [{ x: 10, rec: rec(0.5), seed: 1 }], 1);
  ok('A holds the slot', derivedSeeds(ls).join() === '1');
  // B 1.2x better than A (dist 8.3 vs 10) -> A keeps (needs > 1.25x)
  frame(ls, [{ x: 10, rec: rec(0.5), seed: 1 }, { x: 8.3, rec: rec(0.5), seed: 2 }], 1);
  ok('1.2x challenger does not replace', derivedSeeds(ls).join() === '1');
  frame(ls, [{ x: 10, rec: rec(0.5), seed: 1 }, { x: 7, rec: rec(0.5), seed: 2 }], 1);
  ok('1.43x challenger replaces', derivedSeeds(ls).join() === '2' && DERIVED_HYSTERESIS === 1.25);
}

// enabled flag, move, placed add/remove keep the tail invariant
{
  const ls = new LightSet();
  ls.emissive = false;
  frame(ls, [{ x: 1, rec: rec(0.5), seed: 1 }], undefined);
  ok('emissive=false -> no lights', ls.count === 0);
  ls.emissive = true;
  placed(ls, 0);
  frame(ls, [{ x: 1, rec: rec(0.5), seed: 7 }, { x: 2, rec: rec(0.5), seed: 8 }], undefined);
  ok('derived appended after placed', ls.count === 3 && ls.baseCount === 1 && ls.dKey[1] !== 0);
  frame(ls, [{ x: 1.5, y: 0.25, z: 2, rec: rec(0.5), seed: 7 }, { x: 2, rec: rec(0.5), seed: 8 }], undefined);
  const h7 = [1, 2].find((h) => ls.dKey[h] === 7);
  ok('holder follows the instance', near(ls.defX[h7], 1.5) && near(ls.defY[h7], 0.25) && near(ls.defZ[h7], 2));
  const h = placed(ls, 5);
  ok('placed add goes before the derived block', h === 1 && ls.baseCount === 2 && ls.count === 4 && derivedSeeds(ls).join() === '7,8' && ls.dKey[0] === 0 && ls.dKey[1] === 0);
  ok('derived data survived the move', near(ls.defX[[2, 3].find((i) => ls.dKey[i] === 7)], 1.5));
  ls.remove(0);
  ok('placed remove keeps derived in the tail', ls.baseCount === 1 && ls.count === 3 && derivedSeeds(ls).join() === '7,8' && ls.key[0] === 'p5');
  for (let i = 0; i < 20; i++) placed(ls, 10 + i);
  ok('full placed set evicts derived, never exceeds cap', ls.count === MAX_LIGHTS && ls.baseCount === MAX_LIGHTS);
}

// zero allocation on steady frames
{
  const ls = new LightSet();
  for (let i = 0; i < 6; i++) placed(ls, i);
  const cands = []; for (let i = 1; i <= 40; i++) cands.push({ x: i, rec: rec(0.4), seed: i });
  const run = () => { ls.beginDerived(undefined, 0, 0, 0); for (let i = 0; i < 40; i++) { const c = cands[i]; ls.offerDerived(c.x, 0, 0, c.rec, c.seed); } ls.endDerived(); };
  for (let i = 0; i < 50; i++) run();
  const sw = ls.derivedStats.swaps;
  let before = 0, after = 0;
  if (globalThis.gc) { globalThis.gc(); before = process.memoryUsage().heapUsed; }
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) run();
  const dt = Number(process.hrtime.bigint() - t0) / 20000 / 1e6;
  if (globalThis.gc) { globalThis.gc(); after = process.memoryUsage().heapUsed; }
  ok('steady frames: no slot swaps', ls.derivedStats.swaps === sw);
  ok('steady frames: no heap growth', !globalThis.gc || after - before < 200000);
  console.log(`bench: 40 candidates offer+end = ${dt.toFixed(4)} ms/frame`);
  ok('40 candidates < 0.05 ms', dt < 0.05);
}

// pool feed: transform through the root pose + override + hit_flash exclusion
{
  const PAL = {
    rgb: { amber: [255, 160, 40], grey: [90, 90, 90], white: [255, 255, 255], glowy: [255, 100, 0] },
    hue: { torch: [1, 0.7, 0.3] },
    lights: { torch: { color: 'torch', intensity: 1, radius: 6, flicker: { hzMin: 8, hzMax: 12, amount: 0.1, jitter: 0 } } },
    materials: {
      stone: { base: 'grey', emissive: 0 },
      lamp: { base: 'amber', emissive: 1 },
      glow: { base: 'amber', glowColor: 'glowy', emissive: 1 },
      hit_flash: { base: 'white', emissive: 1 },
    },
  };
  const reg = (defs) => ({ palette: PAL, keys: () => Object.keys(defs), model: (k) => defs[k] });
  const vox = (row, mats, extra) => Object.assign({
    version: 1, cellM: 0.1, size: [row.length, 1, 1], anchor: [1, 0, 0], mats,
    layers: [[row]], parts: { root: { box: [0, 0, 0, row.length, 1, 1], pivot: [0, 0, 0] } },
  }, extra || {});
  const M = { s: 'stone', l: 'lamp', g: 'glow', h: 'hit_flash' };
  const defs = {
    lamp: { voxel: vox('ssl', M) },
    off: { voxel: vox('ssl', M), light: false },
    flash: { voxel: vox('ssh', M) },
    glowy: { voxel: vox('ssg', M) },
    preset: { voxel: vox('ssl', M), light: { preset: 'torch' } },
  };
  const table = { idFor: () => 1 };
  const pool = new VoxelPool();
  pool.bind(reg(defs), table);
  const e = (k) => pool.models.get(k).emissiveLight;
  ok('feed: lamp has a light', e('lamp') && near(e('lamp').x, 2.5));
  ok('feed: record light:false -> none', e('off') === null);
  ok('feed: hit_flash never lights', e('flash') === null);
  ok('feed: glowColor preferred over base', near(e('glowy').hue[0], 1) && near(e('glowy').hue[1], 100 / 255));
  ok('feed: base rgb fallback', near(e('lamp').hue[1], 160 / 255));
  ok('feed: preset override', e('preset').intensity === 1 && e('preset').radius === 6 && e('preset').flicker.hzMax === 12);
  ok('lightInfo without palette -> undefined', lightInfo({}, {}) === undefined);

  const ls = new LightSet();
  const push = () => {
    pool.beginFrame();
    pool.pushInstance('lamp', 10, 20, 1, 0, -1, 0, 0);
    pool.pushInstance('lamp', 30, 20, 1, 90, -1, 0, 0);
    pool.pushInstance('off', 11, 20, 1, 0, -1, 0, 0);
  };
  push();
  const n = pool.offerEmissive(ls, { x: 0, y: 0, z: 0 });
  ok('feed offers only lamps', n === 2 && ls.count === 2);
  const xs = []; for (let h = 0; h < 2; h++) xs.push([ls.defX[h].toFixed(3), ls.defY[h].toFixed(3), ls.defZ[h].toFixed(3)].join());
  console.log('centroids', xs.join(' | '));
  // yaw 0: local (2.5-1, 0.5, 0.5) cells * 0.1 -> (10.15, 20.05, 1.05)
  ok('centroid through root pose (yaw 0)', xs.includes('10.150,20.050,1.050'));
  ok('centroid through root pose (yaw 90)', xs.includes('29.950,20.150,1.050'));
  ok('seed distinguishes instances', ls.dKey[0] !== ls.dKey[1] && ls.dKey[0] !== 0);
  const sw = ls.derivedStats.swaps;
  for (let i = 0; i < 100; i++) { push(); pool.offerEmissive(ls, { x: 0, y: 0, z: 0 }); }
  ok('pool steady frames: no swaps', ls.derivedStats.swaps === sw);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
