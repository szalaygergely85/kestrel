// game/js/platform/index.js (US-060, D-012)
//
// Public entry for the platform storage adapter. `game/` code (main.js,
// audio/*, ui/*) imports settings load/save ONLY from here (or from
// `./web.js` directly) - never touches `localStorage`/`window.localStorage`
// itself. This keeps the storage backend swappable (D-012: a later Steam
// build, US-043, swaps this module for a Steamworks-backed one without
// touching call sites).
//
// This pass (US-060) only wired `muted` end-to-end (owner ruling
// 2026-09-25: no volume control until US-020d, deferred to M6). `volume` is
// still part of the JSON shape (forward-compatible field, default 1.0) so
// the schema does not need to change again when US-020d lands - it is just
// not read/applied anywhere yet.
//
// US-038b (row 30f) extended the blob with `grid`, `fullscreen`,
// `mouseSensitivity` and `invertY` - see web.js's header comment for the
// full schema and fallback rules.

export { loadSettings, saveSettings, DEFAULT_SETTINGS } from './web.js';
