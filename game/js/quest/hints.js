// game/js/quest/hints.js (US-015, docs/architecture.md 7.6 item 7). The
// hint FIFO controller: `uiStyle.hints` + `uiStyle.storyHints`, compiled
// once. Persistent state lives in `world.state` (7.4/7.6 restart rule):
// `hints.shown` (ids ever displayed), `hints.done` (ids whose action was
// performed, shown or not - so a hint whose action already happened is
// never shown later), `hints.walkT`, `hints.chartT`. The runtime queue +
// currently-shown hint are NOT world.state (7.6 item 6: rebuilt only on
// 'world:loaded' - see `resetHints()`, called from main.js's handler).
//
// `hint.show` (the trigger/interaction behaviour name `hintBurner`/
// `hintClimb`/`hintJump` refer to - `design/levels/tower.js` `triggers[]`)
// is `registerQuestBehaviours({hints})`'s job (game/js/quest/index.js): it
// calls `hints.request(world, uiStyle, ctx.def.hint)` and always returns
// `true` (the once-trigger flag is consumed even when the request itself is
// skipped by `skipIfState` - that skip is permanent for a story hint, since
// `request` immediately pushes the id to `hints.done` in that case).
import { compileRichLine, drawRichLine, hexToRgb, pushDimRect } from '../../../engine/index.js';

let compiledDefs = null; // uiStyle identity -> [{id, text, keys, on, doneOn}], compiled once
let compiledForStyle = null;
let queue = [];          // ids waiting, runtime only
let current = null;      // {id, def, prefixLine, textLine, a, state:'in'|'shown'|'out', shownSec} | null
let lineCache = new Map(); // id -> {prefixLine, textLine}, load-time-ish (rebuilt with compiledDefs)

function compile(uiStyle) {
  if (compiledForStyle === uiStyle && compiledDefs) return compiledDefs;
  compiledDefs = (uiStyle.hints || []).concat(uiStyle.storyHints || []);
  compiledForStyle = uiStyle;
  lineCache = new Map();
  return compiledDefs;
}

function defFor(uiStyle, id) {
  return compile(uiStyle).find((h) => h.id === id);
}

/** Rebuilds runtime-only state (7.6 item 6). Call from the 'world:loaded' handler (first load AND every restart). */
export function resetHints() {
  queue = [];
  current = null;
}

function ensureArrays(world) {
  if (!Array.isArray(world.state['hints.shown'])) world.state['hints.shown'] = [];
  if (!Array.isArray(world.state['hints.done'])) world.state['hints.done'] = [];
}

/**
 * Enqueues `id` unless it was already shown, already done, currently
 * showing/queued, or its `on.skipIfState` state key is truthy (a skip by
 * `skipIfState` pushes the id to `hints.done` too, so it is permanent - the
 * "never shown if X" rule for the chart/burner hints).
 * @param {import('../../../engine/index.js').World} world
 * @param {Object} uiStyle
 * @param {string} id
 */
export function request(world, uiStyle, id) {
  ensureArrays(world);
  const shown = world.state['hints.shown'], done = world.state['hints.done'];
  if (shown.includes(id) || done.includes(id)) return;
  const def = defFor(uiStyle, id);
  if (!def) return;
  if (def.on && def.on.skipIfState && world.state[def.on.skipIfState]) {
    done.push(id);
    return;
  }
  if (queue.includes(id) || (current && current.id === id)) return;
  queue.push(id);
}

/** Marks `id`'s action as performed - it is never shown after this, and if it is the one on screen it starts fading out. */
export function markDone(world, id) {
  ensureArrays(world);
  const done = world.state['hints.done'];
  if (!done.includes(id)) done.push(id);
  const qi = queue.indexOf(id);
  if (qi >= 0) queue.splice(qi, 1);
  if (current && current.id === id && current.state !== 'out') {
    current.state = 'out';
  }
}

function buildLines(uiStyle, def) {
  let entry = lineCache.get(def.id);
  if (entry) return entry;
  const hintStyle = uiStyle.hint;
  const P = uiStyle._paletteColors; // resolved hex map, set by main.js via setPaletteColors()
  const prefixRgb = hexToRgb(P[hintStyle.prefixColor]);
  const textRgb = hexToRgb(P[hintStyle.text]);
  const keyRgb = hexToRgb(P[hintStyle.key]);
  const prefixLine = compileRichLine(hintStyle.prefix, prefixRgb, prefixRgb, []);
  const textLine = compileRichLine(def.text, textRgb, keyRgb, def.keys || []);
  entry = { prefixLine, textLine };
  lineCache.set(def.id, entry);
  return entry;
}

