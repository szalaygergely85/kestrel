// tools/editor/main.js - US-031 boot (docs/architecture.md 24.3), the
// M1.5 editor's fly-cam viewer over the tower world. Imports only
// engine/index.js (check-deps rule 3 + the editor boundary rule: no `game/`
// import) - `design/` stays classic <script> tags, like game/index.html.
import {
  AssetRegistry, createEngine, createRenderer, GRID_DEFAULT_COLS, clampGrid, MAX_LIGHTS,
  loadContentPack, ContentError, World, validateBehaviours, registerBehaviour,
  DebugOverlay, drawText, validateVoxelModel, PITCH_CLAMP_PITCHED_DEG, createEditLayer,
} from '../../engine/index.js';
import {
  createDoc, selectionFromEntityId, selectionEntityId, selectionItemData, selectionItemIndex,
  listOutlinerItems, frameFor, itemToWorld, worldToItem, mintId, fileKey,
} from './doc.js';
import { createFrame, editorRenderer } from './frame.js';
import { createCameraPose, updateCamera, startPoseForStructure, adjustSpeed, clonePose } from './camera.js';
import { unprojectCell, rayPoint, projectPoint } from './ray.js';
import { pickAt, pickMarkers } from './pick.js';
import { drawSelectionHighlight, drawMarkers, drawHoverOutline } from './select.js';
import {
  makeRecord, makeFieldEditRecord, makeDeleteRecord, makeInsertRecord, makeRenameBatch,
  applyEdit, invert, findReferrers,
} from './commands.js';
import { createStack } from './undo.js';
import { isPatchableRecord, applyPropTransformPatch, applyLightPatch, findLightHandle } from './livepatch.js';
import {
  PLACE_KEYS, isValidId, countLights, harvestBehaviourNames, defaultItemForKind,
  defaultWorldPropItem, kindForSelection, validateItem, renderPropertyPanel,
  classifyPlacement, listPlaceableModels, filterModelKeys, KIND_GLYPHS, isVoxelScaleItem,
  resolveDropPoint, resolveAssetDrop,
  // ED-FOLDERS-01 (docs/backlog.md): pure folder derivation + layout state.
  createAssetFoldersState, parseAssetFolders, serializeAssetFolders, listUserFolders,
  createUserFolder, renameUserFolder, deleteUserFolder, moveAssetToFolder, groupAssetFolders,
} from './panel.js';
import { nextScale, fineScale, clampScale } from './scale.js';
import { validateDoc, saveAll, loadFile, launchPlaytest, anyDirty, pickBinaryFile, saveTerrainEdits } from './io.js';
import {
  BRUSH_OPS, PAINT_TYPES, effectiveStrength, beginStroke, endStroke, isTerrainRecord, applyTerrainSide, rectToWorld, ringPoints,
} from './terrainBrush.js';
import { getModelThumbnail } from './thumbnails.js';
import {
  createVisibilityState, isHidden, isLocked, setHiddenFlag, setLockedFlag,
  setEntityComponentsHidden, setLightHiddenLive, pickSelectionOrNull,
} from './visibility.js';
// OWN-REQ-011: "Import .vox" (Assets tab) - the same portable vox parser
// tools/vox-import.mjs's CLI uses (voxParse.js), plus the editor-only
// auto color-to-material mapper that replaces its hand-written map.json
// step (voxAutoMap.js). Both are plain tools/**/*.js, not engine/ or
// game/ - allowed from tools/editor/** (check-deps rules 3/6 only restrict
// engine/game imports, not tools/-to-tools/ imports).
import { parseVox, buildVoxelModel, usedPaletteEntries } from '../voxParse.js';
import { autoMapColors } from '../voxAutoMap.js';
import { deriveVoxModelName } from './voxImportName.js';
import { createRebuildScheduler } from './rebuildScheduler.js';
import { createIconCache, createIconQueue, iconModel } from './iconFit.js';
import { createIconRenderer } from './iconRender.js';
import { EDITOR_PLATE_BG } from './overlayStyle.js';
import { iconAsset, meshIconKey, meshKeyFromIcon, listMeshAssetGroups } from './meshAssets.js';
import { createMeshPlacement, snapMeshOrigin, prepareMeshEdit, validateMeshRename } from './meshPlace.js';
import { renderMeshPanel } from './meshPanel.js';

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
// US-066 reskin: ribbon/dock/drawer chrome (styling + small UI-state wiring
// only - every element below drives the SAME functions the old plain sidebar
// and keyboard shortcuts already called; no new edit/commit path).
const treeSearchInput = document.getElementById('tree-search-input');
const treeChipsEl = document.getElementById('tree-chips');
const snapBtn = document.getElementById('snap-btn');
const toolModeGroupEl = document.getElementById('tool-mode-group');
const camPlateEl = document.getElementById('cam-plate');
const statsPlateEl = document.getElementById('stats-plate');
const placeToolbarEl = document.getElementById('place-toolbar');
const leftDockEl = document.getElementById('left-dock');
const rightDockEl = document.getElementById('right-dock');
const leftDockCollapseBtn = document.getElementById('left-dock-collapse');
const rightDockCollapseBtn = document.getElementById('right-dock-collapse');
const drawerEl = document.getElementById('drawer');
const drawerCollapseBtn = document.getElementById('drawer-collapse-btn');
const drawerTabs = document.querySelectorAll('.drawer-tab');
const keysPanelEl = document.getElementById('keys-panel');
// US-063: the place-a-prop model picker (a searchable list, shown right
// after clicking a surface in place-prop mode instead of a later panel
// fix-up - see `openModelPicker` below).
const modelPickerEl = document.getElementById('model-picker');
const modelPickerSearchEl = document.getElementById('model-picker-search');
const modelPickerListEl = document.getElementById('model-picker-list');
// US-067: Assets tab (model library) + the armed-model ribbon chip.
const leftDockTabsEl = document.getElementById('left-dock-tabs');
const treePanelEl = document.getElementById('tree-panel');
const assetsPanelEl = document.getElementById('assets-panel');
const assetsSearchInput = document.getElementById('assets-search-input');
const assetsListEl = document.getElementById('assets-list');
const assetsImportVoxBtn = document.getElementById('assets-import-vox-btn'); // OWN-REQ-011
const armedModelChipEl = document.getElementById('armed-model-chip');
// ED-FOLDERS-01: the folder toolbar row above the Assets list (create a new
// user folder; the input is shown only while creating).
const folderBarEl = document.getElementById('assets-folder-bar');
const newFolderBtnEl = document.getElementById('assets-new-folder-btn');
const newFolderInputEl = document.getElementById('assets-new-folder-input');

// ---- US-066: dock/drawer collapse state (design/editor-ui.md 2: "docks +
// drawer collapsible, state remembered (localStorage in try/catch)"). Purely
// a CSS class toggle - never touches `frame.markDirty()` or the render loop,
// so idle re-render skip stays intact.
const UI_KEY = 'kestrel.editor.ui';
function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}
function saveUiState(state) {
  try { localStorage.setItem(UI_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable - not fatal */ }
}
const uiState = loadUiState();
function applyDockCollapse() {
  leftDockEl.classList.toggle('collapsed', !!uiState.leftCollapsed);
  rightDockEl.classList.toggle('collapsed', !!uiState.rightCollapsed);
  drawerEl.classList.toggle('collapsed', !!uiState.drawerCollapsed);
}
applyDockCollapse();
leftDockCollapseBtn.addEventListener('click', () => {
  uiState.leftCollapsed = !uiState.leftCollapsed;
  applyDockCollapse();
  saveUiState(uiState);
});
rightDockCollapseBtn.addEventListener('click', () => {
  uiState.rightCollapsed = !uiState.rightCollapsed;
  applyDockCollapse();
  saveUiState(uiState);
});
drawerCollapseBtn.addEventListener('click', () => {
  uiState.drawerCollapsed = !uiState.drawerCollapsed;
  applyDockCollapse();
  saveUiState(uiState);
});

// ---- US-066: drawer tabs (Log / Keys) --------------------------------------
drawerTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    drawerTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLog = tab.dataset.tab === 'log';
    statusEl.classList.toggle('active', isLog);
    keysPanelEl.classList.toggle('active', !isLog);
  });
});

// ---- US-067: left-dock tabs (Scene Tree / Assets) --------------------------
leftDockTabsEl.querySelectorAll('.dock-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    leftDockTabsEl.querySelectorAll('.dock-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isTree = tab.dataset.dockTab === 'tree';
    treePanelEl.classList.toggle('active', isTree);
    assetsPanelEl.classList.toggle('active', !isTree);
    if (!isTree) renderAssetsList(assetsSearchInput.value);
  });
});

// ---- US-066: keyboard focus (design/editor-ui.md AC 6) - Esc blurs a
// focused tree-search/inspector field so editor keys resume; clicking the
// viewport already does this via canvas's own mousedown->focus() below.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) a.blur();
});

function gridFromParam(p, def) {
  const g = p.get('grid');
  if (!g) return def;
  const m = /^(\d+)x(\d+)$/i.exec(g.trim());
  return m ? Number(m[1]) : def;
}

// ---- content: JSON pack, with the "content/ not found" fallback (24.3) ----
window.__editorBoot?.stage('content load', 'Loading content');
let bundle = null;
try {
  bundle = await loadContentPack('../../content/manifest.json');
} catch (e) {
  if (!(e instanceof ContentError) || !/HTTP 404/.test(e.message)) throw e;
  console.warn('[editor] content/manifest.json not found - falling back to window.ASSETS (fromGlobals, read-only)');
}
window.__editorBoot?.stage('asset/world init', 'Preparing assets and world');
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

// WG-1c2: `?backend=webgpu` presents through WebGPU on the CPU path (the editor's GPU gate below stays WebGL2-only until WG-2).
const g = clampGrid(gridFromParam(params, GRID_DEFAULT_COLS));
window.__editorBoot?.stage('renderer init', 'Starting renderer');
const { rt: builtRt } = await createRenderer({ canvas, cols: g.cols, rows: g.rows, backend: params.get('backend') || 'webgl2', gpu: params.get('gpu') !== '0' });
window.__editorBoot?.stage('scene init', 'Preparing scene');
const engine = createEngine({
  canvas, assets, cols: g.cols, rows: g.rows, rays: 1, renderTarget: builtRt,
  gpu: params.get('gpu') !== '0', inputTarget: canvas,
  shadows: { sun: params.get('shadows') === 'map' ? 'map' : 'dda' }, // 31.6 passthrough
  uiGrid: (assets.uiStyle && assets.uiStyle.uiGrid) || { cols: 160, rows: 60 },
});
const { renderTarget: rt, input } = engine;

