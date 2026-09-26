// tools/editor/main.js - US-031 boot (docs/architecture.md 24.3), the
// M1.5 editor's fly-cam viewer over the tower world. Imports only
// engine/index.js (check-deps rule 3 + the editor boundary rule: no `game/`
// import) - `design/` stays classic <script> tags, like game/index.html.
import {
  AssetRegistry, createEngine, GRID_DEFAULT_COLS, MAX_LIGHTS,
  loadContentPack, ContentError, World, validateBehaviours, registerBehaviour,
  DebugOverlay, drawText,
} from '../../engine/index.js';
import {
  createDoc, selectionFromEntityId, selectionEntityId, selectionItemData, selectionItemIndex,
  listOutlinerItems, toLocal, toWorld, mintId, fileKey,
} from './doc.js';
import { createFrame } from './frame.js';
import { createCameraPose, updateCamera, startPoseForStructure, adjustSpeed, clonePose } from './camera.js';
import { unprojectCell, rayPoint } from './ray.js';
import { pickAt, pickMarkers } from './pick.js';
import { drawSelectionHighlight, drawMarkers, drawHoverOutline } from './select.js';
import {
  makeFieldEditRecord, makeDeleteRecord, makeInsertRecord, makeRenameBatch,
  applyEdit, invert, findReferrers,
} from './commands.js';
import { createStack } from './undo.js';
import { isPatchableRecord, applyPropTransformPatch, applyLightPatch, findLightHandle } from './livepatch.js';
import {
  PLACE_KEYS, isValidId, countLights, harvestBehaviourNames, defaultItemForKind,
  defaultWorldPropItem, kindForSelection, validateItem, renderPropertyPanel,
  classifyPlacement, listPlaceableModels, filterModelKeys,
} from './panel.js';
import { validateDoc, saveAll, loadFile, launchPlaytest, anyDirty } from './io.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('screen');
canvas.tabIndex = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', () => canvas.focus());

const statusEl = document.getElementById('status');
const gateEl = document.getElementById('gate-message');
const animateToggle = document.getElementById('animate-toggle');
const speedInput = document.getElementById('speed-input');
const outlinerEl = document.getElementById('outliner');
const propertiesEl = document.getElementById('properties');
const saveBtn = document.getElementById('save-btn');
const loadBtn = document.getElementById('load-btn');
const playtestBtn = document.getElementById('playtest-btn');
const ioStatusEl = document.getElementById('io-status');
// US-063: the place-a-prop model picker (a searchable list, shown right
// after clicking a surface in place-prop mode instead of a later panel
// fix-up - see `openModelPicker` below).
const modelPickerEl = document.getElementById('model-picker');
const modelPickerSearchEl = document.getElementById('model-picker-search');
const modelPickerListEl = document.getElementById('model-picker-list');

function gridFromParam(p, def) {
  const g = p.get('grid');
  if (!g) return def;
  const m = /^(\d+)x(\d+)$/i.exec(g.trim());
  return m ? Number(m[1]) : def;
}

// ---- content: JSON pack, with the "content/ not found" fallback (24.3) ----
let bundle = null;
try {
  bundle = await loadContentPack('../../content/manifest.json');
} catch (e) {
  if (!(e instanceof ContentError) || !/HTTP 404/.test(e.message)) throw e;
  console.warn('[editor] content/manifest.json not found - falling back to window.ASSETS (fromGlobals, read-only)');
}
const assets = bundle ? AssetRegistry.fromJSON(bundle, window.ASSETS) : AssetRegistry.fromGlobals(window.ASSETS);

// `?world=<id>` (US-063): already just a normal `assets.world(id)` lookup
// below (`assets.world` throws with a clear "unknown world" message +known
// list if `id` isn't registered) - no extra wiring needed, just confirmed and
// Node-tested here (see doc.test.mjs "createDoc: an arbitrary ?world= id").
const doc = createDoc(assets, bundle, { worldId: params.get('world') || 'world_m1' });
if (doc.readOnly) statusEl.textContent = 'content: design/*.js (read-only source)\n';

// The editor runs no gameplay behaviours (24.3): register a silent no-op for
// every name a throwaway load of the target world references, so
// `World.load` below never warns "not registered".
for (const name of validateBehaviours(World.load(assets.world(doc.worldId), assets, {}))) {
  registerBehaviour(name, () => {});
}

const engine = createEngine({
  canvas, assets, cols: gridFromParam(params, GRID_DEFAULT_COLS), rays: 1,
  gpu: params.get('gpu') !== '0', inputTarget: canvas,
  uiGrid: (assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 },
});
const { renderTarget: rt, input } = engine;

// ---- GPU gate (24.3): a real WebGL2 pipeline is required unless ?gpu=0 ----
const gpuDevSwitch = params.get('gpu') === '0';
// BUG-EDITOR-001 fix: `?gpu=0` keeps `rt.backend === 'gl2'` (RenderTarget.js
// only shrinks the grid for it) - createFrame needs the raw param too, so it
// can skip constructing GpuCellPipeline the same way main.js does.
const frame = createFrame({ engine, assets, rt, gpuParam: !gpuDevSwitch });
const gpuReady = rt.backend === 'gl2' && frame.gpuPipeline && frame.gpuPipeline.ready;
const gpuBlocked = !gpuDevSwitch && !gpuReady;
if (gpuBlocked) {
  gateEl.style.display = 'flex';
  gateEl.textContent = 'editor needs WebGL2 (use ?gpu=0 for the slow CPU path)';
  canvas.style.display = 'none';
}

