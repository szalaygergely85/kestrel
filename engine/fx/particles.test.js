// engine/fx/particles.test.js (US-053a). Run: node [--expose-gc] engine/fx/particles.test.js
// Perf bars are warn-only unless PERF_STRICT=1 (architecture.md 32.1).
// Zero-allocation gate is hard: without global.gc the file re-runs itself with --expose-gc (rtsCamera.test.js pattern).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeOk } from '../test/assert.js';
import { createParticles, MAX_EMITTERS } from './particles.js';
import { createHasher } from '../core/hash.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const STEP = 1 / 60;

const BASE = { life: [1, 1], speed: [0, 0], glyphs: '@o.', colors: [[255, 255, 255], [128, 128, 128]] };
const mk = (o) => ({ ...BASE, ...o });
function sys(def, opts) {
  const p = createParticles(opts);
  const id = p.defineEmitter('t', mk(def));
  return { p, id };
}
function steps(p, n) { for (let i = 0; i < n; i++) p.step(); }
function hashOf(p) { const h = createHasher(); p.hashInto(h); return h.value(); }
function throwsMsg(fn, re) { try { fn(); return false; } catch (e) { return re.test(e.message); } }
function firstLive(p) { for (let i = 0; i < p.cap; i++) if (p.alive[i]) return i; return -1; }

// ---- emit rate incl. fractional accumulation ----
{
  const { p, id } = sys({ rate: 20, life: [10, 10] });
  const h = p.createEmitter(id, 0, 0, 0);
  p.setOn(h, true);
  steps(p, 60);
  ok('rate 20/s -> exactly 20 spawns over 60 steps', p.stats.spawned === 20, p.stats.spawned);
  p.setOn(h, false); steps(p, 60);
  ok('off emitter spawns nothing', p.stats.spawned === 20);
  const b = sys({ rate: 7.5, life: [10, 10] });
  const hb = b.p.createEmitter(b.id, 0, 0, 0); b.p.setOn(hb, true);
  steps(b.p, 120);
  ok('rate 7.5/s: 120 steps -> 15 spawns (fractional accumulation)', b.p.stats.spawned === 15, b.p.stats.spawned);
  const c = sys({ rate: 1, life: [10, 10] });
  const hc = c.p.createEmitter(c.id, 0, 0, 0); c.p.setOn(hc, true);
  steps(c.p, 59); const s59 = c.p.stats.spawned; steps(c.p, 1);
  ok('rate 1/s: first spawn at step 60, not before', s59 === 0 && c.p.stats.spawned === 1, `${s59} ${c.p.stats.spawned}`);
}

// ---- life expiry + pool reuse ----
{
  const { p, id } = sys({ life: [0.5, 0.5], rate: 0 }, { capacity: 16 });
  const h = p.createEmitter(id, 0, 0, 0);
  p.burst(h, 5); p.step();
  ok('burst of 5 spawns on the next step', p.stats.live === 5 && p.stats.spawned === 5);
  steps(p, 29);
  ok('alive for life-1 steps', p.stats.live === 5, p.stats.live);
  p.step();
  ok('dead at age == life (30 steps)', p.stats.live === 0);
  p.burst(h, 5); p.step();
  ok('pool reuse: ring head advances, 5 live again, nothing recycled', p.stats.live === 5 && p.stats.recycled === 0);
  const aliveSlots = []; for (let i = 0; i < 16; i++) if (p.alive[i]) aliveSlots.push(i);
  ok('reused slots are the next ring slots 5..9', aliveSlots.join() === '5,6,7,8,9', aliveSlots.join());
}

