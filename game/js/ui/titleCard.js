// game/js/ui/titleCard.js (US-015, docs/architecture.md 7.6 item 8). Draws
// the KESTREL logo + "SOMEONE IS CALLING" subtitle, driven by the wake
// timeline's `titleA`/`titleState` (game/js/quest/wake.js) rather than the
// panel's own open/close fade timers - the wake sequence is the master
// clock here, not the panel's fadeIn/fadeOut. Reuses `buildPanelArt`/
// `drawPanel` (engine/ui/panel.js) for the actual glyph draw; the two
// "panel-shaped" objects below are plain data, not `Panel` instances (they
// never call `.step()`/`.open()`/`.close()` - `a`/`state` are written
// directly from `titleA`/`titleState` each frame).
//
// Known limitation (US-015 Programmer notes): the `title.shine` diagonal
// sweep during the hold is NOT implemented - out of budget this pass; the
// logo/subtitle otherwise fade and hold exactly per the wake timeline.
import { buildPanelArt, drawPanel } from '../../../engine/index.js';

let titleArt = null, subtitleArt = null;
let layout = null;

/** Load-time build + layout (palette/model/uiGrid are constants for the run). */
export function initTitleCard(assets, sceneCols, sceneRows) {
  const model = assets.model('title'), sub = assets.model('subtitle');
  if (!titleArt) titleArt = buildPanelArt(model, assets.palette, 'show');
  if (!subtitleArt) subtitleArt = buildPanelArt(sub, assets.palette, 'show');
  const uiGrid = assets.uiStyle.uiGrid;
  const sx = sceneCols / uiGrid.cols, sy = sceneRows / uiGrid.rows;
  const cx = Math.round(model.layout.centerX * sx);
  const titleY0 = Math.round(model.layout.top * sy);
  const titleX0 = cx - (titleArt.w >> 1);
  const subY0 = titleY0 + titleArt.h + (sub.layout.belowTitle || 0);
  const subX0 = cx - (subtitleArt.w >> 1);
  layout = { titleX0, titleY0, subX0, subY0 };
  return layout;
}

/**
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {number} timeMs
 * @param {number} titleA 0..1 (wake.js `WakeOut.titleA`)
 * @param {'none'|'in'|'hold'|'out'|'done'} titleState
 * @param {import('../../../engine/index.js').FadeLut} lut
 */
export function drawTitleCard(rt, timeMs, titleA, titleState, lut) {
  if (titleState === 'none' || titleState === 'done' || titleA <= 0 || !layout) return;
  const titlePanel = { state: 'open', a: titleA, x0: layout.titleX0, y0: layout.titleY0, art: titleArt };
  drawPanel(rt, titlePanel, timeMs, lut);
  const subPanel = { state: 'open', a: titleA, x0: layout.subX0, y0: layout.subY0, art: subtitleArt };
  drawPanel(rt, subPanel, timeMs, lut);
}
