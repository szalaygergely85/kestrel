// node tools/voxel-crocodile.test.mjs - BEAST-D1-CROC crocodile (design/models/voxel_crocodile.js): validation, tri budget,
// clip table, jaw-snap timing, blend speeds == legRig speeds, clipFor targets, FINAL scale_croc materials.
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_crocodile.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const D = A.models.crocodile && A.models.crocodile.voxel, FX = A.crocFx;

test('ASSETS.models.crocodile + crocFx exist', () => { assert.ok(D); assert.ok(FX); assert.strictEqual(FX.model, 'crocodile'); });

test('FINAL path: scale_croc, scale_croc_dark, scale_croc_light resolve in palette + detail-pass', () => {
  for (const k of ['scale_croc', 'scale_croc_dark', 'scale_croc_light']) {
    assert.ok(P.materials[k] && DP.materials[k], k);
    assert.ok(P.rgb[P.materials[k].base], k + ' base rgb');
  }
  assert.strictEqual(FX.finalMats, true);
  assert.deepStrictEqual([D.mats.B, D.mats.K, D.mats.O], ['scale_croc', 'scale_croc_dark', 'scale_croc_light']);
});

test('validateVoxelModel: 0 errors / warnings', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(D, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
});

// clip: [frames, total ms, loop]
const SPEC = { idle: [7, 6000, true], walk: [10, 1000, true], run: [6, 300, true], swim: [8, 1200, true], attack: [5, 600, false],
               grab: [4, 1000, true], recover: [3, 400, false], hurt: [2, 100, false], hitAdd: [4, 250, false], flinch: [3, 250, false],
               die: [5, 600, false], dead: [1, 1000, true], sink: [2, 600, false] };
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

test('attack: jaw is closed on the snap key that starts at 200 ms (and open on the launch key before)', () => {
  const at = D.animations.attack, k = FX.lunge.snapKey;
  assert.strictEqual(at.durations.slice(0, k).reduce((a, b) => a + b, 0), FX.lunge.snapMs, 'snap key start');
  assert.strictEqual(FX.lunge.snapMs, 200);
  assert.strictEqual(at.frames[k].jaw.rot[0], 0, 'jaw shut on snap key');
  assert.ok(at.frames[k - 1].jaw.rot[0] >= 30, 'jaw wide before the snap');
});

test('blend set speeds == legRig tunedMps == crocFx.speeds', () => {
  const set = D.blend.sets.locomotion.clips;
  assert.deepStrictEqual(set.map((c) => c.clip), ['walk', 'run']);
  assert.strictEqual(set[0].at, D.legRig.gaits.walk.tunedMps); assert.strictEqual(set[1].at, D.legRig.gaits.run.tunedMps);
  assert.strictEqual(FX.speeds.walk, set[0].at); assert.strictEqual(FX.speeds.run, set[1].at);
});

test('every clipFor entry names an existing clip', () => {
  const C = FX.clipFor;
  for (const g of [C.state, C.water]) for (const [k, v] of Object.entries(g)) if (k !== 'note') assert.ok(D.animations[v], 'clipFor ' + k + ' -> ' + v);
  for (const k of ['hurt', 'flinch', 'die', 'dead', 'sink']) assert.ok(D.animations[C[k]], 'clipFor.' + k);
  assert.ok(D.animations[D.blend.additive[C.hitAdditive].clip]);
});

test('engine mesher: LOD0 <= 3500 tris; clips pack', () => {
  const ids = [];
  const PM = packVoxelModel(D, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'crocodile', partNames: Object.keys(D.parts) }).triCount;
  console.log(`  LOD0 ${tris} tris`);
  assert.ok(tris <= 3500, 'tris ' + tris);
  for (const k of Object.keys(SPEC)) assert.ok(PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