// ---- GPU gate (24.3): a real WebGL2 pipeline is required unless ?gpu=0 ----
const gpuDevSwitch = params.get('gpu') === '0';
// BUG-EDITOR-001 fix: `?gpu=0` keeps `rt.backend === 'gl2'` (RenderTarget.js
// only shrinks the grid for it) - createFrame needs the raw param too, so it
// can skip constructing GpuCellPipeline the same way main.js does.
const frame = createFrame({ engine, assets, rt, gpuParam: !gpuDevSwitch, renderer: editorRenderer(params) });
const pitchClampDeg = frame.renderer === 'mesh' ? PITCH_CLAMP_PITCHED_DEG : 35; // 31.4: per effective renderer
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
  return s ? startPoseForStructure(s.frame, s.level) : createCameraPose({ z: 8, pitchDeg: -15 });
}

let world = engine.loadWorld(assets.world(doc.worldId));
const saved = loadSavedPose();
let cam = saved ? createCameraPose(saved) : startPose();
frame.markDirty();

engine.events.on('world:loaded', (evt) => { world = evt.world; if (toolMode === 'terrain') attachTerrain(); });

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
// US-067: the model key armed via the Assets tab's thumbnail list (a prop
// placement pre-picked, skipping the US-063 model-picker modal) - null while
// `placeMode === 'prop'` was armed the old way (a key / the ribbon's Prop
// button), in which case the modal still opens as before.
let armedModelKey = null;
// US-067: scene-tree hide/lock overlay - in-memory only (visibility.js's own
// header note: never part of `doc`, never persisted, a fresh session starts
// with nothing hidden/locked).
const visState = createVisibilityState();
// US-066: ribbon tool mode - 'move' matches the editor's pre-existing
// re-click-drag-to-move behaviour exactly (the default, so nothing changes
// unless the owner picks a different ribbon button); 'select' disables the
// re-click drag start (pick-only); 'yaw' drags to spin instead of move. Q/E
// yaw and every other key keep working in every mode (design/editor-ui.md 3).
let toolMode = 'move';
let yawDrag = null; // {entId, item, index, field, startYawDeg, startClientX} | null
// ED-SCALE-1c (34.3): 'scale' drags to resize instead of move/spin - same
// shape as yawDrag above.
let scaleDrag = null; // {entId, item, index, startScale, startClientX} | null
// ED-DND-01: asset drag-and-drop from the Assets tab. `moved` only flips once
// the pointer travels past a small threshold, so a plain click on a row still
// just ARMS the model (click-to-arm + click-to-place is untouched); a real
// drag tracks `overView`/`rawPoint` (the pick point) / `ghostPoint` (the
// snapped drop point, `resolveDropPoint`) for the viewport ghost marker.
let assetDrag = null; // {modelKey, startClientX, startClientY, moved, overView, lastCol, lastRow, rawPoint, ghostPoint} | null

function flash(msg) {
  lastPickText = msg;
}

// ---- ED-TERRAIN-1c: terrain brush (docs/architecture.md 37.12) -------------
// One stroke = beginStroke -> dab per fixed arc-length step (applyDab + rebakeRect) -> mouse-up: endStroke =
// ONE undo record + refreshTerrainScatter. The layer is the engine's own; `tb.dirty` is the edits file's dirty flag.
const tb = {
  op: 'raise', radius: 6, pct: 40, paintId: PAINT_TYPES[PAINT_TYPES.length - 1].id,
  layer: null, key: null, terrain: null, handle: null, dirty: false,
  stroke: null, hover: null, // hover: {x, y} world point under the cursor (terrain hits only)
};
const terrainToolbarEl = document.getElementById('terrain-toolbar');
const tbStatusEl = document.getElementById('tb-status');
const tbRadiusEl = document.getElementById('tb-radius');
const tbStrengthEl = document.getElementById('tb-strength');
const tbPaintEl = document.getElementById('tb-paint');

/** Binds the brush to the live world's Terrain: reuse the edit layer World.load built from the edits file, else a fresh one. */
function attachTerrain() {
  const t = world && world.terrain;
  if (!t) { tb.terrain = null; return; }
  if (tb.terrain === t) return;
  if (tb.layer) t.setEdits(tb.layer); // a different Terrain instance (not the normal rebuild path): keep the unsaved layer
  else { if (!t.edits) t.setEdits(createEditLayer(2, 128)); tb.layer = t.edits; }
  tb.terrain = t;
  tb.key = world.terrainKey;
}

function updateTerrainToolbar() {
  terrainToolbarEl.classList.toggle('on', toolMode === 'terrain');
  terrainToolbarEl.querySelectorAll('.tb-op').forEach((b) => b.classList.toggle('active', b.dataset.op === tb.op));
  tbPaintEl.style.display = tb.op === 'paint' ? '' : 'none';
  tbRadiusEl.nextElementSibling.textContent = `${tb.radius} m`;
  tbStrengthEl.nextElementSibling.textContent = `${tb.pct}%`;
  if (toolMode === 'terrain') { attachTerrain(); tbStatusEl.textContent = tb.terrain ? `terrain "${tb.key}"` : 'this world has no terrain'; }
  frame.markDirty();
}
for (const t of PAINT_TYPES) { const o = document.createElement('option'); o.value = String(t.id); o.textContent = t.name; tbPaintEl.appendChild(o); }
tbPaintEl.value = String(tb.paintId);
tbPaintEl.addEventListener('change', () => { tb.paintId = Number(tbPaintEl.value); });
tbRadiusEl.addEventListener('input', () => { tb.radius = Number(tbRadiusEl.value); updateTerrainToolbar(); });
tbStrengthEl.addEventListener('input', () => { tb.pct = Number(tbStrengthEl.value); updateTerrainToolbar(); });
document.getElementById('tb-save').addEventListener('click', async () => {
  // Independent of the level/world validation (Save may be disabled while those are invalid): only the edits file.
  if (!tb.layer) { flash('terrain: nothing to save'); return; }
  try { await saveTerrainEdits(tb, { forceDownload: !!doc.readOnly }); flash(`saved: terrainEdits/${tb.key}`); } catch (e) { flash(`terrain save failed: ${e && e.message ? e.message : e}`); }
  refreshIoStatus();
});
terrainToolbarEl.querySelectorAll('.tb-op').forEach((b) => b.addEventListener('click', () => {
  if (BRUSH_OPS.includes(b.dataset.op)) { tb.op = b.dataset.op; updateTerrainToolbar(); }
}));

/** Re-bakes a sample rect after a dab / undo (the mesh set picks the dirty rect up on its next step). */
function rebakeSampleRect(r) {
  const [x0, y0, x1, y1] = rectToWorld(tb.layer, r);
  tb.terrain.rebakeRect(x0, y0, x1, y1);
  world.renderVersion++;
  frame.markDirty();
}

function terrainStrokeStart(pt) {
  attachTerrain();
  if (!tb.terrain || !tb.terrain.nearReady) { flash('terrain: no baked terrain here'); return; }
  const ctx = { layer: tb.layer, terrain: tb.terrain, key: tb.key };
  tb.stroke = beginStroke(ctx, { op: tb.op, radius: tb.radius, strength: effectiveStrength(tb.op, tb.pct, tb.paintId), x: pt.x, y: pt.y });
  terrainStrokeMove(pt);
}

function terrainStrokeMove(pt) {
  const s = tb.stroke;
  if (!s) return;
  for (const [x, y] of s.points(pt.x, pt.y)) {
    const r = s.dab(x, y);
    if (r) rebakeSampleRect(r);
  }
}

/** Finishes (or, with `cancel`, reverts) the stroke; a real stroke becomes ONE undo record. */
function terrainStrokeEnd(cancel) {
  const s = tb.stroke;
  tb.stroke = null;
  if (!s) return;
  const rec = endStroke({ layer: tb.layer, terrain: tb.terrain, key: tb.key }, s);
  if (!rec) return;
  if (cancel) { applyTerrainSide(tb.layer, rec, rec.before); rebakeSampleRect(rec.rect); }
  const t0 = performance.now();
  const sc = world.refreshTerrainScatter();
  if (cancel) { flash('terrain: stroke cancelled'); return; }
  undoStack.push(rec);
  tb.dirty = true;
  refreshIoStatus();
  flash(`terrain ${s.op}: ${s.dabs} dabs, scatter ${(performance.now() - t0).toFixed(0)} ms (${sc.trees} trees)`);
}

/** Undo/redo of a stroke record: write the side into the layer, rebake, refresh scatter. */
function applyTerrainRecordSide(rec, side) {
  attachTerrain();
  if (!tb.terrain) return;
  rebakeSampleRect(applyTerrainSide(tb.layer, rec, side));
  world.refreshTerrainScatter();
  tb.dirty = true;
  refreshIoStatus();
}

/** Cursor ring on the terrain (projected 48-point circle just above the ground). */
function drawTerrainCursor() {
  if (toolMode !== 'terrain' || !tb.hover || !tb.terrain) return;
  const radius = tb.stroke ? tb.stroke.radius : tb.radius;
  const hex = tb.stroke ? '#ffd24a' : '#7CFC7C';
  for (const [x, y] of ringPoints(tb.hover.x, tb.hover.y, radius)) {
    const p = projectPoint(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, { x, y, z: tb.terrain.heightAt(x, y) + 0.15 }, frame.renderer);
    if (!(p.depth > 0)) continue;
    const c = Math.round(p.col), r = Math.round(p.row);
    if (c >= 0 && c < rt.cols && r >= 0 && r < rt.rows) rt.setCell(c, r, 'o', hex, EDITOR_PLATE_BG);
  }
}

// ---- US-066: ribbon readouts (tool mode / snap / place toolbar) -----------
function updateToolModeButtons() {
  toolModeGroupEl.querySelectorAll('.tool-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === toolMode);
  });
}
toolModeGroupEl.querySelectorAll('.tool-mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    toolMode = btn.dataset.mode;
    updateToolModeButtons();
    updateTerrainToolbar();
  });
});
updateToolModeButtons();

