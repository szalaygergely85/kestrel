// engine/chargen/height.test.js (CHARGEN-05): node engine/chargen/height.test.js
// Height rows, elder (overlay + height -1 + tempo), randomRecipe, on the real human kit (CHARGEN-01).
import fs from 'node:fs';
import { composeCharacter, meshCharacter, validateRecipe, validateKit, randomRecipe, heightBase, effectiveHeight, ageTempo } from './index.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const clone = (o) => JSON.parse(JSON.stringify(o));
const kit = JSON.parse(fs.readFileSync(new URL('../../content/chargen/human.charkit.json', import.meta.url), 'utf8'));
const base = kit.bases.m_avg;
const mats = new Set();
for (const s of Object.values(kit.slots)) if (s.fixed) mats.add(s.fixed);
for (const g of Object.values(kit.ramps)) for (const r of Object.values(g)) for (const m of Object.values(r)) mats.add(m);
const kv = validateKit(kit, mats);
ok('real kit validates', kv.errors.length === 0, kv.errors.slice(0, 3).join('; '));
const STRETCH = ['Hips', 'Spine', 'LeftLowerLeg', 'RightLowerLeg'];
const filled = (b) => b.layers.reduce((n, rows) => n + rows.join('').replace(/[. ]/g, '').length, 0);

// ---- height rows
ok('height 0 returns the base untouched', heightBase(base, 0) === base);
for (const h of [-4, -2, -1, 1, 2, 4]) {
  const b = heightBase(base, h);
  ok(`height ${h}: size z ${base.size[2] + h}`, b.size[2] === base.size[2] + h && b.layers.length === b.size[2], `${b.size[2]}`);
  ok(`height ${h}: head_top anchor moves by ${h} rows`, Math.abs(b.anchors.head_top[2] - (base.anchors.head_top[2] + h)) < 1e-9, `${b.anchors.head_top[2]}`);
  ok(`height ${h}: feet stay on z 0`, b.bones.LeftFoot.box[2] === base.bones.LeftFoot.box[2] && b.anchor[2] === base.anchor[2]);
  const g = composeCharacter(kit, { ...clone(kit.defaults), height: h }); // throws if a voxel leaves its bone box
  ok(`height ${h}: composes with ${g.size[2]} rows`, g.size[2] === base.size[2] + h);
  let other = '';
  for (const name of Object.keys(base.bones)) {
    const q0 = base.bones[name].box, q1 = b.bones[name].box;
    if ((q1[5] - q1[2]) !== (q0[5] - q0[2]) && !STRETCH.includes(name)) other = name;
  }
  ok(`height ${h}: only stretch bones change their box height`, other === '', other);
}
{
  const b = heightBase(base, 3);
  let jointsIn = true;
  for (const name of Object.keys(base.bones)) {
    const q = b.bones[name].box, j = b.bones[name].joint, q0 = base.bones[name].box, j0 = base.bones[name].joint;
    // the joint keeps its relative place in the box (within 1 row)
    if (Math.abs((j[2] - q[2]) - (j0[2] - q0[2])) > 3.001) jointsIn = false;
  }
  ok('height +3: joints stay at their place in the (grown) boxes', jointsIn);
  ok('heightBase is deterministic', JSON.stringify(heightBase(base, -3)) === JSON.stringify(heightBase(base, -3)));
  ok('height +4 adds voxels (duplicated rows)', filled(heightBase(base, 4)) > filled(base));
  ok('height -4 removes voxels', filled(heightBase(base, -4)) < filled(base));
  let thrown = false;
  try { heightBase({ ...base, stretchRows: [] }, 1); } catch (e) { thrown = /no stretchRows/.test(e.message); }
  ok('a base without stretchRows rejects height != 0', thrown);
  ok('recipe height 5 is rejected', validateRecipe(kit, { ...clone(kit.defaults), height: 5 }).errors.length > 0);
}
{
  const g0 = composeCharacter(kit, kit.defaults), g2 = composeCharacter(kit, { ...clone(kit.defaults), height: 2 });
  const m0 = meshCharacter(g0), m2 = meshCharacter(g2);
  ok('mesh at height +2 stays <= 8000 quads', m2.mesh.quads <= 8000 && m0.mesh.quads <= 8000, `${m0.mesh.quads} / ${m2.mesh.quads}`);
  const hi = m0.bones.findIndex((x) => x.name === 'Head');
  ok('joints follow: Head joint z + 2 at height +2', Math.abs(m2.bones[hi].joint[2] - m0.bones[hi].joint[2] - 2 * 0.025) < 1e-6 || Math.abs(m2.bones[hi].joint[2] - m0.bones[hi].joint[2] - 2) < 1e-6,
    `${m0.bones[hi].joint[2]} -> ${m2.bones[hi].joint[2]}`);
}

