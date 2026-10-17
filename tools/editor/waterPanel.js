// tools/editor/waterPanel.js - ED-WATER-01 (OB-223). Small floating "Water" panel (toggle, region list, z / width / height
// fields) + the viewport overlay (outline and 8 handles of the selected rect). Logic lives in waterTool.js (Node-tested).
import { projectPoint } from './ray.js';
import { handles } from './waterTool.js';
const BG = '#0a0b10';

/** deps: { tool, onToggle:(on)=>void } -> { el, refresh(), isOn() } */
export function mountWaterPanel(root, { tool, onToggle }) {
  const el = document.createElement('div');
  el.id = 'water-panel';
  el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:20;background:#12141c;color:#cfd6e6;font:12px monospace;border:1px solid #2c3142;padding:6px 8px;max-width:260px';
  el.innerHTML = '<label><input type="checkbox" id="water-on"> Water tool</label><div id="water-body" hidden>' +
    '<select id="water-list" size="6" style="width:100%;margin:4px 0"></select>' +
    '<div id="water-fields">z <input id="water-z" type="number" step="0.05" style="width:62px"> w <input id="water-w" type="number" step="0.5" min="1" style="width:52px"> h <input id="water-h" type="number" step="0.5" min="1" style="width:52px"></div>' +
    '<div id="water-msg" style="margin-top:4px;color:#e0b060"></div>' +
    '<div style="color:#7a8296">Click water to pick; drag a handle to resize, drag inside to move.</div></div>';
  root.appendChild(el);
  const $ = (id) => el.querySelector('#' + id);
  let on = false;
  $('water-on').addEventListener('change', (e) => { on = e.target.checked; $('water-body').hidden = !on; if (!on) tool.select(null); onToggle(on); refresh(); });
  $('water-list').addEventListener('change', (e) => tool.select(e.target.value));
  $('water-z').addEventListener('change', (e) => { tool.setSurfaceZ(parseFloat(e.target.value)); refresh(); });
  const size = () => { tool.setSize(parseFloat($('water-w').value), parseFloat($('water-h').value)); refresh(); };
  $('water-w').addEventListener('change', size); $('water-h').addEventListener('change', size);
  function refresh() {
    if (!on) return;
    const list = $('water-list'), regs = tool.regions();
    list.innerHTML = '';
    for (const r of regs) {
      const o = document.createElement('option'); o.value = r.id; o.selected = r.id === tool.st.sel;
      o.textContent = r.editable ? `${r.id}  ${r.w.toFixed(0)}x${r.h.toFixed(0)} m` : `${r.id}  (read-only)`;
      if (!r.editable) { o.title = r.tip; o.style.color = '#7a8296'; }
      list.appendChild(o);
    }
    const cur = tool.current(), editable = !!cur && !tool.st.msg;
    for (const id of ['water-z', 'water-w', 'water-h']) $(id).disabled = !editable;
    if (cur && editable) { $('water-z').value = cur.z; $('water-w').value = cur.rect[2] - cur.rect[0]; $('water-h').value = cur.rect[3] - cur.rect[1]; }
    $('water-msg').textContent = tool.st.msg;
  }
  return { el, refresh, isOn: () => on };
}

/** Overlay: outline (the live drag preview when dragging) + handles as 'o' / '#' cells on the ground at the surface z. */
export function createWaterOverlay({ rt, getCam, renderer, getZ }) {
  const proj = (x, y, z) => {
    const v = projectPoint(getCam(), rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, { x, y, z }, renderer);
    if (!(v.depth > 0)) return null;
    const col = Math.round(v.col), row = Math.round(v.row);
    return col >= 0 && col < rt.cols && row >= 0 && row < rt.rows ? { col, row } : null;
  };
  return {
    draw(plate, tool) {
      const r = tool.current(); if (!r || !Array.isArray(r.rect)) return;
      const rect = tool.st.preview || r.rect, [x0, y0, x1, y1] = rect, z = r.z + 0.1;
      const n = Math.max(8, Math.ceil(Math.max(x1 - x0, y1 - y0) / 1.5)), col = '#5ac8ff';
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (const [px, py] of [[x, y0], [x, y1], [x0, y], [x1, y]]) { const c = proj(px, py, z); if (c) plate.setCell(c.col, c.row, 'o', col, BG); }
      }
      for (const h of handles(rect)) { const c = proj(h.x, h.y, z); if (c) plate.setCell(c.col, c.row, '#', '#ffffff', BG); }
    },
  };
}
