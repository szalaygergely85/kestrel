// tools/editor/panel.js - US-033 (docs/architecture.md 24.9). Place defaults
// + validation are plain, DOM-free functions (Node-tested, panel.test.mjs);
// the property-form builder at the bottom is the only DOM-touching part
// (browser only, no test - same split as pick.js/select.js).
//
// Imports only engine/index.js + doc.js/commands.js (the editor boundary rule).
import { selectionItemData } from './doc.js';
import { listBehaviours, PROP_SCALE_MIN, PROP_SCALE_MAX } from '../../engine/index.js';
import { clampScale } from './scale.js';

/** Place keys (24.9): `1` prop, `2` light, `3` trigger, `4` interactable. */
export const PLACE_KEYS = { Digit1: 'prop', Digit2: 'light', Digit3: 'trigger', Digit4: 'interactable' };

/** US-066 glyph icons (design/editor-ui.md 4, no icon font): one per `kindForSelection` kind, reused by the scene tree and the inspector header. */
export const KIND_GLYPHS = { prop: '♣', light: '☼', trigger: '◇', interactable: '¤', entity: '▦' };

/** Id format (24.9): starts with a letter, then letters/digits/`_`/`-`. */
export const ID_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function isValidId(id) {
  return typeof id === 'string' && ID_REGEX.test(id);
}

/** `palette.lights` preset names minus `ambient`/`sun` (24.9's preset picker/validator). */
export function lightPresetNames(palette) {
  const lights = (palette && palette.lights) || {};
  return Object.keys(lights).filter((k) => k !== 'ambient' && k !== 'sun');
}

/** Every `lights[]` item across every level file in `doc` (24.9's `MAX_LIGHTS` refusal). */
export function countLights(doc) {
  let n = 0;
  for (const file of doc.files.values()) {
    if (file.kind === 'level') n += (file.def.lights || []).length;
  }
  return n;
}

/**
 * Behaviour names to suggest in the interact/trigger field's autocomplete
 * (24.9). US-069 (24.12 item 5) swapped the old pure-content-scan workaround
 * for the real `listBehaviours()` API, but keeps the SAME filtering the
 * workaround had: only names actually used somewhere in `doc`'s content, not
 * every behaviour the game happens to have registered (a huge, mostly
 * irrelevant list once real quest behaviours are registered). `main.js`
 * registers a no-op for exactly the names the loaded world's content
 * references (`validateBehaviours`, right after `World.load`) before this is
 * ever called, so in the real editor `listBehaviours()` already IS that same
 * "used in content" set; scanning `doc` here as well is what keeps this
 * function correct (and Node-testable without a registry) even when that
 * isn't true yet, e.g. a name just typed into a field before its next
 * rebuild re-registers it.
 * @returns {string[]} sorted, de-duplicated
 */
export function harvestBehaviourNames(doc) {
  const used = new Set();
  for (const file of doc.files.values()) {
    for (const it of file.def.interactables || []) {
      if (typeof it.interact === 'string' && it.interact) used.add(it.interact);
    }
    for (const tr of file.def.triggers || []) {
      if (typeof tr.trigger === 'string' && tr.trigger) used.add(tr.trigger);
    }
  }
  const registered = listBehaviours();
  // No registry yet (e.g. an isolated Node test) - fall back to the raw
  // content scan so "used in content" is still the answer.
  if (registered.length === 0) return [...used].sort();
  return registered.filter((n) => used.has(n)).sort();
}

/**
 * Default field values for a freshly placed item (24.9), at `pos` (already
 * in the target file's own coordinate space - local metres for a level file,
 * world metres for the world file; `main.js` converts before calling this).
 * @param {'prop'|'light'|'trigger'|'interactable'} kind
 * @param {string} id
 * @param {{x:number,y:number,z:number}} pos
 * @param {{modelKey?:string}} [opts]
 */
export function defaultItemForKind(kind, id, pos, opts = {}) {
  switch (kind) {
    case 'prop':
      return { id, model: opts.modelKey || '', x: pos.x, y: pos.y, z: pos.z, facing: 0 };
    case 'light':
      return { id, preset: 'torch', x: pos.x, y: pos.y, z: pos.z + 1.2, on: true };
    case 'trigger':
      return { id, type: 'zone', shape: 'circle', x: pos.x, y: pos.y, r: 1.5, zMin: pos.z - 0.5, once: false, trigger: '' };
    case 'interactable':
      return { id, x: pos.x, y: pos.y, z: pos.z, radius: 1.5, prompt: '[E] Use', interact: '' };
    default:
      throw new Error(`panel.js: unknown place kind "${kind}"`);
  }
}

