// engine/voxel/crossfade.test.js - WILD-01/02 (architecture.md 38.31 item 8): pose crossfade, clip player, gait.
//   node --expose-gc engine/voxel/crossfade.test.js
import { createRequire } from 'node:module';
import { packVoxelModel } from './voxelPack.js';
import { computeVoxelPose, FORWARD } from './voxelPose.js';
import { MAX_VOX_PARTS, PART_STRIDE } from './VoxelModel.js';
import { VoxelPool } from '../render/voxelPool.js';
import { createClipPlayer, clipPlay, clipStep, clipSetPhase, clipFromW } from '../entities/clipPlayer.js';
import { pickGait, gaitRate } from '../entities/gait.js';
import quadruped12 from './fixtures/quadruped12.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const req = createRequire(import.meta.url);
const boar = req('../../design/models/voxel_beast.js').boarPlaceholder;
const bear = req('../../design/models/voxel_bear.js').bear;
const models = { boar: packVoxelModel(boar.voxel || boar, () => 1), bear: packVoxelModel(bear.voxel || bear, () => 1), dummy: packVoxelModel(quadruped12, () => 1) };

const out = new Float64Array(MAX_VOX_PARTS * PART_STRIDE);
const snap = (pm, inst) => { computeVoxelPose(pm, inst, out); return [Float64Array.from(FORWARD.subarray(0, pm.partCount * 12)), Float64Array.from(out.subarray(0, pm.partCount * PART_STRIDE))]; };
const near = (a, b) => a[0].every((v, i) => Math.abs(v - b[0][i]) < 1e-9) && a[1].every((v, i) => Math.abs(v - b[1][i]) < 1e-9);
const same = (a, b) => a[0].every((v, i) => Object.is(v, b[0][i])) && a[1].every((v, i) => Object.is(v, b[1][i]));
const base = (extra) => Object.assign({ x: 1, y: 2, z: 3, yawDeg: 20, clip: -1, frame: 0, tMs: 0, scale: 1 }, extra);

for (const [name, pm] of Object.entries(models)) {
  const nc = pm.clips.length;
  ok(`${name}: has clips`, nc > 0);
  let allSame = true, w1 = true;
  for (let c = 0; c < nc; c++) {
    const nf = pm.clips[c].n;
    for (const f of [0, nf >> 1, nf - 1]) {
      const ref = snap(pm, base({ clip: c, frame: f, tMs: 17 }));
      const fc = (c + 1) % nc;
      const ff = Math.min(1, pm.clips[fc].n - 1);
      allSame = allSame && same(ref, snap(pm, base({ clip: c, frame: f, tMs: 17, fromClip: fc, fromFrame: 1, fromTMs: 5, fromW: 0 })))
        && same(ref, snap(pm, base({ clip: c, frame: f, tMs: 17, fromClip: -1, fromW: 1 })))
        && same(ref, snap(pm, base({ clip: c, frame: f, tMs: 17, fromClip: fc, fromW: -0.5 })));
      const fromPose = snap(pm, base({ clip: fc, frame: ff, tMs: 5 }));
      w1 = w1 && near(fromPose, snap(pm, base({ clip: c, frame: f, tMs: 17, fromClip: fc, fromFrame: ff, fromTMs: 5, fromW: 1 })));
    }
  }
  ok(`${name}: fromW 0 / fromClip -1 / negative weight byte-identical to no fields`, allSame);
  ok(`${name}: fromW 1 equals the from-clip pose (1e-9)`, w1);
}
{ // fromW 0.5 is the mid lerp
  const pm = models.boar;
  const p0 = snap(pm, base({ clip: 0 })), p1 = snap(pm, base({ clip: 1 }));
  const m = snap(pm, base({ clip: 0, fromClip: 1, fromFrame: 0, fromTMs: 0, fromW: 0.5 }));
  const q = snap(pm, base({ clip: 1, fromClip: 0, fromFrame: 0, fromTMs: 0, fromW: 0.5 }));
  ok('0.5 blend differs from both ends', !same(m, p0) && !same(m, p1));
  ok('0.5 blend is symmetric (cur/from swapped)', m[0].every((v, i) => Math.abs(v - q[0][i]) < 1e-9));
}

