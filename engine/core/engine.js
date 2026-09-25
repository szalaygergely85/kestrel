// createEngine (US-024, docs/architecture.md section 5). `index.js` only
// re-exports (no logic - see the folder layout table), so the
// implementation lives here.

import { RenderTarget } from '../render/RenderTarget.js';
import { DepthBuffer } from '../render/DepthBuffer.js';
import { OpenSpans } from '../render/OpenSpans.js';
import { Input } from './input.js';
import { Loop } from './loop.js';
import { Events } from './events.js';
import { Camera } from '../entities/Camera.js';
import { PHYSICS_DEFAULTS } from '../physics/config.js';
import { World } from '../world/World.js';
import { createUiLayer } from '../ui/uiLayer.js';

export const GRID_MIN_COLS = 160;
// D-025 (US-038a, architecture.md 22.2): raised from 320 to 480 - gives
// exactly 240x90 / 320x120 / 400x150 / 480x180 at the 8:3 aspect below.
// 160x60 stays reachable (dev-only, via `?grid=`) but is no longer a
// player-facing option (US-038b's list starts at 240x90).
export const GRID_MAX_COLS = 480;
// D-009 amendment 2 (owner decision, 2026-09-23): 320x120 cells are 4-6 px
// on a normal laptop screen - too small to read. Default is now 240x90;
// `?grid=` still overrides, range is 160x60..480x180 (D-025). Auto-grid-by-
// window (architect review 1's recommendation) is a future story, not built here.
export const GRID_DEFAULT_COLS = 240; // US-030a 14.2 item 5: the default on the gl2 GPU path
export const GRID_ASPECT = 3 / 8; // rows = round(cols * GRID_ASPECT) - 160x60 .. 480x180

/**
 * US-030a (docs/architecture.md 14.2 item 5), range widened by D-025
 * (US-038a, architecture.md 22.2): clamps to [160, 480] columns and derives
 * `rows` to keep the 8:3 aspect (`round(cols*3/8)`) - the pair passed in
 * never reaches either render back-end un-clamped. `clamped` is true
 * whenever the result differs from the input (out-of-range cols, or a
 * `rows` that didn't already match the derived aspect) - the caller logs it
 * exactly once (main.js, for a user-supplied `?grid=`, or `engine.setGrid`
 * for a live request).
 */
export function clampGrid(cols, rows) {
  let c = Math.round(cols);
  const before = c;
  if (c < GRID_MIN_COLS) c = GRID_MIN_COLS;
  if (c > GRID_MAX_COLS) c = GRID_MAX_COLS;
  const r = Math.round(c * GRID_ASPECT);
  const clamped = c !== before || (rows != null && Math.round(rows) !== r);
  return { cols: c, rows: r, clamped };
}

/**
 * @param {import('./assets.js').AssetRegistry} opts.assets
 * @param {number} [opts.cols] - desired grid width; clamped (see `clampGrid`) - default `GRID_DEFAULT_COLS` (240, the gl2 default; D-009 amendment 2).
 * @param {number} [opts.rows] - ignored except for the clamp's mismatch check; `rows` is always derived from `cols`.
 * @param {{cols:number, rows:number}} [opts.cpuGrid] - grid forced when the real back-end isn't a real gl2 GPU (default 160x60).
 * @param {boolean} [opts.gpu] - `false` forces the CPU fallback grid even when WebGL2 would otherwise be used (`?gpu=0`).
 * @param {number} [opts.rays] - sub-ray count (per axis) for the GPU DDA's N-ray coverage vote
 *   (docs/architecture.md 14.2 item 3/US-030b); stored on the engine for `main.js`/the pipeline to read.
 *   Default 2 (2x2), the architecture's confirmed default at 320x120 (14.2 item 5) - `?rays=1..4` overrides.
 * @param {{cols:number, rows?:number}} [opts.uiGrid] - OWN-REQ-003 (architecture.md 17): the fixed UI glyph
 *   layer's grid (`assets.uiStyle.uiGrid`, design/models/title.js) - default 160x60, clamped to [96, 320] cols.
 * @returns {import('./engine.js').Engine}
 */
