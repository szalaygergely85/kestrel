// node tools/voxel-otter.test.mjs - SKIP-D1 Skip the otter (design/models/voxel_otter.js): valid materials, size
// (~1.1 m nose to tail tip, long + low), the 8-part rig with a jaw (dialogue sync) and a tail, the clip set + frame
// counts, owner rule 0.2 (never upright), all four paws planted (pitch-only forward kinematics per key: no paw below
// the ground, >= 2 paws down in moving clips, all four down in standing clips), head / tail clear of the ground,
// otterFx talk contract, tris <= 3500 (the bear beast budget).
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_bear.js';
import '../design/models/voxel_otter.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const BURL = A.models.bear.voxel, DEF = A.models.otter && A.models.otter.voxel, FX = A.otterFx;
const D2R = Math.PI / 180, LIMBS = ['armL', 'armR', 'legL', 'legR'];

function extent(D) {         // occupied extents in metres [x, y, z]
  const lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1];
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    const p = [x, y, z]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  } }));
  return hi.map((h, k) => (h - lo[k] + 1) * D.cellM);
}
// (y, z) cells per part (first box wins)
const NAMES = Object.keys(DEF.parts), YZ = {};
for (const n of NAMES) YZ[n] = new Map();
DEF.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
  const own = NAMES.find((k) => { const b = DEF.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
  if (own) YZ[own].set(y + ',' + z, [y, z]);
} }));
// pitch-only FK (rx about each part's pivot, child pos in the parent frame, as engine/voxel/voxelPose.js): lowest
// world z (cells) of a part's voxel corners in frame f.
function rotYZ(p, piv, deg, pos) {
  const a = deg * D2R, c = Math.cos(a), s = Math.sin(a), dy = p[0] - piv[1], dz = p[1] - piv[2];
  return [piv[1] + dy * c - dz * s + (pos ? pos[1] : 0), piv[2] + dy * s + dz * c + (pos ? pos[2] : 0)];
}
function chainOf(n) { const c = []; for (let k = n; k; k = DEF.parts[k].parent) c.push(k); return c; }
function minZ(f, n) {
  const chain = chainOf(n); let m = Infinity;
  for (const [y, z] of YZ[n].values()) for (const cy of [0, 1]) for (const cz of [0, 1]) {
    let p = [y + cy, z + cz];
    for (const k of chain) p = rotYZ(p, DEF.parts[k].pivot, f[k].rot[0], f[k].pos);
    if (p[1] < m) m = p[1];
  }
  return m;
}
function tris(D, id) {
  const ids = [];
  const PM = packVoxelModel(D, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  return { PM, tris: buildVoxelMesh(PM, { id, partNames: Object.keys(D.parts) }).triCount };
}

test('ASSETS.models.otter + ASSETS.otterFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'otter'); });

test('validateVoxelModel: no errors / warnings against palette + detail-pass materials', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(DEF.meshOnly, true);
  for (const m of Object.values(DEF.mats)) assert.ok(P.materials[m] && DP.materials[m], 'material ' + m);
});

test('rig: 8 parts incl. jaw (child of head) + tail, every part box sx+sy+sz <= 48', () => {
  assert.deepStrictEqual(NAMES, ['body', 'head', 'jaw', 'tail', 'armL', 'armR', 'legL', 'legR']);
  assert.strictEqual(DEF.parts.jaw.parent, 'head');
  for (const [k, p] of Object.entries(DEF.parts)) {
    const b = p.box; assert.ok(b[3] - b[0] + b[4] - b[1] + b[5] - b[2] <= 48, k + ' box size');
    assert.ok(YZ[k].size > 0, k + ' owns voxels');
  }
});

test('size: ~1.1 m nose to tail tip, long and low (shoulders <= 0.30 m), smaller than Burl', () => {
  const o = extent(DEF), b = extent(BURL);
  console.log(`  otter ${o.map((v) => v.toFixed(2)).join(' x ')} m vs Burl ${b.map((v) => v.toFixed(2)).join(' x ')} m`);
  assert.ok(o[1] >= 1.0 && o[1] <= 1.2, 'length ' + o[1]);
  assert.ok(o[2] <= 0.30, 'height ' + o[2]);
  assert.ok(o[1] / o[2] >= 3.5, 'long low body');
  assert.ok(o[1] < b[1] && o[2] < 0.4 * b[2], 'smaller than Burl');
});

// clips: [frames, total ms, loop]
const SPEC = { idle: [10, 3000, true], walk: [4, 600, true], lope: [4, 500, true], sniff: [8, 2000, true],
               groom: [11, 2400, true], talk: [12, 1600, true], listen: [6, 2400, true], laugh: [12, 1400, false],
               toss: [5, 800, false], lieDown: [3, 800, false], lie: [4, 3000, true], getUp: [2, 500, false] };
const MOVING = new Set(['walk', 'lope', 'lieDown', 'getUp']);
test('clips: exact set, frame counts, total ms, loop, durations multiples of 50, every part keyed', () => {
  assert.deepStrictEqual(Object.keys(DEF.animations).sort(), Object.keys(SPEC).sort());
  for (const [k, [n, ms, loop]] of Object.entries(SPEC)) {
    const c = DEF.animations[k];
    assert.strictEqual(c.frames.length, n, k + ' frames'); assert.strictEqual(c.durations.length, n, k + ' durations');
    assert.strictEqual(c.durations.reduce((a, b) => a + b, 0), ms, k + ' total ms');
    assert.strictEqual(!!c.loop, loop, k + ' loop');
    for (const d of c.durations) assert.strictEqual(d % 50, 0, k + ' duration ' + d);
    c.frames.forEach((f, i) => assert.deepStrictEqual(Object.keys(f).sort(), [...NAMES].sort(), k + ' key ' + i));
  }
  for (const k of Object.values(FX.clipFor.state)) assert.ok(DEF.animations[k], 'clipFor ' + k);
  for (const [k, next] of Object.entries(FX.clipFor.once)) { assert.strictEqual(DEF.animations[k].loop, false, k); assert.ok(DEF.animations[next], next); }
});

test('owner rule 0.2: never upright (body rx >= -5), paws planted in x/y every key, no sit / wave / stand clip', () => {
  for (const [k, c] of Object.entries(DEF.animations)) for (const f of c.frames) {
    assert.ok(f.body.rot[0] >= -5, k + ' body rx ' + f.body.rot[0]);
    for (const l of LIMBS) {
      assert.strictEqual(f[l].pos[0], -f.body.pos[0] || 0, k + ' ' + l + ' x planted');
      assert.strictEqual(f[l].pos[1], -f.body.pos[1] || 0, k + ' ' + l + ' y planted');
    }
  }
  for (const k of ['sit', 'wave', 'stand', 'standUp', 'beg']) assert.ok(!DEF.animations[k], 'no clip ' + k);
  const rest = DEF.animations.idle.frames[0];
  for (const l of LIMBS) assert.deepStrictEqual(rest[l].pos, [0, 0, 0], 'rest ' + l);
  assert.deepStrictEqual(DEF.animations.lieDown.frames[2], DEF.animations.lie.frames[0], 'lieDown ends in the lie pose');
  assert.deepStrictEqual(DEF.animations.getUp.frames[1], rest, 'getUp ends at rest');
  assert.strictEqual(DEF.animations.lie.frames[0].body.pos[2], -4, 'lie: belly on the ground');
});

test('four paws planted: no paw below the ground; all four down in standing clips, >= 2 down in moving clips', () => {
  const EPS = 0.05;
  for (const [k, c] of Object.entries(DEF.animations)) c.frames.forEach((f, i) => {
    const z = LIMBS.map((l) => minZ(f, l));
    z.forEach((v, j) => assert.ok(v >= -EPS, `${k} key ${i} ${LIMBS[j]} below ground ${v.toFixed(2)}`));
    const down = z.filter((v) => v <= EPS).length;
    if (MOVING.has(k)) assert.ok(down >= 2, `${k} key ${i}: only ${down} paws down`);
    else assert.strictEqual(down, 4, `${k} key ${i}: ${down} paws down (${z.map((v) => v.toFixed(2)).join(' ')})`);
  });
});

test('head, jaw (wide open too) and tail stay above the ground in every key', () => {
  for (const [k, c] of Object.entries(DEF.animations)) c.frames.forEach((f, i) => {
    for (const n of ['head', 'jaw', 'tail', 'body']) assert.ok(minZ(f, n) >= -0.3, `${k} key ${i} ${n} ${minZ(f, n).toFixed(2)}`);
  });
});

test('dialogue: jaw sync contract like Burl (talk jaw range, closed pause key, otterFx.talk)', () => {
  const T = FX.talk, talk = DEF.animations.talk;
  assert.strictEqual(T.jawPart, 'jaw'); assert.strictEqual(T.jawAxis, 'rx'); assert.strictEqual(T.jawOpenSign, 1);
  const jaws = talk.frames.map((f) => f.jaw.rot[0]);
  assert.ok(Math.max(...jaws) >= 14 && Math.max(...jaws) <= T.jawMaxDeg, 'talk jaw peak ' + Math.max(...jaws));
  assert.strictEqual(jaws[T.pauseKey], 0, 'pause key closed');
  assert.strictEqual(talk.durations.slice(0, T.pauseKey).reduce((a, b) => a + b, 0), T.pauseAtMs, 'pauseAtMs');
  for (const c of Object.values(DEF.animations)) for (const f of c.frames) assert.ok(f.jaw.rot[0] >= 0 && f.jaw.rot[0] <= T.jawMaxDeg);
  assert.ok(Math.max(...DEF.animations.laugh.frames.map((f) => f.jaw.rot[0])) >= 16, 'laugh chatters wide');
  for (const m of ['speech', 'eyes', 'mouth', 'interact']) assert.ok(DEF.mounts[m], 'mount ' + m);
});

test('engine mesher: LOD0 tris <= 3500 (the bear beast budget); every clip packs', () => {
  const o = tris(DEF, 'otter'), b = tris(BURL, 'bear');
  console.log(`  LOD0 otter ${o.tris} tris vs Burl ${b.tris}`);
  assert.ok(o.tris <= 3500, 'tris ' + o.tris + ' > 3500');
  for (const k of Object.keys(SPEC)) assert.ok(o.PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
