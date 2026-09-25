// engine/core/assets.test.js (US-027a, docs/architecture.md 21.7/21.10 S4)
//
//   node engine/core/assets.test.js
//
// Plain Node ESM, no framework - matches engine/core/playerLook.test.js.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssetRegistry } from './assets.js';
import { loadContentPack } from '../content/loadPack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_MANIFEST = pathToFileURL(path.join(__dirname, '..', 'content', 'fixtures', 'pack', 'manifest.json')).href;

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const fakePalette = { util: { validate: () => [] } };
const fakeTerrain = { util: { heightAt: () => 0 } }; // shape AssetRegistry uses to split levels vs terrain

const bundle = await loadContentPack(PACK_MANIFEST, { fetchText: (u) => readFile(new URL(u), 'utf8') });

// --- fromJSON merges code parts + JSON content -------------------------------
{
  const codeParts = { palette: fakePalette, models: { torch: {} }, worlds: {}, levels: { overworld_far: fakeTerrain }, uiStyle: null, detailPass: null };
  const reg = AssetRegistry.fromJSON(bundle, codeParts);
  ok('level from JSON is reachable', reg.has('level', 'tiny'));
  ok('world from JSON is reachable', reg.has('world', 'tiny_world'));
  ok('terrain from code is reachable', reg.has('terrain', 'overworld_far'));
  ok('model from code is reachable', reg.has('model', 'torch'));
  ok('contentVersion comes from the bundle', reg.contentVersion === bundle.contentVersion);

  // Same defs given as globals (fromGlobals) must produce a deep-equal map.
  const globals = {
    palette: fakePalette,
    models: { torch: {} },
    worlds: { tiny_world: bundle.worlds.tiny_world },
    levels: { overworld_far: fakeTerrain, tiny: bundle.levels.tiny },
    uiStyle: null,
    detailPass: null,
  };
  const regGlobals = AssetRegistry.fromGlobals(globals);
  ok('fromJSON level deep-equals fromGlobals level', deepEqual(reg.level('tiny'), regGlobals.level('tiny')));
  ok('fromJSON world deep-equals fromGlobals world', deepEqual(reg.world('tiny_world'), regGlobals.world('tiny_world')));
  ok('fromJSON terrain deep-equals fromGlobals terrain', deepEqual(reg.terrain('overworld_far'), regGlobals.terrain('overworld_far')));
  ok('fromGlobals contentVersion is null', regGlobals.contentVersion === null);
}

// --- a key in both JS and JSON throws (no dual source, D-023 item 4) -------
{
  const codeParts = { palette: fakePalette, models: {}, worlds: {}, levels: { tiny: { rows: ['bogus JS copy'] } }, uiStyle: null, detailPass: null };
  try {
    AssetRegistry.fromJSON(bundle, codeParts);
    ok('duplicate level key (JS+JSON) throws', false, 'did not throw');
  } catch (e) {
    ok('duplicate level key (JS+JSON) throws', /level "tiny".*both JS and JSON/.test(e.message), e.message);
  }
}
{
  const codeParts = { palette: fakePalette, models: {}, worlds: { tiny_world: {} }, levels: {}, uiStyle: null, detailPass: null };
  try {
    AssetRegistry.fromJSON(bundle, codeParts);
    ok('duplicate world key (JS+JSON) throws', false, 'did not throw');
  } catch (e) {
    ok('duplicate world key (JS+JSON) throws', /world "tiny_world".*both JS and JSON/.test(e.message), e.message);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