// ---- pool full: oldest recycled ----
{
  const { p, id } = sys({ life: [10, 10], maxLive: 100 }, { capacity: 8 });
  const h = p.createEmitter(id, 0, 0, 0);
  p.burst(h, 8); p.step();
  ok('cap 8 filled', p.stats.live === 8 && p.stats.recycled === 0);
  p.setEmitterPos(h, 5, 0, 0);
  p.burst(h, 1); p.step();
  ok('9th spawn overwrites slot 0 (the oldest)', p.stats.recycled === 1 && p.stats.live === 8 && p.px[0] === 5, `${p.stats.recycled} px0=${p.px[0]}`);
  ok('slot 0 age reset, slot 1 aged', p.age[0] === 0 && p.age[1] === 1, `${p.age[0]} ${p.age[1]}`);
  p.burst(h, 3); p.step();
  ok('recycles oldest first: slots 1..3 now new', p.px[1] === 5 && p.px[3] === 5 && p.px[4] === 0, `${p.px[1]} ${p.px[3]} ${p.px[4]}`);
  ok('emitter live count stays consistent with pool', p.emitters.live[0] === 8);
}

// ---- maxLive per emitter + no burst after cap clears ----
{
  const { p, id } = sys({ rate: 600, life: [0.1, 0.1], maxLive: 4 });
  const h = p.createEmitter(id, 0, 0, 0); p.setOn(h, true);
  p.step();
  ok('maxLive caps live count', p.stats.live === 4, p.stats.live);
  let maxSeen = 0, spawnedAfter = 0;
  for (let i = 0; i < 60; i++) { p.step(); maxSeen = Math.max(maxSeen, p.stats.live); }
  ok('live never exceeds maxLive', maxSeen <= 4, maxSeen);
  // rate 600/s = 10 per step, capped; after switching off nothing bursts later
  p.setOn(h, false); steps(p, 10);
  spawnedAfter = p.stats.spawned;
  p.setOn(h, true); p.step();
  ok('accumulator backlog does not burst after cap clears (<= 1 step of rate)', p.stats.spawned - spawnedAfter <= 4, p.stats.spawned - spawnedAfter);
  const b = sys({ life: [10, 10], maxLive: 3 });
  const hb = b.p.createEmitter(b.id, 0, 0, 0); b.p.burst(hb, 10); b.p.step();
  ok('burst clamped to maxLive', b.p.stats.live === 3);
  steps(b.p, 5);
  ok('burst remainder dropped, not deferred', b.p.stats.live === 3 && b.p.stats.spawned === 3);
}

