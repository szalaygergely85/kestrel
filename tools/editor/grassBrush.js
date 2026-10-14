// tools/editor/grassBrush.js - MASK-d (docs/architecture.md 38.52 amendment (e)). Pure part of the editor's grass-mask
// brush: smooth-falloff dabs that add (paint) or subtract (erase) coverage in the grass paint layer, one stroke = one
// undo record, save text. No DOM, no GPU.
//
// The brush works on a small adapter `gm` (build it with `wrapLayer`), texel indices + u8 values:
//   gm.cell (m per texel)  gm.get(i,j) -> 0..255  gm.set(i,j,u8)  gm.toJSON(id) -> plain object
// `wrapLayer(layer, api)` binds the engine's engine/world/grassMask.js functions (MASK-a): api = { sampleAt, setSample,
// grassMaskToJSON } (pass them from engine/index.js; a test passes stubs). Absent chunks read 0 (so erase on empty is a no-op).
import { stringifyContent } from '../../engine/index.js';

export const GRASS_OPS = ['paint', 'erase'];
export const GRASS_RADIUS_RANGE = [1, 24];
export const SPACING_FRAC = 0.35;
export const SPACING_MIN = 0.5;

const smooth01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

/** Adapter over a real engine grass layer. */
export function wrapLayer(layer, api) {
  return {
    layer, cell: layer.cell,
    get: (i, j) => api.sampleAt(layer, i, j),
    set: (i, j, v) => api.setSample(layer, i, j, v),
    toJSON: (id) => api.grassMaskToJSON(layer, id),
  };
}

/** UI strength 1..100 % -> per-dab coverage change 0..1 (a few overlapping dabs saturate at 100 %). */
export function effectiveStrength(pct) { return Math.max(1, Math.min(100, pct)) / 100 * 0.5; }
export function dabSpacing(radius) { return Math.max(SPACING_MIN, radius * SPACING_FRAC); }

/**
 * Applies one dab: texels whose centre lies within `r` of (x,y) move by 255 * strength * smooth01(1 - d/r) (towards
 * 255 for paint, 0 for erase). `onTouch(i,j,old)` fires before a texel's first write (undo snapshot). `outRect`
 * (optional) receives the touched WORLD rect {x0,y0,x1,y1}. Returns true when any texel changed.
 */
export function applyGrassDab(gm, op, x, y, r, strength, outRect, onTouch) {
  const c = gm.cell;
  const i0 = Math.floor((x - r) / c), i1 = Math.ceil((x + r) / c);
  const j0 = Math.floor((y - r) / c), j1 = Math.ceil((y + r) / c);
  const sign = op === 'erase' ? -1 : 1;
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot((i + 0.5) * c - x, (j + 0.5) * c - y);
    if (d >= r) continue;
    const dv = Math.round(255 * smooth01(1 - d / r) * strength);
    if (dv <= 0) continue;
    const old = gm.get(i, j);
    const nv = Math.max(0, Math.min(255, old + sign * dv));
    if (nv === old) continue;
    if (onTouch) onTouch(i, j, old);
    gm.set(i, j, nv);
    changed = true;
  }
  if (changed && outRect) { outRect.x0 = i0 * c; outRect.y0 = j0 * c; outRect.x1 = (i1 + 1) * c; outRect.y1 = (j1 + 1) * c; }
  return changed;
}

