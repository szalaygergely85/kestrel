// game/js/quest/fireballView.test.js (SPELL-01b): the fireball view with the REAL sim, particles, LightSet and the
// designer's spellFx data. Run: node --expose-gc game/js/quest/fireballView.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createParticles, LightSet, MAX_LIGHTS } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/particles.js';
import '../../../design/models/spell.js';
import { FIREBALL_CFG } from './spellConfig.js';
import { createTargetables } from './sim/targetables.js';
import { createFireballSim } from './sim/fireball.js';
import { createFireballView } from './fireballView.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const A = globalThis.ASSETS;
A.spellFx.attach();
const errs = A.spellFx.validate(A.palette);
ok('designer spellFx validates', errs.length === 0, errs.join('; '));

// the allocation probe runs in a fresh child (FIREBALL_ALLOC_PROBE=1): earlier blocks in this file leave polluted
// V8 type feedback that boxes allocations in the same isolate (same fix as CHARGEN-22e / CRAFT-ALLOC-01).
if (process.env.FIREBALL_ALLOC_PROBE) {
  const probeRig = rig({ wx: 6 });
  const fake = { push() {} };
  const pump = (n) => { for (let i = 0; i < n; i++) { if (i % 90 === 0) probeRig.cast(); else probeRig.step(false); probeRig.frame(0.5); probeRig.view.extra(fake); probeRig.view.kickDeg(); probeRig.view.presentEmber(true, 1.5, 0, 0, 1); } };
  pump(6000); // long warm-up (Node v24 tiers up late)
  const w = [];
  for (let k = 0; k < 3; k++) { global.gc(); const h0 = process.memoryUsage().heapUsed; pump(3000); global.gc(); w.push(process.memoryUsage().heapUsed - h0); }
  console.log(w.sort((a, b) => a - b)[1]);
  process.exit(0);
}

