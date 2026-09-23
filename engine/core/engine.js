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

/**
 * @param {import('./assets.js').AssetRegistry} opts.assets
 * @returns {import('./engine.js').Engine}
 */
export function createEngine(opts) {
  const {
    canvas, assets, cols = 160, rows = 60, force2d = false,
    physics: physicsOverrides = {}, inputTarget = typeof window !== 'undefined' ? window : undefined,
  } = opts;

  const renderTarget = RenderTarget(canvas, cols, rows, { force2d });
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
    physics, // PHYSICS_DEFAULTS merged with opts.physics
    loadWorld(def) {
      throw new Error('engine.loadWorld: not implemented (US-025, World.load)');
    },
    run({ update, render }) {
      loop.update = update;
      loop.render = render;
      loop.start();
      return loop;
    },
  };

  return engine;
}
