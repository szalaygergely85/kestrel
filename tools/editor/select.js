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
import { localToWorld, createPitchedTerms, pitchedTerms, worldToCell } from '../../engine/index.js';
import { EDITOR_PLATE_BG } from './overlayStyle.js';

/**
 * Model world-space radius/height for the highlight box (same rule as
 * ray.js's `rayPickEntities`). `scale` (ED-SCALE-1c, 34.2 item 9) multiplies
 * the voxel branch only - sprites/billboards have no scale in this story
 * (34.1's scope).
 */
function modelExtent(assets, comps, scale = 1) {
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
    return { radius: (Math.max(v.size[0], v.size[1]) * v.cellM * scale) / 2, height: v.size[2] * v.cellM * scale };
  }
  return null;
}

/**
 * Projects an entity's bounding cylinder to a screen-cell rect (24.7's
 * highlight). Returns `null` when the entity is behind the camera or has no
 * visual extent (e.g. a light/interactable/trigger - those get a marker
 * dot highlighted instead, see `drawMarkers`).
 */
export function computeHighlightRect(cam, cols, rows, pxCellW, pxCellH, center, radius, height, renderer = 'dda') {
  const base = projectPoint(cam, cols, rows, pxCellW, pxCellH, center, renderer);
  if (!(base.depth > 0)) return null;
  const top = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x: center.x, y: center.y, z: center.z + height }, renderer);
  const { rightX, rightY } = cameraBasis(cam);
  const side = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x: center.x + rightX * radius, y: center.y + rightY * radius, z: center.z }, renderer);
  const halfW = Math.max(1, Math.abs(side.col - base.col));
  return {
    minCol: Math.round(base.col - halfW), maxCol: Math.round(base.col + halfW),
    minRow: Math.round(top.row), maxRow: Math.round(base.row),
  };
}

const MAX_HIGHLIGHT_CELLS = 400; // 24.14 budget guard - a degenerate huge/close rect never spends unbounded per-frame cells

const meshTerms = createPitchedTerms(), meshCell = new Float64Array(3);
const meshGrid = { cols:0, rows:0, pxCellW:0, pxCellH:0 };
const meshRect = { minCol:0, maxCol:0, minRow:0, maxRow:0 };
/** World bbox corners, optionally translated for a doc-only drag ghost. */
export function computeMeshHighlightRect(cam, cols, rows, pxCellW, pxCellH, bbox, dx=0, dy=0, dz=0) {
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  meshGrid.cols=cols;meshGrid.rows=rows;meshGrid.pxCellW=pxCellW;meshGrid.pxCellH=pxCellH;
  pitchedTerms(cam,meshGrid,meshTerms);
  for(let i=0;i<8;i++) {
    worldToCell(meshTerms,(i&1?bbox.x1:bbox.x0)+dx,(i&2?bbox.y1:bbox.y0)+dy,(i&4?bbox.z1:bbox.z0)+dz,meshCell);
    if(!(meshCell[2]>0))return null;
    x0=Math.min(x0,meshCell[0]);x1=Math.max(x1,meshCell[0]);y0=Math.min(y0,meshCell[1]);y1=Math.max(y1,meshCell[1]);
  }
  meshRect.minCol=Math.round(x0);meshRect.maxCol=Math.round(x1);meshRect.minRow=Math.round(y0);meshRect.maxRow=Math.round(y1);
  return meshRect;
}

/** Large mesh bounds get short corner brackets within the existing overlay budget. */
export function drawMeshHighlightRect(rt, rect, fgHex) {
  const {minCol,maxCol,minRow,maxRow}=rect;
  const w=maxCol-minCol,h=maxRow-minRow;
  if(w<0||h<0)return;
  if(w*h<=MAX_HIGHLIGHT_CELLS && 2*(w+h)+8<=MAX_HIGHLIGHT_CELLS) { drawHighlightRect(rt,rect,fgHex);return; }
  for(let i=0;i<4;i++) {
    const right=!!(i&1), bottom=!!(i&2), x=right?maxCol+1:minCol-1,y=bottom?maxRow+1:minRow-1;
    rt.setCell(x,y,'+',fgHex,EDITOR_PLATE_BG);
    rt.setCell(x+(right?-1:1),y,'-',fgHex,EDITOR_PLATE_BG);
    rt.setCell(x,y+(bottom?-1:1),'|',fgHex,EDITOR_PLATE_BG);
  }
}

/** Draws a `+ - |` bracket just OUTSIDE `rect` (never inside - the sprite pass composites after the cell pass, 24.7). */
export function drawHighlightRect(rt, rect, fgHex) {
  const { minCol, maxCol, minRow, maxRow } = rect;
  const w = maxCol - minCol, h = maxRow - minRow;
  if (w < 0 || h < 0 || w * h > MAX_HIGHLIGHT_CELLS) return;
  rt.setCell(minCol - 1, minRow - 1, '+', fgHex, EDITOR_PLATE_BG);
  rt.setCell(maxCol + 1, minRow - 1, '+', fgHex, EDITOR_PLATE_BG);
  rt.setCell(minCol - 1, maxRow + 1, '+', fgHex, EDITOR_PLATE_BG);
  rt.setCell(maxCol + 1, maxRow + 1, '+', fgHex, EDITOR_PLATE_BG);
  for (let c = minCol; c <= maxCol; c++) {
    rt.setCell(c, minRow - 1, '-', fgHex, EDITOR_PLATE_BG);
    rt.setCell(c, maxRow + 1, '-', fgHex, EDITOR_PLATE_BG);
  }
  for (let r = minRow; r <= maxRow; r++) {
    rt.setCell(minCol - 1, r, '|', fgHex, EDITOR_PLATE_BG);
    rt.setCell(maxCol + 1, r, '|', fgHex, EDITOR_PLATE_BG);
  }
}

