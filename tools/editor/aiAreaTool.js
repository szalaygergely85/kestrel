// tools/editor/aiAreaTool.js - ED-AI-05 + ED-AI-06 editor part. Pure controller for painting spawn areas (disc or polygon)
// in the viewport and for "Drop pack here". No DOM: the viewport hands in ground points, `probe(x,y)` -> {z, walkable} is
// injected (ground snap + walkable test), `channel.post(msg)` is the BroadcastChannel glue. All edits are model commands
// on the given stack (undoable); Save writes content/beasts/spawnAreas.json through the model.
import { addSpawnArea, removeSpawnArea, setSpawnAreaField, saveSpawnAreas } from './ai/model.js';
import { validateSpawnAreas, AREA_MAX_COUNT } from './ai/spawnAreas.js';

export const DROP_MSG = 'ai-drop';
export const AREAS_MSG = 'ai-areas', PING_MSG = 'ai-ping', PONG_MSG = 'ai-pong';
export const BRUSH_R_MIN = 6, BRUSH_R_MAX = 60;
export const REFUSE_TEXT = "Can't spawn here.";
/** "Comes back after" choices (plain words -> seconds). */
export const RESPAWN_CHOICES = Object.freeze([['A short while', 60], ['A while', 300], ['A long while', 1200], ['A very long while', 3600]]);
export const WHEN_CHOICES = Object.freeze([['Any time', 'both'], ['Day only', 'day'], ['Night only', 'night']]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

/** Area centre for labels / handles. */
export function areaCentre(a) {
  if (a.shape === 'disc') return [a.x, a.y];
  let x = 0, y = 0; for (const p of a.pts) { x += p[0]; y += p[1]; } return [x / a.pts.length, y / a.pts.length];
}
/** Rim points for drawing (disc: n points; polygon: corners joined by interpolated points). */
export function areaOutline(a, n = 40) {
  if (a.shape === 'disc') return Array.from({ length: n }, (_, i) => [a.x + Math.cos(i / n * 6.2832) * a.r, a.y + Math.sin(i / n * 6.2832) * a.r]);
  const out = [];
  a.pts.forEach((p, i) => { const q = a.pts[(i + 1) % a.pts.length], k = Math.max(1, Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) / 4)); for (let j = 0; j < k; j++) out.push([p[0] + (q[0] - p[0]) * j / k, p[1] + (q[1] - p[1]) * j / k]); });
  return out;
}