// ---- velocity + spread distribution ----
{
  const { p, id } = sys({ life: [10, 10], speed: [2, 4], dir: [0, 0, 1], spreadDeg: 0, maxLive: 500 });
  const h = p.createEmitter(id, 1, 2, 3); p.burst(h, 200); p.step();
  let okDir = true, minS = 9, maxS = 0;
  for (let i = 0; i < p.cap; i++) if (p.alive[i]) {
    if (p.vx[i] !== 0 || p.vy[i] !== 0) okDir = false;
    minS = Math.min(minS, p.vz[i]); maxS = Math.max(maxS, p.vz[i]);
  }
  ok('spread 0: all along dir', okDir);
  ok('speed uniform in [2,4]', minS >= 2 && maxS <= 4 && maxS - minS > 1.5, `${minS} ${maxS}`);
  ok('spawns at the emitter position', p.px[firstLive(p)] === 1 && p.pz[firstLive(p)] === 3);

  const s = sys({ life: [10, 10], speed: [3, 3], dir: [0, 0, 1], spreadDeg: 30, maxLive: 2000 }, { capacity: 2048 });
  const hs = s.p.createEmitter(s.id, 0, 0, 0); s.p.burst(hs, 2000); s.p.step();
  const cosMin = Math.cos(30 * Math.PI / 180);
  let worst = 1, sumx = 0, sumy = 0, n = 0, speedErr = 0, outer = 0;
  for (let i = 0; i < s.p.cap; i++) if (s.p.alive[i]) {
    const l = Math.hypot(s.p.vx[i], s.p.vy[i], s.p.vz[i]);
    speedErr = Math.max(speedErr, Math.abs(l - 3));
    const c = s.p.vz[i] / l; worst = Math.min(worst, c);
    if (c < Math.cos(25 * Math.PI / 180)) outer++;
    sumx += s.p.vx[i]; sumy += s.p.vy[i]; n++;
  }
  ok('spread 30: every direction within the cone', worst >= cosMin - 1e-9, `${worst} vs ${cosMin}`);
  ok('spread: speed magnitude preserved', speedErr < 1e-9, speedErr);
  ok('spread: cone is filled (outer ring populated) and centred', outer > 100 && Math.abs(sumx / n) < 0.1 && Math.abs(sumy / n) < 0.1, `outer=${outer} mx=${sumx / n}`);

  // tilted axis + box jitter
  const t = sys({ life: [10, 10], speed: [1, 1], dir: [1, 0, 0], spreadDeg: 10, box: [0.5, 0.25, 0], maxLive: 500 });
  const ht = t.p.createEmitter(t.id, 10, 10, 10); t.p.burst(ht, 300); t.p.step();
  let tw = 1, bx = 0, by = 0, bz = 0;
  for (let i = 0; i < t.p.cap; i++) if (t.p.alive[i]) {
    tw = Math.min(tw, t.p.vx[i] / Math.hypot(t.p.vx[i], t.p.vy[i], t.p.vz[i]));
    bx = Math.max(bx, Math.abs(t.p.px[i] - 10)); by = Math.max(by, Math.abs(t.p.py[i] - 10)); bz = Math.max(bz, Math.abs(t.p.pz[i] - 10));
  }
  ok('tilted axis: cone around +x', tw >= Math.cos(10 * Math.PI / 180) - 1e-9, tw);
  ok('box jitter bounded per axis, zero axis exact', bx <= 0.5 && bx > 0.3 && by <= 0.25 && bz === 0, `${bx} ${by} ${bz}`);

  const d = sys({ life: [10, 10], speed: [2, 2], dir: [0, 0, 1], maxLive: 10 });
  const hd = d.p.createEmitter(d.id, 0, 0, 0); d.p.setEmitterDir(hd, 0, 3, 0); d.p.burst(hd, 1); d.p.step();
  const i0 = firstLive(d.p);
  ok('setEmitterDir overrides the axis', Math.abs(d.p.vy[i0] - 2) < 1e-12 && d.p.vz[i0] === 0 && d.p.vx[i0] === 0);
}

// ---- gravity / buoyancy ----
{
  const { p, id } = sys({ life: [5, 5], accelZ: -9.8, maxLive: 4 });
  const h = p.createEmitter(id, 0, 0, 0); p.burst(h, 1); p.step();
  const i = firstLive(p);
  steps(p, 60);
  ok('gravity: vz after 60 steps = -9.8 * 1s', Math.abs(p.vz[i] - (-9.8 * 60 * STEP)) < 1e-9, p.vz[i]);
  const exp = -0.5 * 9.8 * STEP * STEP * 60 * 61;
  ok('gravity: symplectic-Euler fall distance', Math.abs(p.pz[i] - exp) < 1e-9, `${p.pz[i]} vs ${exp}`);
  const b = sys({ life: [5, 5], accelZ: 0.6, maxLive: 4 });
  const hb = b.p.createEmitter(b.id, 0, 0, 0); b.p.burst(hb, 1); b.p.step();
  steps(b.p, 60);
  ok('buoyancy rises', b.p.pz[firstLive(b.p)] > 0.2);
}