/**
 * Draws the current selection's highlight (24.7). `selection` is a
 * `{fileId, collection, id}` item or `null`. Handles both an entity
 * (prop/world entity - projects its cylinder) and a marker-only item
 * (light/interactable - a single highlighted cell at its point).
 */
export function drawSelectionHighlight(rt, cam, cols, rows, pxCellW, pxCellH, world, assets, doc, selection, fgHex, renderer = 'dda', previewItems) {
  if (!selection) return;
  if (selection.collection === 'structures') {
    const s=world.structures.find(s=>s.id===selection.id && s.kind==='mesh');
    const rect=s && computeMeshHighlightRect(cam,cols,rows,pxCellW,pxCellH,s.bbox);
    if(rect)drawMeshHighlightRect(rt,rect,fgHex);
    return;
  }
  const entId = selectionEntityId(world, selection);
  if (entId) {
    const data = world.entity(entId);
    if (data && data.transform) {
      const scale = typeof data.transform.scale === 'number' ? data.transform.scale : 1;
      const extent = modelExtent(assets, data.components || {}, scale);
      if (extent) {
        const rect = computeHighlightRect(cam, cols, rows, pxCellW, pxCellH, data.transform, extent.radius, extent.height, renderer);
        if (rect) drawMeshHighlightRect(rt, rect, fgHex);
        return;
      }
    }
  }
  // Marker-only selection (light/interactable): highlight its point.
  // CO-7: resolves the owning structure by `structId` (never the level name)
  // when the selection carries one, so two placements of one level pick the
  // right frame; falls back to the level-name match for an older-shaped
  // selection with no `structId`.
  if (selection.collection === 'lights' || selection.collection === 'interactables') {
    const authored = selectionItemData(doc, selection);
    const item = previewItems?.get(authored) || authored;
    const s = selection.structId != null
      ? world.structures.find((st) => st.id === selection.structId)
      : world.structures.find((st) => st.level && st.level.name === selection.fileId.slice('level/'.length));
    if (item && s) {
      const point = localToWorld(s.frame, item.x, item.y, item.z || 0, { x: 0, y: 0, z: 0 });
      const proj = projectPoint(cam, cols, rows, pxCellW, pxCellH, point, renderer);
      if (proj.depth > 0) rt.setCell(Math.round(proj.col), Math.round(proj.row), '*', fgHex, EDITOR_PLATE_BG);
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
export function drawMarkers(rt, cam, cols, rows, pxCellW, pxCellH, world, palette, selection, renderer = 'dda', previewItems) {
  let budget = MAX_MARKER_CELLS;
  const put = (x, y, z, glyph, fgHex) => {
    if (budget <= 0) return;
    const proj = projectPoint(cam, cols, rows, pxCellW, pxCellH, { x, y, z }, renderer);
    if (!(proj.depth > 0)) return;
    const c = Math.round(proj.col), r = Math.round(proj.row);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    rt.setCell(c, r, glyph, fgHex, EDITOR_PLATE_BG);
    budget--;
  };
  const dimHex = (palette.colors && palette.colors.uiDim) || '#666666';
  const goldHex = (palette.colors && palette.colors.gold) || '#ffd24a';
  // CO-7: world position via the structure's own frame (was `+ s.origin`);
  // the "is this the selected one" check also requires `structId` to match
  // when the selection carries one, so selecting a marker in ONE placement
  // never highlights the same-id marker in another placement of the same level.
  for (const s of world.structures) {
    if (!s.level) continue; // mesh/road structures carry no level markers
    const def = s.level.def;
    const sameStruct = (sel) => sel.structId == null || sel.structId === s.id;
    for (const authored of def.lights || []) {
      const l=previewItems?.get(authored) || authored;
      const on = l.on !== false;
      const sel = selection && selection.collection === 'lights' && selection.id === l.id
        && selection.fileId === `level/${s.level.name}` && sameStruct(selection);
      const p = localToWorld(s.frame, l.x, l.y, l.z, { x: 0, y: 0, z: 0 });
      put(p.x, p.y, p.z, '*', sel ? goldHex : on ? goldHex : dimHex);
    }
    for (const it of def.interactables || []) {
      const sel = selection && selection.collection === 'interactables' && selection.id === it.id
        && selection.fileId === `level/${s.level.name}` && sameStruct(selection);
      const p = localToWorld(s.frame, it.x, it.y, it.z, { x: 0, y: 0, z: 0 });
      put(p.x, p.y, p.z, 'o', sel ? goldHex : dimHex);
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
  rt.setCell(col, row, '.', fgHex, EDITOR_PLATE_BG);
}
