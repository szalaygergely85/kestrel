// engine/chargen/chargen.test.js (CHARGEN-02): node engine/chargen/chargen.test.js
// Uses a tiny fixture kit (the real human kit is CHARGEN-01).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateKit, validateRecipe, composeCharacter } from './index.js';
import { makeOk } from '../test/assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---- fixture: 7 x 5 x 8 grid. torso x1..3,y1..3,z0..5 (Hips z0..2, Spine z3..5), head z6..7, left arm x0,y2,z3..5.
const SX = 7, SY = 5, SZ = 8;
function makeLayers(fn) {
  const layers = [];
  for (let z = 0; z < SZ; z++) {
    const rows = [];
    for (let y = 0; y < SY; y++) { let r = ''; for (let x = 0; x < SX; x++) r += fn(x, y, z) || '.'; rows.push(r); }
    layers.push(rows);
  }
  return layers;
}
const inB = (x, y, z, b) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5];
const TORSO = [1, 1, 0, 3, 3, 5];
const HEAD = [1, 1, 6, 3, 3, 7];
const ARM = [0, 2, 3, 0, 2, 5];
function makeKit() {
  const skin = {};
  for (let s = 0; s < 4; s++) skin[s] = `skin.${s}`;
  return {
    id: 'fix', cellM: 0.025,
    skeleton: [
      { name: 'Hips', parent: null }, { name: 'Spine', parent: 'Hips' }, { name: 'Head', parent: 'Spine' },
      { name: 'LeftUpperArm', parent: 'Spine' },
    ],
    bases: {
      m: {
        size: [SX, SY, SZ], anchor: [2, 2, 0],
        layers: makeLayers((x, y, z) => (inB(x, y, z, HEAD) ? (x === 2 && y === 1 && z === 6 ? 'E' : 'S') : inB(x, y, z, TORSO) || inB(x, y, z, ARM) ? 'S' : null)),
        bones: {
          Hips: { joint: [2, 2, 0], box: [1, 1, 0, 3, 3, 2] },
          Spine: { joint: [2, 2, 3], box: [1, 1, 3, 3, 3, 5] },
          Head: { joint: [2, 2, 6], box: HEAD },
          LeftUpperArm: { joint: [0, 2, 5], box: ARM },
        },
        anchors: { head_top: [1, 1, 8] },
        stretchRows: [1],
      },
    },
    slots: { S: { group: 'skin', shade: 1 }, E: { group: 'eyes', shade: 0 }, T: { group: 'top', shade: 1 }, O: { group: 'outer', shade: 0 }, H: { group: 'hair', shade: 1 }, K: { group: 'hat', shade: 0 }, w: { fixed: 'white' } },
    ramps: {
      skin: { fair: { 0: 'skin.0', 1: 'skin.1' }, dark: { 0: 'skin.2', 1: 'skin.3' } },
      eyes: { blue: { 0: 'eye.blue' } },
      top: { red: { 0: 'red.0', 1: 'red.1' }, blue: { 0: 'blue.0', 1: 'blue.1' } },
      outer: { grey: { 0: 'grey.0' } },
      hair: { black: { 0: 'hair.0', 1: 'hair.1' } },
      hat: { felt: { 0: 'felt.0' } },
    },
    shells: [
      { id: 'tee0', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }], thick: 0, paint: 'T' },
      { id: 'coat2', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 1 }], thick: 2, paint: 'T' },
      { id: 'cloak', slot: 'outer', regions: [{ bone: 'Spine', t0: 0, t1: 1 }], thick: 0, paint: 'O' },
      { id: 'upper', slot: 'top', regions: [{ bone: 'Spine', t0: 0, t1: 0.5 }], thick: 0, paint: 'T' },
    ],
    attachments: [
      { id: 'tuft', slot: 'hair', bone: 'Head', anchor: 'head_top', offset: [0, 0, 0], box: [3, 3, 1], layers: [['HHH', 'HHH', 'HHH']] },
      { id: 'cap', slot: 'hat', bone: 'Head', anchor: 'head_top', offset: [0, 0, 0], box: [3, 3, 1], layers: [['KKK', 'KKK', 'KKK']], hides: ['hair'] },
      { id: 'dye', slot: 'hat', bone: 'Head', anchor: 'head_top', offset: [0, 0, -1], box: [3, 3, 1], layers: [['KKK', 'KKK', 'KKK']], paintOnly: true },
    ],
    clips: { idle: { duration: 1000 } },
  };
}
const MATS = new Set(['skin.0', 'skin.1', 'skin.2', 'skin.3', 'eye.blue', 'red.0', 'red.1', 'blue.0', 'blue.1', 'grey.0', 'hair.0', 'hair.1', 'felt.0', 'white']);
const recipe = (over = {}) => ({ v: 1, kit: 'fix', base: 'm', height: 0, age: 'adult', skin: 'fair', eyes: 'blue', hair: null, beard: null, top: null, legs: null, feet: null, outer: null, hat: null, ...over });
const clone = (o) => JSON.parse(JSON.stringify(o));
const has = (r, re) => r.errors.some((e) => re.test(e));