console.log(`[editor] RenderTarget backend: ${rt.backend}${frame.gpuPipeline ? ` GpuCellPipeline: ${frame.gpuPipeline.ready ? 'active' : 'inactive'}` : ''}`);

// ---- camera pose: explicit CameraPose data (24.5), restored from localStorage if present ----
const POSE_KEY = 'kestrel.editor.cam';
let speed = 6;

function loadSavedPose() {
  try {
    const raw = localStorage.getItem(POSE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || typeof p.z !== 'number'
      || typeof p.yawDeg !== 'number' || typeof p.pitchDeg !== 'number') return null;
    return p;
  } catch (_) {
    return null;
  }
}

let savePoseTimer = null;
function savePoseDebounced(pose) {
  if (savePoseTimer) clearTimeout(savePoseTimer);
  savePoseTimer = setTimeout(() => {
    try { localStorage.setItem(POSE_KEY, JSON.stringify(clonePose(pose))); } catch (_) { /* storage unavailable - not fatal */ }
  }, 500);
}

function startPose() {
  const s = world.structures.find((st) => st.id === 'tower') || world.structures[0];
  return s ? startPoseForStructure(s.origin, s.level) : createCameraPose({ z: 8, pitchDeg: -15 });
}

let world = engine.loadWorld(assets.world(doc.worldId));
const saved = loadSavedPose();
let cam = saved ? createCameraPose(saved) : startPose();
frame.markDirty();

engine.events.on('world:loaded', (evt) => { world = evt.world; });

// ---- US-032: selection, edits, undo (docs/architecture.md 24.7/24.8) -----
const undoStack = createStack(50);
const SNAP_OPTIONS = [0.05, 0.25, 0.5, 1];
let snapIdx = 1; // default 0.25 m (24.8)
let selection = null; // {fileId, collection, id} | null
let drag = null; // {entId, item, index, startTransform} | null
let hoverCol = null, hoverRow = null;
let markersOn = true;
let helpOn = false; // US-063: `H` toggles the in-viewport key-help overlay (drawHelpOverlay below)
let lastPickText = '';
let placeMode = null; // 'prop'|'light'|'trigger'|'interactable'|null (US-033, 24.9)

function flash(msg) {
  lastPickText = msg;
}

/** The placed structure a level file's items live in (null for a world file). US-064: also used to find a light's live `${structId}.${lightId}` key. */
function structureForFile(fileId) {
  if (fileId.startsWith('world/')) return null;
  const levelId = fileId.slice('level/'.length);
  return world.structures.find((st) => st.level.name === levelId) || null;
}

/** `{x,y,z}` origin to add/subtract for a file's collection (0 for a world file - 24.1 decision 4). */
function originForFile(fileId) {
  const s = structureForFile(fileId);
  return s ? s.origin : { x: 0, y: 0, z: 0 };
}

/**
 * US-064: patches `rec.after` live (an entity's `transform`, or a light's
 * `LightSet` handle) instead of rebuilding the World - only called once
 * `isPatchableRecord(rec)` is true. Returns false (caller falls back to a
 * full `rebuild()`) when the live entity/light can't actually be found -
 * e.g. the world hasn't rendered a frame yet so `frame.lightSet` is still
 * null - which should not happen in practice for an edit on an EXISTING
 * selected item, but is not assumed.
 * @param {Object} rec a commands.js EditRecord (or its `invert()`), `before != null && after != null`
 */
function patchLive(rec) {
  const item = rec.after;
  const isWorldSpace = rec.fileId.startsWith('world/');
  const origin = originForFile(rec.fileId);
  if (rec.collection === 'lights') {
    const s = structureForFile(rec.fileId);
    const ls = frame.lightSet;
    if (!s || !ls) return false;
    const handle = findLightHandle(ls, `${s.id}.${rec.id}`);
    if (handle === -1) return false;
    applyLightPatch(ls, handle, item, origin, isWorldSpace);
    frame.markDirty();
    return true;
  }
  const entId = selectionEntityId(world, { fileId: rec.fileId, collection: rec.collection, id: rec.id });
  if (!entId) return false;
  const data = world.entity(entId);
  if (!data) return false;
  applyPropTransformPatch(data.transform, item, origin, isWorldSpace);
  world.renderVersion++;
  frame.markDirty();
  return true;
}

function normZero(v) { return v === 0 ? 0 : v; }
function snapTo(v, snap) { return normZero(Math.round(v / snap) * snap); }