// ---- pool API ----
const registry = { keys: (k) => (k === 'model' ? ['boar'] : []), model: () => ({ voxel: boar.voxel || boar }) };
const mats = { idFor: () => 1 };
{
  const pool = new VoxelPool();
  pool.bind(registry, mats);
  pool.beginFrame();
  const i0 = pool.pushInstance('boar', 0, 0, 0, 0, 0, 0, 0);
  const iBad = pool.pushInstance('nope', 0, 0, 0, 0, 0, 0, 0);
  const i1 = pool.pushInstance('boar', 1, 0, 0, 0, 0, 0, 0);
  ok('pushInstance returns raw index / -1 when dropped', i0 === 0 && iBad === -1 && i1 === 1);
  pool.blendInstance(i1, 1, 2, 3, 0.4);
  const s = pool.raw[1];
  ok('blendInstance sets the slot, other slot untouched', s.fromClip === 1 && s.fromFrame === 2 && s.fromTMs === 3 && s.fromW === 0.4 && pool.raw[0].fromW === 0 && pool.raw[0].fromClip === -1);
  pool.blendInstance(-1, 1, 0, 0, 1); pool.blendInstance(9, 1, 0, 0, 1);
  pool.beginFrame();
  const j = pool.pushInstance('boar', 1, 0, 0, 0, 0, 0, 0);
  ok('re-push resets the from-clip', j === 0 && pool.raw[0].fromW === 0 && pool.raw[0].fromClip === -1);
}
{ // projected + shadow slots carry the from fields
  const pool = new VoxelPool();
  pool.bind(registry, mats);
  pool.beginFrame();
  const i = pool.pushInstance('boar', 0, 0, 0, 0, 0, 0, 0);
  pool.blendInstance(i, 1, 1, 7, 0.25);
  const sl = pool._slots[0], sh = pool._shadowSlots[0];
  ok('slot records have the from fields', 'fromClip' in sl && 'fromW' in sl && 'fromClip' in sh && 'fromTMs' in sh && pool.raw[i].fromW === 0.25);
  const cam = { x: 0, y: -6, z: 2, yawDeg: 0, pitchDeg: 0, fovDeg: 60, aspect: 1.6 };
  let projected = false;
  try {
    if (typeof pool.projectShadow === 'function') { pool.projectShadow(); projected = pool.shadowList.length === 1 && pool.shadowList[0].fromW === 0.25 && pool.shadowList[0].fromTMs === 7; }
  } catch (e) { projected = 'err ' + e.message; }
  if (typeof pool.projectShadow === 'function') ok('shadow slot copies the from fields', projected === true, String(projected));
  void cam;
}

// ---- clip player ----
{
  const pm = models.boar;
  const c = pm.clips[0];
  let total = 0; for (let i = 0; i < c.n; i++) total += c.durMs[i];
  const lap = (rate) => { const p = createClipPlayer(); clipPlay(p, pm, 0, true, 0); p.rate = rate; let t = 0, wrapped = false; for (; t < total * 3 && !wrapped; t += 1) { const f0 = p.frame; clipStep(p, pm, 1); if (p.frame < f0) wrapped = true; } return t; };
  const l1 = lap(1), l2 = lap(2);
  ok('rate x2 = half the lap time', Math.abs(l1 / l2 - 2) < 0.05, `${l1} ${l2}`);
  const p = createClipPlayer(); clipPlay(p, pm, 0, true, 0); clipSetPhase(p, pm, 0.5);
  let acc = 0; for (let i = 0; i < p.frame; i++) acc += c.durMs[i]; acc += p.tMs;
  ok('phase 0.5 lands mid-clip', Math.abs(acc - total / 2) < 1e-6);
  const q = createClipPlayer(); clipPlay(q, pm, 0, false, 0, 1);
  for (let i = 0; i < total + 50; i++) clipStep(q, pm, 1);
  ok('once -> next switches to next (looping)', q.clip === 1 && q.loop === true && q.next === -1);
  const h = createClipPlayer(); clipPlay(h, pm, 0, false, 0);
  for (let i = 0; i < total + 50; i++) clipStep(h, pm, 1);
  ok('once without next holds the last frame', h.clip === 0 && h.frame === c.n - 1);
  const f = createClipPlayer(); clipPlay(f, pm, 0, true, 0); clipStep(f, pm, 30);
  clipPlay(f, pm, 1, true, 100);
  const w = [clipFromW(f)]; for (let i = 0; i < 4; i++) { clipStep(f, pm, 25); w.push(clipFromW(f)); }
  ok('fade starts at 1, ends at 0, monotone', w[0] === 1 && w[4] === 0 && w.every((v, i) => i === 0 || v <= w[i - 1]), w.join());
  ok('fade mid is 0.5 (smoothstep)', (() => { const g = createClipPlayer(); clipPlay(g, pm, 0, true, 0); clipPlay(g, pm, 1, true, 100); g.fadeT = 50; return Math.abs(clipFromW(g) - 0.5) < 1e-12; })());
  ok('fade finished clears the from-clip', f.fromClip === -1 && clipFromW(f) === 0);
  ok('clipFromW 0 with no fade', clipFromW(createClipPlayer()) === 0);
}

