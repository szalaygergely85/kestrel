// ED-AI-06: debug state labels over beast heads (?dev=1 only). Pure: projection and the ui layer are injected. The text goes
// into the fixed UI layer with ui.setGlyph per char (same path as the use-hint markers); the label list is reused (0 alloc
// once warm). Off = never called.
import { stateLabels } from '../quest/sim/aiTest.js';

const scratch = [];
const pt = new Float64Array(3);
const COLOR = '#ffe27a';

/** project(x,y,z,out3) -> out3 = [col,row,depth] in scene cells (worldToCell); ui.sx/sy map scene -> ui cells. */
export function drawAiLabels(ui, sim, project, px, py, headZ, maxDist = 60) {
  if (!sim) return 0;
  const n = stateLabels(sim, scratch);
  let drawn = 0;
  for (let k = 0; k < n; k++) {
    const e = scratch[k], i = e.slot, x = sim.steer.x[i], y = sim.steer.y[i];
    const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
    if (d2 > maxDist * maxDist) continue;
    pt[2] = 0; project(x, y, headZ(x, y) + 1.6, pt);
    if (!(pt[2] > 0)) continue;
    const cx = Math.floor(pt[0] / ui.sx), cy = Math.floor(pt[1] / ui.sy);
    const lab = e.label, dist = Math.round(Math.sqrt(d2));
    let col = cx - (lab.length >> 1);
    for (let c = 0; c < lab.length; c++) ui.setGlyph(col + c, cy, lab[c], COLOR);
    col = cx - 2; const ds = dist < 10 ? ' ' + dist + 'm' : dist + 'm'; // short distance, no template string per frame beyond this
    for (let c = 0; c < ds.length; c++) ui.setGlyph(col + c, cy + 1, ds[c], COLOR);
    drawn++;
  }
  return drawn;
}
