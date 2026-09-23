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

const CROSSHAIR_GLYPH = '+';
const PROMPT_ROW_GAP = 2; // "2 rows below" (US-012 AC)

/**
 * @param {import('../render/RenderTarget.js').RenderTarget} rt
 * @param {{crosshair:{dim:string,active:string}, prompt:{color:string,keyColor:string,plateBg?:string}}} style
 * @param {{targetKey:string|null, prompt:string}} state
 */
export function drawCrosshair(rt, style, state) {
  const cx = rt.cols >> 1, cy = rt.rows >> 1;
  const active = !!(state && state.targetKey);
  const chColor = active ? style.crosshair.active : style.crosshair.dim;
  rt.setCell(cx, cy, CROSSHAIR_GLYPH, chColor);

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
  const keyEnd = text.startsWith('[') ? text.indexOf(']') + 1 : 0;
  if (keyEnd > 0) {
    drawText(rt, px, py, text.slice(0, keyEnd), style.prompt.keyColor, style.prompt.plateBg);
    drawText(rt, px + keyEnd, py, text.slice(keyEnd), style.prompt.color, style.prompt.plateBg);
  } else {
    drawText(rt, px, py, text, style.prompt.color, style.prompt.plateBg);
  }
}
