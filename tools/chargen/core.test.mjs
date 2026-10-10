// CHARGEN-13a: facade + CLI arg parsing. Run: node tools/chargen/core.test.mjs
import assert from 'node:assert/strict';
import { createChargen } from './core.js';
import { readZip } from '../../engine/index.js';
import { parseVox } from '../vox-import.mjs';
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

await t('obj + vox: same seed -> same bytes, vox parses, zip lists all files', async () => {
  const a = mk(), b = mk();
  a.random(7); b.random(7);
  const oa = a.exportObj(), ob = b.exportObj();
  assert.equal(oa.obj, ob.obj); assert.equal(oa.mtl, ob.mtl); assert.ok(eq(oa.png, ob.png));
  assert.match(oa.obj, /mtllib character\.mtl/);
  const va = a.exportVox();
  assert.ok(va instanceof Uint8Array && eq(va, b.exportVox()));
  const parsed = parseVox(va);
  assert.ok(parsed.scene, 'vox has a scene graph');
  b.random(8);
  assert.ok(!eq(va, b.exportVox()));
  const files = readZip(await a.exportAllZip());
  const oz = readZip(await a.exportObjZip());
  for (const f of ['character.obj', 'character.mtl', 'palette.png']) assert.ok(oz.has(f), 'obj zip ' + f);
  for (const f of ['character.glb', 'character.fbx', 'palette.png', 'character.obj', 'character.mtl', 'character.vox', 'recipe.json']) assert.ok(files.has(f), f);
});

await t('CLI arg parsing', () => {
  assert.deepEqual(parseArgs(['--seed', '5', '--format', 'zip', '--out', 'a.zip']),
    { help: false, recipe: null, seed: 5, format: 'zip', out: 'a.zip', demoClips: false, fbx: null });
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--recipe', 'r.json', '--out', 'x']).format, 'glb');
  assert.equal(parseArgs(['--format', 'obj']).format, 'obj');
  assert.equal(parseArgs(['--format', 'vox']).format, 'vox');
  assert.throws(() => parseArgs(['--format', 'stl']), /--format/);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--seed']), /needs a value/);
  assert.throws(() => parseArgs(['--seed', '1', '--recipe', 'r']), /exclusive/);
});


// ---- CHARGEN-21 ----
await t('recipe json round trip, garbage + kit mismatch', () => {
  const a = mk(), b = mk();
  a.random(11);
  const r = b.importRecipeJson(a.exportRecipeJson());
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(b.recipe, a.recipe);
  assert.deepEqual(b.importRecipeJson(JSON.stringify(a.recipe)).recipe, a.recipe); // bare recipe
  for (const bad of ['', 'not json', '[]', '{"format":"x","recipe":{}}', '{"format":"kestrel-chargen-recipe"}', '{"height":"tall"}'])
    assert.throws(() => b.importRecipeJson(bad), /recipe import/, bad);
  const j = JSON.parse(a.exportRecipeJson()); j.kit.schema = 99;
  assert.equal(b.importRecipeJson(JSON.stringify(j)).warnings.length, 1);
});

await t('seed share string round trip over 20 seeds, wrong hash rejected', () => {
  const a = mk(), b = mk();
  for (let seed = 1; seed <= 20; seed++) {
    a.random(seed * 7919);
    const s = a.shareString();
    assert.match(s, /^kst1:\d+:[0-9a-f]{8}$/);
    assert.equal(b.importShareString(s).seed, seed * 7919);
    assert.deepEqual(b.recipe, a.recipe);
  }
  const s = a.shareString(), bad = s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');
  assert.throws(() => b.importShareString(bad), /hash does not match/);
  assert.throws(() => b.importShareString('kst2:1:abcd'), /expected/);
  const e = mk(); e.random(3); e.setRecipe({ ...e.recipe, height: e.recipe.height === 1 ? 2 : 1 });
  assert.throws(() => e.shareString(), /edited/);
});

await t('thumbnail png: valid, deterministic, differs per recipe', () => {
  const a = mk(), b = mk();
  a.random(5); b.random(5);
  const p = a.exportThumbPng(64);
  assert.ok(eq(p, b.exportThumbPng(64)));
  assert.deepEqual([...p.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(p.buffer, p.byteOffset);
  assert.equal(dv.getUint32(16), 64); assert.equal(dv.getUint32(20), 64);
  b.random(6);
  assert.ok(!eq(p, b.exportThumbPng(64)));
  assert.ok(p.length > 200);
});

console.log(`${n} passed`);
