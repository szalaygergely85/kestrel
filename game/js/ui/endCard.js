// game/js/ui/endCard.js (US-017, rewritten US-015 re-check AC, D-006/D-008).
// Every string/colour/cursor/timing now comes from `ASSETS.uiStyle.endText`
// / `uiStyle.fade` (docs/backlog.md US-015 "re-check US-017" AC) - nothing
// is hard-coded here any more. `computeEndCardState(world, uiStyle)` stays
// pure (no rendering), so main.js can also use it to decide whether `[R]`
// restarts this frame; `drawEndCard` is the only function that touches `rt`.
import { compileRichLine, drawRichLine, hexToRgb } from '../../../engine/index.js';
import { readEndTimings } from '../quest/end.js';

// Fallback shape only (defensive - `uiStyle.endText` always exists once
// US-015's design lands; keeps this module from throwing during bootstrap
// races/tests that construct a bare `uiStyle`).
const FALLBACK_LINES = [
  { id: 'signal', row: 29, typed: true, color: 'uiText', text: 'The signal is still calling.' },
  { id: 'someone', row: 30, typed: true, color: 'uiText', text: 'Someone is out there.' },
  { id: 'continue', row: 32, typed: false, color: 'uiHint', text: '- to be continued -', afterGap: true },
  { id: 'restart', row: 34, typed: false, color: 'uiText', text: '[R] Wake again', keys: ['[R]'], afterGap: true, cursor: true, enablesRestart: true },
];

/**
 * @param {import('../../../engine/index.js').World} world
 * @param {Object|undefined} uiStyle
 * @returns {{visible:boolean, canRestart:boolean, cursorOn:boolean,
 *   lines: Array<{id:string, text:string, count:number, row:number, color:string, keys?:string[], cursor?:boolean}>}}
 */
export function computeEndCardState(world, uiStyle) {
  const endT = world.state['quest.endT'];
  const notEnding = typeof endT !== 'number' || endT < 0;
  const out = { visible: false, canRestart: false, cursorOn: false, lines: [] };
  if (notEnding) return out;

  const { walkSec, fadeSec, gapSec, cps } = readEndTimings(uiStyle);
  const textT = endT - walkSec - fadeSec;
  if (textT < 0) return out;
  out.visible = true;

  const endText = uiStyle && uiStyle.endText;
  const lineDefs = (endText && endText.lines) || FALLBACK_LINES;
  const cursorCfg = endText && endText.cursor;

  let remaining = textT;
  let allTypedDone = true;
  for (const def of lineDefs) {
    if (!def.typed) continue;
    const full = (def.altWhen && world.state[def.altWhen]) ? def.alt : def.text;
    const shown = Math.min(full.length, Math.max(0, Math.floor(remaining * cps)));
    if (shown < full.length) allTypedDone = false;
    out.lines.push({ id: def.id, text: full, count: shown, row: def.row, color: def.color, keys: def.keys });
    remaining -= full.length / cps;
  }

  if (allTypedDone && remaining >= gapSec) {
    for (const def of lineDefs) {
      if (def.typed) continue;
      out.lines.push({ id: def.id, text: def.text, count: def.text.length, row: def.row, color: def.color, keys: def.keys });
      if (def.enablesRestart) out.canRestart = true;
    }
    if (cursorCfg) {
      const period = cursorCfg.periodSec || 1.0;
      const duty = typeof cursorCfg.duty === 'number' ? cursorCfg.duty : 0.5;
      out.cursorOn = (endT % period) / period < duty;
    }
  }
  return out;
}

const richCache = new Map(); // "id\u0000text" -> RichLine, small + load-time-ish (typed lines settle to one final text per playthrough)

function ricLine(id, text, colorRgb, keyRgb, keys) {
  const k = id + '\u0000' + text;
  let line = richCache.get(k);
  if (!line) {
    line = compileRichLine(text, colorRgb, keyRgb, keys);
    richCache.set(k, line);
  }
  return line;
}

/**
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {Object} uiStyle - `ASSETS.uiStyle` (colours resolved via `paletteColors`)
 * @param {Object<string,string>} paletteColors - `assets.palette.colors`
 * @param {ReturnType<typeof computeEndCardState>} state
 */
export function drawEndCard(rt, uiStyle, paletteColors, state) {
  if (!state.visible) return;
  const endText = uiStyle && uiStyle.endText;
  const uiGrid = (uiStyle && uiStyle.uiGrid) || { cols: 160, rows: 60 };
  const sy = rt.rows / uiGrid.rows;
  const keyRgb = hexToRgb(paletteColors[(endText && endText.key) || 'gold']);
  const cursorCfg = endText && endText.cursor;

  for (const l of state.lines) {
    const colorRgb = hexToRgb(paletteColors[l.color] || paletteColors.uiText);
    const line = ricLine(l.id, l.text, colorRgb, keyRgb, l.keys);
    const y = Math.round(l.row * sy);
    const x = (rt.cols >> 1) - (l.count >> 1);
    drawRichLine(rt, x, y, line, 1, null, l.count);
    if (cursorCfg && cursorCfg.line === l.id && state.cursorOn) {
      const cursorRgb = hexToRgb(paletteColors[cursorCfg.color] || paletteColors.uiText);
      rt.setCellRGB(x + l.count, y, cursorCfg.glyph.charCodeAt(0) - 32, cursorRgb[0], cursorRgb[1], cursorRgb[2], 0, 0, 0);
    }
  }
}
