// game/js/quest/vitalsView.js (US-080a2, docs/architecture.md 30.2). Presentation only - reads
// `components.health` off the player entity (`world.get('player')`, same convention as vitals.test.js) for the HP
// bar, and the `vitals` sim's own transient fields (`hurtTick`, `dead`, `deathStep`, `cardReady`) for the hurt
// edge / death card, since those are NOT serialized onto the entity (vitals.js's own doc comment: "kept on the
// returned sim object only"). Outside `sim/**` (rule 15 only binds `game/js/quest/sim/**`): trig and Math.random
// are fine here, same precedent as a `*View.js` presentation file (e.g. `swordView.js`).
//
// `uiStyle.vitals` (design/models/m3_props.js) already resolves every colour to a literal RGB triplet (section 6's
// own comment: "Colours are literal RGB"), unlike `uiStyle.endText` (hex strings looked up in `palette.colors`) -
// so, unlike endCard.js, nothing here needs `hexToRgb`/`paletteColors`; `compileRichLine`/`drawRichLine` take the
// RGB arrays directly.
import { compileRichLine, drawRichLine, applySceneFade } from '../../../engine/index.js';
import { VITALS_DEFAULTS } from './sim/vitalsConfig.js';

const DEFAULT_CELLS = 20; // uiStyle.vitals.layout.cells

// ---------------------------------------------------------------------------------------------------------------
// Pure cell math (uiStyle.vitals.fillRule), exported for tests and for US-080b's MP bar reuse.
// ---------------------------------------------------------------------------------------------------------------
/**
 * @param {number} value @param {number} max @param {number} [totalCells]
 * @returns {{full:number, part:number, filled:number}} `filled` = full+part = how many cells "read as lit".
 */
export function cellCounts(value, max, totalCells = DEFAULT_CELLS) {
  if (!(value > 0) || !(max > 0)) return { full: 0, part: 0, filled: 0 };
  const cells = (value * totalCells) / max;
  let full = Math.floor(cells);
  let part = cells - full >= 0.5 ? 1 : 0;
  if (full === 0 && part === 0) part = 1; // "value > 0 always shows at least one part cell"
  if (full > totalCells) { full = totalCells; part = 0; }
  return { full, part, filled: full + part };
}

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** `uiStyle.vitals.hp.low.curve`: 0..1, 0 outside the low-HP band. Pure (presentation only - `simTime` seconds). */
export function lowPulseAmount(value, max, low, simTime) {
  if (!low || !(max > 0) || value / max > low.atOrBelow) return 0;
  const hz = low.hz || 1.0;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * hz * simTime);
}

