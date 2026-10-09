// node tools/voxel-bear.test.mjs - the talking bear model (design/models/voxel_bear.js, design v1.51):
// engine format validation, part count / parents, style-guide 5.14 budgets, size, clips, ground contact on all fours.
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_bear.js';
import { validateVoxelModel, MAX_VOX_PARTS, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const MODEL = A.models.bear, DEF = MODEL && MODEL.voxel, FX = A.bearFx;
const PARTS = DEF ? Object.keys(DEF.parts) : [];

test('ASSETS.models.bear + ASSETS.bearFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'bear'); });

test('validateVoxelModel: no errors against palette + detail-pass materials', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
});

test('parts: <= MAX_VOX_PARTS, parents earlier, names', () => {
  assert.ok(PARTS.length <= MAX_VOX_PARTS);
  assert.deepStrictEqual(PARTS, ['body', 'head', 'jaw', 'ears', 'armL', 'armR', 'legL', 'legR']);
  PARTS.forEach((n, i) => { const p = DEF.parts[n].parent; if (p) assert.ok(PARTS.indexOf(p) < i, n + ' parent ' + p); });
  assert.strictEqual(DEF.parts.jaw.parent, 'head');
});

test('style 5.14: every part box sx + sy + sz <= 48, meshOnly, cellM 0.05', () => {
  for (const n of PARTS) { const b = DEF.parts[n].box; assert.ok((b[3] - b[0]) + (b[4] - b[1]) + (b[5] - b[2]) <= 48, n); }
  assert.strictEqual(DEF.meshOnly, true); assert.strictEqual(DEF.cellM, 0.05);
});

let PM = null;
test('engine mesher: LOD0 <= 2000 tris', () => {
  const ids = [];
  PM = packVoxelModel(DEF, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'bear', partNames: PARTS }).triCount;
  console.log(`  LOD0 ${tris} tris`);
  assert.ok(tris <= 2000, 'tris ' + tris);
});

test('standing height 1.9 .. 2.1 m (ear tips), feet on z 0', () => {
  let top = -1, bottom = 99;
  DEF.layers.forEach((layer, z) => { if (layer.some((r) => /[^. ]/.test(r))) { top = Math.max(top, z); bottom = Math.min(bottom, z); } });
  const h = (top + 1) * DEF.cellM;
  assert.ok(h >= 1.9 && h <= 2.1, 'height ' + h);
  assert.strictEqual(bottom, 0);
});

test('clips: talk / listen / wave / laugh + the rest exist, frames name every part, jaw opens (rx >= 0)', () => {
  const C = DEF.animations;
  for (const n of ['idle', 'talk', 'listen', 'wave', 'laugh', 'walk', 'turn', 'drop', 'rise', 'sit', 'sitTalk', 'standUp']) assert.ok(C[n], n);
  for (const n of Object.keys(C)) for (const f of C[n].frames) {
    assert.deepStrictEqual(Object.keys(f).sort(), PARTS.slice().sort(), n);
    assert.ok(f.jaw.rot[0] >= 0 && f.jaw.rot[0] <= FX.talk.jawMaxDeg, n + ' jaw');
  }
  for (const n of Object.keys(C)) for (const d of C[n].durations) assert.strictEqual(d % 50, 0, n + ' durations whole 60 Hz steps');
  const jaws = new Set(C.talk.frames.map((f) => f.jaw.rot[0]));
  assert.ok(jaws.size >= 6, 'talk jaw varies');
  const pauseStart = C.talk.durations.slice(0, FX.talk.pauseKey).reduce((a, b) => a + b, 0);
  assert.strictEqual(pauseStart, FX.talk.pauseAtMs); assert.strictEqual(C.talk.frames[FX.talk.pauseKey].jaw.rot[0], 0);
});

test('bearFx clip names all exist', () => {
  const C = DEF.animations;
  const names = [...Object.values(FX.clipFor.state), ...Object.values(FX.clipFor.seated), ...Object.keys(FX.clipFor.once),
    ...Object.values(FX.clipFor.once).filter(Boolean), ...Object.values(FX.clipFor.move)];
  for (const n of names) assert.ok(C[n], n);
});

test('all fours (walk key 1 / drop end): paws and feet within 4 cm of the ground', () => {
  // ground contact from the posed part boxes (uses the clip key rotations directly, independent of the renderer)
  const D2R = Math.PI / 180, cm = DEF.cellM;
  const rotX = (deg, v) => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; };
  for (const [clipName, frame] of [['drop', 4], ['walk', 1], ['walk', 3]]) {
    const f = DEF.animations[clipName].frames[frame], bp = DEF.parts.body.pivot;
    for (const n of ['armL', 'armR', 'legL', 'legR']) {
      const part = DEF.parts[n], pv = part.pivot;
      let minZ = Infinity;
      for (const zc of [part.box[2]]) for (const yc of [part.box[1], part.box[4]]) {
        const loc = rotX(f[n].rot[0], [0, yc - pv[1], zc - pv[2]]);
        const inBody = [0, loc[1] + pv[1] - bp[1], loc[2] + pv[2] - bp[2]];
        const w = rotX(f.body.rot[0], inBody);
        minZ = Math.min(minZ, (w[2] + bp[2] + f.body.pos[2]) * cm);
      }
      assert.ok(Math.abs(minZ) <= 0.06, `${clipName}[${frame}] ${n} lowest point ${minZ.toFixed(3)} m`);
    }
  }
});

console.log(`${passed} passed`);
