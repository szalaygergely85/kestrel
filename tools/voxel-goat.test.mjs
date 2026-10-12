// node tools/voxel-goat.test.mjs - CRAG-D1 Crag, the old goat of Signal Head (design/models/voxel_goat.js): the deer's
// 4-leg rig + Burl's jaw. Valid materials, size (~0.8 m withers, horns above), the clip set + frame counts, talk jaw sync
// data, never upright, four hooves planted (x/y) and ground-snapped (FK, pitch-only) in every key except the stepping
// pairs of walk / lead and the climbStep lifts, head + beard never under the ground, tris <= 3500 (bear beast budget).
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_goat.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const DEF = A.models.goat && A.models.goat.voxel, FX = A.goatFx;
const LIMBS = ['legFL', 'legFR', 'legBL', 'legBR'], D2R = Math.PI / 180;

function owned(D) {           // part -> [[x, y, z], ...] (first box wins, part insertion order)
  const names = Object.keys(D.parts), out = {}; names.forEach((k) => { out[k] = []; }); out._none = [];
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    const own = names.find((k) => { const b = D.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    out[own || '_none'].push([x, y, z]);
  } }));
  return out;
}
const OWN = DEF ? owned(DEF) : {};
// pitch-only FK (same convention as the model's ground solve): rotate (y, z) about the pivot by rx, then add pos
function xf(p, part, f) {
  const pv = DEF.parts[part].pivot, st = f[part] || {}, a = ((st.rot && st.rot[0]) || 0) * D2R, pos = st.pos || [0, 0, 0];
  const dy = p[0] - pv[1], dz = p[1] - pv[2];
  return [pv[1] + dy * Math.cos(a) - dz * Math.sin(a) + (pos[1] || 0), pv[2] + dy * Math.sin(a) + dz * Math.cos(a) + (pos[2] || 0)];
}
function minZ(part, f) {      // lowest world z (voxels) of a part's cells, through its parent chain
  let m = 1e9;
  for (const [, y, z] of OWN[part]) for (const cy of [0, 1]) for (const cz of [0, 1]) {
    let p = [y + cy, z + cz], k = part;
    while (k) { p = xf(p, k, f); k = DEF.parts[k].parent; }
    if (p[1] < m) m = p[1];
  }
  return m;
}

test('ASSETS.models.goat + ASSETS.goatFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'goat'); assert.strictEqual(FX.character, 'Crag'); });

test('validateVoxelModel: no errors / warnings against palette + detail-pass materials; every voxel owned', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(DEF.meshOnly, true);
  assert.strictEqual(OWN._none.length, 0, 'unowned voxels ' + JSON.stringify(OWN._none.slice(0, 5)));
});

test('rig: deer ungulate parts + jaw, tail in the body (8 = engine max), parents earlier, box sx+sy+sz <= 48, no empty part', () => {
  assert.deepStrictEqual(Object.keys(DEF.parts), ['body', 'head', 'jaw', 'ears', ...LIMBS]);
  const names = Object.keys(DEF.parts);
  for (const [k, p] of Object.entries(DEF.parts)) {
    if (p.parent) assert.ok(names.indexOf(p.parent) < names.indexOf(k), k + ' parent order');
    const b = p.box; assert.ok(b[3] - b[0] + b[4] - b[1] + b[5] - b[2] <= 48, k + ' box size');
    assert.ok(OWN[k].length > 0, k + ' owns voxels');
  }
  assert.strictEqual(DEF.parts.jaw.parent, 'head');
});

test('size: withers ~0.8 m, horns above the withers, beard on the jaw, ~1.2 m long', () => {
  const withers = Math.max(...OWN.body.filter((v) => v[1] >= 11 && v[1] <= 14).map((v) => v[2])) + 1;
  const horn = Math.max(...OWN.head.map((v) => v[2])) + 1;
  const len = (Math.max(...Object.values(OWN).flat().map((v) => v[1])) + 1) * DEF.cellM;
  console.log(`  withers ${(withers * DEF.cellM).toFixed(2)} m, horns ${(horn * DEF.cellM).toFixed(2)} m, length ${len.toFixed(2)} m, jaw+beard ${OWN.jaw.length} voxels`);
  assert.ok(withers * DEF.cellM >= 0.75 && withers * DEF.cellM <= 0.88, 'withers');
  assert.ok(horn > withers + 4, 'horns well above the withers');
  assert.ok(len >= 1.0 && len <= 1.35, 'length');
  assert.ok(Math.min(...OWN.jaw.map((v) => v[2])) <= 7, 'long beard hangs from the jaw');
});

// clips: [frames, total ms, loop]
const SPEC = { idle: [10, 4000, true], walk: [4, 800, true], climbStep: [6, 1200, false], lead: [10, 3000, true],
               grumbleTalk: [12, 1600, true], listen: [5, 2400, true], headshake: [8, 1200, false],
               lieDown: [4, 1000, false], lie: [4, 3000, true], getUp: [3, 700, false] };
