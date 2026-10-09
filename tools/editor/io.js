// tools/editor/io.js - US-034 (docs/architecture.md 24.10/24.11). Save/load/
// validate + the play-test handoff. The pure parts (`toFileObject`,
// `buildMemoryPack`, `validateDoc`) have no DOM/window dependency and are
// Node-tested (io.test.mjs); `saveFile`/`saveAll`/`loadFile`/`launchPlaytest`
// touch `window`/`localStorage`/the File System Access API and are browser
// only (same split as pick.js/select.js - no Node test for those).
//
// Imports only engine/index.js + doc.js (the editor boundary rule).
import {
  AssetRegistry, World, ContentError, migrateContent, loadContentPack, stringifyContent, prefabFromJSON,
} from '../../engine/index.js';
import { fileKey } from './doc.js';
import { validateItem } from './panel.js';
import { terrainEditsText } from './terrainBrush.js';

/**
 * One file's full envelope + data (24.10): `{ kind, schema, id, nextId,
 * ...def }`. `stringify.js`'s own `KEY_ORDER` reorders this for output, so
 * the property order written here does not matter.
 * @param {{kind:string, id:string, def:Object, meta:{schema:number, nextId:number}}} file
 */
export function toFileObject(file) {
  return { kind: file.kind, schema: file.meta.schema, id: file.id, nextId: file.meta.nextId, ...file.def };
}

/** `path(u)` per 24.10: the manifest/file's pathname with the leading `/` stripped, used as the in-memory map key. */
function memPath(url) {
  return new URL(url).pathname.slice(1);
}

/** The relative path a doc file would live at under `content/` - only used to build the throwaway manifest's `files[]` list, never read by anything else. */
function relPathFor(file) {
  return `${file.kind}s/${file.id}.${file.kind}.json`;
}

/**
 * Builds the in-memory manifest + file-text map `validateDoc` feeds to
 * `loadContentPack` (24.10). `overrideFileId`/`overrideText`, when given,
 * substitute one file's text before the manifest is built (the Load flow's
 * "validate with this file substituted", 24.10) without mutating `doc`.
 * @param {{files: Map<string, Object>}} doc
 * @param {{overrideFileId?: string, overrideText?: string}} [opts]
 * @returns {{manifestHref:string, mem:Map<string,string>}}
 */
function buildMemoryPack(doc, opts = {}) {
  const files = [...doc.files.values()];
  const mem = new Map();
  const manifestFiles = files.map((f) => relPathFor(f));
  const manifestObj = { kind: 'manifest', schema: 1, id: 'editor', contentVersion: 0, files: manifestFiles };
  mem.set('manifest.json', JSON.stringify(manifestObj));
  for (const f of files) {
    const fid = fileKey(f.kind, f.id);
    const text = (opts.overrideFileId === fid && opts.overrideText != null) ? opts.overrideText : stringifyContent(toFileObject(f));
    mem.set(relPathFor(f), text);
  }
  return { manifestHref: 'http://editor.invalid/manifest.json', mem };
}

/**
 * Validates the whole document (24.10): same-file reference checks via a
 * throwaway `loadContentPack` over an in-memory manifest, then cross-file
 * checks (`structures[].level`, `world.terrain`) via a throwaway
 * `World.load` per world file. Never throws - returns the `ContentError`
 * found, or `null` when everything is valid.
 * @param {{files: Map<string, Object>}} doc
 * @param {Object} codeParts - same shape as `AssetRegistry.fromJSON`'s
 *   second argument (`window.ASSETS`: palette/models/detailPass/uiStyle and
 *   any code-recipe terrain, e.g. `overworld_far`) - supplies everything the
 *   edited level/world files don't carry themselves.
 * @param {{overrideFileId?: string, overrideText?: string, reference?: {meshes?: Object, terrainEdits?: Object}}} [opts] - the
 *   Load flow's "substitute this file's text before validating" (24.10); `reference` = the loaded content bundle whose
 *   read-only `meshes`/`terrainEdits` sit under the doc's own (never edited or saved).
 * @returns {Promise<import('../../engine/index.js').ContentError|null>}
 */
