// tools/editor/autosave.js - OB-030. Crash/close-proof copy of the dirty doc.
// Pure parts (buildSnapshot / snapshotDiffers / applySnapshot / formatAge) are
// Node-tested (autosave.test.mjs); the IndexedDB part at the bottom is browser only.
// Snapshot = every dirty file's CURRENT canonical text (stringifyContent, so
// `editorGroups` inside a world def is included) keyed by fileKey.
import { stringifyContent, migrateContent } from '../../engine/index.js';
import { toFileObject } from './io.js';
import { fileKey } from './doc.js';

/** @returns {{v:1, worldId:string, savedAt:number, files:Object<string,string>}|null} null when nothing is dirty */
export function buildSnapshot(doc, now = Date.now()) {
  const files = {};
  let n = 0;
  for (const f of doc.files.values()) {
    if (!f.dirty) continue;
    files[fileKey(f.kind, f.id)] = stringifyContent(toFileObject(f));
    n++;
  }
  return n ? { v: 1, worldId: doc.worldId, savedAt: now, files } : null;
}

/** Keys of snapshot files whose text differs from the doc's current canonical text (or the doc lacks them -> ignored). */
export function snapshotDiffers(doc, snap) {
  const out = [];
  if (!snap || snap.v !== 1 || !snap.files) return out;
  for (const [key, text] of Object.entries(snap.files)) {
    const f = doc.files.get(key);
    if (f && stringifyContent(toFileObject(f)) !== text) out.push(key);
  }
  return out;
}

/**
 * Restores the differing files into `doc` as dirty via `assets.replace` (same path as loadFile, keeps live refs valid).
 * Bad/unknown entries are skipped. Returns the restored keys.
 */
export function applySnapshot(doc, assets, snap) {
  const done = [];
  for (const key of snapshotDiffers(doc, snap)) {
    let obj;
    try { obj = migrateContent(JSON.parse(snap.files[key]).kind, JSON.parse(snap.files[key]), key, {}); } catch (e) { continue; }
    const f = doc.files.get(key);
    const { kind: _k, schema, id: _id, nextId, ...rest } = obj;
    assets.replace(f.kind, f.id, rest);
    f.meta.schema = schema;
    f.meta.nextId = nextId;
    f.dirty = true;
    done.push(key);
  }
  return done;
}

export function formatAge(savedAt, now = Date.now()) {
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(savedAt).toLocaleString();
}

// ---- browser only: IndexedDB, one record per world id ----------------------
const DB = 'kestrel-editor-autosave', STORE = 'snap';
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req && req.result); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}
export const putSnapshot = (worldId, snap) => tx('readwrite', (s) => s.put(snap, worldId));
export const getSnapshot = (worldId) => tx('readonly', (s) => s.get(worldId));
export const clearSnapshot = (worldId) => tx('readwrite', (s) => s.delete(worldId));

/** Starts the 5 s + visibilitychange/pagehide writer. `getDoc()` -> doc. Returns { flush }. */
export function startAutosave(getDoc, { intervalMs = 5000 } = {}) {
  let last = '';
  async function flush() {
    try {
      const doc = getDoc();
      const snap = buildSnapshot(doc);
      if (!snap) { if (last) { last = ''; await clearSnapshot(doc.worldId); } return; }
      const key = JSON.stringify(snap.files);
      if (key === last) return;
      last = key;
      await putSnapshot(doc.worldId, snap);
    } catch (e) { /* storage unavailable: best effort */ }
  }
  setInterval(flush, intervalMs);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  return { flush };
}