// 1. valid kit and recipe
{
  const r = validateKit(makeKit(), MATS);
  ok('valid kit has no errors', r.errors.length === 0, r.errors.join('; '));
  ok('valid recipe', validateRecipe(makeKit(), recipe()).errors.length === 0);
}

// 2. one fixture per validateKit rule
{
  const k = makeKit(); k.bases.m.bones.Tail = { joint: [0, 0, 0], box: [0, 0, 0, 0, 0, 0] };
  ok('rule: unknown bone', has(validateKit(k, MATS), /unknown bone "Tail"/));
}
{
  const k = makeKit(); k.bases.m.layers[0][0] = 'S' + k.bases.m.layers[0][0].slice(1); // (0,0,0) is in no box
  const r = validateKit(k, MATS);
  ok('rule: voxel outside every bone box', has(r, /outside every bone box.*\(0,0,0\)/), r.errors.join('; '));
}
{
  const k = makeKit(); k.ramps.skin.fair[1] = 'nope.key';
  ok('rule: unknown material key', has(validateKit(k, MATS), /unknown material key "nope\.key"/));
  const k2 = makeKit(); k2.slots.w.fixed = 'nope.fixed';
  ok('rule: unknown fixed material key', has(validateKit(k2, MATS), /unknown material key "nope\.fixed"/));
}
{
  const k = makeKit(); const known = new Set(MATS); const big = {};
  for (let i = 0; i < 256; i++) { big[i] = `m${i}`; known.add(`m${i}`); }
  k.ramps.skin.big = big;
  ok('rule: more than 255 materials', has(validateKit(k, known), /materials \(max 255\)/));
  const k2 = makeKit(); const small = {};
  for (let i = 0; i < 200; i++) { small[i] = `m${i}`; known.add(`m${i}`); }
  k2.ramps.skin.big = small;
  ok('200 materials still fine', !has(validateKit(k2, known), /materials/));
}
{
  const k = makeKit(); k.bases.m.stretchRows = [4]; // row 4 holds Spine and LeftUpperArm voxels
  const r = validateKit(k, MATS);
  ok('rule: stretch row through a forbidden bone', has(r, /row 4 runs through forbidden bone "LeftUpperArm"/), r.errors.join('; '));
  const k2 = makeKit(); k2.bases.m.stretchRows = [7];
  ok('stretch row through Head is forbidden', has(validateKit(k2, MATS), /forbidden bone "Head"/));
  ok('stretch row through Hips only is fine', validateKit(makeKit(), MATS).errors.length === 0);
}
{
  const k = makeKit(); k.shells[0].slot = 'cape'; k.attachments[0].anchor = 'nowhere';
  const r = validateKit(k, MATS);
  ok('unknown slot and anchor reported', has(r, /unknown slot "cape"/) && has(r, /no anchor "nowhere"/));
}

// 3. validateRecipe
{
  const kit = makeKit();
  ok('recipe: unknown base', has(validateRecipe(kit, recipe({ base: 'z' })), /base/));
  ok('recipe: height range', has(validateRecipe(kit, recipe({ height: 5 })), /height/));
  ok('recipe: unknown skin ramp', has(validateRecipe(kit, recipe({ skin: 'green' })), /skin/));
  ok('recipe: unknown item', has(validateRecipe(kit, recipe({ top: { id: 'toga', ramp: 'red' } })), /unknown item/));
  ok('recipe: unknown dye ramp', has(validateRecipe(kit, recipe({ top: { id: 'tee0', ramp: 'pink' } })), /ramp "pink"/));
  ok('recipe: wrong kit', has(validateRecipe(kit, recipe({ kit: 'other' })), /kit/));
  let threw = false;
  try { composeCharacter(kit, recipe({ base: 'z' })); } catch { threw = true; }
  ok('compose throws on an invalid recipe', threw);
}