export function createAreaTool({ model, kinds, stack, probe, channel = null, reload = () => {}, onChange = () => {}, seed = () => 1, setTimer = setTimeout, pingMs = 400 }) {
  const firstKind = Object.keys(kinds)[0];
  const st = {
    armed: false, mode: 'disc', radius: 20,
    brush: { kind: firstKind, count: 3, respawnSec: 300, when: 'both' },
    draft: null,      // { type:'disc', x, y, r } while dragging | { type:'poly', pts:[[x,y]..] }
    sel: null, msg: '', dirtyLive: false, connected: null /* null = unknown/pinging, true = a game page answered */, dropKind: firstKind, dropCount: 0,
  };
  const idFor = (kind) => { let n = 1; const used = new Set(model.areas.map((a) => a.id)); while (used.has(`${kind}-${n}`)) n++; return `${kind}-${n}`; };
  const snap = (x, y) => { const p = probe(x, y); if (!p || !p.walkable) { st.msg = REFUSE_TEXT; return null; } st.msg = ''; return { x: r1(x), y: r1(y), z: p.z }; };
  // ED-AI-05b: live-apply. Every finished edit (stroke end) and Save posts the whole area list; a ping tells whether any game page listens.
  const pushAreas = () => { if (channel) channel.post({ type: AREAS_MSG, areas: JSON.parse(JSON.stringify(model.areas)) }); };
  const ping = () => { st.connected = null; if (!channel) { st.connected = false; return; } channel.post({ type: PING_MSG }); setTimer(() => { if (st.connected === null) { st.connected = false; onChange(); } }, pingMs); };
  const touched = () => { st.dirtyLive = true; pushAreas(); ping(); onChange(); };
  const commit = (shape) => {
    const b = st.brush, a = { id: idFor(b.kind), ...shape, kind: b.kind, count: b.count, respawnSec: b.respawnSec, when: b.when };
    stack.run(addSpawnArea(model, a)); st.sel = a.id; st.draft = null; touched(); return a;
  };
  const api = {
    st, model,
    arm(on = true) { st.armed = !!on; if (!on) st.draft = null; onChange(); },
    /** Brush value for the next area; when an area is selected the change edits it too (one undo step). */
    setBrush(k, v) {
      if (k === 'count') v = clamp(Math.round(v) || 1, 1, AREA_MAX_COUNT);
      st.brush[k] = v;
      if (st.sel && model.areas.some((a) => a.id === st.sel)) api.setField(st.sel, k, v); else onChange();
    },
    setRadius(r) { st.radius = clamp(r, BRUSH_R_MIN, BRUSH_R_MAX); onChange(); },
    /** Disc: press = centre. Polygon: press = add a corner. Returns false when refused (st.msg holds the plain reason). */
    pointerDown(x, y) {
      if (!st.armed) return false;
      const p = snap(x, y); if (!p) { onChange(); return false; }
      if (st.mode === 'disc') st.draft = { type: 'disc', x: p.x, y: p.y, z: p.z, r: st.radius };
      else { if (!st.draft || st.draft.type !== 'poly') st.draft = { type: 'poly', pts: [] }; st.draft.pts.push([p.x, p.y]); }
      onChange(); return true;
    },
    /** Disc drag sets the radius (clamped to the brush range). */
    pointerMove(x, y) { const d = st.draft; if (d && d.type === 'disc') { d.r = clamp(r1(Math.hypot(x - d.x, y - d.y)), BRUSH_R_MIN, BRUSH_R_MAX); onChange(); } },
    pointerUp() { const d = st.draft; if (d && d.type === 'disc') return commit({ shape: 'disc', x: d.x, y: d.y, r: d.r }); return null; },
    /** Polygon: close it (needs 3+ corners). */
    finish() {
      const d = st.draft; if (!d || d.type !== 'poly') return null;
      if (d.pts.length < 3) { st.msg = 'A polygon needs at least 3 corner points.'; onChange(); return null; }
      return commit({ shape: 'polygon', pts: d.pts.map((p) => [p[0], p[1]]) });
    },
    cancel() { st.draft = null; onChange(); },
    select(id) { st.sel = id; onChange(); },
    remove(id) { stack.run(removeSpawnArea(model, id)); if (st.sel === id) st.sel = null; touched(); },
    setField(id, field, value) {
      const a = model.areas.find((x) => x.id === id);
      if (!a || JSON.stringify(a[field]) === JSON.stringify(value)) { onChange(); return false; }
      stack.run(setSpawnAreaField(model, id, field, value)); touched(); return true;
    },
    /** Selected-area handle drag: move the whole area to (x,y) (disc centre / polygon centroid). Ground-snapped, refused off walkable ground. */
    moveSel(x, y) {
      const a = model.areas.find((q) => q.id === st.sel), p = a && snap(x, y); if (!p) return false;
      if (a.shape === 'disc') { stack.run(setSpawnAreaField(model, a.id, 'x', p.x)); stack.run(setSpawnAreaField(model, a.id, 'y', p.y)); }
      else { const [cx, cy] = areaCentre(a), dx = p.x - cx, dy = p.y - cy; stack.run(setSpawnAreaField(model, a.id, 'pts', a.pts.map((q) => [r1(q[0] + dx), r1(q[1] + dy)]))); }
      touched(); return true;
    },
    resizeSel(r) { const a = model.areas.find((q) => q.id === st.sel); return a && a.shape === 'disc' ? api.setField(a.id, 'r', clamp(r1(r), 5, 300)) : false; },
    /** id -> [plain messages] for every invalid area (empty object = all fine). Save is still allowed; the area is marked. */
    invalid() {
      const out = {};
      for (const a of model.areas) { const m = validateSpawnAreas({ areas: [a] }, kinds); if (m.length) out[a.id] = m; }
      return out;
    },
    undo() { const r = stack.undo(); if (r) touched(); return r; },
    redo() { const r = stack.redo(); if (r) touched(); return r; },
    save(fs) { const r = saveSpawnAreas(model, fs); pushAreas(); return r; },
    ping, pushAreas,
    /** The game page answered the ping (glue calls this on an 'ai-pong' message or any areas result). */
    onPong() { st.connected = true; st.dirtyLive = false; onChange(); },
    /** Architect decision pending (live director rebuild vs reload): the editor only offers "Reload to apply". */
    reloadToApply() { st.dirtyLive = false; reload(); onChange(); },
    /** ED-AI-06: "Drop pack here" at a ground point. Message for the running game tab; never saved. */
    dropPack(x, y, kind = st.dropKind, count = st.dropCount) {
      const p = snap(x, y); if (!p) { onChange(); return false; }
      if (!channel) { st.msg = 'No game tab is connected.'; onChange(); return false; }
      const msg = { type: DROP_MSG, kind, count: clamp(Math.round(count) || 0, 0, 12), x: p.x, y: p.y, seed: seed() | 0 };
      channel.post(msg); onChange(); return msg;
    },
    clearTest() { if (channel) channel.post({ type: 'ai-clear' }); },
  };
  return api;
}