/** `engine.setWorld(World.load(...))` - the one mutation path's rebuild (24.8). <= 5 ms budget. */
function rebuild() {
  const t0 = performance.now();
  const w = World.load(assets.world(doc.worldId), assets, { events: engine.events });
  engine.setWorld(w);
  const ms = performance.now() - t0;
  frame.markDirty();
  renderOutliner();
  renderProperties();
  refreshIoStatus(); // US-034 (function declaration, hoisted - defined below but callable here)
  return ms;
}

/**
 * US-064: a patchable field edit (nudge/yaw/drop/drag/property-edit on an
 * EXISTING prop or light - `isPatchableRecord`) skips `World.load` entirely:
 * `patchLive` writes straight into the already-live entity/`LightSet`
 * handle, same as US-032's drag path did for x/y during the drag itself.
 * Add/delete/rename/any other field (a prop's `model`, a light's `preset`
 * and everything that changes it - no live setter exists for those, see the
 * US-064 backlog note) still falls through to the full `rebuild()`.
 */
function commit(rec) {
  applyEdit(doc, rec);
  undoStack.push(rec);
  if (isPatchableRecord(rec) && patchLive(rec)) {
    renderOutliner();
    renderProperties();
    refreshIoStatus();
    flash(`${rec.label} "${rec.id}" (patched, no rebuild)`);
    return;
  }
  const ms = rebuild();
  flash(`${rec.id ? `${rec.label} "${rec.id}"` : rec.label} (rebuild ${ms.toFixed(2)} ms)`);
}

/**
 * A rename batch (US-033, 24.9) carries `renameFrom`/`renameTo` so the live
 * `selection` pointer (a plain `{fileId,collection,id}`) follows the id
 * across undo/redo - a rename is the one edit whose own id changes, so
 * `selection.id` would otherwise point at nothing after the edit applies.
 */
function followRename(appliedRec) {
  if (appliedRec.renameFrom === undefined) return;
  if (selection && selection.fileId === appliedRec.fileId && selection.collection === appliedRec.collection
    && selection.id === appliedRec.renameFrom) {
    selection = { ...selection, id: appliedRec.renameTo };
  }
}

/** US-064: undo/redo skip the rebuild too when the record being (re)applied is itself patchable - only a boundary case (add/delete/rename/any other field) still crosses into a full `rebuild()`. */
function applyAndSync(appliedRec) {
  if (isPatchableRecord(appliedRec) && patchLive(appliedRec)) {
    renderOutliner();
    renderProperties();
    refreshIoStatus();
    return;
  }
  rebuild();
}

function doUndo() {
  const rec = undoStack.undo();
  if (!rec) { flash('undo: nothing to undo'); return; }
  const inv = invert(rec);
  followRename(inv);
  applyEdit(doc, inv);
  applyAndSync(inv);
  flash(`undo: ${rec.label}`);
}

function doRedo() {
  const rec = undoStack.redo();
  if (!rec) { flash('redo: nothing to redo'); return; }
  followRename(rec);
  applyEdit(doc, rec);
  applyAndSync(rec);
  flash(`redo: ${rec.label}`);
}

function selectItem(item) {
  selection = item;
  renderOutliner();
  renderProperties();
  frame.markDirty();
}

/** Property-panel field edit: one `EditRecord` per committed field (24.9). */
function commitFieldEdit(patch) {
  if (!selection) return;
  const item = selectionItemData(doc, selection);
  if (!item) return;
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('edit', selection.fileId, selection.collection, item, index, patch));
}

/** Property-panel id rename (24.9): validated here too (defence in depth - the form already checks), one batch record. */
function renameSelected(newId, setError) {
  if (!selection) return;
  const item = selectionItemData(doc, selection);
  if (!item) return;
  const file = doc.files.get(selection.fileId);
  const siblingIds = new Set((file.def[selection.collection] || []).map((it) => it.id));
  siblingIds.delete(item.id);
  if (!isValidId(newId)) { setError(`id: "${newId}" must start with a letter and contain only letters, digits, "_" or "-"`); return; }
  if (siblingIds.has(newId)) { setError(`id: "${newId}" is already used in this collection`); return; }
  const index = selectionItemIndex(doc, selection);
  const rec = makeRenameBatch(selection.fileId, file.kind, selection.collection, item, index, newId, file.def);
  selection = { ...selection, id: newId };
  commit(rec);
}

function renderProperties() {
  renderPropertyPanel(propertiesEl, {
    doc, selection, assets, palette: assets.palette,
    behaviourNames: harvestBehaviourNames(doc),
    onFieldCommit: commitFieldEdit,
    onRename: renameSelected,
  });
}