test('clips: exact set, frame counts, total ms, loop, durations multiples of 50, every part keyed, clipFor valid', () => {
  assert.deepStrictEqual(Object.keys(DEF.animations).sort(), Object.keys(SPEC).sort());
  const parts = Object.keys(DEF.parts).sort();
  for (const [k, [n, ms, loop]] of Object.entries(SPEC)) {
    const c = DEF.animations[k];
    assert.strictEqual(c.frames.length, n, k + ' frames'); assert.strictEqual(c.durations.length, n, k + ' durations');
    assert.strictEqual(c.durations.reduce((a, b) => a + b, 0), ms, k + ' total ms');
    assert.strictEqual(!!c.loop, loop, k + ' loop');
    for (const d of c.durations) assert.strictEqual(d % 50, 0, k + ' duration ' + d);
    c.frames.forEach((f, i) => assert.deepStrictEqual(Object.keys(f).sort(), parts, k + ' key ' + i));
  }
  for (const k of Object.values(FX.clipFor.state)) assert.ok(DEF.animations[k], 'clipFor ' + k);
  for (const [a, b] of Object.entries(FX.clipFor.once)) { assert.ok(!DEF.animations[a].loop, a + ' once'); assert.ok(DEF.animations[b], b); }
});

test('talk: jaw sync data (jaw 0..jawMaxDeg, pause key closed at pauseAtMs, wide words >= 14 deg)', () => {
  const c = DEF.animations.grumbleTalk, T = FX.talk;
  assert.strictEqual(T.jawPart, 'jaw');
  const jaws = c.frames.map((f) => f.jaw.rot[0]);
  assert.ok(Math.max(...jaws) >= 14 && Math.max(...jaws) <= T.jawMaxDeg, 'jaw peak ' + Math.max(...jaws));
  assert.strictEqual(jaws[T.pauseKey], 0, 'pause key closed');
  assert.strictEqual(c.durations.slice(0, T.pauseKey).reduce((a, b) => a + b, 0), T.pauseAtMs, 'pauseAtMs');
  for (const [k, cl] of Object.entries(DEF.animations)) for (const f of cl.frames) assert.ok(f.jaw.rot[0] >= 0 && f.jaw.rot[0] <= T.jawMaxDeg, k + ' jaw range');
});

const STEPPING = { walk: 2, lead: 2, climbStep: 2 };   // min hooves on the ground per key (else all four)
test('owner rule 0.2: never upright, hooves planted in x/y, ground-snapped, four down except steps / climb lifts', () => {
  let climbLift = 0;
  for (const [k, c] of Object.entries(DEF.animations)) c.frames.forEach((f, i) => {
    assert.ok(f.body.rot[0] >= -8, k + ' body rx ' + f.body.rot[0]);
    let down = 0;
    for (const l of LIMBS) {
      assert.strictEqual(f[l].pos[0], -f.body.pos[0] || 0, k + ' ' + l + ' x planted');
      assert.strictEqual(f[l].pos[1], -f.body.pos[1] || 0, k + ' ' + l + ' y planted');
      const m = minZ(l, f);
      assert.ok(m >= -0.03, k + ' key ' + i + ' ' + l + ' sinks ' + m.toFixed(2));
      if (m < 0.05) down++;
      if (k === 'climbStep' && (l === 'legFL' || l === 'legFR')) climbLift = Math.max(climbLift, m);
      if (k !== 'climbStep') assert.ok(m <= 2.5, k + ' key ' + i + ' ' + l + ' lift ' + m.toFixed(2) + ' (walk steps <= 2.5 cells)');
    }
    assert.ok(down >= (STEPPING[k] || 4), k + ' key ' + i + ': ' + down + ' hooves down');
  });
  assert.ok(climbLift >= 5, 'climbStep front lift ' + climbLift.toFixed(2) + ' cells (high ledge step)');
  assert.ok(!DEF.animations.sit, 'no sit clip (upright)');
  const lie = DEF.animations.lie.frames[0];
  assert.ok(lie.body.pos[2] <= -8.5 && lie.body.pos[2] >= -10, 'lie on the sternum ' + lie.body.pos[2]);
  assert.deepStrictEqual(DEF.animations.lieDown.frames[3], lie, 'lieDown ends in the lie pose');
  assert.deepStrictEqual(DEF.animations.getUp.frames[2], DEF.animations.idle.frames[0], 'getUp ends at rest');
});

test('rest pose: every limb exactly at rest; head, jaw + beard never under the ground (pitch-only FK)', () => {
  const f = DEF.animations.idle.frames[0];
  for (const l of LIMBS) assert.deepStrictEqual(f[l].pos, [0, 0, 0], l);
  for (const [k, c] of Object.entries(DEF.animations)) c.frames.forEach((fr, i) => {
    for (const p of ['head', 'jaw', 'body']) { const m = minZ(p, fr); assert.ok(m >= -0.6, k + ' key ' + i + ' ' + p + ' under ground ' + m.toFixed(2)); }
  });
});

test('engine mesher: LOD0 tris <= 3500 (bear beast budget); every clip packs', () => {
  const ids = [];
  const PM = packVoxelModel(DEF, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'goat', partNames: Object.keys(DEF.parts) }).triCount;
  console.log(`  LOD0 goat ${tris} tris`);
  assert.ok(tris <= 3500, 'tris ' + tris + ' > 3500');
  for (const k of Object.keys(SPEC)) assert.ok(PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
