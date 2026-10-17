// ANIM-C-04: VoxelPool legs plumbing + fauna feed leg-driver wiring. Run: node engine/voxel/feedLegs.test.js
// (lives in voxel/: fauna may not import render). quadruped16 (has legRig) stands in for the future deer/fox/goat rigs.
import { compileFaunaDef } from '../fauna/faunaDef.js';
import { createFaunaFeed } from '../fauna/feed.js';
import { FIXTURE_FX, fixtureModels } from '../fauna/wildlifeFx.fixture.js';
import { VoxelPool } from '../render/voxelPool.js';
import { allocProbe } from '../../tools/allocProbe.mjs';
import { packVoxelModel } from './voxelPack.js';
import { clipSetPhase } from '../entities/clipPlayer.js';
import { computeVoxelPose } from './voxelPose.js';
import quadruped12 from './fixtures/quadruped12.js';
import quadruped16 from './fixtures/quadruped16.js';

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const def = compileFaunaDef(FIXTURE_FX, fixtureModels());
const pmNo = packVoxelModel(quadruped12, () => 1), pmRig = packVoxelModel(quadruped16, () => 1);
const WALK = 1;
function mkPool(pm) {
  const p = new VoxelPool(); p.renderer = 'mesh';
  for (const k of ['rabbit', 'deer', 'deerBuck']) p.models.set(k, pm);
  return p;
}
const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 0 };
function mkSlots() {
  const a = [];
  for (let i = 0; i < 3; i++) a.push({ alive: true, species: 1, model: 0, x: 0, y: -10 - i * 3, z: 0, yaw: 0, cp: { clip: WALK, frame: 0, tMs: 0, fromClip: -1, fromFrame: 0, fromTMs: 0, fadeMs: 0, fadeT: 0 } });
  return a;
}
const flat = { groundAt: () => 0 };
function run(pm, opts, frames) {
  const slots = mkSlots(), pool = mkPool(pm), f = createFaunaFeed(def, slots, opts);
  for (let k = 0; k < frames; k++) {
    for (const s of slots) { s.y -= 1.4 / 60; s.yaw = -Math.PI / 2; } // heading north
    pool.beginFrame(); f.feed(pool, cam);
  }
  return { slots, pool, f };
}

// 0. allocation first (before other sections warm the shared driver/feed code with other shapes: polymorphic feedback boxes doubles)
{
  if (typeof globalThis.gc === 'function') {
    const heap = (opts) => {
      const R = run(pmRig, opts, 90);
      const r = allocProbe((n) => { for (let k = 0; k < n; k++) { for (const s of R.slots) s.y -= 1.4 / 60; R.pool.beginFrame(); R.f.feed(R.pool, cam); } }, { n: 1500, warm: 8, windows: 6 });
      return r.bytes;
    };
    const base = heap({ legIk: false }), withLegs = heap({ ground: flat });
    ok(withLegs - base < 32 * 1024, 'driver adds ~0 B/frame over the plain feed, allocProbe min of 5 (' + (withLegs - base) + ' B / 1500 frames; base ' + base + ')');
  }
}

// 1. pool plumbing
{
  const pool = mkPool(pmRig);
  pool.beginFrame();
  const i = pool.pushInstance('deer', 0, 0, 0, 0, WALK, 0, 0);
  ok(pool.raw[i].legs === null, 'pushInstance: legs null');
  const lp = new Float64Array(16); lp[0] = 1;
  pool.legInstance(i, lp);
  ok(pool.raw[i].legs === lp, 'legInstance stores the reference');
  pool.legInstance(-1, lp); pool.legInstance(99, lp); // out of range: ignored
  pool.projectShadow();
  ok(pool.shadowList[0].legs === lp, 'projectShadow copies legs');
  pool.beginFrame(); const j = pool.pushInstance('deer', 0, 0, 0, 0, WALK, 0, 0);
  ok(pool.raw[j].legs === null, 'next frame push resets legs');
  // null legs: pose byte-identical to an instance without the field; w = 0 also identical
  const a = new Float64Array(16 * 24), b = new Float64Array(16 * 24), c = new Float64Array(16 * 24);
  const base = { x: 1, y: 2, z: 0, yawDeg: 30, clip: WALK, frame: 2, tMs: 90, scale: 1, addPart: -1 };
  computeVoxelPose(pmRig, base, a);
  computeVoxelPose(pmRig, { ...base, legs: null }, b);
  computeVoxelPose(pmRig, { ...base, legs: new Float64Array(16) }, c);
  ok(Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0 && Buffer.compare(Buffer.from(a.buffer), Buffer.from(c.buffer)) === 0, 'legs null / w=0 bit-identical pose');
}

