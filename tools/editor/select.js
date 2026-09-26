// tools/editor/select.js - US-032 (docs/architecture.md 24.7). Selection
// state + drawing the highlight/markers/hovered-cell outline into `rt`
// BEFORE `present()` (so JS-written cells survive the GPU pass, same
// "bg.a mask" route `drawText`/the eyelid use - 24.4's frame sequence).
// Browser-only (reads a real RenderTarget) - the pure math it uses
// (`projectPoint`/`cameraBasis`) is Node-tested in ray.test.mjs.
//
// Imports only engine/index.js + ray.js (the editor boundary rule).
import { projectPoint, cameraBasis } from './ray.js';
import { selectionEntityId, selectionItemData } from './doc.js';

/** Model world-space radius/height for the highlight box (same rule as ray.js's `rayPickEntities`). */
function modelExtent(assets, comps) {
  // US-032 fix (same as ray.js's rayPickEntities): `assets.model()` throws
  // on an unknown key, so guard with `assets.has()` first - a selected
  // entity whose model the loaded bundle doesn't carry just gets no
  // highlight box instead of crashing the render loop.
  if (comps.sprite) {
    if (!assets.has('model', comps.sprite.model)) return null;
    const m = assets.model(comps.sprite.model);
    if (!m || !m.world) return null;
    return { radius: m.world.w / 2, height: m.world.h };
  }
  if (comps.voxel) {
    if (!assets.has('model', comps.voxel.model)) return null;
    const m = assets.model(comps.voxel.model);
    const v = m && m.voxel;
    if (!v) return null;
    return { radius: (Math.max(v.size[0], v.size[1]) * v.cellM) / 2, height: v.size[2] * v.cellM };
  }
  return null;
}

/**
 * Projects an entity's bounding cylinder to a screen-cell rect (24.7's
 * highlight). Returns `null` when the entity is behind the camera or has no
 * visual extent (e.g. a light/interactable/trigger - those get a marker
 * dot highlighted instead, see `drawMarkers`).
 */
export function computeHighlightRect(cam, cols, rows, pxCellW, pxCellH, center, radius, height) {
  const base = projectPoint(cam, cols, rows, pxCellW, pxCellH, center);
  if (!(base.depth > 0)) return null;
  const top = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x: center.x, y: center.y, z: center.z + height });
  const { rightX, rightY } = cameraBasis(cam);
  const side = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x: center.x + rightX * radius, y: center.y + rightY * radius, z: center.z });
  const halfW = Math.max(1, Math.abs(side.col - base.col));
  return {
    minCol: Math.round(base.col - halfW), maxCol: Math.round(base.col + halfW),
    minRow: Math.round(top.row), maxRow: Math.round(base.row),
  };
}

const MAX_HIGHLIGHT_CELLS = 400; // 24.14 budget guard - a degenerate huge/close rect never spends unbounded per-frame cells

/** Draws a `+ - |` bracket just OUTSIDE `rect` (never inside - the sprite pass composites after the cell pass, 24.7). */
export function drawHighlightRect(rt, rect, fgHex) {
  const { minCol, maxCol, minRow, maxRow } = rect;
  const w = maxCol - minCol, h = maxRow - minRow;
  if (w < 0 || h < 0 || w * h > MAX_HIGHLIGHT_CELLS) return;
  rt.setCell(minCol - 1, minRow - 1, '+', fgHex);
  rt.setCell(maxCol + 1, minRow - 1, '+', fgHex);
  rt.setCell(minCol - 1, maxRow + 1, '+', fgHex);
  rt.setCell(maxCol + 1, maxRow + 1, '+', fgHex);
  for (let c = minCol; c <= maxCol; c++) {
    rt.setCell(c, minRow - 1, '-', fgHex);
    rt.setCell(c, maxRow + 1, '-', fgHex);
  }
  for (let r = minRow; r <= maxRow; r++) {
    rt.setCell(minCol - 1, r, '|', fgHex);
    rt.setCell(maxCol + 1, r, '|', fgHex);
  }
}

/**
 * Draws the current selection's highlight (24.7). `selection` is a
 * `{fileId, collection, id}` item or `null`. Handles both an entity
 * (prop/world entity - projects its cylinder) and a marker-only item
 * (light/interactable - a single highlighted cell at its point).
 */
export function drawSelectionHighlight(rt, cam, cols, rows, pxCellW, pxCellH, world, assets, doc, selection, fgHex) {
  if (!selection) return;
  const entId = selectionEntityId(world, selection);
  if (entId) {
    const data = world.entity(entId);
    if (data && data.transform) {
      const extent = modelExtent(assets, data.components || {});
      if (extent) {
        const rect = computeHighlightRect(cam, cols, rows, pxCellW, pxCellH, data.transform, extent.radius, extent.height);
        if (rect) drawHighlightRect(rt, rect, fgHex);
        return;
      }
    }
  }
  // Marker-only selection (light/interactable): highlight its point.
  if (selection.collection === 'lights' || selection.collection === 'interactables') {
    const item = selectionItemData(doc, selection);
    const levelId = selection.fileId.slice('level/'.length);
    const s = world.structures.find((st) => st.level.name === levelId);
    if (item && s) {
      const point = { x: item.x + s.origin.x, y: item.y + s.origin.y, z: (item.z || 0) + s.origin.z };
      const proj = projectPoint(cam, cols, rows, pxCellW, pxCellH, point);
      if (proj.depth > 0) rt.setCell(Math.round(proj.col), Math.round(proj.row), '*', fgHex);
    }
  }
}

const MAX_MARKER_CELLS = 200; // 24.7 budget

/**
 * Draws light/interactable/player-spawn markers (24.7). Toggle `M`, default
 * on. Cells/circle-shaped triggers are NOT drawn (kept simple - the
 * outliner is the way to select them, per the architecture note); this is a
 * documented limitation, not an oversight.
 */
export function drawMarkers(rt, cam, cols, rows, pxCellW, pxCellH, world, palette, selection) {
  let budget = MAX_MARKER_CELLS;
  const put = (x, y, z, glyph, fgHex) => {
    if (budget <= 0) return;
    const proj = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x, y, z });
    if (!(proj.depth > 0)) return;
    const c = Math.round(proj.col), r = Math.round(proj.row);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    rt.setCell(c, r, glyph, fgHex);
    budget--;
  };
  const dimHex = (palette.colors && palette.colors.uiDim) || '#666666';
  const goldHex = (palette.colors && palette.colors.gold) || '#ffd24a';
  for (const s of world.structures) {
    const def = s.level.def;
    for (const l of def.lights || []) {
      const on = l.on !== false;
      const sel = selection && selection.collection === 'lights' && selection.id === l.id && selection.fileId === `level/${s.level.name}`;
      put(l.x + s.origin.x, l.y + s.origin.y, l.z + s.origin.z, '*', sel ? goldHex : on ? goldHex : dimHex);
    }
    for (const it of def.interactables || []) {
      const sel = selection && selection.collection === 'interactables' && selection.id === it.id && selection.fileId === `level/${s.level.name}`;
      put(it.x + s.origin.x, it.y + s.origin.y, it.z + s.origin.z, 'o', sel ? goldHex : dimHex);
    }
  }
}

/**
 * Draws a plain outline (four `.`-corner style markers would be noisy at 1
 * cell; a simple inverse-ish tint is enough per 24.6's own "outlined" note)
 * around the hovered cell. No readback - pure cell tracking, cheap enough
 * to run every frame the mouse is over the canvas.
 */
export function drawHoverOutline(rt, col, row, fgHex) {
  if (col == null || row == null) return;
  rt.setCell(col, row, '.', fgHex);
}
