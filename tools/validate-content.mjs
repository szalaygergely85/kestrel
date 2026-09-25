#!/usr/bin/env node
// tools/validate-content.mjs (US-058, docs/backlog.md row 30b).
//
// Cross-reference checker for the designer's design/ content pack: catches
// dangling ids (model/variant/preset/light/flameProp/target/hint) and voxel
// model/material problems BEFORE they only show up as a runtime throw/warn
// or a wrong-looking render. Read-only on design/ - this tool never edits
// content, it only reports.
//
//   node tools/validate-content.mjs
//
// Exit 1 and a list of "path: problem" lines on any finding; exit 0 and
// "content OK (N checks)" otherwise. Picked up automatically by
// tools/run-tests.mjs (US-057) as a *.test.mjs sibling runs the fixture
// suite - this file itself is not a `*.test.*` file, so run-tests does not
// try to run IT as a suite (see validate-content.test.mjs for that).
//
// LOADING (grounded in the existing suites, e.g. game/js/quest/tower.test.js
// and engine/world/world.test.js): design/*.js are "classic scripts" - plain
// IIFEs with no `export`, that set `globalThis.ASSETS` as a side effect (see
// design/palette.js's own header comment). Every existing Node test loads
// them with a plain ES side-effect `import '../../design/foo.js'` in the
// EXACT list/order game/index.html's <script> tags use - there is no `vm`
// context anywhere in this repo (checked: no test uses node:vm). This tool
// reuses that exact mechanism: dynamic `import()` of the same file list, in
// the same order, then reads `globalThis.ASSETS` once every file has run.
//
// This list must stay in sync with game/index.html's design/ <script> tags.
// design/models/voxel_world.js (the waystone, US-026a) is NOT in that list
// yet (not wired into index.html/world_m1.js as of this writing) - see the
// note at the bottom of this file.
//
// US-027b (docs/architecture.md 21.9): tower/test_room/world_m1 are no
// longer classic scripts (design/levels/{tower,test_room,world_m1}.js were
// deleted) - they are content/levels/*.level.json and
// content/worlds/world_m1.world.json now, loaded through the real
// loadContentPack (same loader the game uses) and merged onto the
// `globalThis.ASSETS` the remaining classic scripts (palette, models,
// overworld_far's terrain RECIPE - still code, unaffected) already built.
import { validateVoxelModel, loadContentPack } from '../engine/index.js'; // engine/index.js: the public entry, never a deep import
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const CLASSIC_SCRIPTS = [
  '../design/palette.js',
  '../design/detail-pass.js',
  '../design/models/title.js',
  '../design/models/lantern.js',
  '../design/models/brazier.js',
  '../design/models/lever.js',
  '../design/models/boulder.js',
  '../design/models/rubble.js',
  '../design/models/wreckage.js',
  '../design/models/relay.js',
  '../design/models/voxel_props.js',
  '../design/models/voxel_tower.js',
  '../design/models/far_tower.js',
  '../design/models/ferrum_lights.js',
  '../design/levels/overworld_far.js',
];

const MANIFEST_URL = new URL('../content/manifest.json', import.meta.url).href;
function fetchText(url) { return readFile(new URL(url), 'utf8'); }

/** Dynamic-imports every design/ classic script above, in order (side effect:
 * builds up `globalThis.ASSETS`), then loads content/manifest.json (US-027a
 * loader) and merges its levels/worlds (tower/test_room/world_m1) onto the
 * same object, and returns it - same final shape `loadDesignAssets` always
 * returned, just sourced from JSON for the three flipped defs. */
export async function loadDesignAssets() {
  for (const rel of CLASSIC_SCRIPTS) {
    await import(rel);
  }
  const ASSETS = globalThis.ASSETS = globalThis.ASSETS || {};
  const bundle = await loadContentPack(MANIFEST_URL, { fetchText });
  ASSETS.levels = ASSETS.levels || {};
  ASSETS.worlds = ASSETS.worlds || {};
  Object.assign(ASSETS.levels, bundle.levels);
  Object.assign(ASSETS.worlds, bundle.worlds);
  return ASSETS;
}

