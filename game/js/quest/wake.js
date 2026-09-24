// game/js/quest/wake.js (US-015, docs/architecture.md 7.6 item 8). The
// opening timeline: black screen -> eyelid blink reveal -> camera rise
// (lying -> standing eye height) -> title card in/hold/out. `wakeFrame` is
// PURE (no `rt`/DOM) so it is trivially unit-testable; `drawEyelid` is the
// only function here that touches the render target, and only ever draws
// full scene rows (masked JS cells - a SCENE effect, never the UI layer,
// per uiStyle.uiScale.blink).
//
// Persistent state: `world.state['quest.wakeT']` (US-015 7.6 item 6),
// counted up every fixed step by the caller (main.js) - restart resets it
// to 0 for free via `deserialize(initialState)`.

/**
 * @typedef {{blackA:number, blinkOpen:number, eyeH:number, inputLocked:boolean,
 *   titleState:'none'|'in'|'hold'|'out'|'done', titleA:number, wakeDoneAtSec:number}} WakeOut
 */

function sampleCurve(curve, t) {
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [t0, v0] = curve[i - 1], [t1, v1] = curve[i];
    if (t <= t1) {
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * f;
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * @param {number} t - `world.state['quest.wakeT']`, seconds since world load
 * @param {{blackSec?:number, riseSec?:number, blinkCurve:number[][],
 *   titleIn?:number, titleHold?:number, titleOut?:number,
 *   startEyeH:number, bodyEyeH:number}} cfg
 * @param {WakeOut} out - written in place (no allocation, per-step caller)
 * @returns {WakeOut} out
 */
export function wakeFrame(t, cfg, out) {
  const blackSec = typeof cfg.blackSec === 'number' ? cfg.blackSec : 1.0;
  const riseSec = typeof cfg.riseSec === 'number' ? cfg.riseSec : 1.2;
  const curve = cfg.blinkCurve;
  const blinkSec = curve[curve.length - 1][0];
  const titleIn = typeof cfg.titleIn === 'number' ? cfg.titleIn : 1.0;
  const titleHold = typeof cfg.titleHold === 'number' ? cfg.titleHold : 3.0;
  const titleOut = typeof cfg.titleOut === 'number' ? cfg.titleOut : 1.0;

  const tl = t - blackSec; // local time after the black phase, may be negative
  out.blackA = t < blackSec ? 1 : 0;
  out.blinkOpen = t < blackSec ? 0 : sampleCurve(curve, tl);

  const riseT = tl < 0 ? 0 : (tl > riseSec ? riseSec : tl);
  const frac = riseSec > 0 ? riseT / riseSec : 1;
  out.eyeH = cfg.startEyeH + (cfg.bodyEyeH - cfg.startEyeH) * frac;

  const wakeDoneAtSec = blackSec + Math.max(riseSec, blinkSec);
  out.wakeDoneAtSec = wakeDoneAtSec;
  out.inputLocked = t < wakeDoneAtSec;

  const tt = t - wakeDoneAtSec;
  if (tt < 0) { out.titleState = 'none'; out.titleA = 0; }
  else if (tt < titleIn) { out.titleState = 'in'; out.titleA = titleIn > 0 ? tt / titleIn : 1; }
  else if (tt < titleIn + titleHold) { out.titleState = 'hold'; out.titleA = 1; }
  else if (tt < titleIn + titleHold + titleOut) { out.titleState = 'out'; out.titleA = 1 - (tt - titleIn - titleHold) / (titleOut || 1); }
  else { out.titleState = 'done'; out.titleA = 0; }

  out.titleDoneAtSec = wakeDoneAtSec + titleIn + titleHold + titleOut;
  return out;
}

/**
 * The eyelid (a scene effect, not UI): rows open from the centre line
 * outward as `openFrac` grows 0 -> 1; the row just inside the boundary gets
 * `uiStyle.blink.edgeGlyph` at half brightness. Full-width, masked JS cells
 * (same convention as the end card / pause overlay).
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {{blink:{edgeGlyph:string, edgeColor:string, edgeRows:number}}} uiStyle
 * @param {number} openFrac 0..1
 */
export function drawEyelid(rt, uiStyle, openFrac) {
  if (openFrac >= 1) return; // fully open - nothing to draw
  const rows = rt.rows, cols = rt.cols;
  const centre = rows / 2;
  const blink = uiStyle.blink;
  for (let y = 0; y < rows; y++) {
    const dist = Math.abs(y + 0.5 - centre) / centre; // 0 at centre, 1 at the edge rows
    if (dist <= openFrac) continue; // open row - leave the scene showing
    const isEdge = dist - openFrac <= blink.edgeRows / centre;
    for (let x = 0; x < cols; x++) {
      if (isEdge) rt.setCell(x, y, blink.edgeGlyph, blink.edgeColor, '#000000');
      else rt.setCell(x, y, ' ', '#000000', '#000000');
    }
  }
}
