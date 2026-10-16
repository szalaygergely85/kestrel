// HPBAR-02 (D-086): draws the enemy bars ("[#####-----] Lv 6 Boar") above the beasts' heads through the same ui.setCellRGB path as
// compassHud / noticeView. The model is HPBAR-01 (enemyBar.js). Zero allocation per frame: labels are rebuilt only when frac cells / level / name change.
// Host contract: project(x, y, z, out) -> bool (true = in front of the camera), fills out.c / out.r in UI cells (the centre-bottom of the bar).
// UI scale: the bar is cell-based, so the Settings text size (UI grid density) scales it for free.
import { createEnemyBars } from './enemyBar.js';
import { enemyBarsOn } from './combatHudFlags.js';

export const BAR_CELLS = 10;      // inner cells; with the brackets the bar is 12 wide
export const MAX_WIDTH = 22;
export const FADE_SEC = 0.3;
const HEAD_LIFT = 0.45;           // metres above the head point
const BG = [8, 6, 4], TEXT_KEY = 'uiText', EMPTY_KEY = 'uiDim';

const cellsOf = (frac) => (frac <= 0 ? 0 : Math.min(BAR_CELLS, Math.ceil(frac * BAR_CELLS)));

/** Bar label for a result: "[#####-----] Lv 6 Boar", capped to MAX_WIDTH cells. */
export function barLabel(frac, level, name, boss) {
  const f = cellsOf(frac);
  const s = '[' + '#'.repeat(f) + '-'.repeat(BAR_CELLS - f) + '] ' + (boss ? 'Boss ' : 'Lv ' + level + ' ') + name;
  return s.length > MAX_WIDTH ? s.slice(0, MAX_WIDTH) : s;
}

export function createEnemyBarView({ rgb, project, band = null, select = null, enabled = enemyBarsOn, slots: nSlots = 6 } = {}) {
  const bars = createEnemyBars({ band });
  const pick = select || ((count, fill, now, pb) => bars.select(count, fill, now, pb));
  const slots = [];
  for (let i = 0; i < nSlots; i++) slots.push({ id: '', a: 0, live: false, frac: 0, level: 0, name: '', boss: false, tint: 'gold', x: 0, y: 0, z: 0, key: -1, text: '', textName: '' });
  const pt = { c: 0, r: 0 };
  const col = (k) => rgb[k] || rgb.uiText || [230, 230, 230];

  function slotFor(id) {
    let free = -1, weakest = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].id === id && slots[i].a > 0) return slots[i];
      if (free < 0 && slots[i].a <= 0) free = i;
      if (slots[i].a < slots[weakest].a) weakest = i;
    }
    return slots[free >= 0 ? free : weakest];
  }

  /** Call once per frame (before draw). `fill(i, rec)` fills the beast record; see enemyBar.js. */
  function update(count, fill, now, dt, playerBand = 1) {
    for (let i = 0; i < slots.length; i++) slots[i].live = false;
    if (enabled()) {
      const n = pick(count, fill, now, playerBand);
      for (let k = 0; k < n; k++) {
        const b = bars.list[k], s = slotFor(b.id);
        if (s.id !== b.id) { s.id = b.id; s.a = 0; s.key = -1; }
        s.live = true; s.frac = b.frac; s.level = b.level; s.name = b.name; s.boss = b.boss; s.tint = b.tint; s.x = b.x; s.y = b.y; s.z = b.z;
      }
    }
    const step = dt / FADE_SEC;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.live) s.a = Math.min(1, s.a + step);
      else if (s.a > 0) { s.a = Math.max(0, s.a - step); if (s.a === 0) s.id = ''; }
    }
  }

  function put(ui, x, y, ch, c, a) {
    if (x < 0 || y < 0 || x >= ui.cols || y >= ui.rows) return;
    ui.setCellRGB(x, y, ch - 32, (c[0] * a) | 0, (c[1] * a) | 0, (c[2] * a) | 0, (BG[0] * a) | 0, (BG[1] * a) | 0, (BG[2] * a) | 0);
  }

  /** hidden = pause / inventory / map / cinematic. Off-setting or hidden -> nothing is drawn. */
  function draw(ui, hidden) {
    if (hidden || !enabled()) return;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.a <= 0 || !s.id) continue;
      const key = cellsOf(s.frac) * 1000 + s.level;
      if (key !== s.key || s.textName !== s.name) { s.key = key; s.textName = s.name; s.text = barLabel(s.frac, s.level, s.name, s.boss); }
      if (!project(s.x, s.y, s.z + HEAD_LIFT, pt)) continue;
      if (pt.c < 0 || pt.c >= ui.cols || pt.r < 0 || pt.r >= ui.rows) continue; // VISQA-01: beast off-screen -> no bar pinned to the screen edge (the clamp below is only for heads near the edge)
      const w = s.text.length;
      let x0 = (pt.c | 0) - (w >> 1), y0 = (pt.r | 0) - 1;
      x0 = x0 < 0 ? 0 : x0 + w > ui.cols ? ui.cols - w : x0;
      y0 = y0 < 0 ? 0 : y0 > ui.rows - 2 ? ui.rows - 2 : y0;
      const tint = col(s.tint), text = col(TEXT_KEY), dim = col(EMPTY_KEY);
      for (let j = 0; j < w; j++) {
        const ch = s.text.charCodeAt(j);
        const c = j >= BAR_CELLS + 2 ? text : (j === 0 || j === BAR_CELLS + 1) ? text : ch === 35 ? tint : dim;
        put(ui, x0 + j, y0, ch, c, s.a);
      }
    }
  }
  return { update, draw, slots, bars };
}
