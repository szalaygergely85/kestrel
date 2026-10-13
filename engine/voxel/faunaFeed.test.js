// Run: node engine/voxel/faunaFeed.test.js (lives here: fauna may not import render) (re-spawns itself with --expose-gc if missing). WILD-05.
import { spawnSync } from 'node:child_process';
import { compileFaunaDef } from '../fauna/faunaDef.js';
import { createFaunaFeed } from '../fauna/feed.js';
import { FIXTURE_FX, fixtureModels } from '../fauna/wildlifeFx.fixture.js';
import { VoxelPool } from '../render/voxelPool.js';
import { packVoxelModel } from './voxelPack.js';
import { createClipPlayer, clipPlay, clipStep } from '../entities/clipPlayer.js';
import quadruped12 from './fixtures/quadruped12.js';
if (typeof globalThis.gc !== 'function') {
  const r = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

const def = compileFaunaDef(FIXTURE_FX, fixtureModels());
const pm = packVoxelModel(quadruped12, () => 1);
function mkPool() {
  const p = new VoxelPool(); p.renderer = 'mesh';
  for (const k of ['rabbit', 'deer', 'deerBuck']) p.models.set(k, pm);
  return p;
}
// fake slot set: species 0 = rabbit (drawM 35), 1 = deer (drawM 90); camera at origin looking north (yaw 0 -> dir (0,-1))
function mkSlots(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push({ alive: false, species: 0, model: 0, x: 0, y: 0, z: 0, yaw: 0, cp: null });
  return a;
}
const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 0 };
const place = (s, sp, x, y) => { s.alive = true; s.species = sp; s.x = x; s.y = y; };

// 1. nearest-first, filters
{
  const slots = mkSlots(8), pool = mkPool(), f = createFaunaFeed(def, slots);
  place(slots[0], 0, 0, -20);      // rabbit 20 m ahead: drawn
  place(slots[1], 0, 0, -10);      // nearer, drawn
  place(slots[2], 0, 0, 20);       // behind, 20 m: culled (outside cone, > 6 m)
  place(slots[3], 0, 0, 3);        // behind but < 6 m: drawn
  place(slots[4], 0, 0, -40);      // rabbit beyond drawM 35: culled
  place(slots[5], 1, 0, -80);      // deer within drawM 90: drawn
  place(slots[6], 0, -15, -15);    // 45 deg off, in cone (hfov 75/2+10 = 47.5): drawn
  slots[7].alive = false;
  pool.beginFrame();
  const n = f.feed(pool, cam);
  ok(n === 5 && pool._rawCount === 5, 'drawn 5, got ' + n);
  const ds = []; for (let i = 0; i < pool._rawCount; i++) ds.push(Math.hypot(pool.raw[i].x, pool.raw[i].y));
  ok(ds.every((d, i) => i === 0 || ds[i - 1] <= d), 'nearest first ' + ds.join(','));
  ok(pool.raw[0].y === 3 && pool.raw[1].y === -10, 'first two are the 3 m and 10 m animals');
  ok(pool.raw[0].clip === -1, 'no clip player -> rest pose');
}
// 2. drawMax 20 and 4 spare slots, with gameplay pushes already queued
{
  const slots = mkSlots(40), pool = mkPool(), f = createFaunaFeed(def, slots);
  for (let i = 0; i < 40; i++) place(slots[i], 0, (i % 5) - 2, -2 - i * 0.5);
  pool.beginFrame();
  ok(f.feed(pool, cam) === 20, '40 alive -> 20 drawn');
  // nearest 20 are the drawn ones
  let maxD = 0; for (let i = 0; i < pool._rawCount; i++) maxD = Math.max(maxD, Math.hypot(pool.raw[i].x, pool.raw[i].y));
  let minOut = 1e9; for (let i = 0; i < 40; i++) { const d = Math.hypot(slots[i].x, slots[i].y); if (d > maxD + 1e-9) minOut = Math.min(minOut, d); }
  ok(minOut >= maxD, 'every undrawn animal is farther than the farthest drawn');
  pool.beginFrame();
  for (let i = 0; i < 40; i++) pool.pushInstance('rabbit', 0, 0, 0, 0, -1, 0, 0); // 40 gameplay pushes
  const n = f.feed(pool, cam);
  ok(n === 4, 'cap 48 - 40 pushed - 4 spare = 4 fed, got ' + n);
  ok(pool._rawCount === 44 && pool.cap - pool._rawCount === 4, '4 slots stay free');
  pool.beginFrame();
  for (let i = 0; i < 45; i++) pool.pushInstance('rabbit', 0, 0, 0, 0, -1, 0, 0);
  ok(f.feed(pool, cam) === 0, 'no room -> 0 drawn');
}
// 3. crossfade via blendInstance
{
  const slots = mkSlots(2), pool = mkPool(), f = createFaunaFeed(def, slots);
  place(slots[0], 0, 0, -5); place(slots[1], 0, 0, -6);
  const cp = createClipPlayer(); clipPlay(cp, pm, 0, true, 0); clipPlay(cp, pm, 1, true, 200);
  clipStep(cp, pm, 50);
  slots[0].cp = cp; slots[1].cp = createClipPlayer(); clipPlay(slots[1].cp, pm, 1, true, 0);
  pool.beginFrame(); f.feed(pool, cam);
  const a = pool.raw[0], b = pool.raw[1];
  ok(a.clip === 1 && a.fromClip === 0 && a.fromW > 0 && a.fromW < 1, 'fading: from-clip set, w=' + a.fromW);
  ok(b.fromClip === -1 && b.fromW === 0, 'not fading: no from-clip');
  clipStep(cp, pm, 400);
  pool.beginFrame(); f.feed(pool, cam);
  ok(pool.raw[0].fromClip === -1 && pool.raw[0].fromW === 0, 'fade over -> plain');
}
// 4. zero allocation
{
  const slots = mkSlots(40), pool = mkPool(), f = createFaunaFeed(def, slots);
  for (let i = 0; i < 40; i++) { place(slots[i], i % 2, (i % 7) - 3, -2 - i); slots[i].cp = createClipPlayer(); clipPlay(slots[i].cp, pm, 0, true, 0); clipPlay(slots[i].cp, pm, 1, true, 500); }
  for (let i = 0; i < 2000; i++) { pool.beginFrame(); f.feed(pool, cam); }
  gc(); const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) { pool.beginFrame(); f.feed(pool, cam); }
  gc(); const dh = process.memoryUsage().heapUsed - h0;
  ok(dh < 100000, 'feed heap growth ' + dh + ' B over 2e4 frames');
}
// 5. hook wiring (no hook = byte-identical frame; hook sits right after collect)
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../render/frameRenderer.js', import.meta.url), 'utf8');
  ok(/voxelPool\.collect\(world, cam\);\s*\n\s*if \(engine\.feedVoxels\) engine\.feedVoxels\(voxelPool, cam\);/.test(src), 'frameRenderer calls engine.feedVoxels right after collect, guarded');
}
console.log(`feed.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
