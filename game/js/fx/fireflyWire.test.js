// FIREFLY-NIGHT-01 node test (heap gate needs --expose-gc; skipped otherwise). Run: node game/js/fx/fireflyWire.test.js (suite filter: firefl)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createParticles } from '../../../engine/index.js';
import { createFireflies, FIREFLY_COUNT, nightWeightOf } from './fireflyWire.js';
if (typeof globalThis.gc !== 'function') process.exit(spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' }).status ?? 1);
let failed = 0; const ok = (n, c) => { if (!c) { failed++; console.error('FAIL:', n); } };
const probes = (sunI) => ({ sunI: () => sunI, indoor: () => false, spot: () => 0.5 });
function run(seed, sunI, steps, pr = probes(sunI), opts = {}) {
  const p = createParticles({ capacity: 2048, seed }); const f = createFireflies(pr, p, opts);
  let maxLive = 0; for (let i = 0; i < steps; i++) { f.step(10, 10); p.step(); if (p.stats.live > maxLive) maxLive = p.stats.live; }
  const pos = []; for (let i = 0; i < p.cap; i++) if (p.alive[i]) pos.push(p.px[i], p.py[i], p.pz[i]);
  return { maxLive, pos, spawned: p.stats.spawned, f, p };
}
const a = run(5, 0.25, 600), b = run(5, 0.25, 600);
ok('night spawns', a.spawned > 0);
ok('deterministic', a.pos.length === b.pos.length && a.pos.every((v, i) => v === b.pos[i]));
ok('cap', a.maxLive <= FIREFLY_COUNT);
ok('day: nothing spawns (byte-identical)', run(5, 0.9, 600).spawned === 0);
ok('dusk edge', nightWeightOf(0.8) === 0 && nightWeightOf(0.25) === 1);
ok('indoor/underground: none', run(5, 0.25, 600, { ...probes(0.25), indoor: () => true }).spawned === 0);
ok('no grass/water: none', run(5, 0.25, 600, { ...probes(0.25), spot: () => NaN }).spawned === 0);
ok('off preset (low)', run(5, 0.25, 600, probes(0.25), { enabled: false }).spawned === 0);
{ const p = createParticles({ capacity: 2048, seed: 1 }), f = createFireflies(probes(0.25), p); for (let i = 0; i < 200; i++) { f.step(0, 0); p.step(); }
  if (globalThis.gc) globalThis.gc(); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 20000; i++) { f.step(0, 0); p.step(); }
  if (globalThis.gc) globalThis.gc(); const dh = process.memoryUsage().heapUsed - h0; if (globalThis.gc) ok("0 alloc (heap growth < 300 KB) " + dh, dh < 300000); }
if (failed) { console.error(failed + ' failed'); process.exit(1); } console.log('fireflyWire: all OK');
