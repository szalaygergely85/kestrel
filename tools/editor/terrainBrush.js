// tools/editor/terrainBrush.js - ED-TERRAIN-1c (docs/architecture.md 37.12). The pure part of the editor's
// terrain brush: fixed-step dab placement along a drag, one stroke = one undo record (exact before/after
// sample snapshots over the stroke's union rect), save text. No DOM, no GPU; the engine does the real work
// (`applyDab`, `Terrain#rebakeRect`, `World#refreshTerrainScatter`) and main.js glues them to the mouse.
//
// Imports only engine/index.js (the editor boundary rule).
import {
  applyDab, editHeightAt, sampleDh, sampleType, setSampleDh, setSampleType, NO_PAINT, stringifyContent, editLayerToJSON,
} from '../../engine/index.js';

export const BRUSH_OPS = ['raise', 'lower', 'flatten', 'smooth', 'paint'];
/** Ground types the paint op can lay (ids = the recipe's TYPE_NAMES order, Terrain#typeName). */
export const PAINT_TYPES = [{ name: 'grass', id: 0 }, { name: 'forest', id: 1 }, { name: 'rock', id: 3 }, { name: 'path', id: 4 }];
export const RADIUS_RANGE = [1, 24];
export const SPACING_FRAC = 0.35; // dab spacing = radius * this (min SPACING_MIN m), independent of mouse event rate
export const SPACING_MIN = 0.5;

/** UI strength 1..100 % -> the engine's per-dab strength: metres for raise/lower, 0..1 blend for flatten/smooth, type id for paint. */
export function effectiveStrength(op, pct, paintId = 0) {
  const f = Math.max(1, Math.min(100, pct)) / 100;
  if (op === 'raise' || op === 'lower') return f * 0.3;
  if (op === 'flatten' || op === 'smooth') return f * 0.5;
  return paintId;
}

export function dabSpacing(radius) { return Math.max(SPACING_MIN, radius * SPACING_FRAC); }

/**
 * Starts a stroke over `layer`/`terrain`. Dab positions are a pure function of the polyline of `move()` points
 * (fixed arc-length step carried across calls), so a stroke is deterministic whatever the mouse event rate.
 * @param {{layer:Object, terrain:Object, key:string}} ctx
 * @param {{op:string, radius:number, strength:number, x:number, y:number}} p `strength` is the engine value (effectiveStrength)
 */
export function beginStroke(ctx, p) {
  const { layer, terrain } = ctx;
  const spacing = dabSpacing(p.radius);
  const s = {
    op: p.op, radius: p.radius, strength: p.strength, spacing,
    target: p.op === 'flatten' ? editHeightAt(terrain, p.x, p.y) : undefined, // flatten toward the stroke-start height
    lastX: p.x, lastY: p.y, carry: 0, started: false,
    before: new Map(), // "i,j" -> [dh, type] of every sample at first touch
    union: null, dabs: 0,
    rect: { i0: 0, j0: 0, i1: -1, j1: -1 },
  };
  /** Applies one dab at (x,y). Returns the touched sample rect when something changed, else null. */
  s.dab = (x, y) => {
    const c = layer.cell, r = p.radius;
    // conservative rect (+-1 sample) so every sample the dab may write (or smooth-read) is snapshotted first
    const i0 = Math.floor((x - r) / c) - 1, i1 = Math.ceil((x + r) / c) + 1;
    const j0 = Math.floor((y - r) / c) - 1, j1 = Math.ceil((y + r) / c) + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = `${i},${j}`;
      if (!s.before.has(k)) s.before.set(k, [sampleDh(layer, i, j), sampleType(layer, i, j)]);
    }
    const changed = applyDab(layer, terrain, s.op, x, y, r, s.strength, s.rect, s.target);
    if (!changed) return null;
    s.dabs++;
    const u = s.union;
    if (!u) s.union = { ...s.rect };
    else {
      u.i0 = Math.min(u.i0, s.rect.i0); u.j0 = Math.min(u.j0, s.rect.j0);
      u.i1 = Math.max(u.i1, s.rect.i1); u.j1 = Math.max(u.j1, s.rect.j1);
    }
    return s.rect;
  };
  /** Dab positions (world x,y) for the segment from the last point to (x,y), fixed arc-length step. The first call yields the start dab. */
  s.points = (x, y) => {
    const out = [];
    if (!s.started) { s.started = true; out.push([s.lastX, s.lastY]); }
    let dx = x - s.lastX, dy = y - s.lastY;
    let dist = Math.hypot(dx, dy);
    if (dist === 0) return out;
    dx /= dist; dy /= dist;
    let t = spacing - s.carry; // distance along the segment to the next dab
    while (t <= dist) {
      out.push([s.lastX + dx * t, s.lastY + dy * t]);
      t += spacing;
    }
    s.carry = dist - (t - spacing); // distance walked since the last dab
    s.lastX = x; s.lastY = y;
    return out;
  };
  return s;
}

