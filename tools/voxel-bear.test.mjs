// node tools/voxel-bear.test.mjs - the talking bear model (design/models/voxel_bear.js, design v1.52 = bear v2):
// engine format validation, part count / parents, style-guide 5.14 budgets, realistic quadruped size, clips (names kept
// for the dialogue data), all four paws on the ground in every talking clip, the head raised toward the player in talk.
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
const CM = DEF ? DEF.cellM : 0.05;
const LIMBS = ['armL', 'armR', 'legL', 'legR'];

// ---- tiny forward kinematics, same maths as engine/voxel/voxelPose.js (R = Rz * Ry * Rx; child = parent * local) ----
const D2R = Math.PI / 180;
const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const app = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function rot(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
  const cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return mul([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], mul([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]));
}
function posed(frame) {
  const out = {};
  for (const n of PARTS) {
    const pd = DEF.parts[n], f = (frame && frame[n]) || {}, r = f.rot || [0, 0, 0], t = f.pos || [0, 0, 0];
    const R = rot(r[0], r[1], r[2]), rp = app(R, pd.pivot);
    const lb = [pd.pivot[0] + t[0] - rp[0], pd.pivot[1] + t[1] - rp[1], pd.pivot[2] + t[2] - rp[2]];
    if (!pd.parent) out[n] = { A: R, b: lb };
    else { const p = out[pd.parent], pb = app(p.A, lb); out[n] = { A: mul(p.A, R), b: [pb[0] + p.b[0], pb[1] + p.b[1], pb[2] + p.b[2]] }; }
  }
  return out;
}
const worldZ = (T, p) => (app(T.A, p)[2] + T.b[2]) * CM;   // anchor z is 0, so grid z == height
// voxels per part (the first box in insertion order owns a cell, as validateVoxelModel / packVoxelModel do)
const OWN = {};
if (DEF) {
  for (const n of PARTS) OWN[n] = [];
  DEF.layers.forEach((layer, z) => layer.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
    if (row[x] === '.') continue;
    const n = PARTS.find((k) => { const b = DEF.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    if (n) OWN[n].push([x, y, z]);
  } }));
}
function lowest(T, part) {    // lowest bottom-face corner of a part's voxels, metres
  let m = Infinity;
  for (const [x, y, z] of OWN[part]) for (const dx of [0, 1]) for (const dy of [0, 1]) m = Math.min(m, worldZ(T, [x + dx, y + dy, z]));
  return m;
}
function highest(T, part) {
  let m = -Infinity;
  for (const [x, y, z] of OWN[part]) for (const dx of [0, 1]) for (const dy of [0, 1]) m = Math.max(m, worldZ(T, [x + dx, y + dy, z + 1]));
  return m;
}

test('ASSETS.models.bear + ASSETS.bearFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'bear'); });

test('validateVoxelModel: no errors against palette + detail-pass materials', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
});

test('parts: <= MAX_VOX_PARTS, parents earlier, names, every part owns voxels', () => {
  assert.ok(PARTS.length <= MAX_VOX_PARTS);
  assert.deepStrictEqual(PARTS, ['body', 'head', 'jaw', 'ears', 'armL', 'armR', 'legL', 'legR']);
  PARTS.forEach((n, i) => { const p = DEF.parts[n].parent; if (p) assert.ok(PARTS.indexOf(p) < i, n + ' parent ' + p); });
  assert.strictEqual(DEF.parts.jaw.parent, 'head');
  for (const n of PARTS) assert.ok(OWN[n].length > 0, n + ' owns voxels');
});

test('style 5.14: every part box sx + sy + sz <= 48, meshOnly, cellM 0.05', () => {
  for (const n of PARTS) { const b = DEF.parts[n].box; assert.ok((b[3] - b[0]) + (b[4] - b[1]) + (b[5] - b[2]) <= 48, n); }
  assert.strictEqual(DEF.meshOnly, true); assert.strictEqual(DEF.cellM, 0.05);
});

test('engine mesher: LOD0 <= 3500 tris (v1.53 body detail pass; owner wants more detail, one NPC)', () => {
  const ids = [];
  const PM = packVoxelModel(DEF, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'bear', partNames: PARTS }).triCount;
  console.log(`  LOD0 ${tris} tris`);
  assert.ok(tris <= 3500, 'tris ' + tris + ' (lower FUR, then THIGH_OUTER false in voxel_bear.js)');
});

