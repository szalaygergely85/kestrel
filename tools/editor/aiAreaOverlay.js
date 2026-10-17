// tools/editor/aiAreaOverlay.js - ED-AI-05. Draws the spawn areas into the editor's overlay plate (ring of 'o' dots on the
// ground, "<Name> xN" label at the centre; red for invalid, white for the selected one). Same projection as questOverlay.js.
import { projectPoint } from './ray.js';
import { areaOutline, areaCentre } from './aiAreaTool.js';
const BG = '#0a0b10';

function draftArea(d, b) {
  const base = { draft: true, kind: b.kind, count: b.count, when: b.when };
  return d.type === 'disc' ? { ...base, shape: 'disc', x: d.x, y: d.y, r: d.r } : { ...base, shape: 'polygon', pts: d.pts };
}

/** deps: { rt, getCam, floorAt, renderer, names:(kind)=>string }. */
export function createAreaOverlay(deps) {
  const proj = (x, y, z) => {
    const { rt } = deps, v = projectPoint(deps.getCam(), rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, { x, y, z }, deps.renderer);
    if (!(v.depth > 0)) return null;
    const col = Math.round(v.col), row = Math.round(v.row);
    return col >= 0 && col < rt.cols && row >= 0 && row < rt.rows ? { col, row } : null;
  };
  return {
    draw(plate, tool) {
      const bad = tool.invalid(), areas = tool.st.draft && (tool.st.draft.type === 'disc' || tool.st.draft.pts.length) ? [...tool.model.areas, draftArea(tool.st.draft, tool.st.brush)] : tool.model.areas;
      for (const a of areas) {
        if (a.shape === 'polygon' && a.pts.length < 2) continue;
        const color = a.draft ? '#9be0ff' : bad[a.id] ? '#ff5050' : a.id === tool.st.sel ? '#ffffff' : a.when === 'night' ? '#9aa0ff' : a.when === 'day' ? '#ffd24a' : '#7ee07e';
        for (const [x, y] of areaOutline(a)) { const c = proj(x, y, deps.floorAt(x, y) + 0.2); if (c) plate.setCell(c.col, c.row, 'o', color, BG); }
        const [cx, cy] = areaCentre(a), c = proj(cx, cy, deps.floorAt(cx, cy) + 1);
        if (c) { const t = `${deps.names(a.kind)} x${a.count}${bad[a.id] ? ' !' : ''}`; for (let i = 0; i < t.length && c.col + i < deps.rt.cols; i++) plate.setCell(c.col + i, c.row, t[i], color, BG); }
      }
    },
  };
}
