#!/usr/bin/env node
import { validateEditorGroups } from './editor/treeGroups.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
// CHARGEN-15 (38.33): `char.<id>` models come from the add-on packages in content/packages/index.json (registered at boot, not in ASSETS.models).
const addonChars = new Set();
try {
  const { openPackage } = await import('../engine/index.js');
  const dir = resolvePath('content/packages');
  const idx = JSON.parse(readFileSync(resolvePath(dir, 'index.json'), 'utf8'));
  for (const rel of idx.packages || []) {
    const pkg = await openPackage(new Uint8Array(readFileSync(resolvePath(dir, rel))));
    for (const a of pkg.manifest.assets || []) if (/^model\.(rigged|static)$/.test(a.type) && a.id) addonChars.add('char.' + a.id);
  }
} catch { /* no index = no add-ons */ }
addonChars.add('char.kit'); // OB-086: the default kit character is registered at boot by main.js (Ch3 Hesk / Dorrin use it)
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
// This list must stay in sync with game/index.html's design/ <script> tags,
// with ONE deliberate exception: design/models/voxel_world.js (the waystone,
// US-026a-content). content/worlds/world_m1.world.json now references
// `model: 'waystone'` (the endMarker world entity), but wiring that file
// into game/index.html's own <script> tags is explicitly PC-A's job
// (docs/architecture.md 23.7 step S6, not done yet) - the real game page
// does NOT know this model exists yet. It IS added here (Node-side tooling
// only) so this validator (and content-node.mjs-based Node tests, via the
// classic-script imports those test files already do) can resolve/check it
// without waiting on S6. Confirmed by running this tool before/after adding
// the line: neither `validateContent`'s world-entity model check (section 2
// below, extended to also read `components.voxel.model`) nor `World.load`'s
// prop spawn currently throw on an unregistered model for a WORLD-level
// entity (only Level-level `props[].model` throws, engine/world/World.js
// 7.5 item 1) - so this addition is a coverage improvement, not a fix for
// an actual crash; it makes sure a future broken waystone ref/material
// would be CAUGHT here instead of silently passing.
//
// US-027b (docs/architecture.md 21.9): tower/test_room/world_m1 are no
// longer classic scripts (design/levels/{tower,test_room,world_m1}.js were
// deleted) - they are content/levels/*.level.json and
// content/worlds/world_m1.world.json now, loaded through the real
// loadContentPack (same loader the game uses) and merged onto the
// `globalThis.ASSETS` the remaining classic scripts (palette, models,
// overworld_far's terrain RECIPE - still code, unaffected) already built.
import { validateVoxelModel, loadContentPack, PROP_SCALE_MIN, PROP_SCALE_MAX, meshFromJSON, meshFromBin, validateMesh, validateUnderSite, validateLinks, validateLook, maskFromJSON, validateDialogue } from '../engine/index.js'; // engine/index.js: the public entry, never a deep import
import { pathToFileURL, fileURLToPath } from 'node:url';
import { normalizeQuestDef } from '../game/js/quest/sim/questFormat.js'; // UNDER-07: D-106 new-format quest files read as the legacy shape
import { readFile } from 'node:fs/promises';
import { validateQuestDefinition } from '../game/js/quest/sim/quest.js';
import { createCrafting } from '../game/js/quest/sim/crafting.js';
import { lintSpellPlacements } from '../game/js/quest/sim/spellBooks.js'; // SPELL-09
import { CHEST_TABLES } from '../game/js/quest/sim/chestDefs.js';

const CLASSIC_SCRIPTS = [
  '../design/palette.js',
  '../design/detail-pass.js',
  '../design/items.js',
  '../design/models/title.js',
  '../design/models/menu_ui.js',
  '../design/models/lantern.js',
  '../design/models/pickups_voxel.js',
  '../design/models/brazier.js',
  '../design/models/lever.js',
  '../design/models/boulder.js',
  '../design/models/rubble.js',
  '../design/models/wreckage.js',
  '../design/models/relay.js',
  '../design/models/voxel_props.js',
  '../design/models/voxel_tower.js',
  '../design/models/voxel_tower_crown.js', // CH1-D1b: ASSETS.models.towerCrown (world_m1 entity "towerCrown"); game/index.html needs the same tag after voxel_tower.js.
  '../design/models/voxel_world.js', // US-026a-content: waystone. Node/tooling only - see the header note above.
  '../design/models/sword.js', // US-078c: the ruin-steel sword (content/levels/tower.level.json prop "sword"), same load position as game/index.html.
  '../design/models/voxel_beast.js', // US-079a: the placeholder boar (content/worlds/world_m1.world.json entities "boar1"/"boar2"), same load position as game/index.html.
  '../design/models/voxel_wolf.js', // WOLF-D1: the wolf (WOLF_MODEL 'wolf').
  '../design/models/voxel_goblin.js', // GOB-D1/07a: goblin, goblinTorch, goblinSpear + ASSETS.goblinFx (game/index.html tag after voxel_wolf.js).
  '../design/models/voxel_skeleton.js', // OB-191: skeleton, skeletonArcher + ASSETS.skeletonFx (game/index.html tag after voxel_goblin.js).
  '../design/models/chest.js', // EQ-10: chestSmall on the world_m1 chest* anchors
  '../design/models/voxel_bear.js', // NPC-BEAR-01: ASSETS.models.bear (world_m1 entity "bear", content/dialogue/bear.dialogue.json clips), same load position as game/index.html.
  '../design/models/voxel_bear_black.js', // BEAR-D1: ASSETS.models.bearBlack (clones ASSETS.models.bear -> must follow voxel_bear.js). game/index.html tag: BEAR-01.
  '../design/models/voxel_bear_cub.js', // NUB-D1: ASSETS.models.bearCub (Nub, Burl's cub; stand-alone). Not in game/index.html / the world yet (placement = later story).
  '../design/models/voxel_crocodile.js', // BEAST-D1-CROC: ASSETS.models.crocodile + ASSETS.crocFx (stand-alone).
  '../design/models/voxel_otter.js', // SKIP-D1: ASSETS.models.otter (Skip the otter; stand-alone). Not in game/index.html / the world yet (placement = later story).
  '../design/models/voxel_goat.js', // CRAG-D1: ASSETS.models.goat + ASSETS.goatFx (Crag, the old goat of Signal Head; stand-alone). Not in game/index.html / the world yet.
  '../design/models/voxel_heron.js', // STILT-D1: ASSETS.models.heron + ASSETS.heronFx (Stilt, the heron of the Reedmire; stand-alone). Not in game/index.html / the world yet.
  '../design/models/voxel_tortoise.js', // SLATE-D1: ASSETS.models.tortoise + ASSETS.tortoiseFx (Slate, the ancient tortoise of the Glasswater islet; stand-alone). Not in game/index.html / the world yet.
  '../design/models/voxel_wildlife.js', // QL-06: ASSETS.models.crow (Rook, world_m1 entity "rook"), same load position as game/index.html.
  '../design/models/voxel_eat_clips.js', // SWIM-ASSETS-01: eat clips, after the model files, same load position as game/index.html.
  '../design/models/voxel_beast_clips.js', // OB-153: beast combat clips for deer/fox/goat/tortoise, after the eat clips + those models (game/index.html: same order).
  '../design/models/voxel_lynx.js', // OB-153: ASSETS.models.lynx + ASSETS.lynxFx (stand-alone; after voxel_eat_clips.js: appends 'lynx' to eatFx.models).
  '../design/models/voxel_aurochs.js', // OB-153: ASSETS.models.aurochs + ASSETS.aurochsFx (stand-alone; after voxel_eat_clips.js: appends 'aurochs' to eatFx.models).
  '../design/models/voxel_seamonster.js', // SWIM-ASSETS-01: ASSETS.models.seaMonster (world_m1 entity "seaMonster").
  '../design/models/sb_objects.js', // OB-191: gravestone1..3(+Weathered) for the cemetery (game/index.html needs the same script tag: shared hot file, main session adds it).
  '../design/models/m3_props.js', // US-078d: the practice target pell (content/levels/tower.level.json prop "practiceTarget"), same load position as game/index.html.
  '../design/models/far_tower.js',
  '../design/models/ferrum_lights.js',
  // Optional local third-party packs (git-ignored design/local/, licence unverified - never pushed): loaded only if present.
  { optional: '../design/local/voxel_pack.js' },
  '../design/levels/overworld_far.js',
];

const MANIFEST_URL = new URL('../content/manifest.json', import.meta.url).href;
function fetchText(url) { return readFile(new URL(url), 'utf8'); }
function fetchBytes(url) { return readFile(new URL(url)); } // MESH-BIN-01

/** Dynamic-imports every design/ classic script above, in order (side effect:
 * builds up `globalThis.ASSETS`), then loads content/manifest.json (US-027a
 * loader) and merges its levels/worlds (tower/test_room/world_m1) onto the
 * same object, and returns it - same final shape `loadDesignAssets` always
 * returned, just sourced from JSON for the three flipped defs. */