export async function validateDoc(doc, codeParts, opts = {}) {
  try {
    const { manifestHref, mem } = buildMemoryPack(doc, opts);
    const fetchText = (u) => (mem.has(memPath(u)) ? Promise.resolve(mem.get(memPath(u))) : Promise.reject(new Error('HTTP 404')));
    const bundle = await loadContentPack(manifestHref, { fetchText });
    // Read-only reference content the doc does not carry (loaded bundle meshes/terrainEdits): lets structures[].mesh ids resolve.
    const ref = opts.reference || {};
    bundle.meshes = { ...(ref.meshes || {}), ...(bundle.meshes || {}) };
    bundle.terrainEdits = { ...(ref.terrainEdits || {}), ...(bundle.terrainEdits || {}) };
    const assets = AssetRegistry.fromJSON(bundle, codeParts);
    for (const prefab of Object.values(bundle.prefabs)) for (const item of prefab.items) {
      const errors = validateItem(item.type, {...item, id:item.id || 'prefab_item'}, {assets, palette:assets.palette});
      if (item.type === 'light' && typeof item.preset !== 'string') errors.push('preset: required');
      if (errors.length) throw new ContentError(prefab.id, 'items', errors.join('; '));
    }
    for (const worldId of Object.keys(bundle.worlds)) {
      World.load(assets.world(worldId), assets, {});
    }
    return null;
  } catch (e) {
    return e instanceof ContentError ? e : new ContentError('(validateDoc)', 'world', e && e.message ? e.message : String(e));
  }
}

/** True while any file in `doc` has unsaved edits (`beforeunload` warning, 24.10). */
export function anyDirty(doc) {
  for (const file of doc.files.values()) if (file.dirty) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Below this line: browser-only (File System Access API / `<a download>` /
// `localStorage` / `window.open`) - no Node test, same split as pick.js.
// ---------------------------------------------------------------------------

/** `Blob` + `<a download>` fallback (24.10) - used when the File System Access API is unavailable, or `forceDownload` is set (doc.readOnly, 24.3's "before US-027b" rule, still honoured now that US-027b IS merged in case a file was opened from `fromGlobals`). */
function downloadFallback(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves one file (24.10 "Save"): `showSaveFilePicker` (kept on the file's
 * `handle` for the session) when available and not forced to download,
 * `<a download>` otherwise. Clears `file.dirty` on success.
 * @param {Object} file - a `doc.files` entry
 * @param {{forceDownload?: boolean}} [opts]
 */
export async function saveFile(file, opts = {}) {
  const text = stringifyContent(toFileObject(file));
  const name = `${file.id}.${file.kind}.json`;
  const canPicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function' && !opts.forceDownload;
  if (canPicker) {
    if (!file.handle) {
      file.handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Kestrel content', accept: { 'application/json': ['.json'] } }],
      });
    }
    const writable = await file.handle.createWritable();
    await writable.write(text);
    await writable.close();
  } else {
    downloadFallback(text, name);
  }
  file.dirty = false;
}

/**
 * Saves every dirty file in `doc` (Ctrl+S / the Save button, 24.10).
 * `doc.readOnly` forces the download fallback for every file (24.3's
 * download-only rule) even when the FSA API is present.
 * @param {{files: Map<string, Object>, readOnly?: boolean}} doc
 * @returns {Promise<string[]>} the `fileKey`s actually saved
 */
export async function saveAll(doc) {
  const saved = [];
  let prefabManifest = null;
  for (const file of doc.files.values()) {
    if (!file.dirty) continue;
    if (file.kind === 'prefab' && file.meta.manifestPending) {
      if (!prefabManifest) prefabManifest = await (await fetch('../../content/manifest.json', {cache:'no-store'})).json();
      prefabManifest = await savePrefabFile(file, prefabManifest, {forceDownload:!!doc.readOnly});
    } else await saveFile(file, { forceDownload: !!doc.readOnly });
    saved.push(fileKey(file.kind, file.id));
  }
  return saved;
}

/** Opens a native file picker (or an `<input type=file>` fallback) and resolves `{ text, name }`, or `null` if the user cancelled. */
async function pickTextFile() {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        types: [{ description: 'Kestrel content', accept: { 'application/json': ['.json'] } }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return null; // user cancelled
      throw e;
    }
    const handle = handles[0];
    const f = await handle.getFile();
    return { text: await f.text(), name: f.name, handle };
  }
  // `<input type=file>` fallback (no FSA API).
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) { resolve(null); return; }
      resolve({ text: await f.text(), name: f.name, handle: null });
    });
    // A cancelled native dialog fires no `change` and no reliable event
    // cross-browser; the caller is left with a pending promise, same
    // trade-off `<input type=file>` always has without the FSA API.
    input.click();
  });
}