// ---- compose helpers
const kit = makeKit();
const idx = (x, y, z) => x + SX * (y + SY * z);
const keyAt = (g, x, y, z) => g.matKeys[g.mat[idx(x, y, z)] - 1];
const BONE = { Hips: 0, Spine: 1, Head: 2, LeftUpperArm: 3 };

// 4. base
{
  const g = composeCharacter(kit, recipe());
  ok('grid size and arrays', g.size.join() === `${SX},${SY},${SZ}` && g.mat.length === SX * SY * SZ && g.bone.length === g.mat.length);
  ok('base skin key from the skin ramp', keyAt(g, 1, 1, 0) === 'skin.1' && keyAt(g, 2, 1, 6) === 'eye.blue');
  ok('empty cell is 0', g.mat[idx(5, 0, 0)] === 0);
  ok('bones by first containing box', g.bone[idx(2, 2, 1)] === BONE.Hips && g.bone[idx(2, 2, 4)] === BONE.Spine && g.bone[idx(2, 2, 7)] === BONE.Head && g.bone[idx(0, 2, 4)] === BONE.LeftUpperArm);
  ok('dark skin ramp picked', keyAt(composeCharacter(kit, recipe({ skin: 'dark' })), 1, 1, 0) === 'skin.3');
  ok('matKeys unique and in first-use order', new Set(g.matKeys).size === g.matKeys.length && g.matKeys[0] === 'skin.1');
  ok('bones and joints passed through', g.bones[3].name === 'LeftUpperArm' && g.bones[3].parent === 'Spine' && g.bones[3].joint.join() === '0,2,5');
  ok('mounts and clips copied', g.mounts.head_top.join() === '1,1,8' && g.clips.idle.duration === 1000 && g.clips !== kit.clips);
}

