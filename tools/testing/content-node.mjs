// tools/testing/content-node.mjs (US-027b, docs/architecture.md 21.9 "Node
// test helper"). Loads the flipped `content/manifest.json` pack the same
// way the game does (loadContentPack + AssetRegistry.fromJSON), for the
// many Node tests/tools that used to side-effect-import
// design/levels/{tower,test_room,world_m1}.js directly (deleted by this
// story - those three are JSON now, content/levels/*.level.json and
// content/worlds/world_m1.world.json). `overworld_far` stays a design/
// classic script (a terrain RECIPE, not content) and is unaffected - a
// caller that needs it keeps its own `import '../../design/levels/overworld_far.js'`
// side-effect import exactly as before.
//
// Does NOT copy the loader (docs/architecture.md 21.9's "do not copy the
// loader" rule) - this only wires up the Node file reader and the repo's
// fixed content/ path.
import { readFile } from 'node:fs/promises';
import { loadContentPack, AssetRegistry } from '../../engine/index.js';

const REPO_ROOT = new URL('../../', import.meta.url);
const MANIFEST_URL = new URL('content/manifest.json', REPO_ROOT).href;

async function fetchText(url) {
  return readFile(new URL(url), 'utf8');
}

/**
 * @returns {Promise<{globals: Object, bundle: Object, assets: import('../../engine/core/assets.js').AssetRegistry}>}
 *   `globals` is `globalThis.ASSETS` (whatever design/*.js classic scripts
 *   the CALLING test already side-effect-imported - palette, models,
 *   overworld_far.js - plus `.levels.tower`/`.levels.test_room`/
 *   `.worlds.world_m1` merged in from the content pack, for the couple of
 *   tests that still read `globalThis.ASSETS.levels.*` directly (e.g.
 *   engine/world/packed.test.js) rather than going through `assets`.
 *   `bundle` is the raw ContentBundle (loadContentPack's return value).
 *   `assets` is an AssetRegistry built with `AssetRegistry.fromJSON(bundle,
 *   globals)` - the SAME registry shape `fromGlobals(globalThis.ASSETS)`
 *   used to produce, per the US-027a guard test (architecture.md 21.9) - or
 *   `null` when the caller never side-effect-imported `design/palette.js`
 *   itself (a handful of tests, e.g. engine/world/packed.test.js, only ever
 *   wanted the raw `globals.levels.tower`/`.test_room` and never built an
 *   AssetRegistry at all - `AssetRegistry`'s constructor requires a
 *   palette, so building one here unconditionally would newly fail those).
 */
export async function loadTestAssets() {
  globalThis.window = globalThis.window || globalThis;
  const globals = globalThis.ASSETS = globalThis.ASSETS || {};
  const bundle = await loadContentPack(MANIFEST_URL, { fetchText });
  // fromJSON's own "no dual source" check (D-023 item 4) must run against
  // `globals` BEFORE the convenience merge below adds tower/test_room/
  // world_m1 to it - merging first would make every call look like a
  // JS/JSON collision.
  const assets = globals.palette ? AssetRegistry.fromJSON(bundle, globals) : null;
  globals.levels = { ...(globals.levels || {}), ...bundle.levels };
  globals.worlds = { ...(globals.worlds || {}), ...bundle.worlds };
  return { globals, bundle, assets };
}