function updateSnapReadout() {
  snapBtn.textContent = `# Snap ${SNAP_OPTIONS[snapIdx]}m`;
}
function cycleSnap(dir) {
  snapIdx = (snapIdx + dir + SNAP_OPTIONS.length) % SNAP_OPTIONS.length;
  updateSnapReadout();
  flash(`snap: ${SNAP_OPTIONS[snapIdx]} m`);
}
snapBtn.addEventListener('click', () => cycleSnap(1));
updateSnapReadout();

function updatePlaceToolbar() {
  placeToolbarEl.querySelectorAll('.place-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kind === placeMode);
  });
}
/** Every `placeMode` write goes through here so the ribbon/toolbar highlight
 * always matches, whether set by a key (1-4), a toolbar click, or a
 * refuse/cancel/place-committed path clearing it back to null. */
function setPlaceMode(k) {
  placeMode = k;
  if (k !== 'prop') armedModelKey = null; // US-067: an armed Assets-tab model only ever applies to prop placement
  updatePlaceToolbar();
  updateArmedModelChip();
}

/** US-067: arms placement of `key` (an Assets-tab thumbnail click) - the next viewport click places it via the SAME `placeAt` path the US-063 model-picker modal uses, with no modal step. */
function armModelPlacement(key) {
  armedModelKey = key;
  setPlaceMode('prop');
  flash(`place: ${meshKeyFromIcon(key) === null ? 'prop' : 'mesh'} "${meshKeyFromIcon(key) ?? key}" (click viewport to place, Esc to cancel)`);
}

/** US-067 AC: "the ribbon shows the currently-armed model name". */
function updateArmedModelChip() {
  if (placeMode === 'prop' && armedModelKey) {
    armedModelChipEl.textContent = `${meshKeyFromIcon(armedModelKey) === null ? 'model' : 'mesh'}: ${meshKeyFromIcon(armedModelKey) ?? armedModelKey}`;
    armedModelChipEl.style.display = '';
  } else {
    armedModelChipEl.style.display = 'none';
  }
}
placeToolbarEl.querySelectorAll('.place-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Same "arm placement, next click places" code path as the 1/2/3/4 keys
    // (update()'s PLACE_KEYS loop below) - just a mouse entry point into it.
    setPlaceMode(placeMode === btn.dataset.kind ? null : btn.dataset.kind);
    flash(placeMode ? `place: ${placeMode} (click to place, Esc to cancel)` : 'place: cancelled');
  });
});
updatePlaceToolbar();

/** The placed structure a level file's items live in (null for a world file). US-064: also used to find a light's live `${structId}.${lightId}` key. */
function structureForFile(fileId) {
  if (fileId.startsWith('world/')) return null;
  const levelId = fileId.slice('level/'.length);
  return world.structures.find((st) => st.level && st.level.name === levelId) || null;
}

// CO-7 (docs/coordinates.md 7): `originForFile` is deleted - every local<->
// world conversion now goes through `frameFor(world, selection)` (structId,
// never a level-name/`isWorldSpace` guess) + `itemToWorld`/`worldToItem`
// (doc.js). `structureForFile` itself stays (still needed to find a level
// file's live `${structId}.${lightId}` key in `patchLive` below, and it has
// no selection/structId to go on there - an `EditRecord` only carries
// `fileId`, same pre-existing "first structure using this level" limitation).

// ---- US-067: scene-tree hide/lock - live application ------------------------
// `visState` (visibility.js) is the source of truth for WHICH items are
// hidden/locked; these two functions push that onto the live `world`/
// `frame.lightSet` (never onto `doc` - see visibility.js's own header note).
// Locked has no live state to push (it is only ever checked at pick/drag
// time, in the canvas mousedown handler below) - only hidden does.

/** Applies (or clears) one item's live hidden state - a prop/world-entity's components are stashed/restored (visibility.js), a light's glow is toggled via its live `LightSet` handle (US-069's `setOn`). No-ops quietly when the live entity/light isn't found (e.g. right after a rebuild, before this is reapplied - see `reapplyVisibility`). */
function applyHiddenForItem(item, hidden) {
  if (item.collection === 'lights') {
    const s = structureForFile(item.fileId);
    const ls = frame.lightSet;
    if (!s || !ls) return;
    const handle = findLightHandle(ls, `${s.id}.${item.id}`);
    if (handle === -1) return;
    const data = selectionItemData(doc, item);
    setLightHiddenLive(ls, handle, hidden, data ? data.on !== false : true);
    return;
  }
  const entId = selectionEntityId(world, item);
  if (!entId) return;
  const data = world.entity(entId);
  if (data) setEntityComponentsHidden(data, hidden);
}

/** Toggles one item's hidden flag (an eye-icon click) and applies it live immediately. */
function toggleItemHidden(item) {
  const next = !isHidden(visState, item);
  setHiddenFlag(visState, item, next);
  applyHiddenForItem(item, next);
  world.renderVersion++;
  frame.markDirty();
  renderOutliner();
}

/** Toggles one item's locked flag (a lock-icon click) - checked at pick/drag time only, nothing to apply live. */
function toggleItemLocked(item) {
  setLockedFlag(visState, item, !isLocked(visState, item));
  renderOutliner();
}

/**
 * Reapplies every currently-hidden item's live state onto a freshly rebuilt
 * `world`/`frame.lightSet` (US-067 AC: "survives a rebuild - add/delete/undo
 * elsewhere - within the same editor session"). Called right after
 * `engine.setWorld(w)` in `rebuild()`, where `frame.lightSet` is already
 * live (built synchronously off the `world:loaded` event, see frame.js).
 */
function reapplyVisibility() {
  for (const item of visState.hidden.values()) applyHiddenForItem(item, true);
  world.renderVersion++;
  frame.markDirty();
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
  const s = structureForFile(rec.fileId);
  const sFrame = s ? s.frame : null; // CO-7: `frame` (module scope) is the render frame - this is the coordinate Frame
  if (rec.collection === 'lights') {
    const ls = frame.lightSet;
    if (!s || !ls) return false;
    const handle = findLightHandle(ls, `${s.id}.${rec.id}`);
    if (handle === -1) return false;
    applyLightPatch(ls, handle, item, sFrame, assets.palette);
    frame.markDirty();
    return true;
  }
  const entId = selectionEntityId(world, { fileId: rec.fileId, collection: rec.collection, id: rec.id, structId: s ? s.id : null });
  if (!entId) return false;
  const data = world.entity(entId);
  if (!data) return false;
  applyPropTransformPatch(data.transform, item, sFrame);
  world.rebuildPropColliders(); // PROP-COLLIDE-01: committed move/undo/redo, never the drag preview.
  world.renderVersion++;
  frame.markDirty();
  return true;
}

function normZero(v) { return v === 0 ? 0 : v; }
function snapTo(v, snap) { return normZero(Math.round(v / snap) * snap); }

/** `engine.setWorld(World.load(...))` - the one mutation path's rebuild (24.8). <= 5 ms budget. */
function rebuild() {
  const t0 = performance.now();
  const w = World.load(assets.world(doc.worldId), assets, { events: engine.events, terrain: engine.world && engine.world.terrain });
  engine.setWorld(w);
  reapplyVisibility(); // US-067: hide/lock survives this rebuild (in-memory overlay, never in `doc`)
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
 * Add/delete/rename/any other field (a prop's `model` and anything not in
 * `PROP_LIVE_FIELDS`/`LIGHT_LIVE_FIELDS` - `livepatch.js`; US-069 added a
 * light's `preset` to that set via `LightSet.setParams`) still falls through
 * to the full `rebuild()`.
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
  lastRebuildFlash = `${rec.id ? `${rec.label} "${rec.id}"` : rec.label}`;
  // 31.3: field edits coalesce to one rebuild per frame; place/delete/batch rebuild now (callers read the new world).
  if (rec.batch || rec.before == null || rec.after == null) rebuildSched.flushNow();
  else rebuildSched.request();
}

let lastRebuildFlash = '';
/** ED-MESH-1d: coalesces the commit() rebuilds (flushed from the frame loop, `render()`). */
const rebuildSched = createRebuildScheduler(rebuild, (ms, folded) => {
  console.log(`[editor] rebuild ${ms.toFixed(1)} ms${folded > 1 ? ` (${folded} edits coalesced)` : ''}`);
  window.__lastRebuildMs = ms;
  flash(`${lastRebuildFlash} (rebuild ${ms.toFixed(2)} ms)`);
});

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
  rebuildSched.flushNow(); // 31 amendment 2: undo/redo folds any pending coalesced request
}

function doUndo() {
  const rec = undoStack.undo();
  if (!rec) { flash('undo: nothing to undo'); return; }
  if (isTerrainRecord(rec)) { applyTerrainRecordSide(rec, rec.before); flash(`undo: ${rec.label}`); return; }
  const inv = invert(rec);
  followRename(inv);
  applyEdit(doc, inv);
  applyAndSync(inv);
  flash(`undo: ${rec.label}`);
}

function doRedo() {
  const rec = undoStack.redo();
  if (!rec) { flash('redo: nothing to redo'); return; }
  if (isTerrainRecord(rec)) { applyTerrainRecordSide(rec, rec.after); flash(`redo: ${rec.label}`); return; }
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
function commitMeshPatch(item, patch, label = 'edit') {
  if (!item.mesh) return ['mesh: level structures are read-only'];
  const file = doc.files.get(selection.fileId);
  const { after, errors } = prepareMeshEdit(item, patch, { assets, world, file });
  if (errors.length) { flash(`${label} refused: ${errors.join('; ')}`); return errors; }
  commit(makeRecord(label, selection.fileId, 'structures', item.id, selectionItemIndex(doc, selection), item, after));
  return [];
}

function commitFieldEdit(patch) {
  if (!selection) return;
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (selection.collection === 'structures') return commitMeshPatch(item, patch);
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('edit', selection.fileId, selection.collection, item, index, patch));
}

/** Property-panel Scale row commit (34.3): `raw` already clamped by panel.js's own `clampScale` call. */
function commitScaleField(next) {
  if (!selection) return;
  const item = selectionItemData(doc, selection);
  if (!item) return;
  const index = selectionItemIndex(doc, selection);
  commitScaleEdit(selection.fileId, selection.collection, item, index, next);
}