// ---- drag + wind ----
{
  const { p, id } = sys({ life: [10, 10], speed: [4, 4], dir: [1, 0, 0], drag: 3, maxLive: 4 });
  const h = p.createEmitter(id, 0, 0, 0); p.burst(h, 1); p.step();
  const i = firstLive(p);
  steps(p, 120);
  ok('drag with no wind decays the speed', Math.abs(p.vx[i]) < 0.01 && p.vx[i] > 0, p.vx[i]);
  const w = sys({ life: [10, 10], speed: [0, 0], drag: 4, wind: 1, maxLive: 4 });
  w.p.setWind(2, -1, 0.5);
  const hw = w.p.createEmitter(w.id, 0, 0, 0); w.p.burst(hw, 1); w.p.step();
  const j = firstLive(w.p);
  steps(w.p, 180);
  ok('drag converges velocity to the wind', Math.abs(w.p.vx[j] - 2) < 1e-3 && Math.abs(w.p.vy[j] + 1) < 1e-3 && Math.abs(w.p.vz[j] - 0.5) < 1e-3, `${w.p.vx[j]} ${w.p.vy[j]} ${w.p.vz[j]}`);
  ok('wind pushed the position downwind', w.p.px[j] > 2 && w.p.py[j] < -1);
  const f = sys({ life: [10, 10], speed: [0, 0], drag: 4, wind: 0.5, maxLive: 4 });
  f.p.setWind(4, 0, 0);
  const hf = f.p.createEmitter(f.id, 0, 0, 0); f.p.burst(hf, 1); f.p.step(); steps(f.p, 200);
  ok('wind factor 0.5 -> half the wind speed', Math.abs(f.p.vx[firstLive(f.p)] - 2) < 1e-3);
  const z = sys({ life: [10, 10], speed: [0, 0], drag: 4, wind: 0, maxLive: 4 });
  z.p.setWind(4, 0, 0);
  const hz = z.p.createEmitter(z.id, 0, 0, 0); z.p.burst(hz, 1); z.p.step(); steps(z.p, 100);
  ok('wind factor 0 ignores wind', z.p.vx[firstLive(z.p)] === 0);
  // per-emitter override
  const o = sys({ life: [10, 10], speed: [0, 0], drag: 6, wind: 1, maxLive: 4 });
  o.p.setWind(1, 0, 0);
  const a = o.p.createEmitter(o.id, 0, 0, 0), b = o.p.createEmitter(o.id, 0, 0, 0);
  o.p.setEmitterWind(b, 0, 3, 0);
  o.p.burst(a, 1); o.p.burst(b, 1); o.p.step(); steps(o.p, 200);
  const ia = (() => { for (let i = 0; i < o.p.cap; i++) if (o.p.alive[i] && o.p.em[i] === 0) return i; return -1; })();
  const ib = (() => { for (let i = 0; i < o.p.cap; i++) if (o.p.alive[i] && o.p.em[i] === 1) return i; return -1; })();
  ok('global wind for a, override for b', Math.abs(o.p.vx[ia] - 1) < 1e-3 && Math.abs(o.p.vy[ib] - 3) < 1e-3 && Math.abs(o.p.vx[ib]) < 1e-3);
}

// ---- sampleWind (duck-typed field) ----
{
  const field = { sampleInto(x, y, z, tick, out) { out[0] = 3 + x; out[1] = 0; out[2] = tick; return out; } };
  const { p, id } = sys({ life: [10, 10], speed: [0, 0], drag: 6, wind: 1, maxLive: 4 });
  const h = p.createEmitter(id, 1, 0, 0);
  p.burst(h, 1); p.step();
  p.sampleWind(field, 0);
  steps(p, 200);
  const i = firstLive(p);
  ok('sampleWind: emitter wind = field at the emitter position', Math.abs(p.vx[i] - 4) < 1e-3 && Math.abs(p.vy[i]) < 1e-3 && Math.abs(p.vz[i]) < 1e-3, `${p.vx[i]} ${p.vy[i]}`);
}