/** Starts a stroke (fixed arc-length dab step, same scheme as terrainBrush). `p.strength` is the engine value. */
export function beginStroke(ctx, p) {
  const { gm } = ctx;
  const spacing = dabSpacing(p.radius);
  const s = {
    op: p.op, radius: p.radius, strength: p.strength, spacing,
    layer: p.layer || null, target: p.target, // decor mode (ED-FOLIAGE-04): layer name + paint target multiplier
    lastX: p.x, lastY: p.y, carry: 0, started: false,
    before: new Map(), // "i,j" -> u8 at first touch
    union: null, dabs: 0, rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
  };
  s.dab = (x, y) => {
    const touch = (i, j, old) => {
      const k = `${i},${j}`;
      if (!s.before.has(k)) s.before.set(k, old);
    };
    const ch = s.layer ? applyDecorDab(gm, s.op, s.target, x, y, s.radius, s.strength, s.rect, touch)
      : applyGrassDab(gm, s.op, x, y, s.radius, s.strength, s.rect, touch);
    if (!ch) return null;
    s.dabs++;
    const u = s.union, r = s.rect;
    if (!u) s.union = { ...r };
    else { u.x0 = Math.min(u.x0, r.x0); u.y0 = Math.min(u.y0, r.y0); u.x1 = Math.max(u.x1, r.x1); u.y1 = Math.max(u.y1, r.y1); }
    return r;
  };
  s.points = (x, y) => {
    const out = [];
    if (!s.started) { s.started = true; out.push([s.lastX, s.lastY]); }
    let dx = x - s.lastX, dy = y - s.lastY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return out;
    dx /= dist; dy /= dist;
    let t = spacing - s.carry;
    while (t <= dist) { out.push([s.lastX + dx * t, s.lastY + dy * t]); t += spacing; }
    s.carry = dist - (t - spacing);
    s.lastX = x; s.lastY = y;
    return out;
  };
  return s;
}

/**
 * Finishes a stroke: one undo record or null. `entries` = [i, j, beforeU8, afterU8] per changed texel.
 * @returns {{kind:'grass', label:string, key:string, rect:{x0,y0,x1,y1}, entries:number[][]}|null}
 */
export function endStroke(ctx, s) {
  if (!s.union) return null;
  const entries = [];
  for (const [k, b] of s.before) {
    const [i, j] = k.split(',').map(Number);
    const a = ctx.gm.get(i, j);
    if (a !== b) entries.push([i, j, b, a]);
  }
  if (!entries.length) return null;
  if (s.layer) return { kind: 'decor', label: `decor ${s.op}`, layer: s.layer, key: ctx.key, rect: { ...s.union }, entries };
  return { kind: 'grass', label: `grass ${s.op}`, key: ctx.key, rect: { ...s.union }, entries };
}

export function isGrassRecord(rec) { return !!rec && rec.kind === 'grass'; }

/** Writes one side ('before' | 'after') of a record into the layer; returns the world rect to rebuild. */
export function applyGrassSide(gm, rec, side) {
  const idx = side === 'before' ? 2 : 3;
  for (const e of rec.entries) gm.set(e[0], e[1], e[idx]);
  return rec.rect;
}

/** Stroke end / undo hook: asks the world to rebuild its carpet mask over `rect` (guarded: MASK-b adds the method). */
export function rebuildCarpet(world, rect) {
  if (world && typeof world.rebuildCarpetMask === 'function') { world.rebuildCarpetMask([rect.x0, rect.y0, rect.x1, rect.y1]); return true; }
  return false;
}

/** The exact text written to `content/<grassMaskPath>` (the layer's own canonical JSON, stringified). */
export function grassMaskText(gm, key) { return stringifyContent(gm.toJSON(key)); }
/** Path of the mask file under content/ (also the manifest entry; bundle.grassMask[key]). */
export function grassMaskPath(key) { return `terrain/${key}.grassMask.json`; }

/** Painted-area samples for the editor overlay: [x, y, coverage 0..1] on a `step` m grid where coverage > 0.05. */
export function paintedPoints(gm, cx, cy, half, step = 1) {
  const out = [], c = gm.cell;
  for (let y = cy - half; y <= cy + half; y += step) for (let x = cx - half; x <= cx + half; x += step) {
    const v = gm.get(Math.floor(x / c), Math.floor(y / c)) / 255;
    if (v > 0.05) out.push([x, y, v]);
  }
  return out;
}

// ---- ED-FOLIAGE-04 (architecture.md 38.69 part 4): decor density paint --------------------------------------------
// One GrassMask layer per detail layer, neutral byte 128 (= x1.0, byte/128). Same dab/stroke/undo machinery as the grass
// brush; paint moves texels toward target*128, erase toward 0, reset toward 128. Record kind 'decor' carries the layer name.
export const DECOR_NEUTRAL = 128;
export const DECOR_OPS = ['paint', 'erase', 'reset'];
export const DECOR_TARGET_RANGE = [0, 2];