/** Property-panel id rename (24.9): validated here too (defence in depth - the form already checks), one batch record. */
function renameSelected(newId, setError) {
  if (!selection) return;
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (selection.collection === 'structures') {
    const errors = validateMeshRename(newId);
    if (errors.length) { setError(errors.join('; ')); return; }
  }
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
  const meshItem = selection?.collection === 'structures' && selectionItemData(doc, selection);
  if (meshItem?.mesh) {
    renderMeshPanel(propertiesEl, meshItem, { assets, onFieldCommit: commitFieldEdit, onRename: renameSelected });
    return;
  }
  renderPropertyPanel(propertiesEl, {
    doc, selection, assets, palette: assets.palette,
    behaviourNames: harvestBehaviourNames(doc),
    onFieldCommit: commitFieldEdit,
    onRename: renameSelected,
    onScaleCommit: commitScaleField,
  });
}

function applyNudge(axis, sign) {
  if (!selection) { flash('nudge: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (selection.collection === 'structures') {
    const origin = { ...item.origin, [axis]: item.origin[axis] + sign * SNAP_OPTIONS[snapIdx] };
    commitMeshPatch(item, { origin }, 'nudge'); return;
  }
  if (axis === 'z' && typeof item.z !== 'number') { flash('nudge: z is not numeric (e.g. "ground") - left alone'); return; }
  const sFrame = frameFor(world, selection);
  const localZ = typeof item.z === 'number' ? item.z : 0;
  const worldPos = itemToWorld(sFrame, item.x, item.y, localZ);
  const snap = SNAP_OPTIONS[snapIdx];
  const delta = { x: 0, y: 0, z: 0 };
  delta[axis] = sign * snap;
  const nextWorld = { x: worldPos.x + delta.x, y: worldPos.y + delta.y, z: worldPos.z + delta.z };
  const snapped = { x: snapTo(nextWorld.x, snap), y: snapTo(nextWorld.y, snap), z: snapTo(nextWorld.z, snap) };
  const nextLocal = worldToItem(sFrame, snapped.x, snapped.y, snapped.z);
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
  if (selection.collection === 'structures') { commitMeshPatch(item, { yawDeg: next }, 'yaw'); return; }
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('yaw', selection.fileId, selection.collection, item, index, { [field]: next }));
}

/**
 * ED-SCALE-1c (34.3): commits a new scale value as ONE EditRecord. At 1 the
 * `after`'s `scale` key is deleted entirely (never written as `scale: 1`,
 * 34.1's "written only when != 1" rule) - undo/redo then round-trips to the
 * exact original object, never a stray `scale: 1`. Shared by the key step
 * (`applyScaleStep`), the panel's Scale row (`commitScaleField`) and the
 * Scale drag tool's mouseup.
 */
function commitScaleEdit(fileId, collection, item, index, next) {
  const after = { ...item };
  if (next === 1) delete after.scale; else after.scale = next;
  commit(makeRecord('scale', fileId, collection, item.id, index, item, after));
  flash(`scale: ${next}x`);
}

/** Minus/Equal (ladder) or Shift+Minus/Equal (fine +-0.05) key step (34.3). `dir` is -1/+1. */
function applyScaleStep(dir, fine) {
  if (!selection) { flash('scale: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (!isVoxelScaleItem(kindForSelection(selection), item, assets)) { flash('scale: voxel models only'); return; }
  const cur = typeof item.scale === 'number' ? item.scale : 1;
  const next = clampScale(fine ? fineScale(cur, dir) : nextScale(cur, dir));
  const index = selectionItemIndex(doc, selection);
  commitScaleEdit(selection.fileId, selection.collection, item, index, next);
}

function dropToFloor() {
  if (!selection) { flash('drop: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (selection.collection === 'structures') {
    const origin = snapMeshOrigin(world, assets.mesh(item.mesh), item.mesh, item.origin.x, item.origin.y);
    if (!origin) { flash('drop refused: no floor under mesh footprint'); return; }
    commitMeshPatch(item, { origin }, 'drop'); return;
  }
  if (item.z === 'ground') { flash('drop: z is "ground" - left alone (24.8)'); return; }
  const sFrame = frameFor(world, selection);
  const worldPos = itemToWorld(sFrame, item.x, item.y, 0);
  const floorZ = world.floorAt(worldPos.x, worldPos.y);
  if (floorZ == null) { flash('drop: no floor under this point'); return; }
  const nextZ = worldToItem(sFrame, worldPos.x, worldPos.y, floorZ).z;
  const index = selectionItemIndex(doc, selection);
  commit(makeFieldEditRecord('drop', selection.fileId, selection.collection, item, index, { z: nextZ }));
}

function deleteSelected() {
  if (!selection) { flash('delete: nothing selected'); return; }
  const item = selectionItemData(doc, selection);
  if (!item) return;
  if (selection.collection === 'structures' && !item.mesh) { flash('delete refused: level structures are read-only'); return; }
  const file = doc.files.get(selection.fileId);
  if (selection.collection === 'props' || selection.collection === 'structures') {
    const referrers = findReferrers(file.def, file.kind, selection.collection, item.id);
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
    if (item?.mesh && item.origin) point = item.origin;
    if (item && typeof item.x === 'number' && typeof item.y === 'number') {
      const sFrame = frameFor(world, selection);
      const z = typeof item.z === 'number' ? item.z : 0;
      point = itemToWorld(sFrame, item.x, item.y, z);
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
  const desc = it.mesh || it.model || it.preset || it.type || '';
  return `${o.id}${desc ? ' (' + desc + ')' : ''}`;
}

// US-066: scene tree filter chips + id search (design/editor-ui.md 3: "Chips
// = ALL / STRUCT / PROPS / LIGHTS / TRIGGERS / INTERACT (the doc's real
// kinds) with counts"). `entities` (world-file items) map to STRUCT - the
// doc's other collection is per-level (props/lights/triggers/interactables).
let treeFilter = 'all'; // 'all' | a listOutlinerItems() collection name
let treeSearch = '';
const TREE_CHIP_LABELS = { all: 'ALL', entities: 'STRUCT', structures: 'MESHES', props: 'PROPS', lights: 'LIGHTS', triggers: 'TRIGGERS', interactables: 'INTERACT' };

treeSearchInput.addEventListener('input', () => { treeSearch = treeSearchInput.value; renderOutliner(); });
treeChipsEl.querySelectorAll('.tree-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    treeFilter = chip.dataset.filter;
    treeChipsEl.querySelectorAll('.tree-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderOutliner();
  });
});

function renderOutliner() {
  outlinerEl.textContent = '';
  const allItems = listOutlinerItems(doc, world); // CO-7: attaches structId per level-owned item

  const counts = { all: allItems.length, entities: 0, props: 0, lights: 0, triggers: 0, interactables: 0 };
  for (const o of allItems) counts[o.collection] = (counts[o.collection] || 0) + 1;
  treeChipsEl.querySelectorAll('.tree-chip').forEach((chip) => {
    const key = chip.dataset.filter;
    chip.textContent = `${TREE_CHIP_LABELS[key]} (${counts[key] || 0})`;
  });

  const q = treeSearch.trim().toLowerCase();
  const filtered = allItems.filter((o) => {
    if (treeFilter !== 'all' && o.collection !== treeFilter) return false;
    if (q && !o.id.toLowerCase().includes(q)) return false;
    return true;
  });

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = allItems.length ? '(no match)' : '(no props/lights/interactables/entities)';
    outlinerEl.appendChild(empty);
    return;
  }

  // Group by fileId (a level or the world file) so the tree reads as
  // structure -> its props/lights/... , with `├─`/`└─` branch glyphs
  // (design/editor-ui.md 4) - purely a visual grouping, same flat
  // `listOutlinerItems` data and the same `selectItem` click path as before.
  const groups = new Map();
  for (const o of filtered) {
    const group = o.collection === 'structures' ? `${o.fileId} / Meshes` : o.fileId;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(o);
  }
  for (const [fileId, items] of groups) {
    const header = document.createElement('div');
    header.className = 'tree-group-header';
    header.textContent = fileId;
    outlinerEl.appendChild(header);
    items.forEach((o, i) => {
      const item = { fileId: o.fileId, collection: o.collection, id: o.id };
      const row = document.createElement('div');
      row.className = 'tree-row';
      const isSel = selection && selection.fileId === o.fileId && selection.collection === o.collection && selection.id === o.id;
      if (isSel) row.classList.add('selected');
      const hidden = isHidden(visState, item);
      const locked = isLocked(visState, item);
      if (hidden) row.classList.add('row-hidden');
      if (locked) row.classList.add('row-locked');
      const branch = document.createElement('span');
      branch.className = 'tree-branch';
      branch.textContent = i === items.length - 1 ? '└─' : '├─';
      const glyph = document.createElement('span');
      glyph.className = 'tree-glyph';
      glyph.textContent = KIND_GLYPHS[kindForSelection({ collection: o.collection })] || '?';
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = selectableLabel(o);
      row.appendChild(branch);
      row.appendChild(glyph);
      row.appendChild(label);
      // US-067: eye (hidden = not drawn in the 3D viewport) + lock (locked =
      // skipped by viewport pick and drag) - stopPropagation so the icon
      // click never also fires the row's own select click below. Hidden/
      // locked items stay selectable from the tree (this row's own click
      // handler is untouched) and editable in the inspector (selection is
      // orthogonal to this overlay).
      const icons = document.createElement('span');
      icons.className = 'tree-row-icons';
      const eyeBtn = document.createElement('button');
      eyeBtn.type = 'button';
      eyeBtn.className = `tree-icon-btn${hidden ? ' on' : ''}`;
      eyeBtn.title = hidden ? 'Shown (click to hide)' : 'Hidden (click to show)';
      eyeBtn.textContent = hidden ? '◌' : '◉';
      eyeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleItemHidden(item); });
      const lockBtn = document.createElement('button');
      lockBtn.type = 'button';
      lockBtn.className = `tree-icon-btn${locked ? ' on' : ''}`;
      lockBtn.title = locked ? 'Locked (click to unlock)' : 'Unlocked (click to lock)';
      lockBtn.textContent = locked ? '▣' : '▢';
      lockBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleItemLocked(item); });
      icons.appendChild(eyeBtn);
      icons.appendChild(lockBtn);
      if (o.collection !== 'structures') row.appendChild(icons);
      row.addEventListener('click', () => selectItem({ fileId: o.fileId, collection: o.collection, id: o.id, structId: o.structId }));
      row.addEventListener('dblclick', () => { selectItem({ fileId: o.fileId, collection: o.collection, id: o.id, structId: o.structId }); teleportToSelection(); });
      outlinerEl.appendChild(row);
    });
  }
}
renderOutliner();
renderProperties();

