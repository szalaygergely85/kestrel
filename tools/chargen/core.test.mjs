// CHARGEN-13a: facade + CLI arg parsing. Run: node tools/chargen/core.test.mjs
import assert from 'node:assert/strict';
import { createChargen } from './core.js';
import { loadKit, paletteRgbOf, parseArgs } from './export.mjs';

const kit = loadKit();
const mk = () => createChargen({ kit, rgbOf: paletteRgbOf(), materials: globalThis.ASSETS.palette.materials });
let n = 0;
const t = async (name, f) => { await f(); n++; console.log('ok  ' + name); };
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

await t('same seed -> same bytes (glb, fbx, zip)', async () => {
  const a = mk(), b = mk();
  a.random(7); b.random(7);
  assert.ok(eq(a.exportGlb(), b.exportGlb()));
  assert.ok(eq(a.exportFbx().fbx, b.exportFbx().fbx));
  assert.ok(eq(await a.exportAllZip(), await b.exportAllZip()));
  b.random(8);
  assert.ok(!eq(a.exportGlb(), b.exportGlb()));
});

await t('setRecipe validates; bad recipe throws with field path', () => {
  const c = mk();
  const bad = c.recipe; bad.height = 'tall';
  assert.throws(() => c.setRecipe(bad), /invalid recipe[\s\S]*height/);
  assert.throws(() => c.setRecipe({}), /invalid recipe/);
  assert.equal(c.recipe.height, kit.defaults.height); // unchanged after a failed set
});

await t('exportGlb parses as glb', () => {
  const g = mk().exportGlb();
  const dv = new DataView(g.buffer, g.byteOffset, g.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67);
  assert.equal(dv.getUint32(4, true), 2);
  assert.equal(dv.getUint32(8, true), g.length);
  const jl = dv.getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(g.subarray(20, 20 + jl)));
  assert.equal(j.asset.version, '2.0');
  assert.ok(j.skins.length === 1 && j.meshes.length === 1);
});

await t('savePackage -> openPackage returns the recipe', async () => {
  const a = mk(); a.random(3);
  const bytes = await a.savePackage({ id: 'test.hero', name: 'Hero' });
  const b = mk();
  const r = await b.openPackage(bytes);
  assert.deepEqual(r, a.recipe);
  assert.deepEqual(b.recipe, a.recipe);
});

await t('obj/vox throw not implemented (CHARGEN-12)', () => {
  const c = mk();
  assert.throws(() => c.exportObj(), /not implemented \(CHARGEN-12\)/);
  assert.throws(() => c.exportVox(), /not implemented \(CHARGEN-12\)/);
});

await t('CLI arg parsing', () => {
  assert.deepEqual(parseArgs(['--seed', '5', '--format', 'zip', '--out', 'a.zip']),
    { help: false, recipe: null, seed: 5, format: 'zip', out: 'a.zip', demoClips: false, fbx: null });
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--recipe', 'r.json', '--out', 'x']).format, 'glb');
  assert.throws(() => parseArgs(['--format', 'obj']), /--format/);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--seed']), /needs a value/);
  assert.throws(() => parseArgs(['--seed', '1', '--recipe', 'r']), /exclusive/);
});

console.log(`${n} passed`);
