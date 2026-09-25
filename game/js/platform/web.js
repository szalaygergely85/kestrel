// game/js/platform/web.js (US-060, D-012; extended US-038b row 30f)
//
// The ONLY file in `game/` allowed to touch `localStorage` directly
// (enforced by a grep check in platform.test.js). Everything else imports
// `loadSettings`/`saveSettings` from `./index.js`.
//
// Schema (US-038's "Remembered per browser" AC), key `kestrel.settings`:
//   { settingsVersion: 1, muted: boolean, volume: number, grid: string,
//     fullscreen: boolean, mouseSensitivity: number, invertY: boolean }
// `settingsVersion` stays 1 (US-038b just adds fields to the one pass US-060
// started, per that story's own note: "added the same field-by-field-
// fallback way once US-038b needs them").
//
// `volume` is stored (default 1.0) for forward compatibility with the JSON
// shape described in the AC, but this pass does not read or apply it -
// there is no `setVolume` to call yet (US-020d, deferred to M6). `muted`,
// `grid`, `fullscreen`, `mouseSensitivity` and `invertY` are all read/applied
// by `game/js/ui/settings.js` and `main.js`'s boot sequence.
//
// Valid-value ranges come from `game/js/settings/options.js` (the single
// source of truth for the option list) so a corrupt/old/out-of-range field
// falls back to its default the same way an unknown field does - this file
// stays a thin, generic storage adapter, not a second copy of the option
// definitions.
import { GRID_VALUES } from '../settings/options.js';

const STORAGE_KEY = 'kestrel.settings';
const SETTINGS_VERSION = 1;
const MOUSE_SENS_MIN = 0.05, MOUSE_SENS_MAX = 0.40;

export const DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: SETTINGS_VERSION,
  muted: false,
  volume: 1.0,
  grid: '240x90',
  fullscreen: false,
  mouseSensitivity: 0.15,
  invertY: false,
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
  if (typeof parsed.grid === 'string' && GRID_VALUES.includes(parsed.grid)) out.grid = parsed.grid;
  if (isBoolean(parsed.fullscreen)) out.fullscreen = parsed.fullscreen;
  if (isFiniteNumber(parsed.mouseSensitivity) && parsed.mouseSensitivity >= MOUSE_SENS_MIN && parsed.mouseSensitivity <= MOUSE_SENS_MAX) {
    out.mouseSensitivity = parsed.mouseSensitivity;
  }
  if (isBoolean(parsed.invertY)) out.invertY = parsed.invertY;
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
  const p = partial || {};
  const next = {
    settingsVersion: SETTINGS_VERSION,
    muted: isBoolean(p.muted) ? p.muted : current.muted,
    volume: isFiniteNumber(p.volume) ? p.volume : current.volume,
    grid: (typeof p.grid === 'string' && GRID_VALUES.includes(p.grid)) ? p.grid : current.grid,
    fullscreen: isBoolean(p.fullscreen) ? p.fullscreen : current.fullscreen,
    mouseSensitivity: (isFiniteNumber(p.mouseSensitivity) && p.mouseSensitivity >= MOUSE_SENS_MIN && p.mouseSensitivity <= MOUSE_SENS_MAX)
      ? p.mouseSensitivity : current.mouseSensitivity,
    invertY: isBoolean(p.invertY) ? p.invertY : current.invertY,
  };
  if (!storage) return next; // no persistence available, but callers still get a valid object back

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota exceeded / private-mode write restrictions: swallow, never throw out of the adapter
  }
  return next;
}
