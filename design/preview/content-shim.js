/*
 * ASCII Quest - content shim (US-027b, docs/architecture.md 21.9)
 *
 * tower/test_room/world_m1 moved from design/levels/{tower,test_room,
 * world_m1}.js (deleted) into content/levels/*.level.json and
 * content/worlds/world_m1.world.json. The preview pages below are plain
 * classic scripts (no build step, opened over http from design/preview/),
 * so this shim fetches the JSON SYNCHRONOUSLY (a blocking XHR - the one
 * place in this codebase that does that; fine for a dev preview page, never
 * shipped in game/) and reshapes it onto `window.ASSETS` in exactly the
 * same place/shape the deleted classic scripts used to, so every preview
 * page's own inline script (which reads `window.ASSETS.levels.tower`/
 * `window.ASSETS.worlds.world_m1` right after its own <script> tag runs,
 * with no async step) keeps working unchanged.
 *
 * Usage: load AFTER palette.js, in place of the old
 * `<script src="../levels/tower.js"></script>` (and world_m1.js) tag:
 *   <script src="../palette.js"></script>
 *   <script src="content-shim.js"></script>
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  A.levels = A.levels || {};
  A.worlds = A.worlds || {};

  function fetchJsonSync(url) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // sync: see header comment
    xhr.send(null);
    if (xhr.status !== 0 && xhr.status !== 200) {
      throw new Error('content-shim.js: ' + url + ' -> HTTP ' + xhr.status);
    }
    return JSON.parse(xhr.responseText);
  }

  // Strips the US-027a envelope (kind/schema/id/nextId), same shape the old
  // design/levels/*.js classic scripts set directly on window.ASSETS.
  function stripEnvelope(obj) {
    var out = {};
    for (var k in obj) {
      if (k === 'kind' || k === 'schema' || k === 'id' || k === 'nextId') continue;
      out[k] = obj[k];
    }
    return out;
  }

  A.levels.tower = stripEnvelope(fetchJsonSync('../../content/levels/tower.level.json'));
  A.levels.test_room = stripEnvelope(fetchJsonSync('../../content/levels/test_room.level.json'));
  A.worlds.world_m1 = stripEnvelope(fetchJsonSync('../../content/worlds/world_m1.world.json'));
})(typeof window !== 'undefined' ? window : globalThis);
