// tools/editor/voxImportName.js - OWN-REQ-011 ("Import .vox" button, PC-B
// QUEUE 4 filler item). Extracted from `tools/editor/main.js`'s inline
// `deriveVoxModelName` (verbatim logic, no behaviour change) so this small
// but real bit of naming/dedup logic gets Node test coverage - previously it
// only ran inside `doImportVox()`, a DOM-event-bound function with no export,
// so it was reachable only via a live browser click (the one owner-visible
// gap the story's own implementation note flagged).

/**
 * Derives a valid, unused model key from a picked `.vox` filename (24.9's
 * ID_REGEX shape: starts with a letter, then letters/digits/_/-). `hasKey(k)`
 * is the existing-key predicate (`assets.has('model', k)` in the real
 * editor) - injected rather than imported so this stays a pure function.
 * @param {string} filename
 * @param {(key: string) => boolean} hasKey
 * @returns {string}
 */
export function deriveVoxModelName(filename, hasKey) {
  const base = String(filename || 'vox_model').replace(/\.[^./\\]+$/, '');
  let s = base.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(s)) s = 'vox_' + s;
  s = s || 'vox_model';
  if (!hasKey(s)) return s;
  let n = 2;
  while (hasKey(`${s}_${n}`)) n++;
  return `${s}_${n}`;
}
