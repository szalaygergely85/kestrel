// node tools/voxel-wildlife.test.mjs - EP-WILD step 1 animals (design/models/voxel_wildlife.js, design v1.53):
// engine format validation, part count / parents, style-guide 5.14 budgets, realistic sizes, clip names + whole 60 Hz
// durations, feet on the ground in the standing clips (all fours; the rabbit's alert = sitting on its haunches), nothing
// sinks into the ground in any clip, grazing noses reach the grass, alert heads come up, wildlifeFx clip map.
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_wildlife.js';
import { validateVoxelModel, MAX_VOX_PARTS, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass, FX = A.wildlifeFx;
const KEYS = ['rabbit', 'deer', 'deerBuck'];
const LIMBS = ['legFL', 'legFR', 'legBL', 'legBR'];

// ---- forward kinematics, same maths as engine/voxel/voxelPose.js (R = Rz * Ry * Rx; child = parent * local) ----
const D2R = Math.PI / 180;
const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const app = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function rot(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R);
  const cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return mul([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], mul([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]));
}
function rig(key) {
  const DEF = A.models[key].voxel, PARTS = Object.keys(DEF.parts), CM = DEF.cellM, OWN = {};
  for (const n of PARTS) OWN[n] = [];
  DEF.layers.forEach((layer, z) => layer.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
    if (row[x] === '.') continue;
    const n = PARTS.find((k) => { const b = DEF.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    if (n) OWN[n].push([x, y, z]);
  } }));
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
  const worldZ = (T, p) => (app(T.A, p)[2] + T.b[2]) * CM;      // anchor z is 0, so grid z == height
  function lowest(T, part) {
    let m = Infinity;
    for (const [x, y, z] of OWN[part]) for (const dx of [0, 1]) for (const dy of [0, 1]) m = Math.min(m, worldZ(T[part], [x + dx, y + dy, z]));
    return m;
  }
  function highest(T, part) {
    let m = -Infinity;
    for (const [x, y, z] of OWN[part]) for (const dx of [0, 1]) for (const dy of [0, 1]) m = Math.max(m, worldZ(T[part], [x + dx, y + dy, z + 1]));
    return m;
  }
  return { DEF, PARTS, CM, OWN, posed, worldZ, lowest, highest };
}
const R = {};
for (const k of KEYS) if (A.models[k]) R[k] = rig(k);

test('ASSETS.models.rabbit / deer / deerBuck + ASSETS.wildlifeFx exist', () => {
  for (const k of KEYS) assert.ok(A.models[k] && A.models[k].voxel, k);
  assert.ok(FX && FX.animals.rabbit && FX.animals.deer);
});

test('validateVoxelModel: no errors, no warnings against palette + detail-pass materials', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  for (const k of KEYS) {
    const r = validateVoxelModel(R[k].DEF, { materialKeys: keys });
    assert.deepStrictEqual(r.errors, [], k);
    assert.deepStrictEqual(r.warnings, [], k);
  }
});

test('new fur materials: palette v1 + detail-pass v2 + remap, colours exist', () => {
  for (const m of ['fur_agouti', 'fur_agouti_dark', 'fur_agouti_light', 'fur_cream', 'fur_roe', 'fur_roe_dark', 'fur_roe_light', 'antler']) {
    assert.ok(P.materials[m], 'palette ' + m); assert.ok(DP.materials[m], 'detail-pass ' + m); assert.strictEqual(DP.remap[m], m);
    assert.ok(P.colors[P.materials[m].base], m + ' base colour');
  }
  const errs = DP.util && DP.util.validate ? DP.util.validate() : [];
  assert.deepStrictEqual(errs.filter((e) => /fur_|antler/.test(e)), []);
});

test('parts: <= MAX_VOX_PARTS, parents earlier, every part owns voxels; style 5.14 box sums <= 48; meshOnly', () => {
  for (const k of KEYS) {
    const { DEF, PARTS, OWN } = R[k];
    assert.ok(PARTS.length <= MAX_VOX_PARTS, k);
    PARTS.forEach((n, i) => { const p = DEF.parts[n].parent; if (p) assert.ok(PARTS.indexOf(p) < i, `${k} ${n} parent ${p}`); });
    for (const n of PARTS) {
      assert.ok(OWN[n].length > 0, `${k} ${n} owns voxels`);
      const b = DEF.parts[n].box;
      assert.ok((b[3] - b[0]) + (b[4] - b[1]) + (b[5] - b[2]) <= 48, `${k} ${n} box sum`);
    }
    for (const n of LIMBS) assert.ok(PARTS.includes(n), `${k} ${n}`);
    assert.strictEqual(DEF.meshOnly, true);
  }
  assert.strictEqual(R.rabbit.DEF.cellM, 0.02); assert.strictEqual(R.deer.DEF.cellM, 0.05);
});