/**
 * ED-SNAP-1: a world prop's z should be the terrain surface, not the raw ray-pick z (US-063's "props placed on
 * forest float" - a pick ray can hit canopy/foliage well above the real ground). Pure, so it is the same under
 * either renderer (the snap comes from `World.floorAt`, not from how the pick ray itself was cast).
 * @param {{x:number,y:number,z:number}} pos the raw pick point
 * @param {number|null|undefined} groundZ `world.floorAt(pos.x, pos.y)` - null with no terrain
 */
export function snappedWorldPos(pos, groundZ) {
  return typeof groundZ === 'number' ? { x: pos.x, y: pos.y, z: groundZ } : pos;
}

/**
 * ED-PLACE-BUG: the ground z a world-entity placement snap samples. `World`
 * exposes `floorAt(x, y)` (engine/world/World.js) - the structure floor inside
 * a structure, `terrain.groundAt` outside - it has NO `groundAt` method (that
 * lives on `Terrain`). Sampling through `floorAt` makes a terrain click place on
 * the ground instead of throwing `world.groundAt is not a function`. Null (no
 * terrain) makes `snappedWorldPos` fall back to the raw pick point.
 * @param {{floorAt:(x:number,y:number)=>(number|null)}|null} world
 * @returns {number|null}
 */
export function worldGroundZ(world, x, y) {
  return world && typeof world.floorAt === 'function' ? world.floorAt(x, y) : null;
}

/**
 * A prop placed OUTSIDE any structure (24.9: "outside a structure -> the
 * world file's entities for props, refused for the level-only kinds"). Same
 * shape as the real `endMarker` waystone entity (content/worlds/world_m1.
 * world.json) - `type:'prop'` + `components.voxel.model`, `yawDeg` (world
 * entities use `yawDeg`, not `facing` - doc.js/main.js's existing convention).
 */
export function defaultWorldPropItem(id, pos, modelKey) {
  return { id, type: 'prop', components: { voxel: { model: modelKey || '' } }, x: pos.x, y: pos.y, z: pos.z, yawDeg: 0 };
}

/**
 * US-063 fix: classifies a placement point against the world's REAL per-cell
 * data, not just a structure's bounding rectangle. The old `structureAt` in
 * `main.js` only checked `pt` against each structure's axis-aligned bbox
 * (flagged as a known limitation in the US-033 implementation note) - a
 * courtyard gap or any other hole inside that rectangle (a cell with no
 * legend entry) was wrongly treated as "inside". `world.sectorAt(x,y)`
 * already returns `null` for exactly that cell (`Level.sectorAt`'s own
 * "outside the grid" answer, D-008) even when `world.structureAt(x,y)` finds
 * a structure whose bbox contains the point - that is the real per-cell test
 * this function uses. Takes a `world`-shaped object exposing
 * `structureAt(x,y)`/`sectorAt(x,y)` (the real `World` class - see
 * `engine/world/World.js` - or a fake with the same two methods for Node
 * tests, see `panel.test.mjs`).
 * @param {{structureAt(x:number,y:number):Object|null, sectorAt(x:number,y:number):Object|null}} world
 * @param {{x:number,y:number}} pt
 * @returns {{ zone: 'structure'|'gap'|'outside', structure: Object|null }}
 *   'structure' = a real, walkable/wall cell inside a structure's footprint;
 *   'gap' = inside a structure's bbox but on a cell with no real sector (a
 *   courtyard, a hole - placement must be refused here); 'outside' = not in
 *   any structure's bbox at all (world space, props only).
 */
export function classifyPlacement(world, pt) {
  const structure = world.structureAt(pt.x, pt.y);
  if (!structure) return { zone: 'outside', structure: null };
  const sector = world.sectorAt(pt.x, pt.y);
  return sector ? { zone: 'structure', structure } : { zone: 'gap', structure: null };
}

/**
 * ED-DND-01: the world-space point a prop drop/placement actually lands on -
 * the SAME snap `placeAt` applies to a click (ED-PLACE-BUG / ED-SNAP-1): a
 * courtyard gap can't be placed (null); a structure cell keeps the raw pick
 * point (the picked floor/wall surface IS the snap there); outside every
 * structure the z snaps to the terrain surface via `worldGroundZ`/`floorAt`.
 * Pure and renderer-agnostic (the snap reads `World.floorAt`, not the pick
 * ray), so it is the same under either renderer and Node-testable. `placeAt`
 * and the drag ghost both call this, so the ghost always matches where the
 * item really lands.
 * @param {{structureAt(x:number,y:number):Object|null, sectorAt(x:number,y:number):Object|null, floorAt(x:number,y:number):(number|null)}} world
 * @param {{x:number,y:number,z:number}} pt the raw pick point
 * @returns {{x:number,y:number,z:number}|null} null = no floor here (a gap)
 */
export function resolveDropPoint(world, pt) {
  const { zone } = classifyPlacement(world, pt);
  if (zone === 'gap') return null;
  if (zone === 'structure') return { x: pt.x, y: pt.y, z: pt.z };
  return snappedWorldPos(pt, worldGroundZ(world, pt.x, pt.y));
}