function applyNudge(axis, sign) {
  if (!selection) { flash('nudge: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (axis === 'z' && typeof item.z !== 'number') { flash('nudge: z is not numeric (e.g. "ground") - left alone'); return; }
  const origin = originForFile(selection.fileId);
  const isWorldSpace = selection.fileId.startsWith('world/');
  const localZ = typeof item.z === 'number' ? item.z : 0;
  const worldPos = isWorldSpace ? { x: item.x, y: item.y, z: localZ } : toWorld(origin, { x: item.x, y: item.y, z: localZ });
  const snap = SNAP_OPTIONS[snapIdx];
  const delta = { x: 0, y: 0, z: 0 };
  delta[axis] = sign * snap;
  const nextWorld = { x: worldPos.x + delta.x, y: worldPos.y + delta.y, z: worldPos.z + delta.z };
  const snapped = { x: snapTo(nextWorld.x, snap), y: snapTo(nextWorld.y, snap), z: snapTo(nextWorld.z, snap) };
  const nextLocal = isWorldSpace ? snapped : toLocal(origin, snapped);
  const patch = { x: nextLocal.x, y: nextLocal.y };
  if (axis === 'z') patch.z = nextLocal.z;
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('nudge', selection.fileId, selection.collection, item, index, patch));
}

function applyYaw(deltaDeg) {
  if (!selection) { flash('yaw: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  const field = typeof item.facing === 'number' ? 'facing' : (typeof item.yawDeg === 'number' ? 'yawDeg' : null);
  if (!field) { flash('yaw: item has no facing/yawDeg field'); return; }
  const next = ((item[field] + deltaDeg) % 360 + 360) % 360;
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('yaw', selection.fileId, selection.collection, item, index, { [field]: next }));
}

function dropToFloor() {
  if (!selection) { flash('drop: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (item.z === 'ground') { flash('drop: z is "ground" - left alone (24.8)'); return; }
  const origin = originForFile(selection.fileId);
  const isWorldSpace = selection.fileId.startsWith('world/');
  const worldPos = isWorldSpace ? { x: item.x, y: item.y } : toWorld(origin, { x: item.x, y: item.y, z: 0 });
  const floorZ = world.floorAt(worldPos.x, worldPos.y);
  if (floorZ == null) { flash('drop: no floor under this point'); return; }
  const nextZ = isWorldSpace ? floorZ : floorZ - origin.z;
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('drop', selection.fileId, selection.collection, item, index, { z: nextZ }));
}

function deleteSelected() {
  if (!selection) { flash('delete: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  const file = doc.files.get(selection.fileId);
  if (selection.collection === 'props') {
    const referrers = findReferrers(file.def, file.kind, 'props', item.id);
    if (referrers.length) { flash(`delete refused: referenced by ${referrers.join(', ')}`); return; }
  }
  const index = selectionItemIndex(doc, selection);
  commit(makeDeleteRecord(selection.fileId, selection.collection, item, index));
  selection = null;
  renderOutliner();
  renderProperties();
}

function teleportToSelection() {
  if (!selection) return;
  let point = null;
  const entId = selectionEntityId(world, selection);
  if (entId) {
    const data = world.entity(entId);
    if (data) point = data.transform;
  }
  if (!point) {
    const item = selectionItemData(doc, selection);
    if (item && typeof item.x === 'number' && typeof item.y === 'number') {
      const origin = originForFile(selection.fileId);
      const z = typeof item.z === 'number' ? item.z : 0;
      point = selection.fileId.startsWith('world/') ? { x: item.x, y: item.y, z } : toWorld(origin, { x: item.x, y: item.y, z });
    }
  }
  if (!point) { flash('teleport: no position for this item'); return; }
  cam.x = point.x;
  cam.y = point.y + 2; // 2 m south (+y), looking north at it (24.5)
  cam.z = point.z + 1.5;
  cam.yawDeg = 0;
  cam.pitchDeg = -10;
  frame.markDirty();
}

function selectableLabel(o) {
  const it = o.item;
  const desc = it.model || it.preset || it.type || '';
  return `${o.collection}/${o.id}${desc ? ' (' + desc + ')' : ''}`;
}

function renderOutliner() {
  outlinerEl.textContent = '';
  const items = listOutlinerItems(doc);
  for (const o of items) {
    const row = document.createElement('div');
    row.textContent = selectableLabel(o);
    row.style.cursor = 'pointer';
    row.style.whiteSpace = 'nowrap';
    row.style.overflow = 'hidden';
    row.style.textOverflow = 'ellipsis';
    const isSel = selection && selection.fileId === o.fileId && selection.collection === o.collection && selection.id === o.id;
    if (isSel) { row.style.color = '#ffd24a'; row.style.fontWeight = 'bold'; }
    row.addEventListener('click', () => selectItem({ fileId: o.fileId, collection: o.collection, id: o.id }));
    row.addEventListener('dblclick', () => { selectItem({ fileId: o.fileId, collection: o.collection, id: o.id }); teleportToSelection(); });
    outlinerEl.appendChild(row);
  }
  if (!items.length) outlinerEl.textContent = '(no props/lights/interactables/entities)';
}
renderOutliner();
renderProperties();

// ---- US-034: save/load/play-test (24.10/24.11) -----------------------------

/**
 * Re-validates the whole document and reflects the result in the Save
 * button + status line (24.10: "the Save button is disabled with the error
 * text while invalid"). Fire-and-forget (async, called after every
 * `rebuild()`) - a stale in-flight validation is harmless since only the
 * LAST call's result matters and `validateDoc` is a pure read over `doc`
 * (no race that could corrupt anything, just a possibly-stale button state
 * for one frame).
 */
let ioGeneration = 0;
async function refreshIoStatus() {
  const gen = ++ioGeneration;
  const err = await validateDoc(doc, window.ASSETS);
  if (gen !== ioGeneration) return; // a newer edit landed while this was in flight
  const dirty = anyDirty(doc);
  saveBtn.disabled = !!err;
  saveBtn.title = err ? err.message : '';
  ioStatusEl.textContent = err ? `invalid: ${err.message}` : (dirty ? 'unsaved changes' : 'saved');
  ioStatusEl.style.color = err ? '#ff6b6b' : (dirty ? '#ffd24a' : '#8fae8f');
}
refreshIoStatus();

async function doSave() {
  try {
    const saved = await saveAll(doc);
    flash(saved.length ? `saved: ${saved.join(', ')}` : 'save: nothing dirty');
  } catch (e) {
    flash(`save failed: ${e && e.message ? e.message : e}`);
  }
  refreshIoStatus();
}

async function doLoad() {
  try {
    const fid = await loadFile(doc, window.ASSETS);
    if (!fid) { flash('load: cancelled'); return; }
    undoStack.clear();
    selection = null;
    rebuild();
    flash(`loaded: ${fid}`);
  } catch (e) {
    flash(`load failed: ${e && e.message ? e.message : e}`);
  }
  refreshIoStatus();
}

function doPlaytest() {
  launchPlaytest(doc);
  flash(`play-test: opened game/index.html?playtest=1&world=${doc.worldId}`);
}

saveBtn.addEventListener('click', doSave);
loadBtn.addEventListener('click', doLoad);
playtestBtn.addEventListener('click', doPlaytest);

// Ctrl+S/Ctrl+P are browser shortcuts (save page / print) that `Input`
// deliberately never intercepts (engine/core/input.js: "never swallow a
// browser/OS shortcut") - the editor still wants the KEY, just not the
// browser's own dialog, so it prevents default itself, once, at the window
// level, regardless of `editorKeysActive()` (matches the browser's own
// scope for these shortcuts).
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.code === 'KeyP')) e.preventDefault();
});

// 24.10: "beforeunload warns while any file is dirty".
window.addEventListener('beforeunload', (e) => {
  if (!anyDirty(doc)) return;
  e.preventDefault();
  e.returnValue = '';
});

// ---- US-033/US-063: place (24.9) -------------------------------------------

/**
 * Places a new item of `kind` at world point `pt` (24.9, fixed by US-063 to
 * use the level's real per-cell data instead of a bounding-box test - see
 * `classifyPlacement` in panel.js). A real structure cell -> that level file
 * (local metres); a courtyard gap/hole inside a structure's bbox is refused
 * outright (it used to be silently treated as "inside"); truly outside any
 * structure -> the world file's `entities` (world metres), props only -
 * refused for the level-only kinds (light/trigger/interactable) per the
 * architecture note.
 * @param {string} kind
 * @param {{x:number,y:number,z:number}} pt
 * @param {string} [modelKeyOverride] the model the US-063 picker modal chose
 *   (prop placement only - see `openModelPicker`/mousedown below); falls
 *   back to the old single-default-model choice when omitted (light/trigger/
 *   interactable placement never passes one).
 */
function placeAt(kind, pt, modelKeyOverride) {
  const { zone, structure: s } = classifyPlacement(world, pt);
  if (zone === 'gap') {
    flash('place refused: no floor here (a courtyard gap or hole inside the structure)');
    placeMode = null;
    return;
  }
  if (!s && kind !== 'prop') { flash(`place refused: a ${kind} must be placed inside a structure`); placeMode = null; return; }
  if (kind === 'light' && countLights(doc) >= MAX_LIGHTS) { flash(`place refused: MAX_LIGHTS (${MAX_LIGHTS}) reached`); placeMode = null; return; }

  // Model for a freshly placed prop: the US-063 picker modal's choice when
  // given (see `openModelPicker` below); else the old single-default-model
  // fallback (a real placeable prop model rather than `assets.keys('model')
  // [0]`, which is whatever the index.html script tag list happens to load
  // first - `title`, a UI/menu sprite, not a world prop, and not actually
  // placeable as a billboard).
  const modelKey = modelKeyOverride || (assets.has('model', 'lantern') ? 'lantern' : (assets.keys('model')[0] || ''));
  let fileId, collection, item;
  if (s) {
    fileId = fileKey('level', s.level.name);
    collection = kind === 'prop' ? 'props' : kind === 'light' ? 'lights' : kind === 'trigger' ? 'triggers' : 'interactables';
    const file = doc.files.get(fileId);
    const id = mintId(file, kind);
    item = defaultItemForKind(kind, id, toLocal(s.origin, pt), { modelKey });
  } else {
    fileId = fileKey('world', doc.worldId);
    collection = 'entities';
    const file = doc.files.get(fileId);
    const id = mintId(file, 'prop');
    item = defaultWorldPropItem(id, pt, modelKey);
  }

  const file = doc.files.get(fileId);
  const siblingIds = new Set((file.def[collection] || []).map((it) => it.id));
  const validateKind = s ? kind : 'entity';
  const errors = validateItem(validateKind, item, { assets, palette: assets.palette, siblingIds });
  if (errors.length) { flash(`place refused: ${errors.join('; ')}`); placeMode = null; return; }

  commit(makeInsertRecord(fileId, collection, item));
  selectItem({ fileId, collection, id: item.id });
  placeMode = null;
}

// ---- US-063: place-a-prop model picker -------------------------------------
// A searchable list of every placeable model (panel.js's `listPlaceableModels`
// / `filterModelKeys`, pure and Node-tested); opened right after clicking a
// surface in place-prop mode (see the mousedown handler above), closed by a
// pick (commits `placeAt('prop', point, key)`) or by Esc (cancels the whole
// placement, same message as the other place kinds' Esc cancel).
let pendingPropPoint = null;
modelPickerEl.style.display = 'none'; // CSS already hides it; set the inline style too so `.style.display` reads reliably below

function openModelPicker(pt) {
  pendingPropPoint = pt;
  modelPickerSearchEl.value = '';
  renderModelPickerList('');
  modelPickerEl.style.display = 'flex';
  modelPickerSearchEl.focus();
}

function closeModelPicker() {
  modelPickerEl.style.display = 'none';
  modelPickerListEl.textContent = '';
  pendingPropPoint = null;
}

function renderModelPickerList(query) {
  modelPickerListEl.textContent = '';
  const keys = filterModelKeys(listPlaceableModels(assets), query);
  if (!keys.length) {
    modelPickerListEl.textContent = '(no matching models)';
    return;
  }
  for (const key of keys) {
    const row = document.createElement('div');
    row.className = 'model-picker-row';
    row.textContent = key;
    row.addEventListener('mousedown', (e) => {
      // mousedown (not click): fires before the search input's blur steals
      // focus back and before the canvas's own document-level mousedown
      // handlers run for this same event.
      e.preventDefault();
      const pt = pendingPropPoint;
      closeModelPicker();
      placeMode = null;
      placeAt('prop', pt, key);
    });
    modelPickerListEl.appendChild(row);
  }
}

modelPickerSearchEl.addEventListener('input', () => renderModelPickerList(modelPickerSearchEl.value));
modelPickerSearchEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeModelPicker();
  placeMode = null;
  flash('place: cancelled');
});