test('engine mesher: LOD0 <= 2000 tris each', () => {
  for (const k of KEYS) {
    const ids = [];
    const PM = packVoxelModel(R[k].DEF, (m) => { let i = ids.indexOf(m); if (i < 0) { ids.push(m); i = ids.length - 1; } return i + 1; });
    const tris = buildVoxelMesh(PM, { id: k, partNames: R[k].PARTS }).triCount;
    let vox = 0; R[k].DEF.layers.forEach((l) => l.forEach((r) => { for (const c of r) if (c !== '.') vox++; }));
    console.log(`  ${k}: ${vox} voxels, LOD0 ${tris} tris`);
    assert.ok(tris <= 2000, `${k} tris ${tris}`);
  }
});

function extent(DEF) {
  let y0 = 1e9, y1 = -1;
  DEF.layers.forEach((l) => l.forEach((r, y) => { if (/[^.]/.test(r)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  return (y1 + 1 - y0) * DEF.cellM;
}
test('realistic sizes: rabbit ~0.4 m long, ~0.22 m back; deer ~1.6 m long, ~1.0 m at the withers; feet on z 0', () => {
  const rl = extent(R.rabbit.DEF), dl = extent(R.deer.DEF);
  const T0 = R.rabbit.posed(null), D0 = R.deer.posed(null);
  const rb = R.rabbit.highest(T0, 'body'), db = R.deer.highest(D0, 'body');
  console.log(`  rabbit ${rl.toFixed(2)} m long, back ${rb.toFixed(2)} m; deer ${dl.toFixed(2)} m long, withers ${db.toFixed(2)} m`);
  assert.ok(rl >= 0.38 && rl <= 0.46, 'rabbit length ' + rl);
  assert.ok(rb >= 0.18 && rb <= 0.26, 'rabbit back ' + rb);
  assert.ok(dl >= 1.5 && dl <= 1.7, 'deer length ' + dl);
  assert.ok(db >= 0.95 && db <= 1.05, 'deer withers ' + db);
  for (const k of KEYS) { const T = R[k].posed(null); for (const n of LIMBS) assert.ok(Math.abs(R[k].lowest(T, n)) < 1e-9, `${k} ${n} on z 0`); }
});

test('clips: names, frames name every part, durations whole 60 Hz steps (multiples of 50 ms)', () => {
  assert.deepStrictEqual(Object.keys(R.rabbit.DEF.animations).sort(), ['alert', 'graze', 'hop', 'idle', 'run', 'sitUp']);
  for (const k of ['deer', 'deerBuck']) assert.deepStrictEqual(Object.keys(R[k].DEF.animations).sort(), ['alert', 'gallop', 'graze', 'idle', 'trot', 'walk']);
  for (const k of KEYS) {
    const C = R[k].DEF.animations;
    for (const c of Object.keys(C)) {
      for (const f of C[c].frames) assert.deepStrictEqual(Object.keys(f).sort(), R[k].PARTS.slice().sort(), `${k} ${c}`);
      for (const d of C[c].durations) assert.strictEqual(d % 50, 0, `${k} ${c} duration ${d}`);
    }
  }
});

const within = (m, tol) => Math.abs(m) <= tol;
test('all fours: idle keeps all 4 feet within 2 cm; graze / alert keep >= 3 (one forefoot may step / stamp)', () => {
  for (const k of KEYS) {
    const r = R[k], C = r.DEF.animations;
    C.idle.frames.forEach((f, i) => { const T = r.posed(f); for (const n of LIMBS) assert.ok(within(r.lowest(T, n), 0.02), `${k} idle[${i}] ${n} ${r.lowest(T, n).toFixed(3)}`); });
    if (k === 'rabbit') {
      C.graze.frames.forEach((f, i) => { const T = r.posed(f); for (const n of LIMBS) assert.ok(within(r.lowest(T, n), 0.02), `rabbit graze[${i}] ${n} ${r.lowest(T, n).toFixed(3)}`); });
      continue;
    }
    for (const c of ['graze', 'alert']) C[c].frames.forEach((f, i) => {
      const T = r.posed(f), lows = LIMBS.map((n) => r.lowest(T, n));
      assert.ok(lows.filter((m) => within(m, 0.02)).length >= 3, `${k} ${c}[${i}] grounded ${lows.map((m) => m.toFixed(3))}`);
    });
  }
});

test('rabbit alert = sitting up on the haunches: hind feet planted, forepaws >= 5 cm up, eyes >= 8 cm higher than at rest', () => {
  const r = R.rabbit, C = r.DEF.animations, eye = r.DEF.mounts.eyes.at;
  const rest = r.worldZ(r.posed(null).head, eye);
  C.alert.frames.forEach((f, i) => {
    const T = r.posed(f);
    for (const n of ['legBL', 'legBR']) assert.ok(within(r.lowest(T, n), 0.02), `alert[${i}] ${n} ${r.lowest(T, n).toFixed(3)}`);
    for (const n of ['legFL', 'legFR']) assert.ok(r.lowest(T, n) >= 0.05, `alert[${i}] ${n} ${r.lowest(T, n).toFixed(3)}`);
    assert.ok(r.worldZ(T.head, eye) >= rest + 0.08, `alert[${i}] eye ${r.worldZ(T.head, eye).toFixed(3)} vs rest ${rest.toFixed(3)}`);
  });
  C.sitUp.frames.forEach((f, i) => { const T = r.posed(f); for (const n of ['legBL', 'legBR']) assert.ok(within(r.lowest(T, n), 0.02), `sitUp[${i}] ${n}`); });
});

test('nothing sinks: no part lower than -3 cm (rabbit) / -4 cm (deer) in any key of any clip', () => {
  for (const k of KEYS) {
    const r = R[k], tol = k === 'rabbit' ? 0.03 : 0.04;
    for (const c of Object.keys(r.DEF.animations)) r.DEF.animations[c].frames.forEach((f, i) => {
      const T = r.posed(f);
      for (const n of r.PARTS) { const m = r.lowest(T, n); assert.ok(m >= -tol, `${k} ${c}[${i}] ${n} ${m.toFixed(3)}`); }
    });
  }
});

test('graze: the nose reaches the grass (lowest head point 0 .. 4 cm rabbit, 0 .. 15 cm deer)', () => {
  for (const [k, hi] of [['rabbit', 0.04], ['deer', 0.15], ['deerBuck', 0.15]]) {
    const r = R[k];
    r.DEF.animations.graze.frames.forEach((f, i) => {
      const m = r.lowest(r.posed(f), 'head');
      if (k === 'rabbit' && f.head.rot[0] < 30) return;          // the chew / look-up keys
      assert.ok(m >= -0.01 && m <= hi, `${k} graze[${i}] head lowest ${m.toFixed(3)}`);
    });
  }
});

test('deer alert: eyes >= 4 cm higher than at rest; gallop: tail up (white flag) in every key', () => {
  for (const k of ['deer', 'deerBuck']) {
    const r = R[k], eye = r.DEF.mounts.eyes.at, rest = r.worldZ(r.posed(null).head, eye);
    r.DEF.animations.alert.frames.forEach((f, i) => { const e = r.worldZ(r.posed(f).head, eye); assert.ok(e >= rest + 0.04, `${k} alert[${i}] eye ${e.toFixed(3)} vs ${rest.toFixed(3)}`); });
    r.DEF.animations.gallop.frames.forEach((f, i) => assert.ok(f.tail.rot[0] >= 45, `${k} gallop[${i}] tail`));
  }
});

test('wildlifeFx: every state maps to an existing clip, gaits / speeds / distances sane', () => {
  for (const a of Object.keys(FX.animals)) {
    const X = FX.animals[a];
    for (const m of X.models) {
      const C = A.models[m].voxel.animations;
      for (const s of FX.states) assert.ok(C[X.clipFor[s]], `${a} ${m} state ${s} -> ${X.clipFor[s]}`);
      for (const g of X.gaits) assert.ok(C[g.clip], `${a} gait ${g.clip}`);
      for (const c of Object.keys(X.once || {})) { assert.ok(C[c], c); assert.ok(C[X.once[c]], X.once[c]); }
      for (const s of Object.keys(X.enter || {})) assert.ok(C[X.enter[s]], X.enter[s]);
    }
    assert.ok(X.dist.notice > X.dist.alert && X.dist.alert > X.dist.flee && X.dist.safe > X.dist.notice, a + ' distances');
    assert.ok(X.speeds.flee > X.speeds.wander, a + ' speeds');
  }
});

console.log(`${passed} passed`);
