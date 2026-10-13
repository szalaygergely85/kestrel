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
    lastX: p.x, lastY: p.y, carry: 0, started: false,
    before: new Map(), // "i,j" -> u8 at first touch
    union: null, dabs: 0, rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
  };
  s.dab = (x, y) => {
    const ch = applyGrassDab(gm, s.op, x, y, s.radius, s.strength, s.rect, (i, j, old) => {
      const k = `${i},${j}`;
      if (!s.before.has(k)) s.before.set(k, old);
    });
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
