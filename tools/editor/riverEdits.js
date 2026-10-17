// tools/editor/riverEdits.js - ED-WATER-03 (OB-223). Pure: world-json `riverEdits` block -> river ribbon path.
// Shared by the editor (live preview) and tools/gen-river-water.mjs (regeneration), so same input -> same ribbon.
// Block: world.riverEdits = [{ id: <river water id>, dz: <surface offset m>, hw: { "<point index>": <half width m> } }].
// Only the WATER SURFACE changes (path z + half width); the terrain carve (design/levels/world_geo.js) is untouched.
// Idempotent: the region remembers what it applied (`riverApplied` = { dz, hw: { i: original hw } }), so re-applying
// the same edit, a different edit, or none (undo) always starts from the true base path.
export const TERRAIN_NOTE = 'terrain banks are not edited here';
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
export const MIN_HW = 0.5;

export function isRiver(r) { return !!r && r.shape === 'river' && Array.isArray(r.path) && r.path.length >= 2; }
/** Canonical edit: finite dz (rounded 3 dp), hw map with valid indexes only. Returns null when it changes nothing. */
export function normalizeEdit(e, n = Infinity) {
  if (!e) return null;
  const dz = Number.isFinite(e.dz) ? r3(e.dz) : 0, hw = {};
  for (const k of Object.keys(e.hw || {}).sort((a, b) => a - b)) { const i = +k, v = e.hw[k]; if (Number.isInteger(i) && i >= 0 && i < n && Number.isFinite(v)) hw[i] = r2(Math.max(MIN_HW, v)); }
  return dz === 0 && !Object.keys(hw).length ? null : { dz, hw };
}
/** Path with the previously applied edit taken back out. */
function basePath(region) {
  const ap = region.riverApplied; if (!ap) return region.path;
  return region.path.map((p, i) => { const q = p.slice(); q[2] = r3(q[2] - (ap.dz || 0)); if (ap.hw && ap.hw[i] != null) q[3] = ap.hw[i]; return q; });
}
/** Returns the region with `edit` applied to its base path (same object when nothing changes). `riverApplied` is dropped when edit is empty. */
export function applyRiverEdit(region, edit) {
  if (!isRiver(region)) return region;
  const e = normalizeEdit(edit, region.path.length);
  if (!e && !region.riverApplied) return region;
  const base = basePath(region);
  const path = base.map((p, i) => { const q = p.slice(); q[2] = r3(q[2] + (e ? e.dz : 0)); if (e && e.hw[i] != null) q[3] = e.hw[i]; return q; });
  const out = { ...region, path };
  if (e) out.riverApplied = { dz: e.dz, hw: Object.fromEntries(Object.keys(e.hw).map((i) => [i, base[i][3]])) }; else delete out.riverApplied;
  return out;
}
/** Apply a whole `riverEdits` list to a water[] (new array; untouched regions keep their identity). */
export function applyAllRiverEdits(water, edits) {
  const byId = new Map((edits || []).map((e) => [e.id, e]));
  return water.map((r) => (isRiver(r) ? applyRiverEdit(r, byId.get(r.id)) : r));
}
/** Edit after changing the whole-ribbon z offset (null when it becomes empty). */
export function withDz(edit, dz) { return normalizeEdit({ dz, hw: edit ? edit.hw : {} }); }
/** Edit after setting point `i`'s half width; `hw0` = the base half width (a value equal to it removes the override). */
export function withWidth(edit, i, hw, hw0) {
  const m = { ...(edit ? edit.hw : {}) }; if (Number.isFinite(hw0) && r2(hw) === r2(hw0)) delete m[i]; else m[i] = hw;
  return normalizeEdit({ dz: edit ? edit.dz : 0, hw: m });
}
/** Schema check for the block: returns a list of error strings (empty = valid). `rivers` = Map/obj id -> point count (optional). */
export function validateRiverEdits(list, rivers = null) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['riverEdits must be an array'];
  const errs = [], seen = new Set();
  list.forEach((e, k) => {
    const at = `riverEdits[${k}]`;
    if (!e || typeof e !== 'object') return errs.push(`${at}: not an object`);
    if (typeof e.id !== 'string' || !e.id) return errs.push(`${at}: id must be a river water id`);
    if (seen.has(e.id)) errs.push(`${at}: duplicate id "${e.id}"`); seen.add(e.id);
    const n = rivers ? (rivers instanceof Map ? rivers.get(e.id) : rivers[e.id]) : undefined;
    if (rivers && n === undefined) errs.push(`${at}: "${e.id}" is not a river in water[]`);
    if (e.dz !== undefined && !(Number.isFinite(e.dz) && Math.abs(e.dz) <= 20)) errs.push(`${at}: dz must be a number within +-20 m`);
    if (e.hw !== undefined) {
      if (!e.hw || typeof e.hw !== 'object' || Array.isArray(e.hw)) errs.push(`${at}: hw must be an object {index: halfWidth}`);
      else for (const [i, v] of Object.entries(e.hw)) {
        if (!/^\d+$/.test(i) || (n !== undefined && +i >= n)) errs.push(`${at}: hw index "${i}" out of range`);
        if (!(Number.isFinite(v) && v >= MIN_HW && v <= 200)) errs.push(`${at}: hw[${i}] must be ${MIN_HW}..200 m`);
      }
    }
    for (const k2 of Object.keys(e)) if (!['id', 'dz', 'hw'].includes(k2)) errs.push(`${at}: unknown field "${k2}"`);
  });
  return errs;
}
