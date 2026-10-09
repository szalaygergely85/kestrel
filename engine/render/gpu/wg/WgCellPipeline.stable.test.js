// US-073c (docs/architecture.md 38.25): WgStablePass wired into WgCellPipeline behind `opts.stable` (`?stable=1`).
// Mock device: order/inputs/invalidation/readback routing; default OFF builds nothing extra. Run: node engine/render/gpu/wg/WgCellPipeline.stable.test.js
import assert from 'node:assert';
import { makeMockGpuDevice } from '../../../test/assert.js';
import { WgCellPipeline } from './WgCellPipeline.js';
import { bindShading, bindLevel } from '../../MaterialTable.js';
import { loadLevel } from '../../../world/Level.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import paletteModule from '../../../../design/palette.js';
import detailPassModule from '../../../../design/detail-pass.js';

const palette = paletteModule.default || paletteModule, detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, loadLevel(bundle.levels.test_room));

function make(stable) {
  const { device } = makeMockGpuDevice();
  device.backend = 'webgpu';
  let hook = null;
  const fgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 }), bgTex = device.createTexture({ format: 'rgba8', width: 160, height: 60 });
  const rt = { device, cols: 160, rows: 60, fgTex, bgTex, setCellPass(f) { hook = f; }, setPresentCells() {} };
  const p = new WgCellPipeline(rt, { rays: 1, stable });
  p.bind(table, palette);
  const world = Object.freeze({ structures: Object.freeze([]), structVersion: 1 });
  const cam = { x: 10, y: 20, z: 1.6, yawDeg: 0, pitchDeg: -10 };
  const frame = () => { p.frame({ timeSec: 0 }, [0.1, 0.2, 0.3], cam, world); hook(); };
  return { p, cam, frame, device };
}

// default OFF: nothing extra is built or run
{
  const { p, frame } = make(false);
  frame(); frame();
  assert.strictEqual(p._stablePass, null, 'off: no stable pass');
  assert.strictEqual(p._t.texLevel, undefined, 'off: no level target');
  assert.strictEqual(p._stableRan, false);
  p.invalidateHistory(); // safe no-op
  p.setStable(true);
  assert.strictEqual(p._stableOn, false, 'off: setStable cannot create the pass');
  p.dispose();
}

// ON
{
  const { p, cam, frame } = make(true);
  assert.ok(p._stablePass && p._t.texLevel, 'on: pass + level target built');
  frame();
  assert.ok(p._cellsShaded && p._stableRan, 'stable ran after shade+edge');
  assert.strictEqual(p._stablePass.st.histValid, false, 'first frame: history invalid');
  frame();
  assert.strictEqual(p._stablePass.st.histValid, true, 'second frame: history valid');
  // sprites read the stable output, the readback path too
  assert.strictEqual(p._spInp, undefined, 'no sprites bound here');
  p.invalidateHistory(); frame();
  assert.strictEqual(p._stablePass.st.histValid, false, 'invalidateHistory(): next frame fresh');
  frame();
  assert.strictEqual(p._stablePass.st.histValid, true);
  cam.x += 5; frame(); // > 2 m: auto cut
  assert.strictEqual(p._stablePass.st.histValid, false, 'camera cut > 2 m invalidates');
  frame();
  p.setDebugMode(0); frame();
  assert.strictEqual(p._stableRan, false, 'debug view: stable skipped');
  p.setDebugMode(-1); frame();
  assert.strictEqual(p._stablePass.st.histValid, false, 'frame after a skipped one is fresh');
  assert.strictEqual(p._stableRan, true);
  p.setStable(false); frame();
  assert.strictEqual(p._stableRan, false, 'setStable(false)');
  p.setStable(true); frame();
  assert.strictEqual(p._stableRan, true);
  assert.strictEqual(p._stablePass.st.histValid, false, 'setStable(true): fresh start');
  // resizeGrid: stable targets follow, history invalid
  p.resizeGrid(120, 50);
  assert.strictEqual(p._stablePass.cols, 120, 'stable pass resized with the grid');
  p.dispose();
  assert.strictEqual(p._stablePass, null);
}
console.log('WgCellPipeline.stable.test.js: all checks passed.');