// ---- US-067: Assets tab (model library) -------------------------------------

let iconStorage = null;
try { iconStorage = localStorage; } catch (_) { /* private browsing */ }
const iconCache = createIconCache(iconStorage), iconQueue = createIconQueue(1);
const iconRequests = new Map(), iconFailed = new Set();
const iconStats = { rendered: 0, failures: 0, maxPerFrame: 0, lastMs: 0, maxMs: 0, setupMs: 0, warmupMs: 0, sceneWarmupMs: 0, slowestKey: null };
let iconRenderer = null;
function showIcon(host, url) {
  host.textContent = '';
  const img = document.createElement('img');
  img.width = img.height = 96;
  img.alt = meshKeyFromIcon(host.dataset.iconKey) ?? host.dataset.iconKey;
  img.src = url;
  img.className = 'asset-icon';
  host.appendChild(img);
}
function requestIcon(key, priority = false) {
  // Sprite (billboard) models keep their ASCII thumbnail: they are flat glyph art, and in the
  // 3D icon scene they would sit small in front of the floor/room (owner 2026-10-04).
  if (meshKeyFromIcon(key) === null && !iconModel(assets.model(key)).voxel) return null;
  const hash = iconCache.key(key, iconAsset(assets, key));
  const previous = iconRequests.get(key);
  const url = iconCache.get(hash);
  iconRequests.set(key, hash);
  if (!url && !iconFailed.has(hash)) iconQueue.enqueue(key, priority || (!!previous && previous !== hash));
  return url;
}
function iconHost(key, priority = false) {
  const host = document.createElement('div');
  host.className = 'asset-icon-host'; host.dataset.iconKey = key;
  const url = requestIcon(key, priority);
  if (url) showIcon(host, url);
  else {
    let thumb;
    try { thumb = getModelThumbnail(assets, key); } catch (_) { thumb = { w: 1, h: 1, cells: [{ ch: '?', fg: null }] }; }
    host.appendChild(buildThumbEl(thumb));
  }
  return host;
}
function refreshIcons(key) {
  if (key) requestIcon(key, true);
  else {
    for (const name of assets.keys('model')) requestIcon(name);
    for (const name of assets.keys('mesh')) requestIcon(meshIconKey(name));
  }
  renderAssetsList(assetsSearchInput.value);
}
function pumpIcons() {
  if (assetsPanelEl.classList.contains('active') && !leftDockEl.classList.contains('collapsed')) {
    iconQueue.tick();
    const key = iconQueue.next();
    if (key !== null) {
      const hash = iconCache.key(key, iconAsset(assets, key)), start = performance.now();
      try {
        let url = iconCache.get(hash);
        if (!url && !iconRenderer) {
          // Engine setup and the first CPU frame each get their own animation frame.
          iconRenderer = createIconRenderer(assets);
          iconStats.setupMs = performance.now() - start;
          iconQueue.enqueue(key, true);
        } else if (!url && !iconRenderer.warmed) {
          iconRenderer.warmup();
          iconStats.warmupMs = performance.now() - start;
          iconQueue.enqueue(key, true);
        } else if (!url && !iconRenderer.sceneWarmed) {
          iconRenderer.warmupScene();
          iconStats.sceneWarmupMs = performance.now() - start;
          iconQueue.enqueue(key, true);
        } else {
          if (!url) url = iconRenderer.renderIcon(key);
          iconCache.set(hash, url);
          for (const host of document.querySelectorAll('[data-icon-key]')) if (host.dataset.iconKey === key) showIcon(host, url);
          iconStats.rendered++; iconStats.maxPerFrame = Math.max(iconStats.maxPerFrame, 1);
        }
      } catch (e) {
        iconFailed.add(hash); iconStats.failures++;
        console.warn(`[editor icon] ${key}: ${e.message}`);
      }
      iconStats.lastMs = performance.now() - start;
      if (iconStats.lastMs > iconStats.maxMs) {
        iconStats.maxMs = iconStats.lastMs; iconStats.slowestKey = key;
      }
    }
  }
  requestAnimationFrame(pumpIcons);
}
requestAnimationFrame(pumpIcons);

/** Builds a `<div class="asset-thumb">` grid of coloured `<span>`s for one `thumbnails.js` result. */
function buildThumbEl(thumb) {
  const el = document.createElement('div');
  el.className = 'asset-thumb';
  el.style.gridTemplateColumns = `repeat(${thumb.w}, 1ch)`;
  el.style.gridTemplateRows = `repeat(${thumb.h}, 1.15em)`;
  for (const cell of thumb.cells) {
    const span = document.createElement('span');
    span.textContent = cell.ch;
    span.style.color = cell.fg || 'transparent';
    el.appendChild(span);
  }
  return el;
}

// ---- ED-FOLDERS-01 (docs/backlog.md): collapsible asset folders -------------
// The layout (user folders + their members) is editor-only data, kept OUT of
// `doc` (the game never reads it). Default folders are derived at render time
// by panel.js's `deriveFolderKey`; only user folders are stored, in
// `content/editor/asset-folders.json` (loaded leniently, saved on change via
// the FSA API with the same `<a download>` fallback io.js uses). Collapse
// state is in-memory only (a fresh session shows every folder expanded).
let foldersState = createAssetFoldersState();
let foldersHandle = null; // the FSA handle for asset-folders.json, cached across saves
const collapsedFolders = new Set();
let folderHighlightEl = null; // the folder header currently lit as a drop target
let foldersSaveTimer = null;

async function loadAssetFolders() {
  try {
    const res = await fetch('../../content/editor/asset-folders.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    foldersState = parseAssetFolders(await res.text());
  } catch (e) {
    console.warn(`[editor] content/editor/asset-folders.json not found/invalid - starting with no user folders (${e && e.message ? e.message : e})`);
    foldersState = createAssetFoldersState();
  }
}

async function saveAssetFolders() {
  const text = serializeAssetFolders(foldersState);
  const name = 'asset-folders.json';
  const canPicker = typeof window.showSaveFilePicker === 'function';
  try {
    if (canPicker) {
      if (!foldersHandle) {
        foldersHandle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'Kestrel editor folders', accept: { 'application/json': ['.json'] } }],
        });
      }
      const writable = await foldersHandle.createWritable();
      await writable.write(text);
      await writable.close();
    } else {
      // Same `<a download>` fallback as io.js's saveFile (no FSA API).
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    flash('saved folders: content/editor/asset-folders.json');
  } catch (e) {
    if (e && e.name === 'AbortError') { flash('save folders: cancelled'); return; }
    flash(`save folders failed: ${e && e.message ? e.message : e}`);
  }
}

/** Debounced auto-save after a folder mutation (create/rename/delete/move). */
function persistFolders() {
  if (foldersSaveTimer) clearTimeout(foldersSaveTimer);
  foldersSaveTimer = setTimeout(() => { foldersSaveTimer = null; saveAssetFolders(); }, 400);
}

function applyFolders(next) {
  if (next === foldersState) return false;
  foldersState = next;
  persistFolders();
  return true;
}

function folderHeaderEl(folderName) {
  for (const group of assetsListEl.querySelectorAll('[data-folder-name]')) {
    if (group.dataset.folderName === folderName) return group.querySelector('.folder-header');
  }
  return null;
}

function updateFolderDropHighlight(folderName) {
  if (folderHighlightEl) { folderHighlightEl.classList.remove('drop-target'); folderHighlightEl = null; }
  if (folderName) {
    const el = folderHeaderEl(folderName);
    if (el) { el.classList.add('drop-target'); folderHighlightEl = el; }
  }
}

/** The folder under the pointer during a mouse-based asset drag (a row or its
 * header both resolve to the folder), or null when over nothing folder-like. */
function folderNameAtPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const group = el && el.closest ? el.closest('[data-folder-name]') : null;
  return group ? group.dataset.folderName : null;
}

function dropAssetIntoFolder(modelKey, folderName) {
  if (applyFolders(moveAssetToFolder(foldersState, modelKey, folderName))) {
    flash(`"${modelKey}" -> ${folderName}`);
  }
  renderAssetsList(assetsSearchInput.value);
}

function removeUserFolder(folderName) {
  if (applyFolders(deleteUserFolder(foldersState, folderName))) {
    flash(`folder "${folderName}" deleted (assets back to their default folders)`);
  }
  renderAssetsList(assetsSearchInput.value);
}

/** Swaps a folder header's name for an inline input; Enter/blur commits, Esc cancels. */
function startRenameFolder(folderName, headerEl) {
  const labelEl = headerEl.querySelector('.folder-name');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-name-input';
  input.value = folderName;
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) {
      if (applyFolders(renameUserFolder(foldersState, folderName, input.value))) {
        flash(`folder renamed to "${input.value.trim()}"`);
      }
    }
    renderAssetsList(assetsSearchInput.value);
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') finish(false);
  });
  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

function startCreateFolder() {
  newFolderBtnEl.style.display = 'none';
  newFolderInputEl.style.display = '';
  newFolderInputEl.value = '';
  newFolderInputEl.focus();
}

let createFolderDone = true;
function finishCreateFolder(save) {
  if (createFolderDone) return;
  createFolderDone = true;
  newFolderInputEl.style.display = 'none';
  newFolderBtnEl.style.display = '';
  if (save) {
    if (applyFolders(createUserFolder(foldersState, newFolderInputEl.value))) {
      flash(`folder "${newFolderInputEl.value.trim()}" created`);
    } else {
      flash(`folder not created (empty name, already exists, or a default folder)`);
    }
    renderAssetsList(assetsSearchInput.value);
  }
}

newFolderBtnEl.addEventListener('click', () => { createFolderDone = false; startCreateFolder(); });
newFolderInputEl.addEventListener('blur', () => finishCreateFolder(true));
newFolderInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') newFolderInputEl.blur();
  else if (e.key === 'Escape') finishCreateFolder(false);
});

