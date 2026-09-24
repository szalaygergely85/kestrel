// game/js/ui/titleCard.js (US-015, docs/architecture.md 7.6 item 8). Draws
// the KESTREL logo + "SOMEONE IS CALLING" subtitle, driven by the wake
// timeline's `titleA`/`titleState` (game/js/quest/wake.js) rather than the
// panel's own open/close fade timers - the wake sequence is the master
// clock here, not the panel's fadeIn/fadeOut. Reuses `buildPanelArt`
// (engine/ui/panel.js) for the baked glyph/colour art and `drawPanel` for
// the subtitle; the title itself draws through `drawTitleGlyphs` below (a
// copy of `drawPanel`'s loop plus `model.shine`'s diagonal sweep during the
// hold - a game-specific effect, kept out of the generic engine primitive).
import { buildPanelArt, drawPanel, fadeGlyph, hexToRgb } from '../../../engine/index.js';

const HASH_CODE = '#'.charCodeAt(0);

let titleArt = null, subtitleArt = null;
let layout = null;
const subPanel = { state: 'open', a: 0, x0: 0, y0: 0, art: null };
let shineCfg = null; // model.shine, resolved once (period/width/slope/amount + rgb)

/** Load-time build + layout (palette/model/uiGrid are constants for the run). */
export function initTitleCard(assets, sceneCols, sceneRows) {
  const model = assets.model('title'), sub = assets.model('subtitle');
  if (!titleArt) titleArt = buildPanelArt(model, assets.palette, 'show');
  if (!subtitleArt) subtitleArt = buildPanelArt(sub, assets.palette, 'show');
  if (!shineCfg && model.shine) {
    const s = model.shine;
    shineCfg = { period: s.period, width: s.width, slope: s.slope, amount: s.amount, rgb: hexToRgb(assets.palette.colors[s.color] || '#ffffff') };
  }
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
 * Same frame-by-time / fade-by-`a` loop as `engine/ui/panel.js`'s
 * `drawPanel`, plus `model.shine`'s diagonal band ONLY while `withShine` is
 * true (the 3 s title hold - design/models/title.js `shine.rule`): a cell
 * whose UNFADED glyph is `#` (the logo's solid letter body, never the drop
 * shadow/flourish glyphs) and satisfies `0 <= x - slope*y - pos < width`
 * gets its colour lerped toward `shine.color` by `shine.amount`. `pos`
 * sweeps `-16 .. art.w+16` once per `shine.period` seconds, off the same
 * absolute clock as everything else here (no separate "hold start" clock).
 */
function drawTitleGlyphs(rt, timeMs, a, x0, y0, art, lut, withShine) {
  const loop = art.loopMs > 0 ? art.loopMs : 1;
  const t = ((timeMs % loop) + loop) % loop;
  let f = 0, acc = 0;
  for (; f < art.nFrames; f++) { acc += art.durMs[f]; if (t < acc) break; }
  if (f >= art.nFrames) f = art.nFrames - 1;

  const fgGain = lut ? lut.minGain + (1 - lut.minGain) * a : a;
  let pos = null;
  if (withShine && shineCfg) {
    const span = art.w + 32; // -16 .. w+16
    const phase = (timeMs / 1000 % shineCfg.period) / shineCfg.period;
    pos = -16 + phase * span;
  }
  const base = f * art.w * art.h;
  for (let y = 0; y < art.h; y++) {
    for (let x = 0; x < art.w; x++) {
      const gi = base + y * art.w + x;
      const code = art.codes[gi];
      if (code === 0) continue;
      const ri = gi * 3;
      let outCode = code, r = art.rgb[ri], g = art.rgb[ri + 1], b = art.rgb[ri + 2];
      if (a < 1) {
        outCode = lut ? fadeGlyph(code, a, lut) : code;
        r = (r * fgGain) | 0; g = (g * fgGain) | 0; b = (b * fgGain) | 0;
      }
      if (outCode <= 32) continue;
      if (pos !== null && code === HASH_CODE) {
        const d = x - shineCfg.slope * y - pos;
        if (d >= 0 && d < shineCfg.width) {
          r = (r + (shineCfg.rgb[0] - r) * shineCfg.amount) | 0;
          g = (g + (shineCfg.rgb[1] - g) * shineCfg.amount) | 0;
          b = (b + (shineCfg.rgb[2] - b) * shineCfg.amount) | 0;
        }
      }
      rt.setCellRGB(x0 + x, y0 + y, outCode - 32, r, g, b, 0, 0, 0);
    }
  }
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
  drawTitleGlyphs(rt, timeMs, titleA, layout.titleX0, layout.titleY0, titleArt, lut, titleState === 'hold');
  subPanel.a = titleA; subPanel.x0 = layout.subX0; subPanel.y0 = layout.subY0; subPanel.art = subtitleArt; // reused, no per-frame object
  drawPanel(rt, subPanel, timeMs, lut);
}
