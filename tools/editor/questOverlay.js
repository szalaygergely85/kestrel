// tools/editor/questOverlay.js - ED-QUEST-04. Thin draw layer over quest/markers.js: glyphs, area rings and the path line
// into the editor's overlay plate. state = questPanelHandle.markerState() -> { quests:[q], selObj, all }.
import { questMarkers, questPath, makeAreaPos } from './quest/markers.js';
import { projectPoint } from './ray.js';

const BG = '#0a0b10';
const ringPts = (x, y, r, n = 40) => Array.from({ length: n }, (_, i) => [x + Math.cos(i / n * 6.2832) * r, y + Math.sin(i / n * 6.2832) * r]);

/** deps: { rt, getCam, getWorld, floorAt, getAreasFile, renderer }. Returns { draw(plate), pinAt(col,row) -> {qid,obj}|null }. */
export function createQuestOverlay(deps) {
  let pins = [];   // screen hit list of the last draw: [{col,row,qid,obj}]
  const proj = (p) => {
    const { rt } = deps, v = projectPoint(deps.getCam(), rt.cols, rt.rows, rt.pxCellW, rt.pxCellH, p, deps.renderer);
    if (!(v.depth > 0)) return null;
    const col = Math.round(v.col), row = Math.round(v.row);
    return col >= 0 && col < rt.cols && row >= 0 && row < rt.rows ? { col, row } : null;
  };
  const put = (plate, p, ch, hex) => { const c = proj(p); if (c) plate.setCell(c.col, c.row, ch, hex, BG); return c; };

  function draw(plate, state) {
    pins = [];
    if (!state || !state.quests.length) return;
    const world = deps.getWorld(), ctx = { floorAt: deps.floorAt, sites: state.sites, areaPos: makeAreaPos(deps.getAreasFile && deps.getAreasFile(), world) };
    for (const q of state.quests) {
      const ms = questMarkers(q, world, ctx), hot = !state.all || (state.quests.length === 1);
      const path = questPath(ms), color = ms.length ? ms[0].color : '#fff';
      for (let i = 1; i < path.length; i++) {   // dotted line between consecutive stops
        const a = path[i - 1], b = path[i], n = Math.max(2, Math.min(60, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 6)));
        for (let k = 1; k < n; k++) put(plate, { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, z: a.z + (b.z - a.z) * k / n }, '.', color);
      }
      for (const m of ms) {
        if (m.kind === 'area') for (const [x, y] of ringPts(m.x, m.y, m.radius)) put(plate, { x, y, z: (deps.floorAt ? deps.floorAt(x, y) : m.z) + 0.2 }, 'o', color);
        else {
          const sel = hot && m.kind === 'pin' && m.obj === state.selObj;
          const c = put(plate, m, m.kind === 'pin' ? m.label : m.label, sel ? '#ffffff' : color);
          if (c && m.kind === 'pin') pins.push({ col: c.col, row: c.row, qid: q.id, obj: m.obj });
          if (c && sel) { plate.setCell(Math.max(0, c.col - 1), c.row, '[', '#ffffff', BG); plate.setCell(Math.min(deps.rt.cols - 1, c.col + 1), c.row, ']', '#ffffff', BG); }
        }
      }
    }
  }
  /** Click on a pin (within 1 cell) -> the objective it stands for. */
  const pinAt = (col, row) => pins.find((p) => Math.abs(p.col - col) <= 1 && p.row === row) || null;
  return { draw, pinAt };
}