function makeParticles() {
  const p = createParticles({});
  for (const k of Object.keys(A.particles.presets)) p.defineEmitter(k, A.particles.toEmitterDef(k, A.palette.rgb));
  return p;
}
/** Wall plane x = wx (null = open). */
function stubWorld(entities, wx) {
  return {
    state: {}, forEachEntity(fn) { entities.forEach(fn); },
    raySegment(ax, ay, az, bx, by, bz, out) {
      if (wx === null) return false;
      const dx = bx - ax;
      if (Math.abs(dx) < 1e-12) return false;
      const t = (wx - ax) / dx;
      if (t <= 0 || t > 1) return false;
      out.t = t; out.x = wx; out.y = ay + (by - ay) * t; out.z = az + (bz - az) * t;
      return true;
    },
  };
}
function makeEvents() {
  const l = new Map();
  return {
    on(n, fn) { let q = l.get(n); if (!q) { q = new Set(); l.set(n, q); } q.add(fn); return () => q.delete(fn); },
    emit(n, p) { const q = l.get(n); if (q) for (const fn of Array.from(q)) fn(p); },
  };
}
function rig({ wx = null, preLights = 3, hand = 'right' } = {}) {
  const player = { id: 'player', transform: { x: 0, y: 0, z: 0, yawDeg: 90 }, components: { body: { grounded: true, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
  const world = stubWorld([player], wx);
  const events = makeEvents();
  const tg = createTargetables(world, events);
  const sim = createFireballSim(world, events, FIREBALL_CFG, tg, { spendMana: () => true });
  sim.setHand(hand);
  const particles = makeParticles();
  const lights = new LightSet();
  for (let i = 0; i < preLights; i++) lights.add({ x: 0, y: 0, z: 0, hue: [1, 1, 1], intensity: 1, radius: 3, on: true, key: `w${i}` });
  const view = createFireballView({ particles, palette: A.palette, fx: A.spellFx, cfg: FIREBALL_CFG, events });
  view.bind(sim, lights);
  const r = { player, sim, particles, lights, view, events };
  r.step = (down) => { sim.step(player, down, 1, 0, 1, 0, 0); view.stepFx(); particles.step(); };
  r.cast = (hold = 5) => { for (let i = 0; i < hold; i++) r.step(true); r.step(false); };
  r.frame = (a = 1) => { view.present(a, { x: 0, y: 0, z: 1.6 }); lights.update(1, null); };
  return r;
}
const liveEmitters = (p) => { let n = 0; for (let s = 0; s < p.emitters.used.length; s++) if (p.emitters.used[s]) n++; return n; };

// ---- binding: 4 flight + 2 flash + 1 ember, off, radius fixed, never removed ----------------------------------------
{
  const r = rig();
  ok('6 lights + ember bound after the 3 world lights', r.lights.count === 3 + 7 && r.view.stats.flightBound === 4 && r.view.stats.flashBound === 2 && r.view.stats.emberBound === 1, `count=${r.lights.count}`);
  let allOff = true;
  for (let i = 3; i < r.lights.count; i++) if (r.lights.on[i]) allOff = false;
  ok('bound lights start off', allOff);
  ok('flight lights bound at 5 m (fireballLightBig)', r.lights.radius[r.view.flightLights[0]] === 5);
  ok('flash lights bound at 6 m', r.lights.radius[r.view.flashLights[0]] === 6);
  const tight = rig({ preLights: MAX_LIGHTS - 3 });
  ok('only 3 free lights: flash first, then flight; never over the cap', tight.lights.count === MAX_LIGHTS && tight.view.stats.flashBound === 2 && tight.view.stats.flightBound === 1 && tight.view.stats.emberBound === 0);
}

// ---- trail: one persistent emitter per serial, kept while alive, released on death --------------------------------
{
  const r = rig();
  const e0 = liveEmitters(r.particles);
  r.cast();
  ok('a cast creates exactly one trail emitter', r.view.stats.trailsCreated === 1 && liveEmitters(r.particles) === e0 + 1);
  const h = r.view.trailHandles[0];
  for (let i = 0; i < 20; i++) r.step(false);
  ok('the same emitter handle is kept every step (not one per step)', r.view.trailHandles[0] === h && r.view.stats.trailsCreated === 1 && liveEmitters(r.particles) === e0 + 1);
  ok('~30 sparks/s from the persistent emitter', r.particles.stats.spawned >= 8 && r.particles.stats.spawned <= 14, `spawned=${r.particles.stats.spawned}`);
  for (let i = 0; i < 12; i++) r.step(false);
  r.cast();
  ok('a second ball gets its own emitter; the first keeps its handle', r.view.stats.trailsCreated === 2 && r.view.trailHandles[0] === h && r.view.trailHandles[1] >= 0);
  for (let i = 0; i < 200; i++) r.step(false); // both burst at range 24
  ok('balls gone -> trail emitters released', r.sim.alive === 0 && r.view.trailHandles[0] === -1 && r.view.trailHandles[1] === -1);
  for (let i = 0; i < 200; i++) r.step(false);
  ok('released emitters free their slots once the sparks die', liveEmitters(r.particles) === 0, `emitters=${liveEmitters(r.particles)}`);
}

// ---- lights follow balls; cap = 4 by construction -----------------------------------------------------------------
{
  const r = rig();
  r.cast(); r.frame();
  const lt = r.view.flightLights[0];
  ok('ball light on, at the ball', r.lights.on[lt] === 1 && Math.abs(r.lights.defX[lt] - r.sim.slots.x[0]) < 1e-3);
  const x1 = r.lights.defX[lt];
  r.step(false); r.frame();
  ok('light moves with the ball', r.lights.defX[lt] > x1 + 0.2);
  r.frame(0.5);
  ok('alpha < 1 interpolates backwards along the flight', r.lights.defX[lt] < r.sim.slots.x[0] - 0.05);
  const q = rig();
  for (let i = 0; i < 4; i++) { q.cast(); for (let k = 0; k < 30; k++) q.step(false); }
  q.cast(); q.frame();
  let on = 0;
  for (let i = 0; i < q.lights.count; i++) if (q.lights.on[i] && q.lights.key[i] && q.lights.key[i].startsWith('fireball.flight')) on++;
  ok('at most 4 flight lights alive', q.sim.alive <= 4 && on <= 4 && on === q.sim.alive, `alive=${q.sim.alive} on=${on}`);
  const c = rig(); c.cast(40); c.frame();
  const hc = c.view.flightLights[0];
  ok('charged ball -> intensity 1.1, radius untouched', Math.abs(c.lights.baseIntensity[hc] - 1.1) < 1e-6 && c.lights.radius[hc] === 5);
  ok('tap ball -> intensity 0.9', Math.abs(r.lights.baseIntensity[lt] - 0.9) < 1e-6);
}

// ---- burst: flash + kick + sprite once, flash fades to 0 at 9 steps ------------------------------------------------
{
  const r = rig({ wx: 4 });
  r.cast();
  for (let i = 0; i < 40 && r.view.stats.bursts === 0; i++) r.step(false);
  ok('wall burst recorded exactly once', r.view.stats.bursts === 1 && r.sim.alive === 0);
  const f0 = r.view.flashLights[0];
  r.frame(1);
  ok('flash light on after the burst', r.lights.on[f0] === 1 && r.lights.baseIntensity[f0] > 1.4);
  ok('only one flash used', r.lights.on[r.view.flashLights[1]] === 0);
  const kick = r.view.kickDeg();
  ok('kick 1.5 deg when the burst is 4 m away', Math.abs(kick - 1.5) < 0.01, `kick=${kick}`);
  for (let i = 0; i < 4; i++) r.step(false);
  r.frame(1);
  const k4 = r.view.kickDeg();
  ok('kick decays', k4 < kick && k4 > 0, `k4=${k4}`);
  for (let i = 0; i < 6; i++) r.step(false);
  r.frame(1);
  ok('flash off and kick 0 after 9 steps', r.lights.on[f0] === 0 && r.view.kickDeg() === 0);
  ok('burst particles: embers + smoke spawned', r.particles.stats.spawned >= 20 + 8, `spawned=${r.particles.stats.spawned}`);
  const far = rig({ wx: 12 });
  far.cast(); for (let i = 0; i < 60 && far.view.stats.bursts === 0; i++) far.step(false);
  far.frame(1);
  ok('no kick for a burst 12 m away', far.view.kickDeg() === 0);
}

// ---- sprites: core variants, blast window, pushed into the pool ---------------------------------------------------
{
  const pool = { log: [], push(m, an, fr) { this.log.push(m + '/' + an + '/' + fr); } };
  const t = rig();
  t.cast(); t.frame();
  t.view.extra(pool);
  ok('tap ball pushes fireballCore fly', pool.log.length === 1 && pool.log[0].startsWith('fireballCore/fly/'), pool.log.join());
  const c = rig(); c.cast(40); c.frame();
  pool.log.length = 0; c.view.extra(pool);
  ok('charged ball pushes fireballCoreCharged', pool.log[0].startsWith('fireballCoreCharged/fly/'), pool.log.join());
  const b = rig({ wx: 4 });
  b.cast(); for (let i = 0; i < 40 && b.view.stats.bursts === 0; i++) b.step(false);
  b.frame(1); pool.log.length = 0; b.view.extra(pool);
  ok('burst pushes the blast sprite frame 0 on the burst step', pool.log.length === 1 && pool.log[0] === 'fireballBlast/burst/0', pool.log.join());
  for (let i = 0; i < 20; i++) b.step(false);
  b.frame(1); pool.log.length = 0; b.view.extra(pool);
  ok('blast gone after 260 ms', pool.log.length === 0, pool.log.join());
}

// ---- 0 allocation per step + frame --------------------------------------------------------------------------------
{
  const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { encoding: 'utf8', env: { ...process.env, FIREBALL_ALLOC_PROBE: '1' } });
  const dh = parseFloat(r.stdout);
  ok('view step + frame allocate ~nothing over 3000 iterations', dh < 150000, `dh=${dh}`);
}

console.log(`fireballView.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