/** `uiStyle.vitals.hp.chip.stages`: sequential ms durations: returns the active stage def or null once past the end. */
export function chipStageAt(elapsedMs, stages) {
  let acc = 0;
  for (const s of stages) {
    acc += s.ms;
    if (elapsedMs < acc) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-bar view state (damage chip / gain follow-through): keyed by bar id ('hp' today, 'mp' in US-080b) so this
// file never needs to change shape when the MP bar lands - a second `drawBar('mp', ...)` call just gets its own
// entry. Module-level singleton, same precedent as hints.js's `current`.
// ---------------------------------------------------------------------------------------------------------------
const barState = new Map();
function getBarState(key) {
  let s = barState.get(key);
  if (!s) { s = { prevValue: null, chip: null, gain: null }; barState.set(key, s); }
  return s;
}

/** Test hook: clears all remembered bar/hurt/chip view state (a fresh "load"). */
export function resetVitalsView() {
  barState.clear();
}

function writeChar(ui, x, y, ch, fg, bg) {
  ui.setCellRGB(x, y, ch.charCodeAt(0) - 32, fg[0] | 0, fg[1] | 0, fg[2] | 0, bg[0] | 0, bg[1] | 0, bg[2] | 0);
}
function writeSpaces(ui, x0, x1, y, bg) {
  for (let x = x0; x <= x1; x++) ui.setCellRGB(x, y, 0, 0, 0, 0, bg[0] | 0, bg[1] | 0, bg[2] | 0);
}

/**
 * Draws one bar row (HP today; `def` = `style.hp`, reused verbatim by US-080b for `style.mp`). Tracks its own
 * previous value (`barState`) to detect a damage chip or a gain flash - the caller never passes a "did it change"
 * flag (vitalsConfig's "the view remembers the previous hp and the tick it changed" note).
 */
/** `uiStyle.vitals.mp.short`: true during an "on" blink segment within `short.ms` of `flashTick` (steps). Pure. */
export function shortFlashOn(elapsedMs, short) {
  if (elapsedMs < 0 || elapsedMs >= short.ms) return false;
  const segMs = short.ms / (short.blinks * 2);
  return Math.floor(elapsedMs / segMs) % 2 === 0;
}

function drawBar(ui, key, value, max, style, def, row, simTime, flashTick) {
  const L = style.layout;
  const totalCells = L.cells;
  const st = getBarState(key);
  if (st.prevValue !== null && value !== st.prevValue) {
    const fromC = cellCounts(st.prevValue, max, totalCells).filled;
    const toC = cellCounts(value, max, totalCells).filled;
    if (value < st.prevValue) { st.chip = { from: fromC, to: toC, start: simTime }; st.gain = null; }
    else { st.gain = { from: fromC, to: toC, start: simTime }; st.chip = null; }
  }
  st.prevValue = value;

  if (st.chip) {
    const elapsed = (simTime - st.chip.start) * 1000;
    if (!chipStageAt(elapsed, def.chip.stages)) st.chip = null;
  }
  if (st.gain) {
    const elapsed = (simTime - st.gain.start) * 1000;
    if (elapsed >= (def.gain ? def.gain.ms : 0)) st.gain = null;
  }

  const counts = cellCounts(value, max, totalCells);
  const a = lowPulseAmount(value, max, def.low, simTime);
  // US-080b mana-short flash (uiStyle.vitals.mp.short): 2 blinks in 320 ms, driven by `manaFlashTick` the same
  // way the hurt edge/kick are driven by `hurtTick` - brackets, label and the empty cells switch to `def.short`;
  // the fill is unchanged (the design data's own rule).
  const shortOn = !!(def.short && flashTick && shortFlashOn((simTime - flashTick / 60) * 1000, def.short));

  const labelX = L.x + (L.labelCol || 0);
  const openX = L.x + L.openCol;
  const firstX = L.x + L.firstCell;
  const closeX = L.x + L.closeCol;
  const numberX = L.x + L.numberCol;

  const textBg = style.textBg || [0, 0, 0];
  const labelFg = shortOn ? def.short.label.fg : def.label.fg;
  writeChar(ui, labelX, row, def.label.text[0], labelFg, textBg);
  writeChar(ui, labelX + 1, row, def.label.text[1], labelFg, textBg);
  if (openX > labelX + 2) writeSpaces(ui, labelX + 2, openX - 1, row, textBg);

  const bracketFg = shortOn ? def.short.brackets.fg
    : def.low && a > 0 ? lerp3(def.brackets.fg, def.low.brackets.fgTo, a) : def.brackets.fg;
  writeChar(ui, openX, row, def.brackets.open, bracketFg, textBg);
  writeChar(ui, closeX, row, def.brackets.close, bracketFg, textBg);
  if (closeX > firstX + totalCells - 1 + 1) writeSpaces(ui, firstX + totalCells, closeX - 1, row, textBg);

  for (let i = 0; i < totalCells; i++) {
    const x = firstX + i;
    let glyph, fg, bg;
    if (i < counts.full) {
      glyph = def.fill.glyph;
      fg = a > 0 ? lerp3(def.fill.fg, def.low.fill.fgTo, a) : def.fill.fg;
      bg = a > 0 ? lerp3(def.fill.bg, def.low.fill.bgTo, a) : def.fill.bg;
    } else if (i < counts.filled) {
      glyph = def.part.glyph; fg = def.part.fg; bg = def.part.bg;
    } else if (st.chip && i >= st.chip.to && i < st.chip.from) {
      const stage = chipStageAt((simTime - st.chip.start) * 1000, def.chip.stages);
      glyph = stage.glyph; fg = stage.fg; bg = def.empty.bg; // chip spec gives no bg - defaults to the empty cell's
    } else if (st.gain && i >= st.gain.from && i < st.gain.to) {
      glyph = def.fill.glyph; fg = def.gain.fg; bg = def.fill.bg;
    } else if (shortOn) {
      glyph = def.short.empty.glyph; fg = def.short.empty.fg; bg = def.empty.bg;
    } else {
      glyph = def.empty.glyph; fg = def.empty.fg; bg = def.empty.bg;
    }
    writeChar(ui, x, row, glyph, fg, bg);
  }

  if (closeX + 1 <= numberX - 1) writeSpaces(ui, closeX + 1, numberX - 1, row, textBg);
  const text = def.number.format.replace('{hp}', String(value)).replace('{mp}', String(value)).replace('{max}', String(max));
  const numFg = a > 0 ? lerp3(def.number.fg, def.low.number.fgTo, a) : def.number.fg;
  for (let i = 0; i < text.length; i++) writeChar(ui, numberX + i, row, text[i], numFg, textBg);
}

/**
 * `engine.ui` is a fixed layer at `uiStyle.uiGrid` (default 160x60, clamped [96,320]) regardless of the scene
 * `?grid=` (engine/ui/uiLayer.js) - so `style.layout`'s columns are plain cell indices into `ui`, no scene-ratio
 * scaling needed (unlike titleCard.js's model-layout, which scales into the SCENE grid).
 * @param {import('../../../engine/index.js').UiLayer} ui
 * @param {import('../../../engine/index.js').World} world
 * @param {Object} style - `ASSETS.uiStyle.vitals`
 * @param {number} simTime - seconds, for the low-HP pulse / chip-gain timing
 * @param {boolean} visible - false on title/map/end/death cards (caller's call)
 * @param {{manaFlashTick?: number}} [vitals] - US-080b: the sim object, for the mana-short flash timing only
 */
export function drawVitals(ui, world, style, simTime, visible, vitals) {
  if (!visible || !style) return;
  const handle = world.get('player');
  const data = handle && handle.data;
  const health = data && data.components && data.components.health;
  const mana = data && data.components && data.components.mana;
  if (!health) return;
  drawBar(ui, 'hp', health.hp, health.max, style, style.hp, style.layout.hpRow, simTime);
  if (mana && style.mp) {
    drawBar(ui, 'mp', mana.mp, mana.max, style, style.mp, style.layout.mpRow, simTime, vitals && vitals.manaFlashTick);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Hurt edge (uiStyle.vitals.hurtEdge): a ragged screen-edge frame for `hurtEdge.ms` real-time ms after
// `vitals.hurtTick` changes. `hurtTick` is a SIM STEP count (vitals.js's own `tick`, incremented once per fixed
// step, assumed 60 Hz); the view converts it to a simTime offset (`hurtTick / 60`) so the animation reads
// correctly against the continuous, render-frame-rate `simTime` clock (interpolated alpha, catch-up frames with
// >1 step) instead of drifting if it compared step counts to a frame-rate-dependent counter of its own.
// ---------------------------------------------------------------------------------------------------------------

/** Fixed per-(x,y) hash in [0,100) - same cells every hit (`uiStyle.vitals.hurtEdge.ragged`). Pure, no allocation. */
export function raggedHash100(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % 100;
}

/** `uiStyle.vitals.hurtEdge.stages`: the active stage for `elapsedMs` since `hurtTick`, or null once past `cfg.ms`. */
export function hurtEdgeStage(elapsedMs, cfg) {
  if (elapsedMs < 0 || elapsedMs >= cfg.ms) return null;
  const msPerStep = cfg.ms / cfg.steps;
  for (const st of cfg.stages) {
    if (elapsedMs < st.untilStep * msPerStep) return st;
  }
  return cfg.stages[cfg.stages.length - 1];
}

function drawRaggedCell(ui, x, y, code, fg, bg, coverage) {
  if (raggedHash100(x, y) >= coverage * 100) return;
  ui.setCellRGB(x, y, code, fg[0] | 0, fg[1] | 0, fg[2] | 0, bg[0] | 0, bg[1] | 0, bg[2] | 0);
}

/**
 * @param {import('../../../engine/index.js').UiLayer} ui
 * @param {{hurtTick:number, tick:number}} vitals
 * @param {number} simTime seconds (unused for the age math - kept in the signature for call-site symmetry
 *   with `drawVitals`; see the Q9 item 2a note below)
 * @param {Object} style - `ASSETS.uiStyle.vitals`
 */
export function drawHurtEdge(ui, vitals, simTime, style) {
  const cfg = style && style.hurtEdge;
  if (!cfg || !vitals || !vitals.hurtTick) return;
  // Q9 item 2a: aged against `vitals.tick` (the sim's own step count, reset to 0 on every `createVitals`), not
  // `simTime` (seconds since page boot, never reset) - comparing a per-load step count to a boot-time clock made
  // this never show again after a restart, once `simTime` had run past a few seconds.
  const elapsedMs = ((vitals.tick - vitals.hurtTick) / 60) * 1000;
  const stage = hurtEdgeStage(elapsedMs, cfg);
  if (!stage) return;

  const cols = ui.cols, rows = ui.rows;
  const { rows: thickRows, cols: thickCols } = cfg.thickness;
  for (let r = 0; r < stage.rings; r++) {
    const ring = cfg.rings[r];
    if (!ring) continue;
    const glyphCh = stage.glyph || ring.glyph;
    const code = glyphCh.charCodeAt(0) - 32;
    const fg = [ring.fg[0] * stage.gain, ring.fg[1] * stage.gain, ring.fg[2] * stage.gain];
    const bg = [ring.bg[0] * stage.gain, ring.bg[1] * stage.gain, ring.bg[2] * stage.gain];
    const topRow = r * thickRows;
    const bottomRow = rows - 1 - r * thickRows;
    const leftX0 = r * thickCols, leftX1 = leftX0 + thickCols - 1;
    const rightX1 = cols - 1 - r * thickCols, rightX0 = rightX1 - thickCols + 1;
    const corner = ring.cornersOnly;

    for (let x = 0; x < cols; x++) {
      if (corner && !(x < corner.cols || x >= cols - corner.cols)) continue;
      drawRaggedCell(ui, x, topRow, code, fg, bg, ring.coverage);
      drawRaggedCell(ui, x, bottomRow, code, fg, bg, ring.coverage);
    }
    for (let y = 0; y < rows; y++) {
      if (corner && !(y < corner.rows || y >= rows - corner.rows)) continue;
      for (let x = leftX0; x <= leftX1; x++) drawRaggedCell(ui, x, y, code, fg, bg, ring.coverage);
      for (let x = rightX0; x <= rightX1; x++) drawRaggedCell(ui, x, y, code, fg, bg, ring.coverage);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Render-eye pitch kick: pure, NEVER written into `look` (architecture 30.2 "do not": the kick is a render-only
// offset applied at the camera-build call site - `cam.pitchDeg += kickDeg(vitals, simTime)` - after `look` has
// already been read). Same hurtTick-elapsed math as the hurt edge, so both end at the same instant.
// ---------------------------------------------------------------------------------------------------------------
const KICK_DEG = 2;
const KICK_MS = 150; // matches uiStyle.vitals.hurtEdge.ms (duplicated here: kickDeg's signature carries no `style`)

/**
 * @param {{hurtTick:number, tick:number}} vitals
 * @param {number} simTime seconds (unused for the age math - see the Q9 item 2a note on `drawHurtEdge`)
 * @returns {number} degrees, 0 when not decaying
 */
export function kickDeg(vitals, simTime) {
  if (!vitals || !vitals.hurtTick) return 0;
  const elapsedMs = ((vitals.tick - vitals.hurtTick) / 60) * 1000;
  if (elapsedMs < 0 || elapsedMs >= KICK_MS) return 0;
  return KICK_DEG * (1 - elapsedMs / KICK_MS);
}

// ---------------------------------------------------------------------------------------------------------------
// Death: scene fade (applySceneFade, driven by deathStep) + the death card (panel/richText, same precedent as
// endCard.js - compileRichLine/drawRichLine, typed-on first line then an afterGap prompt).
// ---------------------------------------------------------------------------------------------------------------

/** 1 = no fade (alive, or still sinking), decaying to 0 over `fadeSteps` once `deathStep > sinkSteps`. */
export function deathFadeAmount(vitals) {
  if (!vitals || !vitals.dead) return 1;
  const { sinkSteps, fadeSteps } = VITALS_DEFAULTS;
  if (vitals.deathStep <= sinkSteps) return 1;
  const f = (vitals.deathStep - sinkSteps) / fadeSteps;
  return f >= 1 ? 0 : 1 - f;
}

/** Applies the death fade to the SCENE render target (same call shape as main.js's existing end-fade block). */
export function applyDeathFade(rt, vitals, fadeLut) {
  const a = deathFadeAmount(vitals);
  if (a < 1) applySceneFade(rt, a, fadeLut);
}

/**
 * Pure timing: typed-on line 0 at `cps` once `cardReady`, then line 1 after `afterGapSec`, with a blinking
 * cursor - same structure as endCard.js's `computeEndCardState`, but driven by `vitals.deathStep` (steps since
 * death, / 60 = seconds - the fixed-step sim's own clock) instead of a continuous `endT`, since the card's timer
 * starts counting the instant `cardReady` goes true and `deathStep` already keeps incrementing past that point
 * (vitals.js: `sim.deathStep++` runs every step while dead, `cardReady` never stops it).
 * @param {{dead:boolean, deathStep:number}} vitals
 * @param {Object} style - `ASSETS.uiStyle.vitals`
 */
// Q9 item 2b: one preallocated state object (and its `lines` array) reused across calls instead of a fresh
// `{visible, lines: [], cursorOn}` literal every frame while dead - same "module-level singleton" precedent as
// `barState` above. Safe to reuse: the caller (main.js) reads the result and discards it before the next frame's
// call, same as every other per-frame draw-state object in this file.
const _deathCardState = { visible: false, lines: [], cursorOn: false };

export function computeDeathCardState(vitals, style) {
  const out = _deathCardState;
  out.visible = false;
  out.lines.length = 0;
  out.cursorOn = false;
  if (!vitals || !vitals.dead || !style || !style.deathCard) return out;
  const { sinkSteps, fadeSteps } = VITALS_DEFAULTS;
  const total = sinkSteps + fadeSteps;
  if (vitals.deathStep < total) return out; // still sinking/fading - no card yet
  out.visible = true;

  let remaining = (vitals.deathStep - total) / 60;
  let allTypedDone = true;
  for (const def of style.deathCard.lines) {
    if (!def.typed) continue;
    const text = def.text != null ? def.text : def.placeholder;
    const cps = def.cps || 30;
    const shown = Math.min(text.length, Math.max(0, Math.floor(remaining * cps)));
    if (shown < text.length) allTypedDone = false;
    out.lines.push({ id: def.id, text, count: shown });
    remaining -= text.length / cps;
  }
  if (allTypedDone) {
    for (const def of style.deathCard.lines) {
      if (def.typed) continue;
      const gap = def.afterGapSec || 0;
      if (remaining < gap) continue;
      out.lines.push({ id: def.id, text: def.text, count: def.text.length });
      if (def.cursor) {
        const period = def.cursor.periodSec || 1.0;
        const duty = typeof def.cursor.duty === 'number' ? def.cursor.duty : 0.5;
        out.cursorOn = ((remaining - gap) % period) / period < duty;
      }
    }
  }
  return out;
}

const deathRichCache = new Map();
function deathLine(id, text, fg, keyFg, keys) {
  const k = id + '\u0000' + text;
  let line = deathRichCache.get(k);
  if (!line) { line = compileRichLine(text, fg, keyFg || fg, keys); deathRichCache.set(k, line); }
  return line;
}

/**
 * @param {import('../../../engine/index.js').UiLayer} ui
 * @param {Object} style - `ASSETS.uiStyle.vitals`
 * @param {ReturnType<typeof computeDeathCardState>} state
 */
export function drawDeathCard(ui, style, state) {
  if (!state || !state.visible) return;
  const dc = style.deathCard;
  for (const def of dc.lines) {
    const ls = state.lines.find((l) => l.id === def.id);
    if (!ls) continue;
    const fg = def.fg || [232, 226, 208];
    const keyFg = Array.isArray(def.key) ? def.key : fg;
    const line = deathLine(def.id, ls.text, fg, keyFg, def.keys);
    const x = (ui.cols >> 1) - (ls.count >> 1);
    drawRichLine(ui, x, def.row, line, 1, null, ls.count);
    if (def.cursor && state.cursorOn) {
      const cur = def.cursor;
      writeChar(ui, x + ls.count, def.row, cur.glyph, fg, [0, 0, 0]);
    }
  }
}
