// tools/editor/main.js - US-031 boot (docs/architecture.md 24.3), the
// M1.5 editor's fly-cam viewer over the tower world. Imports only
// engine/index.js (check-deps rule 3 + the editor boundary rule: no `game/`
// import) - `design/` stays classic <script> tags, like game/index.html.
import {
  AssetRegistry, createEngine, GRID_DEFAULT_COLS,
  loadContentPack, ContentError, World, validateBehaviours, registerBehaviour,
  DebugOverlay,
} from '../../engine/index.js';
import {
  createDoc, selectionFromEntityId, selectionEntityId, selectionItemData, selectionItemIndex,
  listOutlinerItems, toLocal, toWorld,
} from './doc.js';
import { createFrame } from './frame.js';
import { createCameraPose, updateCamera, startPoseForStructure, adjustSpeed, clonePose } from './camera.js';
import { unprojectCell, rayPoint } from './ray.js';
import { pickAt, pickMarkers } from './pick.js';
import { drawSelectionHighlight, drawMarkers, drawHoverOutline } from './select.js';
import { makeFieldEditRecord, makeDeleteRecord, applyEdit, invert, findReferrers } from './commands.js';
import { createStack } from './undo.js';

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
const frame = createFrame({ engine, assets, rt });
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
let lastPickText = '';

function flash(msg) {
  lastPickText = msg;
}

/** `{x,y,z}` origin to add/subtract for a file's collection (0 for a world file - 24.1 decision 4). */
function originForFile(fileId) {
  if (fileId.startsWith('world/')) return { x: 0, y: 0, z: 0 };
  const levelId = fileId.slice('level/'.length);
  const s = world.structures.find((st) => st.level.name === levelId);
  return s ? s.origin : { x: 0, y: 0, z: 0 };
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
  return ms;
}

function commit(rec) {
  applyEdit(doc, rec);
  undoStack.push(rec);
  const ms = rebuild();
  flash(`${rec.label} "${rec.id}" (rebuild ${ms.toFixed(2)} ms)`);
}

function doUndo() {
  const rec = undoStack.undo();
  if (!rec) { flash('undo: nothing to undo'); return; }
  applyEdit(doc, invert(rec));
  rebuild();
  flash(`undo: ${rec.label} "${rec.id}"`);
}

function doRedo() {
  const rec = undoStack.redo();
  if (!rec) { flash('redo: nothing to redo'); return; }
  applyEdit(doc, rec);
  rebuild();
  flash(`redo: ${rec.label} "${rec.id}"`);
}

function selectItem(item) {
  selection = item;
  renderOutliner();
  frame.markDirty();
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
  const { col, row } = computeMouseCell(e);
  if (col < 0 || col >= rt.cols || row < 0 || row >= rt.rows) return;
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

  // US-032 (24.8): Esc cancels an in-progress drag (no record) instead of
  // committing it - checked before the drag's own mousemove/mouseup handlers
  // would otherwise leave the live transform wherever the mouse last was.
  if (input.pressed('Escape') && drag) {
    const data = world.entity(drag.entId);
    if (data) Object.assign(data.transform, drag.startTransform);
    drag = null;
    world.renderVersion++;
    frame.markDirty();
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

function drawOverlay(fb) {
  drawSelectionHighlight(rt, cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, world, assets, doc, selection, '#ffd24a');
  if (markersOn) drawMarkers(rt, cam, rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, world, assets.palette, selection);
  drawHoverOutline(rt, hoverCol, hoverRow, '#7CFC7C');
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
      + `selected: ${selText}\n`
      + `${lastPickText}\n`
      + `presented: ${lastPresented}  backend: ${rt.backend}${frame.gpuPipeline ? ' gpu' : ' js'}`);
  }
  statusEl.textContent = (doc.readOnly ? 'content: design/*.js (read-only source)\n' : '') + lastPickText;
}

window.__editor = {
  engine, assets, doc, cam, frame,
  get world() { return world; },
  get selection() { return selection; },
  undoStack,
  pickAt: (col, row) => pickAt(col, row, pickCtx()),
  selectItem, deleteSelected, applyNudge, applyYaw, dropToFloor, doUndo, doRedo,
};

if (!gpuBlocked) engine.run({ update, render });