// 2. model without legRig: inert, identical to legIk off
{
  const A = run(pmNo, { ground: flat }, 120), B = run(pmNo, { legIk: false }, 120);
  ok(A.f.stats.legs === 0 && A.f.legDriver.queries === 0, 'no legRig: nothing attached / queried');
  let same = A.pool.rawCount === B.pool.rawCount && A.pool.rawCount > 0;
  for (let i = 0; same && i < A.pool.rawCount; i++) { const x = A.pool.raw[i], y = B.pool.raw[i]; same = x.legs === null && y.legs === null && x.x === y.x && x.y === y.y && x.clip === y.clip; }
  ok(same, 'no legRig: raw instances identical, legs null');
}

// 3. rig present: legs flow to the pool; ?legik=0 turns it off
{
  const A = run(pmRig, { ground: flat }, 180);
  let n = 0; for (let i = 0; i < A.pool.rawCount; i++) if (A.pool.raw[i].legs) n++;
  ok(A.pool.rawCount === 3 && n === 3 && A.f.stats.legs === 3, 'rig: 3 animals carry a LegPose ' + n);
  const lp = A.pool.raw[0].legs;
  ok(lp[0] === 1 && lp.every(Number.isFinite) && Math.abs(lp[6]) < 5 && Math.abs(lp[5]) > 0, 'LegPose w = 1, foot targets finite and near the animal');
  const O = run(pmRig, { legIk: false, ground: flat }, 180);
  let m = 0; for (let i = 0; i < O.pool.rawCount; i++) if (O.pool.raw[i].legs) m++;
  ok(m === 0 && O.f.legDriver === null, 'legIk:false: driver never attaches');
  // not drawn -> released, slot reusable
  const slots = A.slots; for (const s of slots) s.alive = false;
  A.pool.beginFrame(); A.f.feed(A.pool, cam);
  const d = A.f.legDriver; d.io[0] = 0; // all slots released: attach works up to capacity
  ok(A.pool.rawCount === 0 && d.attach(pmRig) === 0, 'dead animals release their driver slots');
}

// 4. non-gait clip (idle without a stand clip entry / attack-like -1): authored legs
{
  const slots = mkSlots(), pool = mkPool(pmRig), f = createFaunaFeed(def, slots, { ground: flat });
  for (const s of slots) s.cp.clip = 7; // clip not in the rig's gait/stand tables
  for (let k = 0; k < 30; k++) { pool.beginFrame(); f.feed(pool, cam); }
  let n = 0; for (let i = 0; i < pool.rawCount; i++) if (pool.raw[i].legs) n++;
  ok(n === 0, 'unlisted clip: w stays 0 -> no legs handed to the pool');
}

// 5. determinism + 0 allocation of the feed with legs
{
  const A = run(pmRig, { ground: flat, }, 90), B = run(pmRig, { ground: flat }, 90);
  ok(Buffer.compare(Buffer.from(A.pool.raw[0].legs.buffer, A.pool.raw[0].legs.byteOffset, 128), Buffer.from(B.pool.raw[0].legs.buffer, B.pool.raw[0].legs.byteOffset, 128)) === 0, 'deterministic');
}
// 6. ANIM-C-04b: gait clip position = clipSetPhase(driver Phi); non-gait clip keeps its own clock
{
  const A = run(pmRig, { ground: flat }, 90);
  const lr = pmRig.legRig, d = A.f.legDriver;
  ok(lr.gaitClip[WALK] >= 0, 'fixture WALK is a gait clip');
  const sc = { clip: WALK, frame: 0, tMs: 0 };
  // the driver's phase per slot: re-run one more frame and compare against slot 0's io[8] after its update (last updated slot = 2)
  const slots = A.slots, pool = A.pool;
  for (const s of slots) { s.cp.frame = 3; s.cp.tMs = 17; }
  pool.beginFrame(); A.f.feed(pool, cam);
  const last = pool.raw[pool.rawCount - 1]; // farthest = updated last, io[8] holds its Phi
  clipSetPhase(sc, pmRig, d.io[8]);
  ok(last.frame === sc.frame && last.tMs === sc.tMs && last.legs && last.legs[0] > 0, 'gait clip frame/t = clipSetPhase(Phi) (' + last.frame + '/' + last.tMs + ')');
  const near = pool.raw[0];
  ok(!(near.frame === 3 && near.tMs === 17) || last.frame !== 3, 'phase overrides the clip player clock');
  const B = mkSlots(), pool2 = mkPool(pmRig), f2 = createFaunaFeed(def, B, { ground: flat });
  for (const s of B) { s.cp.clip = 7; s.cp.frame = 2; s.cp.tMs = 11; }
  pool2.beginFrame(); f2.feed(pool2, cam);
  ok(pool2.raw[0].frame === 2 && pool2.raw[0].tMs === 11, 'non-gait clip keeps its own clock');
  const C = mkSlots(), pool3 = mkPool(pmRig), f3 = createFaunaFeed(def, C, { legIk: false });
  for (const s of C) { s.cp.frame = 3; s.cp.tMs = 17; }
  pool3.beginFrame(); f3.feed(pool3, cam);
  ok(pool3.raw[0].frame === 3 && pool3.raw[0].tMs === 17, 'legIk off: clip player clock untouched');
}
console.log(`feedLegs.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