/** Builds one asset row (the shared leaf of both the flat search view and the
 * grouped folder view) - same mousedown arm + ED-DND-01 drag as before, plus
 * a `folderTarget` slot the mousemove/mouseup handlers use for folder drops. */
function buildAssetRow(key, priority = false) {
  const row = document.createElement('div');
  row.className = 'asset-row';
  const meshKey = meshKeyFromIcon(key);
  if (armedModelKey === key) row.classList.add('armed');
  row.appendChild(iconHost(key, priority));
  const name = document.createElement('span');
  name.className = 'asset-name';
  name.textContent = meshKey === null ? key : meshKey;
  row.appendChild(name);
  if (meshKey !== null) {
    row.dataset.meshKey = meshKey;
    row.classList.add('mesh-asset-row');
    row.title = `Mesh: ${meshKey} (${assets.mesh(meshKey).triCount.toLocaleString()} triangles)`;
  }
  // mousedown (not click): same reasoning as the US-063 model-picker rows -
  // fires before the search input's blur / the canvas's own mousedown
  // handlers steal focus for this same event.
  row.addEventListener('mousedown', (e) => {
    e.preventDefault();
    armModelPlacement(key);
    renderAssetsList(assetsSearchInput.value); // refresh the "armed" highlight
    // ED-DND-01: also arm a potential drag-and-drop. The drag only really
    // begins once the pointer travels past a small threshold (see the
    // window mousemove handler), so a plain click still just ARMS the model
    // and the next viewport click places it, exactly as before.
    assetDrag = {
      modelKey: key,
      startClientX: e.clientX, startClientY: e.clientY,
      moved: false, overView: false, lastCol: -1, lastRow: -1, rawPoint: null, ghostPoint: null,
      folderTarget: null,
    };
  });
  return row;
}

/** One collapsible folder section: a header (arrow + name + count, and rename/
 * delete for user folders) over its asset rows. The header click collapses. */
function buildFolderSection(folderName, keys) {
  const section = document.createElement('div');
  section.className = 'folder-group';
  section.dataset.folderName = folderName;

  const header = document.createElement('div');
  header.className = 'folder-header';
  const isCollapsed = collapsedFolders.has(folderName);

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow';
  arrow.textContent = isCollapsed ? '▸' : '▾';
  const label = document.createElement('span');
  label.className = 'folder-name';
  label.textContent = folderName;
  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = String(keys.length);

  header.appendChild(arrow);
  header.appendChild(label);
  header.appendChild(count);

  if (Object.prototype.hasOwnProperty.call(foldersState.userFolders, folderName)) {
    const actions = document.createElement('span');
    actions.className = 'folder-actions';
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'folder-icon-btn';
    renameBtn.title = 'Rename folder';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startRenameFolder(folderName, header); });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'folder-icon-btn';
    delBtn.title = 'Delete folder (assets return to their default folders)';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); removeUserFolder(folderName); });
    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);
    header.appendChild(actions);
  }

  header.addEventListener('click', () => {
    if (collapsedFolders.has(folderName)) collapsedFolders.delete(folderName);
    else collapsedFolders.add(folderName);
    renderAssetsList(assetsSearchInput.value);
  });
  section.appendChild(header);

  if (!isCollapsed) {
    const body = document.createElement('div');
    body.className = 'folder-body';
    for (const key of keys) body.appendChild(buildAssetRow(key));
    section.appendChild(body);
  }
  return section;
}

function renderAssetsList(query) {
  assetsListEl.textContent = '';
  const keys = filterModelKeys(listPlaceableModels(assets), query || '');
  const meshGroups = listMeshAssetGroups(assets, query || '');
  if (!keys.length && !meshGroups.length) {
    const empty = document.createElement('div');
    empty.className = 'asset-empty';
    empty.textContent = '(no matching assets)';
    assetsListEl.appendChild(empty);
    return;
  }
  // Search still searches ALL folders, flat (the story's AC 4): a non-empty
  // query renders one ungrouped list, so a match in any folder is visible.
  if ((query || '').trim()) {
    for (const key of keys) assetsListEl.appendChild(buildAssetRow(key, true));
    for (const group of meshGroups) for (const key of group.keys) assetsListEl.appendChild(buildAssetRow(meshIconKey(key), true));
    return;
  }
  // No query: group into collapsible folders (user folders first, then
  // defaults - panel.js's pure `groupAssetFolders`).
  const groups = groupAssetFolders(keys, foldersState, (k) => assets.model(k));
  for (const group of groups) assetsListEl.appendChild(buildFolderSection(group.folder, group.keys));
  for (const group of meshGroups) assetsListEl.appendChild(buildFolderSection(`Meshes / ${group.pack}`, group.keys.map(meshIconKey)));
}

await loadAssetFolders();
renderAssetsList('');
assetsSearchInput.addEventListener('input', () => renderAssetsList(assetsSearchInput.value));
if (params.get('icontest') === '1') {
  const strip = document.createElement('div'); strip.id = 'icon-test-strip';
  const keys = listPlaceableModels(assets);
  const sample = [...new Set(['lever', 'farTower', ...keys].filter(key => assets.has('model', key)))].slice(0, 6);
  for (const key of sample) {
    const host = iconHost(key);
    if (!host.querySelector('img')) iconQueue.enqueue(key, true);
    strip.appendChild(host);
  }
  document.body.appendChild(strip);
  leftDockTabsEl.querySelector('[data-dock-tab="assets"]').click();
}

// ---- OWN-REQ-011: "Import .vox" (Assets tab) -------------------------------
//
// Click -> file picker -> parse (voxParse.js, single-part only for v1) ->
// auto-map every used color to the nearest design/palette.js material
// (voxAutoMap.js, no hand-written map.json) -> AssetRegistry.add() a new
// model key, immediately visible in the Assets tab. KNOWN FOLLOW-UP: the
// model DEFINITION itself is only ever added to the in-memory registry for
// this browser tab/session - it is not written to design/models/*.js or
// content/, so reloading the editor loses it (an object placed with it still
// saves fine into the world JSON via its `model` key; a later story would
// need to add a "download this model" / "save into content/" step).

// v1 default cellM (design/models/voxel_props.js's own props use this same
// value) - no UI for it yet, matches vox-import.mjs's own --cell example.
const VOX_IMPORT_DEFAULT_CELL_M = 0.05;

async function doImportVox() {
  let picked;
  try {
    picked = await pickBinaryFile({ accept: '.vox', description: 'MagicaVoxel .vox' });
  } catch (e) {
    flash(`import .vox failed: ${e && e.message ? e.message : e}`);
    return;
  }
  if (!picked) { flash('import .vox: cancelled'); return; }

  try {
    const parsed = parseVox(picked.buffer);
    const usedEntries = usedPaletteEntries(parsed.voxels, parsed.palette);
    const map = autoMapColors(usedEntries, assets.palette);
    // Single-part only for v1 (parts: false forces the OWN-REQ-005a body-box
    // path even when the file happens to carry a v200 scene graph) - see the
    // header note above.
    const def = buildVoxelModel(parsed, map, VOX_IMPORT_DEFAULT_CELL_M, null, { parts: false });
    const { errors } = validateVoxelModel(def);
    if (errors.length) throw new Error(errors.join('; '));

    const name = deriveVoxModelName(picked.name, (k) => assets.has('model', k));
    assets.add('model', name, {
      name,
      desc: `Imported from '${picked.name}' via the editor's Import .vox button (OWN-REQ-011). Colors auto-matched to the nearest palette material.`,
      voxel: def,
    });
    // The VoxelPool packs models (and the GPU DDA atlas) only in bind(); a
    // runtime add is invisible to it until re-bound (placed prop rendered
    // nothing). Re-bind with the live material table; bumps atlas.version so
    // the GPU re-uploads lazily.
    frame.voxelPool.bind(assets, frame.fb.matTable);
    frame.markDirty();
    requestIcon(name, true);
    renderAssetsList(assetsSearchInput.value);
    armModelPlacement(name);
    flash(def.meshOnly && frame.renderer !== 'mesh'
      ? `imported: ${name} (too large for the editor view: mesh-only model, placed but NOT drawn here - only on ?renderer=mesh; max 32 per axis to see it)`
      : `imported: ${name} (click viewport to place)`);
  } catch (e) {
    flash(`import .vox failed: ${e && e.message ? e.message : e}`);
  }
}
assetsImportVoxBtn.addEventListener('click', doImportVox);

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
  const err = await validateDoc(doc, window.ASSETS, { reference: bundle });
  if (gen !== ioGeneration) return; // a newer edit landed while this was in flight
  const dirty = anyDirty(doc) || tb.dirty;
  saveBtn.disabled = !!err;
  saveBtn.title = err ? err.message : '';
  ioStatusEl.textContent = err ? `invalid: ${err.message}` : (dirty ? 'unsaved changes' : 'saved');
  ioStatusEl.classList.remove('saved', 'unsaved', 'invalid');
  ioStatusEl.classList.add(err ? 'invalid' : (dirty ? 'unsaved' : 'saved'));
}
refreshIoStatus();

async function doSave() {
  try {
    const saved = await saveAll(doc);
    if (tb.dirty && tb.layer) { await saveTerrainEdits(tb, { forceDownload: !!doc.readOnly }); saved.push(`terrainEdits/${tb.key}`); }
    flash(saved.length ? `saved: ${saved.join(', ')}` : 'save: nothing dirty');
  } catch (e) {
    flash(`save failed: ${e && e.message ? e.message : e}`);
  }
  refreshIoStatus();
}