/**
 * ED-DND-01: the pure drop decision for an asset drag's mouseup/Esc.
 * `overView` = the pointer released over the viewport, `esc` = Esc was
 * pressed. Returns 'place' (commit through `placeAt`) or 'cancel' (leave the
 * doc untouched - main.js also un-arms the model). A courtyard gap/hole is
 * NOT decided here: `placeAt` refuses it with its own message (the drop
 * still passes the raw point so that refusal reads correctly).
 * @param {boolean} overView
 * @param {boolean} esc
 * @returns {'place'|'cancel'}
 */
export function resolveAssetDrop(overView, esc) {
  return (esc || !overView) ? 'cancel' : 'place';
}

/**
 * Model keys placeable as a world prop (US-063's place-a-prop model picker):
 * every registered model except UI-only sprites (`ui: true` - `title`/
 * `subtitle`/`mapCard` etc, design/models/title.js - not meant to be dropped
 * into the world as a prop; `main.js`'s old single-default-model comment
 * flagged `title` by name as exactly this kind of non-placeable sprite).
 * Sorted for a stable list.
 * @param {import('../../engine/index.js').AssetRegistry} assets
 * @returns {string[]}
 */
export function listPlaceableModels(assets) {
  return assets.keys('model')
    .filter((k) => {
      const def = assets.model(k);
      return !(def && def.ui === true);
    })
    .sort();
}

/** Case-insensitive substring filter for the model picker's search box (US-063). */
export function filterModelKeys(keys, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return keys;
  return keys.filter((k) => k.toLowerCase().includes(q));
}

/**
 * Selection collection -> validation/place "kind" (24.9). World file items
 * (`entities`) get the generic `'entity'` kind - looser validation (no
 * model/preset requirement unless the field is actually present).
 */
export function kindForSelection(selection) {
  switch (selection.collection) {
    case 'props': return 'prop';
    case 'lights': return 'light';
    case 'triggers': return 'trigger';
    case 'interactables': return 'interactable';
    default: return 'entity';
  }
}

/**
 * ED-SCALE-1c (34.1's scope, 34.3's panel/key/drag gate): true when `item`
 * (of `kind` from `kindForSelection`) is a voxel-model item that may carry a
 * `scale` - a level prop whose `model` resolves to a voxel model
 * (`assets.model(key).voxel`), or a world entity with `components.voxel`
 * (mesh-only voxel models included, per 34.1). Sprite/billboard items are
 * NOT scalable in this story - the editor hides the Scale row/tool for them
 * rather than writing a scale `World.load` would warn-and-ignore anyway.
 * @param {'prop'|'entity'|string} kind
 * @param {Object} item
 * @param {{has(kind:string,key:string):boolean, model(key:string):Object}} [assets]
 */
export function isVoxelScaleItem(kind, item, assets) {
  if (!item || !assets) return false;
  if (kind === 'prop') {
    if (typeof item.model !== 'string' || !item.model || !assets.has('model', item.model)) return false;
    const m = assets.model(item.model);
    return !!(m && m.voxel);
  }
  if (kind === 'entity') {
    return !!(item.components && item.components.voxel);
  }
  return false;
}

/**
 * Validates a candidate item (place or a property-panel field edit, 24.9).
 * Never mutates `item`. Returns a (possibly empty) list of error strings -
 * commit is refused while this is non-empty, so a NaN position or a broken
 * reference never lands in `doc` (this story's own "never invalid" AC). This
 * is the 24.9-scoped subset only (id/model/preset/numeric/r/zMin<zMax) - a
 * full cross-file `validateDoc` pass is explicitly US-034 scope (24.10); see
 * the US-033 backlog note for that gap.
 * @param {string} kind from `kindForSelection`/a place kind
 * @param {Object} item
 * @param {{assets:Object, palette:Object, siblingIds:Set<string>}} ctx
 */
