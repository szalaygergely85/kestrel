#!/usr/bin/env node
// tools/content-smoke.test.mjs (US-065, docs/backlog.md "PC-B QUEUE 2" item 7).
//
// Smoke test for the REAL packed-JSON content pipeline
// (content/manifest.json -> content/levels/*.level.json /
// content/worlds/*.world.json), loaded through the actual game/editor
// loader (`loadContentPack` + `AssetRegistry.fromJSON`, via
// tools/testing/content-node.mjs's `loadTestAssets`) and then through the
// real `World.load` - deliberately NOT the classic-script `import()` +
// `globalThis.ASSETS` path `tools/validate-content.mjs` (US-058) tests. That
// tool never calls `loadPack`/`World.load` at all (it reads
// `globalThis.ASSETS` after side-effect-importing `design/*.js`, and
// replicates a few of World.js's own resolution rules by hand instead of
// calling it) - so it would not catch something that breaks specifically in
// the packed-JSON pipeline itself (a bad manifest entry, a migration bug, an
// `AssetRegistry.fromJSON` merge problem, a `World.load` throw/warn against
// the real on-disk JSON). This file exists to catch exactly that class of
// bug. It reuses validate-content.mjs's model/behaviour-ref checking
// approach (adapted to run over the loaded `World`/`AssetRegistry` instead
// of the raw `globalThis.ASSETS` shape) rather than re-deriving it from
// scratch.
//
// Plain Node ESM, no framework - matches tools/content-canonical.test.mjs /
// tools/content-no-dual-source.test.mjs.
//
//   node tools/content-smoke.test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, getBehaviour } from '../engine/index.js'; // engine/index.js: the public entry, never a deep import
import { loadTestAssets } from './testing/content-node.mjs';

// Same classic-script list as tools/validate-content.mjs (US-058), in the
// same order game/index.html's <script> tags use - see that file's header
// for why voxel_world.js (the waystone) is included even though it isn't
// wired into game/index.html yet (US-026a-content / architecture.md 23.7
// step S6). Every model content/levels/tower.level.json's props[] or
// content/worlds/world_m1.world.json's entities[]/horizon[] reference must
// come from one of these.
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/title.js'; // ASSETS.uiStyle (hints/storyHints referenced by triggers below)
import '../design/models/lantern.js';
import '../design/models/brazier.js';
import '../design/models/lever.js';
import '../design/models/boulder.js';
import '../design/models/rubble.js';
import '../design/models/wreckage.js';
import '../design/models/relay.js';
import '../design/models/voxel_props.js';
import '../design/models/voxel_tower.js';
import '../design/models/voxel_world.js'; // waystone (endMarker, world_m1.world.json)
import '../design/models/far_tower.js';
import '../design/models/ferrum_lights.js';
import '../design/levels/overworld_far.js'; // terrain RECIPE, still a design/ classic script (US-027b)

// Registers, by name, every behaviour the real level/world data's
// interactables[]/triggers[] refer to (game/js/quest/index.js) - so the
// "triggers reference existing behaviours" check below runs against the
// REAL registrations the game itself uses, not a fixture.
import { registerQuestBehaviours } from '../game/js/quest/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

/** Runs `fn()` with `console.warn`/`console.error` captured instead of
 * printed; returns `{ result, threw, error, warnings }` (warnings holds
 * every captured `console.warn`/`console.error` call's joined args). Lets
 * the ACs below assert "no throw and no console warning" precisely, instead
 * of eyeballing stdout. */
function captured(fn) {
  const warnings = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => warnings.push(args.join(' '));
  console.error = (...args) => warnings.push(args.join(' '));
  let result, threw = false, error = null;
  try {
    result = fn();
  } catch (e) {
    threw = true;
    error = e;
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
  return { result, threw, error, warnings };
}

registerQuestBehaviours();

// ---------------------------------------------------------------------------
// 1. Every content/**/*.json file is accounted for by the manifest (loadPack
//    only ever reads files the manifest lists - an orphaned .level.json/
//    .world.json a designer forgot to add to the manifest would silently
//    never be checked by anything, including this file, unless we look for
//    it directly).
// ---------------------------------------------------------------------------
function listJsonFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsonFiles(full));
    else if (entry.name.endsWith('.json')) out.push(path.relative(CONTENT_DIR, full).split(path.sep).join('/'));
  }
  return out;
}