export async function loadDesignAssets() {
  for (const rel of CLASSIC_SCRIPTS) {
    if (typeof rel === 'object') {
      if (existsSync(new URL(rel.optional, import.meta.url))) await import(rel.optional);
      continue;
    }
    await import(rel);
  }
  const ASSETS = globalThis.ASSETS = globalThis.ASSETS || {};
  const bundle = await loadContentPack(MANIFEST_URL, { fetchText, fetchBytes });
  ASSETS.levels = ASSETS.levels || {};
  ASSETS.worlds = ASSETS.worlds || {};
  Object.assign(ASSETS.levels, bundle.levels);
  Object.assign(ASSETS.worlds, bundle.worlds);
  ASSETS.meshes = { ...(ASSETS.meshes || {}), ...bundle.meshes };
  ASSETS.masks = { ...(ASSETS.masks || {}), ...bundle.masks }; // ALPHA-01a
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
const MAX_OBJECTIVE_TEXT = 38, MAX_ITEM_NAME = 14, MAX_BOOK_NAME = 21, MAX_ITEM_DESC = 38;
/** Quests allowed to pay nothing, id -> reason (QUEST-REWARD-AUDIT). Keep empty unless the quest is a pure story hand-off. */
export const NO_REWARD_OK = Object.freeze({
  m1: 'legacy giverless auto-quest (sections only, no hand-in NPC); a giverless quest cannot reward (quest.js)',
});

export function validateContent(ASSETS, opts = {}) {
  const errors = [];
  const warnings = [];
  const infos = []; // QL-T2: informational notes (not findings)
  let checks = 0;
  const fail = (path, msg) => errors.push(`${path}: ${msg}`);
  const check = (cond, path, msg) => { checks++; if (!cond) fail(path, msg); };
  const warn = (path, msg) => warnings.push(`${path}: ${msg}`);

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

  // ME-14a: registered mesh assets resolve materials; unregistered import samples
  // are geometry-checked by the optional filesystem pass below.
  const meshes = ASSETS?.meshes || {};
  for (const [id, def] of Object.entries(meshes)) {
    const path = `meshes.${id}`;
    try {
      const mesh = def.pos instanceof Float32Array ? def : meshFromJSON(def);
      const result = validateMesh(mesh);
      check(result.errors.length === 0, path, result.errors.join('; '));
      // ALPHA-01a (37.17): every masked range names a mask registered in the manifest
      for (const r of mesh.ranges) if (r.mask) check(Object.hasOwn(ASSETS?.masks || {}, r.mask.tex), `${path}.ranges[${r.part}].mask`, `mask "${r.mask.tex}" is not in the manifest masks`);
      const mats = def.mats === undefined ? {} : def.mats;
      const validMap = mats && typeof mats === 'object' && !Array.isArray(mats) && Object.values(mats).every((v) => typeof v === 'string' && v.length > 0);
      check(!!validMap, `${path}.mats`, 'must be a material-name -> palette-key map');
      for (const key of mesh.matKeys) {
        const mapped = validMap ? (mats[key] ?? key) : key;
        check(typeof mapped === 'string' && (Object.hasOwn(paletteMaterials, mapped)
          || Object.hasOwn(detailMaterials, mapped) || Object.hasOwn(detailPass?.remap || {}, mapped)),
          `${path}.matKeys[${key}]`, `material "${mapped}" does not resolve`);
      }
    } catch (e) { check(false, path, e.message); }
  }
  const checkMeshEntity = (entity, path) => {
    const component = entity.components?.mesh;
    if (!component) return;
    check(typeof component.id === 'string' && Object.hasOwn(meshes, component.id), `${path}.components.mesh.id`, 'mesh id not found');
    if (component.yawDeg !== undefined) check(Number.isFinite(component.yawDeg), `${path}.components.mesh.yawDeg`, 'must be finite');
  };
  for (const [id, world] of Object.entries(worlds)) {
    for (const entity of world.entities || []) checkMeshEntity(entity, `worlds.${id}.entities[${entity.id}]`);
    for (const msg of validateEditorGroups(world.editorGroups)) check(false, `worlds.${id}.editorGroups`, msg); // OB-028
  }
  for (const [id, chunk] of Object.entries(ASSETS?.chunks || {})) {
    for (const entity of chunk.entities || []) checkMeshEntity(entity, `chunks.${id}.entities[${entity.id}]`);
  }

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

  // ---- 0. ART-01a look records (architecture.md 37.18 item 2) ----
  // Every timeOfDay key's optional hemi/haze/clouds blocks run through
  // engine/render/look.js's `validateLook` (colour keys exist, ranges sane, the
  // haze.far === sky[0].c horizon rule). Errors are findings; the horizon
  // mismatch is a WARNING (surfaced, not fatal). One `checks` per key, same
  // "validate call = one check" convention as validateMesh above.
  for (const key of Object.keys(palette.timeOfDay || {})) {
    checks++;
    const lookErrors = validateLook(palette, key, (m) => warnings.push(m));
    for (const e of lookErrors) errors.push(e);
  }

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
      // ED-SCALE-1 (34.1): optional uniform scale, range [PROP_SCALE_MIN, PROP_SCALE_MAX].
      if (prop.scale !== undefined) {
        check(
          typeof prop.scale === 'number' && Number.isFinite(prop.scale) && prop.scale >= PROP_SCALE_MIN && prop.scale <= PROP_SCALE_MAX,
          `${path}.scale`, `scale ${JSON.stringify(prop.scale)} outside [${PROP_SCALE_MIN}, ${PROP_SCALE_MAX}]`
        );
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
    // NAV-LINKS-01a (arch 38.71): authored nav links (ladder / drop / door) - shape checks here, walkable ends + cost bound at bake time (addAuthoredLinks)
    if (world.nav && world.nav.links !== undefined) { checks++; for (const e of validateLinks(world.nav.links)) fail(`${base}.nav.links`, e); }
    for (const e of world.entities || []) {
      // Billboard/legacy world entities carry a top-level `model` (e.g.
      // farTower); a `type: 'prop'` entity with a voxel look carries it
      // under `components.voxel.model` instead (US-041a component shape,
      // e.g. US-026a-content's endMarker/waystone) - check whichever is present.
      const voxelModel = e.components && e.components.voxel && e.components.voxel.model;
      if (typeof e.model === 'string') {
        check(!!resolveModel(models, e.model, undefined), `${base}.entities[${e.id}].model`, `model "${e.model}" not found in ASSETS.models`);
      }
      if (typeof voxelModel === 'string') {
        check(!!resolveModel(models, voxelModel, undefined) || addonChars.has(voxelModel), `${base}.entities[${e.id}].components.voxel.model`, `model "${voxelModel}" not found in ASSETS.models`);
        // VISQA-15: a sprite (glyph-grid) model under components.voxel draws nothing (VoxelPool warns) - use components.sprite.
        const vm = resolveModel(models, voxelModel, undefined);
        check(!vm || !!vm.voxel || !!vm.mesh || !!vm.meshOnly || !(vm.frames || vm.anims || vm.animations && !vm.voxel) || addonChars.has(voxelModel), `${base}.entities[${e.id}].components.voxel.model`, `model "${voxelModel}" is a sprite model; use components.sprite`);
      }
      // ED-SCALE-1 (34.1): `scale` inline shorthand or `transform.scale`.
      const rawScale = e.scale !== undefined ? e.scale : (e.transform && e.transform.scale);
      if (rawScale !== undefined) {
        check(
          typeof rawScale === 'number' && Number.isFinite(rawScale) && rawScale >= PROP_SCALE_MIN && rawScale <= PROP_SCALE_MAX,
          `${base}.entities[${e.id}].scale`, `scale ${JSON.stringify(rawScale)} outside [${PROP_SCALE_MIN}, ${PROP_SCALE_MAX}]`
        );
      }
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
  let meshOnlyCount = 0;
  for (const modelKey of Object.keys(models)) {
    const model = models[modelKey];
    if (!model || !model.voxel) continue;
    const path = `models.${modelKey}.voxel`;
    checks++; // the validateVoxelModel call itself counts as one check
    // ME-22 (28.12 item 7): the `meshOnly` flag passes straight through to
    // validateVoxelModel (it's just a field on `model.voxel`) - counted
    // here for the summary line, so a dda-only test page knows up front
    // what it won't show.
    if (model.voxel.meshOnly === true) meshOnlyCount++;
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

  // ALPHA-01d: the material flag `edge` is optional and may only be 'soft' (silhouette-only outlines for foliage cards), in both files.
  for (const [file, mats] of [['palette.js', paletteMaterials], ['detail-pass.js', detailMaterials]]) {
    for (const key of Object.keys(mats)) {
      if (mats[key] && mats[key].edge !== undefined) check(mats[key].edge === 'soft', `${file} materials.${key}.edge`, `must be 'soft' (got ${JSON.stringify(mats[key].edge)})`);
    }
  }

  // ---- 5. Outer-ring rule (docs/architecture.md 23.9, BUG-OWN-008) ----
  // A level placed (via world.structures[]) in a world that HAS terrain
  // (world.terrain truthy) must have a non-solid outer ring: from outside
  // the footprint the caster uses the ring's floorH as the ground reference
  // (23.9 fix item 1, "Ring rule"); a solid ring cell there draws the wall
  // face down to level height 0 (CPU) or one cell deep (GPU) instead of
  // blending to terrain - see 23.9 "Known limits (b)". A level never placed
  // in a world with terrain (e.g. test_room today) is unaffected.
  for (const worldKey of Object.keys(worlds)) {
    const world = worlds[worldKey];
    if (!world || typeof world !== 'object' || !world.terrain) continue;
    const base = `worlds.${worldKey}`;
    for (const structure of world.structures || []) {
      const level = levels[structure.level];
      // A dangling structure.level id is not this check's job (no such
      // cross-ref check exists yet either way); just skip what can't be read.
      if (!level || !Array.isArray(level.rows) || !level.legend) continue;
      const rows = level.rows;
      const h = rows.length;
      const w = h > 0 ? rows[0].length : 0;
      const path = `${base}.structures[${structure.id}].level(${structure.level})`;
      for (let y = 0; y < h; y++) {
        const row = rows[y] || '';
        const onRing = y === 0 || y === h - 1;
        for (let x = 0; x < w; x++) {
          if (!onRing && x !== 0 && x !== w - 1) continue; // interior cell
          const ch = row[x];
          const entry = level.legend[ch];
          check(
            !(entry && entry.solid),
            `${path}.rows[${y}][${x}]`,
            `outer ring cell '${ch}' is solid; a level in a world with terrain needs a non-solid outer ring (ground reference for the outside-footprint caster, architecture.md 23.9)`
          );
        }
      }
    }
  }

  // ---- 5b. GS-01d: legend flag terrainFloor (engine/world/Level.js isTerrainFloor) ----
  // Only non-solid 'outside' cells whose floorH equals the nearest outer-ring cell's floorH (+-0.01, what the
  // terrain blend ringHAt gives under the bbox) may show the terrain: anything else would put a height step
  // between the terrain and the walkable sector.
  for (const [levelId, level] of Object.entries(levels)) {
    if (!level || !Array.isArray(level.rows) || !level.legend) continue;
    const flagged = Object.entries(level.legend).filter(([, e]) => e && e.terrainFloor !== undefined);
    if (!flagged.length) continue;
    const rows = level.rows, h = rows.length, w = h > 0 ? rows[0].length : 0;
    const ringH = (cx, cy) => { // same nearest-edge rule as World.makeRingHAt
      const dl = cx + 0.5, dr = w - cx - 0.5, dt = cy + 0.5, db = h - cy - 0.5, m = Math.min(dl, dr, dt, db);
      let rx = cx, ry = cy;
      if (m === dl) rx = 0; else if (m === dr) rx = w - 1;
      if (m === dt) ry = 0; else if (m === db) ry = h - 1;
      const e = level.legend[rows[ry][rx]];
      return e ? e.floorH : NaN;
    };
    for (const [ch, e] of flagged) {
      const base = `levels.${levelId}.legend['${ch}']`;
      check(e.terrainFloor === true, base, 'terrainFloor must be true when present');
      check(!e.solid && e.zone === 'outside', base, 'terrainFloor is only allowed on non-solid cells with zone "outside"');
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (rows[y][x] !== ch) continue;
        const rh = ringH(x, y);
        check(typeof e.floorH === 'number' && Math.abs(e.floorH - rh) <= 0.01,
          `levels.${levelId}.rows[${y}][${x}]`,
          `terrainFloor cell '${ch}' floorH ${e.floorH} != outer-ring floorH ${rh} (terrain height step)`);
      }
    }
  }

  // ---- 4. UI text: ASCII 32-126, endText lines <= 40 chars ----
  for (const { path, text, isEndTextLine } of collectUiTexts(uiStyle)) {
    check(isAscii(text), path, `not ASCII 32-126: ${JSON.stringify(text)}`);
    if (isEndTextLine) {
      check(text.length <= MAX_ENDTEXT_LINE, path, `endText line is ${text.length} chars, expected <= ${MAX_ENDTEXT_LINE}: ${JSON.stringify(text)}`);
    }
  }

  // S8-C-17 / D-049: current inline copy and references only. A carried
  // quest item can be an inventory def or a declared level pickup (lantern).
  const itemDefs = ASSETS?.items?.defs || {};
  const itemIds = new Set(Object.keys(itemDefs));
  const inlineText = (text, path) => check(typeof text === 'string' && text.trim().length > 0 && isAscii(text), path, 'required printable ASCII text is missing or invalid');
  for (const [id, def] of Object.entries(itemDefs)) {
    check(def?.id === id, `items.defs.${id}.id`, 'must match the item key');
    inlineText(def?.name, `items.defs.${id}.name`);
    inlineText(def?.desc, `items.defs.${id}.desc`);
    // S8-C-17b: writer-contract length limits (docs/story.md Sprint 8 texts)
    if (typeof def?.name === 'string') { const max = id.startsWith('book.spell.') ? MAX_BOOK_NAME : MAX_ITEM_NAME; check(def.name.length <= max, `items.defs.${id}.name`, `name is ${def.name.length} chars, expected <= ${max}`); } // SPELL-09: "Spell Book: <Spell>" is 21 chars at most
    if (typeof def?.desc === 'string') check(def.desc.length <= MAX_ITEM_DESC, `items.defs.${id}.desc`, `desc is ${def.desc.length} chars, expected <= ${MAX_ITEM_DESC}`);
  }
  for (const [id, table] of Object.entries(ASSETS?.items?.loot || {})) {
    for (const [i, entry] of (table.entries || []).entries()) {
      check(itemIds.has(entry.item), `items.loot.${id}.entries[${i}].item`, `item "${entry.item}" not found`);
    }
  }
  for (const level of Object.values(levels)) {
    for (const pickup of level.interactables || []) {
      if (typeof pickup.interact === 'string' && pickup.interact.endsWith('.take')) itemIds.add(pickup.id);
    }
  }
  for (const [wid, world] of Object.entries(worlds)) for (const e of world.entities || []) { // QUESTS-01: generic pickup props name a real item
    const q = e.components?.questPickup;
    if (q) check(itemIds.has(q.item) && Number.isInteger(q.n ?? 1) && (q.n ?? 1) >= 1, `worlds.${wid}.${e.id}.questPickup`, `item "${q.item}" not found in item defs (or bad n)`);
  }
  const beastIds = new Set();
  for (const world of Object.values(worlds)) {
    for (const entity of world.entities || []) if (entity.type === 'beast') beastIds.add(entity.id);
  }
  const quests = opts.quests || [];
  // AREAS-01: level landmarks are named `markers` in the shipped JSON.
  // Qualify them by a world placement; trigger ids belong to that world.
  const areaFile = opts.areas;
  const areaPath = opts.areaPath || 'content/quests/areas.json';
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value);
  const validAreaFile = plain(areaFile) && areaFile.version === 1 && plain(areaFile.areas)
    && Object.keys(areaFile).every(key => ['version', 'areas'].includes(key));
  if (areaFile !== undefined && areaFile !== null) check(validAreaFile, areaPath, 'expected version 1 and an areas object');
  const areas = validAreaFile ? areaFile.areas : {};
  for (const [id, target] of Object.entries(areas)) {
    const path = `${areaPath}.areas.${id}`;
    check(safeId(id), path, 'invalid semantic area id');
    const markerTarget = plain(target) && safeId(target.world) && safeId(target.structure) && safeId(target.marker)
      && Object.keys(target).length === 3;
    const triggerTarget = plain(target) && safeId(target.world) && safeId(target.trigger)
      && Object.keys(target).length === 2;
    check(markerTarget || triggerTarget, path, 'expected {world,structure,marker} or {world,trigger}');
    if (!markerTarget && !triggerTarget) continue;
    const world = Object.hasOwn(worlds, target.world) ? worlds[target.world] : null;
    check(!!world, `${path}.world`, `world "${target.world}" not found`);
    if (!world) continue;
    if (triggerTarget) {
      const matches = (world.triggers || []).filter(trigger => trigger.id === target.trigger);
      check(matches.length === 1, `${path}.trigger`, `trigger "${target.trigger}" must resolve exactly once in world "${target.world}"`);
    } else {
      const matches = (world.structures || []).filter(structure => structure.id === target.structure);
      check(matches.length === 1, `${path}.structure`, `structure "${target.structure}" must resolve exactly once in world "${target.world}"`);
      if (matches.length !== 1) continue;
      const level = Object.hasOwn(levels, matches[0].level) ? levels[matches[0].level] : null;
      check(!!level, `${path}.structure`, 'target must be a placed level');
      const marker = level?.markers && Object.hasOwn(level.markers, target.marker) ? level.markers[target.marker] : null;
      check(!!marker && Number.isFinite(marker.x) && Number.isFinite(marker.y) && Number.isFinite(marker.z),
        `${path}.marker`, `point marker "${target.marker}" not found or lacks finite x/y/z`);
    }
  }
  const questIds = new Set();
  for (const { path, def } of quests) {
    check(!questIds.has(def?.id), `${path}.id`, `duplicate quest id "${def?.id}"`);
    questIds.add(def?.id);
    try { validateQuestDefinition(def); check(true, path, ''); }
    catch (e) { check(false, path, e.message); continue; }
    // QUEST-REWARD-AUDIT (D-106): every quest pays something at hand-in (items / coin / heart piece), except the allow-listed ones.
    { const r = def.reward, paid = !!r && ((r.items && r.items.length) || r.coin || r.heartPiece);
      check(paid || Object.hasOwn(NO_REWARD_OK, def.id), `${path}.reward`, `quest "${def.id}" rewards nothing (D-106: add a reward, or allow-list it in NO_REWARD_OK with a reason)`); }
    for (const objective of def.objectives) {
      const base = `${path}.objectives[${objective.id}]`;
      inlineText(objective.text, `${base}.text`);
      if (objective.journal !== undefined) { inlineText(objective.journal, `${base}.journal`); check(objective.journal.length <= 240, `${base}.journal`, 'journal over 240 chars'); } // OB-097
      if (typeof objective.text === 'string') check(objective.text.length <= MAX_OBJECTIVE_TEXT, `${base}.text`, `objective text is ${objective.text.length} chars, expected <= ${MAX_OBJECTIVE_TEXT}`);
      if (objective.when.type === 'area') {
        check(Object.hasOwn(areas, objective.when.id), `${base}.when.id`, `area "${objective.when.id}" not found in ${areaPath}`);
      }
      if (objective.when.type === 'collect' || objective.when.type === 'deliver') { // QUESTS-01
        check(itemIds.has(objective.when.id), `${base}.when.id`, `item "${objective.when.id}" not found in item defs`);
        const placed = Object.values(worlds).reduce((n, w) => n + (w.entities || []).filter(e => e.components?.questPickup?.item === objective.when.id).reduce((m, e) => m + (e.components.questPickup.n || 1), 0), 0);
        check(objective.when.type === 'deliver' || placed >= objective.when.count, `${base}.when.count`, `needs ${objective.when.count} "${objective.when.id}" but only ${placed} placed as questPickup world entities`);
      }
      if (objective.when.type === 'item') {
        check(itemIds.has(objective.when.id), `${base}.when.id`, `item "${objective.when.id}" not found in item defs or level pickups`);
      }
      if (objective.when.type === 'beasts') {
        for (const id of objective.when.ids || []) check(beastIds.has(id), `${base}.when.ids`, `beast "${id}" not found in world entities`);
      }
    }
    // QL-02: giver / hand-in ids resolve to a world entity or a level prop; rewards are item ids.
    const actorIds = new Set();
    for (const w of Object.values(worlds)) for (const e of w.entities || []) actorIds.add(e.id);
    for (const lv of Object.values(levels)) for (const pr of lv?.props || []) actorIds.add(pr.id);
    for (const key of ['npc', 'turnIn']) if (def.giver?.[key] !== undefined) check(actorIds.has(def.giver[key]), `${path}.giver.${key}`, `"${def.giver[key]}" is no world entity or level prop`);
    for (const objective of def.objectives) if (objective.when?.type === 'deliver') check(actorIds.has(objective.when.to), `${path}.objectives[${objective.id}].when.to`, `hand-in "${objective.when.to}" is no world entity or level prop`);
    for (const [i, r] of (def.reward?.items || []).entries()) check(itemIds.has(r.id), `${path}.reward.items[${i}].id`, `reward item "${r.id}" not found in item defs`);
    // EQ-13: given / required items exist; requireEquipped names wearable gear (equip slot) or held items.
    for (const key of ['giveOnAccept', 'giveOnTalk']) for (const [i, r] of (def[key] || []).entries()) check(itemIds.has(r.id), `${path}.${key}[${i}].id`, `item "${r.id}" not found in item defs`);
    if (def.requireItem !== undefined) check(itemIds.has(def.requireItem), `${path}.requireItem`, `item "${def.requireItem}" not found in item defs`);
    for (const id of def.requireEquipped || []) check(itemIds.has(id) && !!itemDefs[id]?.equip, `${path}.requireEquipped`, `"${id}" is no equippable item`);
  }
  // QL-02: requires point at known quests/steps and form no cycle.
  const byQuestId = new Map(quests.map(q => [q.def?.id, q]));
  const reqEdges = new Map();
  for (const { path, def } of quests) {
    reqEdges.set(def?.id, []);
    for (const r of def?.requires || []) {
      if (!r || r.quest === undefined) continue; // flag-only requires ({flag}) have no quest edge
      const target = byQuestId.get(r.quest);
      check(!!target, `${path}.requires`, `required quest "${r.quest}" not found`);
      if (!target) continue;
      if (r.step !== undefined) check((target.def.objectives || []).some(o => o.id === r.step), `${path}.requires`, `quest "${r.quest}" has no step "${r.step}"`);
      reqEdges.get(def.id).push(r.quest);
    }
  }
  const visiting = new Set(), visited = new Set();
  const hasCycle = (id) => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const n of reqEdges.get(id) || []) if (hasCycle(n)) return true; visiting.delete(id); visited.add(id); return false; };
  for (const id of reqEdges.keys()) check(!hasCycle(id), `quests.${id}.requires`, 'requires chain has a cycle');
  // QL-T2 (38.44 item 10): giver sites exist and are placed, every quest is reachable from the start, gate key given once by the last main quest.
  if (quests.length) {
    const actors = new Set();
    for (const w of Object.values(worlds)) for (const e of w.entities || []) actors.add(e.id);
    for (const lv of Object.values(levels)) for (const pr of lv?.props || []) actors.add(pr.id);
    if (opts.sites) for (const { path, def } of quests) {
      if (def?.site === undefined) continue;
      const s = Object.hasOwn(opts.sites, def.site) ? opts.sites[def.site] : null;
      check(!!s, `${path}.site`, `site "${def.site}" not found in sites.json`);
      if (s) check(actors.has(s.entity), `${path}.site`, `site "${def.site}" entity "${s.entity}" is not placed in world data`);
    }
    // reachability: a quest opens once every quest it requires is reachable (flag-only requires count as satisfiable)
    const reach = new Set();
    for (let grew = true; grew;) {
      grew = false;
      for (const { def } of quests) {
        if (!def || reach.has(def.id)) continue;
        if ((def.requires || []).every(r => r.quest === undefined || reach.has(r.quest))) { reach.add(def.id); grew = true; }
      }
    }
    for (const { path, def } of quests) if (def) check(reach.has(def.id), `${path}.requires`, `quest "${def.id}" is not reachable from the start (cycle or missing prerequisite)`);
    const GATE = 'key.gate';
    const givers = quests.filter(q => (q.def?.reward?.items || []).some(r => r.id === GATE));
    if (!givers.length) infos.push('gate key not assigned yet');
    else {
      const total = givers.reduce((n, g) => n + g.def.reward.items.filter(r => r.id === GATE).reduce((m, r) => m + r.n, 0), 0);
      check(total === 1, 'quests.key.gate', `"${GATE}" must be given exactly once (given ${total}x by ${givers.map(g => g.def.id).join(', ')})`);
      const needs = new Set(); // main quests another main quest requires are not the last one
      for (const q of quests) if (q.def?.main === true) for (const r of q.def.requires || []) if (r.quest !== undefined && r.quest !== q.def.id) needs.add(r.quest);
      const last = quests.filter(q => q.def?.main === true && !needs.has(q.def.id)).map(q => q.def.id);
      for (const g of givers) check(g.def.main === true && last.includes(g.def.id), `${g.path}.reward`, `"${GATE}" must be given by the last main quest (last: ${last.join(', ') || 'none'})`);
    }
  }

  // RECIPES-01: share the actual crafting schema, with path-specific ref findings.
  const recipeFile = opts.recipeFile;
  const recipePath = opts.recipePath || 'content/items/recipes.json';
  if (recipeFile !== undefined && recipeFile !== null) {
    const validFile = plain(recipeFile) && recipeFile.version === 1 && Array.isArray(recipeFile.recipes)
      && Object.keys(recipeFile).every(key => ['version', 'recipes'].includes(key));
    check(validFile, recipePath, 'expected version 1 and a recipes array');
    if (validFile) {
      for (const [i, recipe] of recipeFile.recipes.entries()) {
        const base = `${recipePath}.recipes[${recipe?.id ?? i}]`;
        const refs = Array.isArray(recipe?.inputs) ? recipe.inputs.map((row, n) => [row, `${base}.inputs[${n}]`]) : [];
        refs.push([recipe?.output, `${base}.output`]);
        for (const [row, path] of refs) {
          const def = row && Object.hasOwn(itemDefs, row.item) ? itemDefs[row.item] : null;
          check(!!def, `${path}.item`, `item "${row?.item}" not found in inventory defs`);
          if (def) check(def.inPack === true && Number.isSafeInteger(def.stackMax) && def.stackMax > 0 && def.pending !== 'owner',
            `${path}.item`, `item "${row.item}" must be a usable pack item, not pending owner approval`);
        }
      }
      try { createCrafting(recipeFile.recipes, { items: itemDefs }); check(true, recipePath, ''); }
      catch (e) { check(false, recipePath, e.message); }
    }
  }

  // EQ-11: gear loot tables (content/items/loot.json, data-only like recipes.json)
  const lootFile = opts.lootFile;
  const lootPath = opts.lootPath || 'content/items/loot.json';
  if (lootFile !== undefined && lootFile !== null) {
    const chance01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
    const slots = Array.isArray(lootFile.slots) ? lootFile.slots : [];
    const tiers = plain(lootFile.tiers) ? lootFile.tiers : {};
    check(lootFile.version === 1 && plain(lootFile.sources), lootPath, 'expected version 1 and a sources object');
    check(slots.length > 0, `${lootPath}.slots`, 'needs at least one slot');
    const tierSum = Object.values(tiers).reduce((a, b) => a + (typeof b === 'number' ? b : NaN), 0);
    check(Object.keys(tiers).length > 0 && Object.values(tiers).every(chance01) && Math.abs(tierSum - 1) < 1e-9, `${lootPath}.tiers`, `tier odds must be in 0..1 and sum to 1, got ${tierSum}`);
    const gearIds = (slot, tier) => Object.values(itemDefs).filter(d => d?.equip?.slot === slot && d.equip.tier === tier && d.kind === 'gear').map(d => d.id);
    for (const slot of slots) for (const tier of Object.keys(tiers)) {
      check(gearIds(slot, tier).length > 0, `${lootPath}.slots`, `no gear item for slot "${slot}" tier "${tier}"`);
    }
    const checkGive = (g, path) => {
      check(Object.hasOwn(itemDefs, g?.item), `${path}.item`, `item "${g?.item}" not found`);
      check(Number.isInteger(g?.min) && Number.isInteger(g?.max) && g.min >= 1 && g.max >= g.min, `${path}`, 'min/max must be integers, 1 <= min <= max');
    };
    for (const [src, table] of Object.entries(lootFile.sources || {})) {
      for (const [i, roll] of (table?.rolls || []).entries()) {
        const path = `${lootPath}.sources.${src}.rolls[${i}]`;
        check(chance01(roll?.chance), `${path}.chance`, `chance must be a number in 0..1, got ${roll?.chance}`);
        check(!!roll?.pick !== !!roll?.give, path, 'a roll needs exactly one of pick / give');
        if (roll?.give) checkGive(roll.give, `${path}.give`);
      }
      for (const [i, f] of (table?.fixed || []).entries()) {
        check(Object.hasOwn(itemDefs, f?.item) && Number.isInteger(f?.n) && f.n >= 1, `${lootPath}.sources.${src}.fixed[${i}]`, `fixed entry needs a known item and n >= 1`);
      }
    }
  }

  // ---- 6. CO-8 (docs/coordinates.md section 8): coordinate/frame content rules ----
  // World structures: origin.x/y/z finite, yawSteps an integer 0..3.
  for (const worldKey of Object.keys(worlds)) {
    const world = worlds[worldKey];
    if (!world || typeof world !== 'object') continue;
    const base = `worlds.${worldKey}`;
    for (const s of world.structures || []) {
      const path = `${base}.structures[${s.id}]`;
      const hasMesh = typeof s.mesh === 'string' && s.mesh.length > 0;
      const hasLevel = typeof s.level === 'string' && s.level.length > 0;
      check(hasMesh !== hasLevel && !(s.mesh !== undefined && s.level !== undefined), path, 'exactly one of mesh or level is required');
      if (hasMesh) check(Object.hasOwn(meshes, s.mesh), `${path}.mesh`, `mesh "${s.mesh}" not found`);
      if (hasLevel) check(Object.hasOwn(levels, s.level), `${path}.level`, `level "${s.level}" not found`);
      if (hasLevel && Object.hasOwn(levels, s.level)) for (const e of validateUnderSite(levels[s.level], s)) check(false, `${path}.level`, `UNDER-00c: ${e}`);
      if (s.yawDeg !== undefined) {
        check(hasMesh && Number.isFinite(s.yawDeg), `${path}.yawDeg`, 'finite yawDeg is allowed only for mesh placements');
        check(s.yawSteps === undefined || s.yawSteps === 0, `${path}.yawSteps`, 'cannot combine mesh yawDeg with nonzero yawSteps');
      }

      // NAV-LAYERS-01d (arch 38.71): `nav: "floors"` bakes nav sheets from the placement; only for mesh placements that collide (a walk-through mesh has no floor to probe)
      if (s.nav !== undefined) check(s.nav === 'floors' && hasMesh && s.collide !== false, `${path}.nav`, `nav must be "floors" on a mesh placement with colliders (collide != false), got ${JSON.stringify(s.nav)}`);
      if (s.navGroup !== undefined) check(typeof s.navGroup === 'string' && s.navGroup.length > 0 && s.nav === 'floors', `${path}.navGroup`, 'navGroup must be a non-empty string and needs nav: "floors"');
      if (s.scale !== undefined) check(hasMesh && Number.isFinite(s.scale) && s.scale >= 0.25 && s.scale <= 4, `${path}.scale`, `MESH-SCALE-01: scale is a mesh-placement number in [0.25, 4], got ${JSON.stringify(s.scale)}`);
      if (s.origin) {
        check(Number.isFinite(s.origin.x), `${path}.origin.x`, `origin.x must be finite, got ${JSON.stringify(s.origin.x)}`);
        check(Number.isFinite(s.origin.y), `${path}.origin.y`, `origin.y must be finite, got ${JSON.stringify(s.origin.y)}`);
        check(Number.isFinite(s.origin.z), `${path}.origin.z`, `origin.z must be finite, got ${JSON.stringify(s.origin.z)}`);
      }
      if (s.yawSteps !== undefined) {
        check(Number.isInteger(s.yawSteps) && s.yawSteps >= 0 && s.yawSteps <= 3, `${path}.yawSteps`, `yawSteps must be an integer 0..3, got ${JSON.stringify(s.yawSteps)}`);
      }
    }
    // World entities: z is a number or 'ground'.
    for (const e of world.entities || []) {
      if (e.z === undefined) continue;
      check(typeof e.z === 'number' || e.z === 'ground', `${base}.entities[${e.id}].z`, `z must be a number or "ground", got ${JSON.stringify(e.z)}`);
    }
    // A world with terrain (a real gameplay world) is the sun's home now
    // (CO-8 moved it out of the level file) - missing it here is worth
    // flagging even though `sun` stays optional (schema 1, additive).
    if (world.terrain && !world.sun) {
      warn(`${base}.sun`, 'world has terrain but no "sun" - since CO-8, sun lives on the world file (docs/coordinates.md section 8), not the level file');
    }
  }

  // Level: `sun` is deprecated (moved to the world file); props' z is a
  // number or 'ground'; props/lights/interactables x,y stay inside the
  // level's own [0,w) x [0,h) footprint (a level-local coordinate outside
  // its own grid is very likely a mistake - do-not list item 6 territory).
  for (const levelKey of Object.keys(levels)) {
    const level = levels[levelKey];
    if (!level || typeof level !== 'object') continue;
    const base = `levels.${levelKey}`;
    if (level.sun) {
      warn(`${base}.sun`, '"sun" on a level file is deprecated (CO-8): it is a world property now - move it to the world file');
    }
    for (const p of level.props || []) {
      if (p.z === undefined) continue;
      check(typeof p.z === 'number' || p.z === 'ground', `${base}.props[${p.id}].z`, `z must be a number or "ground", got ${JSON.stringify(p.z)}`);
    }
    if (level.size && typeof level.size.w === 'number' && typeof level.size.h === 'number') {
      const w = level.size.w, h = level.size.h;
      const items = [
        ...(level.props || []).map((item) => ({ kind: 'props', item })),
        ...(level.lights || []).map((item) => ({ kind: 'lights', item })),
        ...(level.interactables || []).map((item) => ({ kind: 'interactables', item })),
      ];
      for (const { kind, item } of items) {
        // A chain prop (from/to) or a decal has no x/y of its own - skip.
        if (typeof item.x !== 'number' || typeof item.y !== 'number') continue;
        check(
          item.x >= 0 && item.x < w && item.y >= 0 && item.y < h,
          `${base}.${kind}[${item.id}]`,
          `x/y (${item.x}, ${item.y}) out of level bounds [0,${w}) x [0,${h})`
        );
      }
    }
  }

  let maskIds = null;
  if (opts.maskFilesDir) {
    const scannedMasks = validateMaskFiles(opts.maskFilesDir);
    errors.push(...scannedMasks.errors);
    checks += scannedMasks.checks;
    maskIds = scannedMasks.ids;
  }
  if (opts.meshFilesDir) {
    const scanned = validateMeshFiles(opts.meshFilesDir, maskIds);
    errors.push(...scanned.errors);
    checks += scanned.checks;
  }
  if (opts.dialogueFilesDir) {
    const dl = validateDialogueFiles(opts.dialogueFilesDir, models, opts.quests ? opts.quests.filter(q => q.def && q.def.giver).map(q => q.def.id) : null);
    errors.push(...dl.errors);
    warnings.push(...dl.warnings);
    checks += dl.checks;
  }
  if (opts.spellLint && opts.quests && opts.quests.length) { // SPELL-09 (real content only: the CLI sets spellLint) AC1: every placed spell has exactly one learn source; no stray / unknown Spell Book
    const rewards = new Map();
    for (const q of opts.quests) { const d = q.def && normalizeQuestDef(q.def); const its = d && d.reward && d.reward.items; if (its) rewards.set(d.id, its.map((i) => i.id)); }
    for (const m of lintSpellPlacements(CHEST_TABLES, rewards, itemDefs)) fail('spellBooks', m);
    checks++;
  }
  return { errors, warnings, infos, checks, meshOnlyCount };
}