// ---- kill plane ----
{
  const { p, id } = sys({ life: [10, 10], accelZ: -9.8, killBelow: 0.5, maxLive: 8 });
  const h = p.createEmitter(id, 0, 0, 2); p.burst(h, 3); p.step();
  steps(p, 200);
  ok('killBelow removes particles once 0.5 m below the spawn z', p.stats.live === 0 && p.emitters.live[0] === 0);
  const n = sys({ life: [10, 10], accelZ: -9.8, maxLive: 8 });
  const hn = n.p.createEmitter(n.id, 0, 0, 2); n.p.burst(hn, 3); n.p.step(); steps(n.p, 200);
  ok('no killBelow: they keep falling', n.p.stats.live === 3);
}

// ---- burstAt transient + release ----
{
  const { p, id } = sys({ life: [0.25, 0.25], speed: [1, 1], burst: 6, maxLive: 16 });
  p.burstAt(id, 0, 0, 0, 5, 1, 0, 0);
  p.step();
  ok('burstAt spawns n particles along dx', p.stats.live === 5 && p.vx[firstLive(p)] === 1);
  let used = 0; for (let s = 0; s < MAX_EMITTERS; s++) used += p.emitters.used[s];
  ok('burstAt holds one emitter slot while particles live', used === 1);
  steps(p, 20);
  used = 0; for (let s = 0; s < MAX_EMITTERS; s++) used += p.emitters.used[s];
  ok('burstAt slot freed after the last death', p.stats.live === 0 && used === 0, `live=${p.stats.live} used=${used}`);
  p.burstAt(id, 0, 0, 0); p.step();
  ok('burstAt default count = def.burst', p.stats.live === 6);
  // release of a persistent emitter
  const r = sys({ rate: 60, life: [0.25, 0.25], maxLive: 32 });
  const h = r.p.createEmitter(r.id, 0, 0, 0); r.p.setOn(h, true); steps(r.p, 10);
  const sp = r.p.stats.spawned;
  r.p.release(h); r.p.setOn(h, true); steps(r.p, 40);
  ok('release stops spawning, ignores setOn, frees the slot at the last death', r.p.stats.spawned === sp && r.p.stats.live === 0 && !r.p.isValid(h));
  ok('stale handle is a no-op', (() => { r.p.setOn(h, true); r.p.burst(h, 5); r.p.step(); return r.p.stats.live === 0; })());
  // emitter slots exhausted
  const e = sys({ life: [10, 10] });
  let last = 0; for (let i = 0; i < MAX_EMITTERS; i++) last = e.p.createEmitter(e.id, 0, 0, 0);
  ok('64 emitters fit', last >= 0 && e.p.stats.dropped === 0);
  ok('65th createEmitter -> -1, dropped++', e.p.createEmitter(e.id, 0, 0, 0) === -1 && e.p.stats.dropped === 1);
  e.p.burstAt(e.id, 0, 0, 0, 3);
  ok('burstAt with no free slot is dropped', e.p.stats.dropped === 2 && e.p.stats.live === 0);
}

