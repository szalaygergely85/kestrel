// engine/ui/uiDraw.perf.test.js (BUG-PERF-001 (c), docs/backlog.md row 25w,
// PC-B QUEUE 3 item 3). Headless Node ESM, no framework.
// Run: node engine/ui/uiDraw.perf.test.js
// Allocation check: node --expose-gc engine/ui/uiDraw.perf.test.js
//
// Lives under engine/ui/ (rather than game/js/ui/) so this test-only probe
// can import game/js/quest/hints.js directly for the real hint step/draw
// functions without tripping check-deps.mjs's rule 3 ("game/tools must
// import exactly engine/index.js" - game/**/*.js test files are NOT exempt
// from that rule, unlike engine/**/*.test.js, which check-deps skips
// entirely as "not engine API surface"). It still exercises exactly the
// engine/ui/* + game/js/quest/hints.js code this row's file list covers.
//
// Reproduces the EXACT frame this row's AC names: "the ground-floor frame
// (hint + crosshair + a card)" - a hint on screen (with its plate dim),
// the crosshair, and the map card panel open - drawn through the REAL
// content pipeline (design/palette.js + design/models/title.js, the same
// classic scripts game/index.html loads, via tools/testing/content-node.mjs
// - not a hand-rolled fake uiStyle) for 600 frames, timing exactly the
// `r.ui` lap main.js measures (docs/architecture.md 16, `SEC.ui`): scene
// sceneDim reset+push+apply, crosshair, hints, map-card panel draw.
//
// Investigation summary (see row 25w "(c)" note for the full story): the
// "rich-line recompile every frame" theory was a dead end - hints.js's
// `buildLines`/`compileRichLine` and panel.js's `buildPanelArt` are already
// cached/baked once (`lineCache`/module-level `art`), confirmed by reading
// both call sites; `drawRichLine`/`drawPanel`/`drawCrosshair` all draw
// through `setCellRGB`/a bounded color cache, no allocation, bounded to the
// small on-screen art. The REAL per-frame cost was `sceneDim.js`'s
// `applySceneDim`: it scanned the FULL `cols x rows` scene grid every frame
// a dim rect was live (a hint's small plate, the overwhelmingly common
// case), even though only a few dozen cells inside the rect(s) can ever
// change. Fixed by bounding the scan to the union of the pushed rects'
// bounding boxes when `d.all >= 1` (no whole-scene dim active) - the map
// card's real whole-scene dim (`d.all < 1`) is untouched, still a full scan
// (it needs one). See sceneDim.js / sceneDim.test.js for the fix + its
// correctness tests (bounded path matches a full scan exactly, overlapping
// rects still take the min not a double-multiply, out-of-range rects don't
// throw).
import { performance } from 'node:perf_hooks';
import { AssetRegistry, createUiLayer, createFadeLut, createSceneDim,
  resetSceneDim, applySceneDim, drawCrosshair, buildPanelArt, createPanel, drawPanel,
} from '../index.js';
import { CellBuffer } from '../render/CellBuffer.js';
import paletteMod from '../../design/palette.js';
import titleMod from '../../design/models/title.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { setPaletteColors, request as requestHint, resetHints, stepHints, drawHints, pushHintDim } from '../../game/js/quest/hints.js';

paletteMod; titleMod; // classic scripts: side effects on globalThis.ASSETS (uiStyle, models.mapCard, palette)
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const P = assets.palette;
setPaletteColors(assets.uiStyle, P.colors);

// ---- the ground-floor scene, at the 320x120 ("normal") grid ----------------
function makeSceneRt(cols, rows) {
  const cells = new CellBuffer(cols, rows);
  return {
    cols, rows, cells,
    setCell(x, y, glyph, fg, bg) { cells.setCell(x, y, glyph, fg, bg); },
    setCellRGB(x, y, gi, r, g, b, r2, g2, b2) { cells.setCellRGB(x, y, gi, r, g, b, r2, g2, b2); },
  };
}

const SCENE_COLS = 320, SCENE_ROWS = 120;
const rt = makeSceneRt(SCENE_COLS, SCENE_ROWS);
const ui = createUiLayer(assets.uiStyle.uiGrid);
ui.bindScene(SCENE_COLS, SCENE_ROWS);
const fadeLut = createFadeLut(P.ramps.default, P.ramps.default.length - 1, 0.12);
const sceneDim = createSceneDim();

const crosshairStyle = {
  crosshair: { dim: P.colors[P.ui.crosshair], active: P.colors[P.ui.crosshairActive] },
  prompt: { color: P.colors[P.ui.prompt], keyColor: P.colors[P.ui.promptKey] },
};
const interaction = { targetKey: 'lantern', prompt: '[E] Take lamp' };