/**
 * Finishes a stroke: one undo record, or null when nothing changed.
 * `before`/`after` hold the Int16 dh + Uint8 type of every sample in `rect` (row-major, w = i1-i0+1).
 * @returns {{kind:'terrain', label:string, key:string, rect:{i0,j0,i1,j1}, before:{dh:Int16Array,type:Uint8Array}, after:{dh:Int16Array,type:Uint8Array}}|null}
 */
export function endStroke(ctx, s) {
  if (!s.union) return null;
  const { layer } = ctx;
  const { i0, j0, i1, j1 } = s.union;
  const w = i1 - i0 + 1, h = j1 - j0 + 1;
  const before = { dh: new Int16Array(w * h), type: new Uint8Array(w * h) };
  const after = { dh: new Int16Array(w * h), type: new Uint8Array(w * h) };
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const n = (i - i0) + (j - j0) * w;
    after.dh[n] = sampleDh(layer, i, j); after.type[n] = sampleType(layer, i, j);
    const b = s.before.get(`${i},${j}`);
    before.dh[n] = b ? b[0] : after.dh[n]; before.type[n] = b ? b[1] : after.type[n]; // untouched samples are unchanged
  }
  return { kind: 'terrain', label: `terrain ${s.op}`, key: ctx.key, rect: { i0, j0, i1, j1 }, before, after };
}

/** True for an undo-stack record produced by `endStroke`. */
export function isTerrainRecord(rec) { return !!rec && rec.kind === 'terrain'; }

/**
 * Writes one side of a record into the layer (`side` = rec.before for undo, rec.after for redo/commit).
 * @returns {{i0,j0,i1,j1}} the rect (sample indices) to rebake
 */
export function applyTerrainSide(layer, rec, side) {
  const { i0, j0, i1, j1 } = rec.rect;
  const w = i1 - i0 + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const n = (i - i0) + (j - j0) * w;
    setSampleDh(layer, i, j, side.dh[n]);
    setSampleType(layer, i, j, side.type[n]);
  }
  return rec.rect;
}

/** World-metre rect `rebakeRect` takes, from a sample rect. */
export function rectToWorld(layer, r) { return [r.i0 * layer.cell, r.j0 * layer.cell, r.i1 * layer.cell, r.j1 * layer.cell]; }

/** The exact text written to `content/terrain/<key>.edits.json` (deterministic; the editor's in-memory ints are what is saved). */
export function terrainEditsText(layer, key) { return stringifyContent(editLayerToJSON(layer, key)); }

/** Path of the edits file under content/ (also the manifest entry). */
export function terrainEditsPath(key) { return `terrain/${key}.edits.json`; }

/** Ring points (world x,y) for the cursor, `n` samples around (x,y) radius r. */
export function ringPoints(x, y, r, n = 48) {
  const out = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return out;
}

export { NO_PAINT };