function computeMouseCell(e) {
  const r = canvas.getBoundingClientRect();
  const col = Math.floor(((e.clientX - r.left) / r.width) * rt.cols);
  const row = Math.floor(((e.clientY - r.top) / r.height) * rt.rows);
  return { col, row };
}

function pickCtx() {
  return {
    cam, cols: rt.cols, rows: rt.rows, pxCellW: rt.pxCellW, pxCellH: rt.pxCellH,
    world, assets, fb: frame.fb, gpuPipeline: frame.gpuPipeline, gpuActive: rt.gpuActive,
    voxelPool: frame.voxelPool,
  };
}

function formatPickResult(r) {
  const w = r.world ? `(${r.world.x.toFixed(2)}, ${r.world.y.toFixed(2)}, ${r.world.z.toFixed(2)})` : '-';
  return `pick: ${r.kind} depth=${Number.isFinite(r.depth) ? r.depth.toFixed(2) : 'inf'} world=${w}`
    + `${r.structureId ? ` struct=${r.structureId}` : ''}${r.cell ? ` cell=(${r.cell.x},${r.cell.y})` : ''}${r.entityId ? ` entity=${r.entityId}` : ''}`;
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !editorKeysActive()) return;
  if (modelPickerEl.style.display !== 'none') return; // US-063: the model picker modal owns clicks while open
  const { col, row } = computeMouseCell(e);
  if (col < 0 || col >= rt.cols || row < 0 || row >= rt.rows) return;

  if (placeMode) {
    const result = pickAt(col, row, pickCtx());
    const ray = unprojectCell(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, col, row);
    // 24.9: "at a picked point or cursor ray" - a surface/terrain/entity hit
    // gives a real point; looking at open sky falls back to a point 8 m out
    // along the click ray, so placing never silently no-ops.
    const point = result.world || rayPoint(ray, 8);
    // US-063: placing a prop opens the searchable model picker instead of
    // seeding a default model - `placeAt` runs only once the user actually
    // picks one (see `openModelPicker` below). Other kinds keep no picker
    // (their "default" fields are the whole point - a light/trigger/
    // interactable has no model to choose).
    if (placeMode === 'prop') { openModelPicker(point); return; }
    placeAt(placeMode, point);
    return;
  }

  const result = pickAt(col, row, pickCtx());
  lastPickText = formatPickResult(result);

  if (result.kind === 'entity' && result.entityId) {
    const item = selectionFromEntityId(doc, world, result.entityId);
    const already = selection && selection.fileId === item.fileId && selection.collection === item.collection && selection.id === item.id;
    selectItem(item);
    if (already) {
      const data = world.entity(result.entityId);
      if (data && data.transform) drag = { entId: result.entityId, item, index: selectionItemIndex(doc, item), startTransform: { ...data.transform } };
    }
    return;
  }
  const marker = pickMarkers(col, row, pickCtx());
  if (marker) { selectItem(marker); return; }
  selectItem(null);
});

