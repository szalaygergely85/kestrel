// WMP-03 test (suite filter: ambient, region). Run: node --expose-gc game/js/quest/regionAmbient.test.js
import { readFileSync } from 'node:fs';
import { createRegionAmbient, FADE_S } from './regionAmbient.js';

let failed = 0;
const ok = (n, c) => { if (!c) { failed++; console.error('FAIL:', n); } };
const table = JSON.parse(readFileSync(new URL('../../../content/life/regionAmbient.json', import.meta.url)));
const regions = [{ id: 'A', r: [0, 0, 100, 100] }, { id: 'ashMile', r: [100, 0, 200, 100] }, { id: 'none', r: [200, 0, 300, 100] }];
const mk = () => [{ name: 'songbird', cap: 10 }, { name: 'rabbit', cap: 10 }, { name: 'crow', cap: 6 }];
const dt = 1 / 60;

// no-entry region: caps untouched
let sp = mk(), ra = createRegionAmbient({ regions, table, species: sp });
for (let i = 0; i < 200; i++) ra.step(dt, 50, 50);
ok('no-entry caps identical', sp.every((s, i) => s.cap === mk()[i].cap) && ra.mul('songbird') === 1);

// switch into ashMile (found at the next 1 Hz check): monotonic fade, reaches target
let prev = 1, mono = true;
for (let i = 0; i < 70; i++) ra.step(dt, 150, 50);
for (let i = 0; i < 70; i++) { const m = ra.mul('songbird'); if (m > prev + 1e-12) mono = false; prev = m; ra.step(dt, 150, 50); }
ok('region reached', ra.region() === 'ashMile');
ok('songbird -> 0 and cap 0', ra.mul('songbird') === 0 && sp[0].cap === 0);
ok('crow -> 2.0, cap 12', ra.mul('crow') === 2 && sp[2].cap === 12);
ok('monotonic', mono);

// timing: first step resolves the region, target reached within FADE_S
sp = mk(); ra = createRegionAmbient({ regions, table, species: sp });
ra.step(dt, 150, 50);
let n = 0; while (ra.mul('songbird') !== 0 && n < 200) { ra.step(dt, 150, 50); n++; }
ok('fade within 1 s', n * dt <= FADE_S + dt);
// back to a no-entry region restores the exact base caps
for (let i = 0; i < 200; i++) ra.step(dt, 250, 50);
ok('restore identical', sp.every((s, i) => s.cap === mk()[i].cap));

// missing cues listed, never sent
ok('missing cues listed', ra.missingCues().includes('windLoop') && ra.needsAudioLines()[0].startsWith('NEEDS AUDIO: '));
const sink2 = [];
const ra2 = createRegionAmbient({ regions, table, species: mk(), knownCues: ['windLoop'], onCue: (i, v) => sink2.push([i, v]) });
for (let i = 0; i < 90; i++) ra2.step(dt, 150, 50);
ok('known cue sent, unknown not', sink2.length > 0 && sink2.every((e) => e[0] === 'windLoop') && Math.abs(ra2.vol('windLoop') - 0.7) < 1e-9);

// 0 alloc after warm-up
if (global.gc) {
  const ra3 = createRegionAmbient({ regions, table, species: mk(), knownCues: ['windLoop'], onCue: () => {} });
  for (let i = 0; i < 3000; i++) ra3.step(dt, i % 240 < 120 ? 150 : 250, 50);
  // window 1 absorbs one-off JIT/OSR cost; window 2 (steady state, 20000 steps) must stay under 20 KB total (<1 B/step)
  const win = () => { global.gc(); global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) ra3.step(dt, i % 240 < 120 ? 150 : 250, 50);
    global.gc(); global.gc(); return process.memoryUsage().heapUsed - h0; };
  win(); const d = win();
  ok('0 alloc (' + d + ' B)', d < 20000);
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('regionAmbient ok');