async function doLoad() {
  try {
    const fid = await loadFile(doc, assets, window.ASSETS);
    if (!fid) { flash('load: cancelled'); return; }
    undoStack.clear();
    selection = null;
    rebuild();
    refreshIcons();
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
  if (!anyDirty(doc) && !tb.dirty) return;
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
  const meshKey = modelKeyOverride ? meshKeyFromIcon(modelKeyOverride) : null;
  if (meshKey !== null) {
    const fileId = fileKey('world', doc.worldId), file = doc.files.get(fileId);
    const { item, errors, warnings } = createMeshPlacement(file, meshKey, pt, { assets, world, snapStep: SNAP_OPTIONS[snapIdx] });
    if (errors.length) { flash(`place refused: ${errors.join('; ')}`); setPlaceMode(null); return; }
    commit(makeInsertRecord(fileId, 'structures', item));
    selectItem({ fileId, collection: 'structures', id: item.id, structId: null });
    setPlaceMode(null);
    if (warnings.length) flash(warnings.join('; '));
    return;
  }
  const { zone, structure: s } = classifyPlacement(world, pt);
  if (zone === 'gap') {
    flash('place refused: no floor here (a courtyard gap or hole inside the structure)');
    setPlaceMode(null);
    return;
  }
  if (!s && kind !== 'prop') { flash(`place refused: a ${kind} must be placed inside a structure`); setPlaceMode(null); return; }
  if (kind === 'light' && countLights(doc) >= MAX_LIGHTS) { flash(`place refused: MAX_LIGHTS (${MAX_LIGHTS}) reached`); setPlaceMode(null); return; }

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
    item = defaultItemForKind(kind, id, worldToItem(s.frame, pt.x, pt.y, pt.z), { modelKey });
  } else {
    fileId = fileKey('world', doc.worldId);
    collection = 'entities';
    const file = doc.files.get(fileId);
    const id = mintId(file, 'prop');
    // ED-SNAP-1/ED-DND-01: snap to the terrain surface instead of the raw ray-pick z (both renderers - the snap
    // comes from World.floorAt, not the pick ray). `resolveDropPoint` is the SAME pure helper the drag ghost uses,
    // so a click and a drag land identically.
    item = defaultWorldPropItem(id, resolveDropPoint(world, pt), modelKey);
  }

  const file = doc.files.get(fileId);
  const siblingIds = new Set((file.def[collection] || []).map((it) => it.id));
  const validateKind = s ? kind : 'entity';
  const errors = validateItem(validateKind, item, { assets, palette: assets.palette, siblingIds });
  if (errors.length) { flash(`place refused: ${errors.join('; ')}`); setPlaceMode(null); return; }

  commit(makeInsertRecord(fileId, collection, item));
  selectItem({ fileId, collection, id: item.id, structId: s ? s.id : null });
  setPlaceMode(null);
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
      setPlaceMode(null);
      placeAt('prop', pt, key);
    });
    modelPickerListEl.appendChild(row);
  }
}

modelPickerSearchEl.addEventListener('input', () => renderModelPickerList(modelPickerSearchEl.value));
modelPickerSearchEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeModelPicker();
  setPlaceMode(null);
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
    voxelPool: frame.voxelPool, renderer: frame.renderer,
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

  if (toolMode === 'terrain') { // ED-TERRAIN-1c: the brush owns the left button
    const hit = pickAt(col, row, pickCtx());
    if (hit.kind === 'terrain' && hit.world) { tb.hover = { x: hit.world.x, y: hit.world.y }; terrainStrokeStart(tb.hover); }
    else flash('terrain: click on the terrain');
    return;
  }

  if (placeMode) {
    const result = pickAt(col, row, pickCtx());
    const ray = unprojectCell(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, col, row, frame.renderer);
    // 24.9: "at a picked point or cursor ray" - a surface/terrain/entity hit
    // gives a real point; looking at open sky falls back to a point 8 m out
    // along the click ray, so placing never silently no-ops.
    const point = result.world || rayPoint(ray, 8);
    // US-063: placing a prop opens the searchable model picker instead of
    // seeding a default model - `placeAt` runs only once the user actually
    // picks one (see `openModelPicker` below). Other kinds keep no picker
    // (their "default" fields are the whole point - a light/trigger/
    // interactable has no model to choose).
    if (placeMode === 'prop') {
      // US-067: a model already armed via the Assets tab places directly -
      // same `placeAt` call the model-picker modal's own row click makes,
      // just with no modal step in between.
      if (armedModelKey) { const key = armedModelKey; armedModelKey = null; updateArmedModelChip(); placeAt('prop', point, key); return; }
      openModelPicker(point);
      return;
    }
    placeAt(placeMode, point);
    return;
  }

  const result = pickAt(col, row, pickCtx());
  lastPickText = formatPickResult(result);

  if (result.kind === 'entity' && result.entityId) {
    const rawItem = selectionFromEntityId(doc, world, result.entityId);
    // US-067: "locked = skipped by viewport pick and drag" - a locked entity
    // is treated exactly as if the click had missed it (falls through to a
    // marker pick / clears the selection below), same as clicking open sky.
    // It stays selectable from the scene tree (that path never calls this).
    const item = pickSelectionOrNull(visState, rawItem);
    if (!item) {
      const marker = pickMarkers(col, row, pickCtx());
      if (marker) { selectItem(marker); return; }
      selectItem(null);
      return;
    }
    const already = selection && selection.fileId === item.fileId && selection.collection === item.collection && selection.id === item.id;
    selectItem(item);
    // US-066 ribbon tool mode: 'move' (the default) reproduces the pre-066
    // re-click-to-drag behaviour exactly; 'select' starts no drag at all;
    // 'yaw' drags to spin instead of translate (design/editor-ui.md 3).
    if (already && toolMode === 'move') {
      const data = world.entity(result.entityId);
      if (data && data.transform) drag = { entId: result.entityId, item, index: selectionItemIndex(doc, item), startTransform: { ...data.transform } };
    } else if (already && toolMode === 'yaw') {
      const data = world.entity(result.entityId);
      const itemData = selectionItemData(doc, item);
      const field = itemData && typeof itemData.facing === 'number' ? 'facing' : (itemData && typeof itemData.yawDeg === 'number' ? 'yawDeg' : null);
      if (data && data.transform && field) {
        yawDrag = {
          entId: result.entityId, item, index: selectionItemIndex(doc, item), field,
          startYawDeg: data.transform.yawDeg, startClientX: e.clientX,
        };
      } else if (field == null) {
        flash('yaw: item has no facing/yawDeg field');
      }
    } else if (already && toolMode === 'scale') {
      // ED-SCALE-1c (34.3): same shape as the 'yaw' branch above, but
      // gated on `isVoxelScaleItem` (voxel props/world entities only, 34.1).
      const data = world.entity(result.entityId);
      const itemData = selectionItemData(doc, item);
      if (data && data.transform && itemData && isVoxelScaleItem(kindForSelection(item), itemData, assets)) {
        scaleDrag = {
          entId: result.entityId, item, index: selectionItemIndex(doc, item),
          startScale: typeof data.transform.scale === 'number' ? data.transform.scale : 1,
          startClientX: e.clientX,
        };
      } else {
        flash('scale: voxel models only');
      }
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
  // ED-DND-01: asset drag ghost. `moved` flips only past a 4px threshold, so
  // a plain click on a row never enters this branch (click-to-arm is intact).
  if (assetDrag) {
    if (!assetDrag.moved) {
      const dx = e.clientX - assetDrag.startClientX;
      const dy = e.clientY - assetDrag.startClientY;
      if (dx * dx + dy * dy < 16) return; // < 4px - still a click, not a drag yet
      assetDrag.moved = true;
    }
    // ED-FOLDERS-01: while dragging, track whether the pointer is over a
    // folder header (a row or its header both resolve) - the mouseup handler
    // then moves the asset into that folder instead of placing/cancelling.
    const folderTarget = folderNameAtPoint(e.clientX, e.clientY);
    if (folderTarget !== assetDrag.folderTarget) {
      assetDrag.folderTarget = folderTarget;
      updateFolderDropHighlight(folderTarget);
    }
    const overView = col >= 0 && col < rt.cols && row >= 0 && row < rt.rows;
    if (!overView) {
      assetDrag.overView = false;
      assetDrag.rawPoint = null;
      assetDrag.ghostPoint = null;
      frame.markDirty();
      return;
    }
    // Same pick a click makes (surface point, falling back 8 m out on open
    // sky), then the same snap placeAt applies - so the ghost IS the drop
    // point. Re-pick only when the cell changes: readback stays bounded to
    // the drag gesture, never a per-frame cost.
    if (!assetDrag.overView || assetDrag.lastCol !== col || assetDrag.lastRow !== row) {
      assetDrag.overView = true;
      assetDrag.lastCol = col;
      assetDrag.lastRow = row;
      const result = pickAt(col, row, pickCtx());
      const ray = unprojectCell(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, col, row, frame.renderer);
      const point = result.world || rayPoint(ray, 8);
      assetDrag.rawPoint = point;
      const meshKey = meshKeyFromIcon(assetDrag.modelKey);
      const snap = SNAP_OPTIONS[snapIdx];
      assetDrag.ghostPoint = meshKey === null ? resolveDropPoint(world, point)
        : snapMeshOrigin(world, assets.mesh(meshKey), meshKey, snapTo(point.x, snap), snapTo(point.y, snap));
    }
    frame.markDirty();
    return;
  }
  if (yawDrag) {
    const data = world.entity(yawDrag.entId);
    if (data) {
      const deltaDeg = (e.clientX - yawDrag.startClientX) * 0.5; // 0.5 deg/px, matches Q/E's 45-deg feel over a short drag
      data.transform.yawDeg = ((yawDrag.startYawDeg + deltaDeg) % 360 + 360) % 360;
      world.renderVersion++;
      frame.markDirty();
    }
    return;
  }
  if (scaleDrag) {
    // ED-SCALE-1c (34.3): `s = clampScale(start * 2 ** (dx / 200))`, live
    // preview straight onto the live entity's transform (same "write
    // transform.X + renderVersion++, no rebuild" shape as yawDrag above).
    const data = world.entity(scaleDrag.entId);
    if (data) {
      const dx = e.clientX - scaleDrag.startClientX;
      data.transform.scale = clampScale(scaleDrag.startScale * 2 ** (dx / 200));
      world.renderVersion++;
      frame.markDirty();
    }
    return;
  }
  if (!drag) return;
  const ray = unprojectCell(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, col, row, frame.renderer);
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
  if (e.button !== 0) return;
  if (tb.stroke) { terrainStrokeEnd(false); return; }
  // ED-DND-01: finish an asset drag. A plain click (`!moved`) just clears the
  // pending drag and leaves the model armed (click-to-arm + click-to-place,
  // unchanged); a real drag drops through the SAME `placeAt` path or cancels.
  if (assetDrag) {
    const d = assetDrag;
    assetDrag = null;
    updateFolderDropHighlight(null);
    if (!d.moved) return;
    // ED-FOLDERS-01: a drop onto a folder moves the asset (onto a user folder
    // = in; onto a default folder = back to its default, via panel.js's
    // `moveAssetToFolder`), taking priority over the viewport place/cancel.
    if (d.folderTarget != null) {
      if (meshKeyFromIcon(d.modelKey) !== null) { setPlaceMode(null); flash('mesh folders are grouped by pack'); return; }
      dropAssetIntoFolder(d.modelKey, d.folderTarget);
      return;
    }
    if (resolveAssetDrop(d.overView, false) === 'place' && d.rawPoint) {
      placeAt('prop', d.rawPoint, d.modelKey);
    } else {
      setPlaceMode(null);
      flash('drag: cancelled');
    }
    return;
  }
  if (yawDrag) {
    const data = world.entity(yawDrag.entId);
    const yd = yawDrag;
    yawDrag = null;
    if (!data) return;
    const before = selectionItemData(doc, yd.item);
    if (!before) return;
    commit(makeFieldEditRecord('yaw', yd.item.fileId, yd.item.collection, before, yd.index, { [yd.field]: data.transform.yawDeg }));
    return;
  }
  if (scaleDrag) {
    const data = world.entity(scaleDrag.entId);
    const sd = scaleDrag;
    scaleDrag = null;
    if (!data) return;
    const before = selectionItemData(doc, sd.item);
    if (!before) return;
    commitScaleEdit(sd.item.fileId, sd.item.collection, before, sd.index, data.transform.scale);
    return;
  }
  if (!drag) return;
  const data = world.entity(drag.entId);
  const d = drag;
  drag = null;
  if (!data) return;
  const sFrame = frameFor(world, d.item);
  const zForConv = d.startTransform ? d.startTransform.z : data.transform.z; // unused by the patch below - only x/y are committed - but worldToItem needs a number
  const nextLocal = worldToItem(sFrame, data.transform.x, data.transform.y, zForConv);
  const before = selectionItemData(doc, d.item);
  if (!before) return;
  commit(makeFieldEditRecord('drag', d.item.fileId, d.item.collection, before, d.index, { x: nextLocal.x, y: nextLocal.y }));
});

