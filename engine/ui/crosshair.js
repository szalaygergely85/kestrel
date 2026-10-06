// engine/ui/crosshair.js (US-012, docs/architecture.md 7.4). Generic:
// reads only `state` (an `InteractionState`) and `style` (data the game
// hands in - the engine never touches `ASSETS`). Drawn straight into the
// glyph grid (emissive, no light/fog, drawn after the world/sprite passes -
// architecture.md section 8 "UI + text").
//
// `style` shape (game/js/main.js builds it from the palette):
//   { crosshair: { dim: '#rrggbb', active: '#rrggbb' },
//     prompt: { color: '#rrggbb', keyColor: '#rrggbb', plateBg: '#rrggbb' } }
import { drawText } from '../render/textDraw.js';

// UI-XHAIR-01: the crosshair is now an OPEN cross drawn with glyph-only cells
// (see uiLayer.js `setGlyph` - the scene's background shows through around the
// glyphs, no black box). It scales by the SCENE grid: a single `+` below 320
// scene cols (e.g. 240x90), a 3x3 open cross (`|` above/below, `-` left/right,
// empty centre - owner 2026-10-06: a `.` sits at the cell bottom, not centred) at >= 320 scene
// cols. `rt` is the fixed 160x60 UI layer (uiStyle.uiGrid), so the scene width
// comes from its `sx` scale (sx = sceneCols/uiCols, set by bindScene); a plain
// rt without `sx` (a scene RenderTarget / test fake) already carries the scene
// cols in `rt.cols`. Every glyph is glyph-only (bg alpha 128); the `[E] prompt`
// plate below stays opaque (setCell/drawText, bg alpha 255) exactly as before.
const CROSSHAIR_GLYPH = '+';
const CROSSHAIR_ARM_V = '|';
const CROSSHAIR_ARM_H = '-';
const CROSSHAIR_3X3_MIN_COLS = 320;
const PROMPT_ROW_GAP = 2; // "2 rows below" (US-012 AC)

// Non-blocking cleanup (arch review, 2026-09-24): cache the key/rest split
// by `state.prompt` string identity, so a held target (same prompt string
// every frame) does not `text.slice` twice per frame.
let cachedPrompt = null, cachedKeyText = '', cachedRestText = '';

/**
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {{crosshair:{dim:string,active:string}, prompt:{color:string,keyColor:string,plateBg?:string}}} style
 * @param {{targetKey:string|null, prompt:string}} state
 */
export function drawCrosshair(rt, style, state) {
  const cx = rt.cols >> 1, cy = rt.rows >> 1;
  const active = !!(state && state.targetKey);
  const chColor = active ? style.crosshair.active : style.crosshair.dim;
  // Size scales with the SCENE grid (the fixed UI layer's sx ratio gives it).
  const sceneCols = rt.sx ? Math.round(rt.cols * rt.sx) : rt.cols;

  if (sceneCols >= CROSSHAIR_3X3_MIN_COLS) {
    // 3x3 open cross (glyph-only cells - transparent background).
    rt.setGlyph(cx, cy - 1, CROSSHAIR_ARM_V, chColor);
    rt.setGlyph(cx, cy + 1, CROSSHAIR_ARM_V, chColor);
    rt.setGlyph(cx - 1, cy, CROSSHAIR_ARM_H, chColor);
    rt.setGlyph(cx + 1, cy, CROSSHAIR_ARM_H, chColor);
  } else {
    // Single-cell crosshair (240x90 and below) - still glyph-only, so no box.
    rt.setGlyph(cx, cy, CROSSHAIR_GLYPH, chColor);
  }

  if (!active || !state.prompt) return;

  const text = state.prompt; // e.g. "[E] Take lamp"
  const py = cy + PROMPT_ROW_GAP;
  const px = cx - (text.length >> 1);
  if (style.prompt.plateBg) {
    for (let i = 0; i < text.length; i++) {
      const x = px + i;
      if (x < 0 || x >= rt.cols || py < 0 || py >= rt.rows) continue;
      rt.setCell(x, py, ' ', style.prompt.color, style.prompt.plateBg);
    }
  }
  // Highlight a leading "[E]" (or any leading "[...]" key hint) in keyColor,
  // the rest in the plain prompt color.
  if (text !== cachedPrompt) {
    const keyEnd = text.startsWith('[') ? text.indexOf(']') + 1 : 0;
    cachedPrompt = text;
    cachedKeyText = keyEnd > 0 ? text.slice(0, keyEnd) : '';
    cachedRestText = keyEnd > 0 ? text.slice(keyEnd) : text;
  }
  if (cachedKeyText) {
    drawText(rt, px, py, cachedKeyText, style.prompt.keyColor, style.prompt.plateBg);
    drawText(rt, px + cachedKeyText.length, py, cachedRestText, style.prompt.color, style.prompt.plateBg);
  } else {
    drawText(rt, px, py, cachedRestText, style.prompt.color, style.prompt.plateBg);
  }
}
