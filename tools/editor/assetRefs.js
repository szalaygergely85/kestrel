// tools/editor/assetRefs.js - OB-029: reference scan + delete plan for editor
// assets (no DOM). `sources` = { 'world/world_m1': def, 'level/tower': def,
// 'package/x': def, ... } - any JSON-like content, walked generically.

/** Field names whose string value names an asset. `components.mesh.id` is handled by path. */
const REF_FIELDS = new Set(['mesh', 'model', 'prefab', 'asset', 'voxel']);
/** Licensed packs stay untouched unless they live under content/local. */
const PROTECTED_PACKS = ['quaternius', 'synty'];

function walkRefs(def, visit) {
  const seen = new WeakSet();
  const walk = (v, path, field, parentField) => {
    if (typeof v === 'string') {
      if (REF_FIELDS.has(field) || (field === 'id' && parentField === 'mesh')) visit(v, path);
      return;
    }
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, field, parentField)); return; }
    for (const k of Object.keys(v)) {
      if (typeof v[k] !== 'function') walk(v[k], path ? `${path}.${k}` : k, k, field);
    }
  };
  walk(def, '', '', '');
}

/** All places in `sources` that name asset `key` (mesh key or model key). */
export function scanAssetRefs(key, sources) {
  const refs = [];
  for (const [source, def] of Object.entries(sources)) walkRefs(def, (v, path) => { if (v === key) refs.push({ source, path }); });
  return refs;
}

/** Asset keys no source references. */
export function findUnusedAssets(keys, sources) {
  const used = new Set();
  for (const def of Object.values(sources)) walkRefs(def, (v) => used.add(v));
  return keys.filter((k) => !used.has(k));
}

export function isProtectedMesh(key) {
  return PROTECTED_PACKS.includes(String(key).split('/')[0].toLowerCase());
}

/** Files a mesh asset owns (json + bin) and its manifest entry. */
export function meshFiles(key) {
  return { manifest: `meshes/${key}.mesh.json`, files: [`content/meshes/${key}.mesh.json`, `content/meshes/${key}.mesh.bin`] };
}

/**
 * Plan a delete. `kind` 'mesh' | 'model'. Result `{ok, reason?, refs, files, manifest}`;
 * not ok when protected, code-defined (models live in design/models/*.js) or still referenced.
 */
export function planAssetDelete(kind, key, sources) {
  if (kind !== 'mesh') return { ok: false, reason: 'code-defined model (design/models/*.js): delete it in source, not in the editor', refs: [], files: [], manifest: null };
  if (isProtectedMesh(key)) return { ok: false, reason: 'licensed local pack (quaternius/synty): left untouched', refs: [], files: [], manifest: null };
  const refs = scanAssetRefs(key, sources);
  const { manifest, files } = meshFiles(key);
  if (refs.length) return { ok: false, reason: `${refs.length} placement(s) still use it`, refs, files, manifest };
  return { ok: true, refs, files, manifest };
}

/** `content/.pending-deletes.json` text (sorted, byte-stable); the main session applies it. */
export function serializePendingDeletes(entries) {
  const files = [...new Set(entries.flatMap((e) => e.files))].sort();
  const manifest = [...new Set(entries.map((e) => e.manifest).filter(Boolean))].sort();
  return JSON.stringify({ version: 1, deleteFiles: files, removeFromManifest: manifest }, null, 2) + '\n';
}
