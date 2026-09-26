#!/usr/bin/env node
// tools/export-content.mjs (US-027b, docs/architecture.md 21.9 "Contract
// for US-027b" - normative for this file).
//
// Converts the designer's classic-script level/world defs
// (design/levels/{tower,test_room,world_m1}.js) into the US-027a JSON
// content pack (content/manifest.json + content/levels/*.level.json +
// content/worlds/*.world.json), byte-stable across re-runs.
//
//   node tools/export-content.mjs
//
// `overworld_far` (a terrain RECIPE - code, generative) stays JS; `world_m1`
// keeps a plain string key reference to it (`terrain: "overworld_far"`),
// never inlined.
//
// HOW IT READS design/: the exact same classic-script list/order as
// game/index.html's <script> tags (tools/validate-content.mjs's
// CLASSIC_SCRIPTS keeps the canonical copy of that list; duplicated here so
// this tool has no import-time dependency on that file), run in a `vm`
// context whose `window` is the context's own global object (so `root =
// typeof window !== 'undefined' ? window : globalThis` - every design/*.js
// file's own IIFE wrapper - resolves to the SAME object either way, exactly
// like a browser's `window`). No DOM globals are needed: none of these
// files touch `document`/`navigator`, and the one `require(...)` call
// (design/detail-pass.js's Node-only palette.js fallback) is never reached
// here because palette.js already ran first in the same list.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stringifyContent, ID_COLLECTIONS } from '../engine/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Kept identical to tools/validate-content.mjs's CLASSIC_SCRIPTS (that file
// says it must stay in sync with game/index.html's <script> tags - so does
// this one). test_room.js/tower.js/world_m1.js are still in THIS list (this
// tool is the one place that still reads them, to build the JSON) even
// though game/index.html itself no longer loads them as scripts.
export const CLASSIC_SCRIPTS = [
  'design/palette.js',
  'design/detail-pass.js',
  'design/models/title.js',
  'design/models/lantern.js',
  'design/models/brazier.js',
  'design/models/lever.js',
  'design/models/boulder.js',
  'design/models/rubble.js',
  'design/models/wreckage.js',
  'design/models/relay.js',
  'design/models/voxel_props.js',
  'design/models/voxel_tower.js',
  'design/models/voxel_world.js', // US-026a-S6: waystone, mirrors game/index.html
  'design/models/far_tower.js',
  'design/models/ferrum_lights.js',
  'design/levels/test_room.js',
  'design/levels/tower.js',
  'design/levels/overworld_far.js',
  'design/levels/world_m1.js',
];

/** Runs every design/ classic script in one fresh vm context and returns its
 * resulting `window.ASSETS` (a plain object, not window itself). Exported
 * for tools/export-content.test.mjs's "game identical" guard, which needs
 * the ORIGINAL classic-script-authored def objects (tower/test_room/
 * world_m1, still JS at the time this function runs, before conversion) to
 * compare `AssetRegistry.fromGlobals` against `fromJSON` on the JSON output -
 * not a second exporter/importer run of the JSON itself. */
export function runClassicScripts(rootDir) {
  const sandbox = {};
  sandbox.window = sandbox; // `root` in every design/*.js IIFE resolves to this
  sandbox.console = console;
  vm.createContext(sandbox);
  for (const rel of CLASSIC_SCRIPTS) {
    const file = path.join(rootDir, rel);
    const code = fs.readFileSync(file, 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return sandbox.ASSETS;
}

const SINGULAR = {
  props: 'prop', lights: 'light', interactables: 'interactable', triggers: 'trigger',
  structures: 'structure', entities: 'entity', horizon: 'horizon',
};

/**
 * Computes the file's `nextId` (21.3/21.9: "1 + the highest n over ids in
 * ID_COLLECTIONS that match `_(\d+)$`, or 1 if there are none") and mints an
 * id for any collection item that doesn't already have one - none exist in
 * today's content, but this keeps the converter correct if that changes.
 * Mutates nothing: returns { def, nextId } with a shallow-cloned `def` (only
 * the touched collection arrays/items are copied).
 */
function assignIds(kind, def) {
  const collections = ID_COLLECTIONS[kind] || [];
  let maxMinted = 0;
  for (const coll of collections) {
    const items = def[coll];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item.id !== 'string') continue;
      const m = /_(\d+)$/.exec(item.id);
      if (m) maxMinted = Math.max(maxMinted, parseInt(m[1], 10));
    }
  }
  let nextId = maxMinted + 1;
  const out = { ...def };
  for (const coll of collections) {
    const items = def[coll];
    if (!Array.isArray(items)) continue;
    let touched = false;
    const newItems = items.map((item) => {
      if (item && typeof item === 'object' && item.id === undefined) {
        touched = true;
        const minted = `${SINGULAR[coll] || coll}_${nextId++}`;
        return { id: minted, ...item };
      }
      return item;
    });
    if (touched) out[coll] = newItems;
  }
  return { def: out, nextId };
}