// ---- defineEmitter validation ----
{
  const p = createParticles();
  ok('bad life -> names key and prop', throwsMsg(() => p.defineEmitter('x1', { ...BASE, life: [2, 1] }), /"x1".*"life"/));
  ok('missing life', throwsMsg(() => p.defineEmitter('x2', { speed: [0, 1], glyphs: '@', colors: [[1, 2, 3]] }), /"x2".*"life"/));
  ok('spreadDeg >= 89', throwsMsg(() => p.defineEmitter('x3', mk({ spreadDeg: 90 })), /"x3".*"spreadDeg"/));
  ok('empty glyphs', throwsMsg(() => p.defineEmitter('x4', mk({ glyphs: '' })), /"x4".*"glyphs"/));
  ok('ramp > 16', throwsMsg(() => p.defineEmitter('x5', mk({ glyphs: 'abcdefghijklmnopq' })), /"x5".*"glyphs"/));
  ok('bad colour', throwsMsg(() => p.defineEmitter('x6', mk({ colors: [[1, 2, 300]] })), /"x6".*"colors"/));
  ok('wind > 1', throwsMsg(() => p.defineEmitter('x7', mk({ wind: 2 })), /"x7".*"wind"/));
  ok('sizeM > 1', throwsMsg(() => p.defineEmitter('xs', mk({ sizeM: 2 })), /"xs".*"sizeM"/));
  ok('sizeM < 0', throwsMsg(() => p.defineEmitter('xt', mk({ sizeM: -1 })), /"xt".*"sizeM"/));
  ok('zero dir', throwsMsg(() => p.defineEmitter('x8', mk({ dir: [0, 0, 0] })), /"x8".*"dir"/));
  const id = p.defineEmitter('ok', mk({ drag: 2, accelZ: 1 }));
  ok('define returns id; same key redefines in place', p.defineEmitter('ok', mk({})) === id && p.defIdOf('ok') === id && p.defIdOf('nope') === -1);
  let n = 1; for (let i = 0; i < 40 && n; i++) { try { p.defineEmitter('k' + i, mk({})); } catch (e) { n = 0; ok('33rd def throws', /more than 32/.test(e.message)); } }
  ok('createEmitter unknown defId throws', throwsMsg(() => p.createEmitter(99, 0, 0, 0), /unknown defId/));
  // compile: ramp stretched, seconds -> steps
  const q = createParticles(); const qi = q.defineEmitter('r', mk({ life: [0.5, 1], glyphs: 'ab', colors: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }));
  ok('life seconds -> steps (30..60)', q.defRec[qi * q.DEF_STRIDE + 1] === 30 && q.defRec[qi * q.DEF_STRIDE + 2] === 60);
  ok('ramps stretched to the longer one', q.defColors[qi * 16 * 3 + 6] === 7 && q.defGlyphs[qi * 16] === 97 && q.defGlyphs[qi * 16 + 2] === 98);
}

// ---- determinism ----
function script(seed) {
  const p = createParticles({ capacity: 256, seed });
  const a = p.defineEmitter('a', mk({ rate: 90, life: [0.3, 1.2], speed: [1, 3], spreadDeg: 40, box: [0.2, 0.2, 0.1], accelZ: 0.5, drag: 1.5, wind: 0.8, maxLive: 120 }));
  const b = p.defineEmitter('b', mk({ life: [0.2, 0.6], speed: [2, 6], spreadDeg: 80, accelZ: -9.8, killBelow: 3, burst: 30 }));
  const wind = { sampleInto(x, y, z, tick, out) { out[0] = 2 + (tick % 17) * 0.1 - x * 0.05; out[1] = 1 + (tick % 7) * 0.2; out[2] = 0; return out; } };
  const he = p.createEmitter(a, 0, 0, 0); p.setOn(he, true);
  const out = [];
  for (let t = 1; t <= 600; t++) {
    if (t % 97 === 0) p.burstAt(b, t * 0.01, 0, 1, 20, 0, 0, 1);
    if (t % 150 === 0) p.burst(he, 40);
    if (t === 300) p.setEmitterDir(he, 1, 1, 0);
    p.sampleWind(wind, t);
    p.step();
    if (t % 60 === 0) out.push(hashOf(p));
  }
  return out;
}
{
  const r1 = script(5), r2 = script(5), r3 = script(6);
  ok('determinism: equal hash at every 60-step checkpoint to 600 (10 checkpoints)', r1.length === 10 && r1.join() === r2.join());
  ok('different seed -> different hashes', r1[9] !== r3[9]);
  ok('hash differs checkpoint to checkpoint', new Set(r1).size === 10);
  const p = createParticles({ capacity: 64, seed: 9 }); const id = p.defineEmitter('t', mk({ rate: 30 }));
  const h = p.createEmitter(id, 0, 0, 0); p.setOn(h, true); steps(p, 50);
  const mid = hashOf(p);
  p.clear();
  ok('clear(): empty pool, stale handle, stats reset', p.stats.live === 0 && p.stats.spawned === 0 && !p.isValid(h) && hashOf(p) !== mid);
  const h2 = p.createEmitter(id, 0, 0, 0); p.setOn(h2, true); steps(p, 50);
  ok('clear() restarts the stream: replay gives the same hash', hashOf(p) === mid);
}