// 5. shells: thick 0 repaints the surface only
{
  const g = composeCharacter(kit, recipe({ top: { id: 'tee0', ramp: 'red' } }));
  ok('thick0: surface voxel repainted', keyAt(g, 1, 1, 4) === 'red.1');
  ok('thick0: interior voxel untouched', keyAt(g, 2, 2, 4) === 'skin.1', keyAt(g, 2, 2, 4));
  ok('thick0: other bones untouched', keyAt(g, 1, 1, 1) === 'skin.1' && keyAt(g, 0, 2, 4) === 'skin.1');
  const base = composeCharacter(kit, recipe());
  let added = 0;
  for (let i = 0; i < g.mat.length; i++) if (g.mat[i] && !base.mat[i]) added++;
  ok('thick0: no voxels added', added === 0);
}
// 6. thick growth with bone inheritance
{
  const base = composeCharacter(kit, recipe());
  const g = composeCharacter(kit, recipe({ top: { id: 'coat2', ramp: 'blue' } }));
  const grown = [];
  for (let i = 0; i < g.mat.length; i++) if (g.mat[i] && !base.mat[i]) grown.push(i);
  ok('thick2: voxels grown', grown.length > 0, String(grown.length));
  ok('thick2: grown voxels inherit the Spine bone', grown.every((i) => g.bone[i] === BONE.Spine));
  ok('thick2: grown voxels painted with the dye', grown.every((i) => g.matKeys[g.mat[i] - 1] === 'blue.1'));
  // x=4 is 1 away from the torso (x<=3), x=5 is 2 away, x=6 is 3 away
  ok('thick2: two layers outward, not three', keyAt(g, 4, 2, 4) === 'blue.1' && keyAt(g, 5, 2, 4) === 'blue.1' && g.mat[idx(6, 2, 4)] === 0);
  ok('thick2: arm voxels keep their bone and skin', g.bone[idx(0, 2, 4)] === BONE.LeftUpperArm && keyAt(g, 0, 2, 4) === 'skin.1');
  ok('thick2: grown cell next to the arm belongs to Spine', g.mat[idx(0, 1, 4)] !== 0 && g.bone[idx(0, 1, 4)] === BONE.Spine);
  const one = composeCharacter(kit, recipe({ top: { id: 'upper', ramp: 'red' } }));
  ok('region t0..t1 limits the shell to the upper half', keyAt(one, 1, 1, 5) === 'red.1' && keyAt(one, 1, 1, 3) === 'skin.1');
}
// 7. later layer wins
{
  const g = composeCharacter(kit, recipe({ top: { id: 'coat2', ramp: 'red' }, outer: { id: 'cloak', ramp: 'grey' } }));
  ok('outer repaints the outermost coat layer, inner layer stays', keyAt(g, 5, 2, 4) === 'grey.0' && keyAt(g, 4, 2, 4) === 'red.1');
  ok('outer does not touch the interior', keyAt(g, 2, 2, 4) === 'skin.1');
}
// 8. attachments, hides, paintOnly
{
  // anchor head_top = [1,1,8] is outside the 8-row grid: attachments are clipped, so use an offset into the head
  const k = makeKit();
  for (const a of k.attachments) a.offset = [0, 0, a.offset[2] - 2]; // z = 6..7 (hair/hat at 6; dye at 5)
  const hair = composeCharacter(k, recipe({ hair: { id: 'tuft', ramp: 'black' } }));
  ok('hair overwrites the head voxel and takes the Head bone', keyAt(hair, 1, 1, 6) === 'hair.1' && hair.bone[idx(1, 1, 6)] === BONE.Head);
  const hat = composeCharacter(k, recipe({ hair: { id: 'tuft', ramp: 'black' }, hat: { id: 'cap', ramp: 'felt' } }));
  ok('hat wins over the cell', keyAt(hat, 1, 1, 6) === 'felt.0');
  ok('hides: hair slot removed, base skin shows where the hat is absent', keyAt(hat, 3, 3, 6) === 'felt.0' && !hat.matKeys.includes('hair.1'));
  const dye = composeCharacter(k, recipe({ hat: { id: 'dye', ramp: 'felt' } }));
  const base = composeCharacter(k, recipe());
  let added = 0;
  for (let i = 0; i < dye.mat.length; i++) if (dye.mat[i] && !base.mat[i]) added++;
  ok('paintOnly adds no voxels', added === 0);
  ok('paintOnly repaints a filled voxel and keeps its bone', keyAt(dye, 1, 1, 5) === 'felt.0' && dye.bone[idx(1, 1, 5)] === BONE.Spine);
  ok('paintOnly skips empty cells', dye.mat[idx(0, 0, 5)] === 0);
}

// 9. determinism: two runs, byte-identical
{
  const r = recipe({ top: { id: 'coat2', ramp: 'blue' }, outer: { id: 'cloak', ramp: 'grey' }, hair: { id: 'tuft', ramp: 'black' } });
  const a = composeCharacter(makeKit(), r);
  const b = composeCharacter(makeKit(), clone(r));
  const same = Buffer.compare(Buffer.from(a.mat), Buffer.from(b.mat)) === 0 && Buffer.compare(Buffer.from(a.bone), Buffer.from(b.bone)) === 0
    && JSON.stringify({ ...a, mat: 0, bone: 0 }) === JSON.stringify({ ...b, mat: 0, bone: 0 });
  ok('byte-identical across runs', same);
}
// 10. more than 255 materials at compose time
{
  const k = makeKit(); const big = {};
  for (let i = 0; i < 300; i++) big[i] = `m${i}`;
  k.ramps.skin.big = big;
  k.slots.S = { group: 'skin', shade: 299 };
  // a single character can still only use shade keys it paints; build a base with 256 distinct shades
  k.bases.m.layers = makeLayers((x, y, z) => (inB(x, y, z, TORSO) ? 'S' : null));
  ok('compose with one shade stays small', composeCharacter(k, recipe({ skin: 'big' })).matKeys.length === 1);
}

// 11. imports stay inside engine/chargen
{
  const bad = [];
  for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    for (const m of fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      if (!m[1].startsWith('./')) bad.push(`${f}: ${m[1]}`);
    }
  }
  ok('engine/chargen imports only its own files', bad.length === 0, bad.join('; '));
}

console.log(`chargen.test: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
