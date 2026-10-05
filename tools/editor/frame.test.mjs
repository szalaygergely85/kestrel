// tools/editor/frame.test.mjs - US-031 (docs/architecture.md 24.13 S4):
// the idle-skip dirty-flag decision (24.1 decision 6 / 24.4), pulled out of
// `frame.js`'s `step()` as `idleSkip()` so it is testable without a real
// RenderTarget/World/canvas. Plain Node ESM, no test framework, no build
// step - matches engine/core/loop.test.js. Run with:
//
//   node tools/editor/frame.test.mjs

import { idleSkip, editorRenderer, createFrame } from './frame.js';
import { createRebuildScheduler } from './rebuildScheduler.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import { GpuCellPipeline } from '../../engine/index.js';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0;
let fail = 0;
const failures = [];

const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// 36.3: icons use the mesh JS twin without changing the ordinary editor reference.
{
  const { assets } = await loadTestAssets();
  const rt = { backend: 'c2d-capped', cols: 160, rows: 60, pxCellW: 8, pxCellH: 16 };
  const engine = { events: { on() {} } };
  const icon = createFrame({ engine, assets, rt, renderer: 'mesh', gpuParam: false, cpuMesh: true });
  ok('icon CPU frame has mesh renderer and compositor feed', icon.renderer === 'mesh' && icon.fb.renderer === 'mesh');
  ok('icon CPU frame creates no GPU pipeline', icon.gpuPipeline === null);
  const ordinary = createFrame({ engine, assets, rt, renderer: 'dda', gpuParam: false });
  ok('ordinary editor CPU reference uses mesh', ordinary.renderer === 'mesh' && ordinary.fb.renderer === 'mesh');
}

// ---- ME-19a: renderer selection is ignored, even without a GPU ----
{
  // Constructor routing probe; GL allocation is covered by the browser pass.
  class PipelineProbe extends GpuCellPipeline { _initGL() {} _rebindLastTable() {} setEnabled() {} }
  for (const value of ['', 'mesh', 'dda', 'junk']) {
    ok('editor renderer flag ignored: ' + value, editorRenderer(new URLSearchParams('renderer=' + value)) === 'mesh');
    const pipeline = new PipelineProbe({ canvas: { addEventListener() {} } }, { renderer: value, shadows: { sun: 'dda' } });
    ok('pipeline renderer option ignored: ' + value, pipeline.renderer === 'mesh' && pipeline.ready);
  }
}

// ---- ED-MESH-1d: 5 nudges in one frame -> 1 rebuild ----
{
  let n = 0, folded = 0;
  const s = createRebuildScheduler(() => { n++; return 1.5; }, (ms, f) => { folded = f; });
  for (let i = 0; i < 5; i++) s.request();
  ok('requests alone do not rebuild', n === 0 && s.pending);
  s.flush();
  ok('5 requests in one frame -> 1 rebuild (5 folded)', n === 1 && folded === 5 && !s.pending);
  s.flush();
  ok('an empty flush does nothing', n === 1);
  s.flushNow();
  ok('flushNow rebuilds immediately', n === 2 && s.runs === 2);
}

// ---- dirty (a camera move / world reload / toggle) -> render once, then idle ----
{
  let dirty = true;
  const r1 = idleSkip(dirty, false, false);
  ok('dirty -> shouldRender', r1.shouldRender === true);
  ok('dirty, not animating, not baking -> nextDirty false (goes idle after this frame)', r1.nextDirty === false);
  dirty = r1.nextDirty;

  const r2 = idleSkip(dirty, false, false);
  ok('idle (dirty false, animate false, baking false) -> shouldRender false (the AC: no re-render while unchanged)', r2.shouldRender === false);
  ok('stays idle: nextDirty stays false', r2.nextDirty === false);
}

// ---- Animate toggle keeps rendering every frame, even with dirty already false ----
{
  const r = idleSkip(false, true, false);
  ok('animate:true renders even when dirty:false', r.shouldRender === true);
  ok('animate:true keeps nextDirty true (renders again next frame too)', r.nextDirty === true);
}

// ---- the far terrain bake keeps rendering until farReady, then stops --------
{
  const baking = idleSkip(false, false, true);
  ok('farBaking:true renders even when dirty/animate are false', baking.shouldRender === true);
  ok('farBaking:true keeps nextDirty true while it runs', baking.nextDirty === true);

  const doneBaking = idleSkip(baking.nextDirty, false, false); // farReady flipped since last frame
  ok('once the bake finishes (farBaking:false) and nothing else is dirty, the NEXT frame renders once more (nextDirty carried true)', doneBaking.shouldRender === true);
  ok('...then goes idle after that', idleSkip(doneBaking.nextDirty, false, false).shouldRender === false);
}

// ---- a dirty frame that arrives while animate is already on stays dirty forever (expected: animate alone drives it) ----
{
  const r = idleSkip(true, true, false);
  ok('dirty + animate both true -> renders', r.shouldRender === true);
  ok('nextDirty follows animate, not the incoming dirty flag', r.nextDirty === true);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