// DIALOGUE-01a2 (38.28): content/dialogue/*.dialogue.json - engine rules via validateDialogue, plus the one
// cross-file check: every node `clip` (and the runtime `talk`/`listen` clips) exists on the NPC model named by
// the file's optional top-level `model`. A model that is not registered (yet) is a warning, not an error.
const DIALOGUE_RUNTIME_CLIPS = ['talk', 'listen'];
const BARK_LINE_MAX = 56; // = engine DIALOGUE_LINE_MAX (not exported)
const S_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/; // same shape as a quest id
const Q_OPS = ['available', 'active', 'ready', 'done', 'accept', 'handin'];
// QG-03 (38.35 item 5): `q.<questId>.<op>` flag keys (requires / setFlag) must name a giver quest (giverIds, null = not checked) and a known op.
function checkQuestKeys(def, giverIds, file, errors) {
  const keys = [];
  for (const e of def.entry || []) if (e && typeof e.requires === 'string') keys.push(e.requires);
  for (const n of Object.values(def.nodes || {})) {
    if (n && typeof n.setFlag === 'string') keys.push(n.setFlag);
    for (const c of (n && n.choices) || []) if (c && typeof c.setFlag === 'string') keys.push(c.setFlag);
  }
  let checks = 0;
  for (const k of keys) {
    if (k.startsWith('s.')) { // CH1-05: `s.<key>` = world.state flag; the rest must look like a quest id / state key
      checks++;
      if (!S_KEY_RE.test(k.slice(2))) errors.push(`${file}: flag "${k}" has a bad state key "${k.slice(2)}"`);
      continue;
    }
    if (!k.startsWith('q.')) continue;
    if (!giverIds) continue;
    checks++;
    const dot = k.lastIndexOf('.'), id = k.slice(2, dot), op = k.slice(dot + 1);
    if (!giverIds.includes(id)) errors.push(`${file}: flag "${k}" names no giver quest "${id}"`);
    else if (!Q_OPS.includes(op)) errors.push(`${file}: flag "${k}" has unknown quest op "${op}"`);
  }
  return checks;
}
/** CH1-05: {kind:'barks', speakers:{k:{label,player?}}, barks:{id:[{who,text}]}}; text <= 56 ASCII chars. */
export function validateBarks(def) {
  const errors = []; let checks = 0;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(def) || def.kind !== 'barks') return { errors: ['kind: expected "barks"'], checks };
  const sp = isObj(def.speakers) ? def.speakers : null;
  if (!sp) errors.push('speakers: expected an object');
  else for (const [k, s] of Object.entries(sp)) if (!isObj(s) || typeof s.label !== 'string' || !s.label) errors.push(`speakers.${k}: needs a non-empty label`);
  if (!isObj(def.barks) || !Object.keys(def.barks).length) { errors.push('barks: expected a non-empty object'); return { errors, checks }; }
  for (const [id, lines] of Object.entries(def.barks)) {
    checks++;
    if (!S_KEY_RE.test(id)) errors.push(`barks.${id}: bad bark id`);
    if (!Array.isArray(lines) || !lines.length) { errors.push(`barks.${id}: expected a non-empty array`); continue; }
    lines.forEach((l, i) => {
      const p = `barks.${id}[${i}]`;
      if (!isObj(l)) { errors.push(`${p}: expected {who, text}`); return; }
      if (!sp || typeof l.who !== 'string' || !Object.prototype.hasOwnProperty.call(sp, l.who)) errors.push(`${p}.who: unknown speaker ${JSON.stringify(l.who)}`);
      if (typeof l.text !== 'string' || !l.text) errors.push(`${p}.text: expected a non-empty string`);
      else {
        if (l.text.length > BARK_LINE_MAX) errors.push(`${p}.text: ${l.text.length} chars, max ${BARK_LINE_MAX}`);
        if (!/^[ -~]*$/.test(l.text)) errors.push(`${p}.text: char outside ASCII 32-126`);
      }
    });
  }
  return { errors, checks };
}
export function validateDialogueFiles(dir, models = {}, giverIds = null) {
  const errors = [], warnings = [];
  let checks = 0;
  const files = [], barkFiles = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) { if (e && e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const full = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.dialogue.json')) files.push(full);
      else if (entry.name.endsWith('.barks.json')) barkFiles.push(full);
    }
  };
  walk(dir);
  for (const full of barkFiles) { // CH1-05: `barks` content kind (read by game/js/quest/barks.js, not in the manifest)
    checks++;
    let def;
    try { def = JSON.parse(readFileSync(full, 'utf8')); } catch (e) { errors.push(`${full}: JSON parse failed: ${e.message}`); continue; }
    const r = validateBarks(def);
    for (const m of r.errors) errors.push(`${full}: ${m}`);
    checks += r.checks;
  }
  for (const full of files) {
    checks++;
    let def;
    try { def = JSON.parse(readFileSync(full, 'utf8')); } catch (e) { errors.push(`${full}: JSON parse failed: ${e.message}`); continue; }
    const r = validateDialogue(def);
    for (const m of r.errors) errors.push(`${full}: ${m}`);
    for (const m of r.warnings) warnings.push(`${full}: ${m}`);
    checks += checkQuestKeys(def, giverIds, full, errors);
    if (def.model === undefined) continue;
    checks++;
    const model = typeof def.model === 'string' ? models[def.model] : null;
    if (!model) { warnings.push(`${full}: model "${def.model}" is not registered, clips not checked`); continue; }
    const used = new Set(DIALOGUE_RUNTIME_CLIPS);
    for (const n of Object.values(def.nodes || {})) if (n && typeof n.clip === 'string') used.add(n.clip);
    for (const c of used) {
      checks++;
      if (!hasClip(model, c)) errors.push(`${full}: clip "${c}" not found on model "${def.model}"`);
    }
  }
  return { errors, warnings, checks };
}