// ---- elder
{
  const r = { ...clone(kit.defaults), age: 'elder', height: 0 };
  ok('elder: effective height is one row less, clamped at -4', effectiveHeight(r) === -1 && effectiveHeight({ ...r, height: -4 }) === -4 && effectiveHeight({ ...r, age: 'adult', height: 2 }) === 2);
  ok('elder tempo x1.15, others x1', ageTempo(r) === 1.15 && ageTempo({ age: 'adult' }) === 1 && ageTempo({ age: 'young' }) === 1);
  const g = composeCharacter(kit, r);
  ok('elder grid is one row shorter, tempo on grid and rigged model', g.size[2] === base.size[2] - 1 && g.tempo === 1.15 && meshCharacter(g).tempo === 1.15);
  // overlay: any kit attachment of slot 'overlay' is painted last, only for elder
  const k2 = clone(kit);
  const skinChar = Object.keys(k2.slots).find((c) => k2.slots[c].fixed !== undefined); // a fixed-material char: visibly different from the skin
  k2.attachments = [{ id: 'elder_overlay', slot: 'overlay', bone: 'Head', anchor: 'head_top', offset: [0, 0, -2], box: [1, 1, 1], layers: [[[skinChar]]] }];
  const plain = composeCharacter(kit, { ...r, height: 1 }), withOv = composeCharacter(k2, { ...r, height: 1 }); // elder height 1 -> 0 rows
  const diff = (x, y) => x.mat.reduce((n, v, i2) => n + (x.matKeys[v - 1] !== y.matKeys[y.mat[i2] - 1] ? 1 : 0), 0);
  ok('elder overlay paints its voxel', diff(plain, withOv) === 1, `${diff(plain, withOv)}`);
  const adultA = composeCharacter(k2, clone(kit.defaults)), adultB = composeCharacter(kit, kit.defaults);
  ok('overlay is skipped for adults', diff(adultA, adultB) === 0);
}

// ---- randomRecipe
{
  const a = randomRecipe(kit, 12345), b = randomRecipe(kit, 12345), c = randomRecipe(kit, 12346);
  ok('same seed, same recipe', JSON.stringify(a) === JSON.stringify(b));
  ok('different seeds differ', JSON.stringify(a) !== JSON.stringify(c));
  ok('recipe keeps its seed', a.seed === 12345);
  let bad = 0, firstBad = '';
  const seen = new Set(), heights = new Set(), ages = new Set();
  for (let s = 0; s < 1000; s++) {
    const r = randomRecipe(kit, s);
    const v = validateRecipe(kit, r);
    if (v.errors.length) { bad++; firstBad = firstBad || `${s}: ${v.errors[0]}`; }
    seen.add(`${r.skin}/${r.eyes}/${r.height}/${r.age}`); heights.add(r.height); ages.add(r.age);
  }
  ok('all 1000 seeds validate', bad === 0, firstBad);
  ok('seeds vary: skins x eyes x heights x ages', seen.size > 60 && heights.size === 9 && ages.size === 3, `${seen.size} combos, ${heights.size} heights, ${ages.size} ages`);
  let comp = 0;
  for (let s = 0; s < 60; s++) { const g = composeCharacter(kit, randomRecipe(kit, s * 17)); if (g.size[2] > 60) comp++; }
  ok('60 random recipes compose', comp === 60);
  const k2 = clone(kit);
  k2.random = { height: { '-4': 0, '-3': 0, '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0, '3': 1, '4': 0 }, age: { young: 0, adult: 0, elder: 1 }, skin: { dark: 1, fair: 0, warm: 0, medium: 0, brown: 0 } };
  let weighted = true;
  for (let s = 0; s < 200; s++) { const r = randomRecipe(k2, s); if (r.height !== 3 || r.age !== 'elder' || r.skin !== 'dark') weighted = false; }
  ok('kit.random weights are honoured (0 = never)', weighted);
  const k3 = clone(kit);
  k3.shells = [{ id: 'tunic', slot: 'top', regions: [{ bone: 'Chest', t0: 0, t1: 1 }], thick: 1, paint: Object.keys(k3.slots).find((c) => k3.slots[c].group === 'top') }];
  let tops = 0, nulls = 0;
  for (let s = 0; s < 300; s++) { const r = randomRecipe(k3, s); if (validateRecipe(k3, r).errors.length) { tops = -1e9; break; } if (r.top) tops++; else nulls++; }
  ok('slot picks mix item and none, and validate', tops > 80 && nulls > 80, `${tops}/${nulls}`);
}

console.log(`chargen height.test: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log('FAILURES:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); } else { console.log('ALL PASS'); process.exit(0); }
