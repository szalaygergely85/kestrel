// TEST-GAPS-WG: grid replacement invalidates the last presented, now-disposed textures.
import assert from 'node:assert/strict';
import { RenderTargetWebGPU } from './RenderTargetWebGPU.js';
import { CellBuffer } from './CellBuffer.js';

const oldFg = { id: 'old fg' }, oldBg = { id: 'old bg' }, disposed = [], allocated = [], reads = [];
let resized;
const rt = Object.assign(Object.create(RenderTargetWebGPU.prototype), {
  cols: 2, rows: 1, cells: new CellBuffer(2, 1), fgTex: oldFg, bgTex: oldBg,
  _presentFg: oldFg, _presentBg: oldBg, _refBox: { availW: 1280, availH: 720, dpr: 2 },
  device: {
    dispose(h) { disposed.push(h); assert.equal(rt._presentFg, null); assert.equal(rt._presentBg, null); },
    createTexture(desc) { const t = { desc }; allocated.push(t); return t; },
    async readback(h) { reads.push(h); },
  },
  resize(...args) { resized = args; },
});
rt.setGrid(4, 3);
assert.deepEqual(disposed, [oldFg, oldBg]);
assert.equal(rt._presentFg, null); assert.equal(rt._presentBg, null);
assert.deepEqual([rt.cols, rt.rows, rt.cells.fg.length, rt.cells.bg.length], [4, 3, 48, 48]);
assert.equal(rt.fgTex, allocated[0]); assert.equal(rt.bgTex, allocated[1]);
assert.deepEqual(allocated.map((t) => t.desc), [
  { format: 'rgba8', width: 4, height: 3 }, { format: 'rgba8', width: 4, height: 3 },
]);
assert.deepEqual(resized, [1280, 720, 2]);
await assert.rejects(rt.readbackPresent(), /no present\(\) yet/);
assert.equal(reads.length, 0, 'readback never touches disposed old-grid textures');
// Once a new present has set the sampled handles, readback uses the new textures.
rt._presentFg = rt.fgTex; rt._presentBg = rt.bgTex;
const rb = await rt.readbackPresent(new Uint8Array(48), new Uint8Array(48));
assert.equal(rb.sampledOwnTextures, true);
assert.deepEqual(reads, allocated);
console.log('RenderTargetWebGPU.test: setGrid invalidation, resize, replacement and readback PASS');
