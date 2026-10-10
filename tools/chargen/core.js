// tools/chargen/core.js (CHARGEN-13a, architecture.md 38.29 item 7): the UI-independent facade.
// No DOM, no fs, no Tauri, no three. Callers: UI, CLI (export.mjs), Tauri shell, later the editor.
import { composeCharacter, meshCharacter, randomRecipe, validateRecipe, validateKit, writeZip, openPackage, effectiveRes, clampRes, CHAR_GAME_MAX_QUADS } from '../../engine/index.js';
import { exportGlb } from '../export/gltfWrite.js';
import { exportFbx } from '../export/fbxWrite.js';
import { exportObj } from '../export/objWrite.js';
import { exportVoxGrid } from '../export/voxWrite.js';
import { encodePng } from '../export/png.js';

const enc = new TextEncoder();
const json = (o) => enc.encode(JSON.stringify(o, null, 2) + '\n');
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- CHARGEN-21: recipe json + seed share string + thumbnail (pure, no DOM) ----
const RECIPE_FORMAT = 'kestrel-chargen-recipe';
/** Canonical JSON (sorted keys) so the share hash does not depend on key order. */
const canon = (v) => (Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : v && typeof v === 'object'
  ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v));
/** FNV-1a 32 bit as 8 hex digits. */
export function recipeHash(recipe) {
  let h = 2166136261;
  const t = canon(recipe);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

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
  let grid = null; // composed grid, cached per recipe so .vox/.obj/.glb do not compose twice
  const getGrid = () => grid || (grid = composeCharacter(kit, recipe));
  const build = () => meshCharacter(getGrid());
  const glbOpts = (o = {}) => ({ rgbOf, recipe, partMap: kit.partMap, ...o });
  const fbx = () => exportFbx(build(), { rgbOf });

  const api = {
    lastWarnings: [], // savePackage warnings of the last call
    get recipe() { return clone(recipe); },
    setRecipe(r) { recipe = check(clone(r)); grid = null; return api.recipe; },
    random(seed) { recipe = check(randomRecipe(kit, seed)); grid = null; return api.recipe; },
    build,
    // --- CHARGEN-21 ---
    /** Recipe as text: {format, kit:{id,schema}, recipe}. */
    exportRecipeJson() { return JSON.stringify({ format: RECIPE_FORMAT, kit: { id: kit.id, schema: kit.schema }, recipe }, null, 2) + '\n'; },
    /** Parses + validates + adopts. Accepts the wrapper or a bare recipe. Returns {recipe, warnings}; throws a clear Error on garbage. */
    importRecipeJson(text) {
      let o;
      try { o = JSON.parse(text); } catch (e) { throw new Error('recipe import: not valid JSON (' + e.message + ')'); }
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('recipe import: expected a JSON object');
      const warnings = [];
      let r = o;
      if (o.format !== undefined || o.recipe !== undefined) {
        if (o.format !== RECIPE_FORMAT) throw new Error(`recipe import: unknown format "${o.format}" (expected "${RECIPE_FORMAT}")`);
        if (!o.recipe || typeof o.recipe !== 'object') throw new Error('recipe import: missing "recipe" object');
        r = o.recipe;
        const k = o.kit || {};
        if (k.id !== kit.id || k.schema !== kit.schema) warnings.push(`kit mismatch: file was made for ${k.id}@${k.schema}, this is ${kit.id}@${kit.schema}`);
      }
      const { errors } = validateRecipe(kit, r);
      if (errors.length) throw new Error('recipe import: invalid recipe:\n' + errors.join('\n'));
      return { recipe: api.setRecipe(r), warnings };
    },
    /** `kst1:<seed>:<hash>` for the current recipe; only a recipe that is exactly randomRecipe(kit, seed) can be shared this way. */
    shareString() {
      const seed = recipe.seed;
      if (!Number.isInteger(seed) || recipeHash(randomRecipe(kit, seed)) !== recipeHash(recipe)) throw new Error('seed share: the recipe was edited after Random; press Random or use Recipe .json');
      return `kst1:${seed >>> 0}:${recipeHash(recipe)}`;
    },
    /** Regenerates the recipe from a share string; wrong format or hash throws; adopts it. */
    importShareString(text) {
      const m = /^kst1:(\d{1,10}):([0-9a-f]{8})$/.exec(String(text).trim());
      if (!m) throw new Error('seed import: expected "kst1:<seed>:<hash>"');
      const seed = Number(m[1]);
      if (seed > 0xffffffff) throw new Error('seed import: seed out of range');
      const r = randomRecipe(kit, seed);
      if (recipeHash(r) !== m[2]) throw new Error('seed import: hash does not match (different kit version or corrupted string)');
      return { seed, recipe: api.random(seed) };
    },
    /** Front-view PNG (size x size, transparent background) of the composed grid. Deterministic bytes. */
    exportThumbPng(size = 128) {
      size = Math.max(8, Math.min(1024, size | 0));
      const g = getGrid(), [sx, sy, sz] = g.size;
      const px = new Uint8Array(size * size * 4);
      const scale = Math.min(size / sx, size / sz);
      const ow = Math.max(1, Math.round(sx * scale)), oh = Math.max(1, Math.round(sz * scale));
      const ox = (size - ow) >> 1, oy = size - oh; // feet on the bottom edge
      const rgb = g.matKeys.map((k) => rgbOf(k));
      for (let py = 0; py < oh; py++) for (let qx = 0; qx < ow; qx++) {
        const z = sz - 1 - Math.min(sz - 1, (py / scale) | 0), x = sx - 1 - Math.min(sx - 1, (qx / scale) | 0); // viewer faces the character: its right (east) is on the left
        for (let y = 0; y < sy; y++) { // character faces -y, so the nearest voxel to the viewer has the smallest y
          const m = g.mat[x + sx * (y + sy * z)];
          if (!m) continue;
          const c = rgb[m - 1], i = ((oy + py) * size + ox + qx) * 4, shade = 1 - 0.25 * (y / sy);
          px[i] = Math.round(c[0] * shade); px[i + 1] = Math.round(c[1] * shade); px[i + 2] = Math.round(c[2] * shade); px[i + 3] = 255;
          break;
        }
      }
      return encodePng(size, size, px);
    },
    exportGlb: (opts) => exportGlb(build(), glbOpts(opts)),
    exportFbx: fbx, // -> {fbx, png}
    exportVox: () => exportVoxGrid(getGrid(), { rgbOf }), // -> Uint8Array
    exportObj: () => exportObj(build(), { rgbOf, name: 'character' }), // -> {obj, mtl, png, mtlName, pngName}
    /** character.obj + .mtl + palette.png in one zip (for single-file save dialogs). */
    async exportObjZip() {
      const o = api.exportObj();
      return writeZip([{ path: o.mtlName, bytes: enc.encode(o.mtl) }, { path: 'character.obj', bytes: enc.encode(o.obj) }, { path: o.pngName, bytes: o.png }]);
    },
    /** glb + fbx + palette.png + recipe.json + obj/mtl + vox. */
    async exportAllZip() {
      const { fbx: fbxBytes, png } = fbx();
      const o = api.exportObj();
      const entries = [
        { path: 'character.glb', bytes: api.exportGlb() },
        { path: 'character.fbx', bytes: fbxBytes },
        { path: 'palette.png', bytes: png },
        { path: 'character.obj', bytes: enc.encode(o.obj) },
        { path: 'character.mtl', bytes: enc.encode(o.mtl) },
        { path: 'character.vox', bytes: api.exportVox() },
        { path: 'recipe.json', bytes: json(recipe) },
      ];
      return writeZip(entries);
    },
    /** A `.kestrel` package (kestrel.json + recipe.json + character.glb). meta: {id, name, version?, license?, authors?}. */
    async savePackage(meta = {}) {
      // CHARGEN-22c (38.34): "for the game" clamps finer picks to GAME_SAFE_RES, deterministic, with a warning
      const want = effectiveRes(recipe), safe = clampRes(want);
      const warnings = [];
      let rec = recipe, model = build();
      if (safe.body !== want.body || safe.head !== want.head) {
        rec = { ...clone(recipe), res: safe };
        warnings.push(`game-safe: res ${want.body}/${want.head} clamped to ${safe.body}/${safe.head} (game cap ${CHAR_GAME_MAX_QUADS} quads)`);
        model = meshCharacter(composeCharacter(kit, rec));
      }
      const glb = exportGlb(model, glbOpts({ recipe: rec }));
      if (model.mesh.quads > CHAR_GAME_MAX_QUADS) warnings.push(`game-safe: ${model.mesh.quads} quads is over the game cap ${CHAR_GAME_MAX_QUADS}; the game will refuse it`);
      api.lastWarnings = warnings;
      if (meta.onWarning) warnings.forEach((w) => meta.onWarning(w));
      const manifest = {
        format: 'kestrel-package', formatVersion: 1,
        id: meta.id || 'chargen.character', name: meta.name || 'Character', version: meta.version || '1.0.0',
        license: meta.license || { spdx: 'LicenseRef-chargen' },
        ...(meta.authors ? { authors: meta.authors } : {}),
        assets: [{ path: 'recipe.json', type: 'chargen.recipe' }, { path: 'character.glb', type: 'model.glb' }],
      };
      return writeZip([
        { path: 'kestrel.json', bytes: json(manifest) },
        { path: 'recipe.json', bytes: json(rec) },
        { path: 'character.glb', bytes: glb },
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