window.addEventListener('mousemove', (e) => {
  const { col, row } = computeMouseCell(e);
  if (col >= 0 && col < rt.cols && row >= 0 && row < rt.rows) { hoverCol = col; hoverRow = row; frame.markDirty(); }
  if (!drag) return;
  const ray = unprojectCell(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, col, row);
  if (Math.abs(ray.dz) < 1e-4) return;
  const d = (drag.startTransform.z - cam.z) / ray.dz;
  if (d <= 0) return;
  const point = rayPoint(ray, d);
  const data = world.entity(drag.entId);
  if (!data) return;
  const snap = SNAP_OPTIONS[snapIdx];
  data.transform.x = snapTo(point.x, snap);
  data.transform.y = snapTo(point.y, snap);
  world.renderVersion++;
  frame.markDirty();
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !drag) return;
  const data = world.entity(drag.entId);
  const d = drag;
  drag = null;
  if (!data) return;
  const origin = originForFile(d.item.fileId);
  const isWorldSpace = d.item.fileId.startsWith('world/');
  const nextLocal = isWorldSpace
    ? { x: data.transform.x, y: data.transform.y }
    : toLocal(origin, { x: data.transform.x, y: data.transform.y, z: data.startTransform ? d.startTransform.z : data.transform.z });
  const before = selectionItemData(doc, d.item);
  if (!before) return;
  commit(makeFieldEditRecord('drag', d.item.fileId, d.item.collection, before, d.index, { x: nextLocal.x, y: nextLocal.y }));
});

