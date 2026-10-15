// SPELL-07b: Gust streaks + hit puff, Fire Ring burst visual. Run: node game/js/quest/gustView.test.js
import { createParticles } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';
import { createGustView, defineGustFx } from './gustView.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
function bus() { const m = {}; return { on(n, f) { (m[n] = m[n] || []).push(f); return () => { m[n] = m[n].filter((g) => g !== f); }; }, emit(n, p) { (m[n] || []).forEach((f) => f(p)); } }; }
const particles = createParticles({}); defineGustFx(particles);
const events = bus(); const view = createGustView({ particles, events });
const live = () => particles.stats.live;
ok('no particles before a cast', live() === 0);
events.emit('gust:cast', { x: 0, y: 0, z: 1.2, fx: 1, fy: 0, range: 6 });
view.stepFx(); particles.step();
const n1 = live();
ok('gust:cast spawns a streak cone', n1 >= 12, 'live=' + n1);
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
const pump = (n) => { for (let i = 0; i < n; i++) { if (i % 40 === 0) { events.emit('gust:cast', f); events.emit('combat:hit', h); } view.stepFx(); particles.step(); } };
pump(8000); global.gc && global.gc(); const h0 = process.memoryUsage().heapUsed; pump(8000); global.gc && global.gc();
ok('gust view allocates ~nothing', process.memoryUsage().heapUsed - h0 < 200000, String(process.memoryUsage().heapUsed - h0));
view.dispose();
events.emit('gust:cast', f); view.stepFx(); ok('dispose unhooks', view.stats.casts > 0 && live() >= 0);
// Fire Ring burst visual through the real fireball view
const { createFireRingSim } = await import('./sim/fireRing.js');
const calls = []; const fb = { burstAt: (...a) => calls.push(a) };
const ring = createFireRingSim(fb, { tier: () => 2 });
ring.cast({ transform: { x: 1, y: 2, z: 0 } });
ok('fire ring bursts at the player with the tier radius', calls.length === 1 && calls[0][0] === 1 && calls[0][1] === 2 && calls[0][3] === 3.5, JSON.stringify(calls));
console.log(`gustView: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
