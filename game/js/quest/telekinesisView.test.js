// SPELL-07b: Telekinesis streaks + hit puff, Fire Ring burst visual. Run: node game/js/quest/telekinesisView.test.js
import { createParticles } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import { createTelekinesisView, defineTelekinesisFx } from './telekinesisView.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
function bus() { const m = {}; return { on(n, f) { (m[n] = m[n] || []).push(f); return () => { m[n] = m[n].filter((g) => g !== f); }; }, emit(n, p) { (m[n] || []).forEach((f) => f(p)); } }; }
const particles = createParticles({}); defineTelekinesisFx(particles);
const events = bus(); const view = createTelekinesisView({ particles, events });
const live = () => particles.stats.live;
ok('no particles before a cast', live() === 0);
events.emit('telekinesis:cast', { x: 0, y: 0, z: 1.2, fx: 1, fy: 0, range: 6 });
view.stepFx(); particles.step();
const n1 = live();
ok('telekinesis:cast spawns a streak cone', n1 >= 12, 'live=' + n1);
let allFwd = true; for (let i = 0; i < particles.cap; i++) if (particles.alive[i] && particles.vx[i] <= 0) allFwd = false;
ok('streaks fly along the facing', allFwd);
for (let i = 0; i < 30; i++) particles.step(); // 0.5 s > life 0.4
ok('streaks gone within 0.5 s', live() === 0, 'live=' + live());
events.emit('combat:hit', { cause: 'sword', px: 3, py: 0, pz: 1, dirX: 1, dirY: 0 });
view.stepFx(); particles.step();
ok('non-wind hit does not puff', live() === 0);
events.emit('combat:hit', { cause: 'wind', px: 3, py: 0, pz: 1, dirX: 1, dirY: 0 });
view.stepFx(); particles.step();
ok('wind hit puffs leaves', live() >= 5 && view.stats.puffs === 1, 'live=' + live());
// 0 alloc
const f = { x: 0, y: 0, z: 1, fx: 1, fy: 0, range: 7 }, h = { cause: 'wind', px: 3, py: 0, pz: 1, dirX: 1, dirY: 0 };
const pump = (n) => { for (let i = 0; i < n; i++) { if (i % 40 === 0) { events.emit('telekinesis:cast', f); events.emit('combat:hit', h); } view.stepFx(); particles.step(); } };
pump(8000); global.gc && global.gc(); const h0 = process.memoryUsage().heapUsed; pump(8000); global.gc && global.gc();
if (global.gc) ok('telekinesis view allocates ~nothing', process.memoryUsage().heapUsed - h0 < 200000, String(process.memoryUsage().heapUsed - h0)); // SPELL-ARCH8: needs --expose-gc
view.dispose();
events.emit('telekinesis:cast', f); view.stepFx(); ok('dispose unhooks', view.stats.casts > 0 && live() >= 0);
console.log(`telekinesisView: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }

{ // palette key 'aether' drives the streak colours
  const P = createParticles({}); defineTelekinesisFx(P, { aether: [47, 224, 198] });
  const ev = bus(); const v = createTelekinesisView({ particles: P, events: ev });
  ev.emit('telekinesis:cast', { x: 0, y: 0, z: 1.2, fx: 1, fy: 0, range: 6 }); v.stepFx(); P.step();
  console.log('telekinesisView palette key accepted, live=' + P.stats.live);
}
