import assert from 'node:assert/strict';
import { WaterLayer } from './waterLayer.js';
import { makeMockGpuDevice } from '../../test/assert.js';

let checks = 0;
function ok(v, label) { assert.ok(v, label); checks++; }
const mock = makeMockGpuDevice(), layer = new WaterLayer(mock.device);
const first = {}, second = {}, mesh = { verts: new Float32Array(8), index: new Uint16Array(6) };
layer.resize(80, 30); const target = layer.target, clip = layer.clipmap();
const base = mock.liveCount();
layer.bindWorld(first);
const b = layer.sheet(mesh);
ok(mock.liveCount() === base + 2, 'one sheet uploads two buffers');
ok(layer.sheet(mesh) === b, 'same sheet keeps upload identity');
layer.bindWorld(first);
ok(!b.vertexBuffer._disposed && layer.sheet(mesh) === b, 'same world never clears sheet cache');
layer.bindWorld(second);
ok(b.vertexBuffer._disposed && b.indexBuffer._disposed, 'world change disposes both old buffers');
ok(mock.liveCount() === base && layer._sheets.size === 0, 'world change prunes identities');
ok(layer.target === target && layer.clipmap() === clip, 'world change preserves targets and static clipmap');
const b2 = layer.sheet(mesh);
ok(b2 !== b && mock.liveCount() === base + 2, 'new world gets live buffers even with reused mesh');
layer.bindWorld(null);
ok(b2.vertexBuffer._disposed && mock.liveCount() === base, 'unbinding releases sheets');
layer.bindWorld(first); layer.sheet(mesh); layer.dispose();
ok(mock.liveCount() === 0, 'dispose frees all GPU resources');
layer.dispose(); ok(mock.liveCount() === 0, 'dispose is idempotent');
console.log(`waterLayerWorld: ${checks}/${checks} PASS`);