export function validateItem(kind, item, ctx) {
  const errors = [];
  if (!isValidId(item.id)) {
    errors.push(`id: "${item.id}" must start with a letter and contain only letters, digits, "_" or "-"`);
  } else if (ctx.siblingIds && ctx.siblingIds.has(item.id)) {
    errors.push(`id: "${item.id}" is already used in this collection`);
  }
  for (const [key, val] of Object.entries(item)) {
    if (typeof val === 'number' && !Number.isFinite(val)) errors.push(`${key}: must be a finite number`);
  }
  const modelKey = item.model
    || (item.components && item.components.voxel && item.components.voxel.model)
    || (item.components && item.components.sprite && item.components.sprite.model);
  if ((kind === 'prop' || (modelKey && kind === 'entity')) && ctx.assets) {
    if (!modelKey) errors.push('model: required');
    else if (!ctx.assets.has('model', modelKey)) errors.push(`model: unknown "${modelKey}"`);
  }
  if (kind === 'light' && typeof item.preset === 'string' && ctx.palette) {
    if (!lightPresetNames(ctx.palette).includes(item.preset)) errors.push(`preset: "${item.preset}" is not in palette.lights`);
  }
  if (typeof item.scale === 'number' && (!Number.isFinite(item.scale) || item.scale < PROP_SCALE_MIN || item.scale > PROP_SCALE_MAX)) {
    errors.push(`scale: must be between ${PROP_SCALE_MIN} and ${PROP_SCALE_MAX}`);
  }
  if (typeof item.r === 'number' && Number.isFinite(item.r) && !(item.r > 0)) errors.push('r: must be > 0');
  if (typeof item.radius === 'number' && Number.isFinite(item.radius) && !(item.radius > 0)) errors.push('radius: must be > 0');
  if (typeof item.zMin === 'number' && typeof item.zMax === 'number'
    && Number.isFinite(item.zMin) && Number.isFinite(item.zMax) && !(item.zMin < item.zMax)) {
    errors.push('zMin must be < zMax');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// ED-FOLDERS-01 (docs/backlog.md): collapsible asset folders. Pure, Node-
// tested (folders.test.mjs). `deriveFolderKey` maps a model key to its
// DEFAULT folder; the rest is the folder layout's state model (create/rename/
// delete/move) plus the byte-stable serializer for
// `content/editor/asset-folders.json` (editor-only data, never loaded by the
// game). The editor's DOM (main.js) owns the collapsible-list UI and the
// load/save I/O - this block is pure, same split as the rest of this file's
// top half.
// ---------------------------------------------------------------------------

/** The folder an unknown model key falls into (spec: "unknown key -> a fallback"). */
export const FALLBACK_FOLDER = 'Other';

/** Every DEFAULT folder name the editor can derive. Used to (a) refuse a user
 * folder that would shadow a default folder (a "move out = back to default"
 * folder must stay unambiguous) and (b) let `moveAssetToFolder` treat
 * "dropped onto a default folder" as "back to its default folder". */
export const DEFAULT_FOLDER_NAMES = new Set([
  'Tower props', 'Ruins', 'StickyBizcuit', 'Voxel pack',
  'Forest trees', 'Ground detail', 'Notes', 'Spell/FX', FALLBACK_FOLDER,
]);

/**
 * The explicit key -> default-folder table: every model key that carries
 * NEITHER a sidecar field (`forest`/`groundDetail`) NOR a pack prefix. The
 * generic names shared across packs (`tree`/`fire`/`bush`/`stump` in
 * sb_objects.js vs vp_pack.js) live here too - exactly why a pure prefix
 * match alone cannot separate them. This is the "registry sidecar" the story
 * allows: a small, committed table beside the derivation, kept alphabetical
 * within each source file's group for review.
 */
const PACK_BY_KEY = {
  // design/models/{lantern,lever,brazier,boulder,relay,torch,sword,voxel_props,
  //               voxel_world,far_tower,ferrum_lights,voxel_beast,m3_props}.js
  // - the game's own authored props (tower interior, equipment, world props).
  awakeningCrates: 'Tower props', awakeningKeeper: 'Tower props', beaconBowl: 'Tower props',
  beaconFire: 'Tower props', boarPlaceholder: 'Tower props', boulder: 'Tower props',
  brazier: 'Tower props', farTower: 'Tower props', ferrumLights: 'Tower props',
  floorLantern: 'Tower props', lampFlame: 'Tower props', lantern: 'Tower props',
  lever: 'Tower props', pallet: 'Tower props', practiceTarget: 'Tower props',
  relay: 'Tower props', sword: 'Tower props', swordHeld: 'Tower props',
  torchFlame: 'Tower props', torchHeld: 'Tower props', torchProp: 'Tower props',
  waystone: 'Tower props',
  // design/models/{rubble,wreckage}.js - the Ruins (rubble + the Kestrel's wreckage).
  burner: 'Ruins', burnerFire: 'Ruins', burnerFlame: 'Ruins', canvasHeap: 'Ruins',
  envelopeDrape: 'Ruins', envelopeHeap: 'Ruins', gondola: 'Ruins', rigging: 'Ruins',
  rope: 'Ruins', rubble: 'Ruins', strut: 'Ruins',
  // design/models/m3_props.js 6c / notes.js - the readable note pages.
  note: 'Notes', notePinned: 'Notes',
  // design/models/spell.js + m3_props.js pickup/effect sprites.
  fireballBlast: 'Spell/FX', fireballBlastCharged: 'Spell/FX', fireballCore: 'Spell/FX',
  fireballCoreCharged: 'Spell/FX', pickupHp: 'Spell/FX', pickupMp: 'Spell/FX',
  spellHandL: 'Spell/FX', spellHandR: 'Spell/FX', strawPuff: 'Spell/FX',
  // design/models/sb_objects.js - StickyBizcuit objects whose keys carry no `sb` prefix.
  barrel: 'StickyBizcuit', crate: 'StickyBizcuit', cratesMultiple: 'StickyBizcuit',
  fire: 'StickyBizcuit', fireBlue: 'StickyBizcuit', gravestone1: 'StickyBizcuit',
  gravestone1Weathered: 'StickyBizcuit', gravestone2: 'StickyBizcuit',
  gravestone2Weathered: 'StickyBizcuit', gravestone3: 'StickyBizcuit',
  gravestone3Weathered: 'StickyBizcuit', torchLong: 'StickyBizcuit',
  torchLongBlue: 'StickyBizcuit', treeBig: 'StickyBizcuit', treeBirch: 'StickyBizcuit',
  treePine: 'StickyBizcuit', treeTrunk: 'StickyBizcuit',
  // design/models/vp_pack.js - the CC0 "Voxel Pack" (MagicaVoxel).
  bunny: 'Voxel pack', bush: 'Voxel pack', campfire: 'Voxel pack', grassPatch: 'Voxel pack',
  pig: 'Voxel pack', stump: 'Voxel pack', toolPlate: 'Voxel pack', tree: 'Voxel pack',
};

/**
 * ED-FOLDERS-01: derives the DEFAULT folder for a model key (where it lives
 * when not moved into a user folder). Precedence, documented here:
 *   1. registry sidecar fields the source file already sets on the model def
 *      (design/models/*.js): `def.forest` (forest_trees.js) -> "Forest trees";
 *      `def.groundDetail` (ground_detail.js) -> "Ground detail".
 *   2. key prefix (the pack authors' own prefixes): `forest*` -> "Forest
 *      trees"; `sb*` -> "StickyBizcuit".
 *   3. the explicit `PACK_BY_KEY` table above (generic names + the game's own
 *      authored props, none of which carry a prefix or sidecar).
 *   4. otherwise -> `FALLBACK_FOLDER`.
 * A `#N` variant suffix (`rubble#0`, `rope#1` - the AssetRegistry's packed
 * billboard variants, engine/core/assets.js) is stripped first, so a variant
 * folds to its parent's folder.
 * @param {string} modelKey
 * @param {Object} [modelDef] the model's registry def (`assets.model(key)`);
 *   optional - without it the sidecar fields are simply not checked.
 * @returns {string} a default folder name
 */
export function deriveFolderKey(modelKey, modelDef) {
  const key = String(modelKey).replace(/#\d+$/, '');
  if (modelDef) {
    if (modelDef.forest) return 'Forest trees';
    if (modelDef.groundDetail) return 'Ground detail';
  }
  if (key.startsWith('forest')) return 'Forest trees';
  if (key.startsWith('sb')) return 'StickyBizcuit';
  return PACK_BY_KEY[key] || FALLBACK_FOLDER;
}

/** A new, empty folder layout: no user folders (every asset derives to its default folder). */
export function createAssetFoldersState() {
  return { schema: 1, userFolders: {} };
}

/**
 * True when `name` is a valid user-folder name: a non-empty trimmed string
 * that is not one of the derived default folder names (a user folder that
 * shadowed a default would make "move out = back to default" ambiguous).
 * @param {string} name
 */
export function isValidFolderName(name) {
  const n = typeof name === 'string' ? name.trim() : '';
  return n.length > 0 && !DEFAULT_FOLDER_NAMES.has(n);
}

/**
 * Parses the JSON text of `content/editor/asset-folders.json` into a
 * normalized layout. Lenient (matches the editor's "content not found"
 * fallback, io.js): any parse/shape error returns an empty layout instead of
 * throwing. Normalization: folder names sorted, member keys sorted and
 * de-duplicated, and a key present in more than one folder is kept only in
 * the first (sorted) folder - an asset sits in at most one user folder.
 * @param {string} text
 */
export function parseAssetFolders(text) {
  const empty = createAssetFoldersState();
  if (typeof text !== 'string' || !text.trim()) return empty;
  let obj;
  try { obj = JSON.parse(text); } catch (_) { return empty; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return empty;
  const raw = obj.userFolders;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const userFolders = {};
  const seen = new Set();
  for (const name of Object.keys(raw).sort()) {
    const members = Array.isArray(raw[name]) ? raw[name].filter((k) => typeof k === 'string' && k) : [];
    const kept = [];
    for (const k of [...new Set(members)].sort()) {
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(k);
    }
    userFolders[name] = kept;
  }
  return { schema: 1, userFolders };
}

/**
 * Byte-stable JSON for `content/editor/asset-folders.json` (LF, trailing
 * newline, 2-space indent, sorted keys - the story's "re-saving an unchanged
 * layout writes byte-identical JSON"). Only user folders are stored; default
 * folders are derived at load, so nothing re-derived is ever written and no
 * timestamps appear.
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @returns {string}
 */
export function serializeAssetFolders(state) {
  const src = (state && state.userFolders) || {};
  const userFolders = {};
  for (const name of Object.keys(src).sort()) {
    userFolders[name] = [...(Array.isArray(src[name]) ? src[name] : [])].sort();
  }
  return JSON.stringify({ schema: 1, userFolders }, null, 2) + '\n';
}

/** The user-folder names of `state`, sorted (a stable display order). */
export function listUserFolders(state) {
  return Object.keys((state && state.userFolders) || {}).sort();
}

/**
 * Adds a new, empty user folder. Returns a NEW state, or the SAME state
 * reference when the name is invalid or already taken (a no-op - the editor
 * validates first and flashes a message; this function never throws).
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @param {string} name
 */
export function createUserFolder(state, name) {
  const n = typeof name === 'string' ? name.trim() : '';
  const folders = (state && state.userFolders) || {};
  if (!isValidFolderName(n) || Object.prototype.hasOwnProperty.call(folders, n)) return state;
  const userFolders = { ...folders };
  userFolders[n] = [];
  return { schema: 1, userFolders };
}

/**
 * Renames a user folder; its members follow (the membership is keyed by the
 * folder name). Returns a NEW state, or the SAME state when `oldName` is
 * unknown, `newName` is invalid, unchanged, or already taken.
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @param {string} oldName
 * @param {string} newName
 */
export function renameUserFolder(state, oldName, newName) {
  const folders = (state && state.userFolders) || {};
  if (!Object.prototype.hasOwnProperty.call(folders, oldName)) return state;
  const n = typeof newName === 'string' ? newName.trim() : '';
  if (!isValidFolderName(n) || n === oldName || Object.prototype.hasOwnProperty.call(folders, n)) return state;
  const userFolders = {};
  for (const k of Object.keys(folders)) {
    userFolders[k === oldName ? n : k] = [...folders[k]];
  }
  return { schema: 1, userFolders };
}

/**
 * Deletes a user folder; its members simply fall back to their default
 * folders (they are not lost). Returns a NEW state, or the SAME state when
 * `name` is unknown.
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @param {string} name
 */
export function deleteUserFolder(state, name) {
  const folders = (state && state.userFolders) || {};
  if (!Object.prototype.hasOwnProperty.call(folders, name)) return state;
  const userFolders = {};
  for (const k of Object.keys(folders)) {
    if (k !== name) userFolders[k] = [...folders[k]];
  }
  return { schema: 1, userFolders };
}

/**
 * Moves `modelKey` into a user folder, or back to its default folder when
 * `folderName` is null/empty/a DEFAULT folder name. An asset lives in at most
 * one user folder: moving in removes it from every other user folder first
 * (a not-yet-existing target folder is created, so the move is total).
 * Returns a NEW state, or the SAME state reference when nothing changed.
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @param {string} modelKey
 * @param {string|null} folderName a user folder name, or null/''/a default
 *   folder name to move the asset back out
 */
export function moveAssetToFolder(state, modelKey, folderName) {
  const key = String(modelKey);
  const folders = (state && state.userFolders) || {};
  const target = typeof folderName === 'string' ? folderName.trim() : '';
  const isUser = target.length > 0 && !DEFAULT_FOLDER_NAMES.has(target);
  const userFolders = {};
  let changed = false;
  for (const k of Object.keys(folders)) {
    const members = Array.isArray(folders[k]) ? folders[k] : [];
    const has = members.includes(key);
    if (isUser && k === target) {
      userFolders[k] = has ? members : [...members, key].sort();
      if (!has) changed = true;
    } else if (has) {
      userFolders[k] = members.filter((m) => m !== key);
      changed = true;
    } else {
      userFolders[k] = members;
    }
  }
  if (isUser && !Object.prototype.hasOwnProperty.call(userFolders, target)) {
    userFolders[target] = [key];
    changed = true;
  }
  if (!changed) return state;
  return { schema: 1, userFolders };
}

/**
 * The folder `modelKey` is in right now: its user folder if assigned, else
 * its derived default folder (`deriveFolderKey`).
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @param {string} modelKey
 * @param {Object} [modelDef]
 */
export function assetFolderFor(state, modelKey, modelDef) {
  const folders = (state && state.userFolders) || {};
  for (const name of Object.keys(folders)) {
    if (Array.isArray(folders[name]) && folders[name].includes(modelKey)) return name;
  }
  return deriveFolderKey(modelKey, modelDef);
}

/**
 * Groups a flat, already-filtered list of model keys into `{ folder, keys }`
 * entries for the Assets list: user folders first (sorted), then default
 * folders (sorted), each folder's keys sorted, every key exactly once, and
 * empty folders omitted. `modelDefFor(key)` resolves a key to its model def
 * (the editor passes `assets.model`; tests pass a stub). Pure - main.js just
 * renders each returned group as a collapsible section.
 * @param {string[]} modelKeys
 * @param {{schema:number, userFolders:Object<string,string[]>}} state
 * @param {(key:string)=>(Object|undefined)} [modelDefFor]
 * @returns {{folder:string, keys:string[]}[]}
 */
export function groupAssetFolders(modelKeys, state, modelDefFor) {
  const folders = (state && state.userFolders) || {};
  const userSet = new Set(Object.keys(folders));
  const buckets = new Map();
  for (const key of modelKeys) {
    const folder = assetFolderFor(state, key, modelDefFor ? modelDefFor(key) : undefined);
    if (!buckets.has(folder)) buckets.set(folder, []);
    buckets.get(folder).push(key);
  }
  const user = [];
  const defaults = [];
  for (const [folder, keys] of buckets) {
    keys.sort();
    (userSet.has(folder) ? user : defaults).push({ folder, keys });
  }
  const byName = (a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0);
  user.sort(byName);
  defaults.sort(byName);
  return [...user, ...defaults];
}

// ---------------------------------------------------------------------------
// Below this line: DOM-touching (browser only, no Node test - same split as
// pick.js/select.js). `renderPropertyPanel` regenerates the whole form on
// every call (selection change, undo/redo, a committed field edit) - cheap,
// a handful of DOM nodes, not a per-frame path (24.14's allocation rule only
// applies to the render loop).
// ---------------------------------------------------------------------------

function makeDatalist(container, id, values) {
  let dl = container.ownerDocument.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = id;
    container.appendChild(dl);
  }
  dl.textContent = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    dl.appendChild(opt);
  }
  return dl;
}

/** US-066: `x`/`y`/`z` get amber/green/cyan axis badges (design/editor-ui.md 1: "X amber, Y green, Z cyan"). */
const AXIS_CLASS = { x: 'x', y: 'y', z: 'z' };

/**
 * Renders the property form for the current selection into `container`
 * (24.9: a form generated from the item's own JSON shape - number/string/
 * boolean inputs, array-or-object fields as a JSON textarea; US-066 restyles
 * this into a header + POSITION card + a Properties card, same per-field
 * commit/validate/undo path as before - no behaviour change). `ctx`:
 * `{ doc, selection, assets, palette, behaviourNames, onFieldCommit(patch),
 * onRename(newId, setError) }`.
 */
export function renderPropertyPanel(container, ctx) {
  container.textContent = '';
  const { doc, selection } = ctx;
  if (!selection) {
    const empty = document.createElement('div');
    empty.className = 'insp-empty';
    empty.textContent = '(nothing selected)';
    container.appendChild(empty);
    return;
  }
  const item = selectionItemData(doc, selection);
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'insp-empty';
    empty.textContent = '(item not found)';
    container.appendChild(empty);
    return;
  }
  const kind = kindForSelection(selection);

  const errEl = document.createElement('div');
  errEl.className = 'insp-error';
  container.appendChild(errEl);

  const header = document.createElement('div');
  header.className = 'insp-header';
  const glyph = document.createElement('span');
  glyph.className = 'insp-glyph';
  glyph.textContent = KIND_GLYPHS[kind] || '?';
  const idEl = document.createElement('span');
  idEl.className = 'insp-id';
  idEl.textContent = item.id;
  const kindChip = document.createElement('span');
  kindChip.className = 'insp-kind-chip';
  kindChip.textContent = kind;
  header.appendChild(glyph);
  header.appendChild(idEl);
  header.appendChild(kindChip);
  container.appendChild(header);

  const file = doc.files.get(selection.fileId);
  const siblingIdsFor = (collection, excludeId) => {
    const ids = new Set((file.def[collection] || []).map((it) => it.id));
    ids.delete(excludeId);
    return ids;
  };

  /**
   * Builds one field's input (exactly the original 24.9 type-dispatch +
   * datalist wiring) and wires the same commit/validate/undo path as before -
   * `renderOutliner`/`renderProperties` call site owns the undo stack, this
   * function only ever calls `ctx.onFieldCommit`/`ctx.onRename`. Returns the
   * `<input>`/`<textarea>` element (the caller lays it out, e.g. an axis
   * field vs. a generic labelled row).
   */
  function buildInput(key) {
    const val = item[key];
    let input;
    if (typeof val === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = String(val);
    } else if (typeof val === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = val;
    } else if (val !== null && typeof val === 'object') {
      input = document.createElement('textarea');
      input.rows = 2;
      input.value = JSON.stringify(val);
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = val == null ? '' : String(val);
      if (key === 'interact' || key === 'trigger') {
        const listId = `panel-datalist-behaviours`;
        makeDatalist(container, listId, ctx.behaviourNames || []);
        input.setAttribute('list', listId);
      } else if (key === 'model') {
        const listId = 'panel-datalist-models';
        makeDatalist(container, listId, ctx.assets ? ctx.assets.keys('model') : []);
        input.setAttribute('list', listId);
      } else if (key === 'preset') {
        const listId = 'panel-datalist-presets';
        makeDatalist(container, listId, lightPresetNames(ctx.palette || {}));
        input.setAttribute('list', listId);
      }
    }

    const commitField = () => {
      let raw;
      if (input.type === 'number') {
        raw = Number(input.value);
      } else if (input.type === 'checkbox') {
        raw = input.checked;
      } else if (input.tagName === 'TEXTAREA') {
        try { raw = JSON.parse(input.value); } catch (e) { errEl.textContent = `${key}: invalid JSON (${e.message})`; return; }
      } else {
        raw = input.value;
      }
      if (key === 'id') {
        if (raw === item.id) { errEl.textContent = ''; return; }
        ctx.onRename(raw, (msg) => { errEl.textContent = msg; });
        return;
      }
      const patch = { [key]: raw };
      const candidate = { ...item, ...patch };
      const siblingIds = siblingIdsFor(selection.collection, item.id);
      const errors = validateItem(kind, candidate, { assets: ctx.assets, palette: ctx.palette, siblingIds });
      if (errors.length) { errEl.textContent = errors.join('; '); return; }
      errEl.textContent = '';
      ctx.onFieldCommit(patch);
    };
    input.addEventListener(input.type === 'checkbox' ? 'change' : 'blur', commitField);
    return input;
  }

  // ---- POSITION card: x/y/z (axis-coloured) + yaw (facing/yawDeg) + scale -
  const posKeys = ['x', 'y', 'z'].filter((k) => k in item);
  const yawKey = typeof item.facing === 'number' ? 'facing' : (typeof item.yawDeg === 'number' ? 'yawDeg' : null);
  // ED-SCALE-1c (34.3): voxel props/world entities only - the row is hidden
  // entirely for a sprite/billboard item or anything else (34.1's scope).
  const scaleEligible = isVoxelScaleItem(kind, item, ctx.assets);
  if (posKeys.length || yawKey || scaleEligible) {
    const card = document.createElement('div');
    card.className = 'insp-card';
    const title = document.createElement('div');
    title.className = 'insp-card-title';
    title.textContent = 'Position';
    card.appendChild(title);
    if (posKeys.length) {
      const grid = document.createElement('div');
      grid.className = 'insp-pos-grid';
      for (const axis of posKeys) {
        const field = document.createElement('div');
        field.className = 'insp-axis-field';
        const badge = document.createElement('span');
        badge.className = `insp-axis-badge ${AXIS_CLASS[axis] || ''}`;
        badge.textContent = axis.toUpperCase();
        const input = buildInput(axis);
        field.appendChild(badge);
        field.appendChild(input);
        grid.appendChild(field);
      }
      card.appendChild(grid);
    }
    if (yawKey) {
      const yawRow = document.createElement('div');
      yawRow.className = 'insp-field-row insp-yaw-row';
      const label = document.createElement('span');
      label.className = 'insp-field-label';
      label.textContent = 'YAW (deg)';
      const input = buildInput(yawKey);
      yawRow.appendChild(label);
      yawRow.appendChild(input);
      card.appendChild(yawRow);
    }
    if (scaleEligible) {
      const scaleRow = document.createElement('div');
      scaleRow.className = 'insp-field-row insp-scale-row';
      const label = document.createElement('span');
      label.className = 'insp-field-label';
      label.textContent = 'SCALE';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.05';
      input.min = String(PROP_SCALE_MIN);
      input.max = String(PROP_SCALE_MAX);
      input.value = String(typeof item.scale === 'number' ? item.scale : 1);
      const commitScale = () => {
        const raw = Number(input.value);
        if (!Number.isFinite(raw)) { errEl.textContent = 'scale: must be a finite number'; return; }
        errEl.textContent = '';
        ctx.onScaleCommit(clampScale(raw));
      };
      input.addEventListener('blur', commitScale);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      scaleRow.appendChild(label);
      scaleRow.appendChild(input);
      card.appendChild(scaleRow);
    }
    container.appendChild(card);
  }

  // ---- Properties card: id + every remaining field ------------------------
  const handled = new Set([...posKeys, yawKey, scaleEligible ? 'scale' : null].filter(Boolean));
  const card = document.createElement('div');
  card.className = 'insp-card';
  const title = document.createElement('div');
  title.className = 'insp-card-title';
  title.textContent = 'Properties';
  card.appendChild(title);
  for (const key of Object.keys(item)) {
    if (handled.has(key)) continue;
    const row = document.createElement('label');
    row.className = 'insp-field-row';
    const label = document.createElement('span');
    label.className = 'insp-field-label';
    label.textContent = key;
    row.appendChild(label);
    row.appendChild(buildInput(key));
    card.appendChild(row);
  }
  container.appendChild(card);
}