function validateVoxelModelSafe(def, opts) {
  try {
    return validateVoxelModel(def, opts);
  } catch (e) {
    return { errors: [`threw: ${e && e.message ? e.message : e}`], warnings: [] };
  }
}

// ---------------------------------------------------------------------------
// ME-13b: content/meshes/*.mesh.json schema sanity. This is a standalone
// filesystem geometry check, also available through validateContent's
// optional meshFilesDir. Registered assets receive material checks above.
function findMeshFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return; // no content/meshes/ yet - nothing to check
    throw e;
  }
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) findMeshFiles(full, out);
    else if (entry.name.endsWith('.mesh.json')) out.push(full);
  }
}

export function validateMeshFiles(dir, maskIds = null) {
  const errors = [];
  let checks = 0;
  const files = [];
  findMeshFiles(dir, files);
  for (const full of files) {
    checks++;
    let obj, binBytes = null;
    try {
      obj = JSON.parse(readFileSync(full, 'utf8'));
      if (typeof obj.bin === 'string') binBytes = readFileSync(new URL(obj.bin, pathToFileURL(resolvePath(full)))); // MESH-BIN-01
    } catch (e) {
      errors.push(`${full}: JSON parse failed: ${e.message}`);
      continue;
    }
    let mesh;
    try {
      mesh = binBytes ? meshFromBin(obj, binBytes) : meshFromJSON(obj);
    } catch (e) {
      errors.push(`${full}: meshFromJSON threw: ${e.message}`);
      continue;
    }
    const { errors: meshErrors } = validateMesh(mesh);
    for (const m of meshErrors) errors.push(`${full}: ${m}`);
    if (maskIds) for (const r of mesh.ranges) if (r.mask && !maskIds.has(r.mask.tex)) errors.push(`${full}: ranges[${r.part}].mask "${r.mask.tex}" has no content/masks file`);
  }
  return { errors, checks };
}