// ---- overlay + mouse-look (RMB drag, per 24.5) --------------------------
const overlay = new DebugOverlay(document.body);
if (params.get('debug') === '1') overlay.toggle();

let rmbDown = false;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 2) return;
  rmbDown = true;
  if (canvas.requestPointerLock) canvas.requestPointerLock();
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 2) return;
  rmbDown = false;
  if (document.exitPointerLock) document.exitPointerLock();
});

function editorKeysActive() {
  const a = document.activeElement;
  return !(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
}

speedInput.addEventListener('change', () => {
  const v = Number(speedInput.value);
  if (Number.isFinite(v) && v > 0) speed = Math.max(0.5, Math.min(200, v));
});
canvas.addEventListener('wheel', (e) => {
  if (!editorKeysActive()) return;
  speed = adjustSpeed(speed, e.deltaY);
  speedInput.value = speed.toFixed(2);
  e.preventDefault();
}, { passive: false });

let animate = false;
animateToggle.addEventListener('change', () => { animate = animateToggle.checked; frame.markDirty(); });

function update(dt) {
  if (!editorKeysActive()) { input.endFrame(); return; }
  if (input.pressed('F3')) overlay.toggle();
  if (input.pressed('Home')) { cam = startPose(); frame.markDirty(); }
  if (input.pressed('KeyT')) teleportToSelection();
  if (input.pressed('KeyM')) { markersOn = !markersOn; frame.markDirty(); }
  if (input.pressed('KeyH')) { helpOn = !helpOn; frame.markDirty(); } // US-063 key-help overlay

  // US-032 (24.8): Esc cancels an in-progress drag (no record) instead of
  // committing it - checked before the drag's own mousemove/mouseup handlers
  // would otherwise leave the live transform wherever the mouse last was.
  if (input.pressed('Escape') && drag) {
    const data = world.entity(drag.entId);
    if (data) Object.assign(data.transform, drag.startTransform);
    drag = null;
    world.renderVersion++;
    frame.markDirty();
  } else if (input.pressed('Escape') && placeMode) {
    placeMode = null;
    flash('place: cancelled');
  }

  // US-033 (24.9): `1`/`2`/`3`/`4` arm place mode; the next left click places
  // at the picked point (or the cursor ray on open sky, see the mousedown
  // handler above).
  for (const code of Object.keys(PLACE_KEYS)) {
    if (input.pressed(code)) { placeMode = PLACE_KEYS[code]; flash(`place: ${placeMode} (click to place, Esc to cancel)`); }
  }

  if (input.pressed('BracketLeft')) { snapIdx = (snapIdx - 1 + SNAP_OPTIONS.length) % SNAP_OPTIONS.length; flash(`snap: ${SNAP_OPTIONS[snapIdx]} m`); }
  if (input.pressed('BracketRight')) { snapIdx = (snapIdx + 1) % SNAP_OPTIONS.length; flash(`snap: ${SNAP_OPTIONS[snapIdx]} m`); }
  if (input.pressed('ArrowLeft')) applyNudge('x', -1);
  if (input.pressed('ArrowRight')) applyNudge('x', 1);
  if (input.pressed('ArrowUp')) applyNudge('y', -1);
  if (input.pressed('ArrowDown')) applyNudge('y', 1);
  if (input.pressed('PageUp')) applyNudge('z', 1);
  if (input.pressed('PageDown')) applyNudge('z', -1);
  if (input.pressed('KeyQ')) applyYaw(-45);
  if (input.pressed('KeyE')) applyYaw(45);
  if (input.pressed('KeyG')) dropToFloor();
  if (input.pressed('Delete') || input.pressed('Backspace')) deleteSelected();
  const ctrl = input.isDown('ControlLeft') || input.isDown('ControlRight');
  if (ctrl && input.pressed('KeyZ')) doUndo();
  if (ctrl && input.pressed('KeyY')) doRedo();
  if (ctrl && input.pressed('KeyS')) doSave(); // US-034 (24.10)
  if (input.pressed('KeyP') && !ctrl) doPlaytest(); // US-034 (24.11)

  // Always drain the accumulated mouse delta (even while RMB is up), same
  // "discard unless active" precedent as PlayerLook - otherwise a stale
  // delta from before the RMB press would apply as one big jump on drag start.
  const { dx, dy } = input.consumeMouseDelta();
  const changed = updateCamera(cam, input, dt, { speed, lookDx: rmbDown ? dx : 0, lookDy: rmbDown ? dy : 0 });
  if (changed) {
    frame.markDirty();
    savePoseDebounced(cam);
  }
  input.endFrame();
}

// US-063: `H` key-help overlay - every editor key, drawn into the viewport
// (not just the always-visible sidebar text in index.html, which a
// fullscreen/kiosk-style pass of the editor would never show). Same route as
// the selection highlight/markers above: plain `rt.setCell` writes (via
// `drawText`) before `present()`, so they survive the GPU compositor pass
// (24.4's "JS-written rt cells survive the GPU pass" note).
const HELP_LINES = [
  'EDITOR KEYS (H to close)',
  'LMB: select / drag        RMB drag: look',
  'WASD/R/F: fly   Shift: fast   Ctrl: slow   Wheel: fly speed',
  'Arrows: nudge x/y   PgUp/PgDn: nudge z   [ ]: cycle snap',
  'Q/E: yaw   G: drop to floor   Del/Backspace: delete',
  'Ctrl+Z/Y: undo/redo   T: teleport to selection   Home: start pose',
  'M: toggle markers   F3: debug overlay',
  '1/2/3/4: place prop/light/trigger/interactable, then click',
  'Esc: cancel drag/place',
  'Ctrl+S: save   P: play-test (new tab)',
];

function drawHelpOverlay() {
  const fg = (assets.palette.colors && assets.palette.colors.uiText) || '#e8e2d0';
  const bg = '#0c120c'; // matches index.html's #panel background
  const x0 = 2, y0 = 2;
  let width = 0;
  for (const line of HELP_LINES) width = Math.max(width, line.length);
  for (let i = 0; i < HELP_LINES.length; i++) {
    drawText(rt, x0, y0 + i, HELP_LINES[i].padEnd(width, ' '), fg, bg);
  }
}

function drawOverlay(fb) {
  drawSelectionHighlight(rt, cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, world, assets, doc, selection, '#ffd24a');
  if (markersOn) drawMarkers(rt, cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, world, assets.palette, selection);
  drawHoverOutline(rt, hoverCol, hoverRow, '#7CFC7C');
  if (helpOn) drawHelpOverlay();
  void fb;
}

let lastPresented = 0;
function render() {
  const rendered = frame.step(world, cam, { animate, dt: 1 / 60, drawOverlay });
  if (rendered) lastPresented++;
  if (overlay.shouldRefresh(performance.now())) {
    const fps = engine.loop.stats.intervalMs > 0 ? 1000 / engine.loop.stats.intervalMs : 0;
    const selText = selection ? `${selection.fileId}/${selection.collection}/${selection.id}${drag ? ' (dragging)' : ''}` : '(none)';
    overlay.update(fps, engine.loop.stats.jsMs,
      `pose: ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}  yaw ${cam.yawDeg.toFixed(0)} pitch ${cam.pitchDeg.toFixed(0)}\n`
      + `speed: ${speed.toFixed(1)} m/s  animate: ${animate}  snap: ${SNAP_OPTIONS[snapIdx]} m  cell: (${hoverCol ?? '-'},${hoverRow ?? '-'})\n`
      + `selected: ${selText}${placeMode ? `  place: ${placeMode}` : ''}\n`
      + `${lastPickText}\n`
      + `presented: ${lastPresented}  backend: ${rt.backend}${frame.gpuPipeline ? ' gpu' : ' js'}`);
  }
  statusEl.textContent = (doc.readOnly ? 'content: design/*.js (read-only source)\n' : '') + lastPickText;
}

window.__editor = {
  engine, assets, doc, cam, frame,
  get world() { return world; },
  get selection() { return selection; },
  get placeMode() { return placeMode; },
  get helpOn() { return helpOn; },
  undoStack,
  pickAt: (col, row) => pickAt(col, row, pickCtx()),
  selectItem, deleteSelected, applyNudge, applyYaw, dropToFloor, doUndo, doRedo,
  placeAt, classifyPlacement: (pt) => classifyPlacement(world, pt), commitFieldEdit, renameSelected,
  doSave, doLoad, doPlaytest, refreshIoStatus, validateDoc: () => validateDoc(doc, window.ASSETS),
  openModelPicker, closeModelPicker,
};

if (!gpuBlocked) engine.run({ update, render });
