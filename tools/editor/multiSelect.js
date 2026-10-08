// ED-GROUP-1a (architecture 37.11): selection state and pivot-based box hits.
import { frameFor, itemToWorld } from './doc.js';
import { projectPoint } from './ray.js';

/** A placement is part of the identity: two copies of a level share content ids. */
export function sameSelectionItem(a, b) {
  return !!a && !!b && a.fileId === b.fileId && a.collection === b.collection
    && a.id === b.id && (a.structId ?? null) === (b.structId ?? null);
}

export function selectionContains(sel, item) {
  return sel.items.some((it) => sameSelectionItem(it, item));
}

export function replaceSelection(item = null) {
  return { items: item ? [item] : [], primary: item ? 0 : -1 };
}

/** Toggle without mutating the previous set; newly added items become primary. */
export function toggleSelection(sel, item) {
  const index = sel.items.findIndex((it) => sameSelectionItem(it, item));
  if (index < 0) return { items: [...sel.items, item], primary: sel.items.length };
  const items = sel.items.filter((_, i) => i !== index);
  const primary = index === sel.primary ? items.length - 1 : sel.primary - (index < sel.primary ? 1 : 0);
  return { items, primary: items.length ? primary : -1 };
}

/** Undo/redo may rename a secondary member or a shared level item in two placements. */
export function renameSelection(sel, record) {
  if (record.renameFrom === undefined) return sel;
  const items = sel.items.map(it => it.fileId === record.fileId && it.collection === record.collection
    && it.id === record.renameFrom ? {...it,id:record.renameTo} : it);
  return { items, primary:sel.primary };
}

/** Props include world-file prop entities; other entity types stay single-select. */
export function canMultiSelect(item, data) {
  return !!item && (item.collection === 'props' || item.collection === 'lights'
    || (item.collection === 'entities' && data?.type === 'prop'));
}

/** Enumerate only placed level items, preserving each placement's authored frame. */
export function selectionCandidates(doc, world) {
  const out = [];
  for (const s of world.structures) {
    if (!s.level) continue;
    const fileId = `level/${s.level.name}`, file = doc.files.get(fileId);
    if (!file) continue;
    for (const collection of ['props', 'lights']) {
      for (const data of file.def[collection] || []) {
        const item = { fileId, collection, id: data.id, structId: s.id };
        const t = collection === 'props' && world.entity?.(`${s.id}.${data.id}`)?.transform;
        const point = t ? {x:t.x,y:t.y,z:t.z}
          : itemToWorld(frameFor(world, item), data.x, data.y, typeof data.z === 'number' ? data.z : 0);
        out.push({ item, point });
      }
    }
  }
  const fileId = `world/${doc.worldId}`, file = doc.files.get(fileId);
  for (const data of file?.def.entities || []) {
    const item = { fileId, collection: 'entities', id: data.id, structId: null };
    if (canMultiSelect(item, data)) {
      const t=world.entity?.(data.id)?.transform || data;
      out.push({ item, point: { x:t.x, y:t.y, z:typeof t.z==='number'?t.z:0 } });
    }
  }
  return out;
}

/** Project pivots with the same public camera path as selection highlights. */
export function boxSelection(candidates, rect, view, initial = replaceSelection()) {
  const minCol = Math.min(rect.startCol, rect.col), maxCol = Math.max(rect.startCol, rect.col);
  const minRow = Math.min(rect.startRow, rect.row), maxRow = Math.max(rect.startRow, rect.row);
  const { cam, cols, rows, pxCellW, pxCellH, renderer } = view;
  const items = initial.items.slice();
  for (const { item, point } of candidates) {
    const p = projectPoint(cam, cols, rows, pxCellW, pxCellH, point, renderer);
    if (!(p.depth > 0) || !Number.isFinite(p.col) || !Number.isFinite(p.row)) continue;
    if (p.col < 0 || p.col >= cols || p.row < 0 || p.row >= rows) continue;
    if (p.col < minCol || p.col > maxCol || p.row < minRow || p.row > maxRow) continue;
    if (!items.some((it) => sameSelectionItem(it, item))) items.push(item);
  }
  return { items, primary: items.length > initial.items.length ? items.length - 1 : initial.primary };
}