// ALPHA-01a (37.17): content/masks/**/*.mask.json - parse + shape (power-of-two size, data length = w*h) + id equals the path under the directory.
export function validateMaskFiles(dir) {
  const errors = [];
  const ids = new Set();
  let checks = 0;
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch (e) { if (e && e.code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const full = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.mask.json')) files.push(full);
    }
  };
  walk(dir);
  for (const full of files) {
    checks++;
    try {
      const mask = maskFromJSON(JSON.parse(readFileSync(full, 'utf8')));
      const want = full.slice(dir.length + 1).replace(/.mask.json$/, '');
      if (mask.id !== want) errors.push(`${full}: id "${mask.id}" does not match the file path (expected "${want}")`);
      ids.add(mask.id);
    } catch (e) { errors.push(`${full}: ${e.message}`); }
  }
  return { errors, checks, ids };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
export function loadQuestFiles(dir) {
  const quests = [], errors = [];
  const areaPath = `${dir}/areas.json`;
  let areas = null;
  if (existsSync(areaPath)) {
    try { areas = JSON.parse(readFileSync(areaPath, 'utf8')); }
    catch (e) { errors.push(`${areaPath}: JSON parse failed: ${e.message}`); }
  }
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.quest.json')) {
        try { quests.push({ path, def: normalizeQuestDef(JSON.parse(readFileSync(path, 'utf8'))) }); }
        catch (e) { errors.push(`${path}: JSON parse failed: ${e.message}`); }
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { quests, errors, areas, areaPath };
}

/** QL-B1: content/quests/index.json packs -> expanded giver defs (sites.json + rewards.json + item defs), validated like plain quest files. */
export async function loadPackQuests(dir, itemDefs = {}) {
  const quests = [], errors = [];
  let sites;
  const read = (f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  let index; try { index = read('index.json'); } catch (e) { return { quests, errors }; }
  if (!Array.isArray(index.packs) || !index.packs.length) return { quests, errors };
  const { expandAll } = await import('../game/js/quest/sim/templates.js');
  try {
    const packs = index.packs.map(p => read(`${p}/pack.json`));
    const items = Object.values(itemDefs).map(d => ({ id: d.id, slot: d.equip?.slot, tier: d.equip?.tier }));
    sites = read('sites.json').sites;
    const ex = expandAll(packs, { sites, rewards: read('rewards.json').tables, items, strictText: true });
    for (const e of ex.errors) errors.push(`pack:${e.region}:${e.id}: ${e.message}`);
    for (const def of ex.defs) quests.push({ path: `pack:${def.id}`, def });
  } catch (e) { errors.push(`content/quests packs: ${e.message}`); }
  return { quests, errors, sites };
}

export function loadRecipeFile(path) {
  try { return { recipeFile: JSON.parse(readFileSync(path, 'utf8')), recipePath: path, errors: [] }; }
  catch (e) { return { recipeFile: null, recipePath: path, errors: [`${path}: recipe JSON read/parse failed: ${e.message}`] }; }
}

export function loadLootFile(path) {
  try { return { lootFile: JSON.parse(readFileSync(path, 'utf8')), lootPath: path, errors: [] }; }
  catch (e) { return { lootFile: null, lootPath: path, errors: [`${path}: loot JSON read/parse failed: ${e.message}`] }; }
}

// WMP-04: region lint (pure, fixture-testable). o = { geo, quests: raw pack.json quests, sites, relayIds: ['ws_glasswater', ...],
// itemIds:Set, beastKinds:Set|null, camps: generated far camps }. Returns one "regions:<where>: problem" line per finding.
export function lintRegions(o) {
  const out = [], quests = o.quests || [], sites = o.sites || {};
  const errandOf = (reg) => quests.find((q) => q.id === 'sq.reg.' + reg);
  // 1. a region relay (ws_<region>) needs an errand sq.reg.<region>
  for (const id of o.relayIds || []) { const reg = id.replace(/^ws_/, ''); if (!errandOf(reg)) out.push(`regions:${reg}: relay ${id} has no errand (sq.reg.${reg})`); }
  // 2. errand targets exist: site, kill kind, deliver item + to-site
  for (const q of quests) {
    if (q.site && !Object.hasOwn(sites, q.site)) out.push(`regions:${q.id}: site '${q.site}' does not exist`);
    for (const st of q.steps || []) {
      const p = st.params || {};
      if (st.template === 'kill' && o.beastKinds && !o.beastKinds.has(p.kind)) out.push(`regions:${q.id}: kill kind '${p.kind}' does not exist`);
      if (st.template === 'deliver') {
        if (p.to && !Object.hasOwn(sites, p.to)) out.push(`regions:${q.id}: deliver-to '${p.to}' does not exist`);
        if (o.itemIds && !o.itemIds.has(p.item)) out.push(`regions:${q.id}: deliver item '${p.item}' does not exist`);
      }
    }
    // 4. region text present
    const texts = [['title', q.title], ['returnText', q.returnText], ...(q.steps || []).flatMap((st, i) => [[`steps[${i}].journal`, st.journal], [`steps[${i}].objText`, st.objText]]), ...[...(q.lines?.offer || []), ...(q.lines?.done || []), ...(q.lines?.accept || []), ...(q.lines?.decline || [])].map((t, i) => [`lines[${i}]`, t])];
    for (const [k, v] of texts) { if (typeof v !== 'string' || !v.trim()) out.push(`regions:${q.id}: ${k} is empty`); else if (/NEEDS WRITER/i.test(v)) out.push(`regions:${q.id}: ${k} still says NEEDS WRITER`); }
    if (!q.lines?.offer?.length) out.push(`regions:${q.id}: lines.offer is empty`);
  }
  // 3. generated far camps lie inside the bounds polygon and their region rect (centre + every member)
  const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > y) !== (pts[j][1] > y) && x < (pts[j][0] - pts[i][0]) * (y - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c; return c; };
  for (const c of o.camps || []) {
    const r = o.geo.regions.find((g) => g.id === c.region)?.r;
    if (!r) { out.push(`regions:${c.id}: region '${c.region}' not in geo`); continue; }
    for (const [tag, x, y] of [['centre', c.at[0], c.at[1]], ...(c.members || []).map((m) => [m.id, c.at[0] + m.at[0], c.at[1] + m.at[1]])]) {
      if (!inPoly(o.geo.bounds.pts, x, y)) out.push(`regions:${c.id}: ${tag} (${x},${y}) is outside the bounds polygon`);
      else if (x < r[0] || x > r[2] || y < r[1] || y > r[3]) out.push(`regions:${c.id}: ${tag} (${x},${y}) is outside region ${c.region}`);
    }
  }
  return out;
}

async function lintRegionsReal(ASSETS, sites) {
  const { RELAY_WAKE } = await import('../game/js/quest/wire/waystone.js');
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('./far-camps-dump.mjs', import.meta.url))], { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  const { camps, bounds, regions } = JSON.parse(out.slice(out.indexOf('@@CAMPS@@') + 9)); // separate process: see far-camps-dump.mjs
  const pack = JSON.parse(readFileSync(new URL('../content/quests/regions/pack.json', import.meta.url), 'utf8'));
  return lintRegions({ geo: { bounds, regions }, quests: pack.quests, sites, relayIds: Object.keys(RELAY_WAKE), itemIds: new Set(Object.keys(ASSETS.items?.defs || {})), beastKinds: new Set(['boar', 'wolf', 'bear']), camps }); // kinds = quest.js kindOf() species
}