/**
 * Opens a native file picker (or an `<input type=file>` fallback) for a
 * BINARY file and resolves `{ buffer, name }` (an `ArrayBuffer` - not text),
 * or `null` if the user cancelled. Same two-path shape as `pickTextFile`
 * above; used by OWN-REQ-011's "Import .vox" button (main.js), which needs
 * the raw bytes, not a text decode.
 * @param {{accept?: string, description?: string}} [opts] `accept`: an
 *   `<input accept>`-shaped extension/MIME string, e.g. `.vox`.
 * @returns {Promise<{buffer: ArrayBuffer, name: string}|null>}
 */
export async function pickBinaryFile(opts = {}) {
  const accept = opts.accept || '*/*';
  const description = opts.description || 'File';
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        types: [{ description, accept: { 'application/octet-stream': [accept] } }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return null; // user cancelled
      throw e;
    }
    const f = await handles[0].getFile();
    return { buffer: await f.arrayBuffer(), name: f.name };
  }
  // `<input type=file>` fallback (no FSA API) - same pattern as `pickTextFile`.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) { resolve(null); return; }
      resolve({ buffer: await f.arrayBuffer(), name: f.name });
    });
    input.click();
  });
}

/**
 * Loads a world/level JSON file back into `doc` (24.10 "Load"): parses,
 * migrates, validates with the new content substituted, then replaces the
 * matching registry entry via `AssetRegistry.replace` (US-069, 24.12 item 6 -
 * the editor's old in-place-object-mutation workaround) so every existing
 * reference into it (the World, other selections) stays valid. Throws (a
 * `ContentError` or a plain `Error`) on any failure - `doc` is left untouched
 * in that case.
 * @param {{files: Map<string, Object>}} doc
 * @param {import('../../engine/index.js').AssetRegistry} assets
 * @param {Object} codeParts - passed straight through to `validateDoc`
 * @returns {Promise<string|null>} the loaded file's `fileKey`, or `null` if the user cancelled the picker
 */
export async function loadFile(doc, assets, codeParts, opts = {}) {
  const picked = await pickTextFile();
  if (!picked) return null;

  let obj;
  try {
    obj = JSON.parse(picked.text);
  } catch (e) {
    throw new ContentError(picked.name, 'json', e.message);
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ContentError(picked.name, 'kind', 'file is not a JSON object');
  }
  const migrated = migrateContent(obj.kind, obj, picked.name, {}); // throws a clear ContentError on an unknown/newer/un-migratable schema (US-027-consistent, AC 4)

  const fid = fileKey(migrated.kind, migrated.id);
  const existing = doc.files.get(fid);
  if (!existing && migrated.kind === 'prefab') {
    const candidate = {files:new Map(doc.files), worldId:doc.worldId};
    addPrefabFile(candidate, migrated);
    const err = await validateDoc(candidate, codeParts, {reference:opts.reference});
    if (err) throw err;
    const file = addPrefabFile(doc, migrated);
    file.handle = picked.handle || null;
    return fid;
  }
  if (!existing) {
    throw new ContentError(picked.name, 'id', `no open document matches ${migrated.kind} "${migrated.id}" - the editor only loads back into a level/world it already has open`);
  }

  const text = stringifyContent(migrated); // re-canonicalise before validating (buildMemoryPack expects each file's text, not the raw object)
  const err = await validateDoc(doc, codeParts, { overrideFileId: fid, overrideText: text, reference:opts.reference });
  if (err) throw err;

  const { kind: _k, schema, id: _id, nextId, ...defRest } = migrated;
  // AssetRegistry.replace (US-069, 24.12 item 6): replaces the registry's
  // own object in place - every live reference to `existing.def` (the World,
  // other selections, etc.) sees the new content without needing to be
  // re-resolved.
  if (existing.kind === 'prefab') existing.def = defRest;
  else assets.replace(existing.kind, existing.id, defRest);
  existing.meta.schema = schema;
  existing.meta.nextId = nextId;
  existing.dirty = false;
  if (picked.handle) existing.handle = picked.handle;
  return fid;
}

