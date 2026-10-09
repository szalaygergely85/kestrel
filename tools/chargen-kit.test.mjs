// node tools/chargen-kit.test.mjs - CHARGEN-01 human kit v0 (design/chargen/human_kit.js -> content/chargen/human.charkit.json):
// 22-bone skeleton, every base voxel inside a bone box, every bone owns voxels, realistic size, arm / thigh gaps,
// stretch rows only through shin / waist bones, ramps (5 skin tones, 6 hair, 3 eyes, 6 dyes) with palette + detail-pass
// keys, hand tint maps, quad budget, determinism, and the JSON on disk equals the generator.
import assert from 'node:assert';
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/chargen/human_kit.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass, CK = A.chargenKit;
const kit = CK.buildHumanKit(P);
const res = CK.checkKit(kit, P, DP);
const B = kit.bases.m_avg, D = CK.decodeBase(kit, 'm_avg');

test('checkKit: no errors, no warnings', () => {
  assert.deepStrictEqual(res.errors, []);
  assert.deepStrictEqual(res.warnings, []);
});
test('skeleton: 22 humanoid bones, parents first, partMap covers every bone once in <= 8 parts', () => {
  assert.strictEqual(kit.skeleton.length, 22);
  const seen = {};
  for (const p in kit.partMap) for (const b of kit.partMap[p]) { assert.ok(!seen[b], b + ' twice'); seen[b] = 1; }
  assert.strictEqual(Object.keys(seen).length, 22);
  assert.ok(Object.keys(kit.partMap).length <= 8);
});
test('size: 1.75 m tall, ~70 rows, shoulders + upper arms (slight A) 0.42-0.55 m, grid about 36x20x76', () => {
  const st = res.stats.bases.m_avg;
  assert.strictEqual(st.heightM, 1.75);
  assert.ok(B.size[0] <= 40 && B.size[1] <= 20 && B.size[2] <= 76, B.size.join('x'));
  // shoulder width: widest row between z 52 and 57, arms excluded by the box
  let w = 0;
  for (let z = 52; z <= 57; z++) { let lo = 99, hi = -1; for (let y = 0; y < B.size[1]; y++) for (let x = 0; x < B.size[0]; x++) { const k = D.at(x, y, z); if (k >= 0) { lo = Math.min(lo, x); hi = Math.max(hi, x); } } w = Math.max(w, hi - lo + 1); }
  assert.ok(w * kit.cellM >= 0.42 && w * kit.cellM <= 0.55, 'shoulders ' + w * kit.cellM);
});
test('rest pose gaps: thighs >= 2 cells apart (crotch to knee), arm-torso >= 3 cells from z 46 down to the hands', () => {
  const S = B.size, cx = 18;
  for (let z = 20; z <= 33; z++) for (let y = 0; y < S[1]; y++) for (let x = cx - 1; x <= cx + 1; x++) assert.ok(D.at(x, y, z) < 0, 'thigh gap at ' + [x, y, z]);
  // Hands rest by the thigh (designer CHARGEN-01: 'palm faces the thigh'; owner Q2 pending) - the >= 3 gap applies to the arm bones only.
  const isArm = (k) => /Arm/.test(D.names[D.bone[k]]);
  const isHand = (k) => /Hand/.test(D.names[D.bone[k]]);
  for (let z = 26; z <= 46; z++) for (let y = 0; y < S[1]; y++) {
    for (const side of [-1, 1]) {
      let arm = 99, body = -1;
      for (let i = 0; i <= 18; i++) { const x = cx + side * i, k = D.at(x, y, z); if (k < 0 || isHand(k)) continue; if (isArm(k)) arm = Math.min(arm, i); else body = Math.max(body, i); }
      if (arm < 99 && body >= 0) assert.ok(arm - body - 1 >= 3, 'arm gap ' + (arm - body - 1) + ' at z ' + z + ' y ' + y);
    }
  }
});
test('stretch rows: integers, only Hips / Spine / LowerLeg voxels (engine STRETCH_BONES), >= 4 rows for height -4..4', () => {
  assert.ok(B.stretchRows.length >= 4);
  const ok = ['Hips', 'Spine', 'LeftLowerLeg', 'RightLowerLeg'], S = B.size;
  for (const z of B.stretchRows) {
    assert.ok(Number.isInteger(z));
    for (let y = 0; y < S[1]; y++) for (let x = 0; x < S[0]; x++) { const k = D.at(x, y, z); if (k >= 0) assert.ok(ok.includes(D.names[D.bone[k]]), 'row ' + z + ' ' + D.names[D.bone[k]]); }
  }
});
test('bone boxes are inclusive int [x0,y0,z0,x1,y1,z1] inside the grid; anchors are [x,y,z]', () => {
  for (const n in B.bones) {
    const b = B.bones[n].box;
    assert.ok(b.every(Number.isInteger) && b[0] <= b[3] && b[1] <= b[4] && b[2] <= b[5], n);
    assert.ok(b[0] >= 0 && b[1] >= 0 && b[2] >= 0 && b[3] < B.size[0] && b[4] < B.size[1] && b[5] < B.size[2], n + ' ' + b);
  }
  for (const a in B.anchors) assert.ok(Array.isArray(B.anchors[a]) && B.anchors[a].length === 3, a);
});
test('ramps: 5 skin tones (4 shades + extras), 6 hair, 3 eyes, 6 natural dyes (+ undyed); 8 hand keys per tone', () => {
  assert.deepStrictEqual(Object.keys(kit.ramps.skin), ['fair', 'warm', 'medium', 'brown', 'dark']);
  for (const t in kit.ramps.skin) for (const s of ['light', 'base', 'shade', 'deep']) assert.ok(P.materials[kit.ramps.skin[t][s]]);
  assert.strictEqual(Object.keys(kit.ramps.hair).length, 6);
  assert.strictEqual(Object.keys(kit.ramps.eyes).length, 3);
  assert.strictEqual(Object.keys(kit.ramps.top).filter((k) => k !== 'undyed').length, 6);
  assert.strictEqual(Object.keys(kit.ramps.hair)[0], 'darkbrown', 'first hair ramp = the default (bald brows)');
  assert.strictEqual(Object.keys(kit.ramps.top)[0], 'undyed');
  for (const t in kit.handTint) assert.strictEqual(Object.keys(kit.handTint[t]).length, 8);
  assert.strictEqual(kit.ramps.skin.medium.base, 'skin', 'medium = the existing hand skin');
});
test('every appended palette key has a color, a v1 material and a v2 record (+ remap)', () => {
  for (const r of P.chargen.newMaterials) {
    assert.ok(P.colors[r.color], r.color); assert.ok(P.materials[r.key], r.key);
    assert.ok(DP.materials[r.key], 'v2 ' + r.key); assert.strictEqual(DP.remap[r.key], r.key);
  }
  const mine = new Set(P.chargen.newMaterials.map((r) => r.key));
  assert.deepStrictEqual(P.util.validate().filter((e) => mine.has(e.split(/[.:]/)[0])), []);
});
test('materials per character <= 255; quads within the 38.29 budget (<= 6000)', () => {
  assert.ok(res.stats.materialKeys <= 255);
  assert.ok(res.stats.bases.m_avg.quads <= 6000, 'quads ' + res.stats.bases.m_avg.quads);
});
test('deterministic: two builds give identical text', () => {
  assert.strictEqual(CK.stringifyKit(CK.buildHumanKit(P)), CK.stringifyKit(kit));
});
test('content/chargen/human.charkit.json equals the generator (run node tools/chargen-build-kit.mjs)', () => {
  const url = new URL('../content/chargen/human.charkit.json', import.meta.url);
  assert.ok(fs.existsSync(url), 'missing JSON');
  assert.strictEqual(fs.readFileSync(url, 'utf8'), CK.stringifyKit(kit));
});

console.log(`${passed} passed`);
