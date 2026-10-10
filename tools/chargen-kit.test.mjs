// node tools/chargen-kit.test.mjs - CHARGEN-01 human kit v0 (design/chargen/human_kit.js -> content/chargen/human.charkit.json):
// 22-bone skeleton, every base voxel inside a bone box, every bone owns voxels, realistic size, arm / thigh gaps,
// stretch rows only through shin / waist bones (+ both arms symmetric, never a hand box), ramps (5 skin tones, 6 hair, 3 eyes, 6 dyes) with palette + detail-pass
// keys, hand tint maps, quad budget, determinism, and the JSON on disk equals the generator.
import assert from 'node:assert';
import fs from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/chargen/human_kit.js';
import { HUMANOID_PART_MAP, composeCharacter } from '../engine/index.js';

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
test('skeleton: 22 humanoid bones, parents first; partMap = engine array form, every bone once in <= 8 parts', () => {
  assert.strictEqual(kit.skeleton.length, 22);
  assert.ok(Array.isArray(kit.partMap), 'partMap must be the collapseRig array');
  assert.ok(kit.partMap.length <= 8);
  const seen = {}, parts = {};
  for (const p of kit.partMap) {
    assert.ok(p.parent === null || parts[p.parent], p.name + ': parent listed first');
    for (const b of p.bones) { assert.ok(!seen[b], b + ' twice'); seen[b] = 1; }
    parts[p.name] = p;
  }
  assert.strictEqual(Object.keys(seen).length, 22);
  assert.strictEqual(parts.body.compose, 2);
  assert.strictEqual(parts.head.compose, 2);
});
test('partMap equals engine HUMANOID_PART_MAP', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kit.partMap)), JSON.parse(JSON.stringify(HUMANOID_PART_MAP)));
});
test('size: 1.75 m tall, ~70 rows, shoulders + upper arms (slight A) 0.42-0.55 m, grid about 36x20x76', () => {
  const st = res.stats.bases.m_avg;
  assert.strictEqual(st.heightM, 1.75);
  assert.ok(B.size[0] <= 40 && B.size[1] <= 20 && B.size[2] <= 76, B.size.join('x'));
  // shoulder width: widest row between z 49 and 51 (CHARGEN-26: shoulders at z 50 under the bigger head; was z 52-57)
  let w = 0;
  for (let z = 49; z <= 51; z++) { let lo = 99, hi = -1; for (let y = 0; y < B.size[1]; y++) for (let x = 0; x < B.size[0]; x++) { const k = D.at(x, y, z); if (k >= 0) { lo = Math.min(lo, x); hi = Math.max(hi, x); } } w = Math.max(w, hi - lo + 1); }
  assert.ok(w * kit.cellM >= 0.42 && w * kit.cellM <= 0.55, 'shoulders ' + w * kit.cellM);
});
test('rest pose gaps: thighs >= 2 cells apart (crotch to knee), arm-torso >= 3 cells from z 46 down to the hands', () => {
  const S = B.size, cx = 18;
  // CHARGEN-26: shorter legs, crotch at z 28 (was 34), so the thigh gap is checked over z 20-27 (was 20-33)
  for (let z = 20; z <= 27; z++) for (let y = 0; y < S[1]; y++) for (let x = cx - 1; x <= cx + 1; x++) assert.ok(D.at(x, y, z) < 0, 'thigh gap at ' + [x, y, z]);
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
test('stretch rows: integers, Hips / Spine / LowerLeg + arm bones symmetric across both arms, never a hand box, >= 5 rows, shin + waist', () => {
  assert.ok(B.stretchRows.length >= 5);
  const ok = CK.STRETCH_BONES, S = B.size;
  let waist = 0, shin = 0;
  for (const z of B.stretchRows) {
    assert.ok(Number.isInteger(z));
    const inRow = new Set();
    for (let y = 0; y < S[1]; y++) for (let x = 0; x < S[0]; x++) { const k = D.at(x, y, z); if (k >= 0) inRow.add(D.names[D.bone[k]]); }
    for (const n of inRow) {
      assert.ok(ok.includes(n), 'row ' + z + ' ' + n);
      if (CK.ARM_STRETCH[n]) assert.ok(inRow.has(CK.ARM_STRETCH[n]), 'row ' + z + ': ' + n + ' without ' + CK.ARM_STRETCH[n]);
    }
    for (const n of ['LeftHand', 'RightHand']) { const b = B.bones[n].box; assert.ok(z < b[2] || z > b[5], 'row ' + z + ' cuts the ' + n + ' box'); }
    if (inRow.has('Hips') || inRow.has('Spine')) waist++;
    if (inRow.has('LeftLowerLeg')) shin++;
  }
  assert.ok(waist >= 1 && shin >= 1, 'waist ' + waist + ' shin ' + shin);
  // checkKit catches a row through a hand box
  const bad = JSON.parse(JSON.stringify(kit));
  bad.bases.m_avg.stretchRows = [30];
  assert.ok(CK.checkKit(bad, P, DP).errors.some((e) => /Hand box/.test(e)), 'hand box row not caught');
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
test('CHARGEN-25: kit.defaults wears the outfit (hair, shirt, trousers, boots) - never bald + underwear', () => {
  for (const s of ['hair', 'top', 'legs', 'feet']) assert.ok(kit.defaults[s] && kit.defaults[s].id, 'defaults.' + s);
});
test('preview composePreview = engine composeCharacter for kit.defaults (same material in every cell)', () => {
  const g = composeCharacter(kit, kit.defaults), C = CK.composePreview(kit, 'm_avg', kit.defaults);
  assert.deepStrictEqual(Array.from(g.size), Array.from(C.size));
  let diff = 0, first = '';
  for (let i = 0; i < g.mat.length; i++) {
    const a = g.mat[i] ? g.matKeys[g.mat[i] - 1] : null, b = C.ch[i] === '.' ? null : CK.resolveMat(kit, kit.defaults, C.ch[i]);
    if (a !== b && !diff++) first = 'cell ' + i + ': engine ' + a + ' / preview ' + b;
  }
  assert.strictEqual(diff, 0, diff + ' cells differ, first ' + first);
});
test('CHARGEN-26 knight look: validates, engine composeCharacter = composePreview, beard + heraldry painted', () => {
  const kn = kit.looks && kit.looks.knight;
  assert.ok(kn && kn.beard && kn.beard.id === 'full' && kn.outer.id === 'tabard' && kn.hat.id === 'heraldry');
  const g = composeCharacter(kit, kn), C = CK.composePreview(kit, 'm_avg', kn);
  let diff = 0, first = '';
  const seen = {};
  for (let i = 0; i < g.mat.length; i++) {
    const a = g.mat[i] ? g.matKeys[g.mat[i] - 1] : null, b = C.ch[i] === '.' ? null : CK.resolveMat(kit, kn, C.ch[i]);
    if (a !== b && !diff++) first = 'cell ' + i + ': engine ' + a + ' / preview ' + b;
    seen[C.ch[i]] = 1;
  }
  assert.strictEqual(diff, 0, diff + ' cells differ, first ' + first);
  for (const c of ['q', 'r', 'R', 'y', 'k', '9', 'g']) assert.ok(seen[c], 'knight shows slot char ' + c);
  for (const h of [-4, 4]) composeCharacter(kit, { ...kn, height: h });
  composeCharacter(kit, { ...kn, res: { body: 1, head: 2 } });
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
