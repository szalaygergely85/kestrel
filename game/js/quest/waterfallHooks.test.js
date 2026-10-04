import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AssetRegistry, World, createParticles, collectWaterfallDefs, PARTICLE_CAP, PARTICLE_MAX_EMITTERS } from '../../../engine/index.js';
import '../../../design/palette.js';
import '../../../design/waterfall.js';
import { createWaterfallHooks } from './waterfallHooks.js';

if (typeof global.gc !== 'function') {
  const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(result.status === null ? 1 : result.status);
}

let checks = 0;
function ok(v, label) { assert.ok(v, label); checks++; }
const cfg = globalThis.ASSETS.waterfall, rgb = globalThis.ASSETS.palette.rgb;
const level = JSON.parse(fs.readFileSync(new URL('../../../content/levels/waterfall_cliff.level.json', import.meta.url)));
const worldDef = JSON.parse(fs.readFileSync(new URL('../../../content/worlds/waterfall_test.world.json', import.meta.url)));
const assets = AssetRegistry.fromJSON({ levels: { waterfall_cliff: level }, worlds: { waterfall_test: worldDef } }, globalThis.ASSETS);
const world = World.load(worldDef, assets, { physics: 'mesh' });
ok(world.waterfalls.length === 1 && world.waterfalls[0].id === 'cliff.waterfall', 'registered placed level builds sheet');
assert.deepEqual(level.waterfalls[0], cfg.preset, 'canonical level uses waterfall preset as-is'); checks++;
ok(cfg.preset.drop >= 2 && cfg.preset.drop <= 20 && cfg.look.fallSpeed >= 8 && cfg.look.sheetAlpha === 0.75, 'sheet content AC numbers');
ok(cfg.look.fallRamp === "|:'", 'fall glyph ramp');
assert.throws(() => collectWaterfallDefs({ waterfalls: [{ ...cfg.preset, drop: 21 }] }, []), /drop/); checks++;
ok(!world.structures[0].level.sectorAt(9, 5.5).solid && world.structures[0].level.ceilAt(9, 5.5) === 4.5, 'back view is inside walkable roofed alcove');
ok(!world.structures[0].level.sectorAt(cfg.views.front.x, cfg.views.front.y).solid, 'front view has a walkable shore');
const particles = createParticles();
let maxLive = 0;
for (const key of Object.keys(cfg.presets)) {
  const id = particles.defineEmitter(key, cfg.toEmitterDef(key, rgb));
  ok(id >= 0, `${key} compiles with real palette`);
  maxLive += cfg.presets[key].maxLive;
}
ok(maxLive * 8 <= PARTICLE_CAP && 4 * 8 <= PARTICLE_MAX_EMITTERS, 'maximum eight falls fit shared particle/emitter budgets');
const hook = createWaterfallHooks(world, particles, cfg), f = world.waterfalls[0];
const tau = Math.sqrt(f.drop / 4.9), a = f.outDeg * Math.PI / 180;
ok(Math.abs(hook.footX[0] - ((f.lip[0] + f.lip[2]) / 2 + Math.sin(a) * f.out * tau)) < 1e-12, 'foot X uses ballistic drop');
ok(Math.abs(hook.footY[0] - ((f.lip[1] + f.lip[3]) / 2 - Math.cos(a) * f.out * tau)) < 1e-12, 'foot Y uses ballistic drop');
ok(hook.footZ[0] === f.z - f.drop, 'foot Z is exact landing height');
const pool = level.water[0];
ok(pool.c[0] === hook.footX[0] && Math.abs(pool.c[1] - hook.footY[0]) < 1e-12 && pool.z === hook.footZ[0], 'pool shares exact foot centre/surface');
const flow = [0, 0]; world.flowAt(hook.footX[0] + 1, hook.footY[0], flow);
ok(Math.abs(flow[0] - .7) < 1e-6 && Math.abs(flow[1]) < 1e-6, 'pool current drifts radially outward');
const ringId = particles.defIdOf('waterfallRipple');
hook.step(); particles.step(); hook.afterStep();
let ringCount = 0, first = -1;
for (let p = 0; p < particles.cap; p++) if (particles.alive[p] && particles.def[p] === ringId) {
  ringCount++; first = p;
  assert.ok(Math.abs(Math.hypot(particles.px[p] - hook.footX[0], particles.py[p] - hook.footY[0]) - cfg.ripple.startRadius) < 1e-10);
}
ok(ringCount === cfg.ripple.points, 'new ring has 32 points at prescribed radius');
for (let t = 0; t < 30; t++) { hook.step(); particles.step(); hook.afterStep(); }
ok(Math.abs(Math.hypot(particles.px[first] - hook.footX[0], particles.py[first] - hook.footY[0]) - .98) < 1e-10, 'ring expands .8m in half a second');
ok(particles.pz[first] === cfg.ripple.height && particles.vz[first] === 0, 'rings remain on pool plane');
const colors = cfg.toEmitterDef('waterfallRipple', rgb).colors;
ok(colors.every((c, i) => i === 0 || Math.max(...c) <= Math.max(...colors[i - 1])), 'ring life ramp fades brightness monotonically');
for (let t = 0; t < 1800; t++) { hook.step(); particles.step(); hook.afterStep(); assert.ok(particles.stats.live <= maxLive); }
ok(particles.stats.recycled === 0 && particles.stats.dropped === 0, 'steady waterfall never recycles/drops particles');
ok(particles.emitters.used.reduce((n, v) => n + v, 0) === 4, 'ring bursts reuse four persistent emitters');
hook.dispose(); hook.dispose();
const spawned = particles.stats.spawned;
for (let t = 0; t < 180; t++) { hook.step(); particles.step(); hook.afterStep(); }
ok(particles.stats.spawned === spawned && particles.stats.live === 0, 'dispose stops emission and live particles drain');
ok(particles.emitters.used.every((v) => v === 0), 'all waterfall emitter slots are released');
particles.clear(); const empty = createWaterfallHooks({ waterfalls: [] }, particles, cfg);
empty.step(); particles.step(); empty.afterStep(); empty.dispose();
ok(particles.stats.live === 0, 'ordinary worlds have no waterfall particle work');
const eight = { waterfalls: Array.from({ length: 8 }, (_, i) => ({ ...f,
  lip: f.lip.map((v, j) => v + (j % 2 === 0 ? i * 20 : 0)) })) };
const maxHook = createWaterfallHooks(eight, particles, cfg);
function stepMany(n) {
  for (let t = 0; t < n; t++) { maxHook.step(); particles.step(); maxHook.afterStep(); }
}
stepMany(10000);
ok(particles.stats.live <= maxLive * 8 && particles.stats.recycled === 0 && particles.stats.dropped === 0,
  'eight simultaneous falls stay within shared live budget');
ok(particles.emitters.used.reduce((n, v) => n + v, 0) === 32, 'eight falls use exactly 32 emitters');
global.gc(); const heap = process.memoryUsage().heapUsed;
stepMany(10000); global.gc(); const grew = process.memoryUsage().heapUsed - heap;
ok(grew < 64 * 1024, `no retained heap growth in warmed eight-fall tick path (${grew} bytes)`);
maxHook.dispose();
console.log(`waterfallHooks: ${checks}/${checks} PASS`);
