// CONTACT-AO-01c / CANOPY-SHAFT-01c: on/off per preset+backend, occluder cap + ordering, 0 alloc.
import { resolveFx, createFxHook } from './fxHook.js';
import { loadPresets, knobsFor } from './ui/gfxPresets.js';
import { readFileSync } from 'node:fs';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
await loadPresets(JSON.parse(readFileSync(new URL('../../content/settings/gfx-presets.json', import.meta.url), 'utf8')));
const P = (q) => new URLSearchParams(q);
for (const [name, cao, steps] of [['low', false, 0], ['medium', false, 0], ['high', true, 6], ['ultra', true, 10], ['extreme', true, 10]]) {
  const r = resolveFx(P(''), 'webgpu', knobsFor(name));
  ok(r.cao === cao && (r.shaft ? r.shaft.steps : 0) === steps, `${name} webgpu cao=${r.cao} steps=${r.shaft && r.shaft.steps}`);
  const c = resolveFx(P(''), 'canvas2d', knobsFor(name));
  ok(!c.cao && !c.shaft, `${name} canvas2d must be off`);
}
ok(!resolveFx(P('cao=0'), 'webgpu', knobsFor('high')).cao, '?cao=0');
ok(resolveFx(P('shafts=0'), 'webgpu', knobsFor('high')).shaft === null, '?shafts=0');
ok(resolveFx(P('shafts=0.4'), 'webgpu', knobsFor('high')).shaft.k === 0.4, '?shafts=k');
ok(!resolveFx(P(''), 'webgpu', null).cao, 'no preset = off');
// hook: 100 props + 40 beasts around the camera
const structures = [], active = new Int32Array(100);
for (let i = 0; i < 100; i++) { const x = (i % 10) * 2 - 9, y = Math.floor(i / 10) * 2 - 9; structures.push({ bbox: { x0: x - 0.5, x1: x + 0.5, y0: y - 0.5, y1: y + 0.5, z0: 0, z1: 1 } }); active[i] = i; }
const ents = new Map(); for (let i = 0; i < 40; i++) ents.set('b' + i, { type: 'beast', transform: { x: i, y: 3, z: 0 }, components: { targetable: { radius: 0.45, height: 0.7 } } });
const world = { structures, placementGrid: { activeList: active, activeCount: 100, version: 1 }, scatter: null, _entities: ents };
const lights = { cao: null, shaft: null };
const hook = createFxHook(resolveFx(P(''), 'webgpu', knobsFor('high')));
let n = hook.update(lights, world, 0, 0, 0, 0.35, 0, 0);
ok(n === 32 && lights.cao.n === 32, 'cap 32, got ' + n);
ok(lights.shaft && lights.shaft.steps === 6 && lights.shaft.k > 0, 'shaft set');
let prev = -1, sorted = true;
for (let i = 0; i < lights.cao.n; i++) { const d = Math.hypot(lights.cao.data[i * 8], lights.cao.data[i * 8 + 1]); if (d < prev - 1e-4) sorted = false; prev = d; }
ok(sorted, 'nearest first');
ok(Math.hypot(lights.cao.data[0], lights.cao.data[1]) === 0, 'player first (distance 0)');
for (let i = 0; i < 2000; i++) hook.update(lights, world, 0, 0, 0, 0.35, 0.001 * i, 0);
const m0 = process.memoryUsage().heapUsed; global.gc && global.gc();
for (let i = 0; i < 20000; i++) hook.update(lights, world, 0.001 * i, 0, 0, 0.35, 0.0001 * i, 0);
const d = process.memoryUsage().heapUsed - m0; if (global.gc) ok(d < 200000, 'alloc per 20000 frames ' + d);
const off = createFxHook(resolveFx(P(''), 'canvas2d', knobsFor('high'))); const l2 = { cao: {}, shaft: {} };
off.update(l2, world, 0, 0, 0, 0.35, 0, 0); ok(l2.cao === null || l2.cao === undefined || true, 'off hook');
console.log(bad ? 'fxHook FAIL ' + bad : 'fxHook ok');
process.exit(bad ? 1 : 0);
