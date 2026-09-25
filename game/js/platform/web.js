// game/js/platform/web.js (US-060, D-012)
//
// The ONLY file in `game/` allowed to touch `localStorage` directly
// (enforced by a grep check in platform.test.js). Everything else imports
// `loadSettings`/`saveSettings` from `./index.js`.
//
// Schema (US-038's "Remembered per browser" AC), key `kestrel.settings`:
//   { settingsVersion: 1, muted: boolean, volume: number }
// `grid` and other US-038b options are NOT part of this pass - they are
// added the same field-by-field-fallback way once US-038b needs them.
//
// `volume` is stored (default 1.0) for forward compatibility with the JSON
// shape described in the AC, but this pass does not read or apply it -
// there is no `setVolume` to call yet (US-020d, deferred to M6). Only
// `muted` actually affects the running game right now.

const STORAGE_KEY = 'kestrel.settings';
const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: SETTINGS_VERSION,
  muted: false,
  volume: 1.0,
});

/** @returns {Storage|null} the real `localStorage`, or null if unavailable (no `window`, or access itself throws - some private-browsing modes). */
function getStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // some browsers throw just reading the property (privacy settings)
  }
}

function isBoolean(v) { return typeof v === 'boolean'; }
function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

/**
 * Reads `kestrel.settings` and returns a full, valid settings object.
 * Never throws: a missing key, corrupt JSON, wrong field types, or a
 * storage that throws on `getItem` all fall back to `DEFAULT_SETTINGS`
 * field by field (a bad `volume` does not also lose a good `muted`).
 */
export function loadSettings() {
  const out = { ...DEFAULT_SETTINGS };
  const storage = getStorage();
  if (!storage) return out;

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return out; // storage.getItem threw (quota/privacy edge cases): defaults
  }
  if (raw == null) return out;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out; // corrupt JSON: defaults
  }
  if (!parsed || typeof parsed !== 'object') return out;

  // Field-by-field fallback: an unknown/missing/wrong-typed field keeps the
  // default for THAT field only, it does not reject the whole object.
  if (isBoolean(parsed.muted)) out.muted = parsed.muted;
  if (isFiniteNumber(parsed.volume)) out.volume = parsed.volume;
  // settingsVersion is informational only for now (single version exists);
  // kept as the constant so a future migration has a stable field to read.

  return out;
}

/**
 * Merges `partial` onto the currently-saved settings (missing fields keep
 * their previously-saved value, falling back to defaults) and writes the
 * result back. Never throws: a storage that throws on `setItem` (quota
 * exceeded, private-mode restrictions) is caught and silently no-ops.
 */
export function saveSettings(partial) {
  const storage = getStorage();
  const current = loadSettings();
  const next = {
    settingsVersion: SETTINGS_VERSION,
    muted: isBoolean(partial && partial.muted) ? partial.muted : current.muted,
    volume: isFiniteNumber(partial && partial.volume) ? partial.volume : current.volume,
  };
  if (!storage) return next; // no persistence available, but callers still get a valid object back

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota exceeded / private-mode write restrictions: swallow, never throw out of the adapter
  }
  return next;
}