// ---- the map card, open (a real `Panel`, built from the real model) -------
const mapModel = assets.model('mapCard');
const mapArt = buildPanelArt(mapModel, assets.palette, 'show');
const mapCfg = assets.uiStyle.mapCard;
const mapPanel = createPanel(mapArt, {
  fadeIn: mapCfg.fadeIn, fadeOut: mapCfg.fadeOut,
  sceneMul: mapCfg.sceneDim.bgMul, plateMul: mapCfg.plate.bgMul, platePad: mapCfg.plate.pad,
});
mapPanel.layout(SCENE_COLS, SCENE_ROWS, mapModel.layout.top, mapModel.layout.centerX, assets.uiStyle.uiGrid);
mapPanel.open();
for (let i = 0; i < 60; i++) mapPanel.step(1 / 60); // fully open, steady state

// ---- a hint on screen (real hint def, real world.state) --------------------
const world = { state: {} };
resetHints();
requestHint(world, assets.uiStyle, assets.uiStyle.hints[0].id);
for (let i = 0; i < 60; i++) stepHints(world, assets.uiStyle, 1 / 60, {
  walking: false, pointerUnlocked: false, moveOrLook: false, run: false, jump: false, pointerLocked: false, mPressed: false,
}); // let it fade fully in and settle ("shown" state - the steady on-screen case)

// ---- one r.ui-equivalent frame: sceneDim reset+push+apply, crosshair, hint
// text, map-card panel draw - the exact call sequence/order main.js's
// render() runs between `lap(SEC.world)` and `lap(SEC.ui)`.
function runFrame(timeMs) {
  resetSceneDim(sceneDim);
  mapPanel.pushDim(sceneDim, ui);
  pushHintDim(ui, assets.uiStyle, sceneDim);
  applySceneDim(rt, sceneDim);
  drawCrosshair(rt, crosshairStyle, interaction);
  drawHints(ui, assets.uiStyle, fadeLut);
  drawPanel(ui, mapPanel, timeMs, fadeLut);
}

// ---- correctness smoke: the frame actually drew something (not a false-
// positive fast probe from an early-return no-op path) ----------------------
{
  ui.clear();
  rt.cells.mask.fill(0);
  runFrame(0);
  let sceneTouched = 0, uiTouched = 0;
  for (let i = 0; i < rt.cells.mask.length; i++) if (rt.cells.mask[i]) sceneTouched++;
  for (let i = 0; i < ui.cells.mask.length; i++) if (ui.cells.mask[i]) uiTouched++;
  ok('smoke: the crosshair + dim actually touched scene cells', sceneTouched > 0, `sceneTouched=${sceneTouched}`);
  ok('smoke: hint text + map card actually touched UI cells', uiTouched > 0, `uiTouched=${uiTouched}`);
}

// ---- timing: 600 frames, median of 3 runs, target <= 0.4 ms avg -----------
function timeRun(frames) {
  for (let i = 0; i < 30; i++) runFrame(i * 16.7); // warm-up (JIT, hidden classes)
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) runFrame(i * 16.7);
  return (performance.now() - t0) / frames;
}

const runs = [timeRun(600), timeRun(600), timeRun(600)].sort((a, b) => a - b);
const medianMs = runs[1];
console.log(`uiDraw.perf: 3 runs of 600 frames = [${runs.map((r) => r.toFixed(4)).join(', ')}] ms/frame, median=${medianMs.toFixed(4)} ms`);
// Timing is machine-dependent (a busy or slower PC misses it while the code is fine):
// hard gate only with PERF_STRICT=1; otherwise a PERF WARN line. The no-allocation check stays hard.
if (process.env.PERF_STRICT === '1') ok('r.ui-equivalent draw <= 0.4 ms avg (median of 3 runs of 600 frames)', medianMs <= 0.4, `median=${medianMs.toFixed(4)}ms`);
else if (!(medianMs <= 0.4)) console.log('PERF WARN: r.ui-equivalent draw <= 0.4 ms avg missed on this machine (set PERF_STRICT=1 to gate)');

// ---- hard gate: zero allocation on the steady-state path (--expose-gc) ----
if (typeof global.gc === 'function') {
  for (let i = 0; i < 100; i++) runFrame(i * 16.7); // warm-up
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) runFrame(i * 16.7);
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grewBy = after - before;
  ok('no significant heap growth over 2000 frames of the steady-state r.ui draw (--expose-gc)',
    grewBy < 512 * 1024, `grew by ${grewBy} bytes`);
} else {
  for (let i = 0; i < 2000; i++) runFrame(i * 16.7);
  ok('2000 frames run without throwing (run with --expose-gc for the heap check)', true);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