// ---- gait ----
{
  const rabbit = [
    { clip: 'hop', tunedMps: 0.6, minMps: 0.3, maxMps: 1.5, rate: [0.6, 2.0] },
    { clip: 'run', tunedMps: 1.8, minMps: 1.5, maxMps: 8.0, rate: [1.0, 1.6] },
  ];
  ok('pickGait basic', pickGait(rabbit, 0.7, -1) === 0 && pickGait(rabbit, 5, -1) === 1);
  let cur = 0, flips = 0;
  for (const s of [1.4, 1.5, 1.55, 1.5, 1.45, 1.6, 1.5]) { const n = pickGait(rabbit, s, cur); if (n !== cur) flips++; cur = n; }
  ok('no flip-flop at 1.5 m/s (hysteresis 0.15)', flips === 0 && cur === 0);
  cur = 1; flips = 0;
  for (const s of [1.6, 1.5, 1.4, 1.5, 1.55]) { const n = pickGait(rabbit, s, cur); if (n !== cur) flips++; cur = n; }
  ok('no flip-flop going the other way', flips === 0 && cur === 1);
  ok('leaves the gait beyond the hysteresis band', pickGait(rabbit, 1.7, 0) === 1 && pickGait(rabbit, 1.2, 1) === 0);
  ok('gaitRate clamped to rate[]', gaitRate(rabbit[0], 0.01) === 0.6 && gaitRate(rabbit[0], 99) === 2.0 && Math.abs(gaitRate(rabbit[0], 0.9) - 1.5) < 1e-12);
}

// ---- zero allocation ----
{
  const pm = models.boar;
  const p = createClipPlayer(); clipPlay(p, pm, 0, true, 0);
  const inst = base({ clip: 0, fromClip: 1, fromFrame: 0, fromTMs: 0, fromW: 0.5 });
  const g = [{ clip: 'a', tunedMps: 1, minMps: 0, maxMps: 2, rate: [0.5, 2] }];
  const run = (n) => { let acc = 0; for (let i = 0; i < n; i++) { clipPlay(p, pm, i & 1, true, 80); clipStep(p, pm, 16); clipSetPhase(p, pm, 0.3); acc += clipFromW(p) + gaitRate(g[0], 1.2) + pickGait(g, 1, 0); inst.fromTMs = i % 40; computeVoxelPose(pm, inst, out); } return acc; };
  run(2000);
  if (global.gc) {
    global.gc(); const h0 = process.memoryUsage().heapUsed; run(100000); global.gc();
    const d = process.memoryUsage().heapUsed - h0;
    ok('zero allocation (<1 B/step over 100000 pose + clip + gait steps)', d < 100000, `${d} B`);
  } else console.log('(run with --expose-gc for the allocation check)');
}

console.log(`crossfade.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.log('FAIL ' + f); process.exit(1); }