// ---------------------------------------------------------------------------
// Helpers over the plain ASSETS shape (deliberately NOT engine/core/assets.js
// AssetRegistry: the test fixture below is deliberately broken in several
// ways AssetRegistry's constructor itself would throw on - e.g. a bad
// palette.util.validate() result, or a missing bundle.palette - so a
// throwing constructor would stop the validator from ever reaching most of
// its own checks. These helpers replicate just the bits of AssetRegistry /
// World.js's prop-spawn logic (engine/world/World.js, the "props from level
// data" block) needed to resolve model/variant/light/tag references, over
// the raw globals object.)
// ---------------------------------------------------------------------------

/** Same split rule as AssetRegistry.fromGlobals (engine/core/assets.js):
 * a `levels` entry with `util.heightAt` is a terrain recipe, not a level. */
function splitLevels(allLevels) {
  const levels = {};
  const terrain = {};
  for (const key of Object.keys(allLevels || {})) {
    const def = allLevels[key];
    if (def && def.util && typeof def.util.heightAt === 'function') terrain[key] = def;
    else levels[key] = def;
  }
  return { levels, terrain };
}

/** Mirrors engine/world/World.js's prop model resolution (7.5 item 1/2): a
 * numeric `variant`/`pose` selects `model.variants[n]` (only valid when that
 * entry is itself a full billboard sub-model, per AssetRegistry's own
 * numeric-variant packing rule); a string one is an animation/clip name,
 * checked separately by `resolveClip` below. Returns null if the model
 * itself (or the numeric variant index) does not resolve. */
function resolveModel(models, modelName, variantRaw) {
  const base = models && models[modelName];
  if (!base) return null;
  if (typeof variantRaw === 'number') {
    if (!Array.isArray(base.variants)) return null;
    const sub = base.variants[variantRaw];
    if (!sub || typeof sub !== 'object' || !sub.billboard) return null;
    return sub;
  }
  return base;
}

/** True if `clipName` is a known animation/clip on `model` (voxel models
 * keep their clips under `model.voxel.animations`, per architecture.md 15.1
 * - billboard models keep them directly under `model.animations`). */
function hasClip(model, clipName) {
  const dict = (model && model.voxel && model.voxel.animations) || (model && model.animations) || {};
  return Object.prototype.hasOwnProperty.call(dict, clipName);
}

