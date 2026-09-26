// game/js/dev/playtest.js - US-034 (docs/architecture.md 24.11). The game
// side of the editor's play-test handoff: `tools/editor/io.js`'s
// `launchPlaytest(doc)` writes `kestrel.playtest` and opens
// `game/index.html?playtest=1&world=<worldId>` in a new tab; this module
// overlays that saved (possibly unsaved-to-disk) content onto the
// `ContentBundle` `main.js` is about to build an `AssetRegistry` from, so
// the game runs the exact in-editor edit without any server write.
//
// Reads `kestrel.playtest` through `game/js/platform/` (`readPlaytest()`),
// never `localStorage` directly - keeps US-060's "no direct localStorage use
// outside platform/web.js" grep (`game/js/platform/platform.test.js`) true.
import { readPlaytest } from '../platform/index.js';

/**
 * When `?playtest=1` is set and a `kestrel.playtest` record exists, overlays
 * its `files` onto `target.levels`/`target.worlds` IN PLACE (mutates
 * `target`), keyed by the `fileKey` scheme (`'level/<id>'`/`'world/<id>'`,
 * `tools/editor/doc.js`'s `fileKey`). A no-op (returns `false`) when
 * `?playtest=1` is absent or the record is missing/corrupt - the caller's
 * normal content pack loads untouched either way.
 * @param {{levels?:Object, worlds?:Object}} target - the `ContentBundle`
 *   `main.js` is about to pass to `AssetRegistry.fromJSON` (post-US-027b).
 * @returns {boolean} true if an overlay was applied
 */
export function applyPlaytestOverlay(target) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('playtest') !== '1') return false;
  const record = readPlaytest();
  if (!record) return false;
  for (const [fileKey, def] of Object.entries(record.files)) {
    const slash = fileKey.indexOf('/');
    if (slash < 0) continue;
    const kind = fileKey.slice(0, slash);
    const id = fileKey.slice(slash + 1);
    if (kind === 'level') {
      if (!target.levels) target.levels = {};
      target.levels[id] = def;
    } else if (kind === 'world') {
      if (!target.worlds) target.worlds = {};
      target.worlds[id] = def;
    }
  }
  return true;
}
