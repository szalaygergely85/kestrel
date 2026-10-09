// WG-5a-4: WG-vs-GL surface parity split out of WgCellPipeline.test.js. WG-5: delete with the GL path.
import assert from 'node:assert';
import { WgCellPipeline, PASS_NAMES } from './WgCellPipeline.js';
import { GpuCellPipeline, PASS_NAMES as GL_PASS_NAMES } from '../GpuCellPipeline.js';
const SURFACE = ['frame', 'bind', 'bindVoxels', 'bindViewModel', 'bindInstances', 'resizeGrid', 'setEnabled', 'setPassTiming', 'setDebugMode', 'readbackGeometry', 'readbackLight', 'readbackWater', 'readbackShadowDepthBits', 'readback', 'dispose'];
for (const m of SURFACE) {
  assert.strictEqual(typeof WgCellPipeline.prototype[m], 'function', m);
  assert.strictEqual(typeof GpuCellPipeline.prototype[m], 'function', 'GL surface ' + m);
}
assert.deepStrictEqual([...PASS_NAMES], [...GL_PASS_NAMES]);
console.log('WgCellPipeline.gl.test.js: ok');
