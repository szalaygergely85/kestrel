// tools/editor/main.js - US-031 boot (docs/architecture.md 24.3), the
// M1.5 editor's fly-cam viewer over the tower world. Imports only
// engine/index.js (check-deps rule 3 + the editor boundary rule: no `game/`
// import) - `design/` stays classic <script> tags, like game/index.html.
import {
  AssetRegistry, createEngine, GRID_DEFAULT_COLS,
  loadContentPack, ContentError, World, validateBehaviours, registerBehaviour,
  DebugOverlay,
} from '../../engine/index.js';
import { createDoc } from './doc.js';
import { createFrame } from './frame.js';
import { createCameraPose, updateCamera, startPoseForStructure, adjustSpeed, clonePose } from './camera.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('screen');
canvas.tabIndex = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', () => canvas.focus());

const statusEl = document.getElementById('status');
const gateEl = document.getElementById('gate-message');
const animateToggle = document.getElementById('animate-toggle');
const speedInput = document.getElementById('speed-input');

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

let lastPresented = 0;
function render() {
  const rendered = frame.step(world, cam, { animate, dt: 1 / 60 });
  if (rendered) lastPresented++;
  if (overlay.shouldRefresh(performance.now())) {
    const fps = engine.loop.stats.intervalMs > 0 ? 1000 / engine.loop.stats.intervalMs : 0;
    overlay.update(fps, engine.loop.stats.jsMs,
      `pose: ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}  yaw ${cam.yawDeg.toFixed(0)} pitch ${cam.pitchDeg.toFixed(0)}\n`
      + `speed: ${speed.toFixed(1)} m/s  animate: ${animate}\n`
      + `presented: ${lastPresented}  backend: ${rt.backend}${frame.gpuPipeline ? ' gpu' : ' js'}`);
  }
}

window.__editor = { engine, assets, doc, cam, frame };

if (!gpuBlocked) engine.run({ update, render });
