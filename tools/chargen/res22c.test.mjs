// CHARGEN-22c (architecture.md 38.34 items 4-5, 8h): exports + game cap with mixed res. Run: node tools/chargen/res22c.test.mjs
import assert from 'node:assert/strict';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { createChargen } from './core.js';
import { composeCharacter, readRiggedGlb } from '../../engine/index.js';
import { loadKit, paletteRgbOf } from './export.mjs';
import { parseVox } from '../voxParse.js';
import { flattenGrid } from '../export/voxWrite.js';
import { registerRiggedChars } from '../../game/js/quest/charRegister.js';

const kit = loadKit(), rgbOf = paletteRgbOf();
// head detail made by nearest-upsampling the kit's own head cells (test only; the designer's L2 is CHARGEN-23)
const base = kit.bases.m_avg, hb = base.bones.Head.box, jb = base.bones.Jaw.box;
const box = [0, 1, 2].map((k) => Math.min(hb[k], jb[k])).concat([3, 4, 5].map((k) => Math.max(hb[k], jb[k])));
kit.regions = { head: { bones: ['Head', 'Jaw'], box } };
kit.resLevels = { body: [1], head: [1, 2, 4] };
const inBox = (q, x, y, z) => x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5];
const up = (L) => {
  const out = [];
  for (let z = 0; z < (box[5] - box[2] + 1) * L; z++) {
    const pl = [];
    for (let y = 0; y < (box[4] - box[1] + 1) * L; y++) {
      let row = '';
      for (let x = 0; x < (box[3] - box[0] + 1) * L; x++) {
        const gx = box[0] + ((x / L) | 0), gy = box[1] + ((y / L) | 0), gz = box[2] + ((z / L) | 0);
        const fb = kit.skeleton.find((b) => base.bones[b.name] && inBox(base.bones[b.name].box, gx, gy, gz));
        row += fb && (fb.name === 'Head' || fb.name === 'Jaw') ? base.layers[gz][gy][gx] : '.';
      }
      pl.push(row);
    }
    out.push(pl);
  }
  return out;
};
base.detail = { head: { 2: { layers: up(2) }, 4: { layers: up(4) } } };
const mk = (res) => { const c = createChargen({ kit, rgbOf }); const r = c.recipe; if (res) r.res = res; c.setRecipe(r); return c; };
let n = 0;
const t = async (name, f) => { await f(); n++; console.log('ok  ' + name); };

await t('.vox {1,2}: finest grid, one shape per bone, round trip', () => {
  const c = mk({ body: 1, head: 2 }), c1 = mk();
  const v = parseVox(c.exportVox()), v1 = parseVox(c1.exportVox());
  const g = composeCharacter(kit, c.recipe), fl = flattenGrid(g);
  assert.equal(fl.F, 2);
  assert.equal(fl.size[0], g.size[0] * 2);
  assert.ok(v.models.length >= 2);
  const total = (p) => p.models.reduce((s, m) => s + m.voxels.length, 0);
  const nz = fl.mat.reduce((s, m) => s + (m ? 1 : 0), 0);
  assert.equal(total(v), nz, 'every fine voxel exported');
  assert.ok(total(v) > total(v1) * 4, 'body upsampled x8');
});
await t('glb / fbx / obj build at {1,2} and {2,4} cellM = G', () => {
  const c = mk({ body: 1, head: 2 });
  const glb = c.exportGlb();
  const r = readRiggedGlb(glb, 'x');
  assert.ok(r && glb.length > 1000);
  assert.ok(c.exportFbx().fbx.length > 1000);
  assert.ok(c.exportObj().obj.length > 1000);
  assert.equal(c.build().cellM, 0.025 / 2);
  assert.equal(mk({ body: 1, head: 4 }).build().cellM, 0.025 / 4);
});
await t('savePackage {1,4} clamps to game-safe with a warning; {1,1} no warning', async () => {
  const c = mk({ body: 1, head: 4 });
  const got = []; const bytes = await c.savePackage({ id: 't.h', onWarning: (w) => got.push(w) });
  assert.ok(got.length === 1 && /clamped to 1\/2/.test(got[0]), got.join());
  const rec = await mk().openPackage(bytes);
  assert.deepEqual(rec.res, { body: 1, head: 2 });
  assert.equal(c.recipe.res.head, 4, 'working recipe untouched');
  const d = mk(); await d.savePackage({}); assert.deepEqual(d.lastWarnings, []);
});
await t('charRegister rejects an over-cap model naming the id', () => {
  const model = readRiggedGlb(mk().exportGlb(), 'fat');
  const errs = [], reg = { added: [], add(...a) { this.added.push(a); } };
  registerRiggedChars(reg, { fat: { kind: 'rigged', model } }, (e) => errs.push(e), 10);
  assert.ok(errs.length === 1 && /fat/.test(errs[0].message + errs[0].file) && /game cap/.test(errs[0].message) && reg.added.length === 0);
  registerRiggedChars(reg, { fat: { kind: 'rigged', model } }, (e) => errs.push(e));
  assert.equal(errs.length, 1); assert.equal(reg.added.length, 1);
});
console.log(`res22c: ${n} ok`);