test('realistic quadruped rest pose: hump 1.0 .. 1.2 m, 1.5 .. 1.8 m long, head carried below the hump, paws on z 0', () => {
  const T = posed(null);
  const hump = highest(T.body, 'body'), head = highest(T.head, 'head');
  assert.ok(hump >= 1.0 && hump <= 1.2, 'hump ' + hump);
  assert.ok(head < hump - 0.1, `head top ${head.toFixed(2)} vs hump ${hump.toFixed(2)}`);
  let y0 = 99, y1 = -1;
  DEF.layers.forEach((l) => l.forEach((r, y) => { if (/[^.]/.test(r)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  const len = (y1 + 1 - y0) * CM;
  assert.ok(len >= 1.5 && len <= 1.8, 'length ' + len);
  assert.ok(len / hump >= 1.4, 'longer than tall: ' + (len / hump).toFixed(2));
  for (const n of LIMBS) assert.ok(Math.abs(lowest(T[n], n)) < 1e-9, n + ' on z 0');
});

test('clips: names kept (talk / listen / wave / laugh for the dialogue data), frames name every part, jaw 0..max', () => {
  const C = DEF.animations;
  assert.deepStrictEqual(Object.keys(C).sort(), ['idle', 'laugh', 'listen', 'talk', 'turn', 'walk', 'wave']);
  for (const n of Object.keys(C)) for (const f of C[n].frames) {
    assert.deepStrictEqual(Object.keys(f).sort(), PARTS.slice().sort(), n);
    assert.ok(f.jaw.rot[0] >= 0 && f.jaw.rot[0] <= FX.talk.jawMaxDeg, n + ' jaw');
  }
  for (const n of Object.keys(C)) for (const d of C[n].durations) assert.strictEqual(d % 50, 0, n + ' durations whole 60 Hz steps');
  const jaws = new Set(C.talk.frames.map((f) => f.jaw.rot[0]));
  assert.ok(jaws.size >= 6, 'talk jaw varies');
  const pauseStart = C.talk.durations.slice(0, FX.talk.pauseKey).reduce((a, b) => a + b, 0);
  assert.strictEqual(pauseStart, FX.talk.pauseAtMs); assert.strictEqual(C.talk.frames[FX.talk.pauseKey].jaw.rot[0], 0);
  assert.strictEqual(FX.talk.jawPart, 'jaw'); assert.strictEqual(FX.talk.jawAxis, 'rx'); assert.strictEqual(FX.talk.jawMaxDeg, 28);
  assert.deepStrictEqual(FX.talk.jawPivot, DEF.parts.jaw.pivot);
});

test('bearFx clip names all exist', () => {
  const C = DEF.animations;
  const names = [...Object.values(FX.clipFor.state), ...Object.keys(FX.clipFor.once),
    ...Object.values(FX.clipFor.once).filter(Boolean), ...Object.values(FX.clipFor.move)];
  for (const n of names) assert.ok(C[n], n);
});

test('all fours: every key of idle / talk / listen / laugh has all 4 paws within 2 cm of the ground', () => {
  for (const c of ['idle', 'talk', 'listen', 'laugh']) DEF.animations[c].frames.forEach((f, i) => {
    const T = posed(f);
    for (const n of LIMBS) { const m = lowest(T[n], n); assert.ok(Math.abs(m) <= 0.02, `${c}[${i}] ${n} lowest ${m.toFixed(3)} m`); }
  });
});

test('wave = paw raise on three legs: 3 paws planted every key, the right front paw >= 0.1 m up on keys 2..5', () => {
  DEF.animations.wave.frames.forEach((f, i) => {
    const T = posed(f);
    for (const n of ['armL', 'legL', 'legR']) { const m = lowest(T[n], n); assert.ok(Math.abs(m) <= 0.03, `wave[${i}] ${n} ${m.toFixed(3)}`); }
    if (i >= 2 && i <= 5) assert.ok(lowest(T.armR, 'armR') >= 0.1, `wave[${i}] armR ${lowest(T.armR, 'armR').toFixed(3)}`);
  });
});

test('walk / turn: passing keys all 4 paws within 2 cm; no paw deeper than 5 cm; turn keeps >= 2 paws planted', () => {
  DEF.animations.walk.frames.forEach((f, i) => {
    const T = posed(f);
    for (const n of LIMBS) {
      const m = lowest(T[n], n);
      if (i % 2) assert.ok(Math.abs(m) <= 0.02, `walk[${i}] ${n} ${m.toFixed(3)}`); else assert.ok(m >= -0.05, `walk[${i}] ${n} ${m.toFixed(3)}`);
    }
  });
  DEF.animations.turn.frames.forEach((f, i) => {
    const T = posed(f);
    const grounded = LIMBS.filter((n) => Math.abs(lowest(T[n], n)) <= 0.02).length;
    assert.ok(grounded >= 2, `turn[${i}] grounded ${grounded}`);
    for (const n of LIMBS) assert.ok(lowest(T[n], n) >= -0.03, `turn[${i}] ${n}`);
  });
});

test('talking head: eyes 0.7 .. 0.85 m at rest, raised >= 6 cm and nose up >= 15 deg in talk / listen', () => {
  const eye = DEF.mounts.eyes.at;
  const rest = worldZ(posed(null).head, eye);
  assert.ok(rest >= 0.7 && rest <= 0.85, 'rest eye ' + rest.toFixed(3));
  for (const c of ['talk', 'listen']) {
    const T = posed(DEF.animations[c].frames[0]).head;
    const e = worldZ(T, eye);
    assert.ok(e >= rest + 0.06, `${c} eye ${e.toFixed(3)} vs rest ${rest.toFixed(3)}`);
    const fwd = app(T.A, [0, -1, 0]);                     // the head's nose direction (grid -y = forward)
    const pitch = Math.atan2(fwd[2], Math.hypot(fwd[0], fwd[1])) / D2R;
    assert.ok(pitch >= 15, `${c} nose pitch ${pitch.toFixed(1)} deg`);
  }
  console.log(`  eyes: rest ${rest.toFixed(2)} m, talk ${worldZ(posed(DEF.animations.talk.frames[0]).head, eye).toFixed(2)} m`);
});

console.log(`${passed} passed`);
