// game/js/quest/spellLightView.test.js (SPELL-05b): Spark (Freeze bolt) view with the REAL sims, particles and LightSet.
// Run: node --expose-gc game/js/quest/spellLightView.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createParticles, LightSet, MAX_LIGHTS } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import { createTargetables } from './sim/targetables.js';
import { createSparkSim } from './sim/spark.js';
import { createSpellLightView } from './spellLightView.js';

if (typeof global.gc !== 'function') { const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' }); process.exit(r.status ?? 1); }
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const A = globalThis.ASSETS;

function stubWorld(wx) {
  return { state: {}, forEachEntity() {},
    raySegmentRay(seg, out) { if (wx === null) return false; const dx = seg[3] - seg[0]; if (Math.abs(dx) < 1e-12) return false; const t = (wx - seg[0]) / dx; if (t <= 0 || t > 1) return false;
      out.t = t; out.x = wx; out.y = seg[1] + (seg[4] - seg[1]) * t; out.z = seg[2] + (seg[5] - seg[2]) * t; return true; } };
}
function makeEvents() { const l = new Map(); return { on(n, fn) { let q = l.get(n); if (!q) { q = new Set(); l.set(n, q); } q.add(fn); return () => q.delete(fn); }, emit(n, p) { const q = l.get(n); if (q) for (const fn of Array.from(q)) fn(p); } }; }
function rig({ wx = null, preLights = 3, noParticles = false } = {}) {
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 90 }, components: { body: { eyeH: 1.6 } } };
  const world = stubWorld(wx), events = makeEvents(), tg = createTargetables(world, events);
  const spark = createSparkSim(world, events, tg, { spendMana: () => true });
  const particles = createParticles({}), lights = new LightSet();
  for (let i = 0; i < preLights; i++) lights.add({ x: 0, y: 0, z: 0, hue: [1, 1, 1], intensity: 1, radius: 3, on: true, key: `w${i}` });
  const view = createSpellLightView({ particles: noParticles ? null : particles, palette: A.palette, events });
  view.bind(spark, lights);
  const r = { player, spark, particles, lights, view, events };
  r.step = () => { spark.step(player, 1, 0, 0); view.stepFx(); particles.step(); };
  r.frame = (a = 1) => { view.present(a); lights.update(1, null); };
  return r;
}
const liveEmitters = (p) => { let n = 0; for (let s = 0; s < p.emitters.used.length; s++) if (p.emitters.used[s]) n++; return n; };
const onCount = (r) => { let n = 0; for (let i = 3; i < r.lights.count; i++) if (r.lights.on[i]) n++; return n; };

if (process.env.SLV_ALLOC_PROBE) {
  const r = rig({ wx: 8 });
  const pump = (n) => { for (let i = 0; i < n; i++) { if (i % 120 === 0) r.spark.requestTap(); r.step(); r.frame(0.5); } };
  pump(8000);
  const w = [];
  for (let k = 0; k < 3; k++) { global.gc(); const h0 = process.memoryUsage().heapUsed; pump(3000); global.gc(); w.push(process.memoryUsage().heapUsed - h0); }
  console.log(w.sort((a, b) => a - b)[1]); process.exit(0);
}

{ const r = rig(); ok('both particle defs defined', ['sparkTrail', 'sparkHit'].every((k) => r.particles.defIdOf(k) >= 0)); }
// binding: 2 bolt + 1 flash, off at start, respects the cap
{
  const r = rig();
  ok('3 lights bound, all off', r.view.stats.boundLights === 3 && r.lights.count === 6 && onCount(r) === 0, `bound=${r.view.stats.boundLights}`);
  const t = rig({ preLights: MAX_LIGHTS - 2 });
  ok('cap respected with 2 free lights', t.lights.count === MAX_LIGHTS && t.view.stats.boundLights === 2);
  const n = rig({ noParticles: true }); n.spark.requestTap(); n.step(); n.frame();
  ok('particles null: lights still work, no throw', onCount(n) >= 1);
}
// Spark: cast -> bolt light + trail emitter; wall hit -> flash light then off
{
  const r = rig({ wx: 4 });
  r.spark.requestTap(); r.step(); r.frame();
  ok('spark:cast counted, bolt light on, trail emitter live', r.view.stats.casts === 1 && r.lights.on[r.view.boltLights[0]] === 1 && liveEmitters(r.particles) === 1);
  for (let i = 0; i < 20 && r.spark.alive; i++) r.step();
  r.frame();
  ok('spark:end -> bolt off, flash on, trail released', r.view.stats.ends === 1 && r.lights.on[r.view.boltLights[0]] === 0 && r.lights.on[r.view.flashLight] === 1);
  for (let i = 0; i < 14; i++) r.step();
  r.frame(1);
  ok('flash fades out', r.lights.on[r.view.flashLight] === 0);
  for (let i = 0; i < 90; i++) r.step();
  ok('emitters released after the flight', liveEmitters(r.particles) === 0, String(liveEmitters(r.particles)));
}
// dispose / rebind leaves no listeners
{
  const r = rig(); r.view.dispose(); r.spark.requestTap(); r.step();
  ok('dispose unsubscribes', r.view.stats.casts === 0);
}
// 0 allocation
{
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { env: { ...process.env, SLV_ALLOC_PROBE: '1' }, encoding: 'utf8' });
  const bytes = Number((res.stdout || '').trim().split('\n').pop());
  ok('0 allocation per step/frame (3000 steps)', Number.isFinite(bytes) && bytes < 20000, `bytes=${bytes} ${res.stderr || ''}`);
}
console.log(`spellLightView: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL', f);
process.exit(fail ? 1 : 0);
