// node tools/voxel-bear-cub.test.mjs - NUB-D1 Nub, Burl's cub (design/models/voxel_bear_cub.js): Burl's 8-part rig
// re-proportioned as a cub. Valid materials, ~45-55 % of Burl, cub proportions (bigger head share, shorter legs), the
// clip set + frame counts, all four paws on the ground (planted + ground-snapped), no dialogue clips, tris <= 3500 (bear budget).
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_bear.js';
import '../design/models/voxel_bear_cub.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const BURL = A.models.bear.voxel, DEF = A.models.bearCub && A.models.bearCub.voxel, FX = A.bearCubFx;

function extent(D) {         // occupied extents in metres [x, y, z] + voxel count
  const lo = [1e9, 1e9, 1e9], hi = [-1, -1, -1]; let n = 0;
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    n++; const p = [x, y, z]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  } }));
  return { m: hi.map((h, k) => (h - lo[k] + 1) * D.cellM), n };
}
function partCount(D, name) {   // voxels owned by a part (first box wins, part insertion order)
  const names = Object.keys(D.parts); let n = 0;
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    const own = names.find((k) => { const b = D.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    if (own === name) n++;
  } }));
  return n;
}
function tris(D, id) {
  const ids = [];
  const PM = packVoxelModel(D, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  return { PM, tris: buildVoxelMesh(PM, { id, partNames: Object.keys(D.parts) }).triCount };
}

test('ASSETS.models.bearCub + ASSETS.bearCubFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'bearCub'); });

test('validateVoxelModel: no errors / warnings against palette + detail-pass materials', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(DEF.meshOnly, true);
});

test('same rig names / parents as Burl (8 parts), every part box sx+sy+sz <= 48', () => {
  assert.deepStrictEqual(Object.keys(DEF.parts), Object.keys(BURL.parts));
  for (const [k, p] of Object.entries(DEF.parts)) {
    assert.strictEqual(p.parent, BURL.parts[k].parent, k + ' parent');
    const b = p.box; assert.ok(b[3] - b[0] + b[4] - b[1] + b[5] - b[2] <= 48, k + ' box size');
  }
});

test('size: 45-55 % of Burl (length, height); cub proportions: bigger head share, shorter legs', () => {
  const c = extent(DEF), b = extent(BURL);
  const rl = c.m[1] / b.m[1], rh = c.m[2] / b.m[2];
  console.log(`  cub ${c.m.map((v) => v.toFixed(2)).join(' x ')} m vs Burl ${b.m.map((v) => v.toFixed(2)).join(' x ')} m (length ${rl.toFixed(2)}, height ${rh.toFixed(2)})`);
  assert.ok(rl >= 0.45 && rl <= 0.55, 'length ratio ' + rl);
  assert.ok(rh >= 0.45 && rh <= 0.55, 'height ratio ' + rh);
  const hc = (partCount(DEF, 'head') + partCount(DEF, 'ears')) / c.n, hb = (partCount(BURL, 'head') + partCount(BURL, 'ears')) / b.n;
  console.log(`  head share cub ${hc.toFixed(2)} vs Burl ${hb.toFixed(2)}`);
  assert.ok(hc > 1.2 * hb, 'head share ' + hc + ' vs ' + hb);
  assert.ok(DEF.parts.body.box[2] / DEF.size[2] < 0.85 * BURL.parts.body.box[2] / BURL.size[2], 'shorter legs (belly height share)');
});

// clips: [frames, total ms, loop]
const SPEC = { idle: [8, 4000, true], walk: [4, 600, true], trot: [4, 400, true], sniff: [8, 2000, true],
               lookUp: [6, 2400, true], stuckWiggle: [6, 800, true], lieDown: [4, 900, false], lie: [4, 3000, true],
               getUp: [3, 600, false] };
test('clips: exact set (no dialogue clips), frame counts, total ms, loop, durations multiples of 50, every part keyed', () => {
  assert.deepStrictEqual(Object.keys(DEF.animations).sort(), Object.keys(SPEC).sort());
  for (const k of ['talk', 'listen', 'laugh', 'wave']) assert.ok(!DEF.animations[k], 'no dialogue clip ' + k);
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
});

test('owner rule 0.2: never upright (body pitch >= -8), paws planted in x/y every key, lie = belly down, no sit clip', () => {
  for (const [k, c] of Object.entries(DEF.animations)) for (const f of c.frames) {
    assert.ok(f.body.rot[0] >= -8, k + ' body rx ' + f.body.rot[0]);
    for (const l of ['armL', 'armR', 'legL', 'legR']) {
      assert.strictEqual(f[l].pos[0], -f.body.pos[0] || 0, k + ' ' + l + ' x planted');
      assert.strictEqual(f[l].pos[1], -f.body.pos[1] || 0, k + ' ' + l + ' y planted');
    }
  }
  assert.ok(!DEF.animations.sit, 'no sit clip (upright)');
  const lie = DEF.animations.lie.frames[0];
  assert.ok(lie.body.pos[2] <= -6 && lie.body.pos[2] >= -7, 'lie belly on the ground ' + lie.body.pos[2]);
  for (const l of ['armL', 'armR']) assert.ok(lie[l].rot[0] <= -60, 'lie fore legs forward');
  assert.deepStrictEqual(DEF.animations.lieDown.frames[3], lie, 'lieDown ends in the lie pose');
  assert.deepStrictEqual(DEF.animations.getUp.frames[2], DEF.animations.idle.frames[0], 'getUp ends at rest');
});

test('rest pose: every limb exactly at rest (ground solve = 0)', () => {
  const f = DEF.animations.idle.frames[0];
  for (const l of ['armL', 'armR', 'legL', 'legR']) assert.deepStrictEqual(f[l].pos, [0, 0, 0], l);
});

test('engine mesher: LOD0 tris <= 3500 (the bear beast budget, same as bearBlack); every clip packs', () => {
  const c = tris(DEF, 'bearCub'), b = tris(BURL, 'bear');
  console.log(`  LOD0 cub ${c.tris} tris vs Burl ${b.tris}`);
  assert.ok(c.tris <= 3500, 'tris ' + c.tris + ' > 3500 (Burl ' + b.tris + ')');
  for (const k of Object.keys(SPEC)) assert.ok(c.PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