// ED-TERRAIN-1c: cursor ring + stroke dabs follow the pointer over the terrain.
canvas.addEventListener('mousemove', (e) => {
  if (toolMode !== 'terrain') return;
  const { col, row } = computeMouseCell(e);
  if (col < 0 || col >= rt.cols || row < 0 || row >= rt.rows) return;
  const hit = pickAt(col, row, pickCtx());
  if (hit.kind === 'terrain' && hit.world) {
    tb.hover = { x: hit.world.x, y: hit.world.y };
    if (tb.stroke) terrainStrokeMove(tb.hover);
    frame.markDirty();
  }
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
  if (input.pressed('Escape') && tb.stroke) {
    terrainStrokeEnd(true); // ED-TERRAIN-1c: Esc reverts the stroke in progress (no record)
  } else if (input.pressed('Escape') && drag) {
    const data = world.entity(drag.entId);
    if (data) Object.assign(data.transform, drag.startTransform);
    drag = null;
    world.renderVersion++;
    frame.markDirty();
  } else if (input.pressed('Escape') && yawDrag) {
    const data = world.entity(yawDrag.entId);
    if (data) data.transform.yawDeg = yawDrag.startYawDeg;
    yawDrag = null;
    world.renderVersion++;
    frame.markDirty();
  } else if (input.pressed('Escape') && scaleDrag) {
    const data = world.entity(scaleDrag.entId);
    if (data) data.transform.scale = scaleDrag.startScale;
    scaleDrag = null;
    world.renderVersion++;
    frame.markDirty();
  } else if (input.pressed('Escape') && assetDrag) {
    // ED-DND-01: Esc cancels an in-progress asset drag (no commit, no record)
    // and also un-arms the model - the whole gesture is abandoned. Any
    // ED-FOLDERS-01 folder drop highlight is cleared with it.
    assetDrag = null;
    updateFolderDropHighlight(null);
    setPlaceMode(null);
    flash('drag: cancelled');
  } else if (input.pressed('Escape') && placeMode) {
    setPlaceMode(null);
    flash('place: cancelled');
  }

  // US-033 (24.9): `1`/`2`/`3`/`4` arm place mode; the next left click places
  // at the picked point (or the cursor ray on open sky, see the mousedown
  // handler above).
  for (const code of Object.keys(PLACE_KEYS)) {
    if (input.pressed(code)) { setPlaceMode(PLACE_KEYS[code]); flash(`place: ${placeMode} (click to place, Esc to cancel)`); }
  }

  if (input.pressed('BracketLeft')) cycleSnap(-1);
  if (input.pressed('BracketRight')) cycleSnap(1);
  if (input.pressed('ArrowLeft')) applyNudge('x', -1);
  if (input.pressed('ArrowRight')) applyNudge('x', 1);
  if (input.pressed('ArrowUp')) applyNudge('y', -1);
  if (input.pressed('ArrowDown')) applyNudge('y', 1);
  if (input.pressed('PageUp')) applyNudge('z', 1);
  if (input.pressed('PageDown')) applyNudge('z', -1);
  if (input.pressed('KeyQ')) applyYaw(-45);
  if (input.pressed('KeyE')) applyYaw(45);
  // ED-SCALE-1c (34.3): Minus/Equal step the scale ladder; Shift = fine +-0.05.
  const scaleShift = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  if (input.pressed('Minus') || input.pressed('NumpadSubtract')) applyScaleStep(-1, scaleShift);
  if (input.pressed('Equal') || input.pressed('NumpadAdd')) applyScaleStep(1, scaleShift);
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
  const changed = updateCamera(cam, input, dt, { speed, lookDx: rmbDown ? dx : 0, lookDy: rmbDown ? dy : 0, pitchClampDeg });
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
  'Q/E: yaw   -/=: scale (Shift: fine)   G: drop to floor   Del/Backspace: delete',
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

/**
 * ED-DND-01: the drag-and-drop ghost - a `+` marker at the snapped drop point
 * plus the model name, drawn into `rt` before `present()` (same route as the
 * selection highlight). Only shown once the drag has actually started and the
 * pointer is over a placeable cell; a gap (`ghostPoint === null`) shows
 * nothing (the drop will refuse with placeAt's own message).
 */
function drawAssetGhost() {
  if (!assetDrag || !assetDrag.moved || !assetDrag.overView || !assetDrag.ghostPoint) return;
  const p = assetDrag.ghostPoint;
  const proj = projectPoint(cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, p, frame.renderer);
  if (!(proj.depth > 0)) return;
  const c = Math.round(proj.col), r = Math.round(proj.row);
  if (c < 0 || c >= rt.cols || r < 0 || r >= rt.rows) return;
  const goldHex = (assets.palette.colors && assets.palette.colors.gold) || '#ffd24a';
  const dimHex = (assets.palette.colors && assets.palette.colors.uiDim) || '#8b949e';
  const bgHex = '#0c120c'; // matches drawHelpOverlay's panel background
  rt.setCell(c, r, '+', goldHex, bgHex);
  drawText(rt, c + 1, r, ` ${meshKeyFromIcon(assetDrag.modelKey) ?? assetDrag.modelKey}`, dimHex, bgHex);
}

function drawOverlay(fb) {
  drawSelectionHighlight(rt, cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, world, assets, doc, selection, '#ffd24a', frame.renderer);
  if (markersOn) drawMarkers(rt, cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, world, assets.palette, selection, frame.renderer);
  drawHoverOutline(rt, hoverCol, hoverRow, '#7CFC7C');
  drawAssetGhost();
  drawTerrainCursor();
  if (helpOn) drawHelpOverlay();
  void fb;
}

let lastPresented = 0;
// US-066: viewport plates (design/editor-ui.md 2/3) - a plain textContent
// refresh throttled to 4 Hz, same "cheap DOM write, no markDirty" shape as
// `statusEl` below; never forces a frame, so idle re-render skip stays intact.
let lastPlateRefresh = -Infinity;
function refreshViewportPlates(nowMs) {
  if (nowMs - lastPlateRefresh < 250) return;
  lastPlateRefresh = nowMs;
  camPlateEl.textContent = `CAM ${cam.x.toFixed(1)} ${cam.y.toFixed(1)} ${cam.z.toFixed(1)}  yaw ${cam.yawDeg.toFixed(0)} pitch ${cam.pitchDeg.toFixed(0)}  SPD ${speed.toFixed(1)} m/s`;
  const fps = engine.loop.stats.intervalMs > 0 ? 1000 / engine.loop.stats.intervalMs : 0;
  statsPlateEl.textContent = `${fps.toFixed(0)} fps  grid ${rt.cols}x${rt.rows}  presented ${lastPresented}`;
}

function render() {
  rebuildSched.flush(); // ED-MESH-1d: one coalesced rebuild per frame (31.3)
  const rendered = frame.step(world, cam, { animate, dt: 1 / 60, drawOverlay });
  if (rendered) lastPresented++;
  refreshViewportPlates(performance.now());
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
  get rt() { return rt; },
  get selection() { return selection; },
  get placeMode() { return placeMode; },
  get helpOn() { return helpOn; },
  undoStack, tb,
  pickAt: (col, row) => pickAt(col, row, pickCtx()),
  selectItem, deleteSelected, applyNudge, applyYaw, applyScaleStep, dropToFloor, doUndo, doRedo,
  placeAt, classifyPlacement: (pt) => classifyPlacement(world, pt), resolveDropPoint: (pt) => resolveDropPoint(world, pt), commitFieldEdit, renameSelected,
  doSave, doLoad, doPlaytest, refreshIoStatus, validateDoc: () => validateDoc(doc, window.ASSETS, { reference: bundle }),
  openModelPicker, closeModelPicker,
  rebuildNow: () => rebuildSched.flushNow(), get rebuildRuns() { return rebuildSched.runs; }, // ED-MESH-1d (headless measure)
  // US-067
  visState, toggleItemHidden, toggleItemLocked, armModelPlacement,
  get armedModelKey() { return armedModelKey; },
  get assetDrag() { return assetDrag; },
  icons: { stats: iconStats, queue: iconQueue, cache: iconCache, refresh: refreshIcons,
    get renderer() { return iconRenderer; } },
  doImportVox,
};

if (!gpuBlocked) engine.run({ update, render });