// QUEST-TEXT-LINT-01 (R19): player-visible quest + dialogue text. Pure; files = [{ path, json }] (path under content/quests or content/dialogue).
// Visible keys only (ids in id/key/next/requires/setFlag/node fields are fine). Kinds: writer, id, esc, objlen (<= 38), talklen (<= 56).
const R19_VISIBLE = new Set(['title', 'text', 'journal', 'returnText', 'objText', 'nextHint', 'hint', 'hintTitle', 'prompt', 'accept', 'later', 'lines']);
const R19_OBJ_KEYS = new Set(['text', 'objText', 'journal', 'returnText']); // objective / journal lines (quest files)
export const R19_OBJ_MAX = 38, R19_TALK_MAX = 56;
export function lintQuestText(files) {
  const out = [];
  for (const { path, json } of files) {
    const isDialogue = /(^|[\/])dialogue[\/]/.test(path);
    const walk = (v, where, key, visible) => {
      if (typeof v === 'string') {
        if (!visible || !v) return;
        const add = (kind, msg) => out.push({ file: path, where, kind, text: v, msg });
        if (/NEEDS WRITER/i.test(v)) add('writer', 'NEEDS WRITER');
        if (/\b(mq|sq|note|flag|item)\.[a-z]/i.test(v)) add('id', 'raw id in player text');
        if (/\besc\b/i.test(v)) add('esc', 'Esc hint');
        if (!isDialogue && R19_OBJ_KEYS.has(key) && v.length > R19_OBJ_MAX) add('objlen', `${v.length} chars > ${R19_OBJ_MAX}`);
        if (isDialogue && (key === 'text' || key === 'lines') && v.length > R19_TALK_MAX) add('talklen', `${v.length} chars > ${R19_TALK_MAX}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`, key, visible));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, where ? `${where}.${k}` : k, k, visible || R19_VISIBLE.has(k));
    };
    walk(json, '', '', false);
  }
  return out;
}