/** Builds one content file's full envelope+data object, ready for
 * `stringifyContent` (21.2: envelope first, `name` (if present) must equal
 * `id` - true for every def here already). */
function buildFileObject(kind, id, def) {
  const { def: idDef, nextId } = assignIds(kind, def);
  return { kind, schema: 1, id, nextId, ...idDef };
}

/**
 * Pure (no fs writes): runs the classic scripts and returns the canonical
 * JSON text for every output file, keyed by its path relative to `content/`.
 * Calling this twice must return byte-identical strings (proven by
 * tools/export-content.test.mjs) - it does no id-minting side effects across
 * calls (each call re-derives everything from the same design/ source), and
 * `stringifyContent` itself is a pure function of its input object.
 * @param {string} [rootDir] repo root (design/ lives at `${rootDir}/design`)
 */
export function buildContent(rootDir = REPO_ROOT) {
  const ASSETS = runClassicScripts(rootDir);
  const towerDef = ASSETS.levels.tower;
  const testRoomDef = ASSETS.levels.test_room;
  const worldDef = ASSETS.worlds.world_m1;

  const towerFile = buildFileObject('level', 'tower', towerDef);
  const testRoomFile = buildFileObject('level', 'test_room', testRoomDef);
  const worldFile = buildFileObject('world', 'world_m1', worldDef);

  const manifest = {
    kind: 'manifest',
    schema: 1,
    id: 'kestrel',
    contentVersion: 1,
    files: ['worlds/world_m1.world.json', 'levels/tower.level.json', 'levels/test_room.level.json'],
  };

  return {
    'manifest.json': stringifyContent(manifest),
    'worlds/world_m1.world.json': stringifyContent(worldFile),
    'levels/tower.level.json': stringifyContent(towerFile),
    'levels/test_room.level.json': stringifyContent(testRoomFile),
  };
}

/** Writes `buildContent(rootDir)`'s output under `${outDir}/content/`
 * (default: the same `rootDir` design/ was read from), creating
 * `content/levels/` and `content/worlds/` as needed. `outDir` is a separate
 * parameter so a test can re-run the exporter against a scratch directory
 * (proving byte-identical output on disk) without needing its own copy of
 * design/. Returns the same map `buildContent` returned (so callers/tests
 * can compare in-memory strings against what actually landed on disk
 * without re-reading the files). */
export function writeContent(rootDir = REPO_ROOT, outDir = rootDir) {
  const files = buildContent(rootDir);
  const contentDir = path.join(outDir, 'content');
  for (const relPath of Object.keys(files)) {
    const full = path.join(contentDir, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, files[relPath]);
  }
  return files;
}

function isMain() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  // US-027b's own AC deletes design/levels/{tower,test_room,world_m1}.js in
  // the SAME commit that first runs this converter - content/*.json is the
  // source of truth from then on, so a normal repo checkout has nothing left
  // for this tool to convert. A clear message beats a raw ENOENT stack.
  const missing = ['tower.js', 'test_room.js', 'world_m1.js']
    .filter((f) => !fs.existsSync(path.join(REPO_ROOT, 'design', 'levels', f)));
  if (missing.length) {
    console.error(`export-content: design/levels/{${missing.join(', ')}} not found - `
      + 'content/*.json is already the source of truth (US-027b); restore those files first if you need to re-convert.');
    process.exit(1);
  }
  const files = writeContent(REPO_ROOT);
  for (const relPath of Object.keys(files)) {
    console.log(`wrote content/${relPath} (${files[relPath].length} bytes)`);
  }
}
