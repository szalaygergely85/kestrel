// game/js/ui/endCard.js (US-017, D-006/D-008, D-011 reskin: PO placeholder
// text per D-011 - the writer's final lines in docs/story.md replace these,
// and once ASSETS.uiStyle.endText exists (US-015) its strings replace the
// ones hard-coded below; nothing here is engine code (D-006), it is game
// text/layout only).
//
// `computeEndCardState(world, uiStyle)` is pure (no rendering) so main.js
// can also use it to decide whether `[R]` should restart this frame;
// `drawEndCard` is the only function that touches `rt`.
import { drawText } from '../../../engine/index.js';
import { readEndTimings } from '../quest/end.js';

const LINE2 = 'Someone is out there.';
const LINE_CONTINUE = '- to be continued -';
const LINE_RESTART = '[R] Wake again';

function line1For(world) {
  return world.state['tower.beacon.lit']
    ? 'One relay wakes. The signal is still calling.'
    : 'The signal is still calling.';
}

/**
 * @param {import('../../../engine/index.js').World} world
 * @param {Object|undefined} uiStyle
 * @returns {{visible:boolean, line1:string, line2:string, showContinue:boolean, canRestart:boolean, cursorOn:boolean}}
 */
export function computeEndCardState(world, uiStyle) {
  const endT = world.state['quest.endT'];
  const notEnding = typeof endT !== 'number' || endT < 0;
  const out = { visible: false, line1: '', line2: '', showContinue: false, canRestart: false, cursorOn: false };
  if (notEnding) return out;

  const { walkSec, fadeSec, gapSec, cps } = readEndTimings(uiStyle);
  const textT = endT - walkSec - fadeSec;
  if (textT < 0) return out; // still walking/fading - the card has nothing to show yet

  out.visible = true;
  const full1 = line1For(world);
  const dur1 = full1.length / cps;
  const shown1 = Math.min(full1.length, Math.floor(Math.max(0, textT) * cps));
  out.line1 = full1.slice(0, shown1);

  const t2 = textT - dur1;
  const dur2 = LINE2.length / cps;
  if (t2 > 0) out.line2 = LINE2.slice(0, Math.min(LINE2.length, Math.floor(t2 * cps)));

  const afterLine2 = t2 - dur2;
  if (afterLine2 >= gapSec) {
    out.showContinue = true;
    out.canRestart = true;
    out.cursorOn = Math.floor(endT * 2) % 2 === 0; // 2 Hz blink, no uiStyle.blink yet
  }
  return out;
}

/**
 * Draws the end card, centred, onto the already-faded (black) screen. Style
 * is a small fallback (`ASSETS.uiStyle.endText` doesn't exist yet - same
 * precedent as main.js's `crosshairStyle`, US-012) resolved once by the
 * caller from `palette.ui.endText`.
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {{color:string}} style
 * @param {ReturnType<typeof computeEndCardState>} state
 */
export function drawEndCard(rt, style, state) {
  if (!state.visible) return;
  const cx = rt.cols >> 1;
  const midRow = rt.rows >> 1;
  const color = style.color;

  drawCentered(rt, cx, midRow - 1, state.line1, color);
  drawCentered(rt, cx, midRow, state.line2, color);
  if (state.showContinue) drawCentered(rt, cx, midRow + 2, LINE_CONTINUE, color);
  if (state.canRestart) {
    const text = state.cursorOn ? `${LINE_RESTART}_` : LINE_RESTART;
    drawCentered(rt, cx, midRow + 4, text, color);
  }
}

function drawCentered(rt, cx, y, text, color) {
  if (!text) return;
  drawText(rt, cx - (text.length >> 1), y, text, color);
}