/**
 * Play-test handoff (24.11): writes every loaded document (envelope-free,
 * dirty or not - the CURRENT in-memory state, per the AC's "possibly
 * unsaved") to `localStorage['kestrel.playtest']` and opens the game in a
 * new tab with `?playtest=1&world=<worldId>`. No server write; works before
 * saving.
 * @param {{worldId:string, files: Map<string, Object>}} doc
 */
export function launchPlaytest(doc) {
  const files = {};
  for (const file of doc.files.values()) files[fileKey(file.kind, file.id)] = file.def;
  const payload = { savedAt: Date.now(), world: doc.worldId, files };
  try {
    window.localStorage.setItem('kestrel.playtest', JSON.stringify(payload));
  } catch (e) {
    console.warn('[editor] play-test: localStorage write failed (private mode / quota?)', e);
  }
  window.open(`../../game/index.html?playtest=1&world=${encodeURIComponent(doc.worldId)}`, '_blank');
}

/**
 * ED-TERRAIN-1c: saves the terrain edit layer to `<key>.edits.json` (the file lives at content/terrain/ - the
 * File System Access picker remembers the handle in `state.handle`; otherwise a download). Clears `state.dirty`.
 * @param {{layer:Object, key:string, handle:Object|null, dirty:boolean}} state
 */
export async function saveTerrainEdits(state, opts = {}) {
  const text = terrainEditsText(state.layer, state.key);
  const name = `${state.key}.edits.json`;
  const canPicker = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function' && !opts.forceDownload;
  if (canPicker) {
    if (!state.handle) {
      state.handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: 'Kestrel terrain edits', accept: { 'application/json': ['.json'] } }],
      });
    }
    const writable = await state.handle.createWritable();
    await writable.write(text);
    await writable.close();
  } else {
    downloadFallback(text, name);
  }
  state.dirty = false;
}

/** Add a validated editor-owned prefab file; production files are written only by Save. */
export function addPrefabFile(doc, obj) {
  prefabFromJSON(obj);
  const fid = fileKey('prefab', obj.id);
  if (doc.files.has(fid)) throw new Error(`prefab "${obj.id}" already exists`);
  const {kind, schema, id, nextId, ...def} = structuredClone(obj);
  const file = {kind, id, def, meta:{schema, nextId, url:null, manifestPending:true}, dirty:true, handle:null};
  doc.files.set(fid, file);
  return file;
}

export function appendPrefabManifest(manifest, id) {
  if (manifest?.kind !== 'manifest' || !Array.isArray(manifest.files)) throw new Error('choose the content directory containing manifest.json');
  const copy = structuredClone(manifest), path = `prefabs/${id}.prefab.json`;
  if (!copy.files.includes(path)) copy.files.push(path);
  return copy;
}

/** Choose content/ once; save the new file before appending its manifest entry. */
export async function savePrefabFile(file, manifest, opts = {}) {
  const next = appendPrefabManifest(manifest, file.id);
  const text = stringifyContent(toFileObject(file));
  if (typeof window.showDirectoryPicker === 'function' && !opts.forceDownload) {
    const root = await window.showDirectoryPicker({id:'kestrel-content', mode:'readwrite'});
    const manifestHandle = await root.getFileHandle('manifest.json');
    const disk = JSON.parse(await (await manifestHandle.getFile()).text());
    if (file.meta.manifestPending && disk.files?.includes(`prefabs/${file.id}.prefab.json`)) throw new Error('this content directory already has that prefab; choose a new title');
    const updated = appendPrefabManifest(disk, file.id);
    const dir = await root.getDirectoryHandle('prefabs', {create:true});
    const handle = await dir.getFileHandle(`${file.id}.prefab.json`, {create:true});
    const write = await handle.createWritable(); await write.write(text); await write.close();
    const mw = await manifestHandle.createWritable(); await mw.write(stringifyContent(updated)); await mw.close();
    file.handle = handle; file.dirty = false; file.meta.manifestPending = false;
    return updated;
  }
  downloadFallback(text, `${file.id}.prefab.json`);
  downloadFallback(stringifyContent(next), 'manifest.json');
  file.dirty = false; file.meta.manifestPending = false;
  return next;
}