const manifestText = fs.readFileSync(path.join(CONTENT_DIR, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const allJsonFiles = listJsonFiles(CONTENT_DIR);
// content/vox/*.map.json are voxel import maps (OWN-REQ-005a/b/c), not a
// loadPack content kind ('level'/'world' only, engine/content/loadPack.js
// KNOWN_KINDS) - they are read by tools/vox-import.mjs, not the manifest.
// Everything else under content/ must be either the manifest itself or one
// of its listed files.
const unaccountedFor = allJsonFiles.filter((rel) => {
  if (rel === 'manifest.json') return false;
  if (rel.startsWith('vox/') && rel.endsWith('.map.json')) return false;
  return !manifest.files.includes(rel);
});
ok(
  'every content/**/*.json file is either manifest.json, a vox/*.map.json import map, or listed in manifest.json\'s "files"',
  unaccountedFor.length === 0,
  unaccountedFor.join(', ')
);

// ---------------------------------------------------------------------------
// 2. Every content/**/*.json (level/world) file loads through loadPack (via
//    loadTestAssets, tools/testing/content-node.mjs) with no throw and no
//    console warning.
// ---------------------------------------------------------------------------
// `captured()` above is sync-only; `loadTestAssets` is async, so its
// console/throw capture is inlined here instead of reusing that helper.
let assets = null, bundle = null, loadThrew = false, loadError = null;
const loadWarnings = [];
{
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args) => loadWarnings.push(args.join(' '));
  console.error = (...args) => loadWarnings.push(args.join(' '));
  try {
    ({ assets, bundle } = await loadTestAssets());
  } catch (e) {
    loadThrew = true;
    loadError = e;
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
}
ok('content/manifest.json + every listed file loads through loadPack with no throw', !loadThrew, loadError && (loadError.message + (loadError.errors ? ': ' + loadError.errors.map((e) => e.message).join('; ') : '')));
ok('loading the content pack prints no console warning', loadWarnings.length === 0, loadWarnings.join(' | '));
ok('loadTestAssets built a real AssetRegistry (design/palette.js was loaded)', !!assets);

if (!assets) {
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  console.log('cannot continue without a loaded AssetRegistry - aborting the rest of the suite.');
  process.exit(1);
}

for (const key of Object.keys(bundle.levels)) {
  ok(`content pack level "${key}" is reachable through the AssetRegistry`, assets.has('level', key));
}
for (const key of Object.keys(bundle.worlds)) {
  ok(`content pack world "${key}" is reachable through the AssetRegistry`, assets.has('world', key));
}

// ---------------------------------------------------------------------------
// 3. Every world loads through World.load with no throw and no console
//    warning; its triggers reference existing (registered) behaviours and
//    every entity's model exists in the AssetRegistry.
// ---------------------------------------------------------------------------

/** True if `modelName` (a top-level `.model` or a `.components.voxel.model`)
 * resolves through the AssetRegistry, same numeric-variant rule
 * AssetRegistry/World.js use (a variant index only counts against a full
 * billboard sub-model) - mirrors validate-content.mjs's resolveModel. */
function modelResolves(modelName, variantRaw) {
  if (!assets.has('model', modelName)) return false;
  if (typeof variantRaw !== 'number') return true;
  const base = assets.model(modelName);
  return Array.isArray(base.variants) && !!(base.variants[variantRaw] && base.variants[variantRaw].billboard);
}

function checkWorldEntitiesAndHorizon(worldKey, worldDef) {
  for (const e of worldDef.entities || []) {
    const voxelModel = e.components && e.components.voxel && e.components.voxel.model;
    if (typeof e.model === 'string') {
      ok(`world "${worldKey}" entity "${e.id}".model "${e.model}" exists in the model registry`, modelResolves(e.model));
    }
    if (typeof voxelModel === 'string') {
      ok(`world "${worldKey}" entity "${e.id}".components.voxel.model "${voxelModel}" exists in the model registry`, modelResolves(voxelModel));
    }
  }
  for (const h of worldDef.horizon || []) {
    if (typeof h.model !== 'string') continue;
    ok(`world "${worldKey}" horizon "${h.id}".model "${h.model}" exists in the model registry`, modelResolves(h.model));
  }
}

/** Every trigger a loaded `World` carries (`world.triggers`, built once by
 * `World.load` via `buildTriggers` - covers BOTH per-structure level triggers
 * AND world-level triggers, engine/world/triggers.js) must name a behaviour
 * that is actually registered. `World.load` itself only warns about a
 * missing per-structure-level behaviour (validateBehaviours, checked as a
 * console warning above) - it never checks WORLD-level trigger names
 * (`structId: null`) at all, so this is real extra coverage, not a
 * duplicate of that warning. */
function checkTriggerBehaviours(worldKey, world) {
  for (const tr of world.triggers || []) {
    const label = tr.structId ? `${tr.structId}.${tr.id}` : `world.${tr.id}`;
    const { result: fn, warnings } = captured(() => getBehaviour(tr.name));
    ok(
      `world "${worldKey}" trigger "${label}" names a registered behaviour ("${tr.name}")`,
      typeof fn === 'function' && warnings.length === 0,
      warnings.join(' | ')
    );
  }
  // Interactables aren't on `world.triggers` - check every placed
  // structure's own def directly (same source `validateBehaviours` reads).
  for (const s of world.structures || []) {
    for (const ia of (s.level.def.interactables || [])) {
      const { result: fn, warnings } = captured(() => getBehaviour(ia.interact));
      ok(
        `world "${worldKey}" structure "${s.id}" interactable "${ia.id}" names a registered behaviour ("${ia.interact}")`,
        typeof fn === 'function' && warnings.length === 0,
        warnings.join(' | ')
      );
    }
  }
}

for (const worldKey of assets.keys('world')) {
  const worldDef = assets.world(worldKey);
  const { result: world, threw, error, warnings } = captured(() => World.load(worldDef, assets, {}));
  ok(`world "${worldKey}" loads through World.load with no throw`, !threw, error && error.message);
  ok(`world "${worldKey}" loads through World.load with no console warning`, warnings.length === 0, warnings.join(' | '));
  if (threw || !world) continue;
  checkWorldEntitiesAndHorizon(worldKey, worldDef);
  checkTriggerBehaviours(worldKey, world);
}

// ---------------------------------------------------------------------------
// 4. Every level not already exercised above (placed by a real world) is
//    still exercised through World.load directly, wrapped the same way the
//    engine's own test suites do for an unplaced level (e.g.
//    engine/world/world.test.js's `test_room` case) - same "no throw / no
//    console warning" bar.
// ---------------------------------------------------------------------------
const placedLevelKeys = new Set();
for (const worldKey of assets.keys('world')) {
  for (const s of assets.world(worldKey).structures || []) placedLevelKeys.add(s.level);
}
for (const levelKey of assets.keys('level')) {
  if (placedLevelKeys.has(levelKey)) continue;
  const synthetic = { terrain: null, structures: [{ id: levelKey, level: levelKey, origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }], entities: [] };
  const { result: world, threw, error, warnings } = captured(() => World.load(synthetic, assets, {}));
  ok(`unplaced level "${levelKey}" loads through World.load (wrapped, terrain: null) with no throw`, !threw, error && error.message);
  ok(`unplaced level "${levelKey}" loads through World.load with no console warning`, warnings.length === 0, warnings.join(' | '));
  if (threw || !world) continue;
  checkTriggerBehaviours(levelKey, world);
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