export function createEngine(opts) {
  const {
    canvas, assets, cols = GRID_DEFAULT_COLS, rows, force2d = false,
    cpuGrid = { cols: GRID_MIN_COLS, rows: 60 }, gpu = true, rays = 2,
    uiGrid = { cols: 160, rows: 60 },
    physics: physicsOverrides = {}, inputTarget = typeof window !== 'undefined' ? window : undefined,
  } = opts;

  const grid = clampGrid(cols, rows);
  const renderTarget = RenderTarget(canvas, grid.cols, grid.rows, { force2d, cpuGrid, gpu });
  const depthBuffer = new DepthBuffer(renderTarget.cols, renderTarget.rows);
  const openSpans = new OpenSpans(renderTarget.cols);
  const input = new Input(inputTarget);
  const events = new Events();
  const camera = new Camera();
  const physics = { ...PHYSICS_DEFAULTS, ...physicsOverrides };
  // OWN-REQ-003 (17.1): one UiLayer for the whole run - bound to whichever
  // RenderTarget is live (this one, or a later `setGrid` replacement) so its
  // sx/sy always reflect the CURRENT scene grid.
  const ui = createUiLayer(uiGrid);
  ui.bindScene(renderTarget.cols, renderTarget.rows);
  if (renderTarget.setUiLayer) renderTarget.setUiLayer(ui);

  // Loop is created here but not started (per the API note) - `run()`
  // rewires its callbacks and starts it. A no-op placeholder pair avoids a
  // special "not yet wired" state in Loop itself.
  const loop = new Loop(() => {}, () => {});

  // D-025 (US-038a, architecture.md 22.6): applies a clamped, already-
  // approved grid request at a frame boundary (or immediately, for
  // `{immediate: true}`) - resizes `renderTarget` IN PLACE (same object,
  // same identity - `RenderTargetGL.setGrid`/`RenderTargetCanvas2D.setGrid`,
  // never a new `RenderTarget()`), then the small CPU-side objects the
  // engine itself owns, then re-binds the fixed UiLayer to the new scale,
  // then emits `grid:changed` so main.js can rebuild everything IT owns
  // (GpuCellPipeline/GpuSpritePass/gbuf/matTable - see architecture.md
  // 22.3's resource table) synchronously, before the frame renders.
  function applyGrid(request) {
    const t0 = performance.now();
    const rt = engine.renderTarget;
    const before = `${rt.cols}x${rt.rows}`;
    rt.setGrid(request.cols, request.rows);
    engine.depthBuffer = new DepthBuffer(rt.cols, rt.rows);
    engine.openSpans = new OpenSpans(rt.cols);
    ui.bindScene(rt.cols, rt.rows);
    if (rt.setUiLayer) rt.setUiLayer(ui);
    engine.gridRequest = { cols: rt.cols, rows: rt.rows, clamped: request.clamped, cpuGrid, gpu, force2d };
    engine._pendingGrid = null;
    events.emit('grid:changed', { cols: rt.cols, rows: rt.rows, renderTarget: rt });
    engine.stats.lastGridSwitchMs = performance.now() - t0;
    console.log(`[grid] ${before} -> ${rt.cols}x${rt.rows} in ${engine.stats.lastGridSwitchMs.toFixed(1)} ms`);
  }

  const engine = {
    renderTarget,
    depthBuffer,
    openSpans,
    ui, // OWN-REQ-003: the fixed UI glyph layer (engine/ui/uiLayer.js)
    world: null,
    input,
    loop,
    camera,
    events,
    assets,
    rays,
    gridRequest: { cols: grid.cols, rows: grid.rows, clamped: grid.clamped, cpuGrid, gpu, force2d },
    // D-025 (US-038a): a request accepted by `setGrid` but not yet applied
    // (waiting for the next `run()` render boundary) - null when there is
    // none. `stats.lastGridSwitchMs` is the last `applyGrid` cost (F3 overlay).
    _pendingGrid: null,
    stats: { lastGridSwitchMs: NaN },
    physics, // PHYSICS_DEFAULTS merged with opts.physics
    loadWorld(def) {
      engine.world = World.load(def, assets, { events });
      return engine.world;
    },
    /**
     * (US-017, 7.4 "Restart / world swap") Swaps in an already-built world
     * (typically `deserialize(initialState, assets)`) - unlike `loadWorld`,
     * this does not call `World.load` again (the world is already loaded);
     * it just makes it live and tells every `'world:loaded'` subscriber
     * (LightSet, handle listeners, game UI) to rebuild their runtime state
     * from it, exactly as they do for a fresh `loadWorld`.
     * @param {import('../world/World.js').World} world
     */
    setWorld(world) {
      engine.world = world;
      world.events = events;
      events.emit('world:loaded', { world });
      return world;
    },
    // D-025 (US-038a, architecture.md 22.6): wraps `render` ONCE (no closure
    // per frame) so a pending grid request applies at the next frame
    // boundary, before that frame renders. The simulation (`update`) never
    // depends on the grid, so this is safe to do here rather than in the
    // fixed-step loop.
    run({ update, render }) {
      loop.update = update;
      loop.render = (a) => {
        if (engine._pendingGrid) applyGrid(engine._pendingGrid);
        render(a);
      };
      loop.start();
      return loop;
    },
    /**
     * D-025 (US-038a, architecture.md 22.6): request a live grid change.
     * Resizes `renderTarget` IN PLACE at the next frame boundary (never a
     * new `RenderTarget`/pipeline - see architecture.md 22.1) - every `rt`
     * reference the caller already holds stays valid. Returns the outcome
     * synchronously; the resize itself happens later unless `immediate` is
     * set (startup-only: the CPU fallback gate in main.js, before `run()`
     * has even wired the frame boundary).
     * @param {{immediate?: boolean}} [opts]
     * @returns {{cols:number, rows:number, clamped:boolean, pending:boolean, error?:string}}
     */
    setGrid(newCols, newRows, opts = {}) {
      const g = clampGrid(newCols, newRows);
      if (g.clamped) console.warn(`[engine.setGrid] ${newCols}x${newRows} clamped to ${g.cols}x${g.rows}`);
      const rt = engine.renderTarget;
      // Only a REAL gl2 GPU grid can live-resize (US-030a's rule, unchanged
      // by D-025) - everything else (CPU/Canvas2D fallback, `?gpu=0`) stays
      // put; a settings menu offering this grid on such a back-end is a
      // product bug upstream of this call, not something to crash over.
      if (rt.backend !== 'gl2' || engine.gridRequest.gpu === false) {
        console.warn(`[engine.setGrid] no GPU grid on this back-end (backend=${rt.backend}, gpu=${engine.gridRequest.gpu}) - staying at ${rt.cols}x${rt.rows}`);
        return { cols: rt.cols, rows: rt.rows, clamped: g.clamped, pending: false };
      }
      if (g.cols === rt.cols && g.rows === rt.rows) {
        return { cols: rt.cols, rows: rt.rows, clamped: g.clamped, pending: false };
      }
      if (rt.canHoldGrid) {
        const check = rt.canHoldGrid(g.cols, g.rows, engine.rays);
        if (!check.ok) {
          console.error(`[engine.setGrid] refused ${g.cols}x${g.rows}: ${check.reason}`);
          return { cols: rt.cols, rows: rt.rows, clamped: g.clamped, pending: false, error: check.reason };
        }
      }
      const request = { cols: g.cols, rows: g.rows, clamped: g.clamped };
      if (opts.immediate) applyGrid(request);
      else engine._pendingGrid = request;
      return { cols: g.cols, rows: g.rows, clamped: g.clamped, pending: !opts.immediate };
    },
  };

  return engine;
}