// Named allow-list of today's hits: "<file>|<kind>" -> max hits. It may only shrink (a larger count fails; so does a stale, too-high entry).
export const R19_ALLOW = { // today's journal-length hits (writer to shorten later; may only shrink)
  'content/quests/burl.boars.quest.json|objlen': 1,
  'content/quests/burl.follow.quest.json|objlen': 1,
  'content/quests/burl.stone.quest.json|objlen': 1,
  'content/quests/ch12/pack.json|objlen': 52,
  'content/quests/ch3/pack.json|objlen': 17,
  'content/quests/ch3b/pack.json|objlen': 6,
  'content/quests/m1.quest.json|objlen': 13,
  'content/quests/mq.bend.call.quest.json|objlen': 2,
  'content/quests/mq.ford.mirror.quest.json|objlen': 2,
  'content/quests/mq.ford.stones.quest.json|objlen': 1,
  'content/quests/mq.river.road.quest.json|objlen': 1,
  'content/quests/mq.smoke.quest.json|objlen': 2,
  'content/quests/regions/pack.json|objlen': 10,
  'content/quests/sq.burl.blue.quest.json|objlen': 2,
  'content/quests/tower.blade.quest.json|objlen': 3,
  'content/quests/under.crypt.quest.json|objlen': 3,
  'content/quests/under.graves.quest.json|objlen': 2,
};
export function applyR19Allow(hits, allow = R19_ALLOW) {
  const errors = [], counts = {};
  for (const h of hits) { const k = `${h.file}|${h.kind}`; counts[k] = (counts[k] || 0) + 1; }
  for (const h of hits) { const k = `${h.file}|${h.kind}`; if (counts[k] > (allow[k] || 0) && !h.reported) { for (const x of hits) if (`${x.file}|${x.kind}` === k) x.reported = true; errors.push(`R19 ${h.file}: ${counts[k]} ${h.kind} hit(s), allowed ${allow[k] || 0}; first: ${h.where} "${h.text.slice(0, 60)}" (${h.msg})`); } }
  for (const [k, n] of Object.entries(allow)) if ((counts[k] || 0) < n) errors.push(`R19 allow-list '${k}' is stale (${counts[k] || 0} < ${n}): lower it`);
  return errors;
}

