// GFX-02 (arch 2026-10-08): AutoBench timing rules on a fake clock (no DOM: now/visible/sample injected).
import assert from 'node:assert/strict';
import { AutoBench, WARM_MS, MEASURE_MS } from './gfxAutoRun.js';

function run({ gpu = () => 5, frame = () => 16.7, hideAt = null, dt = 16 } = {}) {
  let t = 0, res = null, n = 0;
  const b = new AutoBench({ sample: () => gpu(n), intervalMs: () => frame(n), onDone: (r) => { res = r; },
    now: () => t, visible: () => !(hideAt && t >= hideAt[0] && t < hideAt[1]) });
  for (; n < 2000 && !res; n++) { b.tick(); t += dt; }
  return { res, b, t };
}

// warm-up discarded: every sample before WARM_MS is a 999 ms compile outlier, none may reach the result
{
  const { res } = run({ gpu: (n) => (n * 16 < WARM_MS ? 999 : 5) });
  assert.equal(res.kind, 'gpu');
  assert.ok(res.samples.every((v) => v === 5), 'warm-up samples discarded');
  assert.equal(res.minSamples, 8);
}
// >= 20 GPU samples -> kind 'gpu' with the last 40 % slice only
{
  const { res, b } = run({ gpu: (n) => n });
  assert.equal(res.kind, 'gpu');
  assert.ok(b.gpu.length >= 20);
  assert.equal(res.samples.length, b.gpu.length - Math.floor(b.gpu.length * 0.6), 'last 40 % of the GPU samples');
  assert.deepEqual(res.samples, b.gpu.slice(Math.floor(b.gpu.length * 0.6)));
}
// no finite GPU sample -> kind 'frame' (frame intervals), no minSamples
{
  const { res } = run({ gpu: () => NaN, frame: () => 17 });
  assert.equal(res.kind, 'frame');
  assert.ok(res.samples.length > 20 && res.samples.every((v) => v === 17));
  assert.equal(res.minSamples, undefined);
}
// a hidden tab during measure restarts the warm phase and clears the samples
{
  const hideStart = WARM_MS + 500;
  const { res, t } = run({ gpu: (n) => (n * 16 < hideStart ? 1 : 7), hideAt: [hideStart, hideStart + 300] });
  assert.equal(res.kind, 'gpu');
  assert.ok(res.samples.every((v) => v === 7), 'samples from before the hidden gap are dropped');
  assert.ok(t >= hideStart + 300 + WARM_MS + MEASURE_MS, 'warm + measure restarted after the tab came back');
}
console.log('gfxAutoRun.test OK');