function isAscii(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

/** Every string this game actually draws as UI text, gathered from the
 * known ASSETS.uiStyle shape (design/models/title.js, design/README.md
 * section 5) - NOT the `desc`/`note`/`source`/`when` documentation fields
 * scattered through the same objects, which are for the design team, never
 * rendered. Returns [{ path, text, isEndTextLine }]. */
function collectUiTexts(uiStyle) {
  const out = [];
  if (!uiStyle) return out;
  const add = (path, text, isEndTextLine) => {
    if (typeof text === 'string') out.push({ path, text, isEndTextLine: !!isEndTextLine });
  };
  for (const h of uiStyle.hints || []) add(`uiStyle.hints[${h.id}].text`, h.text);
  for (const h of uiStyle.storyHints || []) add(`uiStyle.storyHints[${h.id}].text`, h.text);
  if (uiStyle.hint) add('uiStyle.hint.prefix', uiStyle.hint.prefix);
  for (const ex of (uiStyle.prompt && uiStyle.prompt.examples) || []) add('uiStyle.prompt.examples[]', ex);
  if (uiStyle.pause) add('uiStyle.pause.text', uiStyle.pause.text);
  if (uiStyle.endText) {
    for (const l of uiStyle.endText.lines || []) {
      add(`uiStyle.endText.lines[${l.id}].text`, l.text, true);
      if (l.alt) add(`uiStyle.endText.lines[${l.id}].alt`, l.alt, true);
    }
  }
  if (uiStyle.settings) {
    const s = uiStyle.settings;
    if (s.title) add('uiStyle.settings.title.text', s.title.text);
    if (s.labels) for (const k of Object.keys(s.labels)) add(`uiStyle.settings.labels.${k}`, s.labels[k]);
    if (s.valueText) {
      for (const k of Object.keys(s.valueText)) {
        const vt = s.valueText[k] || {};
        for (const vk of Object.keys(vt)) add(`uiStyle.settings.valueText.${k}.${vk}`, vt[vk]);
      }
    }
    if (s.keyHints) add('uiStyle.settings.keyHints.text', s.keyHints.text);
    if (s.pauseEntry) add('uiStyle.settings.pauseEntry.text', s.pauseEntry.text);
  }
  return out;
}

const MAX_ENDTEXT_LINE = 40;

/**
 * Validates one ASSETS-shaped bundle (either the real design/ pack, loaded
 * via loadDesignAssets(), or a hand-built in-memory fixture - see
 * validate-content.test.mjs). Collects EVERY problem found (does not stop
 * at the first) and counts every check attempted, whether it passed or not.
 * @returns {{ errors: string[], checks: number }}
 */
export function validateContent(ASSETS) {
  const errors = [];
  let checks = 0;
  const fail = (path, msg) => errors.push(`${path}: ${msg}`);
  const check = (cond, path, msg) => { checks++; if (!cond) fail(path, msg); };

  const models = (ASSETS && ASSETS.models) || {};
  const palette = (ASSETS && ASSETS.palette) || {};
  const paletteLights = palette.lights || {};
  const paletteMaterials = palette.materials || {};
  const detailPass = (ASSETS && ASSETS.detailPass) || null;
  const detailMaterials = (detailPass && detailPass.materials) || {};
  const voxelMaterials = (ASSETS && ASSETS.voxelMaterials) || {};
  const v1Materials = voxelMaterials.v1 || {};
  const v2Materials = voxelMaterials.v2 || {};
  const uiStyle = (ASSETS && ASSETS.uiStyle) || null;

  const { levels } = splitLevels((ASSETS && ASSETS.levels) || {});
  const worlds = (ASSETS && ASSETS.worlds) || {};

  // Every hint id this game can ever fire, from EITHER uiStyle.hints[] or
  // uiStyle.storyHints[] - a level trigger's `hint` field names one of
  // either array (e.g. tower.js's hintJump names 'jump', which lives in
  // uiStyle.hints[], not storyHints[]; hintBurner/hintClimb/hintExit name
  // ids that DO live in storyHints[]). Checking only storyHints would
  // false-positive on real, correct content, so this checks the union.
  const knownHintIds = new Set([
    ...((uiStyle && uiStyle.hints) || []).map((h) => h.id),
    ...((uiStyle && uiStyle.storyHints) || []).map((h) => h.id),
  ]);

  // ---- 1. Level props: model/variant refs, lights, interactables, triggers ----
  for (const levelKey of Object.keys(levels)) {
    const level = levels[levelKey];
    if (!level || typeof level !== 'object') continue;
    const base = `levels.${levelKey}`;

    const lightIds = new Set((level.lights || []).map((l) => l.id));
    const propIds = new Set((level.props || []).map((p) => p.id));
    const legendTags = new Set(
      Object.values(level.legend || {}).map((v) => v && v.tag).filter(Boolean)
    );

    // -- props: model / variant(clip) --
    for (const prop of level.props || []) {
      const path = `${base}.props[${prop.id}]`;
      const isDecal = typeof prop.model === 'string' && prop.model.indexOf('decal:') === 0;
      const isChain = prop.from != null || prop.to != null;
      if (isDecal) {
        // Level-authored decal text, not a spawned model (World.js skips
        // it the same way) - still worth an ASCII check (US-058 AC: all
        // UI text ASCII 32-126; a wall scrawl is player-visible text).
        const text = prop.model.slice('decal:'.length);
        check(isAscii(text), `${path}.model(decal text)`, `decal text is not ASCII 32-126: ${JSON.stringify(text)}`);
        continue;
      }
      if (isChain) continue; // level-authored visual data, no model (World.js skips it too)

      const variantRaw = prop.variant !== undefined ? prop.variant : prop.pose;
      const resolved = resolveModel(models, prop.model, variantRaw);
      check(!!resolved, `${path}.model`, `model "${prop.model}"${typeof variantRaw === 'number' ? ` variant ${variantRaw}` : ''} not found in ASSETS.models`);
      if (resolved && typeof variantRaw === 'string') {
        check(hasClip(models[prop.model], variantRaw), `${path}.variant`, `variant/clip "${variantRaw}" not found on model "${prop.model}"`);
      }
    }

    // -- lights: preset --
    for (const light of level.lights || []) {
      check(
        Object.prototype.hasOwnProperty.call(paletteLights, light.preset),
        `${base}.lights[${light.id}].preset`,
        `light preset "${light.preset}" not found in palette.js lights`
      );
    }
    if (level.sun) {
      check(
        Object.prototype.hasOwnProperty.call(paletteLights, level.sun.preset),
        `${base}.sun.preset`,
        `light preset "${level.sun.preset}" not found in palette.js lights`
      );
    }
    if (level.ambient) {
      check(
        Object.prototype.hasOwnProperty.call(paletteLights, level.ambient.preset),
        `${base}.ambient.preset`,
        `light preset "${level.ambient.preset}" not found in palette.js lights`
      );
    }

    // -- interactables: light / flameProp / target(tag) --
    for (const ia of level.interactables || []) {
      const path = `${base}.interactables[${ia.id}]`;
      if (ia.light !== undefined) {
        check(lightIds.has(ia.light), `${path}.light`, `light id "${ia.light}" not found in ${base}.lights`);
      }
      if (ia.flameProp !== undefined) {
        check(propIds.has(ia.flameProp), `${path}.flameProp`, `flameProp id "${ia.flameProp}" not found in ${base}.props`);
      }
      if (ia.target && ia.target.tag !== undefined) {
        check(legendTags.has(ia.target.tag), `${path}.target.tag`, `target tag "${ia.target.tag}" not found on any ${base}.legend cell`);
      }
    }

    // -- triggers: shape (r > 0, zMin < zMax), hint ids --
    for (const tr of level.triggers || []) {
      const path = `${base}.triggers[${tr.id}]`;
      if (tr.r !== undefined) {
        check(typeof tr.r === 'number' && tr.r > 0, `${path}.r`, `radius must be > 0, got ${JSON.stringify(tr.r)}`);
      }
      if (tr.zMin !== undefined && tr.zMax !== undefined) {
        check(tr.zMin < tr.zMax, `${path}.zMin/zMax`, `zMin (${tr.zMin}) must be < zMax (${tr.zMax})`);
      }
      if (tr.type === 'hint' && tr.hint !== undefined) {
        check(knownHintIds.has(tr.hint), `${path}.hint`, `hint id "${tr.hint}" not found in uiStyle.hints/storyHints`);
      }
    }
  }

  // ---- 2. World entities/horizon: model refs ----
  for (const worldKey of Object.keys(worlds)) {
    const world = worlds[worldKey];
    if (!world || typeof world !== 'object') continue;
    const base = `worlds.${worldKey}`;
    for (const e of world.entities || []) {
      if (typeof e.model !== 'string') continue;
      check(!!resolveModel(models, e.model, undefined), `${base}.entities[${e.id}].model`, `model "${e.model}" not found in ASSETS.models`);
    }
    for (const h of world.horizon || []) {
      if (typeof h.model !== 'string') continue;
      check(!!resolveModel(models, h.model, undefined), `${base}.horizon[${h.id}].model`, `model "${h.model}" not found in ASSETS.models`);
    }
  }

  // ---- 3. Voxel models: validateVoxelModel + material cross-refs ----
  // The real material namespace a voxel model's `mats` values draw from is
  // palette.js `materials` (checked by voxel_props.js's own `attach()`,
  // which only wires `.voxel` onto a model once every material key is
  // "ALREADY in palette.materials AND detailPass.materials" - see that
  // file's header). `voxelMaterials.v1/v2` is NOT that full namespace: it
  // is only the designer's staging/merge-tracking record for the SMALL set
  // of materials newly introduced for voxel props (batch 1, batch 2, ...) -
  // real models freely use long-standing plain materials like `brass`/
  // `wood`/`canvas` that were never routed through voxelMaterials at all
  // (confirmed: gondola/envelopeHeap/canvasHeap do exactly this, and pass
  // fine because palette.materials/detailPass.materials already have them).
  // So the per-model gate below is palette+detailPass membership; the
  // voxelMaterials.v1/v2 registry is checked separately, for INTERNAL
  // consistency, right after.
  const paletteMaterialKeys = new Set(Object.keys(paletteMaterials));
  for (const modelKey of Object.keys(models)) {
    const model = models[modelKey];
    if (!model || !model.voxel) continue;
    const path = `models.${modelKey}.voxel`;
    checks++; // the validateVoxelModel call itself counts as one check
    const { errors: voxErrs } = validateVoxelModelSafe(model.voxel, { materialKeys: paletteMaterialKeys });
    for (const e of voxErrs) fail(path, e);

    const mats = model.voxel.mats || {};
    for (const matKey of Object.keys(mats)) {
      const matName = mats[matKey];
      if (matName == null) continue;
      check(Object.prototype.hasOwnProperty.call(paletteMaterials, matName), `${path}.mats['${matKey}']`, `material "${matName}" not found in palette.js materials`);
      check(Object.prototype.hasOwnProperty.call(detailMaterials, matName), `${path}.mats['${matKey}']`, `material "${matName}" not found in detail-pass.js materials`);
    }
  }

  // voxelMaterials.v1/v2 internal consistency (the designer's own merge
  // bookkeeping, design/models/voxel_props.js/voxel_tower.js/voxel_world.js
  // header comments): every v1 record should already be merged into
  // palette.materials under the same key, every v2 record into
  // detailPass.materials, and remap/fallback targets should themselves
  // resolve.
  for (const key of Object.keys(v1Materials)) {
    check(Object.prototype.hasOwnProperty.call(paletteMaterials, key), `voxelMaterials.v1.${key}`, `not merged into palette.js materials`);
  }
  for (const key of Object.keys(v2Materials)) {
    check(Object.prototype.hasOwnProperty.call(detailMaterials, key), `voxelMaterials.v2.${key}`, `not merged into detail-pass.js materials`);
  }
  const remap = voxelMaterials.remap || {};
  for (const key of Object.keys(remap)) {
    check(Object.prototype.hasOwnProperty.call(v2Materials, remap[key]), `voxelMaterials.remap.${key}`, `remap target "${remap[key]}" not found in voxelMaterials.v2`);
  }
  const fallback = voxelMaterials.fallback || {};
  for (const key of Object.keys(fallback)) {
    check(Object.prototype.hasOwnProperty.call(paletteMaterials, fallback[key]), `voxelMaterials.fallback.${key}`, `fallback target "${fallback[key]}" not found in palette.js materials`);
  }

  // ---- 4. UI text: ASCII 32-126, endText lines <= 40 chars ----
  for (const { path, text, isEndTextLine } of collectUiTexts(uiStyle)) {
    check(isAscii(text), path, `not ASCII 32-126: ${JSON.stringify(text)}`);
    if (isEndTextLine) {
      check(text.length <= MAX_ENDTEXT_LINE, path, `endText line is ${text.length} chars, expected <= ${MAX_ENDTEXT_LINE}: ${JSON.stringify(text)}`);
    }
  }

  return { errors, checks };
}

function validateVoxelModelSafe(def, opts) {
  try {
    return validateVoxelModel(def, opts);
  } catch (e) {
    return { errors: [`threw: ${e && e.message ? e.message : e}`], warnings: [] };
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
async function main() {
  const ASSETS = await loadDesignAssets();
  const { errors, checks } = validateContent(ASSETS);
  if (errors.length) {
    for (const e of errors) console.error(e);
    console.error(`content INVALID: ${errors.length} finding(s) out of ${checks} checks`);
    process.exitCode = 1;
  } else {
    console.log(`content OK (${checks} checks)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