function readJsonTree(dir, suffix) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (e.name.endsWith(suffix)) { try { out.push({ path: p, json: JSON.parse(readFileSync(p, 'utf8')) }); } catch { /* parse errors reported elsewhere */ } } } };
  if (existsSync(dir)) walk(dir);
  return out;
}

async function main() {
  const ASSETS = await loadDesignAssets();
  const meshFilesDir = fileURLToPath(new URL('../content/meshes', import.meta.url));
  const maskFilesDir = fileURLToPath(new URL('../content/masks', import.meta.url));
  const dialogueFilesDir = fileURLToPath(new URL('../content/dialogue', import.meta.url));
  const questFiles = loadQuestFiles(fileURLToPath(new URL('../content/quests', import.meta.url)));
  const recipeFile = loadRecipeFile(fileURLToPath(new URL('../content/items/recipes.json', import.meta.url)));
  const lootFile = loadLootFile(fileURLToPath(new URL('../content/items/loot.json', import.meta.url)));
  const packQuests = await loadPackQuests(fileURLToPath(new URL('../content/quests', import.meta.url)), ASSETS?.items?.defs);
  questFiles.quests.push(...packQuests.quests); questFiles.errors.push(...packQuests.errors);
  const { errors: allErrors, warnings, infos, checks: allChecks, meshOnlyCount } = validateContent(ASSETS, { meshFilesDir, maskFilesDir, dialogueFilesDir, sites: packQuests.sites, quests: questFiles.quests, spellLint: true, areas: questFiles.areas, areaPath: questFiles.areaPath, ...recipeFile, ...lootFile });
  allErrors.push(...questFiles.errors);
  for (const h of await (await import('./quest-graph-lint.mjs')).lintRealContent({ quests: questFiles.quests, itemDefs: ASSETS?.items?.defs || {} })) allErrors.push(`${h.rule} ${h.quest}: ${h.msg}`); // QL-MAIN-04
  try { // GI-PROBE-02b: baked GI probe files are optional; missing / stale = warning only (GI stays off in that zone)
    const gi = await import('./bake-gi.mjs'), def = JSON.parse(readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
    for (const r of gi.checkGIDir(fileURLToPath(new URL('../content/gi', import.meta.url)), gi.zonesOf(def), gi.inputHash())) if (r.status !== 'ok') warnings.push(`content/gi/${r.id}.gi.bin: ${r.status} GI file (run node tools/bake-gi.mjs; GI stays off in this zone)`);
    const mf = fileURLToPath(new URL('../content/gi/manifest.json', import.meta.url)); // GI-PROBE-07: manifest vs current inputs
    if (existsSync(mf)) { const cur = gi.inputHash(), m = JSON.parse(readFileSync(mf, 'utf8')); for (const [id, h] of Object.entries(m)) if (h !== cur) warnings.push(`content/gi/manifest.json: zone ${id} is stale (inputs changed; run node tools/bake-gi.mjs, GI is ignored at runtime)`); }
  } catch (e) { warnings.push(`content/gi: GI check skipped (${e.message})`); }
  allErrors.push(...lootFile.errors);
  allErrors.push(...recipeFile.errors);
  // ED-AI-01: content/beasts archetypes + kinds (plain-language range errors, tools/editor/ai/validate.js)
  try {
    const bd = fileURLToPath(new URL('../content/beasts', import.meta.url));
    const { validateBeasts, lintBeastModels } = await import('./editor/ai/validate.js');
    allErrors.push(...lintBeastModels(JSON.parse(readFileSync(`${bd}/kinds.json`, 'utf8')), new Set(Object.keys(ASSETS.models || {}))).map((m) => `beasts: ${m}`)); // VISQA-25
    allErrors.push(...validateBeasts(JSON.parse(readFileSync(`${bd}/archetypes.json`, 'utf8')), JSON.parse(readFileSync(`${bd}/kinds.json`, 'utf8'))).map((m) => `beasts: ${m}`));
    // ED-AI-04: painted spawn areas (empty list shipped)
    const { validateSpawnAreas } = await import('./editor/ai/spawnAreas.js');
    allErrors.push(...validateSpawnAreas(JSON.parse(readFileSync(`${bd}/spawnAreas.json`, 'utf8')), JSON.parse(readFileSync(`${bd}/kinds.json`, 'utf8'))).map((m) => `spawn areas: ${m}`));
  } catch (e) { allErrors.push(`beasts: could not validate content/beasts: ${e.message}`); }
  try { allErrors.push(...await lintRegionsReal(ASSETS, packQuests.sites || {})); } catch (e) { allErrors.push(`regions: lint crashed: ${e.message}`); }
  { // QUEST-TEXT-LINT-01 R19
    const root = fileURLToPath(new URL('..', import.meta.url)).split(String.fromCharCode(92)).join('/').replace(/[/]$/, '');
    const rel = (f) => ({ ...f, path: f.path.split(String.fromCharCode(92)).join('/').replace(root + '/', '') });
    const hits = lintQuestText([...readJsonTree(fileURLToPath(new URL('../content/quests', import.meta.url)), '.json'), ...readJsonTree(dialogueFilesDir, '.json')].map(rel));
    const by = {}; for (const h of hits) by[h.kind] = (by[h.kind] || 0) + 1;
    infos.push(`R19 quest/dialogue text: ${hits.length} hit(s) ${JSON.stringify(by)}; allow-list ${JSON.stringify(R19_ALLOW)}`);
    allErrors.push(...applyR19Allow(hits));
  }
  for (const w of warnings) console.warn(`WARN ${w}`);
  // CONTENT-LINT-01: `--lint` also runs tools/content-lint.mjs; its findings are printed as INFO/WARN and never fail validate-content
  if (process.argv.includes('--lint')) {
    // child process: content-lint loads its own world/assets and would collide with this process's registered globals
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('./content-lint.mjs', import.meta.url))], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const lines = (r.stdout || '').split(/\r?\n/).filter((l) => /^R\d+ /.test(l));
    for (const l of lines) console.warn(`LINT ${l}`);
    console.log(`INFO content-lint: ${lines.length} finding(s) (advisory here; run node tools/content-lint.mjs for the exit code)`);
    if (r.status === null || (r.status !== 0 && r.status !== 1)) console.warn(`WARN content-lint crashed: ${(r.stderr || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ')}`);
  }
  for (const i of infos) console.log(`INFO ${i}`);
  const meshOnlyText = meshOnlyCount ? `, ${meshOnlyCount} mesh-only model(s)` : '';
  if (allErrors.length) {
    for (const e of allErrors) console.error(e);
    console.error(`content INVALID: ${allErrors.length} finding(s) out of ${allChecks} checks${meshOnlyText}`);
    process.exitCode = 1;
  } else {
    console.log(`content OK (${allChecks} checks${warnings.length ? `, ${warnings.length} warning(s)` : ''}${meshOnlyText})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