/**
 * One fixed step: advances the timed sources (`walkTime`/`timer`/
 * `pointerUnlocked`), applies every done predicate in `signals`, then
 * advances the current on-screen hint's fade/timeout and pops the next one
 * from the FIFO queue.
 * @param {import('../../../engine/index.js').World} world
 * @param {Object} uiStyle
 * @param {number} dt
 * @param {{walking:boolean, pointerUnlocked:boolean, moveOrLook:boolean, run:boolean,
 *   jump:boolean, pointerLocked:boolean, mPressed:boolean}} signals
 */
export function stepHints(world, uiStyle, dt, signals) {
  ensureArrays(world);

  if (signals.walking && typeof world.state['hints.walkT'] === 'number') {
    world.state['hints.walkT'] += dt;
    if (world.state['hints.walkT'] >= 10) request(world, uiStyle, 'run');
  }
  if (typeof world.state['hints.chartT'] === 'number' && world.state['hints.chartT'] >= 0) {
    world.state['hints.chartT'] += dt;
    if (world.state['hints.chartT'] >= 20) {
      request(world, uiStyle, 'chart');
      world.state['hints.chartT'] = -1; // fired - stop counting (also permanently "armed and spent")
    }
  }
  if (signals.pointerUnlocked) request(world, uiStyle, 'capture');

  if (signals.moveOrLook) markDone(world, 'move');
  if (signals.run) markDone(world, 'run');
  if (signals.jump) markDone(world, 'jump');
  if (signals.pointerLocked) markDone(world, 'capture');
  if (world.state['tower.lantern.taken']) markDone(world, 'burner');
  if (signals.mPressed) markDone(world, 'chart');

  const hintStyle = uiStyle.hint;
  if (current) {
    if (current.state === 'in') {
      current.a += hintStyle.fadeIn > 0 ? dt / hintStyle.fadeIn : 1;
      if (current.a >= 1) { current.a = 1; current.state = 'shown'; }
    } else if (current.state === 'shown') {
      current.shownSec += dt;
      if (current.shownSec >= hintStyle.timeout) current.state = 'out';
    } else if (current.state === 'out') {
      current.a -= hintStyle.fadeOut > 0 ? dt / hintStyle.fadeOut : 1;
      if (current.a <= 0) current = null;
    }
  }
  if (!current && queue.length) {
    const id = queue.shift();
    const def = defFor(uiStyle, id);
    if (def) {
      world.state['hints.shown'].push(id);
      const { prefixLine, textLine } = buildLines(uiStyle, def);
      current = { id, def, prefixLine, textLine, a: 0, state: 'in', shownSec: 0 };
    }
  }
}

/** Sets the resolved palette hex-color map onto `uiStyle` once (main.js, load time) - hints.js has no `ASSETS` of its own. */
export function setPaletteColors(uiStyle, colors) {
  uiStyle._paletteColors = colors;
}

/**
 * Pushes the current hint's plate dim rect (must run BEFORE `applySceneDim`
 * for this frame - see main.js render()). Split from the actual text draw
 * (`drawHints`, below) so the dim pass and the (masked, dim-immune) text
 * draw can happen on either side of `applySceneDim`.
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {Object} uiStyle
 * @param {import('../../../engine/index.js').SceneDim} dim
 */
export function pushHintDim(rt, uiStyle, dim) {
  if (!current || !dim) return;
  const hintStyle = uiStyle.hint;
  if (!hintStyle.plate) return;
  const prefixLen = current.prefixLine.n;
  const y = rt.rows - hintStyle.yFromBottom;
  const x = hintStyle.x;
  const totalLen = prefixLen + current.textLine.n;
  const pad = hintStyle.plate.pad;
  const mul = 1 + (hintStyle.plate.bgMul - 1) * current.a;
  pushDimRect(dim, x - pad, y - pad, x + totalLen + pad, y + pad + 1, mul);
}

/**
 * @param {import('../../../engine/index.js').RenderTarget} rt
 * @param {Object} uiStyle
 * @param {import('../../../engine/index.js').FadeLut} lut
 */
export function drawHints(rt, uiStyle, lut) {
  if (!current) return;
  const hintStyle = uiStyle.hint;
  const prefixLen = current.prefixLine.n;
  const y = rt.rows - hintStyle.yFromBottom;
  const x = hintStyle.x;
  drawRichLine(rt, x, y, current.prefixLine, current.a, lut);
  drawRichLine(rt, x + prefixLen, y, current.textLine, current.a, lut);
}

/** Test/debug: the id of the hint currently on screen, or null. */
export function currentHintId() { return current ? current.id : null; }
