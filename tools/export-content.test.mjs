// tools/export-content.test.mjs (US-027b, docs/architecture.md 21.9's
// "Guard (in export-content.test.mjs)" - normative for this file). Plain
// Node ESM, no framework, matches engine/content/loadPack.test.js's pattern.
//
//   node tools/export-content.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContent, writeContent, runClassicScripts } from './export-content.mjs';
import { loadContentPack, AssetRegistry } from '../engine/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// US-027b's own AC ("same commit... delete design/levels/{tower,test_room,
// world_m1}.js") means this converter's SOURCE is gone once the flip lands -
// content/*.json is the permanent source of truth from then on, and
// buildContent()/writeContent() (which read those 3 files through a vm) can
// no longer run at all. That is expected, not a regression: this file still
// runs as `*.test.mjs` under tools/run-tests.mjs forever, so once the
// classic-script sources are gone it reports a clean, informative SKIP
// instead of an ENOENT crash. Restoring the 3 design/levels/*.js files
// (e.g. to regenerate content/ after a manual edit) makes the full guard
// below run for real again.
const CLASSIC_SOURCES_PRESENT = fs.existsSync(path.join(REPO_ROOT, 'design', 'levels', 'tower.js'))
  && fs.existsSync(path.join(REPO_ROOT, 'design', 'levels', 'test_room.js'))
  && fs.existsSync(path.join(REPO_ROOT, 'design', 'levels', 'world_m1.js'));

if (!CLASSIC_SOURCES_PRESENT) {
  console.log('SKIP: design/levels/{tower,test_room,world_m1}.js no longer exist (US-027b flip complete) -');
  console.log('content/*.json is the source of truth now; this guard only re-runs if those 3 files are restored.');
  console.log('\nALL PASS (0 checks - skipped)');
  process.exit(0);
}

// Realm-agnostic deep-equal: `runClassicScripts` returns objects built in a
// SEPARATE vm context (a different realm, different Object/Array
// constructors) than `loadContentPack`'s JSON.parse output, so
// `assert.deepStrictEqual`/`deepEqual` both report "same structure but not
// reference-equal" even for identical data - canonicalise (sort object keys,
// keep array order) and compare the resulting JSON strings instead.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
function sameData(a, b) {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// --- 1. pure buildContent() is deterministic: two in-process calls give the
// exact same strings (no id-minting/counter side effects survive a call) ---
{
  const a = buildContent(REPO_ROOT);
  const b = buildContent(REPO_ROOT);
  ok('buildContent() is byte-identical across two in-process calls',
    JSON.stringify(a) === JSON.stringify(b));
}

// --- 2. writeContent() to a scratch dir, twice, gives byte-identical files
// on disk (the AC's literal "running the exporter twice") ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-export-content-'));
  try {
    const first = writeContent(REPO_ROOT, tmp);
    const firstBytes = {};
    for (const rel of Object.keys(first)) {
      firstBytes[rel] = fs.readFileSync(path.join(tmp, 'content', ...rel.split('/')));
    }
    const second = writeContent(REPO_ROOT, tmp);
    let allMatch = true;
    for (const rel of Object.keys(second)) {
      const bytes = fs.readFileSync(path.join(tmp, 'content', ...rel.split('/')));
      if (!bytes.equals(firstBytes[rel])) allMatch = false;
    }
    ok('writeContent() run twice produces byte-identical files on disk', allMatch);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- 3. loadContentPack on the real output succeeds, and
// AssetRegistry.fromJSON(bundle, globalsWithoutTheFlippedDefs) deep-equals
// fromGlobals(globals) for levels and worlds (the "game identical" check,
// architecture.md 21.9) ---
{
  const manifestUrl = pathToFileURL(path.join(REPO_ROOT, 'content', 'manifest.json')).href;
  const fetchText = (u) => readFile(new URL(u), 'utf8');
  const bundle = await loadContentPack(manifestUrl, { fetchText });
  ok('loadContentPack succeeds on the real content/ output', true);
  ok('bundle.contentVersion === 1', bundle.contentVersion === 1);
  ok('bundle has tower/test_room levels', !!bundle.levels.tower && !!bundle.levels.test_room);
  ok('bundle has world_m1', !!bundle.worlds.world_m1);

  // `globals`: the ORIGINAL classic-script-authored ASSETS object (tower/
  // test_room/world_m1 still plain JS at this point, exactly as
  // design/levels/{tower,test_room,world_m1}.js used to define them before
  // this story's flip) - `runClassicScripts` is the exact same vm run
  // `buildContent()` used to produce the JSON above, so this is a real
  // JS-vs-JSON comparison, not JSON-vs-JSON.
  const globals = runClassicScripts(REPO_ROOT);
  const assetsFromGlobals = AssetRegistry.fromGlobals(globals);

  // `globalsWithoutTheFlippedDefs`: the same object with tower/test_room/
  // world_m1 removed from ASSETS.levels/worlds - the "codeParts" fromJSON
  // takes per architecture.md 21.7 (everything BUT the flipped levels/
  // worlds; palette/models/detailPass/uiStyle/terrain stay JS forever).
  const { tower: _t, test_room: _tr, ...levelsWithoutFlipped } = globals.levels || {};
  const { world_m1: _w, ...worldsWithoutFlipped } = globals.worlds || {};
  const globalsWithoutTheFlippedDefs = { ...globals, levels: levelsWithoutFlipped, worlds: worldsWithoutFlipped };
  const assetsFromJSON = AssetRegistry.fromJSON(bundle, globalsWithoutTheFlippedDefs);

  ok('fromJSON/fromGlobals: same level keys',
    JSON.stringify(assetsFromJSON.keys('level').sort()) === JSON.stringify(assetsFromGlobals.keys('level').sort()));
  for (const key of assetsFromGlobals.keys('level')) {
    ok(`fromJSON/fromGlobals: level "${key}" deep-equal`,
      sameData(assetsFromJSON.level(key), assetsFromGlobals.level(key)));
  }
  for (const key of assetsFromGlobals.keys('world')) {
    ok(`fromJSON/fromGlobals: world "${key}" deep-equal`,
      sameData(assetsFromJSON.world(key), assetsFromGlobals.world(key)));
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