export function decorGoal(op, target = 2) {
  if (op === 'erase') return 0;
  if (op === 'reset') return DECOR_NEUTRAL;
  return Math.min(255, Math.round(Math.max(DECOR_TARGET_RANGE[0], Math.min(DECOR_TARGET_RANGE[1], target)) * DECOR_NEUTRAL));
}

/** Like applyGrassDab, but each texel moves a smooth01-weighted fraction (strength) of the way to the op's goal value. */
export function applyDecorDab(gm, op, target, x, y, r, strength, outRect, onTouch) {
  const c = gm.cell, goal = decorGoal(op, target);
  const i0 = Math.floor((x - r) / c), i1 = Math.ceil((x + r) / c);
  const j0 = Math.floor((y - r) / c), j1 = Math.ceil((y + r) / c);
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot((i + 0.5) * c - x, (j + 0.5) * c - y);
    if (d >= r) continue;
    const old = gm.get(i, j), gap = goal - old;
    if (gap === 0) continue;
    const f = smooth01(1 - d / r) * strength;
    let step = Math.round(gap * f);
    if (f > 0 && Math.abs(gap) <= 2) step = gap;
    else if (step === 0 && f > 0) step = Math.sign(gap); // near the goal: land on it (reset must reach exact neutral)
    if (step === 0) continue;
    const nv = Math.max(0, Math.min(255, old + step));
    if (nv === old) continue;
    if (onTouch) onTouch(i, j, old);
    gm.set(i, j, nv);
    changed = true;
  }
  if (changed && outRect) { outRect.x0 = i0 * c; outRect.y0 = j0 * c; outRect.x1 = (i1 + 1) * c; outRect.y1 = (j1 + 1) * c; }
  return changed;
}

/** Starts a decor stroke on one layer: ctx {gm, key}; p = {layer, op, target, radius, strength, x, y}. */
export function beginDecorStroke(ctx, p) { return beginStroke(ctx, { ...p, layer: p.layer }); }

export function isDecorRecord(rec) { return !!rec && rec.kind === 'decor'; }
/** Undo/redo: `layers` = {name: gm}. Returns the rect to rebuild, or null when the layer is unknown. */
export function applyDecorSide(layers, rec, side) {
  const gm = layers[rec.layer];
  return gm ? applyGrassSide(gm, rec, side) : null;
}
/** Stroke end / undo hook: World.rebuildDecor({x0,y0,x1,y1}) over the stroke rect only (guarded). */
export function rebuildDecor(world, rect) {
  if (world && rect && typeof world.rebuildDecor === 'function') { world.rebuildDecor({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1 }); return true; }
  return false;
}
/** Fresh empty (all-neutral) decor layer set: api adds createGrassMask. */
export function createDecorLayers(names, api) {
  const out = {};
  for (const n of names) out[n] = wrapLayer(api.createGrassMask(0.5, 64, DECOR_NEUTRAL), api);
  return out;
}
/** Loads a parsed decorPaint.json ({version:1, layers}) into wrapped layers; missing names in `names` start neutral. */
export function parseDecorPaint(obj, names, api) {
  if (obj && obj.version !== 1) throw new Error(`decorPaint: unsupported version ${obj.version}`);
  const out = createDecorLayers(names, api);
  for (const [n, j] of Object.entries((obj && obj.layers) || {})) out[n] = wrapLayer(api.grassMaskFromJSON(j), api);
  return out;
}
/** Raw engine layers {name: layer} = the World `decorPaint` opt. */
export function decorWorldOpt(layers) {
  const o = {};
  for (const [n, gm] of Object.entries(layers)) o[n] = gm.layer;
  return o;
}
/** Canonical text of content/terrain/<key>.decorPaint.json; only layers that hold paint are written. */
export function decorPaintText(layers, key) {
  const out = {};
  for (const n of Object.keys(layers).sort()) {
    const j = layers[n].toJSON(key);
    if (Object.keys(j.chunks).length) out[n] = j;
  }
  return stringifyContent({ version: 1, layers: out });
}
export function decorPaintPath(key) { return `terrain/${key}.decorPaint.json`; }
