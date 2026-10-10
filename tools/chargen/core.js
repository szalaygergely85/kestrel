// tools/chargen/core.js (CHARGEN-13a, architecture.md 38.29 item 7): the UI-independent facade.
// No DOM, no fs, no Tauri, no three. Callers: UI, CLI (export.mjs), Tauri shell, later the editor.
import { composeCharacter, meshCharacter, randomRecipe, validateRecipe, validateKit, writeZip, openPackage } from '../../engine/index.js';
import { exportGlb } from '../export/gltfWrite.js';
import { exportFbx } from '../export/fbxWrite.js';

const enc = new TextEncoder();
const json = (o) => enc.encode(JSON.stringify(o, null, 2) + '\n');
const clone = (o) => JSON.parse(JSON.stringify(o));
const notImpl = (what) => { const e = new Error(`${what}: not implemented (CHARGEN-12)`); e.notImplemented = true; return e; };

/**
 * @param {{kit:Object, rgbOf:(matKey:string)=>number[], materials?:Object}} opts  `materials` (optional) enables validateKit.
 */
export function createChargen({ kit, rgbOf, materials = null }) {
  if (!kit) throw new Error('createChargen: kit is required');
  if (typeof rgbOf !== 'function') throw new Error('createChargen: rgbOf(matKey) -> [r,g,b] is required');
  if (materials) {
    const kv = validateKit(kit, materials);
    if (kv.errors.length) throw new Error('kit errors:\n' + kv.errors.join('\n'));
  }
  const check = (r) => {
    const { errors } = validateRecipe(kit, r);
    if (errors.length) throw new Error('invalid recipe:\n' + errors.join('\n'));
    return r;
  };
  let recipe = check(clone(kit.defaults));
  const build = () => meshCharacter(composeCharacter(kit, recipe));
  const glbOpts = (o = {}) => ({ rgbOf, recipe, partMap: kit.partMap, ...o });
  const fbx = () => exportFbx(build(), { rgbOf });

  const api = {
    get recipe() { return clone(recipe); },
    setRecipe(r) { recipe = check(clone(r)); return api.recipe; },
    random(seed) { recipe = check(randomRecipe(kit, seed)); return api.recipe; },
    build,
    exportGlb: (opts) => exportGlb(build(), glbOpts(opts)),
    exportFbx: fbx, // -> {fbx, png}
    exportVox() { throw notImpl('exportVox'); },
    exportObj() { throw notImpl('exportObj'); },
    /** glb + fbx + palette.png + recipe.json (+ obj/vox once CHARGEN-12 lands). */
    async exportAllZip() {
      const { fbx: fbxBytes, png } = fbx();
      const entries = [
        { path: 'character.glb', bytes: api.exportGlb() },
        { path: 'character.fbx', bytes: fbxBytes },
        { path: 'palette.png', bytes: png },
        { path: 'recipe.json', bytes: json(recipe) },
      ];
      // CHARGEN-12 adds .obj/.vox here; until then they are skipped, not an error.
      return writeZip(entries);
    },
    /** A `.kestrel` package (kestrel.json + recipe.json + character.glb). meta: {id, name, version?, license?, authors?}. */
    async savePackage(meta = {}) {
      const manifest = {
        format: 'kestrel-package', formatVersion: 1,
        id: meta.id || 'chargen.character', name: meta.name || 'Character', version: meta.version || '1.0.0',
        license: meta.license || { spdx: 'LicenseRef-chargen' },
        ...(meta.authors ? { authors: meta.authors } : {}),
        assets: [{ path: 'recipe.json', type: 'chargen.recipe' }, { path: 'character.glb', type: 'model.glb' }],
      };
      return writeZip([
        { path: 'kestrel.json', bytes: json(manifest) },
        { path: 'recipe.json', bytes: json(recipe) },
        { path: 'character.glb', bytes: api.exportGlb() },
      ]);
    },
    /** Reads a package written by savePackage, validates and adopts its recipe. */
    async openPackage(bytes) {
      const pkg = await openPackage(bytes);
      if (!pkg.has('recipe.json')) throw new Error('package has no recipe.json');
      return api.setRecipe(JSON.parse(await pkg.readText('recipe.json')));
    },
  };
  return api;
}
