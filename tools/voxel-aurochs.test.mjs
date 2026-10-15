// node tools/voxel-aurochs.test.mjs - OB-153 aurochs (design/models/voxel_aurochs.js): validation, tri budget, clip table,
// hook timing, rest legs, beastView die / sink timing, blend speeds == legRig speeds, clipFor targets, eatFx registration.
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_eat_clips.js';
import '../design/models/voxel_aurochs.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const D = A.models.aurochs && A.models.aurochs.voxel, FX = A.aurochsFx;

test('ASSETS.models.aurochs + aurochsFx exist', () => { assert.ok(D); assert.ok(FX); assert.strictEqual(FX.model, 'aurochs'); });

test('validateVoxelModel: 0 errors / warnings (existing palette + detail-pass materials only)', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(D, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
});

test('parts: 13 (meshOnly, neck + knee rig), every box sum <= 48 (style 5.14), knees front / hocks back', () => {
  const names = Object.keys(D.parts);
  assert.strictEqual(names.length, 13); assert.strictEqual(D.meshOnly, true);
  for (const n of names) { const b = D.parts[n].box; assert.ok((b[3] - b[0]) + (b[4] - b[1]) + (b[5] - b[2]) <= 48, n); }
  assert.deepStrictEqual(D.legRig.legs.map((l) => l.bend), ['front', 'front', 'back', 'back']);
  assert.strictEqual(D.parts.head.parent, 'neck');
});

// clip: [frames, total ms, loop]
const SPEC = { idle: [6, 4000, true], walk: [12, 1200, true], run: [8, 600, true], charge: [8, 600, true], alert: [4, 2000, true],
               windup: [4, 600, false], attack: [5, 800, false], graze: [8, 3200, true], eat: [8, 3200, true],
               hurt: [2, 100, false], hitAdd: [4, 250, false], flinch: [3, 250, false], die: [5, 500, false],
               dead: [1, 1000, true], sink: [2, 600, false] };
test('clips: list, frame counts, durations, loop flags', () => {
  assert.deepStrictEqual(Object.keys(D.animations).sort(), Object.keys(SPEC).sort());
  for (const [k, [n, ms, loop]] of Object.entries(SPEC)) {
    const c = D.animations[k];
    assert.strictEqual(c.frames.length, n, k + ' frames'); assert.strictEqual(c.durations.length, n, k + ' durations');
    assert.strictEqual(c.durations.reduce((a, b) => a + b, 0), ms, k + ' total ms');
    assert.strictEqual(!!c.loop, loop, k + ' loop');
  }
  assert.strictEqual(D.animations.hurt.interp, 'step');
});

test('beastView timing: die = DIE_DURATIONS 90/110/120/80/100, sink = 500/100', () => {
  assert.deepStrictEqual(D.animations.die.durations, [90, 110, 120, 80, 100]);
  assert.deepStrictEqual(D.animations.sink.durations, [500, 100]);
});

test('idle key 0 = rest: every leg part unrotated (the in-file solve reproduces the rest stance)', () => {
  const f = D.animations.idle.frames[0];
  for (const l of D.legRig.legs) for (const p of [l.upper, l.lower]) assert.ok(Math.abs(f[p].rot[0]) < 0.05, p + ' ' + f[p].rot[0]);
});

test('graze: neck down (solved) on the muzzle-in-grass keys, head up on key 6', () => {
  const g = D.animations.graze.frames;
  assert.ok(g[0].neck.rot[0] > 30 && g[0].neck.rot[0] < 60, 'neck ' + g[0].neck.rot[0]);
  assert.ok(g[FX.graze.headUpKey].neck.rot[0] < g[0].neck.rot[0] - 20);
});

test('hook: key 2 starts at 300 ms and tosses the head up + sideways', () => {
  const at = D.animations.attack, k = FX.hook.hookKey;
  assert.strictEqual(at.durations.slice(0, k).reduce((a, b) => a + b, 0), FX.hook.hookMs);
  assert.ok(at.frames[k].neck.rot[0] < at.frames[k - 1].neck.rot[0] - 20, 'head comes up on the hook');
  assert.ok(at.frames[k].head.rot[2] !== 0, 'sideways toss');
});

test('blend set speeds == legRig tunedMps == aurochsFx.speeds', () => {
  const set = D.blend.sets.locomotion.clips;
  assert.deepStrictEqual(set.map((c) => c.clip), ['walk', 'run']);
  assert.strictEqual(set[0].at, D.legRig.gaits.walk.tunedMps); assert.strictEqual(set[1].at, D.legRig.gaits.run.tunedMps);
  assert.strictEqual(FX.speeds.walk, set[0].at); assert.strictEqual(FX.speeds.run, set[1].at);
});

test('every clipFor entry names an existing clip; the boar view names (idle / charge / windup / flinch / eat) exist', () => {
  const C = FX.clipFor;
  for (const [k, v] of Object.entries(C.state)) assert.ok(D.animations[v], 'clipFor ' + k + ' -> ' + v);
  for (const k of ['hurt', 'flinch', 'die', 'dead', 'sink']) assert.ok(D.animations[C[k]], 'clipFor.' + k);
  assert.ok(D.animations[D.blend.additive[C.hitAdditive].clip]);
  for (const k of ['idle', 'walk', 'charge', 'windup', 'flinch', 'hurt', 'die', 'dead', 'sink', 'eat']) assert.ok(D.animations[k], k);
});

test('eatFx (voxel_eat_clips.js loaded first) lists aurochs', () => {
  assert.ok(A.eatFx.models.indexOf('aurochs') >= 0);
  assert.strictEqual(A.eatFx.clip, 'eat');
});

test('engine mesher: LOD0 <= 3500 tris; clips pack', () => {
  const ids = [];
  const PM = packVoxelModel(D, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'aurochs', partNames: Object.keys(D.parts) }).triCount;
  console.log(`  LOD0 ${tris} tris`);
  assert.ok(tris <= 3500, 'tris ' + tris);
  for (const k of Object.keys(SPEC)) assert.ok(PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