// ---- zero allocation (needs --expose-gc) + perf ----
function fillSystem(n) {
  const p = createParticles({ capacity: 2048, seed: 3 });
  const id = p.defineEmitter('load', mk({ rate: 0, life: [2, 2], speed: [1, 3], spreadDeg: 35, accelZ: 0.4, drag: 1, wind: 1, maxLive: 2048, burst: n }));
  const h = p.createEmitter(id, 0, 0, 0);
  p.setWind(1, 0.5, 0);
  return { p, id, h };
}
if (typeof globalThis.gc === 'function') {
  const { p, id, h } = fillSystem(0);
  p.setOn(h, true);
  const def2 = p.defineEmitter('load2', mk({ rate: 3000, life: [0.5, 1.5], speed: [1, 3], spreadDeg: 35, accelZ: 0.4, drag: 1, wind: 1, maxLive: 2048 }));
  const h2 = p.createEmitter(def2, 0, 0, 0); p.setOn(h2, true);
  const field = { sampleInto(x, y, z, tick, out) { out[0] = 2 + (tick & 7) * 0.1; out[1] = 0.5; out[2] = 0; return out; } };
  const hh = createHasher();
  const run = () => {
    for (let i = 0; i < 10000; i++) {
      p.sampleWind(field, i); p.burstAt(id, 0, 0, 0, 5);
      if (i % 100 === 0) { hh.reset(); p.hashInto(hh); }
      p.step();
    }
  };
  // Warm the complete measured workload, including bursts/hash and this loop's JIT code.
  run();
  gc(); const before = process.memoryUsage().heapUsed;
  run();
  gc(); const grew = process.memoryUsage().heapUsed - before;
  ok('zero heap growth over 10k steps (bursts, wind sampling, hashing, recycling)', grew < 64 * 1024, `${grew} bytes`);
  ok('...while the pool was busy', p.stats.live > 500 && p.stats.recycled > 0, `live=${p.stats.live} recycled=${p.stats.recycled}`);
} else {
  console.log('SKIP zero-allocation test (run with node --expose-gc)');
}

function bench(n) {
  const { p, id, h } = fillSystem(n);
  // hold the pool at n live: long life, no recycle
  const hold = createParticles({ capacity: 2048, seed: 3 });
  const hid = hold.defineEmitter('h', mk({ life: [600, 600], speed: [1, 3], spreadDeg: 35, accelZ: 0.4, drag: 1, wind: 1, maxLive: 2048 }));
  const he = hold.createEmitter(hid, 0, 0, 0); hold.setWind(1, 0.5, 0);
  hold.burst(he, n); hold.step();
  for (let i = 0; i < 300; i++) hold.step();
  const N = 2000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) hold.step();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  return { ms, live: hold.stats.live };
}
{
  bench(500); // warm
  const a = bench(500), b = bench(2048);
  console.log(`perf: ${a.live} live = ${a.ms.toFixed(4)} ms/step (bar 0.05), ${b.live} live = ${b.ms.toFixed(4)} ms/step (bar 0.15)`);
  const strict = process.env.PERF_STRICT === '1';
  const pa = a.live === 500 && a.ms <= 0.05, pb = b.live === 2048 && b.ms <= 0.15;
  if (strict) { ok('perf: 500 live <= 0.05 ms', pa, a.ms); ok('perf: 2048 live <= 0.15 ms', pb, b.ms); }
  else if (!pa || !pb) console.log('WARN perf bar missed (warn-only; machine may be loaded)');
  ok('perf pools held the requested live counts', a.live === 500 && b.live === 2048, `${a.live} ${b.live}`);
}

console.log(`particles.test.js: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('  FAIL ' + f); process.exit(1); }
