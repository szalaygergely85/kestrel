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

export const GRID_MIN_COLS = 160;
export const GRID_MAX_COLS = 320;
// D-009 amendment 2 (owner decision, 2026-09-23): 320x120 cells are 4-6 px
// on a normal laptop screen - too small to read. Default is now 240x90;
// `?grid=` still overrides, range stays 160x60..320x120. Auto-grid-by-window
// (architect review 1's recommendation) is a future story, not built here.
export const GRID_DEFAULT_COLS = 240; // US-030a 14.2 item 5: the default on the gl2 GPU path
export const GRID_ASPECT = 3 / 8; // rows = round(cols * GRID_ASPECT) - 160x60 .. 320x120

/**
 * US-030a (docs/architecture.md 14.2 item 5): clamps to [160, 320] columns
 * and derives `rows` to keep the 8:3 aspect (`round(cols*3/8)`) - the pair
 * passed in never reaches either render back-end un-clamped. `clamped` is
 * true whenever the result differs from the input (out-of-range cols, or a
 * `rows` that didn't already match the derived aspect) - the caller logs it
 * exactly once (main.js, for a user-supplied `?grid=`).
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
 * @param {number} [opts.cols] - desired grid width; clamped (see `clampGrid`) - default `GRID_DEFAULT_COLS` (320, the gl2 default).
 * @param {number} [opts.rows] - ignored except for the clamp's mismatch check; `rows` is always derived from `cols`.
 * @param {{cols:number, rows:number}} [opts.cpuGrid] - grid forced when the real back-end isn't a real gl2 GPU (default 160x60).
 * @param {boolean} [opts.gpu] - `false` forces the CPU fallback grid even when WebGL2 would otherwise be used (`?gpu=0`).
 * @param {number} [opts.rays] - sub-ray count (per axis) for the GPU DDA's N-ray coverage vote
 *   (docs/architecture.md 14.2 item 3/US-030b); stored on the engine for `main.js`/the pipeline to read.
 *   Default 2 (2x2), the architecture's confirmed default at 320x120 (14.2 item 5) - `?rays=1..4` overrides.
 * @returns {import('./engine.js').Engine}
 */
export function createEngine(opts) {
  const {
    canvas, assets, cols = GRID_DEFAULT_COLS, rows, force2d = false,
    cpuGrid = { cols: GRID_MIN_COLS, rows: 60 }, gpu = true, rays = 2,
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

  // Loop is created here but not started (per the API note) - `run()`
  // rewires its callbacks and starts it. A no-op placeholder pair avoids a
  // special "not yet wired" state in Loop itself.
  const loop = new Loop(() => {}, () => {});

  const engine = {
    renderTarget,
    depthBuffer,
    openSpans,
    world: null,
    input,
    loop,
    camera,
    events,
    assets,
    rays,
    gridRequest: { cols: grid.cols, rows: grid.rows, clamped: grid.clamped, cpuGrid, gpu, force2d },
    physics, // PHYSICS_DEFAULTS merged with opts.physics
    loadWorld(def) {
      engine.world = World.load(def, assets, { events });
      return engine.world;
    },
    run({ update, render }) {
      loop.update = update;
      loop.render = render;
      loop.start();
      return loop;
    },
    /**
     * US-030a (14.2 item 5): re-sizes the CPU-side engine state (renderTarget,
     * depthBuffer, openSpans) to a new grid - used once at startup when the
     * GPU pipeline fails to compile/link (fall back to `cpuGrid`) and, later,
     * by an in-game grid option. Emits `grid:changed` with the new
     * `renderTarget` so the caller (main.js, which owns `GBuffer`/
     * `GpuCellPipeline` - neither is engine-owned) can rebuild those too;
     * this method does not touch them itself.
     */
    setGrid(newCols, newRows) {
      const g = clampGrid(newCols, newRows);
      const rt = RenderTarget(canvas, g.cols, g.rows, { force2d, cpuGrid, gpu });
      engine.renderTarget = rt;
      engine.depthBuffer = new DepthBuffer(rt.cols, rt.rows);
      engine.openSpans = new OpenSpans(rt.cols);
      engine.gridRequest = { cols: g.cols, rows: g.rows, clamped: g.clamped, cpuGrid, gpu, force2d };
      events.emit('grid:changed', { cols: rt.cols, rows: rt.rows, renderTarget: rt });
      return rt;
    },
  };

  return engine;
}
